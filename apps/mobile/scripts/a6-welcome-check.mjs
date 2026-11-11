// SPDX-License-Identifier: GPL-3.0-or-later
// A6 Fase 9 on a device: a new install opens the welcome center, with
// "Don't show again" checked; its nine pages and seventeen captures, in
// Spanish and in English; the index and the enlarged capture; Close with the
// box unchecked brings it back on the next start, checked does not; "Create my
// first note" opens the editor; Settings → Help and support → Welcome center
// opens it again.
//
// Needs the emulator (or a phone) with the debug build installed and the dev
// server (npx react-native start) running for it.
//   node scripts/a6-welcome-check.mjs
import assert from "node:assert/strict";
import {
  adb,
  APP,
  connectToEditor,
  editorTools,
  screen,
  shot,
  sleep,
  tap,
  waitFor
} from "./device.mjs";

const COPY = {
  es: {
    count: (page) => `${page} de 9`,
    titles: [
      "Escribe. Estudia. Conecta las Escrituras.",
      "Una referencia abre todo un pasaje.",
      "Conecta pasajes. Compara traducciones.",
      "Consulta una palabra sin abandonar tu estudio.",
      "Acércate a las palabras del texto original.",
      "Haz espacio para leer cada día.",
      "Del primer apunte a una enseñanza preparada.",
      "Hazlo tuyo. Llévalo contigo.",
      "Tus notas, bajo tu control."
    ],
    index: "Explorar las 9 páginas",
    search: "Buscar en Notas",
    settings: "Ajustes",
    help: "Ayuda y soporte",
    center: "Centro de bienvenida"
  },
  en: {
    count: (page) => `${page} of 9`,
    titles: [
      "Write. Study. Connect the Scriptures.",
      "A reference opens a whole passage.",
      "Connect passages. Compare translations.",
      "Look up a word without leaving your study.",
      "Come closer to the words of the original text.",
      "Make room to read every day.",
      "From a first draft to a prepared teaching.",
      "Make it yours. Take it with you.",
      "Your notes, under your control."
    ],
    index: "Explore the 9 pages",
    search: "Search in Notes",
    settings: "Settings",
    help: "Help and support",
    center: "Welcome center"
  }
};

const launch = () =>
  adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1");
async function restart() {
  adb("shell", "am", "force-stop", APP);
  await sleep(1000);
  launch();
}
const back = async () => {
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await sleep(1000);
};
const has = (label) => screen().some((node) => node.id === label || node.text === label);

/** Waits for the list or the welcome center, whichever the app opens on. */
async function opens(copy) {
  const until = Date.now() + 180000;
  for (;;) {
    const nodes = screen();
    if (nodes.some((node) => node.id === "welcome-count")) return true;
    if (nodes.some((node) => node.text === copy.search)) {
      // The welcome center is the first screen or none: give it a moment.
      await sleep(3000);
      return has("welcome-count");
    }
    if (Date.now() > until) throw new Error("la app no abrió");
    await sleep(1000);
  }
}

/** Scrolls the page down (or up) until `label` shows. */
async function reach(label, up = false) {
  const [from, to] = up ? ["800", "1500"] : ["1500", "800"];
  for (let i = 0; i < 6 && !has(label); i++) {
    adb("shell", "input", "swipe", "540", from, "540", to, "400");
    await sleep(800);
  }
  return waitFor(label, 5000);
}

const checked = async () => {
  await reach("welcome-dont-show");
  const xml = adb("exec-out", "uiautomator", "dump", "/dev/tty");
  const node = xml.match(/<node [^>]*resource-id="welcome-dont-show"[^>]*>/)?.[0];
  assert.ok(node, "no se ve la casilla");
  return / checked="true"/.test(node);
};
const text = (id) => screen().find((node) => node.id === id)?.text;

/** Every page and capture, with Next. Returns the captures it saw. */
async function walk(copy) {
  await reach("welcome-index", true);
  // A screen reader says the label only, not the chevron's glyph.
  assert.equal(screen().find((node) => node.id === "welcome-index").desc, copy.index);
  await tap("welcome-index");
  await tap("welcome-step-1");
  const seen = [];
  for (let step = 1; step <= 9; step++) {
    await waitFor(copy.count(step));
    assert.equal(text("welcome-title"), copy.titles[step - 1], `título de la página ${step}`);
    await reach("welcome-zoom");
    const shots = screen()
      .filter((node) => node.id.startsWith("welcome-shot-"))
      .map((node) => node.id);
    for (const id of shots.length ? shots : [null]) {
      if (id) await tap(id);
      // The enlarge button names the capture; the image inside is part of it.
      const capture = screen().find((node) => node.id === "welcome-zoom");
      assert.ok(capture?.desc, `la captura de la página ${step} no tiene descripción`);
      seen.push(`${step}:${id ?? ""}:${capture.desc}`);
    }
    if (step < 9) await tap("welcome-next");
  }
  await waitFor("welcome-first-note");
  return seen;
}

