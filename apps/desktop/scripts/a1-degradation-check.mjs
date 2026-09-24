// SPDX-License-Identifier: GPL-3.0-or-later
// Cuts the network and checks a brand translation never shows a raw error or
// an empty box: the fresh cache first, then the saved copy, then the embedded
// translation, each one labelled for what it is (PRD §31.3, Paso 4.3).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Epigrapho 4.3";
const CACHE_DB = "epigrapho-scripture-cache";

const profile = await mkdtemp(
  path.join(profilesRoot(), "epigrapho-degradacion-")
);
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const readPopover = () =>
  page.evaluate(() => ({
    text: document.querySelector('[data-test-id="scripture-popover-text"]')
      ?.textContent,
    attribution: document.querySelector(
      '[data-test-id="scripture-popover-attribution"]'
    )?.textContent,
    // El aviso de degradación es su propia línea, no un sufijo del crédito:
    // dice qué confianza merece el texto, que es otra cosa que a quién citar.
    notice:
      document.querySelector('[data-test-id="scripture-popover-notice"]')
        ?.textContent || ""
  }));

/** Hovers the reference at `index` and waits for its verse to arrive. */
async function hover(index) {
  await page.locator('.active [data-test-id="editor-title"]').hover();
  await page
    .locator('[data-test-id="scripture-popover"]')
    .waitFor({ state: "detached", timeout: 10000 })
    .catch(() => undefined);

  const mark = page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .nth(index);
  const ref = await mark.getAttribute("data-scripture-ref");
  await mark.hover();
  // The popover has to be the one for this reference: the pointer crosses the
  // other marks on its way, and a popover that is merely filled may be theirs.
  await page.waitForFunction(
    (expected) => {
      const popover = document.querySelector(
        '[data-test-id="scripture-popover"]'
      );
      const text = popover?.querySelector(
        '[data-test-id="scripture-popover-text"]'
      )?.textContent;
      return (
        popover?.dataset.scriptureRef === expected && !!text && text !== "…"
      );
    },
    ref,
    { timeout: 20000 }
  );
  return readPopover();
}

