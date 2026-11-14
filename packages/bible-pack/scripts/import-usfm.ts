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

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { attributionOf } from "../../scripture-provider/src/provenance.ts";

export type VerseRow = {
  translationId: string;
  /** USFM book code, e.g. "JHN". */
  book: string;
  chapter: number;
  verse: number;
  text: string;
  source: "pack";
};

/**
 * The packs this script builds, from the translation id verses are stored
 * under to the folder holding its USFM. Both come from ebible.org and follow
 * the same file layout, so one reader serves them.
 */
export const SOURCES: Record<string, string> = {
  VBL: "vbl",
  BSB: "bsb",
  KJV: "kjv",
  PdDpt: "pddpt"
};

const dirOf = (translationId: string) =>
  fileURLToPath(new URL(`../data/${SOURCES[translationId]}/`, import.meta.url));

// Lines opened by these markers are headings, titles or front matter: they sit
// between verses and their text belongs to no verse.
const HEADING =
  /^\\(id|ide|h|toc\d?|mt\d?|mte\d?|ms\d?|mr|s\d?|sr|sp|r|d|qa|cl|cp|rem|ip|ib|io\d?|iot|is\d?|imt\d?)\b/;

// Anything else opening a line is a paragraph or poetry marker, and its text
// continues whichever verse is currently open.
const LINE_MARKER = /^\\(?!v\b)[a-z]+\d*\s*/;

const VERSE = /\\v (\d+)\s?/g;

/** Turns one verse's raw USFM into the text a reader should see. */
export function cleanVerseText(usfm: string) {
  return (
    usfm
      // Footnotes and cross references are apparatus, not scripture text.
      // [\s\S] rather than the `s` flag: the repo compiles down to es2016.
      .replace(/\\(f|fe|x)\s[\s\S]*?\\\1\*/g, "")
      // Word-level markup keeps the word and drops the Strong's attributes.
      .replace(/\\\+?w\s([^|\\]*?)(\|[^\\]*?)?\\\+?w\*/g, "$1")
      // The KJV text carries the traditional pilcrows as characters, not as
      // markup: they open a paragraph, they are not words of the verse.
      .replace(/¶\s*/g, "")
      // Double brackets are the editors' way of marking a passage the earliest
      // manuscripts do not carry. They are notation, not words, and a verse
      // whose whole content is a closing bracket (PdDpt writes John 5:4 that
      // way) is left empty on purpose, so no row is written for it.
      .replace(/\[\[|\]\]/g, "")
      // Any other character style: keep the text, drop the markers.
      .replace(/\\\+?[a-z]+\d*\*/g, "")
      .replace(/\\\+?[a-z]+\d*\s?/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Reads every book of a translation and yields one row per verse, in order. */
export function* readVerses(translationId = "VBL"): Generator<VerseRow> {
  const dir = dirOf(translationId);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".usfm"))
    .sort();

  for (const file of files) {
    let book = "";
    let chapter = 0;
    let verse = 0;
    let raw = "";

    function* flush(): Generator<VerseRow> {
      const text = cleanVerseText(raw);
      raw = "";
      if (verse && text)
        yield {
          translationId,
          book,
          chapter,
          verse,
          text,
          source: "pack"
        };
    }

    for (const line of readFileSync(dir + file, "utf8").split("\n")) {
      const id = /^\\id (\w+)/.exec(line);
      if (id) {
        book = id[1];
        continue;
      }
      // The front matter file has no verses.
      if (!book || book === "FRT") break;

      const chapterStart = /^\\c (\d+)/.exec(line);
      if (chapterStart) {
        yield* flush();
        chapter = Number(chapterStart[1]);
        verse = 0;
        continue;
      }
      if (HEADING.test(line)) continue;

      const content = line.replace(LINE_MARKER, "");
      VERSE.lastIndex = 0;
      let cursor = 0;
      let match: RegExpExecArray | null;
      while ((match = VERSE.exec(content))) {
        raw += " " + content.slice(cursor, match.index);
        yield* flush();
        verse = Number(match[1]);
        cursor = VERSE.lastIndex;
      }
      raw += " " + content.slice(cursor);
    }
    yield* flush();
  }
}

/**
 * The headings a reader sees between verses (A7): a section title (s1), a
 * subtitle (s2), a psalm's title (d) and who speaks (sp, the Song of Songs).
 * Parallel passages (r) and major sections (ms, mr) stay out.
 */
export type HeadingKind = "s1" | "s2" | "d" | "sp";

export type HeadingRow = {
  book: string;
  chapter: number;
  /** The verse the heading stands before. */
  verse: number;
  kind: HeadingKind;
  text: string;
};

const HEADING_KIND = /^\\(s1?|s2|d|sp)\s+(.*)$/;

/**
 * KJV marks the letters of Psalm 119 (\s1 ALEPH, \s1 BETH…) as section
 * titles; they are not, and KJV takes its section titles from BSB instead.
 */
const NO_SECTION_TITLES = new Set(["KJV"]);

/**
 * Reads every heading of a translation, in order, each tied to the first
 * verse after it. A heading closing a chapter goes with the next chapter's
 * first verse; one after a book's last verse belongs to nothing and is left
 * out. No heading line carries a verse in these sources (checked on the
 * 2026-11-14 copies), so headings are read line by line.
 */
export function* readHeadings(translationId = "VBL"): Generator<HeadingRow> {
  const dir = dirOf(translationId);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".usfm"))
    .sort();
  const sections = !NO_SECTION_TITLES.has(translationId);

  for (const file of files) {
    let book = "";
    let chapter = 0;
    let pending: { kind: HeadingKind; text: string }[] = [];

    for (const line of readFileSync(dir + file, "utf8").split("\n")) {
      const id = /^\\id (\w+)/.exec(line);
      if (id) {
        book = id[1];
        continue;
      }
      if (!book || book === "FRT") break;

      const chapterStart = /^\\c (\d+)/.exec(line);
      if (chapterStart) {
        chapter = Number(chapterStart[1]);
        continue;
      }
      const heading = HEADING_KIND.exec(line.trimEnd());
      if (heading) {
        const kind = (heading[1] === "s" ? "s1" : heading[1]) as HeadingKind;
        const text = cleanVerseText(heading[2]);
        if (text && (sections || (kind !== "s1" && kind !== "s2")))
          pending.push({ kind, text });
        continue;
      }
      if (!pending.length) continue;
      const verse = /\\v (\d+)/.exec(line);
      if (!verse) continue;
      for (const { kind, text } of pending)
        yield { book, chapter, verse: Number(verse[1]), kind, text };
      pending = [];
    }
  }
}

