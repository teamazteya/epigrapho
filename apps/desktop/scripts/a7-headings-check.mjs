// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the built packs carry the headings A7 shows (Fase 1): how many of
// each kind every translation has, a few known places, and that no USFM
// markup leaked into a heading. Run after `npm run build` in
// packages/bible-pack; it reads the packs the web and desktop builds serve.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const folder = fileURLToPath(new URL("../../web/public/", import.meta.url));
const read = (file) => JSON.parse(readFileSync(folder + file, "utf8"));

// Counted from the USFM on 2026-11-14. BSB has 117 \d lines, one empty
// (ZEC 14); PdDpt has 2105 \s1, one after the last verse of Habakkuk.
const expected = {
  "bsb.json": { s1: 3017, s2: 80, d: 116 },
  "pddpt.json": { s1: 2104 },
  "vbl.json": { d: 118, sp: 33 },
  // Its \s1 are the letters of Psalm 119, left out on purpose.
  "kjv.json": { d: 116 }
};

let bytes = 0;
const packs = {};
for (const [file, counts] of Object.entries(expected)) {
  const pack = read(file);
  packs[file] = pack;
  bytes += statSync(folder + file).size;
  assert.ok(Array.isArray(pack.headings), `${file} sin headings`);
  const found = {};
  for (const [, , , kind] of pack.headings) found[kind] = (found[kind] ?? 0) + 1;
  assert.deepEqual(found, counts, `${file}: conteo de títulos`);
  for (const [book, chapter, verse, kind, text] of pack.headings) {
    assert.ok(text && !/\\|strong=/.test(text), `${file} ${book} ${chapter}:${verse} ${kind}: "${text}"`);
    assert.ok(chapter > 0 && verse > 0, `${file} ${book} ${chapter}:${verse}`);
  }
}

const at = (file, book, chapter, verse) =>
  packs[file].headings
    .filter(([b, c, v]) => b === book && c === chapter && v === verse)
    .map(([, , , kind, text]) => `${kind}:${text}`);

assert.deepEqual(at("bsb.json", "GEN", 1, 1), ["s1:The Creation"]);
assert.deepEqual(at("bsb.json", "GEN", 1, 3), ["s2:The First Day"]);
assert.deepEqual(at("bsb.json", "PSA", 23, 1), [
  "s1:The LORD Is My Shepherd",
  "d:A Psalm of David."
]);
assert.deepEqual(at("pddpt.json", "JHN", 3, 16), ["s1:El amor de Dios"]);
assert.deepEqual(at("vbl.json", "PSA", 23, 1), ["d:Un Salmo de David."]);
assert.deepEqual(at("kjv.json", "PSA", 119, 1), []);

// Four packs of ~4.4 MB each grew ~262 KB on 2026-11-14.
console.log(`paquetes: ${(bytes / 1e6).toFixed(2)} MB en total`);
console.log("a7-headings-check: GREEN");
