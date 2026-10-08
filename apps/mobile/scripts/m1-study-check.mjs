// SPDX-License-Identifier: GPL-3.0-or-later
// M1 Fase 5c on a device: what A3 and A4 brought to the desktop, on the phone.
// A theme, a note from a template, NTV with network and a cross-reference, a
// block compared with BSB, sermon mode, the note as .docx and PDF, a day of a
// reading plan, and VBL with no network. Nothing is mocked: NTV comes from
// notas.azteya.tech.
//
// Needs what m1-device-check.mjs needs: the debug build installed and the dev
// server (npx react-native start) running for it.
//
//   node scripts/m1-study-check.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  APP,
  adb,
  connectToEditor,
  editorTools,
  screen,
  shot,
  sleep,
  tap,
  typeText,
  visibleText,
  waitFor
} from "./device.mjs";

const back = async (times = 1) => {
  for (let i = 0; i < times; i++) {
    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await sleep(1000);
  }
};
const openSideMenu = async () => {
  adb("shell", "input", "tap", "118", "191"); // the menu button in the search bar
  await waitFor("sidemenu-settings-icon");
};
const openSettings = async () => {
  await openSideMenu();
  await tap("sidemenu-settings-icon");
  await tap("Ajustes");
};
const chooseTranslation = async (current, next) => {
  await openSettings();
  await tap("Editor");
  await tap(current);
  await tap(next);
  await back(2);
  adb("shell", "input", "tap", "1000", "1200"); // outside the side menu
  await sleep(1000);
};

// --- A clean start -------------------------------------------------------
adb("shell", "pm", "clear", APP);
// Exports from an earlier run would pass for this one's.
adb("shell", "rm -f /sdcard/Documents/*.docx /sdcard/Documents/*.pdf");
adb("shell", "cmd", "connectivity", "airplane-mode", "disable");
adb("reverse", "tcp:8081", "tcp:8081");
adb(
  "shell",
  "monkey",
  "-p",
  APP,
  "-c",
  "android.intent.category.LAUNCHER",
  "1"
);
await waitFor("Empezar", 180000);
await tap("Empezar");
await waitFor("Buscar en Notas");

// --- A4: one of the new themes --------------------------------------------
await openSettings();
await tap("Apariencia");
await tap("Temas");
await tap("Buscar temas");
typeText("Amatista");
await sleep(3000);
adb("shell", "input", "keyevent", "KEYCODE_ESCAPE"); // the keyboard
await sleep(1000);
// The search field says Amatista too; the card is the last one.
const card = screen()
  .filter((node) => node.text === "Amatista")
  .pop();
adb("shell", "input", "tap", `${card.x}`, `${card.y}`);
await tap("Usar como tema oscuro");
await back();
await tap("Modo oscuro");
shot("study-1-theme");
await back(2);
adb("shell", "input", "tap", "1000", "1200");
await sleep(1000);
console.log("1. tema Amatista aplicado");

await chooseTranslation(
  "Versión Biblia Libre (VBL)",
  "Nueva Traducción Viviente (NTV)"
);
console.log("2. traducción principal: NTV (en línea)");