/** Picks a translation in Settings > Editor. Returns what the list offered. */
async function chooseTranslation(translationId) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  // The dialog mounts on the hash change; filling the search before it
  // is there types into the box that is on its way out.
  await page.locator(".ReactModal__Content").waitFor();
  await page.locator('[data-test-id="settings-search"]').fill("editor");
  const select = page.locator(
    '[data-test-id="setting-scripture-translation"] select'
  );
  await select.waitFor();
  const offered = await select
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  await select.selectOption(translationId);
  // The hash is what keeps the dialog open, so moving off it is enough most
  // of the time. Reloading is the fallback, and it is worth avoiding: a
  // second reload on the heels of the one a language change already does
  // catches the database mid-transaction and the app comes up on its error
  // screen ("Safety level may not be changed inside a transaction").
  const modal = page.locator(".ReactModal__Content");
  await page
    .evaluate(() => (window.location.hash = "/"))
    .catch(() => undefined);
  let closed = await modal
    .waitFor({ state: "detached", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    // Nothing in the app listens for the hash to leave, so the dialog can sit
    // there; it does close on Escape, which is what a person would press.
    await modal.press("Escape").catch(() => undefined);
    closed = await modal
      .waitFor({ state: "detached", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!closed) {
    await page.evaluate(() => window.location.reload()).catch(() => undefined);
    await page.waitForLoadState("load");
    await modal.waitFor({ state: "detached" });
  }
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  return offered;
}

/** Ages a cached row so it looks older than the thirty day window. */
const expireCacheRow = (key) =>
  page.evaluate(
    ([db, key]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(db, 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const store = database
            .transaction("verses", "readwrite")
            .objectStore("verses");
          const read = store.get(key);
          read.onsuccess = () => {
            if (!read.result) {
              database.close();
              return reject(new Error(`no hay fila en cache para ${key}`));
            }
            store.put({ ...read.result, fetchedAt: 0 }, key);
            database.close();
            resolve(read.result.text);
          };
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
        };
      }),
    [CACHE_DB, key]
  );

/**
 * Takes the network away from both processes. The renderer is cut with
 * Chromium's offline emulation, as in a0-final-check; the main process needs
 * more, because net.fetch keeps working under that emulation (measured: it
 * still answered 401), so its requests to the API are cancelled outright.
 * What the app sees is the same either way: the API cannot be reached.
 */
async function goOffline() {
  await app.evaluate(({ BrowserWindow, session }) => {
    session.defaultSession.enableNetworkEmulation({ offline: true });
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["https://api.scripture.api.bible/*"] },
      (_details, callback) => callback({ cancel: true })
    );
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.session.enableNetworkEmulation({ offline: true });
  });
  await page
    .context()
    .setOffline(true)
    .catch(() => undefined);
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // The packs load right after startup; the fallback reads from them.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("verses")) {
            db.close();
            return resolve(false);
          }
          const request = db
            .transaction("verses", "readonly")
            .objectStore("verses")
            .count();
          request.onsuccess = () => {
            db.close();
            resolve(request.result > 0);
          };
          request.onerror = () => {
            db.close();
            resolve(false);
          };
        };
      }),
    undefined,
    { timeout: 240000 }
  );

  const offered = await chooseTranslation("NBLA");
  console.log("traducciones ofrecidas:", JSON.stringify(offered));
  assert.deepEqual(offered, [
    "VBL",
    "BSB",
    "KJV",
    "PdDpt",
    "NTV",
    "NBLA",
    "NASB"
  ]);

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type("Juan 3:16 y Romanos 8:28.", { delay: 25 });
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .nth(1)
    .waitFor({ timeout: 20000 });

  // 1. with the network up: the brand text, credited to its publisher.
  const online = await hover(0);
  console.log("con red:", JSON.stringify(online));
  assert.match(online.text, /^»Porque de tal manera amó Dios al mundo/);
  assert.match(online.attribution, /^Nueva Biblia de las Américas Copyright/);
  // Con red y copia fresca no hay nada que advertir.
  assert.equal(online.notice, "");

  await goOffline();
  const blocked = await page.evaluate(() =>
    fetch("/vbl.json", { cache: "no-store" }).then(
      () => "la red sigue arriba",
      (error) => `bloqueada: ${error.message}`
    )
  );
  console.log("red del renderer:", blocked);
  assert.match(blocked, /^bloqueada:/);

  const mainNet = await app.evaluate(async ({ net }) => {
    try {
      const response = await net.fetch(
        "https://api.scripture.api.bible/v1/bibles",
        { cache: "no-store" }
      );
      return `status ${response.status}`;
    } catch (error) {
      return `error ${error.message}`;
    }
  });
  console.log("red del proceso principal:", mainNet);
  assert.match(
    mainNet,
    /^error/,
    "el proceso principal sigue alcanzando la API"
  );

  // 2. offline with a fresh copy: the same verse and no notice, because
  // nothing had to be asked for.
  const cached = await hover(0);
  console.log("sin red, copia fresca:", JSON.stringify(cached));
  assert.deepEqual(cached, online);

  // 3. offline with an expired copy: shown all the same, but labelled.
  const stored = await expireCacheRow("NBLA:JHN.3.16");
  console.log("fila de cache envejecida:", JSON.stringify(stored.slice(0, 40)));
  const stale = await hover(0);
  console.log("sin red, copia vencida:", JSON.stringify(stale));
  assert.equal(stale.text, online.text);
  assert.match(stale.notice, /^Una copia guardada\./);
  assert.match(stale.notice, /NBLA/);

  // 4. offline with no copy at all: the embedded translation, labelled.
  const fallback = await hover(1);
  console.log("sin red, sin copia:", JSON.stringify(fallback));
  assert.match(fallback.text, /^Sabemos que en todas las cosas Dios obra/);
  assert.match(fallback.attribution, /^VBL — CC BY-SA 4\.0/);
  assert.match(fallback.notice, /^Se muestra VBL en su lugar/);

  console.log(
    "GREEN: sin red, NBLA muestra la copia guardada o la traducción embebida etiquetada, nunca un error crudo ni una caja vacía."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