/** Settings → Help and support → Welcome center. */
async function fromHelp(copy) {
  adb("shell", "input", "tap", "118", "191"); // the menu button in the search bar
  await tap("sidemenu-settings-icon");
  await tap(copy.settings);
  // "Help and support" heads a group of the list; the entry sits under it.
  await reach(copy.help.toUpperCase());
  await reach(copy.center);
  await tap(copy.center);
  await waitFor("welcome-count");
}

adb("shell", "pm", "clear", APP);
adb("reverse", "tcp:8081", "tcp:8081");

// ---- 1. A new install opens it, with the box checked. ----
launch();
assert.equal(await opens(COPY.es), true, "una instalación nueva muestra el centro");
assert.equal(await checked(), true);
const es = await walk(COPY.es);
assert.equal(es.length, 17, es.join("\n"));
assert.equal(new Set(es.map((seen) => seen.split(":").slice(2).join(":"))).size, 17, "capturas repetidas");
shot("a6-welcome-1-es");
console.log("1. instalación nueva: se muestra; 9 páginas y 17 capturas en español");

// ---- 2. The index jumps to a page; the enlarged capture closes with Back. ----
await reach("welcome-index", true);
  await tap("welcome-index");
await tap("welcome-step-5");
await waitFor(COPY.es.count(5));
await reach("welcome-zoom");
await tap("welcome-zoom");
await waitFor("welcome-zoom-close");
await back();
assert.equal(has("welcome-zoom-close"), false);
assert.equal(has(COPY.es.count(5)), true);
console.log("2. el índice lleva a la página 5; la captura ampliada se cierra con Atrás");

// ---- 3. Unchecked and closed: back on the next start, unchecked. ----
await reach("welcome-dont-show");
await reach("welcome-dont-show");
await tap("welcome-dont-show");
assert.equal(await checked(), false);
await tap("welcome-close");
await waitFor(COPY.es.search);
await restart();
assert.equal(await opens(COPY.es), true, "desmarcado, vuelve a mostrarse");
await reach("welcome-dont-show");
assert.equal(await checked(), false);
console.log("3. desmarcado y cerrado: vuelve al reiniciar, con la casilla desmarcada");

// ---- 4. Checked, "Create my first note": the editor opens; not again. ----
await reach("welcome-dont-show");
await tap("welcome-dont-show");
assert.equal(await checked(), true);
await reach("welcome-index", true);
  await tap("welcome-index");
await tap("welcome-step-9");
await tap("welcome-first-note");
await sleep(3000); // the editor's WebView starts after the screen opens
const cdp = await connectToEditor();
const { waitUntil } = editorTools(cdp);
await waitUntil(`!!document.querySelector(".ProseMirror")?.editor`, "abrir la primera nota");
cdp.close?.();
await restart();
assert.equal(await opens(COPY.es), false, "marcado, no vuelve");
console.log("4. «Crear mi primera nota» abre el editor; marcado, no vuelve al reiniciar");

// ---- 5. Help → Welcome center opens it, checked; Close keeps the answer. ----
await fromHelp(COPY.es);
await reach("welcome-dont-show");
assert.equal(await checked(), true);
await tap("welcome-close");
await waitFor(COPY.es.center);
await restart();
assert.equal(await opens(COPY.es), false, "abierto desde Ayuda, sigue sin volver solo");
console.log("5. Ajustes → Ayuda y soporte → Centro de bienvenida lo abre; cerrar no cambia la respuesta");

// ---- 6. In English: the same pages, with the English captures. ----
adb("shell", "input", "tap", "118", "191");
await tap("sidemenu-settings-icon");
await tap(COPY.es.settings);
await tap("Apariencia");
await tap("Español (México)");
await tap("English (US)");
await restart();
assert.equal(await opens(COPY.en), false);
await fromHelp(COPY.en);
const en = await walk(COPY.en);
assert.equal(en.length, 17, en.join("\n"));
assert.deepEqual(
  en.map((seen) => seen.split(":").slice(0, 2).join(":")),
  es.map((seen) => seen.split(":").slice(0, 2).join(":"))
);
shot("a6-welcome-6-en");
await tap("welcome-close");
console.log("6. en inglés: 9 páginas y 17 capturas, las mismas vistas");

console.log("GREEN: el centro de bienvenida del teléfono se muestra, se cierra y se recuerda como se acordó.");
process.exit(0);
