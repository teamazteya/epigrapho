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

// A6 Fases 3 and 4: how many of test/terms-es.txt the dictionary answers,
// with the title-only search A2 shipped, with the index, and with Wiktionary.
// Needs npm run build first.
import { readFileSync } from "node:fs";
import {
  buildDictionaryIndex,
  foldTerm,
  searchIndex,
  wiktionaryGroup
} from "../src/search.ts";
import { formsFor, loadPacks } from "../test/packs.ts";

const [pack, wiktionary, words] = loadPacks();

const terms = readFileSync(
  new URL("../test/terms-es.txt", import.meta.url),
  "utf8"
)
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

// The A2 search: titles only, exact or prefix.
const before = (query: string) => {
  const wanted = foldTerm(query);
  return Object.values(pack).some(([term]) =>
    term
      .split(/,| o /)
      .map(foldTerm)
      .some((each) => each.startsWith(wanted))
  );
};

let started = performance.now();
const packsOnly = buildDictionaryIndex(pack, undefined, words);
const index = buildDictionaryIndex(pack, wiktionary, words);
const built = performance.now() - started;
// Each group's forms are read once, as file() does in the app.
const groups = new Map<string, Record<string, string[]> | undefined>();
const missing = {
  before: [] as string[],
  packs: [] as string[],
  term: [] as string[],
  any: [] as string[]
};
let searching = 0;
for (const query of terms) {
  const group = wiktionaryGroup(query);
  if (!groups.has(group)) groups.set(group, formsFor(wiktionary, query));
  started = performance.now();
  const hits = searchIndex(index, query, 60, groups.get(group));
  searching += performance.now() - started;
  if (!before(query)) missing.before.push(query);
  if (!searchIndex(packsOnly, query).some((hit) => hit.match === "term"))
    missing.packs.push(query);
  if (!hits.some((hit) => hit.match === "term")) missing.term.push(query);
  if (!hits.length) missing.any.push(query);
}
const perQuery = searching / terms.length;
const found = (list: string[]) =>
  `${terms.length - list.length}/${terms.length}`;
console.log(`A2 (título exacto o prefijo): ${found(missing.before)}`);
console.log(`Fase 3, por título: ${found(missing.packs)}`);
console.log(`con Wikcionario, por título: ${found(missing.term)}`);
console.log(`con Wikcionario y «Aparece en»: ${found(missing.any)}`);
console.log(
  `índices: ${built.toFixed(0)} ms; búsqueda: ${perQuery.toFixed(2)} ms`
);
console.log(`sin título en A2: ${missing.before.join(", ")}`);
console.log(`sin título en Fase 3: ${missing.packs.join(", ")}`);
console.log(`sin título ahora: ${missing.term.join(", ")}`);
console.log(`sin nada ahora: ${missing.any.join(", ")}`);
