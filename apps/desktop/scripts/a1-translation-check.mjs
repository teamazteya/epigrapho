// SPDX-License-Identifier: GPL-3.0-or-later
// Picks BSB as the main translation while the interface stays in Spanish, and
// checks the three surfaces follow it: the hover preview, the inserted block
// and the copied verse (PRD §31.3, Paso 3.2).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Epigrapho 3.2";
const BSB_JOHN =
  "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.";

const profile = await mkdtemp(
  path.join(profilesRoot(), "epigrapho-translation-")
);
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const readPopover = () =>
  page.evaluate(() => ({
    text: document.querySelector('[data-test-id="scripture-popover-text"]')
      ?.textContent,
    attribution: document.querySelector(
      '[data-test-id="scripture-popover-attribution"]'
    )?.textContent
  }));

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

/** Picks a translation in Settings > Editor. Returns what the list offered. */
async function chooseTranslation(translationId) {
  // Settings is a hash route, so this opens it whatever the sidebar is called.
  await page.evaluate(() => (window.location.hash = "/settings"));
  // The dialog mounts on the hash change; filling the search before it
  // is there types into the box that is on its way out.
  await page.locator(".ReactModal__Content").waitFor();
  // The section id is the same in every language.
  await page.locator('[data-test-id="settings-search"]').fill("editor");
  const select = page.locator(
    '[data-test-id="setting-scripture-translation"] select'
  );
  await select.waitFor();
  const offered = await select
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  await select.selectOption(translationId);
  // The list shows the pick at once and still shows it once stored: it used to
  // snap back to the old translation, so the person saw no change at all.
  assert.equal(await select.inputValue(), translationId);
  await page.waitForTimeout(1000);
  assert.equal(await select.inputValue(), translationId);
  // Nothing reloads on its own here, and closing the dialog by hand is racy,
  // so the clean hash reload doubles as proof the choice was persisted.
  // The hash is what keeps the dialog open, so moving off it is enough most
  // of the time. Reloading is the fallback, and it is worth avoiding: a
  // second reload on the heels of the one a language change already does
  // catches the database mid-transaction and the app comes up on its error
  // screen ("Safety level may not be changed inside a transaction").
  const modal = page.locator(".ReactModal__Content");
  await page
    .evaluate(() => (window.location.hash = "/"))
    .catch(() => undefined);
  let closed = await modal
    .waitFor({ state: "detached", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    // Nothing in the app listens for the hash to leave, so the dialog can sit
    // there; it does close on Escape, which is what a person would press.
    await modal.press("Escape").catch(() => undefined);
    closed = await modal
      .waitFor({ state: "detached", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!closed) {
    await page.evaluate(() => window.location.reload()).catch(() => undefined);
    await page.waitForLoadState("load");
    await modal.waitFor({ state: "detached" });
  }
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  return offered;
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // Both packs are loaded right after startup; every surface reads from them.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("verses")) {
            db.close();
            return resolve(false);
          }
          const request = db
            .transaction("verses", "readonly")
            .objectStore("verses")
            .count(IDBKeyRange.bound(["BSB"], ["BSB", []]));
          request.onsuccess = () => {
            db.close();
            resolve(request.result > 0);
          };
          request.onerror = () => {
            db.close();
            resolve(false);
          };
        };
      }),
    undefined,
    { timeout: 240000 }
  );

  const offered = await chooseTranslation("BSB");
  console.log("traducciones ofrecidas:", JSON.stringify(offered));
  // Every embedded pack shows up on its own: the list comes from PROVENANCE.
  assert.deepEqual(offered, [
    "VBL",
    "BSB",
    "KJV",
    "PdDpt",
    "NTV",
    "NBLA",
    "NASB"
  ]);
  // The interface never changed language: this is a content preference.
  await page.getByText("Notas", { exact: true }).first().waitFor();
  console.log("interfaz en español, traducción principal BSB");

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type("Juan 3:16 en español.", { delay: 25 });

  // 1. the preview
  const mark = page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .first();
  await mark.waitFor({ timeout: 20000 });
  await mark.hover();
  await page.waitForFunction(
    () => {
      const text = document.querySelector(
        '[data-test-id="scripture-popover-text"]'
      )?.textContent;
      return !!text && text !== "…";
    },
    undefined,
    { timeout: 15000 }
  );
  const popover = await readPopover();
  console.log("preview:", JSON.stringify(popover));
  assert.equal(popover.text, BSB_JOHN);
  assert.equal(popover.attribution, "BSB — Public Domain");

  await page.locator('.active [data-test-id="editor-title"]').hover();
  await page
    .locator('[data-test-id="scripture-popover"]')
    .waitFor({ state: "detached", timeout: 10000 });

  // 2. the inserted block
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  await page
    .locator('[data-test-id="dialog-title"]', {
      hasText: /Insertar Escritura|Insert Scripture/
    })
    .waitFor();
  await page.locator(".ReactModal__Content input").first().fill("Juan 3:16");
  await page.locator('[data-test-id="dialog-yes"]').click();
  await page
    .locator(".active .ProseMirror .scripture-block")
    .waitFor({ timeout: 15000 });

  const block = await readBlock();
  console.log("bloque:", JSON.stringify(block));
  assert.equal(block.ref, "JHN.3.16");
  assert.equal(block.translationId, "BSB");
  assert.equal(block.text, BSB_JOHN);
  assert.equal(block.attribution, "BSB — Public Domain");

  // 3. the copy
  await app.evaluate(({ clipboard }) => clipboard.writeText("vacio"));
  await page
    .locator(".active .ProseMirror .scripture-block [data-scripture-copy]")
    .click();
  let copied = "vacio";
  for (let attempt = 0; attempt < 40 && copied === "vacio"; attempt++) {
    copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    if (copied === "vacio") await page.waitForTimeout(250);
  }
  console.log("portapapeles:", JSON.stringify(copied));
  const [quoted, attribution] = copied.split(/\r?\n/);
  assert.equal(quoted, `«${BSB_JOHN}» — Juan 3:16 (BSB)`);
  assert.equal(attribution, "BSB — Public Domain");

  console.log(
    "GREEN: con la interfaz en español y BSB como traducción principal, el preview, el bloque y la copia traen el texto en inglés con la atribución de BSB, y el nombre del libro sigue en español."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
