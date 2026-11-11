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

import assert from "node:assert/strict";
import { test } from "node:test";
import type { DictionaryPack, TranslationWordsPack } from "../src/pack.ts";
import { buildSpellTerms, namesOf } from "../scripts/spell-terms.ts";

const verses = [
  "Y Melquisedec, rey de Salem, sacó pan y vino.",
  "Entonces Jesús fue con ellos a Getsemaní, y dijo: Sentaos aquí.",
  "Pues Melquisedec era sacerdote. Y Jesús oró en Getsemaní.",
  "Comieron uvas y pan. El Señor es mi pastor; mi señor el rey."
];

test("spell terms: names the VBL capitalises mid-sentence, twice", () => {
  const { names } = namesOf(verses);
  assert.deepEqual(names.sort(), ["Getsemaní", "Jesús", "Melquisedec"]);
});

test("spell terms: modern spellings win, common words stay out", () => {
  const rand = {
    aaron: ["Aaron", ""],
    uvas: ["Uvas", ""],
    salem: ["Salem", ""]
  } as unknown as DictionaryPack;
  const words = {
    "names/aaron": ["Aarón", ""],
    "kt/grace": ["gracia, misericordioso", ""]
  } as unknown as TranslationWordsPack;
  const list = buildSpellTerms(verses, rand, words, {
    biblical: ["Nabucodonosor"]
  });
  for (const word of ["Aarón", "Melquisedec", "Nabucodonosor", "Salem"])
    assert.ok(list.includes(word), word);
  for (const word of ["Aaron", "Uvas", "El"])
    assert.ok(!list.includes(word), word);
  assert.deepEqual(list, [...list].sort());
});
