// SPDX-License-Identifier: GPL-3.0-or-later
// A6 Fase 2 on a device: the verse preview opens in the note, under the
// paragraph, and a whole passage is read by swiping the note, with the
// keyboard open and closed, without the panel closing. The old floating box
// closed on the first swipe inside it (pointercancel, then pointerleave).
//
// Needs the emulator (or a phone) with the debug build installed and the dev
// server (npx react-native start) running for it.
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

const PANEL = '[data-test-id="scripture-inline-preview"]';

adb("shell", "pm", "clear", APP);
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
await waitFor("welcome-enter", 180000);
await tap("welcome-enter");
await waitFor("Buscar en Notas");
await tap("buttons.add");
await sleep(3000);

const cdp = await connectToEditor();
const { $, waitUntil, tapOn, type, focusEnd } = editorTools(cdp);
await waitUntil(
  `!!document.querySelector(".ProseMirror")?.editor`,
  "cargar el editor"
);
await focusEnd();
await type("Salmo 119:1-40 ");
await sleep(3000);

// --- A tap opens the whole passage under the paragraph ---------------------
await tapOn("span[data-scripture-ref]");
await waitUntil(
  `(document.querySelector('${PANEL} [data-test-id="scripture-popover-text"]')?.textContent || "…") !== "…"`,
  "abrir el panel"
);
const opened = await $(`(() => {
  const panel = document.querySelector('${PANEL}');
  const text = panel.querySelector(".scripture-popover-text");
  return {
    under: panel.previousElementSibling?.tagName,
    label: panel.getAttribute("aria-label"),
    verses: (text.textContent.match(/\\d+/g) || []).length,
    innerScroll: text.scrollHeight > text.clientHeight + 1,
    taller: panel.getBoundingClientRect().height > innerHeight
  };
})()`);
console.log("1. panel:", JSON.stringify(opened));
assert.equal(opened.under, "P");
assert.equal(opened.label, "Salmo 119:1-40");
assert.ok(!opened.innerScroll, "el texto tiene su propio scroll");
assert.ok(opened.taller, "el pasaje no es más alto que la pantalla");
shot("a6-1-panel");

// --- Read it by swiping the note -------------------------------------------
const [width, height] = adb("shell", "wm", "size")
  .match(/(\d+)x(\d+)/)
  .slice(1)
  .map(Number);
const keyboardShown = () =>
  /mInputShown=true/.test(adb("shell", "dumpsys", "input_method"));
const swipe = (from, to) =>
  adb(
    "shell",
    "input",
    "swipe",
    `${width >> 1}`,
    `${Math.round(height * from)}`,
    `${width >> 1}`,
    `${Math.round(height * to)}`,
    "400"
  );
const panelEdge = (edge) =>
  $(`(() => {
    const r = document.querySelector('${PANEL}')?.getBoundingClientRect();
    return r ? ${
      edge === "bottom" ? "r.bottom <= innerHeight" : "r.top >= 0"
    } : null;
  })()`);
/** Swipes until the panel's other end is in sight; it must stay open. */
async function readThrough(down, label) {
  for (let i = 0; i < 40; i++) {
    const seen = await panelEdge(down ? "bottom" : "top");
    assert.notEqual(seen, null, `el panel se cerró al deslizar (${label})`);
    if (seen) return i;
    // Over the text: with the keyboard open, 0.6 of the screen is the toolbar.
    down ? swipe(0.45, 0.2) : swipe(0.2, 0.45);
    await sleep(700);
  }
  throw new Error(`no llegué al final del panel (${label})`);
}

assert.ok(keyboardShown(), "el teclado no está abierto");
const downSwipes = await readThrough(true, "teclado abierto");
console.log(`2. leído hacia abajo con teclado: ${downSwipes} deslizamientos`);
shot("a6-2-read-keyboard");

adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(1000);
assert.ok(!keyboardShown(), "el teclado no se cerró");
const upSwipes = await readThrough(false, "teclado cerrado");
console.log(`3. leído hacia arriba sin teclado: ${upSwipes} deslizamientos`);
assert.ok(await $(`!!document.querySelector('${PANEL}')`), "el panel se cerró");
shot("a6-3-read-no-keyboard");

// --- Another reference moves it; "Ver también" inserts -------------------
// Cross references are per verse, so a range has none.
await focusEnd();
await type(" Juan 3:16 ");
await sleep(3000);
const JOHN = 'span[data-scripture-ref="JHN.3.16"]';
await tapOn(JOHN);
await waitUntil(
  `document.querySelectorAll('${PANEL}').length === 1 && document.querySelector('${PANEL}').getAttribute("aria-label") === "Juan 3:16"`,
  "mover el panel a la otra referencia"
);
await waitUntil(
  `!!document.querySelector('${PANEL} .scripture-popover-see-also-list button')`,
  "cargar las referencias cruzadas"
);
await tapOn(`${PANEL} .scripture-popover-see-also-list button`);
await waitUntil(
  `[...document.querySelectorAll(".ProseMirror p")].some((p) => p.textContent.includes("Juan 3:16; "))`,
  "insertar la referencia cruzada"
);
console.log(
  "4. ver también:",
  await $(
    `[...document.querySelectorAll(".ProseMirror p")].find((p) => p.textContent.includes("Juan 3:16; ")).textContent`
  )
);
shot("a6-4-see-also");

// --- A second tap on the reference closes it -------------------------------
await tapOn(JOHN);
await waitUntil(`!document.querySelector('${PANEL}')`, "cerrar con otro toque");
console.log("5. otro toque lo cierra");

cdp.close();
console.log(
  "GREEN: el pasaje se abre bajo el párrafo, se lee deslizando con y sin teclado, otra referencia lo mueve, «Ver también» inserta y otro toque lo cierra."
);
