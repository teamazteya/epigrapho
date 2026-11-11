// SPDX-License-Identifier: GPL-3.0-or-later
// A6 Fase 6 on the desktop: the weekly Wiktionary copy downloads on its own,
// the dictionary switches to it, the button checks again, a copy with a wrong
// hash leaves the one in use, and a restart keeps it without downloading.
//
// A local server stands in for the latest release of
// teamazteya/epigrapho-datos, through EPIGRAPHO_DATOS_URL. WIKT_DIR holds its
// manifest.json and wikt.zip, a copy newer than the app's own.
//
// Run after: node apps/desktop/scripts/build.mjs
//   WIKT_DIR=<folder> node apps/desktop/scripts/a6-wiktionary-update-check.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
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
const DATOS = `http://127.0.0.1:${server.address().port}/`;

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-wikt-"));
const current = path.join(profile, "UserData", "wiktionary", "current.json");
const launch = () =>
  _electron.launch({
    args: [path.join(root, "build", "electron.js")],
    env: {
      ...process.env,
      CUSTOM_USER_DATA_DIR: profile,
      ELECTRON_IS_DEV: "0",
      EPIGRAPHO_DATOS_URL: DATOS
    },
    timeout: 60000
  });

async function until(check, what, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no pasó: ${what} (servido: ${served.join(" ") || "nada"})`);
}

/** The text of Settings → About, where the dictionary group is. */
async function about(page) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  const modal = page.locator(".ReactModal__Content");
  await modal.waitFor({ timeout: 30000 });
  await modal.getByText(/^(Acerca de|About)$/).first().click();
  await modal.getByText(/Diccionario de español|Spanish dictionary/i).first().waitFor();
  return modal;
}

const inUse = (modal) =>
  modal.getByText(/Copia en uso|Copy in use/).first().innerText();

let app = await launch();
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on("console", (message) => {
    if (message.type() === "error") console.log("página:", message.text());
  });

  await until(() => existsSync(current), "la copia semanal se instala sola");
  const { folder, date } = JSON.parse(readFileSync(current, "utf8"));
  assert.equal(date, manifest.date);
  assert.deepEqual(served, ["/manifest.json", "/wikt.zip"]);
  console.log(`1. se descargó e instaló sola: ${folder}`);

  const index = await page.evaluate(
    (url) => fetch(url).then((r) => r.json()),
    `/wiktionary/${folder}/wikt-index.json`
  );
  assert.equal(index.date, manifest.date);
  let modal = await about(page);
  await until(
    async () => (await inUse(modal)).includes("2026") && !(await inUse(modal)).includes(" 2 de "),
    "Ajustes muestra la fecha de la copia nueva"
  );
  const shown = await inUse(modal);
  console.log(`2. el diccionario usa la copia nueva: «${shown}»`);

  await modal.getByRole("button", { name: /Actualizar diccionario ahora|Update dictionary now/ }).click();
  await page.getByText(/al día|up to date/).first().waitFor();
  assert.equal(served.filter((url) => url === "/wikt.zip").length, 1);
  console.log("3. el botón vuelve a buscar: está al día, sin descargar");

  wrongHash = true;
  await modal.getByRole("button", { name: /Actualizar diccionario ahora|Update dictionary now/ }).click();
  await page.getByText(/No se pudo actualizar|could not be updated/).first().waitFor();
  assert.equal(JSON.parse(readFileSync(current, "utf8")).folder, folder);
  assert.equal(await inUse(modal), shown);
  console.log("4. un hash incorrecto deja la copia en uso");
  wrongHash = false;

  await app.close();
  const before = served.length;
  app = await launch();
  const again = await app.firstWindow();
  again.setDefaultTimeout(60000);
  modal = await about(again);
  await until(async () => (await inUse(modal)) === shown, "la copia sigue tras reiniciar");
  assert.equal(served.length, before, "al reiniciar no descarga: la revisión es semanal");
  console.log("5. al reiniciar sigue la copia nueva, sin volver a descargar");
  console.log("GREEN");
} finally {
  await app.close().catch(() => {});
  server.close();
}
