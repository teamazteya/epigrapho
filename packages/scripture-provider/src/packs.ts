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
 * Reads a pack on the main thread.
 *
 * ponytail: this is XMLHttpRequest and not fetch on purpose. The mobile
 * editor is a page loaded from `file://`, and fetch refuses that scheme
 * outright while XHR is allowed to read a file beside the page.
 */
function readOnMainThread(url: string) {
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

/**
 * Epigrapho (W2): reading and parsing a 4.5 MB pack on the main thread is one
 * task of ~500 ms at 4x CPU. A worker does both and hands the verses back 500
 * at a time, each one a short task.
 */
const READER = `onmessage = async (event) => {
  try {
    const response = await fetch(event.data);
    if (!response.ok) throw new Error("status " + response.status);
    const pack = await response.json();
    const verses = pack.verses;
    pack.verses = [];
    postMessage(pack);
    for (let i = 0; i < verses.length; i += 500)
      postMessage(verses.slice(i, i + 500));
    postMessage(null);
  } catch (error) {
    postMessage({ error: String(error) });
  }
};`;
let readerUrl: string | undefined;

function readInWorker(url: string) {
  return new Promise<VersePack>((resolve, reject) => {
    readerUrl ??= URL.createObjectURL(
      new Blob([READER], { type: "text/javascript" })
    );
    const worker = new Worker(readerUrl);
    const fail = (error: unknown) => {
      worker.terminate();
      reject(error);
    };
    let pack: VersePack | undefined;
    worker.onmessage = ({ data }) => {
      if (data && "error" in data) fail(new Error(data.error));
      else if (!pack) pack = data as VersePack;
      else if (data) pack.verses.push(...(data as VersePack["verses"]));
      else {
        worker.terminate();
        resolve(pack);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message));
    };
    worker.postMessage(new URL(url, location.href).href);
  });
}

/**
 * Reads a pack, in a worker where one can fetch it. The mobile editor (a page
 * from file://) cannot, and a missing pack fails there too: both fall back to
 * the main thread, as before W2, which also reports the missing pack.
 */
function readPack(url: string) {
  return readInWorker(url).catch(() => readOnMainThread(url));
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
 * Milliseconds of puts per transaction. A fixed number of rows was too many
 * on a slow phone (1000 rows took ~450 ms at 4x CPU); a time budget fits any
 * device.
 */
const BUDGET_MS = 40;

/**
 * Epigrapho (W2): whether a pack finished loading. A row in the headings
 * store with an empty book, which no reader asks for (embedded.ts reads by
 * book). "loading" from the first write, "done" after the last one, so a load
 * cut halfway (the app closed on first run) carries on at the next start.
 */
const markerKey = (translationId: string) => [translationId, "", 0, 0, 0];
type Marker = { text: "loading" | "done" };
const markerRow = (translationId: string, text: Marker["text"]) => ({
  translationId,
  book: "",
  chapter: 0,
  verse: 0,
  order: 0,
  text
});

/** Gives the screen a turn between two writes. Safari has no idle callback. */
function yieldToScreen() {
  return new Promise<void>((resolve) =>
    "requestIdleCallback" in globalThis
      ? requestIdleCallback(() => resolve(), { timeout: 100 })
      : setTimeout(resolve, 0)
  );
}

/**
 * Writes rows from `from` on in one transaction, for BUDGET_MS at most, and
 * waits for it to finish. Returns where the next transaction starts.
 */
async function write<T>(
  db: IDBDatabase,
  store: string,
  rows: T[],
  from: number,
  toRow: (item: T, index: number) => unknown = (item) => item
) {
  const transaction = db.transaction(store, "readwrite");
  const objectStore = transaction.objectStore(store);
  const started = performance.now();
  let next = from;
  // At least one row per transaction, so a very slow device still advances.
  do objectStore.put(toRow(rows[next], next++));
  while (next < rows.length && performance.now() - started < BUDGET_MS);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  return next;
}

/**
 * Writes rows a transaction at a time, letting the screen draw in between.
 * Each row is built only when it is stored: 31,000 objects built up front
 * lived long enough to need slow garbage collections (~250 ms at 4x CPU).
 */
async function writeInChunks<T>(
  db: IDBDatabase,
  store: string,
  rows: T[],
  toRow: (item: T, index: number) => unknown
) {
  for (let next = 0; next < rows.length; ) {
    await yieldToScreen();
    next = await write(db, store, rows, next, toRow);
  }
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
      const marker = (await promisify(
        db
          .transaction(HEADINGS_STORE, "readonly")
          .objectStore(HEADINGS_STORE)
          .get(markerKey(translationId))
      )) as Marker | undefined;
      const verses = await countOf(db, VERSES_STORE, translationId);
      // Before W2 each pack went in one transaction, so with no marker any
      // row at all means the whole pack.
      // shortcut: a pack with no headings at all would be read again on every
      // start; all four have some. Store a marker if one ever ships without.
      const ready = marker
        ? marker.text === "done"
        : verses > 0 && (await countOf(db, HEADINGS_STORE, translationId)) > 0;
      if (ready) continue;

      const pack = await readPack(`${base}${file}`);
      await write(db, HEADINGS_STORE, [markerRow(translationId, "loading")], 0);
      // The chunks go in pack order and each one whole, so the rows already
      // there are the first ones of the pack.
      const rest = pack.verses.slice(verses);
      await writeInChunks(
        db,
        VERSES_STORE,
        rest,
        ([book, chapter, verse, text]) =>
          ({
            translationId: pack.translationId,
            book,
            chapter,
            verse,
            text,
            source: "pack"
          } satisfies VerseRow)
      );
      loaded += rest.length;
      // Headings are written whole again: a put over the same key is harmless.
      await writeInChunks(
        db,
        HEADINGS_STORE,
        pack.headings || [],
        ([book, chapter, verse, kind, text], order) =>
          ({
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
      await write(db, HEADINGS_STORE, [markerRow(translationId, "done")], 0);
    }
    return loaded;
  } finally {
    db.close();
  }
}
