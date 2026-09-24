// SPDX-License-Identifier: GPL-3.0-or-later
// The person's own dictionary (Paso 6.3): a word added stops being an error
// and is still accepted after a restart; a word ignored once comes back as an
// error when the app is opened again; a word ignored inside a note stays
// ignored there; and the dictionary can leave as a file and come back.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

// Three words no Spanish dictionary knows, one per shelf.
const ADDED = "Quimeratón";
const ONCE = "Verbigrancio";
const IN_NOTE = "Zarandálico";
const TITLE = "Epigrapho 6.3";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-words-"));
const file = path.join(profile, "diccionario.json");

/** Opens the app on the same profile, past the welcome screen. */
async function open() {
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
  await page.getByText("Notas", { exact: true }).first().waitFor();
  return { app, page };
}

/**
 * What the app says about the word on a line, and — if a label is given — the
 * menu item that is clicked there.
 *
 * The menu is caught on its way to the screen: `popup` is replaced for one
 * call and never reaches the original, so nothing native opens and the item
 * is clicked in the process that built it.
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
        resolve({
          word,
          labels: this.items.map((item) => item.label),
          clicked: !!item
        });
      };
    });
  }, label);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right"
  });
  const menu = await capture;
  if (label) assert.ok(menu.clicked, `no está "${label}" en el menú`);
  // Chromium is asked again about the word right after the click; this is the
  // moment it takes to answer.
  await page.waitForTimeout(1500);
  return menu;
}

/** Settings > Editor > spell check, with the word list on screen. */
async function openDictionarySettings(page) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  // The dialog mounts on the hash change; filling the search before it
  // is there types into the box that is on its way out.
  await page.locator(".ReactModal__Content").waitFor();
  await page.locator('[data-test-id="settings-search"]').fill("editor");
  const section = page.locator(
    '[data-test-id="setting-custom-dictionay-words"]'
  );
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

let session = await open();
try {
  const { app, page } = session;

  // Every replacement is recorded: the words are accepted, not corrected.
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    globalThis.__replaced = [];
    const replace = contents.replaceMisspelling.bind(contents);
    contents.replaceMisspelling = (text) => {
      globalThis.__replaced.push(text);
      return replace(text);
    };
  });

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  for (const [index, word] of [ADDED, ONCE, IN_NOTE].entries()) {
    if (index > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(word, { delay: 25 });
  }
  // The dictionary is read once, on the first question.
  await page.waitForTimeout(4000);

  const noteId = await page.getAttribute("#editorContainer", "data-note-id");
  console.log("nota abierta:", JSON.stringify(noteId));
  assert.ok(noteId);

  for (const [line, word] of [ADDED, ONCE, IN_NOTE].entries()) {
    const before = await menuAt(app, page, line + 1);
    assert.equal(before.word, word);
  }
  console.log("las tres palabras empiezan marcadas");

  const added = await menuAt(app, page, 1, "Agregar al diccionario");
  console.log("menú de una palabra desconocida:", JSON.stringify(added.labels));
  assert.deepEqual(added.labels.slice(0, 3).sort(), [
    "Agregar al diccionario",
    "Ignorar en esta nota",
    "Ignorar una vez"
  ]);
  await menuAt(app, page, 2, "Ignorar una vez");
  await menuAt(app, page, 3, "Ignorar en esta nota");

  const accepted = {
    [ADDED]: (await menuAt(app, page, 1)).word,
    [ONCE]: (await menuAt(app, page, 2)).word,
    [IN_NOTE]: (await menuAt(app, page, 3)).word
  };
  console.log("después de aceptarlas:", JSON.stringify(accepted));
  for (const [word, still] of Object.entries(accepted))
    assert.equal(still, "", `${word} sigue marcada`);

  // Only the first one is a dictionary word; the other two were told to be
  // left alone, which is not the same as being added.
  let section = await openDictionarySettings(page);
  let listed = await section.locator("button").allInnerTexts();
  console.log("diccionario en ajustes:", JSON.stringify(listed));
  assert.ok(listed.includes(ADDED));
  assert.ok(!listed.includes(ONCE) && !listed.includes(IN_NOTE));

  // Export and import go through native dialogs; these answer for them.
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file]
    });
  }, file);

  await section.getByRole("button", { name: "Exportar diccionario" }).click();
  await page.waitForTimeout(1500);
  const exported = JSON.parse(await readFile(file, "utf-8"));
  console.log("archivo exportado:", JSON.stringify(exported));
  assert.deepEqual(exported.words, [ADDED]);

  await section.getByRole("button", { name: ADDED, exact: true }).click();
  await page.waitForTimeout(1000);
  listed = await section.locator("button").allInnerTexts();
  console.log("tras borrarla:", JSON.stringify(listed));
  assert.ok(!listed.includes(ADDED));

  await section.getByRole("button", { name: "Importar diccionario" }).click();
  await page.waitForTimeout(1500);
  listed = await section.locator("button").allInnerTexts();
  console.log("tras importar:", JSON.stringify(listed));
  assert.ok(listed.includes(ADDED));

  await closeSettings(page);

  const replaced = await app.evaluate(() => globalThis.__replaced);
  console.log("reemplazos:", JSON.stringify(replaced));
  // One per click, each one the same word put back in its place so Chromium
  // asks again. Nothing else, and nothing the person did not click.
  assert.deepEqual(replaced, [ADDED, ONCE, IN_NOTE]);

  await session.app.close();

  // ---- and now the same profile, opened again ----
  session = await open();
  await session.page.getByText(TITLE).first().click();
  await session.page.locator(".active .ProseMirror").waitFor();
  await session.page.waitForTimeout(5000);

  const reopened = {
    [ADDED]: (await menuAt(session.app, session.page, 1)).word,
    [ONCE]: (await menuAt(session.app, session.page, 2)).word,
    [IN_NOTE]: (await menuAt(session.app, session.page, 3)).word
  };
  console.log("tras reiniciar:", JSON.stringify(reopened));
  // The dictionary and the note's ignored word are on disk; "ignore once"
  // was only for that run of the app.
  assert.equal(reopened[ADDED], "");
  assert.equal(reopened[ONCE], ONCE);
  assert.equal(reopened[IN_NOTE], "");

  console.log(
    "GREEN: la palabra agregada sigue aceptada tras reiniciar, la ignorada una vez vuelve a marcarse, y la ignorada en la nota sigue ignorada ahí."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await session.page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await session.app.close();
}
