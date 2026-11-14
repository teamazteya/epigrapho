// SPDX-License-Identifier: GPL-3.0-or-later
// A7 Fase 8 on a device: section titles on the phone.
//   1. Settings → Editor has no "Vista previa de versículos": on a touch
//      screen the panel is the only preview.
//   2. A tap on Juan 3:16 opens the panel with its section title, borrowed
//      from PdDpt, and the credit.
//   3. A Scripture Block of Juan 3:16 carries the same title and credit.
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
  visibleText,
  waitFor
} from "./device.mjs";

const PANEL = '[data-test-id="scripture-inline-preview"]';
const TITLE = "El amor de Dios";
const CREDIT = "VBL — CC BY-SA 4.0 · Títulos: PdDpt";

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

// --- 1. No setting on the phone --------------------------------------------
adb("shell", "input", "tap", "118", "191"); // the menu button in the search bar
await tap("sidemenu-settings-icon");
await tap("Ajustes");
await tap("Editor");
await waitFor("Versión Biblia Libre (VBL)", 15000);
assert.ok(
  !visibleText().includes("Vista previa de versículos"),
  "el ajuste aparece en el teléfono"
);
shot("a7-1-settings");
console.log("1. Ajustes → Editor no tiene «Vista previa de versículos»");
adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(1000);
adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(1000);
adb("shell", "input", "tap", "1000", "1200"); // outside the side menu
await sleep(1000);

await tap("buttons.add");
await sleep(3000);
const cdp = await connectToEditor();
const { $, waitUntil, tapOn, type, enter, focusEnd } = editorTools(cdp);
await waitUntil(
  `!!document.querySelector(".ProseMirror")?.editor`,
  "cargar el editor"
);

// --- 2. The panel ----------------------------------------------------------
await focusEnd();
await type("Juan 3:16 ");
await sleep(3000);
await tapOn('span[data-scripture-ref="JHN.3.16"]');
await waitUntil(
  `(document.querySelector('${PANEL} [data-test-id="scripture-popover-text"]')?.textContent || "…") !== "…"`,
  "abrir el panel"
);
const panel = await $(`(() => {
  const panel = document.querySelector('${PANEL}');
  return {
    text: panel.querySelector('[data-test-id="scripture-popover-text"]').textContent,
    attribution: panel.querySelector('[data-test-id="scripture-popover-attribution"]').textContent
  };
})()`);
console.log(
  "2. panel:",
  JSON.stringify({ ...panel, text: panel.text.slice(0, 60) })
);
assert.match(panel.text, new RegExp(`^${TITLE}\\s*16 “Porque Dios amó`));
assert.equal(panel.attribution, CREDIT);
shot("a7-2-panel");
await tapOn('span[data-scripture-ref="JHN.3.16"]');
await waitUntil(`!document.querySelector('${PANEL}')`, "cerrar el panel");

// --- 3. The block ----------------------------------------------------------
await focusEnd();
await enter();
await sleep(1000);
await tapOn('[data-test-id="insert-block"]');
await tapOn('[data-test-id="menu-button-scripture"]');
await waitUntil(
  `!!document.querySelector('[data-test-id="scripture-prompt-input"]')`,
  "abrir el diálogo del pasaje"
);
await tapOn('[data-test-id="scripture-prompt-input"]');
await type("Juan 3:16");
await tapOn('[data-test-id="scripture-prompt-confirm"]');
await waitUntil(
  `!!document.querySelector(".ProseMirror .scripture-block .scripture-block-text")?.textContent`,
  "insertar el bloque"
);
const block = await $(`(() => {
  const node = document.querySelector(".ProseMirror .scripture-block");
  return {
    text: node.querySelector(".scripture-block-text").textContent,
    attribution: node.querySelector(".scripture-block-attribution")?.textContent
  };
})()`);
console.log(
  "3. bloque:",
  JSON.stringify({ ...block, text: block.text.slice(0, 60) })
);
assert.match(block.text, new RegExp(`^${TITLE}\\s*16 “Porque Dios amó`));
assert.equal(block.attribution, CREDIT);
shot("a7-3-block");

cdp.close();
console.log(
  "GREEN: en el teléfono no hay ajuste de vista previa, y el panel y el bloque llevan el título de sección con su crédito."
);
