// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the added packs ship offline next to VBL: the four translations
// land in the same IndexedDB store, and with the renderer's network cut a
// reference still reads its text in each of them (PRD §31.3, Pasos 3.1 y 3.3).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-bsb-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/**
 * Reads a verse the way the provider does: one bound key range over
 * [translationId, book, chapter, verse]. Nothing is imported into the page, so
 * this measures the store the app actually filled.
 */
const readVerse = (translationId, book, chapter, verse) =>
  page.evaluate(
    ([translationId, book, chapter, verse]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("verses", "readonly")
            .objectStore("verses")
            .get([translationId, book, chapter, verse]);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      }),
    [translationId, book, chapter, verse]
  );

/** How many verses of one translation are stored. */
const countOf = (translationId) =>
  page.evaluate(
    (translationId) =>
      new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onerror = () => resolve(0);
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("verses")) {
            db.close();
            return resolve(0);
          }
          const request = db
            .transaction("verses", "readonly")
            .objectStore("verses")
            // An array sorts after any number, so [id, []] is past every key
            // of this translation.
            .count(IDBKeyRange.bound([translationId], [translationId, []]));
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            resolve(0);
          };
        };
      }),
    translationId
  );

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // Both packs are loaded right after startup, one transaction each.
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
          const count = (id) =>
            new Promise((done) => {
              const request = db
                .transaction("verses", "readonly")
                .objectStore("verses")
                .count(IDBKeyRange.bound([id], [id, []]));
              request.onsuccess = () => done(request.result);
              request.onerror = () => done(0);
            });
          Promise.all([
            count("VBL"),
            count("BSB"),
            count("KJV"),
            count("PdDpt")
          ]).then((counts) => {
            db.close();
            resolve(counts.every((stored) => stored > 0));
          });
        };
      }),
    undefined,
    { timeout: 240000 }
  );

  const stored = {
    VBL: await countOf("VBL"),
    BSB: await countOf("BSB"),
    KJV: await countOf("KJV"),
    PdDpt: await countOf("PdDpt")
  };
  console.log("versos guardados:", JSON.stringify(stored));
  assert.equal(stored.VBL, 31086);
  assert.equal(stored.BSB, 31086);
  // KJV follows the received text, so it carries 16 verses VBL omits.
  assert.equal(stored.KJV, 31102);
  // PdDpt brackets the disputed passages instead of dropping them, and writes
  // the verses the earliest manuscripts lack as an empty pair of brackets.
  assert.equal(stored.PdDpt, 31061);

  // The window runs on its own session, so the default one is not the one to
  // cut. Whatever answers after this is local.
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.session.enableNetworkEmulation({ offline: true });
  });
  await page
    .context()
    .setOffline(true)
    .catch(() => undefined);
  const blocked = await page.evaluate(() =>
    fetch("/bsb.json", { cache: "no-store" }).then(
      () => "la red sigue arriba",
      (error) => `bloqueada: ${error.message}`
    )
  );
  console.log("red del renderer:", blocked);
  assert.match(blocked, /^bloqueada:/);

  const bsb = await readVerse("BSB", "JHN", 3, 16);
  console.log("BSB JHN 3:16 sin red:", JSON.stringify(bsb));
  assert.equal(
    bsb.text,
    "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life."
  );

  const kjv = await readVerse("KJV", "JHN", 3, 16);
  console.log("KJV JHN 3:16 sin red:", JSON.stringify(kjv.text));
  assert.equal(
    kjv.text,
    "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
  );

  // JHN 5:4 exists in KJV and not in VBL: the packs are independent, not one
  // text with three labels.
  const omitted = await readVerse("VBL", "JHN", 5, 4);
  const received = await readVerse("KJV", "JHN", 5, 4);
  console.log(
    "JHN 5:4:",
    JSON.stringify({ VBL: omitted, KJV: received?.text?.slice(0, 30) })
  );
  assert.equal(omitted, undefined);
  assert.match(received.text, /^For an angel went down/);

  // The Spanish packs are untouched: four translations, one store.
  const vbl = await readVerse("VBL", "JHN", 3, 16);
  console.log("VBL JHN 3:16 sin red:", JSON.stringify(vbl.text.slice(0, 40)));
  assert.match(vbl.text, /^“Porque Dios amó al mundo/);

  const pddpt = await readVerse("PdDpt", "JHN", 3, 16);
  console.log(
    "PdDpt JHN 3:16 sin red:",
    JSON.stringify(pddpt.text.slice(0, 40))
  );
  assert.match(pddpt.text, /^Dios amó tanto al mundo/);

  // Two Spanish translations of the same verse, read from the same store with
  // no network: the id on the row is what keeps them apart.
  assert.notEqual(pddpt.text, vbl.text);

  console.log(
    "GREEN: VBL, BSB, KJV y PdDpt conviven en el mismo almacén y las tres nuevas responden sin red."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
