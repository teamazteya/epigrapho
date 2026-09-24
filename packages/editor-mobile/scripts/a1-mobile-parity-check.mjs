// SPDX-License-Identifier: GPL-3.0-or-later
// The four things Fase 8 asks of mobile, against the page the phone's WebView
// loads: writing a reference marks it, resting on it shows the verse, the
// block is inserted, and copying it hands the app the attribution.
//
// This is the editor bundle itself, served by its own dev server; the native
// shell around it is not exercised here, and the run on a device is its own
// step.
//
// Run while npm run start is serving this package (PORT=3100).
import assert from "node:assert/strict";
// The same browser the web check drives. This package pins an older
// playwright than the app does, and only one Chromium is installed.
const { chromium } = await import(
  new URL(
    "../../../apps/web/node_modules/playwright-core/index.mjs",
    import.meta.url
  ).href
);

const PAGE = process.env.EDITOR_MOBILE_URL || "http://localhost:3100/";
const TYPED = "Romanos 8:28 en una nota.";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/** Whether the packs shipped beside the page have finished loading. */
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

try {
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  const editor = page.locator(".ProseMirror").first();
  await editor.waitFor({ timeout: 60000 });
  await versesLoaded();

  await editor.click();
  await page.waitForTimeout(1000);
  await page.keyboard.type(TYPED, { delay: 25 });
  await page.waitForTimeout(3000);

  // 1. The reference is recognised as it is written.
  const reference = page.locator("span[data-scripture-ref]").first();
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
  await page.mouse.move(0, 0);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  const insertBlock = page.locator('[data-test-id="insert-block"]').first();
  await insertBlock.waitFor({ state: "visible", timeout: 15000 });
  await insertBlock.click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  const prompt = page.locator('[data-test-id="scripture-prompt-input"]');
  await prompt.waitFor({ timeout: 15000 });
  await prompt.fill("Juan 3:16");
  await page.locator('[data-test-id="scripture-prompt-confirm"]').click();
  // The dialog stays open, with a line saying why, when it cannot find the
  // verse; saying so beats a bare timeout further down.
  await page
    .locator('[data-test-id="scripture-prompt"]')
    .waitFor({ state: "detached", timeout: 30000 })
    .catch(async () => {
      throw new Error(
        `el diálogo no se cerró: ${await page
          .locator('[data-test-id="scripture-prompt-error"]')
          .textContent()}`
      );
    });

  const block = page.locator(".ProseMirror .scripture-block").first();
  await block.waitFor({ timeout: 20000 });
  const inserted = await page.evaluate(() => {
    const block = document.querySelector(".ProseMirror .scripture-block");
    return {
      ref: block?.getAttribute("data-scripture-ref"),
      translationId: block?.getAttribute("data-translation-id"),
      text: block?.querySelector(".scripture-block-text")?.textContent,
      attribution: block?.querySelector(".scripture-block-attribution")
        ?.textContent
    };
  });
  console.log("bloque insertado:", JSON.stringify(inserted));
  assert.equal(inserted.ref, "JHN.3.16");
  assert.equal(inserted.translationId, "VBL");
  assert.ok(inserted.text && inserted.text.length > 20);
  assert.equal(inserted.attribution, "VBL — CC BY-SA 4.0");

  // 4. Copying hands the app the text to put in the clipboard. On a phone
  // that crossing is a message to the native side, so the message is what is
  // read here — it is the boundary, and everything past it is the platform's.
  await page.evaluate(() => {
    globalThis.__sent = [];
    globalThis.ReactNativeWebView = {
      postMessage: (message) => globalThis.__sent.push(message)
    };
  });
  await block.locator("[data-scripture-copy]").click();
  await page.waitForTimeout(1500);
  const copied = await page.evaluate(() =>
    globalThis.__sent
      .map((message) => JSON.parse(message))
      .filter((message) => message.type === "editor-events:copy-to-clipboard")
      .map((message) => message.value)
  );
  console.log("copiado:", JSON.stringify(copied));
  assert.equal(copied.length, 1);
  // The book name follows the interface, which on this bundle is whatever
  // locale the app handed it; the reference itself stays USFM in the note.
  const locale = await page.evaluate(() => globalThis.LINGUI_LOCALE || "en");
  const readable = locale.startsWith("es") ? "Juan 3:16" : "John 3:16";
  console.log("idioma de la página:", locale);
  assert.match(
    copied[0],
    new RegExp(`^«.+» — ${readable} \\(VBL\\)\\nVBL — CC BY-SA 4\\.0$`, "s")
  );

  console.log(
    "GREEN: en la página que carga el WebView del móvil, la referencia se reconoce, el preview muestra el verso, el bloque se inserta y la copia trae atribución."
  );
} finally {
  await browser.close();
}
