// SPDX-License-Identifier: GPL-3.0-or-later
// The lexicon and the concordance (A2 Fases 4 and 5): a word of the
// interlinear opens its lexicon (Strong, English definition marked as such,
// RV1909 usage, es-419), by mouse or keyboard; "Ver todas las apariciones"
// opens the concordance on it; G26 counts 116 in TAGNT grouped by book, a
// click puts the reference in the note, and an original word finds its entry.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-lexicon-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const POPOVER = '[data-test-id="lexicon-popover"]';
const PANE = '[data-test-id="concordance-pane"]';
const editorHtml = () =>
  page.evaluate(() =>
    document.querySelector(".active .ProseMirror").editor.getHTML()
  );

/** Searches the concordance and waits for its answer. */
async function search(query) {
  await page.locator('[data-test-id="concordance-input"]').fill(query);
  await page.locator('[data-test-id="concordance-input"]').press("Enter");
  await page.waitForFunction(
    (pane) => document.querySelector(pane)?.getAttribute("aria-busy") === "false",
    PANE
  );
}

try {
  await page.getByText("Notas", { exact: true }).first().waitFor();
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill("Léxico");
  await page.locator(".active .ProseMirror > p").last().click();
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-interlinear"]').click();
  await page.keyboard.type("Juan 3:16");
  await page.locator('[data-test-id="dialog-yes"]').click();
  const loved = page.locator(".active .interlinear-word", {
    hasText: "ἠγάπησεν"
  });
  await loved.waitFor();

  // 1. A click opens the lexicon, even with the word near the top of the
  //    window, where the box has little room above it.
  await loved.evaluate((word) => word.scrollIntoView({ block: "start" }));
  await loved.click();
  await page.locator(`${POPOVER} .lexicon-strong`).waitFor();
  const lexicon = await page.evaluate((selector) => {
    const box = document.querySelector(selector);
    const text = (cls) => box.querySelector(cls)?.textContent ?? "";
    return {
      lemma: text(".lexicon-lemma"),
      strong: text(".lexicon-strong"),
      usage: text(".lexicon-usage"),
      english: box.querySelector(".lexicon-english .lexicon-text")?.lang,
      definition: text(".lexicon-english .lexicon-text").slice(0, 80),
      es419: [...box.querySelectorAll(".lexicon-es419 h4")].map(
        (h) => h.textContent
      ),
      focused: box.contains(document.activeElement),
      // The box must not cover the word it explains.
      covers: (() => {
        const word = [...document.querySelectorAll(".active .interlinear-word")]
          .find((w) => w.textContent.includes("ἠγάπησεν"))
          .getBoundingClientRect();
        const own = box.getBoundingClientRect();
        return !(own.bottom <= word.top || own.top >= word.bottom);
      })()
    };
  }, POPOVER);
  console.log("léxico:", JSON.stringify(lexicon));
  assert.equal(lexicon.strong, "G25");
  assert.equal(lexicon.lemma, "ἀγαπάω".normalize("NFC"));
  assert.match(lexicon.usage, /^Uso en RV1909: .*amó/);
  assert.equal(lexicon.english, "en");
  assert.match(lexicon.definition, /love/);
  assert.ok(lexicon.es419.length > 0, "sin entrada es-419");
  assert.ok(lexicon.focused, "el popover no tomó el foco");
  assert.equal(lexicon.covers, false, "el popover tapa la palabra");
  await page.screenshot({ path: path.join(profile, "lexico.png") });

  // 2. Escape closes it and gives the focus back to the word; Enter on the
  //    word opens it again.
  await page.keyboard.press("Escape");
  await page.locator(POPOVER).waitFor({ state: "detached" });
  const back = await page.evaluate(
    () => document.activeElement?.querySelector(".interlinear-surface")?.textContent
  );
  assert.equal(back, "ἠγάπησεν");
  await page.keyboard.press("Enter");
  await page.locator(`${POPOVER} .lexicon-strong`).waitFor();

  // 3. "Ver todas las apariciones" opens the concordance on G25.
  await page.locator('[data-test-id="lexicon-concordance"]').click();
  await page.locator(PANE).waitFor();
  await page.waitForFunction(
    (pane) => document.querySelector(pane)?.getAttribute("aria-busy") === "false",
    PANE
  );
  const opened = {
    input: await page.locator('[data-test-id="concordance-input"]').inputValue(),
    total: await page.locator('[data-test-id="concordance-total"]').innerText()
  };
  console.log("concordancia desde el léxico:", JSON.stringify(opened));
  assert.equal(opened.input, "G25");
  assert.match(opened.total, /apariciones según STEPBible TAGNT/);

  // 4. G26: 116 in TAGNT, grouped by book in canonical order.
  await search("G26");
  const total = await page.locator('[data-test-id="concordance-total"]').innerText();
  const books = await page
    .locator(`${PANE} [data-test-id="concordance-book"] > button`)
    .allInnerTexts();
  console.log("G26:", total, JSON.stringify(books));
  assert.equal(total, "116 apariciones según STEPBible TAGNT");
  assert.equal(books[0], "Mateo (1)");
  assert.ok(books.includes("1 Corintios (14)") || books.some((b) => b.startsWith("1 Corintios")));
  const counted = books.reduce((sum, b) => sum + Number(/\((\d+)\)$/.exec(b)[1]), 0);
  assert.equal(counted, 116);

  // 5. A click on an occurrence puts its reference in the note, in USFM.
  // Over 40 occurrences, books start closed so a common word does not read
  // thousands of verses at once.
  await page
    .locator(`${PANE} [data-test-id="concordance-book"] > button`)
    .first()
    .click();
  const first = page.locator(`${PANE} [data-test-id="concordance-occurrence"]`).first();
  await first.waitFor();
  const firstRef = await first.getAttribute("data-ref");
  await page.waitForFunction(
    (pane) =>
      !document
        .querySelector(`${pane} [data-test-id="concordance-occurrence"]`)
        ?.textContent?.endsWith("…"),
    PANE
  );
  console.log("primera aparición:", firstRef, await first.innerText());
  // The cursor is still where the interlinear left it, in the paragraph
  // after the block; the insert goes there.
  await first.click();
  await page.waitForFunction(
    (ref) =>
      document
        .querySelector(".active .ProseMirror")
        .editor.getHTML()
        .includes(`data-scripture-ref="${ref}"`),
    firstRef,
    { timeout: 20000 }
  );
  const html = await editorHtml();
  console.log("nota:", html.match(/<p>[^]*?data-scripture-ref[^]*?<\/p>/)?.[0]);

  // 6. By original word: "agape" and "ἀγάπη" both find G0026.
  for (const word of ["agape", "ἀγάπη"]) {
    await search(word);
    const words = await page
      .locator(`${PANE} [data-test-id="concordance-word"]`)
      .allInnerTexts();
    console.log(`"${word}":`, JSON.stringify(words.slice(0, 3)));
    assert.ok(words.some((w) => w.includes("G0026")), `${word} no encontró G0026`);
  }

  console.log(
    "GREEN: el léxico muestra G25 con su definición en inglés, su uso en RV1909 y es-419, se maneja con teclado, abre la concordancia, G26 da 116 agrupadas por libro, un clic inserta la referencia y la búsqueda por palabra original funciona."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