// --- A3: a note from a template --------------------------------------------
await tap("new-note-from-template");
await tap("template-builtin:sermon");
await sleep(3000);
let cdp = await connectToEditor();
try {
  let { $, waitUntil, tapOn, type, focusEnd, insertFromMenu } =
    editorTools(cdp);
  await waitUntil(
    `document.querySelectorAll(".ProseMirror h2").length >= 5`,
    "abrir la nota con la plantilla"
  );
  const note = await $(`({
    sections: document.querySelectorAll(".ProseMirror h2").length,
    first: document.querySelector(".ProseMirror h2").textContent,
    color: getComputedStyle(document.querySelector(".ProseMirror")).color
  })`);
  console.log("3. plantilla:", JSON.stringify(note));
  assert.equal(note.first, "Texto");
  // The theme reached the editor's page too: Amatista's text colour (the
  // page itself is transparent over the app's background).
  assert.equal(note.color, "rgb(205, 214, 244)");

  // --- NTV with network, and a cross-reference ------------------------------
  await focusEnd();
  await type("Juan 3:16 ");
  await sleep(3000);
  await tapOn("span[data-scripture-ref]");
  await waitUntil(
    `(document.querySelector('[data-test-id="scripture-popover-text"]')?.textContent || "…") !== "…"`,
    "abrir el preview"
  );
  await waitUntil(
    `!!document.querySelector('[data-test-id="scripture-popover-see-also"] button')`,
    "cargar las referencias cruzadas"
  );
  const preview = await $(`({
    text: document.querySelector('[data-test-id="scripture-popover-text"]').textContent,
    attribution: document.querySelector('[data-test-id="scripture-popover-attribution"]').textContent,
    seeAlso: document.querySelectorAll('.scripture-popover-see-also-list button').length
  })`);
  console.log("4. preview NTV:", JSON.stringify(preview));
  assert.match(preview.attribution, /Nueva Traducción Viviente/);
  assert.match(preview.text, /amó tanto al mundo/);
  assert.ok(preview.seeAlso > 0, "no hay referencias cruzadas");
  shot("study-2-ntv-xrefs");
  await tapOn(".scripture-popover-see-also-list button");
  await waitUntil(
    `[...document.querySelectorAll(".ProseMirror p")].some((p) => p.textContent.includes("Juan 3:16; "))`,
    "insertar la referencia cruzada"
  );
  console.log(
    "5. referencia cruzada insertada:",
    await $(
      `[...document.querySelectorAll(".ProseMirror p")].find((p) => p.textContent.includes("Juan 3:16; ")).textContent`
    )
  );

  // --- A block, compared with BSB -------------------------------------------
  await insertFromMenu("scripture");
  await waitUntil(
    `!!document.querySelector('[data-test-id="scripture-prompt-input"]')`,
    "abrir el diálogo del pasaje"
  );
  await tapOn('[data-test-id="scripture-prompt-input"]');
  await type("Romanos 8:28");
  await tapOn('[data-test-id="scripture-prompt-confirm"]');
  await waitUntil(
    `!!document.querySelector(".ProseMirror .scripture-block .scripture-block-text")?.textContent`,
    "insertar el bloque"
  );
  await tapOn(".ProseMirror .scripture-block [data-scripture-compare]");
  await tapOn('[data-test-id="compare-prompt-BSB"]');
  await waitUntil(
    `!!document.querySelector('.ProseMirror .scripture-block-parallel[data-translation-id="BSB"] .scripture-block-text')?.textContent`,
    "mostrar BSB al lado"
  );
  if (await $(`!!document.querySelector("dialog.scripture-prompt[open]")`))
    await tapOn('[data-test-id="compare-prompt-cancel"]');
  const block = await $(`(() => { const b = document.querySelector(".ProseMirror .scripture-block"); return {
    primary: b.getAttribute("data-translation-id"),
    columns: [...b.querySelectorAll(".scripture-block-parallel")].map((c) => c.getAttribute("data-translation-id")),
    bsb: b.querySelector('.scripture-block-parallel[data-translation-id="BSB"] .scripture-block-text').textContent.slice(0, 50),
    // On a phone the columns stack: the main text is as wide as BSB's.
    stacked: Math.abs(b.querySelector(":scope > .scripture-block-text").offsetWidth - b.querySelector(".scripture-block-parallel").offsetWidth) < 4
  }; })()`);
  console.log("6. columnas en paralelo:", JSON.stringify(block));
  assert.equal(block.primary, "NTV");
  assert.deepEqual(block.columns, ["BSB"]);
  assert.match(block.bsb, /God works all things together/);
  assert.ok(block.stacked, "en el teléfono las columnas no se apilan");
  shot("study-3-parallel");

  // --- Sermon mode, from the note's menu ------------------------------------
  const openProperties = async () => {
    await $(
      `(() => { const row = [...document.querySelectorAll("#header > div button")].filter((b) => !b.closest('[role="menu"]')); row[row.length - 1].dataset.m1 = "menu"; return true; })()`
    );
    await tapOn('[data-m1="menu"]');
    await $(
      `(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.includes("Propiedades")); item.dataset.m1 = "properties"; return true; })()`
    );
    await tapOn('[data-m1="properties"]');
  };
  await openProperties();
  await tap("icon-sermon-mode");
  await waitUntil(
    `!!document.querySelector("dialog.sermon-mode[open] .sermon-mode-text")`,
    "abrir el modo sermón"
  );
  await tapOn("dialog.sermon-mode [data-scripture-ref]");
  await waitUntil(
    `!!document.querySelector('[data-test-id="sermon-verse"]')?.textContent.trim()`,
    "mostrar el versículo en el modo sermón"
  );
  const sermon = await $(`({
    title: document.querySelector("dialog.sermon-mode h1").textContent,
    verse: document.querySelector('[data-test-id="sermon-verse"]').textContent.slice(0, 50),
    timer: document.querySelector('[data-test-id="sermon-timer"]').textContent
  })`);
  console.log("7. modo sermón:", JSON.stringify(sermon));
  assert.match(sermon.verse, /amó tanto al mundo/);
  shot("study-4-sermon");
  await tapOn('[data-test-id="sermon-exit"]');
  await waitUntil(
    `!document.querySelector("dialog.sermon-mode[open]")`,
    "salir del modo sermón"
  );

  // --- The note as .docx and PDF --------------------------------------------
  const exported = async (format, label) => {
    // The folder picker sends the app to the background, and the editor's
    // DevTools socket does not survive it.
    cdp.close();
    cdp = await connectToEditor();
    ({ $, tapOn } = editorTools(cdp));
    await openProperties();
    await tap("icon-export");
    await tap(label);
    if (format === "docx") {
      // The first export asks for the name on the cover.
      await waitFor("Nombre en la portada");
      typeText("Ana Perez");
      await tap("Listo");
    }
    await pickFolder();
    await waitFor("Nota exportada", 60000);
    shot(`study-5-${format}`);
    await back();
    // The trailing slash follows /sdcard, a link; names have spaces.
    const found = adb("shell", "find", "/sdcard/", "-name", `'*.${format}'`)
      .trim()
      .split("\n")
      .filter(Boolean);
    assert.ok(found.length, `no se guardó el .${format}`);
    const local = path.join(
      mkdtempSync(path.join(os.tmpdir(), "m1-")),
      `nota.${format}`
    );
    adb("pull", found[found.length - 1], local);
    return local;
  };

  const docx = await exported("docx", "Word (.docx)");
  const unzip = (entry) =>
    spawnSync(
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
      ["-xOf", docx, entry],
      { encoding: "utf8" }
    ).stdout;
  const documentXml = unzip("word/document.xml");
  const footnotesXml = unzip("word/footnotes.xml");
  console.log(
    "8. .docx:",
    JSON.stringify({
      author: documentXml.includes("Ana Perez"),
      heading: documentXml.includes("Idea central"),
      bsb: documentXml.includes("God works all things together"),
      footnote: /amó tanto al mundo/.test(footnotesXml)
    })
  );
  assert.ok(documentXml.includes("Ana Perez"), "la portada no tiene el nombre");
  assert.ok(documentXml.includes("God works all things together"));
  assert.match(footnotesXml, /amó tanto al mundo/);

  const pdf = await exported("pdf", "PDF");
  const head = readFileSync(pdf).subarray(0, 5).toString();
  console.log("9. PDF:", head, readFileSync(pdf).length, "bytes");
  assert.equal(head, "%PDF-");
} finally {
  cdp.close();
}

