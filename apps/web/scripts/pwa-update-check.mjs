/*
 * Epigrapho 1.7.1: the web and the PWA install a new version by themselves.
 * Serves a copy of the build, lets its service worker take control, then
 * publishes a "new version" (the same worker with a mark appended) twice:
 *   1. while an old window stays open, so the new worker is left waiting, as
 *      it was on iPhone; a window that opens then installs it and reloads;
 *   2. while the app is open; it installs when the app comes back to the
 *      screen, without the person doing anything.
 *
 *   npm run build
 *   node scripts/pwa-update-check.mjs
 */
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const build = fileURLToPath(new URL("../build/", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "epigrapho-pwa-"));
await cp(build, root, { recursive: true });
const workerFile = path.join(root, "service-worker.js");
const original = await readFile(workerFile, "utf8");
const publish = (mark) =>
  writeFile(
    workerFile,
    `${original}\n;self.__epigraphoMark=${JSON.stringify(mark)};`
  );

const types = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".json": "application/json",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};
const server = createServer(async (request, response) => {
  let file = decodeURIComponent(new URL(request.url, "http://x").pathname);
  if (!path.extname(file)) file = "/index.html";
  try {
    const body = await readFile(path.join(root, file));
    response.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(4177);
const site = "http://localhost:4177";

const problems = [];
const expect = (ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
  if (!ok) problems.push(what);
};

const browser = await chromium.launch();
const context = await browser.newContext();
const activeMark = async () => {
  for (const worker of context.serviceWorkers())
    try {
      const mark = await worker.evaluate(() =>
        self.registration.active === self.serviceWorker
          ? self.__epigraphoMark ?? "A"
          : null
      );
      if (mark) return mark;
    } catch {
      // a worker that is gone
    }
  return null;
};
const waitFor = async (what, check, seconds = 90) => {
  for (let i = 0; i < seconds * 2; i++) {
    if (await check().catch(() => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error(`timeout: ${what}`);
  return false;
};
const controlled = (page) =>
  page.evaluate(() => !!navigator.serviceWorker.controller);
const waiting = (page) =>
  page.evaluate(
    async () => !!(await navigator.serviceWorker.getRegistration())?.waiting
  );

try {
  // The first visit installs version A; the page is controlled after a reload.
  const old = await context.newPage();
  await old.goto(site);
  await waitFor("instalar A", async () => (await activeMark()) === "A");
  await old.reload();
  await waitFor("controlar la página", () => controlled(old));
  expect((await activeMark()) === "A", "la versión A controla la app");

  // ---- 1. a version left waiting is installed when a window opens ----
  await publish("B");
  await old.evaluate(() =>
    navigator.serviceWorker.getRegistration().then((r) => r.update())
  );
  expect(
    await waitFor("B en espera", () => waiting(old)),
    "B queda en espera con una ventana vieja abierta"
  );
  const fresh = await context.newPage();
  let loads = 0;
  fresh.on("load", () => loads++);
  await fresh.goto(site);
  await waitFor(
    "instalar B",
    async () => (await activeMark()) === "B" && loads >= 2
  );
  expect((await activeMark()) === "B", "al abrir la app, B se instala sola");
  expect(loads >= 2, `la ventana nueva se recarga con B (${loads} cargas)`);
  expect(!(await waiting(fresh)), "no queda nada en espera");
  await old.close();

  // ---- 2. a version that arrives while the app is open ----
  await publish("C");
  await fresh.evaluate(() =>
    navigator.serviceWorker.getRegistration().then((r) => r.update())
  );
  await waitFor("C en espera", () => waiting(fresh));
  await fresh.waitForTimeout(2000);
  expect(
    (await activeMark()) === "B",
    "mientras se usa, la app no cambia de versión"
  );
  const before = loads;
  // The app comes back to the screen.
  await fresh.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange"))
  );
  await waitFor(
    "instalar C",
    async () => (await activeMark()) === "C" && loads > before
  );
  expect(
    (await activeMark()) === "C",
    "al volver a la pantalla, C se instala sola"
  );
  expect(loads > before, "y la app se recarga con C");
} finally {
  await browser.close();
  server.close();
}
console.log(problems.length ? "NO-GREEN" : "GREEN: la PWA se actualiza sola.");
process.exit(problems.length ? 1 : 0);
