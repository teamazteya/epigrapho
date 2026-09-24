// SPDX-License-Identifier: GPL-3.0-or-later
// Inserts a scripture block through the "Insertar Escritura" action and checks
// it renders the VBL verse with its attribution, and survives a reload.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Epigrapho 7.1";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-block-"));
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

  // No typing here: the inserted block is selected, and a keystroke would
  // replace it.
  await page
    .locator('[data-test-id="editor-save-state-notsaved"]')
    .waitFor({ timeout: 15000 })
    .catch(() => undefined);
  await page.locator('[data-test-id="editor-save-state-saved"]').waitFor();
  await page.waitForTimeout(2000);

  await page.reload();
  await page.getByText("Notas", { exact: true }).first().waitFor();
  const block = page.locator(".active .ProseMirror .scripture-block");
  try {
    await block.waitFor({ timeout: 20000 });
  } catch {
    await page
      .locator('[data-test-id="title"]', { hasText: TITLE })
      .first()
      .click();
    await block.waitFor();
  }
  const reloaded = await readBlock();
  console.log("tras recargar:", JSON.stringify(reloaded));
  assert.deepEqual(reloaded, inserted);

  console.log("GREEN: el bloque muestra el verso de VBL con su atribución.");
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
