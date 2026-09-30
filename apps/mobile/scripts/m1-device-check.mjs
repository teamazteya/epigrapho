// SPDX-License-Identifier: GPL-3.0-or-later
// M1 on a device: the installed app, from a clean start, with nothing mocked.
//
// The native screens are driven with adb and read with uiautomator; the note
// editor is the WebView, reached over the DevTools protocol that debug builds
// expose, and driven with the same selectors as a1-mobile-parity-check.mjs.
// ponytail: Detox would need its own test APK and a second build; this drives
// the build that is already installed.
//
// Needs: an emulator or phone on adb with a debug build installed, and the
// dev server (npx react-native start) running for that build.
//
//   node scripts/m1-device-check.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = "tech.azteya.epigrapho";
const evidence = fileURLToPath(
  new URL("../../../../evidence/m1/", import.meta.url)
);
mkdirSync(evidence, { recursive: true });
const sdk =
  process.env.ANDROID_HOME ||
  path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
const ADB = path.join(
  sdk,
  "platform-tools",
  process.platform === "win32" ? "adb.exe" : "adb"
);

function adb(...args) {
  const result = spawnSync(ADB, args, {
    encoding: "utf8",
    maxBuffer: 64 << 20
  });
  if (result.status !== 0)
    throw new Error(`adb ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every node on screen with its text and centre. */
function screen() {
  const xml = adb("exec-out", "uiautomator", "dump", "/dev/tty");
  return [
    ...xml.matchAll(
      /<node [^>]*?text="([^"]*)" resource-id="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g
    )
  ].map(([, text, id, desc, x1, y1, x2, y2]) => ({
    text: text.replace(/&amp;/g, "&").replace(/&quot;/g, '"'),
    id,
    desc,
    x: (Number(x1) + Number(x2)) >> 1,
    y: (Number(y1) + Number(y2)) >> 1
  }));
}

async function waitFor(label, timeout = 60000) {
  const until = Date.now() + timeout;
  for (;;) {
    const found = screen().find(
      (node) => node.text === label || node.desc === label || node.id === label
    );
    if (found) return found;
    if (Date.now() > until) throw new Error(`no apareció «${label}»`);
    await sleep(1000);
  }
}

async function tap(label, timeout) {
  const node = await waitFor(label, timeout);
  adb("shell", "input", "tap", `${node.x}`, `${node.y}`);
  await sleep(1500);
}

function shot(name) {
  const png = spawnSync(ADB, ["exec-out", "screencap", "-p"], {
    maxBuffer: 64 << 20
  }).stdout;
  writeFileSync(path.join(evidence, `${name}.png`), png);
}

/** The page of the WebView that holds the note editor, over DevTools. */
async function connectToEditor() {
  const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
  for (const target of targets.filter((t) => t.type === "page")) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        pending.set(++id, (message) =>
          message.error
            ? reject(new Error(message.error.message))
            : resolve(message.result)
        );
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (exceptionDetails)
        throw new Error(
          exceptionDetails.exception?.description || exceptionDetails.text
        );
      return result.value;
    };
    if (await evaluate(`!!document.querySelector(".ProseMirror")`))
      return { send, evaluate, close: () => socket.close() };
    socket.close();
  }
  throw new Error("no encontré el editor en el WebView");
}

const visibleText = () =>
  screen()
    .map((node) => node.text)
    .join("\n");

// --- A clean start -------------------------------------------------------
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

await waitFor("Empezar", 180000);
assert.ok(
  !visibleText().includes("Ya tengo una cuenta"),
  "la intro ofrece iniciar sesión"
);
shot("device-1-intro");
await tap("Empezar");
await waitFor("Buscar en Notas");
assert.ok(
  !/Inicia sesión|Cambiar de plan|Crear cuenta/.test(visibleText()),
  "hay avisos de cuenta o de plan"
);
console.log("1. la intro entra directo a las notas, sin cuenta ni plan");

// --- The translation, chosen in Settings ----------------------------------
adb("shell", "input", "tap", "118", "191"); // the menu button in the search bar
await waitFor("sidemenu-settings-icon");
assert.ok(
  !visibleText().includes("Cambiar de plan"),
  "el menú lateral ofrece un plan"
);
await tap("sidemenu-settings-icon");
await tap("Ajustes");
assert.ok(
  !/Servidores|CUENTA/.test(visibleText()),
  "Ajustes muestra cuenta o servidores"
);
await tap("Editor");
await tap("Versión Biblia Libre (VBL)");
await tap("Berean Standard Bible (BSB)");
shot("device-2-translation");
adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(1000);
adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(1000);
adb("shell", "input", "tap", "1000", "1200"); // outside the side menu
await sleep(1000);
console.log("2. Ajustes → Editor → traducción principal: BSB");

// --- A note, in the WebView ----------------------------------------------
// The list's own hint: swiping left anywhere starts a note.
adb("shell", "input", "swipe", "900", "1200", "100", "1200", "250");
await sleep(3000);
const sockets = adb("shell", "cat", "/proc/net/unix")
  .split("\n")
  .map((line) => line.match(/@(webview_devtools_remote_\d+)/)?.[1])
  .filter(Boolean);
assert.ok(sockets.length, "el WebView no expone DevTools (¿build de debug?)");
adb("forward", "tcp:9333", `localabstract:${sockets.at(-1)}`);
// ponytail: Playwright's connectOverCDP needs browser-level commands an
// Android WebView does not have, so this speaks the protocol to the page
// directly: evaluate to read it, Input.* for real touches and typing.
const cdp = await connectToEditor();
try {
  const $ = (expression) => cdp.evaluate(expression);
  const waitUntil = async (expression, label, timeout = 30000) => {
    const until = Date.now() + timeout;
    while (!(await $(expression))) {
      if (Date.now() > until) throw new Error(`en el editor no pasó: ${label}`);
      await sleep(500);
    }
  };
  const tapOn = async (selector) => {
    // A person scrolls to what they want to tap; so does this.
    const box = await $(
      `(() => { const e = document.querySelector(${JSON.stringify(
        selector
      )}); if (!e) return; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`
    );
    assert.ok(box, `no está ${selector}`);
    const point = [{ x: box.x, y: box.y }];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: point
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });
    await sleep(800);
  };
  const type = async (text) => {
    for (const char of text) {
      await cdp.send("Input.insertText", { text: char });
      await sleep(40);
    }
  };
  const enter = async () => {
    for (const type of ["rawKeyDown", "char", "keyUp"])
      await cdp.send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        ...(type === "char" ? { text: String.fromCharCode(13) } : {})
      });
  };
  const focusEnd = () =>
    $(`document.querySelector(".ProseMirror").editor.commands.focus("end")`);

  await waitUntil(
    `!!document.querySelector(".ProseMirror")?.editor`,
    "cargar el editor"
  );
  await focusEnd();
  await type("Romanos 8:28 y Juan 3,16. ");
  await sleep(3000);

  const refs = await $(
    `[...document.querySelectorAll("span[data-scripture-ref]")].map((span) => [span.getAttribute("data-scripture-ref"), span.textContent])`
  );
  console.log("3. referencias:", JSON.stringify(refs));
  assert.deepEqual(refs, [
    ["ROM.8.28", "Romanos 8:28"],
    ["JHN.3.16", "Juan 3,16"]
  ]);

  await tapOn("span[data-scripture-ref]");
  await waitUntil(
    `(document.querySelector('[data-test-id="scripture-popover-text"]')?.textContent || "…") !== "…"`,
    "abrir el preview"
  );
  const preview = await $(`({
    text: document.querySelector('[data-test-id="scripture-popover-text"]').textContent,
    attribution: document.querySelector('[data-test-id="scripture-popover-attribution"]').textContent
  })`);
  console.log("4. preview:", JSON.stringify(preview));
  assert.match(preview.attribution, /^BSB/);
  assert.match(preview.text, /God works all things together for the good/);
  shot("device-3-preview");

  // The block, inserted from the editor's own menu, in the chosen translation.
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
  await type("Juan 3:36-4:2");
  await tapOn('[data-test-id="scripture-prompt-confirm"]');
  await waitUntil(
    `!!document.querySelector(".ProseMirror .scripture-block .scripture-block-text")?.textContent`,
    "insertar el bloque"
  );
  const inserted =
    await $(`(() => { const node = document.querySelector(".ProseMirror .scripture-block"); return {
    ref: node.getAttribute("data-scripture-ref"),
    translationId: node.getAttribute("data-translation-id"),
    text: node.querySelector(".scripture-block-text")?.textContent,
    attribution: node.querySelector(".scripture-block-attribution")?.textContent
  }; })()`);
  console.log(
    "5. bloque:",
    JSON.stringify({ ...inserted, text: inserted.text?.slice(0, 60) })
  );
  assert.equal(inserted.ref, "JHN.3.36-JHN.4.2");
  assert.equal(inserted.translationId, "BSB");
  assert.ok(
    inserted.text?.length > 100,
    "el rango entre capítulos salió corto"
  );
  assert.match(inserted.attribution, /^BSB/);
  shot("device-4-block");

  // --- A2, with no network at all (M1 Fase 4) ------------------------------
  adb("shell", "cmd", "connectivity", "airplane-mode", "enable");
  await sleep(2000);
  const insertFromMenu = async (item) => {
    await focusEnd();
    await enter();
    await sleep(800);
    await tapOn('[data-test-id="insert-block"]');
    await tapOn(`[data-test-id="menu-button-${item}"]`);
  };
  const interlinear = async (reference) => {
    await insertFromMenu("interlinear");
    await waitUntil(
      `!!document.querySelector('[data-test-id="interlinear-prompt-input"]')`,
      "abrir el diálogo del interlineal"
    );
    await tapOn('[data-test-id="interlinear-prompt-input"]');
    await type(reference);
    await tapOn('[data-test-id="interlinear-prompt-confirm"]');
  };
  const lastInterlinear = `(() => { const blocks = document.querySelectorAll(".ProseMirror .interlinear"); const block = blocks[blocks.length - 1]; const words = block ? [...block.querySelectorAll(".interlinear-word")] : []; return { count: words.length, dir: block && getComputedStyle(block.querySelector(".interlinear-word")?.parentElement ?? block).direction, first: words[0]?.querySelector(".interlinear-surface")?.textContent, lang: words[0]?.querySelector(".interlinear-surface")?.lang, credit: block?.querySelector(".interlinear-credit")?.textContent }; })()`;

  await interlinear("Juan 3:16");
  await waitUntil(
    `document.querySelectorAll(".ProseMirror .interlinear .interlinear-word").length > 0`,
    "mostrar el interlineal de Juan 3:16"
  );
  const john = await $(lastInterlinear);
  console.log("6. interlineal Juan 3:16:", JSON.stringify(john));
  assert.equal(john.count, 25);
  assert.equal(john.first, "οὕτως");
  assert.equal(john.lang, "grc");
  assert.match(john.credit, /STEP Bible/);

  await interlinear("Salmo 23:1");
  await waitUntil(
    `document.querySelectorAll(".ProseMirror .interlinear").length === 2 && document.querySelectorAll(".ProseMirror .interlinear")[1].querySelector(".interlinear-word")`,
    "mostrar el interlineal del Salmo"
  );
  const psalm = await $(lastInterlinear);
  console.log("7. interlineal Salmo 23:1:", JSON.stringify(psalm));
  assert.equal(psalm.lang, "he");
  assert.equal(psalm.dir, "rtl");
  shot("device-6-interlinear");

  // The lexicon, from a tap on a word, fits the phone's width.
  await $(
    `[...document.querySelectorAll(".interlinear-word")].find((w) => w.textContent.includes("ἠγάπησεν")).scrollIntoView({ block: "center" })`
  );
  await sleep(500);
  const loved = await $(
    `(() => { const w = [...document.querySelectorAll(".interlinear-word")].find((w) => w.textContent.includes("ἠγάπησεν")); w.dataset.m1 = "loved"; return true; })()`
  );
  assert.ok(loved);
  await tapOn('[data-m1="loved"]');
  await waitUntil(
    `!!document.querySelector('[data-test-id="lexicon-popover"] .lexicon-strong')`,
    "abrir el léxico"
  );
  const lexicon = await $(
    `(() => { const box = document.querySelector('[data-test-id="lexicon-popover"]'); const r = box.getBoundingClientRect(); return { strong: box.querySelector(".lexicon-strong").textContent, lemma: box.querySelector(".lexicon-lemma")?.textContent, fits: r.left >= 0 && r.right <= innerWidth + 1, background: getComputedStyle(box).backgroundColor }; })()`
  );
  console.log("8. léxico:", JSON.stringify(lexicon));
  assert.match(lexicon.strong, /G25/);
  assert.ok(lexicon.fits, "el léxico se sale de la pantalla");
  // Transparent once: the theme's colours did not reach what hangs off <body>.
  assert.notEqual(
    lexicon.background,
    "rgba(0, 0, 0, 0)",
    "el léxico no tiene fondo"
  );
  shot("device-7-lexicon");

  await tapOn('[data-test-id="lexicon-concordance"]');
  await waitUntil(
    `!!document.querySelector('[data-test-id="concordance-total"]')`,
    "abrir la concordancia"
  );
  const fromLexicon = await $(
    `({ input: document.querySelector('[data-test-id="concordance-input"]').value, total: document.querySelector('[data-test-id="concordance-total"]').textContent })`
  );
  console.log("9. concordancia desde el léxico:", JSON.stringify(fromLexicon));
  assert.equal(fromLexicon.input, "G25");
  assert.notEqual(
    await $(
      `getComputedStyle(document.querySelector('[data-test-id="concordance-pane"]')).backgroundColor`
    ),
    "rgba(0, 0, 0, 0)",
    "la concordancia no tiene fondo"
  );
  assert.match(fromLexicon.total, /apariciones según STEPBible TAGNT/);

  await $(
    `(() => { const input = document.querySelector('[data-test-id="concordance-input"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, ""); input.dispatchEvent(new Event("input", { bubbles: true })); })()`
  );
  await tapOn('[data-test-id="concordance-input"]');
  await type("G26");
  await enter();
  await waitUntil(
    `document.querySelector('[data-test-id="concordance-total"]')?.textContent.startsWith("116")`,
    "contar G26"
  );
  const g26 = await $(
    `({ total: document.querySelector('[data-test-id="concordance-total"]').textContent, books: [...document.querySelectorAll('[data-test-id="concordance-book"] > button')].map((b) => b.textContent) })`
  );
  console.log("10. G26:", g26.total, JSON.stringify(g26.books.slice(0, 3)));
  assert.equal(g26.total, "116 apariciones según STEPBible TAGNT");
  assert.equal(
    g26.books.reduce((sum, b) => sum + Number(/\((\d+)\)$/.exec(b)[1]), 0),
    116
  );
  shot("device-8-concordance");
  // Above 40 occurrences the books start closed, as on the desktop.
  await tapOn('[data-test-id="concordance-book"] > button');
  await waitUntil(
    `!!document.querySelector('[data-test-id="concordance-occurrence"]')`,
    "abrir un libro"
  );
  await tapOn('[data-test-id="concordance-occurrence"]');
  await waitUntil(
    `!document.querySelector('[data-test-id="concordance-pane"]')`,
    "cerrar la concordancia al insertar"
  );

  // A dictionary entry, picked from the "+" menu: Rand's Betel.
  await insertFromMenu("dictionaryEntry");
  await waitUntil(
    `!!document.querySelector('[data-test-id="dictionary-input"]')`,
    "abrir el diccionario"
  );
  await tapOn('[data-test-id="dictionary-input"]');
  await type("Betel");
  await enter();
  await waitUntil(
    `!!document.querySelector('[data-entry-id="RAND:betel"]')`,
    "encontrar Betel en Rand"
  );
  await tapOn('[data-entry-id="RAND:betel"] button');
  await waitUntil(
    `!!document.querySelector('[data-entry-id="RAND:betel"] [data-test-id="dictionary-article"]')`,
    "abrir el artículo"
  );
  shot("device-9-dictionary");
  await tapOn(
    '[data-entry-id="RAND:betel"] [data-test-id="dictionary-insert"]'
  );
  await waitUntil(
    `!!document.querySelector(".ProseMirror .dictionary-entry .dictionary-entry-credit")?.textContent.trim()`,
    "insertar la entrada"
  );
  const entry = await $(
    `(() => { const e = document.querySelector(".ProseMirror .dictionary-entry"); return { id: e.getAttribute("data-dictionary-entry") || e.closest("[data-dictionary-entry]")?.getAttribute("data-dictionary-entry"), text: e.textContent.slice(0, 80), credit: e.querySelector(".dictionary-entry-credit").textContent }; })()`
  );
  console.log("11. entrada de diccionario:", JSON.stringify(entry));
  assert.match(entry.text, /Betel/i);
  assert.match(entry.credit, /Rand/);
  shot("device-10-entry");
} finally {
  adb("shell", "cmd", "connectivity", "airplane-mode", "disable");
  cdp.close();
  adb("forward", "--remove", "tcp:9333");
}

// --- One note, not two ------------------------------------------------------
// Back until the list shows: the first press may only close the keyboard.
for (
  let i = 0;
  i < 3 && !screen().some((node) => node.text === "Buscar en Notas");
  i++
) {
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await sleep(2000);
}
await waitFor("Buscar en Notas");
const titles = screen().filter((node) => /Romanos 8:28/.test(node.text));
console.log("12. notas en la lista con el texto:", titles.length);
assert.equal(titles.length, 1, "escribir creó más de una nota");
shot("device-5-list");

console.log(
  "GREEN: en el emulador, sin cuenta ni plan, la traducción elegida en Ajustes llega al editor (referencias, preview y bloque entre capítulos en BSB), y sin red funcionan el interlineal (griego y hebreo), el léxico, la concordancia y el diccionario; una sola nota."
);
