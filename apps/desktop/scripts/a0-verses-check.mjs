// SPDX-License-Identifier: GPL-3.0-or-later
// Reads ['VBL','JHN',3,16] back out of IndexedDB in the running app.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-verses-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  const result = await page.evaluate(async () => {
    const open = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("epigrapho-scripture", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const read = (db, key) =>
      new Promise((resolve, reject) => {
        const request = db
          .transaction("verses", "readonly")
          .objectStore("verses")
          .get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    // Only the VBL rows: three packs share this store since Paso 3.2, and
    // what this check is about is the one A0 shipped.
    const count = (db) =>
      new Promise((resolve, reject) => {
        const request = db
          .transaction("verses", "readonly")
          .objectStore("verses")
          .count(IDBKeyRange.bound(["VBL"], ["VBL", [], [], []]));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

    // The packs load right after the app starts; wait for VBL to be whole,
    // not merely started, or the count is read mid-import.
    const deadline = Date.now() + 120000;
    for (;;) {
      const db = await open();
      const stores = [...db.objectStoreNames];
      const total = stores.includes("verses") ? await count(db) : 0;
      if (total === 31086) {
        const row = await read(db, ["VBL", "JHN", 3, 16]);
        const keyPath = db.transaction("verses").objectStore("verses").keyPath;
        db.close();
        return { total, row, keyPath, stores };
      }
      db.close();
      if (Date.now() > deadline) return { total, row: undefined, stores };
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });

  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(result.keyPath, [
    "translationId",
    "book",
    "chapter",
    "verse"
  ]);
  assert.equal(result.total, 31086);
  assert.ok(result.row, "no se encontro ['VBL','JHN',3,16]");
  assert.match(result.row.text, /^“Porque Dios amó al mundo/);
  assert.equal(result.row.source, "pack");
  console.log("GREEN: ['VBL','JHN',3,16] leido desde IndexedDB.");
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
