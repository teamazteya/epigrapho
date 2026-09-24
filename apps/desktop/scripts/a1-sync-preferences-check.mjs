// SPDX-License-Identifier: GPL-3.0-or-later
// The preferences that belong to the person, not to the machine (Fase 7): the
// interface language, the translation being read and the words taught to the
// spell checker are settings in the database, so they travel with the account
// and arrive in a second profile — the note's references with them.
//
// The account itself is not part of this: signing in would send the data to a
// third party's server, which Epigrapho does not do. What is exercised here
// is everything up to the wire — the same collection, written and read by a
// second profile through a backup of it.
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const TITLE = "Epigrapho 7";
const REFERENCE = "Romanos 8:28";
// One word waiting in the old settings file (Paso 6.3) and one accepted from
// the context menu once the account owns the dictionary.
const ADOPTED = "Quimeratón";
const ADDED = "Zarandálico";

/** Where this profile keeps its settings file and its backups. */
const settingsFile = (profile) => path.join(profile, "UserData", "config.json");
const backupsDirectory = (profile) =>
  path.join(profile, "Documents", "Epigrapho", "backups");

async function newProfile(name, settings) {
  const profile = await mkdtemp(
    path.join(profilesRoot(), `epigrapho-${name}-`)
  );
  if (settings) {
    await mkdir(path.dirname(settingsFile(profile)), { recursive: true });
    await writeFile(settingsFile(profile), JSON.stringify(settings), "utf-8");
  }
  return profile;
}

const readSettingsFile = async (profile) =>
  JSON.parse(await readFile(settingsFile(profile), "utf-8"));

/** Opens the app on a profile, past the welcome screen. */
async function open(profile) {
  const app = await _electron.launch({
    args: [path.join(root, "build", "electron.js")],
    env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
    timeout: 60000
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  return { app, page };
}

/**
 * A group in Settings. The search matches the group's key, which is the same
 * word whatever language the interface is in.
 */
async function openSettings(page, search, key) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  // The dialog mounts on the hash change; filling the search before it
  // is there types into the box that is on its way out.
  await page.locator(".ReactModal__Content").waitFor();
  await page.locator('[data-test-id="settings-search"]').fill(search);
  const section = page.locator(`[data-test-id="setting-${key}"]`);
  await section.waitFor();
  return section;
}

/** Back to the notes, with the settings dialog gone. */
async function closeSettings(page) {
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

/** The words Settings lists, without the two buttons beside them. */
async function dictionaryWords(page) {
  const section = await openSettings(page, "editor", "custom-dictionay-words");
  const listed = await section.locator("button").allInnerTexts();
  return listed.filter((label) => !/dictionary|diccionario/i.test(label));
}

/**
 * What the app says about the word on a line, and — if a label is given — the
 * menu item that is clicked there. The menu is caught on its way to the
 * screen, so nothing native opens (see a1-user-dictionary-check).
 */
async function menuAt(app, page, line, label) {
  const box = await page
    .locator(`.active .ProseMirror p:nth-of-type(${line})`)
    .boundingBox();
  const capture = app.evaluate(({ BrowserWindow, Menu }, label) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return new Promise((resolve) => {
      let word;
      contents.once("context-menu", (_event, params) => {
        word = params.misspelledWord;
      });
      const popup = Menu.prototype.popup;
      Menu.prototype.popup = function () {
        Menu.prototype.popup = popup;
        const item = label
          ? this.items.find((item) => item.label === label)
          : undefined;
        if (item) item.click();
        resolve({ word, clicked: !!item });
      };
    });
  }, label);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right"
  });
  const menu = await capture;
  if (label) assert.ok(menu.clicked, `no está "${label}" en el menú`);
  await page.waitForTimeout(1500);
  return menu;
}

/** The reference the editor marked, as it is stored. */
const scriptureRefs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".active span[data-scripture-ref]")].map(
      (span) => span.getAttribute("data-scripture-ref")
    )
  );

const first = await newProfile("sync-a", {
  // What Paso 6.3 left in this machine's settings file, in the clear.
  customWords: [ADOPTED],
  ignoredWordsByNote: {}
});
const second = await newProfile("sync-b");
let session = await open(first);

