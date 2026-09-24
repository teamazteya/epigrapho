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
import type { ScriptureTextProvider } from "./provider";
import { toTranslation } from "./versification.ts";

export const VERSES_DB = "epigrapho-scripture";
export const VERSES_STORE = "verses";

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

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(VERSES_DB, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(VERSES_STORE, {
        keyPath: ["translationId", "book", "chapter", "verse"]
      });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadBook(translationId: string, book: string): Promise<Book> {
  const db = await openDb();
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
  translationId: string
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

  // A range is read as the verses it spans. Ranges crossing a chapter are out
  // of A0, so only the opening chapter is read.
  const last =
    ref.endVerse && !ref.endChapter
      ? Math.max(ref.endVerse, ref.verse)
      : ref.verse;

  const text: string[] = [];
  for (let verse = ref.verse; verse <= last; verse++) {
    const found = verses.get(`${ref.chapter}:${verse}`);
    if (found) text.push(found);
  }
  return text.join(" ");
}

/** The embedded layer as a provider (ADR 0002). */
export const embeddedProvider: ScriptureTextProvider = { getVerseText };
