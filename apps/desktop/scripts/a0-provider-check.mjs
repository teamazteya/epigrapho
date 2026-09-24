// SPDX-License-Identifier: GPL-3.0-or-later
// Calls EmbeddedProvider.getVerseText inside the running app, against the real
// IndexedDB pack. Run while npm run start:desktop is serving on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// The browser needs a real URL, so the module is loaded through Vite's dev
// server, by the junction the app itself resolves the package through. The
// package's own folder is outside Vite's serving allow list (the repo has no
// npm workspaces, so the list is just apps/web), and asking for it by absolute
// path answers 403. Application code imports it as
// "@notesnook/scripture-provider", via the alias in vite.config.ts.
const providerUrl =
  "/@fs/" +
  fileURLToPath(
    new URL(
      "../../web/node_modules/@notesnook/scripture-provider/src/embedded.ts",
      import.meta.url
    )
  ).replace(/\\/g, "/");

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-provider-"));
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

  const result = await page.evaluate(async (url) => {
    const countRows = () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("verses")) {
            db.close();
            return resolve(0);
          }
          const request = db
            .transaction("verses", "readonly")
            .objectStore("verses")
            .count();
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
        open.onerror = () => reject(open.error);
      });

    const deadline = Date.now() + 120000;
    while ((await countRows()) === 0) {
      if (Date.now() > deadline) throw new Error("el pack nunca se cargo");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const { getVerseText } = await import(/* @vite-ignore */ url);
    const versification = "default";
    const started = performance.now();
    const single = await getVerseText(
      { book: "JHN", chapter: 3, verse: 16, versification },
      "VBL"
    );
    const firstRead = Math.round(performance.now() - started);
    const cached = performance.now();
    const again = await getVerseText(
      { book: "JHN", chapter: 3, verse: 17, versification },
      "VBL"
    );
    const cachedRead = Math.round(performance.now() - cached);

    return {
      single,
      again,
      range: await getVerseText(
        { book: "JHN", chapter: 3, verse: 16, endVerse: 18, versification },
        "VBL"
      ),
      psalm: await getVerseText(
        { book: "PSA", chapter: 23, verse: 1, versification },
        "VBL"
      ),
      omitted: await getVerseText(
        { book: "JHN", chapter: 5, verse: 4, versification },
        "VBL"
      ),
      firstRead,
      cachedRead
    };
  }, providerUrl);

  console.log(JSON.stringify(result, null, 2));
  assert.match(result.single, /^“Porque Dios amó al mundo/);
  assert.ok(
    result.range.startsWith(result.single),
    "el rango debe abrir en 3:16"
  );
  assert.ok(
    result.range.length > result.single.length,
    "el rango 16-18 debe traer mas texto que 3:16"
  );
  assert.ok(result.range.includes(result.again), "el rango debe incluir 3:17");
  assert.match(result.psalm, /^El Señor es mi pastor/);
  assert.equal(result.omitted, "", "JHN 5:4 no tiene texto en VBL");
  console.log(
    "GREEN: getVerseText devolvio el texto del verso desde el pack VBL."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
