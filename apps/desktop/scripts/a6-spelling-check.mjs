// SPDX-License-Identifier: GPL-3.0-or-later
// The biblical names of the study packs (A6 Fase 8): "Melquisedec",
// "Getsemaní", "Nabucodonosor" and "Mefiboset" (the last one only in the new
// list) are not marked; "Melquisedeq" and "Mefibozet" are offered the right
// name; a word the person adds stays theirs (Paso 8.2); and nothing in the
// note is replaced by the app itself.
// Run while npm run start:desktop is serving the app on localhost:3000, after
// `npm run build` in packages/original-languages and a desktop build.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

// One word per line: a right click lands on the word and on nothing else.
const WORDS = [
  "Melquisedec",
  "Getsemaní",
  "Nabucodonosor",
  "Mefiboset",
  "Melquisedeq",
  "Mefibozet",
  "Abiatarr"
];

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-a6-spelling-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  const window = BrowserWindow.getAllWindows()[0];
  window.webContents.setBackgroundThrottling(false);
  window.show();
  window.focus();
  window.webContents.focus();
});
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/**
 * What the app offers for the word on a line, and the item clicked there if a
 * label is given. The menu is caught on its way to the screen, as in
 * a1-user-dictionary-check.mjs.
 */
async function menuAt(line, label) {
  const paragraph = page.locator(`.active .ProseMirror p:nth-of-type(${line})`);
  await paragraph.scrollIntoViewIfNeeded();
  const point = await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
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
        const item = label && this.items.find((item) => item.label === label);
        if (item) item.click();
        resolve({ word, labels: this.items.map((item) => item.label) });
      };
    });
  }, label);
  await page.mouse.click(point.x, point.y, { button: "right" });
  const menu = await capture;
  // Chromium is asked again about the word right after a click.
  if (label) await page.waitForTimeout(1500);
  return menu;
}

const noteText = () =>
  page.locator(".active .ProseMirror").innerText({ timeout: 10000 });

try {
  await page.getByText("Notas", { exact: true }).first().waitFor();
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
  await page
    .locator('.active [data-test-id="editor-title"]')
    .fill("Epigrapho A6 Fase 8");
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  for (const [index, word] of WORDS.entries()) {
    if (index > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(word, { delay: 25 });
  }
  // The dictionaries and the lists are read once, on the first question.
  await page.waitForTimeout(4000);
  const written = await noteText();

  for (const line of [1, 2, 3, 4]) {
    const { word } = await menuAt(line);
    console.log(`${WORDS[line - 1]}: sin subrayar`);
    assert.equal(word, "", WORDS[line - 1]);
  }

  const near = await menuAt(5);
  console.log("Melquisedeq:", JSON.stringify(near));
  assert.equal(near.word, "Melquisedeq");
  assert.equal(near.labels[0], "Melquisedec");

  const listOnly = await menuAt(6);
  console.log("Mefibozet:", JSON.stringify(listOnly));
  assert.equal(listOnly.word, "Mefibozet");
  assert.equal(listOnly.labels[0], "Mefiboset");

  // Paso 8.2: the person's own spelling wins over the list's near name.
  const added = await menuAt(7, "Agregar al diccionario");
  assert.equal(added.word, "Abiatarr");
  assert.equal(added.labels[0], "Abiatar");
  const after = await menuAt(7);
  console.log("Abiatarr, agregada:", JSON.stringify(after.word));
  assert.equal(after.word, "");

  const replaced = await app.evaluate(() => globalThis.__replaced);
  // Adding a word replaces it with itself, so Chromium asks about it again.
  assert.deepEqual(replaced, ["Abiatarr"]);
  assert.equal(await noteText(), written);

  console.log(
    "GREEN: los nombres de los packs no se subrayan, se sugieren, y las palabras personales mandan."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
