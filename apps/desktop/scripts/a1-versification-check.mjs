// SPDX-License-Identifier: GPL-3.0-or-later
// Checks one canonical reference lands on the same passage in every
// translation, whatever numbering that translation prints (ADR 0004, Paso
// 4.5). It calls the app's own resolveVerse, so what it measures is the path
// the popover and the inserted block take.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// Vite serves apps/web; the package is reached by the junction the app itself
// resolves it through (see a0-provider-check for why the absolute path 403s).
const scriptureUrl =
  "/@fs/" +
  fileURLToPath(
    new URL("../../web/src/common/scripture.ts", import.meta.url)
  ).replace(/\\/g, "/");

const TRANSLATIONS = ["VBL", "BSB", "KJV", "PdDpt", "NBLA"];

// Each case is a canonical reference plus what the passage says, per
// translation. The four the runbook names, and the two that measuring the
// packs turned up. Every expectation was read from the translation itself.
const CASES = [
  {
    name: "títulos de Salmos — PSA 51:1",
    ref: { book: "PSA", chapter: 51, verse: 1 },
    // The psalm's title is verse 1 in the original. Canonically, verse 1 is
    // the plea, and that is what every translation must show.
    expect: /^(Ten (misericordia|compasión|piedad)|Have (mercy|gracious))/i,
    reject: /al músico|director del coro|choirmaster|when Nathan/i
  },
  {
    name: "Malaquías — MAL 4:1",
    ref: { book: "MAL", chapter: 4, verse: 1 },
    expect: /(horno|furnace|oven)/i
  },
  {
    name: "3 Juan — 3JN 1:15",
    ref: { book: "3JN", chapter: 1, verse: 15 },
    expect: /(paz|peace)/i
  },
  {
    name: "Romanos 16 — ROM 16:25",
    ref: { book: "ROM", chapter: 16, verse: 25 },
    expect: /(fortalecer|establecer|afirmar|gloria|able to|power)/i
  },
  {
    name: "Apocalipsis — REV 12:18",
    ref: { book: "REV", chapter: 12, verse: 18 },
    expect: /(arena|orilla|sand|shore)/i
  },
  {
    name: "2 Corintios — 2CO 13:14",
    ref: { book: "2CO", chapter: 13, verse: 14 },
    expect: /(gracia|grace)/i
  }
];

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-vrs-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // Every pack has to be in the store before a lookup means anything.
  await page.waitForFunction(
    (ids) =>
      new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("verses")) {
            db.close();
            return resolve(false);
          }
          const store = db
            .transaction("verses", "readonly")
            .objectStore("verses");
          Promise.all(
            ids.map(
              (id) =>
                new Promise((done) => {
                  const request = store.count(
                    IDBKeyRange.bound([id], [id, []])
                  );
                  request.onsuccess = () => done(request.result);
                  request.onerror = () => done(0);
                })
            )
          ).then((counts) => {
            db.close();
            resolve(counts.every((stored) => stored > 0));
          });
        };
      }),
    ["VBL", "BSB", "KJV", "PdDpt"],
    { timeout: 240000 }
  );

  const results = await page.evaluate(
    async ([url, cases, translations]) => {
      const { resolveVerse } = await import(/* @vite-ignore */ url);
      const out = {};
      for (const item of cases) {
        out[item.name] = {};
        for (const translationId of translations) {
          const verse = await resolveVerse(
            { ...item.ref, versification: "eng" },
            translationId
          );
          out[item.name][translationId] = {
            text: verse.text,
            served: verse.translationId,
            notice: verse.notice
          };
        }
      }
      return out;
    },
    [scriptureUrl, CASES.map(({ name, ref }) => ({ name, ref })), TRANSLATIONS]
  );

  let failures = 0;
  for (const item of CASES) {
    console.log(`\n--- ${item.name} ---`);
    for (const translationId of TRANSLATIONS) {
      const got = results[item.name][translationId];
      const line = `${translationId.padEnd(6)} ${JSON.stringify(
        (got.text || "").slice(0, 78)
      )}`;
      console.log(line);

      try {
        assert.ok(got.text, `${item.name}: ${translationId} no devolvió texto`);
        assert.equal(
          got.served,
          translationId,
          `${item.name}: ${translationId} cayó a ${got.served}`
        );
        assert.match(got.text, item.expect, `${item.name} / ${translationId}`);
        if (item.reject)
          assert.doesNotMatch(
            got.text,
            item.reject,
            `${item.name} / ${translationId} muestra el título, no el verso`
          );
      } catch (error) {
        failures++;
        console.error("  FALLA:", error.message);
      }
    }
  }

  assert.equal(failures, 0, `${failures} comprobaciones fallaron`);
  console.log(
    `\nGREEN: las ${
      CASES.length
    } referencias apuntan al mismo pasaje en ${TRANSLATIONS.join(
      ", "
    )}, con la numeración de cada una.`
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
