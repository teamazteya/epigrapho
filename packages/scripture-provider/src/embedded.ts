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
import type { ScriptureTextProvider, VerseTextOptions } from "./provider";
import { mapVerse, toTranslation, versificationOf } from "./versification.ts";

export const VERSES_DB = "epigrapho-scripture";
export const VERSES_STORE = "verses";
/** The headings between verses (A7), one row each, in reading order. */
export const HEADINGS_STORE = "headings";

export type HeadingKind = "s1" | "s2" | "d" | "sp";

export type Heading = {
  chapter: number;
  /** The verse the heading stands before. */
  verse: number;
  kind: HeadingKind;
  text: string;
};

export type HeadingRow = Heading & {
  translationId: string;
  book: string;
  /** Several headings can stand before one verse; this keeps their order. */
  order: number;
};

/**
 * Translations whose packs carry no section titles borrow them from another
 * of the same language (A7). Only s1 and s2 are borrowed: a psalm's title
 * (d) and who speaks (sp) always come from the translation being read.
 */
export const HEADINGS_FROM: Record<string, string> = {
  VBL: "PdDpt",
  KJV: "BSB"
};

/** The translation a translation's section titles come from, when borrowed. */
export function headingSourceOf(translationId: string): string | undefined {
  return HEADINGS_FROM[translationId];
}

/**
 * The one way to open the verses database, for the loading half (packs.ts)
 * and the reading half (this file) alike: two opens asking for different
 * versions fail. Version 2 added the headings store (A7).
 */
export function openVersesDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(VERSES_DB, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VERSES_STORE))
        db.createObjectStore(VERSES_STORE, {
          keyPath: ["translationId", "book", "chapter", "verse"]
        });
      if (!db.objectStoreNames.contains(HEADINGS_STORE))
        db.createObjectStore(HEADINGS_STORE, {
          keyPath: ["translationId", "book", "chapter", "verse", "order"]
        });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type VerseRow = {
  translationId: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  source: string;
};

/** One book's verses, keyed by "chapter:verse". */
type Book = Map<string, string>;

// Books are cached for the life of the page: a note tends to quote the same
// handful of books over and over.
const books = new Map<string, Promise<Book>>();
const bookHeadings = new Map<string, Promise<Heading[]>>();

