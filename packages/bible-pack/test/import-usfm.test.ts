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
import { readVerses, type VerseRow } from "../scripts/import-usfm.ts";
import {
  versification,
  versificationOf
} from "../../scripture-provider/src/versification.ts";

// Each pack is read once: they are 13 MB of USFM apiece and every assertion
// looks at the rows.
const rows: VerseRow[] = [...readVerses()];
const bsb: VerseRow[] = [...readVerses("BSB")];
const kjv: VerseRow[] = [...readVerses("KJV")];
const pddpt: VerseRow[] = [...readVerses("PdDpt")];
const find =
  (from: VerseRow[]) => (book: string, chapter: number, verse: number) =>
    from.find(
      (row) =>
        row.book === book && row.chapter === chapter && row.verse === verse
    );
const at = find(rows);
const atBsb = find(bsb);
const atKjv = find(kjv);
const atPddpt = find(pddpt);

test("JHN 3:16 sale como fila limpia", () => {
  assert.deepEqual(at("JHN", 3, 16), {
    translationId: "VBL",
    book: "JHN",
    chapter: 3,
    verse: 16,
    text: "“Porque Dios amó al mundo, y lo hizo de esta manera: entregó a su único Hijo, a fin de que todos los que crean en él no mueran, sino que tengan vida eterna.",
    source: "pack"
  });
});

test("el pack cubre los 66 libros", () => {
  assert.equal(new Set(rows.map((row) => row.book)).size, 66);
  assert.equal(rows.length, 31086);
});

test("no queda marcado USFM en el texto", () => {
  const dirty = rows.filter((row) => /\\|\|strong=/.test(row.text));
  assert.deepEqual(
    dirty.map((row) => `${row.book} ${row.chapter}:${row.verse}`),
    []
  );
});

// VBL follows the critical text, so these verses carry only a footnote saying
// they are absent from the earliest manuscripts. No text means no row.
test("los 16 versos del texto critico no producen fila", () => {
  const omitted: [string, number, number][] = [
    ["MAT", 17, 21],
    ["MAT", 18, 11],
    ["MAT", 23, 14],
    ["MRK", 7, 16],
    ["MRK", 9, 44],
    ["MRK", 9, 46],
    ["MRK", 11, 26],
    ["MRK", 15, 28],
    ["LUK", 17, 36],
    ["LUK", 23, 17],
    ["JHN", 5, 4],
    ["ACT", 8, 37],
    ["ACT", 15, 34],
    ["ACT", 24, 7],
    ["ACT", 28, 29],
    ["ROM", 16, 24]
  ];
  for (const [book, chapter, verse] of omitted)
    assert.equal(
      at(book, chapter, verse),
      undefined,
      `${book} ${chapter}:${verse}`
    );
});

test("BSB: JHN 3:16 sale como fila limpia", () => {
  assert.deepEqual(atBsb("JHN", 3, 16), {
    translationId: "BSB",
    book: "JHN",
    chapter: 3,
    verse: 16,
    text: "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.",
    source: "pack"
  });
});

test("BSB: el pack cubre los 66 libros", () => {
  assert.equal(new Set(bsb.map((row) => row.book)).size, 66);
  assert.equal(bsb.length, 31086);
});

// BSB marks Strong's numbers on nearly every word, so this is the assertion
// that the \w ...|strong="G..."\w* markup is stripped down to the word.
test("BSB: no queda marcado USFM ni numeros de Strong en el texto", () => {
  const dirty = bsb.filter((row) => /\\|\|strong=/.test(row.text));
  assert.deepEqual(
    dirty.map((row) => `${row.book} ${row.chapter}:${row.verse}`),
    []
  );
});

test("KJV: JHN 3:16 sale como fila limpia", () => {
  assert.deepEqual(atKjv("JHN", 3, 16), {
    translationId: "KJV",
    book: "JHN",
    chapter: 3,
    verse: 16,
    text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
    source: "pack"
  });
});

// The apocrypha are left out of data/kjv: the parser, the store and the other
// packs all speak the 66-book canon.
test("KJV: el pack cubre los 66 libros", () => {
  assert.equal(new Set(kjv.map((row) => row.book)).size, 66);
  assert.deepEqual(
    [...new Set(kjv.map((row) => row.book))].filter(
      (book) => !new Set(bsb.map((row) => row.book)).has(book)
    ),
    []
  );
});

