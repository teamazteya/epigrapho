// SPDX-License-Identifier: GPL-3.0-or-later
// Fase 9: the database connection lives in the main process and outlives the
// window, so a reload can leave a transaction nobody will ever finish. This
// checks the two halves of that: what SQLite actually does when a PRAGMA meets
// an open transaction, and that the app comes back up after the reloads a
// change of language does.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const ROUNDS = Number(process.argv[2] || 4);
// In development the app is served from source, so its own database module
// can be reached from the page by its path on disk. This is how the check
// leaves a transaction open without adding a hook to the app itself.
const DB_MODULE = `/@fs/${fileURLToPath(
  new URL("../../web/src/common/db.ts", import.meta.url)
)
  .split(path.sep)
  .join("/")}`;

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-reload-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/** Changes the interface language and says whether the app came back. */
async function chooseLanguage(locale) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  await page.locator(".ReactModal__Content").waitFor();
  await page.locator('[data-test-id="settings-search"]').fill("appearance");
  const select = page.locator('[data-test-id="setting-ui-language"] select');
  await select.waitFor();
  await select.selectOption(locale);
  await page.waitForLoadState("load");
  const back = await page
    .locator('[data-test-id="create-new-note"]')
    .first()
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const screen = back
    ? undefined
    : await page
        .locator("body")
        .innerText()
        .catch(() => "");

  // Leave the dialog behind for the next round, the same way the other
  // oracles do it: the hash is what holds it open, and reloading on a clean
  // one is the fallback when it does not take.
  const modal = page.locator(".ReactModal__Content");
  if (back) {
    await page
      .evaluate(() => (window.location.hash = "/"))
      .catch(() => undefined);
    const closed = await modal
      .waitFor({ state: "detached", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!closed) {
      await page
        .evaluate(() => {
          window.location.hash = "/";
          window.location.reload();
        })
        .catch(() => undefined);
      await page.waitForLoadState("load");
      await modal.waitFor({ state: "detached", timeout: 15000 });
    }
    await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  }
  return { back, screen };
}

try {
  // 1. What the app was actually tripping over, measured in the runtime where
  // it happens: this is Electron's own build of SQLite, in the main process.
  const behaviour = await app.evaluate(({ app: electronApp }) => {
    // The main process is an ES module, so it has no `require` of its own,
    // and this scope has no dynamic import either; `getBuiltinModule` is the
    // way in that works in both.
    const { createRequire } = process.getBuiltinModule("node:module");
    const require = createRequire(`${electronApp.getAppPath()}/index.js`);
    const database = require("better-sqlite3-multiple-ciphers")(":memory:");
    const result = { inTransaction: false, insideError: "", afterRollback: "" };
    database.exec("BEGIN");
    result.inTransaction = database.inTransaction;
    try {
      database.exec("PRAGMA synchronous = normal");
      result.insideError = "ninguno";
    } catch (error) {
      result.insideError = error.message;
    }
    database.exec("ROLLBACK");
    try {
      database.exec("PRAGMA synchronous = normal");
      result.afterRollback = "ok";
    } catch (error) {
      result.afterRollback = error.message;
    }
    database.close();
    return result;
  });
  console.log("SQLite:", JSON.stringify(behaviour));
  assert.equal(
    behaviour.inTransaction,
    true,
    "inTransaction no refleja la transacción abierta"
  );
  assert.match(
    behaviour.insideError,
    /Safety level may not be changed inside a transaction/,
    "el PRAGMA ya no falla dentro de una transacción"
  );
  assert.equal(behaviour.afterRollback, "ok");
  console.log(
    "1. con una transacción abierta el PRAGMA de arranque falla; tras ROLLBACK pasa"
  );

  // 2. And the flow that meets it: a note being written when the language
  // changes, which reloads the window on top of the writing.
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();

  for (let round = 0; round < ROUNDS; round++) {
    const locale = round % 2 === 0 ? "en-US" : "es-MX";
    await page.locator('[data-test-id="create-new-note"]').first().click();
    await page
      .locator('.active [data-test-id="editor-title"]')
      .fill(`Epigrapho 9 recarga ${round}`);
    await page.locator(".active .ProseMirror").click();
    await page.waitForTimeout(500);
    // No wait for the save: the write has to still be in flight.
    await page.keyboard.type("Romanos 8:28 y algo más de texto.", {
      delay: 10
    });
    const result = await chooseLanguage(locale);
    console.log(
      `2.${round + 1} ${locale}: ${result.back ? "la app volvió" : "NO volvió"}`
    );
    assert.ok(
      result.back,
      `la app no volvió tras cambiar a ${locale}: ${(result.screen || "")
        .split("\n")
        .slice(0, 3)
        .join(" · ")}`
    );
  }

  // 3. And the case itself, on purpose: a transaction opened and then left
  // behind by a window that goes away. Nobody can commit it, so reopening the
  // connection has to undo it, or the app comes up on its error screen.
  const opened = await page.evaluate(async (module) => {
    const { db } = await import(module);
    await db
      .sql()
      .connection()
      .execute(async (connection) => {
        await connection.executeQuery({ sql: "begin", parameters: [] });
      });
    return true;
  }, DB_MODULE);
  assert.ok(opened, "no se pudo abrir la transacción");
  console.log("3. transacción abierta y abandonada a propósito");

  await page.reload();
  const cameBack = await page
    .locator('[data-test-id="create-new-note"]')
    .first()
    .waitFor({ timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  if (!cameBack)
    console.error(
      "pantalla:",
      (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      )
        .split("\n")
        .slice(0, 4)
        .join(" · ")
    );
  assert.ok(
    cameBack,
    "la app no volvió tras recargar con una transacción abandonada"
  );
  console.log("3. la app vuelve: la transacción abandonada se deshizo");

  console.log(
    `GREEN: el PRAGMA de arranque falla dentro de una transacción, una transacción abandonada se deshace al reabrir la conexión, y la app vuelve tras ${ROUNDS} cambios de idioma con una nota a medio guardar.`
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
