// SPDX-License-Identifier: GPL-3.0-or-later
// A6 Fase 7 on a device: the dictionary sheet shows its hits in three
// sections (Biblical, General Spanish, English); a General Spanish entry and
// an empty search offer the DLE, which opens in the browser; a Wiktionary
// entry goes into the note; and a lemma the weekly copy dropped keeps its
// term with a link to Wiktionary.
//
// Needs the emulator (or a phone) with the debug build installed and the dev
// server (npx react-native start) running for it.
//   node scripts/a6-dictionary-check.mjs
import assert from "node:assert/strict";
import {
  adb,
  APP,
  connectToEditor,
  editorTools,
  shot,
  sleep,
  tap,
  waitFor
} from "./device.mjs";

const PANE = '[data-test-id="dictionary-pane"]';

adb("shell", "pm", "clear", APP);
adb("reverse", "tcp:8081", "tcp:8081");
adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1");
await waitFor("welcome-enter", 180000);
await tap("welcome-enter");
await waitFor("Buscar en Notas");
await tap("buttons.add");
await sleep(3000);

const cdp = await connectToEditor();
const { $, waitUntil, tapOn, type, focusEnd, insertFromMenu } = editorTools(cdp);
await waitUntil(`!!document.querySelector(".ProseMirror")?.editor`, "cargar el editor");
await focusEnd();
await type("Notas sobre la gracia.");

/** Searches the sheet and waits for its results. */
async function search(query) {
  const start = Date.now();
  await $(`(() => {
    const input = document.querySelector('${PANE} [data-test-id="dictionary-input"]');
    input.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await type(query);
  await $(`document.querySelector('${PANE} [data-test-id="dictionary-input"]')
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await sleep(500); // right after Enter the sheet still shows the last search
  await waitUntil(
    `(() => { const r = document.querySelector('${PANE} .study-results');
      return !!r && !r.textContent.includes("Cargando") && !!r.querySelector('[data-test-id^="dictionary-section-"], [data-test-id="dictionary-empty"], [data-test-id="dictionary-error"]'); })()`,
    `buscar ${query}`,
    // The first search reads the packs and builds the index.
    180000
  );
  const seconds = (Date.now() - start) / 1000;
  console.log(`   «${query}»: ${seconds.toFixed(1)} s`);
  return seconds;
}

const sections = () =>
  $(`[...document.querySelectorAll('${PANE} [data-test-id^="dictionary-section-"]')].map((s) => ({
    section: s.getAttribute("data-test-id").replace("dictionary-section-", ""),
    heading: s.querySelector("h4").textContent,
    ids: [...s.querySelectorAll('[data-test-id="dictionary-hit"]')].map((h) => h.getAttribute("data-entry-id"))
  }))`);
const brief = (found) =>
  JSON.stringify(found.map(({ section, heading, ids }) => [section, heading, ids.slice(0, 3)]));

// --- Three sections ----------------------------------------------------------
await insertFromMenu("dictionaryEntry");
await waitUntil(`!!document.querySelector('${PANE}')`, "abrir el diccionario");
// The packs are read in place: with a copy in IndexedDB this took a minute.
const first = await search("Abraham");
assert.ok(first < 20, `la primera búsqueda tardó ${first} s`);
const all = await sections();
console.log("1. Abraham:", brief(all));
assert.deepEqual(
  all.map(({ heading }) => heading),
  ["Bíblico", "Español general", "Inglés"]
);
assert.ok(all[1].ids.includes("WIKT:Abraham"));
assert.ok(all[2].ids.includes("EAS:abraham"));
shot("a6-dictionary-sections");

// --- The DLE, from a General Spanish entry and from an empty search ---------
await search("gracia");
const grace = await sections();
console.log("2. gracia:", brief(grace));
assert.deepEqual(grace.map(({ section }) => section), ["biblical", "spanish"]);
await tapOn(`${PANE} [data-entry-id="WIKT:gracia"] .study-item`);
await waitUntil(
  `!!document.querySelector('${PANE} [data-entry-id="WIKT:gracia"] [data-test-id="dictionary-dle"]')`,
  "abrir gracia"
);
const dle = await $(`(() => { const a = document.querySelector('${PANE} [data-entry-id="WIKT:gracia"] [data-test-id="dictionary-dle"]');
  return { text: a.textContent, href: a.href }; })()`);
assert.deepEqual(dle, { text: "Ver en el DLE (RAE)", href: "https://dle.rae.es/gracia" });
await search("zzqxv");
const empty = await $(`({
  text: document.querySelector('${PANE} [data-test-id="dictionary-empty"]').textContent,
  href: document.querySelector('${PANE} [data-test-id="dictionary-dle"]').href })`);
assert.match(empty.text, /zzqxv/);
assert.equal(empty.href, "https://dle.rae.es/zzqxv");
console.log("3. sin resultados: el DLE con la palabra");

// --- A Wiktionary entry into the note -------------------------------------------
await search("gracia");
await tapOn(`${PANE} [data-entry-id="WIKT:gracia"] [data-test-id="dictionary-insert"]`);
await waitUntil(`!document.querySelector('${PANE}')`, "cerrar la hoja");
await waitUntil(
  `/Wikcionario/.test(document.querySelector('.ProseMirror [data-dictionary-entry="WIKT:gracia"] .dictionary-entry-credit')?.textContent || "")`,
  "leer el bloque de gracia"
);
console.log("4. el bloque WIKT:gracia se lee en la nota");

// --- A lemma the copy dropped ---------------------------------------------------
await $(`document.querySelector(".ProseMirror").editor.commands.insertContentAt(
  document.querySelector(".ProseMirror").editor.state.doc.content.size,
  '<div data-dictionary-entry="WIKT:zzqxv"><p class="dictionary-entry-term">zzqxv</p></div>')`);
await waitUntil(
  `!!document.querySelector('.ProseMirror [data-dictionary-entry="WIKT:zzqxv"] a')`,
  "el bloque que ya no está"
);
const gone = await $(`(() => { const b = document.querySelector('.ProseMirror [data-dictionary-entry="WIKT:zzqxv"]');
  return { term: b.querySelector(".dictionary-entry-term").textContent,
    body: b.querySelector(".dictionary-entry-body").textContent,
    link: b.querySelector("a").textContent, href: b.querySelector("a").href }; })()`);
assert.deepEqual(gone, {
  term: "zzqxv",
  body: "Ya no está en Wikcionario.",
  link: "Abrir en Wikcionario",
  href: "https://es.wiktionary.org/wiki/zzqxv"
});
shot("a6-dictionary-blocks");
console.log("5. el lema que ya no está: su término y el enlace a Wikcionario");
// --- The DLE opens in the browser -------------------------------------------------
// Last: back from the browser, DevTools has let go of the page.
await insertFromMenu("dictionaryEntry");
await waitUntil(`!!document.querySelector('${PANE}')`, "abrir el diccionario");
await search("gracia");
await tapOn(`${PANE} [data-entry-id="WIKT:gracia"] .study-item`);
const focused = () => adb("shell", "dumpsys", "window").match(/mCurrentFocus=.*/)?.[0] ?? "";
await tapOn(`${PANE} [data-entry-id="WIKT:gracia"] [data-test-id="dictionary-dle"]`);
await sleep(3000);
const browser = focused();
assert.ok(!browser.includes(APP), `el DLE no salió de la app: ${browser}`);
console.log("6. el DLE abre en el navegador:", browser);
cdp.close();
adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1");
await sleep(3000);
assert.ok(focused().includes(APP), "no volvió a la app");
console.log("GREEN");