// KJV follows the received text, so it carries the 16 verses VBL omits: that
// is 31086 + 16.
test("KJV: trae los versos del texto recibido", () => {
  assert.equal(kjv.length, 31102);
  assert.match(atKjv("JHN", 5, 4)?.text ?? "", /^For an angel went down/);
});

test("KJV: los calderones no llegan al texto", () => {
  const pilcrows = kjv.filter((row) => row.text.includes("\u00b6"));
  assert.deepEqual(
    pilcrows.map((row) => `${row.book} ${row.chapter}:${row.verse}`),
    []
  );
});

test("PdDpt: JHN 3:16 sale como fila limpia", () => {
  assert.deepEqual(atPddpt("JHN", 3, 16), {
    translationId: "PdDpt",
    book: "JHN",
    chapter: 3,
    verse: 16,
    text: "Dios amó tanto al mundo que dio a su Hijo Unigénito, para que todo el que cree en Él no perezca, sino tenga vida eterna.",
    source: "pack"
  });
});

test("PdDpt: el pack cubre los 66 libros", () => {
  assert.equal(new Set(pddpt.map((row) => row.book)).size, 66);
  assert.deepEqual(
    [...new Set(pddpt.map((row) => row.book))].filter(
      (book) => !new Set(bsb.map((row) => row.book)).has(book)
    ),
    []
  );
});

// The source marks every word with its Strong's number and wraps the words of
// Jesus in nested \+w inside \wj. None of that is the verse.
test("PdDpt: no queda marcado USFM ni numeros de Strong en el texto", () => {
  const dirty = pddpt.filter((row) => /\\|\|strong=/.test(row.text));
  assert.deepEqual(
    dirty.map((row) => `${row.book} ${row.chapter}:${row.verse}`),
    []
  );
});

// This edition follows the critical text, like VBL, but says so differently:
// it brackets the disputed passage instead of dropping it, and writes the
// verse the earliest manuscripts lack as an empty [[ ]] pair. John 5:4 is one
// of those, so it must end with no row rather than a row reading "]]".
test("PdDpt: sigue el texto critico", () => {
  assert.equal(pddpt.length, 31061);
  assert.equal(atPddpt("JHN", 5, 4), undefined);
});

test("los corchetes editoriales no llegan al texto de ningun pack", () => {
  const bracketed = [...rows, ...bsb, ...kjv, ...pddpt].filter((row) =>
    /\[\[|\]\]/.test(row.text)
  );
  assert.deepEqual(
    bracketed.map(
      (row) => `${row.translationId} ${row.book} ${row.chapter}:${row.verse}`
    ),
    []
  );
});

// --- the versification each pack declares (ADR 0004, Paso 4.5) ---
// The tables in scripture-provider say how each translation numbers its
// verses. Nothing keeps a table honest except the pack it describes, so these
// read the pack and compare.

const packsById: Record<string, VerseRow[]> = {
  VBL: rows,
  BSB: bsb,
  KJV: kjv,
  PdDpt: pddpt
};

const lastVerseIn = (from: VerseRow[], book: string, chapter: number) =>
  Math.max(
    0,
    ...from
      .filter((row) => row.book === book && row.chapter === chapter)
      .map((row) => row.verse)
  );

// The three chapters where the four packs do not agree with one another.
// Every other chapter of every pack matches, which the next test states.
test("las tablas de versificación describen los packs", () => {
  const divergent: [string, number][] = [
    ["3JN", 1],
    ["REV", 12],
    ["2CO", 13]
  ];
  for (const [id, verses] of Object.entries(packsById)) {
    const table = versification(versificationOf(id));
    for (const [book, chapter] of divergent)
      assert.equal(
        lastVerseIn(verses, book, chapter),
        table.lastVerse.get(`${book} ${chapter}`),
        `${id} ${book} ${chapter}`
      );
  }
});

// A pack may hold fewer verses than its table — a translation that omits a
// verse on textual grounds writes no words for it — but never more. A verse
// number the table has never heard of means the table is wrong.
test("ningun pack numera mas alla de su tabla", () => {
  for (const [id, verses] of Object.entries(packsById)) {
    const table = versification(versificationOf(id));
    const beyond = verses.filter((row) => {
      const last = table.lastVerse.get(`${row.book} ${row.chapter}`);
      return last !== undefined && row.verse > last;
    });
    assert.deepEqual(
      beyond.map((row) => `${id} ${row.book} ${row.chapter}:${row.verse}`),
      []
    );
  }
});
