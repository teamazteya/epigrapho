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

// The headings of A7 against the real packs: read straight from the USFM, so
// no IndexedDB is needed. What only the database does — loading headings into
// an install from before A7 — is checked in Electron (a7-headings-db-check).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { VerseRange } from "@notesnook/scripture-parser";
import {
  readHeadings,
  readVerses
} from "../../bible-pack/scripts/import-usfm.ts";
import { borrowHeadings, textInRange, type Heading } from "../src/embedded.ts";
import { headingsCreditOf } from "../src/provenance.ts";
import { toTranslation } from "../src/versification.ts";

const cache = new Map<
  string,
  { verses: Map<string, Map<string, string>>; headings: Map<string, Heading[]> }
>();

function pack(translationId: string) {
  let found = cache.get(translationId);
  if (found) return found;
  const verses = new Map<string, Map<string, string>>();
  for (const row of readVerses(translationId)) {
    if (!verses.has(row.book)) verses.set(row.book, new Map());
    verses.get(row.book)!.set(`${row.chapter}:${row.verse}`, row.text);
  }
  const headings = new Map<string, Heading[]>();
  for (const { book, ...heading } of readHeadings(translationId)) {
    if (!headings.has(book)) headings.set(book, []);
    headings.get(book)!.push(heading);
  }
  found = { verses, headings };
  cache.set(translationId, found);
  return found;
}

/** What getVerseText with { headings: true } does, minus the database. */
function read(translationId: string, canonical: VerseRange, headings = true) {
  const ref = toTranslation(canonical, translationId);
  const own = pack(translationId);
  const verses = own.verses.get(ref.book)!;
  if (!headings) return textInRange(verses, ref);
  const lenders: Record<string, string> = { VBL: "PdDpt", KJV: "BSB" };
  const lent = lenders[translationId]
    ? pack(lenders[translationId]).headings.get(ref.book) ?? []
    : [];
  return textInRange(
    verses,
    ref,
    borrowHeadings(
      translationId,
      ref.book,
      own.headings.get(ref.book) ?? [],
      lent
    )
  );
}

const lines = (text: string) =>
  text.split("\n").map((line) => line.slice(0, 40));
const JHN_3_16: VerseRange = { book: "JHN", chapter: 3, verse: 16 };

test("BSB: JHN 3:16 lleva el título de su sección aunque empiece en 3:1", () => {
  const [first, second] = lines(read("BSB", JHN_3_16));
  assert.equal(first, "[§s1] Jesus and Nicodemus");
  assert.match(second, /^\[16\] /);
});

test("VBL toma el título de sección de PdDpt", () => {
  assert.deepEqual(lines(read("VBL", JHN_3_16)).slice(0, 1), [
    "[§s1] El amor de Dios"
  ]);
});

test("KJV toma el título de sección de BSB", () => {
  assert.equal(lines(read("KJV", JHN_3_16))[0], "[§s1] Jesus and Nicodemus");
});

test("VBL: el Salmo 23 lleva su propio título, sin repetir el de PdDpt", () => {
  const text = read("VBL", { book: "PSA", chapter: 23, verse: 1, endVerse: 6 });
  const headings = text.split("\n").filter((line) => line.startsWith("[§"));
  assert.deepEqual(headings, ["[§d] Un Salmo de David."]);
});

test("el título de un salmo no se arrastra a un versículo posterior", () => {
  const text = read("BSB", { book: "PSA", chapter: 23, verse: 3 });
  assert.deepEqual(
    text.split("\n").filter((line) => line.startsWith("[§")),
    ["[§s1] The LORD Is My Shepherd"]
  );
});

test("VBL: Cantares 1:15 dice quién habla", () => {
  assert.equal(
    lines(read("VBL", { book: "SNG", chapter: 1, verse: 15 }))[0],
    "[§sp] Hombre:"
  );
});

test("BSB: GEN 1:4 lleva el título y el subtítulo de su sección", () => {
  assert.deepEqual(
    lines(read("BSB", { book: "GEN", chapter: 1, verse: 4 })).slice(0, 2),
    ["[§s1] The Creation", "[§s2] The First Day"]
  );
});

test("un rango que cruza capítulos pone cada título en su lugar", () => {
  const text = read("BSB", {
    book: "GEN",
    chapter: 1,
    verse: 1,
    endChapter: 2,
    endVerse: 3
  });
  const all = text.split("\n");
  assert.equal(all[0], "[§s1] The Creation");
  assert.equal(all[1].slice(0, 4), "[1] ");
  const day = all.indexOf("[§s2] The First Day");
  assert.ok(day > 0 && all[day + 1].startsWith("[3] "));
  // BSB marks the seventh day as a section of its own, before 2:1.
  const seventh = all.indexOf("[§s1] The Seventh Day");
  assert.ok(seventh > 0 && all[seventh + 1].startsWith("[1] "));
  assert.equal(all.filter((line) => line.startsWith("[§s2]")).length, 6);
  assert.ok(!all.includes("[§s1] Man and Woman in the Garden"));
});

test("sin títulos el texto es el de siempre", () => {
  for (const translationId of ["VBL", "BSB", "KJV", "PdDpt"]) {
    const plain = read(translationId, JHN_3_16, false);
    assert.ok(!plain.includes("[§"));
    assert.equal(
      read(translationId, JHN_3_16)
        .split("\n")
        .filter((l) => !l.startsWith("[§"))
        .join("\n"),
      plain
    );
  }
});

test("un título sobre un versículo sin palabras pasa al siguiente", () => {
  const verses = new Map([
    ["5:3", "a"],
    ["5:4", ""],
    ["5:5", "c"]
  ]);
  assert.equal(
    textInRange(verses, { book: "JHN", chapter: 5, verse: 3, endVerse: 5 }, [
      { chapter: 5, verse: 4, kind: "s1", text: "T" }
    ]),
    "[3] a\n[§s1] T\n[5] c"
  );
});

test("el crédito de los títulos prestados va en el idioma de la traducción", () => {
  assert.equal(headingsCreditOf("VBL"), "Títulos: PdDpt");
  assert.equal(headingsCreditOf("KJV"), "Headings: BSB");
  assert.equal(headingsCreditOf("BSB"), undefined);
  assert.equal(headingsCreditOf("NTV"), undefined);
});
