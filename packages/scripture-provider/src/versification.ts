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

import type { VerseRange } from "@notesnook/scripture-parser";
import { VRS_SOURCES } from "./versification-data.ts";

/**
 * ADR 0004: references are stored in one canonical versification and mapped to
 * whatever numbering a translation uses when the text is read. This is that
 * mapping, built from the `.vrs` tables Paratext and SIL publish.
 *
 * The canonical one is "eng", SIL's English versification. A0 wrote "default"
 * into the reference attribute before this existed; it means the same thing.
 */
export const CANONICAL_VRS = "eng";

/** A `.vrs` table, in the shape the mapping actually needs. */
export type Versification = {
  id: string;
  /** "BOOK chapter" -> the highest verse number that chapter has. */
  lastVerse: Map<string, number>;
  /** "BOOK chapter:verse" in this versification -> the same in "org". */
  toOrg: Map<string, string>;
  /** The reverse: "org" -> this versification. */
  fromOrg: Map<string, string>;
};

const COUNTS = /^([A-Z0-9]{3})((?:\s+\d+:\d+)+)\s*$/;
const MAPPING =
  /^([A-Z0-9]{3})\s+(\d+):(\d+)(?:-(\d+))?\s*=\s*([A-Z0-9]{3})\s+(\d+):(\d+)(?:-(\d+))?\s*$/;
const BASE = /^#!\s*base\s*=\s*([a-z]+)\s*$/;

const ref = (book: string, chapter: number, verse: number) =>
  `${book} ${chapter}:${verse}`;

/**
 * Reads one `.vrs` file over a base table. A file holds three kinds of line
 * that matter here: `BOOK 1:31 2:25 …` gives the last verse of every chapter,
 * `BOOK 3:1-8 = BOOK 3:2-9` maps this versification onto the original, and
 * `#! base = eng` says the file only amends another one. Everything else —
 * comments, the `-BOOK 1:2` lines naming verses a translation leaves out on
 * textual grounds — is not part of the mapping: a verse that exists and has
 * no words is the translation speaking, not a numbering difference.
 */
function parse(
  id: string,
  text: string,
  resolve: (id: string) => Versification
): Versification {
  const lines = text.split(/\r?\n/);
  const base = lines.map((line) => BASE.exec(line)).find(Boolean);
  const inherited = base ? resolve(base[1]) : undefined;

  const table: Versification = {
    id,
    lastVerse: new Map(inherited?.lastVerse),
    toOrg: new Map(inherited?.toOrg),
    fromOrg: new Map(inherited?.fromOrg)
  };

  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;

    const counts = COUNTS.exec(line);
    if (counts) {
      const [, book, rest] = counts;
      for (const entry of rest.trim().split(/\s+/)) {
        const [chapter, verse] = entry.split(":").map(Number);
        table.lastVerse.set(`${book} ${chapter}`, verse);
      }
      continue;
    }

    const mapping = MAPPING.exec(line);
    if (!mapping) continue;
    const [, book, chapter, from, fromEnd, orgBook, orgChapter, to, toEnd] =
      mapping;
    const span = Number(fromEnd ?? from) - Number(from);
    // A range maps verse by verse, and the two sides are the same length: the
    // file's own comment says a range may not cross a chapter.
    for (let offset = 0; offset <= span; offset++) {
      const own = ref(book, Number(chapter), Number(from) + offset);
      const org = ref(
        orgBook,
        Number(orgChapter),
        Number(to) + Math.min(offset, Number(toEnd ?? to) - Number(to))
      );
      // First line wins: a psalm title is written as two lines mapping verse 0
      // onto the original's verses 1 and 2, and the title is one verse here.
      if (!table.toOrg.has(own)) table.toOrg.set(own, org);
      if (!table.fromOrg.has(org)) table.fromOrg.set(org, own);
    }
  }

  return table;
}

const tables = new Map<string, Versification>();

/** The table for a versification id, parsed once. */
export function versification(id: string): Versification {
  const known = tables.get(id);
  if (known) return known;

  const source = VRS_SOURCES[id];
  if (!source) throw new Error(`versificación desconocida: ${id}`);
  const table = parse(id, source, versification);
  tables.set(id, table);
  return table;
}

/** What a translation numbers its verses by. Anything unknown is canonical. */
export function versificationOf(translationId: string): string {
  return VRS_OF_TRANSLATION[translationId] || CANONICAL_VRS;
}

/**
 * Which table each translation follows. Every entry was measured against the
 * translation itself, not taken from a catalogue: `test/versification.test.ts`
 * checks the packs, and the four brand cases are recorded in the runbook.
 */
export const VRS_OF_TRANSLATION: Record<string, string> = {
  VBL: "kjv",
  BSB: "bsb",
  KJV: "kjv",
  PdDpt: "pddpt",
  NTV: "eng",
  NBLA: "lockman",
  NASB: "lockman"
};

/**
 * Moves one verse number from one versification to another, through "org" the
 * way the `.vrs` files are written to be used.
 *
 * A verse past the end of the target's chapter is the ordinary case of a
 * translation joining what another splits — English 3 John 15 in a Bible that
 * ends at 14 — so it reads as that chapter's last verse rather than as
 * nothing. A verse that exists and is simply empty is left alone: that is the
 * translation omitting words, which is not a numbering question.
 */
export function mapVerse(
  book: string,
  chapter: number,
  verse: number,
  from: string,
  to: string
): { chapter: number; verse: number } {
  if (from === to) return { chapter, verse };

  const source = versification(from);
  const target = versification(to);
  const org = source.toOrg.get(ref(book, chapter, verse));
  const mapped = target.fromOrg.get(org ?? ref(book, chapter, verse));
  const [movedChapter, movedVerse] = (
    mapped ??
    org ??
    ref(book, chapter, verse)
  )
    .split(" ")[1]
    .split(":")
    .map(Number);

  const last = target.lastVerse.get(`${book} ${movedChapter}`);
  return {
    chapter: movedChapter,
    verse: last !== undefined && movedVerse > last ? last : movedVerse
  };
}

/**
 * The same range, numbered the way `translationId` numbers it. This is what
 * every provider calls before it looks a verse up.
 */
export function toTranslation(
  range: VerseRange,
  translationId: string
): VerseRange {
  const to = versificationOf(translationId);
  // A0 stored "default"; it was always this table under another name.
  const from =
    !range.versification || range.versification === "default"
      ? CANONICAL_VRS
      : range.versification;
  if (from === to) return range;

  const start = mapVerse(range.book, range.chapter, range.verse, from, to);
  const end =
    range.endVerse === undefined
      ? undefined
      : mapVerse(
          range.book,
          range.endChapter ?? range.chapter,
          range.endVerse,
          from,
          to
        );

  return {
    ...range,
    versification: to,
    chapter: start.chapter,
    verse: start.verse,
    ...(end
      ? {
          endChapter:
            range.endChapter === undefined && end.chapter === start.chapter
              ? undefined
              : end.chapter,
          endVerse: end.verse
        }
      : {})
  };
}
