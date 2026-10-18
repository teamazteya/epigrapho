// SPDX-License-Identifier: GPL-3.0-or-later
// Exercises the bundled worker with the same dictionaries as the installer.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const target = await mkdtemp(path.join(tmpdir(), "epigrapho-spelling-"));
await mkdir(path.join(target, "dictionaries"));
await build({
  entryPoints: [path.join(root, "src/spell-worker.ts")],
  bundle: true,
  platform: "node",
  outfile: path.join(target, "worker.cjs")
});
for (const language of ["es", "en"]) {
  const source =
    language === "es"
      ? path.join(root, "resources/rla-es-2.9")
      : path.dirname(require.resolve("dictionary-en"));
  for (const extension of ["aff", "dic"])
    await copyFile(
      path.join(source, `${language === "es" ? "es" : "index"}.${extension}`),
      path.join(target, `dictionaries/${language}.${extension}`)
    );
}
for (const name of ["bible-terms-es.json", "spelling-corrections-es.json"]) {
  await copyFile(
    path.join(root, "resources", name),
    path.join(target, "dictionaries", name)
  );
}
let worker;
const bilingual = new Map();
try {
  for (const languages of [["es"], ["es", "en"], ["en", "es"]]) {
    worker = new Worker(path.join(target, "worker.cjs"), {
      workerData: { languages }
    });
    let id = 0;
    const ask = (request) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("worker timeout")),
          10000
        );
        const onError = (error) => {
          clearTimeout(timer);
          reject(error);
        };
        worker.once("error", onError);
        worker.once("message", (answer) => {
          clearTimeout(timer);
          worker.removeListener("error", onError);
          resolve(answer);
        });
        worker.postMessage({ id: id++, ...request });
      });
    for (const [word, expected] of Object.entries({
      qe: "que",
      oy: "hoy",
      korazon: "corazón",
      ponia: "ponía",
      jente: "gente",
      ermano: "hermano",
      sielo: "cielo",
      Neftali: "Neftalí",
      aser: "hacer",
      ise: "hice",
      resureccion: "resurrección",
      dicipulos: "discípulos",
      Tesalonisenses: "Tesalonicenses",
      Gethsemani: "Getsemaní"
    })) {
      const { suggestions } = await ask({ suggest: word });
      console.log(`${languages.join("+")} ${word}: ${suggestions.join(", ")}`);
      assert.ok(
        suggestions.length <= 5,
        `${word}: ${suggestions.length} propuestas`
      );
      assert.equal(suggestions[0], expected, word);
      if (languages.length === 2) {
        if (bilingual.has(word))
          assert.deepEqual(
            suggestions,
            bilingual.get(word),
            `${word}: el orden de idiomas no debe cambiar el ranking`
          );
        else bilingual.set(word, suggestions);
      }
    }
    const ranked = await ask({
      suggest: "ponia",
      candidates: ["ponía", "podía", "jonia"]
    });
    assert.deepEqual(ranked.suggestions.slice(0, 3), [
      "ponía",
      "podía",
      "jonia"
    ]);
    const { suggestions } = await ask({
      suggest: "korazon",
      candidates: ["Alòs", "INE", "corazón", "corazón"]
    });
    assert.equal(suggestions[0], "corazón");
    assert.ok(!suggestions.includes("Alòs") && !suggestions.includes("INE"));
    assert.equal(new Set(suggestions).size, suggestions.length);
    const { misspelled } = await ask({
      words: ["Aser", "Yahvé", "Yahweh", "hamartiología", "8:28"]
    });
    assert.deepEqual(misspelled, []);
    assert.deepEqual((await ask({ suggest: "Aser" })).suggestions, []);
    await worker.terminate();
    worker = undefined;
  }
  console.log(
    "GREEN: correcciones cercanas, máximo cinco, idiomas y vocabulario bíblico."
  );
} finally {
  await worker?.terminate();
  await rm(target, { recursive: true, force: true });
}
