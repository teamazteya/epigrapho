// SPDX-License-Identifier: GPL-3.0-or-later
// A6 Fase 6 on a device: the weekly Wiktionary copy. On mobile data it does
// not download on its own, the button does; a copy with a wrong hash leaves
// the one in use; on Wi-Fi it downloads on its own; and the note editor
// reads the new copy.
//
// A local server stands in for the latest release of
// teamazteya/epigrapho-datos: a debug build reads its address from
// files/wiktionary-datos-url. WIKT_DIR holds its manifest.json and wikt.zip,
// a copy newer than the app's own.
//
// Needs the emulator with the debug build installed and the dev server
// (npx react-native start) running for it.
//   WIKT_DIR=<folder> node scripts/a6-wiktionary-check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
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

const dir = process.env.WIKT_DIR;
assert.ok(dir, "WIKT_DIR: la carpeta con manifest.json y wikt.zip");
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json")));
const zip = readFileSync(path.join(dir, "wikt.zip"));

let wrongHash = false;
const served = [];
const server = createServer((request, response) => {
  // React Native's fetch adds ?_=<time> for cache: "no-store".
  const url = request.url.split("?")[0];
  served.push(url);
  if (url === "/manifest.json") {
    const body = wrongHash
      ? { ...manifest, date: "2099-01-01", source: "otra", sha256: "0".repeat(64) }
      : manifest;
    response.setHeader("content-type", "application/json");
    return response.end(JSON.stringify(body));
  }
  if (url === "/wikt.zip") return response.end(zip);
  response.statusCode = 404;
  response.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const runAs = (...args) => adb("shell", "run-as", APP, ...args);
const copyInUse = () => {
  try {
    return runAs("ls", "files/wiktionary").split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
};

/** A fresh app, on Wi-Fi or on mobile data, up to the notes list. */
async function start(wifi) {
  adb("shell", "pm", "clear", APP);
  adb("shell", "svc", "wifi", wifi ? "enable" : "disable");
  adb("shell", "svc", "data", "enable");
  adb("reverse", "tcp:8081", "tcp:8081");
  adb("reverse", `tcp:${port}`, `tcp:${port}`);
  runAs("sh", "-c", `'mkdir -p files && echo http://localhost:${port}/ > files/wiktionary-datos-url'`);
  await sleep(wifi ? 8000 : 3000); // the network settles
  served.length = 0;
  adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1");
  await waitFor("welcome-enter", 180000);
  await tap("welcome-enter");
  await waitFor("Buscar en Notas");
}

async function openAbout() {
  adb("shell", "input", "tap", "118", "191"); // the menu button in the search bar
  await tap("sidemenu-settings-icon");
  await tap("Ajustes");
  // About is the last section of the list.
  for (let i = 0; i < 12 && !visibleText().includes("Actualizar diccionario ahora"); i++)
    adb("shell", "input", "swipe", "540", "2000", "540", "600", "300");
  await waitFor("Actualizar diccionario ahora");
}

async function until(check, what, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(1000);
  }
  throw new Error(`no pasó: ${what} (servido: ${served.join(" ") || "nada"})`);
}

try {
  // --- Mobile data: nothing on its own; the button downloads ----------------
  await start(false);
  await sleep(15000);
  assert.deepEqual(served, [], "con datos móviles se descargó solo");
  assert.deepEqual(copyInUse(), []);
  console.log("1. con datos móviles no descarga solo");

  await openAbout();
  assert.ok(visibleText().includes("Copia en uso: Wikcionario del 2 de noviembre de 2026."));
  // The toast is gone before uiautomator reads the screen; the date stays.
  await tap("Actualizar diccionario ahora");
  await waitFor("Copia en uso: Wikcionario del 9 de noviembre de 2026.", 120000);
  const [folder] = copyInUse();
  assert.match(folder, new RegExp(`^${manifest.date}-${manifest.sha256.slice(0, 12)}$`));
  assert.ok(runAs("ls", `files/wiktionary/${folder}`).includes("wikt-index.json"));
  shot("a6-wiktionary-updated");
  console.log(`2. el botón descarga con datos móviles: ${folder}`);

  // --- A wrong hash leaves the copy in use ---------------------------------
  wrongHash = true;
  adb("logcat", "-c");
  await tap("Actualizar diccionario ahora");
  await until(
    () => /wiktionary update.*SHA-256/.test(adb("logcat", "-d", "-s", "ReactNativeJS:E")),
    "el hash incorrecto se rechaza"
  );
  assert.deepEqual(copyInUse().filter((name) => !name.endsWith(".part")), [folder]);
  assert.ok(visibleText().includes("Copia en uso: Wikcionario del 9 de noviembre de 2026."));
  wrongHash = false;
  console.log("3. un hash incorrecto deja la copia en uso");

  // --- Wi-Fi: it downloads on its own; the editor reads it ------------------
  await start(true);
  // Done when only the final folder is left: <folder>.part is mid-unzip.
  await until(
    () => copyInUse().join() === folder,
    "en Wi-Fi descarga sola"
  );
  await sleep(2000); // the switch, written right after the folder
  assert.deepEqual(served, ["/manifest.json", "/wikt.zip"]);
  console.log("4. en Wi-Fi descarga sola");

  // The editor is open from the start, so it reads the copy from the next
  // start on.
  adb("shell", "am", "force-stop", APP);
  adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1");
  await waitFor("Buscar en Notas", 120000);
  adb("shell", "input", "swipe", "900", "1200", "100", "1200", "250");
  await sleep(3000);
  const cdp = await connectToEditor();
  const { $ } = editorTools(cdp);
  // XMLHttpRequest, as the package reads its files: fetch has no file://.
  const read = await $(`new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", globalThis.WIKTIONARY_COPY + "wikt-index.json");
    xhr.responseType = "json";
    xhr.onload = () => resolve({ copy: globalThis.WIKTIONARY_COPY, date: xhr.response?.date });
    xhr.onerror = () => reject(new Error("no se pudo leer " + globalThis.WIKTIONARY_COPY));
    xhr.send();
  })`);
  assert.equal(read.date, manifest.date);
  assert.match(read.copy, /^file:\/\/.+\/wiktionary\/.+\/$/);
  assert.deepEqual(copyInUse(), [folder]);
  console.log(`5. tras reiniciar, el editor lee la copia nueva: ${read.copy}`);
  console.log("GREEN");
} catch (error) {
  console.log("servido:", served.join(" ") || "nada");
  throw error;
} finally {
  adb("shell", "svc", "wifi", "enable");
  server.close();
}