async function loadHeadings(
  translationId: string,
  book: string
): Promise<Heading[]> {
  const db = await openVersesDb();
  try {
    return await new Promise<Heading[]>((resolve, reject) => {
      const request = db
        .transaction(HEADINGS_STORE, "readonly")
        .objectStore(HEADINGS_STORE)
        .getAll(
          IDBKeyRange.bound([translationId, book], [translationId, book, []])
        ) as IDBRequest<HeadingRow[]>;
      // Key order is chapter, verse, order: already reading order.
      request.onsuccess = () =>
        resolve(
          request.result.map(({ chapter, verse, kind, text }) => ({
            chapter,
            verse,
            kind,
            text
          }))
        );
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

function headingsOf(translationId: string, book: string) {
  const key = `${translationId}:${book}`;
  let found = bookHeadings.get(key);
  if (!found) {
    found = loadHeadings(translationId, book);
    bookHeadings.set(key, found);
    // Not kept while empty: on the first start after updating, the headings
    // are still being stored when the first verse is shown.
    void found.then(
      (headings) => headings.length || bookHeadings.delete(key),
      () => bookHeadings.delete(key)
    );
  }
  return found;
}

const isSection = (heading: Heading) =>
  heading.kind === "s1" || heading.kind === "s2";

/**
 * The headings a translation shows in one book, numbered the way it numbers
 * its verses: its own, plus the section titles it borrows (HEADINGS_FROM),
 * moved onto its numbering. A borrowed title is dropped where the translation
 * has a psalm title or a speaker of its own: PdDpt writes psalm titles and
 * the Song's speakers ("Ella", "Él") as section titles, and VBL would show
 * "Salmo de David" twice.
 */
export async function headingsFor(
  translationId: string,
  book: string
): Promise<Heading[]> {
  const own = await headingsOf(translationId, book);
  const source = headingSourceOf(translationId);
  if (!source) return own;
  return borrowHeadings(
    translationId,
    book,
    own,
    await headingsOf(source, book)
  );
}

/** headingsFor without the database, so a test can feed it the packs. */
export function borrowHeadings(
  translationId: string,
  book: string,
  own: Heading[],
  lent: Heading[]
): Heading[] {
  const source = headingSourceOf(translationId);
  if (!source) return own;
  const from = versificationOf(source);
  const to = versificationOf(translationId);
  const titled = new Set(
    own
      .filter((heading) => !isSection(heading))
      .map((heading) => `${heading.chapter}:${heading.verse}`)
  );
  const borrowed = lent
    .filter(isSection)
    .map((heading) => ({
      ...heading,
      ...mapVerse(book, heading.chapter, heading.verse, from, to)
    }))
    .filter((heading) => !titled.has(`${heading.chapter}:${heading.verse}`));
  return mergeHeadings(
    borrowed,
    own.filter((heading) => !isSection(heading))
  );
}

/** Reading order; at the same verse a section title goes before a psalm's. */
export function mergeHeadings(sections: Heading[], others: Heading[]) {
  const at = (heading: Heading) => heading.chapter * 1e4 + heading.verse;
  return [...sections, ...others]
    .map((heading, index) => ({ heading, index }))
    .sort((a, b) => at(a.heading) - at(b.heading) || a.index - b.index)
    .map(({ heading }) => heading);
}

async function loadBook(translationId: string, book: string): Promise<Book> {
  const db = await openVersesDb();
  try {
    const rows = await new Promise<VerseRow[]>((resolve, reject) => {
      // An array sorts after any number in IndexedDB key order, so [id, book, []]
      // is an upper bound past every [id, book, chapter, verse] of this book.
      const request = db
        .transaction(VERSES_STORE, "readonly")
        .objectStore(VERSES_STORE)
        .getAll(
          IDBKeyRange.bound([translationId, book], [translationId, book, []])
        ) as IDBRequest<VerseRow[]>;
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Map(
      rows.map((row) => [`${row.chapter}:${row.verse}`, row.text])
    );
  } finally {
    db.close();
  }
}

/** Drops the in-memory cache. Only needed after reloading the pack. */
export function clearBookCache() {
  books.clear();
  bookHeadings.clear();
}

/**
 * Returns the text a reference points at, reading it from the offline pack.
 * Loads lazily, one book at a time.
 *
 * An empty string means the translation has no text there. That is a real case,
 * not an error: VBL follows the critical text, so verses such as JHN 5:4 exist
 * as a reference but carry no words.
 */
export async function getVerseText(
  canonical: VerseRange,
  translationId: string,
  options?: VerseTextOptions
): Promise<string> {
  // The reference is stored canonically; the pack is numbered the way its
  // translation numbers verses (ADR 0004).
  const ref = toTranslation(canonical, translationId);
  const key = `${translationId}:${ref.book}`;
  let book = books.get(key);
  if (!book) {
    book = loadBook(translationId, ref.book);
    books.set(key, book);
  }
  const verses = await book;
  if (!options?.headings) return textInRange(verses, ref);
  return textInRange(verses, ref, await headingsFor(translationId, ref.book));
}

/** How a heading is written among verse lines: "[§s1] The Creation". */
export function headingLine(heading: Pick<Heading, "kind" | "text">) {
  return `[§${heading.kind}] ${heading.text}`;
}

/**
 * Joins the verses a range spans, across chapters too. Walks the book in
 * order instead of counting verses, because a chapter's last verse is not
 * known here and verses without words (JHN 5:4 in VBL) leave gaps.
 *
 * With headings (A7), each goes before its verse, and the range opens with
 * the section it falls in: the last section title at or before its first
 * verse, and the last subtitle under that title, even when the section starts
 * earlier. A psalm's title and who speaks are not carried that way: they
 * belong to the verse they stand before.
 */
export function textInRange(
  verses: Book,
  ref: VerseRange,
  headings: Heading[] = []
): string {
  const endChapter = ref.endChapter ?? ref.chapter;
  const endVerse = ref.endChapter
    ? ref.endVerse ?? Infinity
    : Math.max(ref.endVerse ?? ref.verse, ref.verse);
  const start = ref.chapter * 1e4 + ref.verse;
  const end = endChapter * 1e4 + endVerse;
  const atOf = (heading: Heading) => heading.chapter * 1e4 + heading.verse;

  let title: Heading | undefined;
  let subtitle: Heading | undefined;
  for (const heading of headings) {
    const at = atOf(heading);
    if (at > start) break;
    // One standing over the first verse is shown there, in its place, and
    // replaces what the range would otherwise carry in.
    if (heading.kind === "s1") {
      title = at < start ? heading : undefined;
      subtitle = undefined;
    } else if (heading.kind === "s2")
      subtitle = at < start ? heading : undefined;
    else {
      // A psalm's title, or a new speaker, opens a new unit: a section that
      // began before it does not run on into it (Psalm 23 is not under the
      // "Prologue" of Psalm 1).
      if (title && atOf(title) < at) title = undefined;
      if (subtitle && atOf(subtitle) < at) subtitle = undefined;
    }
  }
  const text: string[] = [title, subtitle]
    .filter((heading): heading is Heading => !!heading)
    .map(headingLine);

  let next = headings.findIndex((heading) => atOf(heading) >= start);
  if (next < 0) next = headings.length;
  for (const [key, found] of verses) {
    const [chapter, verse] = key.split(":").map(Number);
    const at = chapter * 1e4 + verse;
    if (at < start || at > end || !found) continue;
    // Up to this verse, so a heading over a verse without words (JHN 5:4)
    // lands on the next one instead of being lost.
    while (next < headings.length && atOf(headings[next]) <= at)
      text.push(headingLine(headings[next++]));
    text.push(`[${verse}] ${found}`);
  }
  return text.join("\n");
}

/** The embedded layer as a provider (ADR 0002). */
export const embeddedProvider: ScriptureTextProvider = { getVerseText };
