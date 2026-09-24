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
import {
  CANONICAL_VRS,
  mapVerse,
  toTranslation,
  versification,
  versificationOf
} from "../src/versification.ts";

const map = (
  book: string,
  chapter: number,
  verse: number,
  to: string,
  from = CANONICAL_VRS
) => mapVerse(book, chapter, verse, from, to);

// --- the four cases ADR 0004 names ---

// In the original the psalm's title is verse 1, so everything after it is two
// numbers further along. This is the case that makes a canonical versification
// necessary at all.
test("títulos de Salmos: el canónico y el original no coinciden", () => {
  assert.deepEqual(map("PSA", 51, 1, "org"), { chapter: 51, verse: 3 });
  assert.deepEqual(map("PSA", 51, 19, "org"), { chapter: 51, verse: 21 });
  // And back: the original's first two verses are the title, which the
  // canonical numbering does not number at all.
  assert.deepEqual(mapVerse("PSA", 51, 3, "org", CANONICAL_VRS), {
    chapter: 51,
    verse: 1
  });
  assert.deepEqual(mapVerse("PSA", 51, 1, "org", CANONICAL_VRS), {
    chapter: 51,
    verse: 0
  });
});

// The Hebrew text has three chapters of Malachi; the canonical numbering
// breaks the third in two.
test("Malaquías: cuatro capítulos aquí, tres en el original", () => {
  assert.deepEqual(map("MAL", 4, 1, "org"), { chapter: 3, verse: 19 });
  assert.deepEqual(map("MAL", 4, 6, "org"), { chapter: 3, verse: 24 });
  assert.deepEqual(map("MAL", 3, 18, "org"), { chapter: 3, verse: 18 });
});

// 3 John is the case our own packs disagree about: the KJV tradition has
// fourteen verses, and what the canonical numbering calls 15 is the tail of
// its 14.
test("3 Juan: el verso 15 canónico es el 14 de la tradición KJV", () => {
  assert.deepEqual(map("3JN", 1, 15, "kjv"), { chapter: 1, verse: 14 });
  assert.deepEqual(map("3JN", 1, 14, "kjv"), { chapter: 1, verse: 14 });
  // Nothing moves for a translation that numbers fifteen, like the original.
  assert.deepEqual(map("3JN", 1, 15, "org"), { chapter: 1, verse: 15 });
});

// Romans 16 is where the doxology wanders in some traditions. In every
// versification Epigrapho carries it stays put, and the test says so rather
// than leaving the case untested.
test("Romanos 16: la doxología no se mueve en ninguna de nuestras tablas", () => {
  for (const to of ["org", "kjv", "lockman", "pddpt"])
    assert.deepEqual(map("ROM", 16, 25, to), { chapter: 16, verse: 25 }, to);
});

// --- the two cases measuring the packs turned up, which the runbook did not
// name and which would have shown the wrong verse ---

test("Apocalipsis 12:18 canónico abre el capítulo 13 en la tradición KJV", () => {
  assert.deepEqual(map("REV", 12, 18, "kjv"), { chapter: 13, verse: 1 });
  assert.deepEqual(map("REV", 12, 18, "lockman"), { chapter: 13, verse: 1 });
  // BSB ends chapter 12 at the same verse but keeps the sentence inside it,
  // so the same reference lands one verse earlier. Measured, not assumed:
  // its 12:17 closes with "And the dragon stood on the shore of the sea".
  assert.deepEqual(map("REV", 12, 18, "bsb"), { chapter: 12, verse: 17 });
  // The verse before it, and the one after, are where they look.
  assert.deepEqual(map("REV", 12, 17, "kjv"), { chapter: 12, verse: 17 });
  assert.deepEqual(map("REV", 13, 1, "kjv"), { chapter: 13, verse: 1 });
});

test("2 Corintios 13:14 canónico es el 13:13 de PdDpt", () => {
  assert.deepEqual(map("2CO", 13, 14, "pddpt"), { chapter: 13, verse: 13 });
  assert.deepEqual(map("2CO", 13, 13, "pddpt"), { chapter: 13, verse: 13 });
  // The translations that number fourteen keep theirs.
  assert.deepEqual(map("2CO", 13, 14, "kjv"), { chapter: 13, verse: 14 });
});

// --- the wiring ---

test("cada traducción declara una tabla que existe", () => {
  for (const id of ["VBL", "BSB", "KJV", "PdDpt", "NTV", "NBLA", "NASB"])
    assert.ok(versification(versificationOf(id)).lastVerse.size > 1000, id);
  // An id nobody declared is read as canonical rather than as an error: a
  // verse shown under the wrong number beats a verse not shown at all.
  assert.equal(versificationOf("desconocida"), CANONICAL_VRS);
});

test('toTranslation entiende el "default" que escribió A0', () => {
  const stored = {
    book: "3JN",
    chapter: 1,
    verse: 15,
    versification: "default"
  };
  assert.deepEqual(toTranslation(stored, "VBL"), {
    book: "3JN",
    chapter: 1,
    verse: 14,
    versification: "kjv"
  });
  // A translation already in the canonical numbering is handed back untouched,
  // object and all: nothing to map means nothing to copy.
  const range = { book: "JHN", chapter: 3, verse: 16, versification: "eng" };
  assert.equal(toTranslation(range, "NTV"), range);
});

test("toTranslation mueve los dos extremos de un rango", () => {
  assert.deepEqual(
    toTranslation(
      {
        book: "REV",
        chapter: 12,
        verse: 17,
        endVerse: 18,
        versification: "eng"
      },
      "KJV"
    ),
    {
      book: "REV",
      chapter: 12,
      verse: 17,
      endChapter: 13,
      endVerse: 1,
      versification: "kjv"
    }
  );
});

test("las tablas estándar traen los 66 libros y sus mapeos", () => {
  const eng = versification("eng");
  const org = versification("org");
  assert.ok(eng.toOrg.size > 500, `mapeos eng: ${eng.toOrg.size}`);
  // The original maps nothing in the 66 books: it is the pivot. Its only
  // mapping lines are deuterocanonical (the Song of the Three onto Daniel),
  // which no translation Epigrapho carries has.
  assert.equal(org.toOrg.get("PSA 51:1"), undefined);
  assert.equal(org.toOrg.get("MAL 3:19"), undefined);
  assert.equal(eng.lastVerse.get("PSA 119"), 176);
  assert.equal(eng.lastVerse.get("3JN 1"), 15);
  assert.equal(versification("kjv").lastVerse.get("3JN 1"), 14);
  // The amendment file changes one chapter and inherits the rest.
  assert.equal(versification("kjv").lastVerse.get("PSA 119"), 176);
});
