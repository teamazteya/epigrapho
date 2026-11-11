// SPDX-License-Identifier: GPL-3.0-or-later
// The real Android captures of the welcome center (A6 Fase 9): the app on the
// emulator, cleared, with sample notes, in Spanish and in English, saved as
// 540-wide WebP in apps/mobile/app/assets/welcome/<es|en>/. After
// work/mockups/capture-android-*.mjs. Nothing is published and no account is
// used. Needs the emulator with the debug build and its dev server
// (npx react-native start in apps/mobile):
// node scripts/welcome-captures-android.mjs [es|en]
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import {
  adb,
  APP,
  connectToEditor,
  editorTools,
  screen,
  sleep,
  tap,
  waitFor
} from "../../mobile/scripts/device.mjs";

const output = fileURLToPath(
  new URL("../../mobile/app/assets/welcome/", import.meta.url)
);

/** What the app says in each language, where a step looks for it. */
const COPY = {
  es: {
    search: "Buscar en Notas",
    settings: "Ajustes",
    appearance: "Apariencia",
    themes: "Temas",
    plans: "Planes de lectura",
    properties: "Propiedades",
    reference: "Juan 3:16",
    verse: "Porque",
    compare: "BSB",
    word: "gracia",
    section: "biblical",
    title: "El amor que permanece",
    body: "<h2>Una lectura sobre el amor</h2><p>Observamos lo que este pasaje revela sobre el amor de Dios y nuestra respuesta.</p><h3>Para conversar</h3><ul><li>Dios toma la iniciativa.</li><li>El amor se expresa en lo que da.</li></ul><p>Pasaje principal: </p>",
    other: "Preguntas para el grupo",
    otherBody: "<h2>Preguntas para nuestra conversación</h2><p>¿Qué llama tu atención al leer el pasaje completo?</p><p>¿Cómo explica Juan la relación entre el amor y la vida?</p>"
  },
  en: {
    search: "Search in Notes",
    settings: "Settings",
    appearance: "Appearance",
    themes: "Themes",
    plans: "Reading plans",
    properties: "Properties",
    reference: "John 3:16",
    verse: "For God",
    compare: "KJV",
    word: "grace",
    section: "english",
    title: "Love that remains",
    body: "<h2>A reading on love</h2><p>We notice what this passage shows about God's love and our response.</p><h3>To talk about</h3><ul><li>God takes the first step.</li><li>Love shows in what it gives.</li></ul><p>Main passage: </p>",
    other: "Questions for the group",
    otherBody: "<h2>Questions for our conversation</h2><p>What stands out to you when you read the whole passage?</p><p>How does John relate love and life?</p>"
  }
};

const languages = process.argv[2] ? [process.argv[2]] : ["es", "en"];
const back = async (times = 1) => {
  for (let i = 0; i < times; i++) {
    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await sleep(1000);
  }
};
const keyboardShown = () =>
  /mInputShown=true/.test(adb("shell", "dumpsys", "input_method"));
/** Back until the notes list shows, without leaving the app. */
const toList = async (copy) => {
  for (let i = 0; i < 5 && !screen().some((node) => node.text === copy.search); i++)
    await back();
  await waitFor(copy.search);
};
const launch = () =>
  adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1");
const openSideMenu = async () => {
  adb("shell", "input", "tap", "118", "191"); // the menu button in the search bar
  await waitFor("sidemenu-settings-icon");
};
const closeSideMenu = async () => {
  adb("shell", "input", "tap", "1000", "1200");
  await sleep(1000);
};
const openSettings = async (copy) => {
  await openSideMenu();
  await tap("sidemenu-settings-icon");
  await tap(copy.settings);
};

