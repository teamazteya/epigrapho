/*
This file is part of the Epigrapho project, a fork of Notesnook
(https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * Writes data/rand-ocr-fixes.tsv, the table of OCR misreadings the Rand
 * pipeline corrects (A2 Paso 7.2, option b). It is a development tool, run
 * by hand: the table is versioned and reviewed, so the build stays the same
 * everywhere and needs no dictionary of its own.
 *
 * A word is corrected only when all of this holds:
 * - it is not Spanish: not in the Hunspell dictionary the spell checker uses,
 *   not in RV1909, VBL or PdDpt, and seen fewer than three times in Rand;
 * - one typical OCR confusion (u/n, rn/m, c/e, l/i, y/u, ii/u, li/h, j/i)
 *   turns it into a word that is Spanish;
 * - exactly one such word exists.
 * Accents are left alone: "abusó" and "períodos" are right, and a word list
 * cannot tell them from a misreading.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { paragraphsOfRand } from "./rand.ts";
import { fetchSources, readSource } from "./sources.ts";

const desktop = fileURLToPath(new URL("../../../apps/desktop/", import.meta.url));
const require = createRequire(desktop);
const nspell = require("nspell");
const dictionary = `${desktop}node_modules/dictionary-es/`;
const speller = nspell({
  aff: readFileSync(`${dictionary}index.aff`),
  dic: readFileSync(`${dictionary}index.dic`)
});
for (const { word } of JSON.parse(
  readFileSync(`${desktop}resources/bible-terms-es.json`, "utf8")
).entries as { word: string }[])
  speller.add(word);

const words = (text: string) => text.normalize("NFC").match(/\p{L}+/gu) ?? [];
const count = (into: Map<string, number>, text: string) => {
  for (const word of words(text)) {
    const key = word.toLowerCase();
    into.set(key, (into.get(key) ?? 0) + 1);
  }
};

await fetchSources();
const bibles = new Map<string, number>();
for (const file of ["nt_RV09.tsv", "ot_RV09.tsv"] as const)
  count(bibles, readSource(file).split("\n").map((line) => line.split("\t")[2] ?? "").join(" "));
for (const translation of ["vbl", "pddpt"]) {
  const folder = fileURLToPath(
    new URL(`../../bible-pack/data/${translation}/`, import.meta.url)
  );
  for (const file of readdirSync(folder))
    count(bibles, readFileSync(folder + file, "utf8").replace(/\\\S+/g, " "));
}
const rand = new Map<string, number>();
for (const paragraph of paragraphsOfRand()) count(rand, paragraph);

const capitalised = (word: string) => word[0].toUpperCase() + word.slice(1);
const ACCENTED: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
const inDictionary = (word: string) =>
  speller.correct(word) || speller.correct(capitalised(word));
/** Spanish as written, or missing only the accent 1890 left off ("caido"). */
const spanish = (word: string) =>
  inDictionary(word) ||
  bibles.has(word) ||
  (rand.get(word) ?? 0) >= 3 ||
  [...word].some(
    (letter, at) =>
      ACCENTED[letter] &&
      inDictionary(word.slice(0, at) + ACCENTED[letter] + word.slice(at + 1))
  );
/**
 * What a misreading may become: a word the Bibles use, and a common one when
 * it is short, where one letter apart there are many words. A proper name
 * the dictionary lacks ("Lydia", "Galia") then has no Bible word to turn into.
 */
const target = (word: string) =>
  (bibles.get(word) ?? 0) >= (word.length > 3 ? 5 : 500);

const CONFUSIONS: [string, string][] = [
  ["u", "n"], ["n", "u"], ["rn", "m"], ["c", "e"], ["e", "c"], ["l", "i"],
  ["i", "l"], ["y", "u"], ["ii", "u"], ["li", "h"], ["j", "i"]
];

const fixes: [string, string][] = [];
for (const [word, seen] of rand) {
  if (word.length < 3 || seen >= 3 || spanish(word)) continue;
  const candidates = new Set<string>();
  for (const [from, to] of CONFUSIONS)
    for (let at = word.indexOf(from); at >= 0; at = word.indexOf(from, at + 1)) {
      const candidate = word.slice(0, at) + to + word.slice(at + from.length);
      if (target(candidate)) candidates.add(candidate);
    }
  if (candidates.size === 1) fixes.push([word, [...candidates][0]]);
}
fixes.sort(([a], [b]) => a.localeCompare(b, "es"));
writeFileSync(
  fileURLToPath(new URL("../data/rand-ocr-fixes.tsv", import.meta.url)),
  fixes.map((fix) => fix.join("\t")).join("\n") + "\n"
);
console.error(`${fixes.length} correcciones escritas en data/rand-ocr-fixes.tsv`);
