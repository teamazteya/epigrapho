// SPDX-License-Identifier: GPL-3.0-or-later
// The four things Fase 8 asks of the web build, in a plain browser with no
// Electron underneath it: writing a reference marks it, resting on it shows
// the verse, the block is inserted, and copying it brings the attribution.
// Run while npm run start:web is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const TITLE = "Epigrapho 8 web";
const TYPED = "Romanos 8:28 en una nota.";

const browser = await chromium.launch();
const context = await browser.newContext({
  permissions: ["clipboard-read", "clipboard-write"]
});
const page = await context.newPage();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/** Whether the verse packs have finished loading into the browser's store. */
const versesLoaded = () =>
  page.waitForFunction(
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
    { timeout: 240000 }
  );

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
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: /Usar sin conexión|Use offline|Ũśē ōƒƒĺĩńē/ })
    .click();
  await page.locator('[data-test-id="dialog-yes"]').click();
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  await versesLoaded();

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type(TYPED, { delay: 25 });
  await page.waitForTimeout(3000);

  // 1. The reference is recognised as it is written.
  const reference = page.locator(".active span[data-scripture-ref]").first();
  await reference.waitFor({ timeout: 15000 });
  const marked = {
    ref: await reference.getAttribute("data-scripture-ref"),
    versification: await reference.getAttribute("data-versification"),
    text: await reference.textContent()
  };
  console.log("referencia reconocida:", JSON.stringify(marked));
  assert.equal(marked.ref, "ROM.8.28");
  assert.equal(marked.text, "Romanos 8:28");

  // 2. Resting on it shows the verse and says where it comes from.
  await reference.hover();
  const popover = page.locator('[data-test-id="scripture-popover"]');
  await popover.waitFor({ timeout: 15000 });
  // The box opens with an ellipsis and fills once the pack has been read.
  await page.waitForFunction(
    () =>
      document.querySelector('[data-test-id="scripture-popover-text"]')
        ?.textContent !== "…",
    undefined,
    { timeout: 30000 }
  );
  const preview = {
    ref: await popover.getAttribute("data-scripture-ref"),
    text: await popover
      .locator('[data-test-id="scripture-popover-text"]')
      .textContent(),
    attribution: await popover
      .locator('[data-test-id="scripture-popover-attribution"]')
      .textContent()
  };
  console.log("preview:", JSON.stringify(preview));
  assert.equal(preview.ref, "ROM.8.28");
  assert.ok(preview.text && preview.text !== "…" && preview.text.length > 20);
  assert.equal(preview.attribution, "VBL — CC BY-SA 4.0");

  // 3. The block is inserted from the editor's own action.
  await page.keyboard.press("Escape");
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  await page.locator('[data-test-id="dialog-yes"]').waitFor();
  await page.keyboard.type("Juan 3:16");
  await page.locator('[data-test-id="dialog-yes"]').click();

  await page
    .locator(".active .ProseMirror .scripture-block")
    .waitFor({ timeout: 20000 });
  const inserted = await readBlock();
  console.log("bloque insertado:", JSON.stringify(inserted));
  assert.equal(inserted.ref, "JHN.3.16");
  assert.equal(inserted.translationId, "VBL");
  assert.ok(inserted.text && inserted.text.length > 20);
  assert.equal(inserted.attribution, "VBL — CC BY-SA 4.0");

  // 4. Copying the block brings the reference, the translation and the credit.
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .locator(".active .ProseMirror .scripture-block [data-scripture-copy]")
    .click();
  await page.waitForTimeout(1500);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  console.log("copiado:", JSON.stringify(copied));
  // Windows hands the clipboard back with CRLF line endings.
  assert.match(copied, /^«.+» — Juan 3:16 \(VBL\)\r?\nVBL — CC BY-SA 4\.0$/s);

  console.log(
    "GREEN: en el navegador, la referencia se reconoce, el preview muestra el verso, el bloque se inserta y la copia trae atribución."
  );
} finally {
  await browser.close();
}