/** Android's folder picker: a folder the app may write to, then Allow. */
async function pickFolder() {
  await waitFor("USE THIS FOLDER", 30000);
  // Download and the storage root cannot be granted; Documents can.
  if (visibleText().includes("Can’t use this folder")) {
    await tap("Documents");
  }
  await tap("USE THIS FOLDER");
  await tap("ALLOW");
}

// --- A day of a reading plan ------------------------------------------------
// Back out of the note; the keyboard, if open, takes one press of its own.
for (let i = 0; i < 4 && !visibleText().includes("Buscar en Notas"); i++)
  await back();
await waitFor("Buscar en Notas");
await openSideMenu();
await tap("Planes de lectura");
await tap("reading-plan-start-nt90");
await waitFor("reading-day");
await tap("reading-show-text");
await waitFor("reading-text", 30000);
const reading = screen().find((node) => node.id === "reading-text");
console.log("10. plan, día 1:", reading.text.slice(0, 60));
assert.ok(reading.text.length > 200, "el texto del día salió vacío");
// Two chapters are long: scroll down to the buttons under them.
for (let i = 0; i < 15 && !screen().some((n) => n.id === "reading-day-read"); i++) {
  adb("shell", "input", "swipe", "540", "2000", "540", "400", "300");
  await sleep(800);
}
await tap("reading-day-read");
await waitFor("✓ Leído");
shot("study-6-plan");
await back();

// --- VBL with no network ----------------------------------------------------
await chooseTranslation(
  "Nueva Traducción Viviente (NTV)",
  "Versión Biblia Libre (VBL)"
);
adb("shell", "cmd", "connectivity", "airplane-mode", "enable");
try {
  await sleep(2000);
  await tap("buttons.add");
  await sleep(3000);
  cdp = await connectToEditor();
  const { $, waitUntil, tapOn, type, focusEnd } = editorTools(cdp);
  await waitUntil(
    `!!document.querySelector(".ProseMirror")?.editor`,
    "cargar el editor"
  );
  await focusEnd();
  await type("Salmo 23:1 ");
  await sleep(3000);
  await tapOn("span[data-scripture-ref]");
  await waitUntil(
    `(document.querySelector('[data-test-id="scripture-popover-text"]')?.textContent || "…") !== "…"`,
    "abrir el preview sin red"
  );
  const offline = await $(`({
    text: document.querySelector('[data-test-id="scripture-popover-text"]').textContent,
    attribution: document.querySelector('[data-test-id="scripture-popover-attribution"]').textContent
  })`);
  console.log("11. VBL sin red:", JSON.stringify(offline));
  assert.match(offline.attribution, /VBL/);
  assert.match(offline.text, /pastor/i);
  shot("study-7-vbl-offline");
  cdp.close();
} finally {
  adb("shell", "cmd", "connectivity", "airplane-mode", "disable");
}

console.log(
  "GREEN: en el emulador, un tema de A4, una nota desde plantilla, NTV con red y una referencia cruzada, un bloque comparado con BSB, el modo sermón, la nota en .docx y PDF, un día del plan y VBL sin red."
);
