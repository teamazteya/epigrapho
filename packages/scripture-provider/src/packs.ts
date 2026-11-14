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

import {
  HEADINGS_STORE,
  openVersesDb,
  VERSES_STORE,
  type HeadingKind,
  type HeadingRow
} from "./embedded";

/**
 * Scripture text lives apart from the user's notes: Notesnook keeps notes in
 * an encrypted database that syncs, while verses are public, read-only and
 * unencrypted, so they go in their own store and never reach sync or backup.
 *
 * This is the loading half; `embedded.ts` is the reading half. Both are here
 * rather than in one app because every app that shows a verse needs them:
 * the desktop and web builds read the packs from the server they were served
 * from, and the mobile editor from the files shipped beside it (Fase 8).
 */

/** The bundled packs, from the translation id to the file built for it. */
export const PACK_FILES: Record<string, string> = {
  VBL: "vbl.json",
  BSB: "bsb.json",
  KJV: "kjv.json",
  PdDpt: "pddpt.json"
};

export type VerseRow = {
  translationId: string;
  /** USFM book code, e.g. "JHN". */
  book: string;
  chapter: number;
  verse: number;
  text: string;
  source: "pack";
};

type VersePack = {
  translationId: string;
  license: string;
  verses: [book: string, chapter: number, verse: number, text: string][];
  /** Since A7. A pack built before it has none. */
  headings?: [
    book: string,
    chapter: number,
    verse: number,
    kind: HeadingKind,
    text: string
  ][];
};

function promisify<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Reads a pack.
 *
 * ponytail: this is XMLHttpRequest and not fetch on purpose. The mobile
 * editor is a page loaded from `file://`, and fetch refuses that scheme
 * outright while XHR is allowed to read a file beside the page.
 */
function readPack(url: string) {
  return new Promise<VersePack>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url);
    request.responseType = "json";
    request.onload = () =>
      request.response
        ? resolve(request.response as VersePack)
        : reject(new Error(`No pack at ${url} (status ${request.status}).`));
    request.onerror = () => reject(new Error(`Could not read ${url}.`));
    request.send();
  });
}

/** How many rows of a translation a store already holds. */
async function countOf(db: IDBDatabase, store: string, translationId: string) {
  return promisify(
    db
      .transaction(store, "readonly")
      .objectStore(store)
      // An array sorts after any number in IndexedDB key order, so [id, []] is
      // an upper bound past every key of this translation.
      .count(IDBKeyRange.bound([translationId], [translationId, []]))
  );
}

/**
 * Loads each bundled pack the first time the app runs, and skips the ones
 * already stored, so it is safe to call unconditionally. A missing pack means
 * a broken build, so the error is left to the caller.
 *
 * Verses and headings are checked apart: an install from before A7 has every
 * verse and no heading, and gets only the headings, once.
 *
 * `base` is where the packs sit next to the page: "/" for a served app, "" or
 * a directory for a page loaded from a file.
 */
export async function loadPacks(base = "/", files = PACK_FILES) {
  const db = await openVersesDb();
  let loaded = 0;
  try {
    for (const [translationId, file] of Object.entries(files)) {
      const hasVerses = (await countOf(db, VERSES_STORE, translationId)) > 0;
      // shortcut: a pack with no headings at all would be read again on every
      // start; all four have some. Store a marker if one ever ships without.
      const hasHeadings =
        (await countOf(db, HEADINGS_STORE, translationId)) > 0;
      if (hasVerses && hasHeadings) continue;

      const pack = await readPack(`${base}${file}`);
      // ponytail: one transaction per pack, 31k rows each. It takes about a
      // second once, on first run; chunk it only if that ever blocks the first
      // paint.
      const transaction = db.transaction(
        [VERSES_STORE, HEADINGS_STORE],
        "readwrite"
      );
      if (!hasVerses) {
        const store = transaction.objectStore(VERSES_STORE);
        for (const [book, chapter, verse, text] of pack.verses)
          store.put({
            translationId: pack.translationId,
            book,
            chapter,
            verse,
            text,
            source: "pack"
          } satisfies VerseRow);
        loaded += pack.verses.length;
      }
      if (!hasHeadings) {
        const store = transaction.objectStore(HEADINGS_STORE);
        pack.headings?.forEach(([book, chapter, verse, kind, text], order) =>
          store.put({
            translationId: pack.translationId,
            book,
            chapter,
            verse,
            // Unique and in reading order: the pack lists them that way.
            order,
            kind,
            text
          } satisfies HeadingRow)
        );
      }

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }
    return loaded;
  } finally {
    db.close();
  }
}
