// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the three locales stay independent: the parser recognises Spanish and
// English references whatever the interface language is, the book names shown
// follow the interface, and the stored reference is USFM in every combination
// (PRD §31.2).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const BOTH = "Juan 3:16 y John 3:16 en la misma nota.";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-parser-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/** The references the editor detected, as they are stored. */
const readRefs = () =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".active .ProseMirror span[data-scripture-ref]"
      )
    ].map(
      (span) => `${span.textContent}=${span.getAttribute("data-scripture-ref")}`
    )
  );

/** Picks a language in Settings > Appearance. The app reloads on its own. */
async function chooseLanguage(locale) {
  // Settings is a hash route, so this opens it whatever the sidebar is called.
  await page.evaluate(() => (window.location.hash = "/settings"));
  // The dialog mounts on the hash change; filling the search before it
  // is there types into the box that is on its way out.
  await page.locator(".ReactModal__Content").waitFor();
  // The section id is the same in every language, so the search finds the
  // group whatever the interface is showing.
  await page.locator('[data-test-id="settings-search"]').fill("appearance");
  const select = page.locator('[data-test-id="setting-ui-language"] select');
  await select.waitFor();
  await select.selectOption(locale);
  // The window reloads itself; wait for the app to come back up.
  await page.waitForLoadState("load");
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
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
}

/** Writes a note holding both spellings and returns what was detected. */
async function writeBothSpellings(title) {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(title);
  await page.locator(".active .ProseMirror").click();
  // The first keystrokes are lost if they arrive before the editor has the
  // focus, and typing at full speed drops the odd one in the middle; either
  // way a mangled reference stops being a reference.
  await page.waitForTimeout(1000);
  await page.keyboard.type(BOTH, { delay: 25 });
  // Both spellings are marked one after the other, so wait for the second.
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .nth(1)
    .waitFor({ timeout: 20000 });
  return readRefs();
}

/** Inserts a block from a typed reference and copies it. Returns both. */
async function insertAndCopy(input) {
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
  // Filled through the field itself: typing blind is flaky, the focus does not
  // always land on the dialog in time.
  await page.locator(".ReactModal__Content input").first().fill(input);
  await page.locator('[data-test-id="dialog-yes"]').click();

  await page
    .locator(".active .ProseMirror .scripture-block")
    .last()
    .waitFor({ timeout: 15000 });
  const block = page.locator(".active .ProseMirror .scripture-block").last();
  await block.waitFor();
  const ref = await block.getAttribute("data-scripture-ref");

  await app.evaluate(({ clipboard }) => clipboard.writeText("vacio"));
  await block.locator("[data-scripture-copy]").click();
  let copied = "vacio";
  for (let attempt = 0; attempt < 40 && copied === "vacio"; attempt++) {
    copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    if (copied === "vacio") await page.waitForTimeout(250);
  }
  return { ref, copied };
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // The verse pack loads right after startup; inserting a block reads from it.
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

  const spanishUi = await writeBothSpellings("Epigrapho 2.4 es");
  console.log("interfaz en español, detectado:", JSON.stringify(spanishUi));
  assert.deepEqual(spanishUi, ["Juan 3:16=JHN.3.16", "John 3:16=JHN.3.16"]);

  // An English reference typed into a Spanish interface.
  const spanishCopy = await insertAndCopy("John 3:16");
  console.log("interfaz en español, copiado:", JSON.stringify(spanishCopy));
  assert.equal(spanishCopy.ref, "JHN.3.16");
  assert.ok(
    spanishCopy.copied.includes("» — Juan 3:16 (VBL)"),
    "el nombre del libro no siguió a la interfaz en español"
  );

  await chooseLanguage("en-US");
  await page.getByText("Notes", { exact: true }).first().waitFor();
  console.log("interfaz en inglés: se ve «Notes» en la navegación");

  const englishUi = await writeBothSpellings("Epigrapho 2.4 en");
  console.log("interfaz en inglés, detectado:", JSON.stringify(englishUi));
  assert.deepEqual(englishUi, ["Juan 3:16=JHN.3.16", "John 3:16=JHN.3.16"]);

  // A Spanish reference typed into an English interface.
  const englishCopy = await insertAndCopy("Juan 3:16");
  console.log("interfaz en inglés, copiado:", JSON.stringify(englishCopy));
  assert.equal(englishCopy.ref, "JHN.3.16");
  assert.ok(
    englishCopy.copied.includes("» — John 3:16 (VBL)"),
    "el nombre del libro no siguió a la interfaz en inglés"
  );

  console.log(
    "GREEN: el parser reconoce ambos idiomas con cualquier interfaz, los nombres visibles siguen a la interfaz y el ref guardado es siempre JHN.3.16."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