/** The headless Chromium Playwright installed, to encode WebP. */
function headlessShell() {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const shell = readdirSync(root)
    .filter((name) => name.startsWith("chromium_headless_shell-"))
    .sort()
    .pop();
  return path.join(root, shell, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
}

const browser = await chromium.launch({ executablePath: headlessShell() });
const encoder = await browser.newPage();

async function capture(language) {
  const copy = COPY[language];
  const folder = path.join(output, language);
  await mkdir(folder, { recursive: true });

  /** The whole screen, halved, as WebP. */
  async function shot(name) {
    // The native window can lag behind what DevTools already reports.
    await sleep(2200);
    const png = spawnSync(
      path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk", "platform-tools", "adb.exe"),
      ["exec-out", "screencap", "-p"],
      { maxBuffer: 64 << 20 }
    ).stdout;
    const webp = await encoder.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 540;
      canvas.height = Math.round((image.naturalHeight * 540) / image.naturalWidth);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", 0.8).split(",")[1];
    }, png.toString("base64"));
    await writeFile(path.join(folder, `${name}.webp`), Buffer.from(webp, "base64"));
    console.log(`${language}/${name}.webp`);
  }

  adb("shell", "pm", "clear", APP);
  adb("reverse", "tcp:8081", "tcp:8081");
  launch();
  await tap("welcome-enter", 240000);
  await waitFor(COPY.es.search);
  if (language === "en") {
    // The interface language applies after a restart; the main translation
    // becomes BSB, as an English speaker would choose.
    await openSettings(COPY.es);
    await tap(COPY.es.appearance);
    await tap("Español (México)");
    await tap("English (US)");
    await back(2);
    await closeSideMenu();
    await openSettings(COPY.es);
    await tap("Editor");
    await tap("Versión Biblia Libre (VBL)");
    await tap("Berean Standard Bible (BSB)");
    adb("shell", "am", "force-stop", APP);
    await sleep(1000);
    launch();
    await waitFor(copy.search, 180000);
  }

  /** A new note with a title and a body; the editor stays open. */
  async function note(title, body) {
    await tap("buttons.add");
    await sleep(3000);
    const cdp = await connectToEditor();
    const tools = editorTools(cdp);
    await tools.waitUntil(`!!document.querySelector(".ProseMirror")?.editor`, "cargar el editor");
    await tools.tapOn("#editor-title");
    await cdp.send("Input.insertText", { text: title });
    await tools.$(
      `document.querySelector(".ProseMirror").editor.commands.setContent(${JSON.stringify(body)})`
    );
    return { cdp, ...tools };
  }
  const hideKeyboard = async ($) => {
    await $(`document.activeElement?.blur()`);
    await sleep(1600);
  };

  // --- The second note first, so the list shows two -------------------------
  let { cdp, focusEnd: end, type: typeIn } = await note(copy.other, copy.otherBody);
  // A keystroke saves the note, as a person's would.
  await end();
  await typeIn(" ");
  await sleep(1500);
  cdp.close();
  await back(2);
  await waitFor(copy.search);

  // --- The note, its reference and the passage ------------------------------
  const tools = await note(copy.title, copy.body);
  cdp = tools.cdp;
  const { $, tapOn, type, focusEnd, waitUntil, insertFromMenu } = tools;
  await focusEnd();
  await type(`${copy.reference} `);
  await hideKeyboard($);
  await $(`window.scrollTo(0, 0)`);
  await shot("01-editor");

  const REF = 'span[data-scripture-ref="JHN.3.16"]';
  const PANEL = '[data-test-id="scripture-inline-preview"]';
  await tapOn(REF);
  await waitUntil(
    `document.querySelector('${PANEL} [data-test-id="scripture-popover-text"]')?.textContent.includes(${JSON.stringify(copy.verse)})`,
    "texto del pasaje"
  );
  await waitUntil(
    `!!document.querySelector('${PANEL} .scripture-popover-see-also-list button')`,
    "referencias cruzadas"
  );
  // The tap put the caret in the note: the keyboard closes, the passage stays.
  if (keyboardShown()) await back();
  const top = `document.querySelector("#editor-title").scrollIntoView({ block: "start" })`;
  await $(top);
  await shot("02-preview");
  await tapOn(`${PANEL} [data-test-id="scripture-popover-see-all"]`);
  if (keyboardShown()) await back();
  await $(
    `document.querySelector('${PANEL} [data-test-id="scripture-popover-see-also"]').scrollIntoView({ block: "center" })`
  );
  await shot("03-crossReferences");
  await tapOn(REF);
  await waitUntil(`!document.querySelector('${PANEL}')`, "cerrar el pasaje");

  // --- A Scripture block, then two translations side by side ----------------
  await insertFromMenu("scripture");
  await tapOn('[data-test-id="scripture-prompt-input"]');
  await type(copy.reference);
  await tapOn('[data-test-id="scripture-prompt-confirm"]');
  await waitUntil(
    `!!document.querySelector(".ProseMirror .scripture-block .scripture-block-text")?.textContent`,
    "bloque de Escritura"
  );
  await hideKeyboard($);
  await $(`document.querySelector(".scripture-block").scrollIntoView({ block: "center" })`);
  await shot("02-block");
  await tapOn(".ProseMirror .scripture-block [data-scripture-compare]");
  await tapOn(`[data-test-id="compare-prompt-${copy.compare}"]`);
  await waitUntil(
    `!!document.querySelector('.scripture-block-parallel[data-translation-id="${copy.compare}"] .scripture-block-text')?.textContent`,
    "comparación"
  );
  if (await $(`!!document.querySelector("dialog.scripture-prompt[open]")`))
    await tapOn('[data-test-id="compare-prompt-cancel"]');
  await hideKeyboard($);
  await $(`document.querySelector(".scripture-block").scrollIntoView({ block: "center" })`);
  await shot("03-parallel");

  // --- Interlinear, lexicon and concordance ---------------------------------
  await insertFromMenu("interlinear");
  await tapOn('[data-test-id="interlinear-prompt-input"]');
  await type(copy.reference);
  await tapOn('[data-test-id="interlinear-prompt-confirm"]');
  await waitUntil(`!!document.querySelector(".interlinear-word")`, "interlineal");
  await hideKeyboard($);
  await $(`document.querySelector(".interlinear").scrollIntoView({ block: "start" })`);
  await shot("05-interlinear");
  await $(
    `[...document.querySelectorAll(".interlinear-word")].find((w) => w.getAttribute("aria-label")?.startsWith("ἠγάπησεν")).dataset.capture = "word"`
  );
  await tapOn('[data-capture="word"]');
  await waitUntil(
    `!!document.querySelector('[data-test-id="lexicon-popover"] .lexicon-strong')`,
    "léxico"
  );
  await shot("05-lexicon");
  await tapOn('[data-test-id="lexicon-concordance"]');
  await waitUntil(`!!document.querySelector('[data-test-id="concordance-pane"]')`, "concordancia");
  await shot("05-concordance");
  if (await $(`!!document.querySelector('[data-test-id="study-close"]')`))
    await tapOn('[data-test-id="study-close"]');

  // --- The dictionary --------------------------------------------------------
  const PANE = '[data-test-id="dictionary-pane"]';
  await insertFromMenu("dictionaryEntry");
  await waitUntil(`!!document.querySelector('${PANE}')`, "abrir el diccionario");
  await tapOn(`${PANE} [data-test-id="dictionary-input"]`);
  await type(copy.word);
  await $(`document.querySelector('${PANE} [data-test-id="dictionary-input"]')
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  const HIT = `${PANE} [data-test-id="dictionary-section-${copy.section}"] [data-test-id="dictionary-hit"] button`;
  await waitUntil(`!!document.querySelector('${HIT}')`, `buscar ${copy.word}`, 180000);
  await hideKeyboard($);
  await tapOn(HIT);
  await sleep(1500);
  await $(
    `document.querySelector('${PANE} [data-test-id="dictionary-section-${copy.section}"]').scrollIntoView({ block: "start" })`
  );
  await shot("04-dictionary");
  if (await $(`!!document.querySelector('[data-test-id="study-close"]')`))
    await tapOn('[data-test-id="study-close"]');
  await $(top);

  // --- From the note's properties: sermon mode, export and share ------------
  const openProperties = async () => {
    await $(
      `(() => { const row = [...document.querySelectorAll("#header > div button")].filter((b) => !b.closest('[role="menu"]')); row[row.length - 1].dataset.capture = "menu"; })()`
    );
    await tapOn('[data-capture="menu"]');
    await $(
      `[...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.includes(${JSON.stringify(copy.properties)})).dataset.capture = "properties"`
    );
    await tapOn('[data-capture="properties"]');
  };
  await openProperties();
  await tap("icon-sermon-mode");
  await waitUntil(`!!document.querySelector("dialog.sermon-mode[open] .sermon-mode-text")`, "modo sermón");
  await $(`document.querySelectorAll("dialog.sermon-mode, dialog.sermon-mode *").forEach((e) => (e.scrollTop = 0))`);
  await shot("07-sermon");
  await tapOn('[data-test-id="sermon-exit"]');
  await waitUntil(`!document.querySelector("dialog.sermon-mode[open]")`, "salir del modo sermón");
  await openProperties();
  await tap("icon-export");
  await shot("08-export");
  await back();
  await openProperties();
  await tap("icon-publish");
  await shot("09-share");
  cdp.close();
  await back();
  await toList(copy);

  // --- The notes list and its templates --------------------------------------
  await shot("01-notes");
  await tap("new-note-from-template");
  await shot("07-templates");
  await back();

  // --- A reading plan --------------------------------------------------------
  await openSideMenu();
  await tap(copy.plans);
  await tap("reading-plan-start-nt90");
  await waitFor("reading-day");
  await shot("06-plan");
  await tap("reading-show-text");
  await waitFor("reading-text");
  await shot("06-reading");
  await back();

  // --- The themes --------------------------------------------------------------
  await openSettings(copy);
  await tap(copy.appearance);
  await tap(copy.themes);
  await shot("08-themes");
}

try {
  for (const language of languages) await capture(language);
} catch (error) {
  console.error(
    JSON.stringify(screen().filter((node) => node.text || node.id).map((node) => node.id || node.text))
  );
  throw error;
} finally {
  await browser.close();
}
