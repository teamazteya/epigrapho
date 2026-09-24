// SPDX-License-Identifier: GPL-3.0-or-later
// The biblical Resource Pack (Paso 6.2): a misspelled term is offered the
// right spelling, a term the general dictionary does not know is not marked,
// a valid variant is left alone, and nothing in the note is replaced by the
// app itself.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

// One word per line: a right click lands on the word and on nothing else.
const WORDS = [
  "Tesalonisenses", // misspelled: the pack's preferred spelling answers it
  "Yahvé", // in the pack, unknown to a general Spanish dictionary
  "Yahweh", // a valid variant of the one above
  "hamartiología", // theological vocabulary
  "Gethsemani" // misspelled, and the nearest word is an old spelling
];

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-terms-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/**
 * What the app offers for the word under a point.
 *
 * Two things are read at once, and both come from the main process: what
 * Chromium reports about the word (`misspelledWord` is filled only for a word
 * it has marked) and the menu the app builds in answer. The menu is caught on
 * its way to the screen — `popup` is replaced for one call and never reaches
 * the original — because a native menu would open and block the test.
 */
async function menuAt(line) {
  const box = await page
    .locator(`.active .ProseMirror p:nth-of-type(${line})`)
    .boundingBox();
  const capture = app.evaluate(({ BrowserWindow, Menu }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return new Promise((resolve) => {
      let word;
      contents.once("context-menu", (_event, params) => {
        word = params.misspelledWord;
      });
      const popup = Menu.prototype.popup;
      Menu.prototype.popup = function () {
        Menu.prototype.popup = popup;
        resolve({ word, labels: this.items.map((item) => item.label) });
      };
    });
  });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right"
  });
  return capture;
}

/** Everything the note says, as one string. */
const noteText = () =>
  page.locator(".active .ProseMirror").innerText({ timeout: 10000 });

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // Whether the app ever replaces a word on its own is not a matter of
  // reading the note afterwards: this records every call, including the ones
  // that would put the same text back.
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
    .fill("Epigrapho 6.2");
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);

  for (const [index, word] of WORDS.entries()) {
    if (index > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(word, { delay: 25 });
  }
  // The dictionary and the pack are read once, on the first question.
  await page.waitForTimeout(4000);
  const written = await noteText();

  const wrong = await menuAt(1);
  console.log("Tesalonisenses:", JSON.stringify(wrong));
  assert.equal(wrong.word, "Tesalonisenses");
  assert.equal(wrong.labels[0], "Tesalonicenses");

  const divine = await menuAt(2);
  console.log("Yahvé:", JSON.stringify(divine.word));
  assert.equal(divine.word, "");

  const variant = await menuAt(3);
  console.log("Yahweh:", JSON.stringify(variant.word));
  assert.equal(variant.word, "");

  const theology = await menuAt(4);
  console.log("hamartiología:", JSON.stringify(theology.word));
  assert.equal(theology.word, "");

  // "Gethsemaní" is in the pack, so it is accepted when written — and never
  // offered: what the menu shows is the spelling in use today.
  const dated = await menuAt(5);
  console.log("Gethsemani:", JSON.stringify(dated));
  assert.equal(dated.word, "Gethsemani");
  assert.equal(dated.labels[0], "Getsemaní");
  assert.ok(!dated.labels.includes("Gethsemaní"));

  const replaced = await app.evaluate(() => globalThis.__replaced);
  console.log("reemplazos automáticos:", JSON.stringify(replaced));
  assert.deepEqual(replaced, []);
  assert.equal(await noteText(), written);
  console.log("nota sin cambios:", JSON.stringify(written.split("\n")));

  console.log(
    "GREEN: el pack bíblico sugiere la forma correcta, acepta los términos y las variantes, y no reemplaza nada."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
