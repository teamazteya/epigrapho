// SPDX-License-Identifier: GPL-3.0-or-later
// Inserts a scripture block, clicks it, and checks the clipboard carries the
// verse, the readable reference and the translation.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Epigrapho 7.2";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-copy-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const readBlock = () =>
  page.evaluate(() => {
    const block = document.querySelector(
      ".active .ProseMirror .scripture-block"
    );
    return block
      ? {
          ref: block.getAttribute("data-scripture-ref"),
          translationId: block.getAttribute("data-translation-id"),
          text: block.querySelector(".scripture-block-text")?.textContent,
          attribution: block.querySelector(".scripture-block-attribution")
            ?.textContent
        }
      : undefined;
  });

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // The verse pack loads right after startup; the action reads from it.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("verses")) {
            db.close();
            return resolve(false);
          }
          const count = db
            .transaction("verses", "readonly")
            .objectStore("verses")
            .count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result > 0);
          };
          count.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        open.onerror = () => resolve(false);
      }),
    undefined,
    { timeout: 180000 }
  );

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);

  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  await page
    .locator('[data-test-id="dialog-title"]', { hasText: "Insertar Escritura" })
    .waitFor();
  // The prompt's field takes focus on its own.
  await page.keyboard.type("Juan 3:16");
  await page.locator('[data-test-id="dialog-yes"]').click();

  await page
    .locator(".active .ProseMirror .scripture-block")
    .waitFor({ timeout: 15000 });
  const inserted = await readBlock();
  console.log("insertado:", JSON.stringify(inserted));
  assert.equal(inserted.ref, "JHN.3.16");
  assert.equal(inserted.translationId, "VBL");
  assert.match(inserted.text, /^“Porque Dios amó al mundo/);
  assert.equal(inserted.attribution, "VBL — CC BY-SA 4.0");

  // The block's copy button copies it — a click on the block itself no longer
  // does, so selecting a verse cannot quietly take over the clipboard. The
  // clipboard is read from the main process, which needs no permission prompt.
  await app.evaluate(({ clipboard }) => clipboard.writeText("vacio"));
  await page
    .locator(".active .ProseMirror .scripture-block [data-scripture-copy]")
    .click();
  await page
    .locator('[data-test-id="toast"]')
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => undefined);

  let copied = "vacio";
  for (let attempt = 0; attempt < 20 && copied === "vacio"; attempt++) {
    copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    if (copied === "vacio") await page.waitForTimeout(250);
  }
  console.log("portapapeles:", JSON.stringify(copied));

  const [quoted, attribution] = copied.split(/\r?\n/);
  assert.match(
    quoted,
    /^«“Porque Dios amó al mundo/,
    "falta el texto del verso"
  );
  assert.ok(
    quoted.includes("» — Juan 3:16 (VBL)"),
    "falta la referencia legible o la traducción"
  );
  assert.equal(attribution, "VBL — CC BY-SA 4.0");
  assert.equal(
    quoted.slice(1, quoted.indexOf("» — ")),
    inserted.text,
    "el verso copiado no es el del bloque"
  );

  console.log(
    "GREEN: el portapapeles trae el verso, la referencia legible y (VBL)."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