/**
 * The compact shape shipped to the app: `translationId` is implicit and every
 * verse is a tuple, which keeps the file a third of the size of full rows.
 */
export type VersePack = {
  translationId: string;
  license: string;
  verses: [book: string, chapter: number, verse: number, text: string][];
  /** In reading order; several can stand before the same verse. */
  headings: [
    book: string,
    chapter: number,
    verse: number,
    kind: HeadingKind,
    text: string
  ][];
};

export function buildPack(translationId = "VBL"): VersePack {
  return {
    translationId,
    license: attributionOf(translationId),
    verses: [...readVerses(translationId)].map((row) => [
      row.book,
      row.chapter,
      row.verse,
      row.text
    ]),
    headings: [...readHeadings(translationId)].map((row) => [
      row.book,
      row.chapter,
      row.verse,
      row.kind,
      row.text
    ])
  };
}

// ponytail: no CLI parser. Either `--build <folder> [<folder>…]`, which writes
// one <id>.json per translation into every folder given, or a reference like
// "JHN 3:16" plus an optional translation id.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--build") {
    // Every app that shows a verse offline needs the same packs: the web and
    // desktop builds serve them, the mobile editor ships them beside itself.
    const folders = process.argv.slice(3);
    if (!folders.length) {
      console.error("uso: import-usfm.ts --build <carpeta> [<carpeta>…]");
      process.exit(1);
    }
    for (const translationId of Object.keys(SOURCES)) {
      const pack = buildPack(translationId);
      const json = JSON.stringify(pack);
      for (const out of folders) {
        const file = `${out}/${translationId.toLowerCase()}.json`;
        writeFileSync(file, json);
        console.error(
          `${pack.verses.length} versos y ${pack.headings.length} títulos escritos en ${file}`
        );
      }
    }
    process.exit(0);
  }

  const wanted = process.argv[2] ?? "JHN 3:16";
  const translationId = process.argv[3] ?? "VBL";
  const [book, rest] = wanted.split(/\s+/);
  const [chapter, verse] = (rest ?? "").split(":").map(Number);

  let total = 0;
  let row: VerseRow | undefined;
  for (const candidate of readVerses(translationId)) {
    total++;
    if (
      candidate.book === book &&
      candidate.chapter === chapter &&
      candidate.verse === verse
    )
      row = candidate;
  }

  console.error(`${total} versos leidos de ${SOURCES[translationId]}`);
  if (!row) {
    console.error(`no se encontro ${wanted}`);
    process.exit(1);
  }
  console.log(JSON.stringify(row, null, 2));
}