try {
  const { app, page } = session;

  // ---- the words that were waiting in the settings file ----
  assert.deepEqual(await dictionaryWords(page), [ADOPTED]);
  const afterAdoption = await readSettingsFile(first);
  console.log(
    "palabras en el config.json tras adoptarlas:",
    JSON.stringify(afterAdoption.customWords)
  );
  assert.deepEqual(afterAdoption.customWords, []);
  await closeSettings(page);

  // ---- a note with a reference and a word of the person's own ----
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  // The word of their own first and the reference last: detection re-marks the
  // block the cursor is in, so the reference has to be the block left behind.
  await page.keyboard.type(ADDED, { delay: 25 });
  await page.keyboard.press("Enter");
  await page.keyboard.type(`${REFERENCE} en una nota.`, { delay: 25 });
  await page.waitForTimeout(4000);

  const reference = (await scriptureRefs(page))[0];
  console.log("referencia escrita:", JSON.stringify(reference));
  assert.ok(reference);

  await menuAt(app, page, 1, "Agregar al diccionario");
  const bothWords = await dictionaryWords(page);
  console.log("diccionario del perfil A:", JSON.stringify(bothWords.sort()));
  assert.deepEqual(bothWords.sort(), [ADOPTED, ADDED].sort());

  // ---- the translation and the language ----
  const translations = await openSettings(
    page,
    "editor",
    "scripture-translation"
  );
  await translations.locator("select").selectOption("BSB");
  await page.waitForTimeout(1000);

  const language = await openSettings(page, "appearance", "ui-language");
  await language.locator("select").selectOption("en-US");
  await page.waitForLoadState("load");
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  await closeSettings(page);

  // ---- and out into a backup, which carries the same collection ----
  const backup = await openSettings(page, "backup", "create-backup");
  await backup.locator("select").selectOption("partial");
  let file;
  for (let attempt = 0; attempt < 30 && !file; ++attempt) {
    await page.waitForTimeout(1000);
    const files = await readdir(backupsDirectory(first)).catch(() => []);
    file = files.find((name) => name.endsWith(".nnbackupz"));
  }
  assert.ok(file, "el perfil A no escribió ninguna copia");
  const backupFile = path.join(backupsDirectory(first), file);
  console.log("copia escrita:", file);

  await session.app.close();

  // ---- a second profile, which has never seen any of this ----
  session = await open(second);
  const fresh = session.page;
  const beforeRestore = await openSettings(
    fresh,
    "editor",
    "scripture-translation"
  );
  assert.equal(await beforeRestore.locator("select").inputValue(), "VBL");
  assert.deepEqual(await dictionaryWords(fresh), []);
  console.log("perfil B antes: VBL y sin palabras");

  const restore = await openSettings(fresh, "backup", "restore-backup");
  const chooser = fresh.waitForEvent("filechooser");
  await restore.locator("button").click();
  await (await chooser).setFiles(backupFile);

  // The language arrives with everything else, and changing it reloads the
  // window; this is the app coming back up in English.
  await fresh.waitForTimeout(3000);
  await fresh.waitForLoadState("load");
  await fresh.locator('[data-test-id="create-new-note"]').first().waitFor();
  await closeSettings(fresh);

  const arrived = {
    idioma: await (await openSettings(fresh, "appearance", "ui-language"))
      .locator("select")
      .inputValue(),
    traducción: await (
      await openSettings(fresh, "editor", "scripture-translation")
    )
      .locator("select")
      .inputValue(),
    palabras: (await dictionaryWords(fresh)).sort()
  };
  console.log("perfil B después:", JSON.stringify(arrived));
  assert.equal(arrived.idioma, "en-US");
  assert.equal(arrived.traducción, "BSB");
  assert.deepEqual(arrived.palabras, [ADOPTED, ADDED].sort());

  // Nothing of the dictionary is left in this machine's settings file: the
  // words came in encrypted and stay in the database.
  const plain = await readSettingsFile(second);
  console.log(
    "config.json del perfil B:",
    JSON.stringify({
      customWords: plain.customWords,
      ignoredWordsByNote: plain.ignoredWordsByNote
    })
  );
  assert.ok(!plain.customWords?.length);

  // ---- the note, its reference, and the spell checker ----
  await closeSettings(fresh);
  await fresh.getByText(TITLE).first().click();
  await fresh.locator(".active .ProseMirror").waitFor();
  await fresh.waitForTimeout(5000);

  const refs = await scriptureRefs(fresh);
  console.log("referencias en el perfil B:", JSON.stringify(refs));
  assert.deepEqual(refs, [reference]);

  const marked = (await menuAt(session.app, fresh, 1)).word;
  console.log("palabra propia marcada como error:", JSON.stringify(marked));
  assert.equal(marked, "");

  console.log(
    "GREEN: en un segundo perfil aparecen la traducción elegida, el idioma y las palabras del diccionario, con las referencias de la nota intactas."
  );
  console.log(`Evidencia: ${first} · ${second}`);
} catch (error) {
  await session.page
    .screenshot({ path: path.join(second, "failure.png") })
    .catch(() => undefined);
  console.error(`Evidencia: ${first} · ${second}`);
  throw error;
} finally {
  await session.app.close();
}
