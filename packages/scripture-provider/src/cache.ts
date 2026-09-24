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

/**
 * Brand verses are cached apart from the embedded packs, in their own
 * database: the packs are a build artefact the app may rewrite wholesale,
 * while this is borrowed text with an expiry date. Neither is encrypted and
 * neither is synced — both are public scripture, not the person's notes.
 */
export const CACHE_DB = "epigrapho-scripture-cache";
export const CACHE_STORE = "verses";

/** Thirty days, the window the licence terms allow a copy to live for. */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CachedVerse = {
  text: string;
  /** When the text was fetched, in milliseconds since the epoch. */
  fetchedAt: number;
};

/** The little of a key-value store this needs. Injectable so tests can see it. */
export type VerseCacheStore = {
  get(key: string): Promise<CachedVerse | undefined>;
  set(key: string, value: CachedVerse): Promise<void>;
};

/**
 * One row per translation and passage: "NBLA:JHN.3.16", "NBLA:JHN.3.16-3.18".
 * Built from the reference itself, not from any provider's id scheme: what is
 * cached is a reference in a translation, whoever happened to serve it.
 */
export function cacheKey(ref: VerseRange, translationId: string) {
  const start = `${ref.book}.${ref.chapter}.${ref.verse}`;
  if (!ref.endChapter && !ref.endVerse) return `${translationId}:${start}`;

  const endChapter = ref.endChapter ?? ref.chapter;
  const endVerse = ref.endVerse ?? ref.verse;
  return `${translationId}:${start}-${endChapter}.${endVerse}`;
}

function openCacheDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(CACHE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisify<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The real store. A browser is needed; a test passes its own instead. */
export function indexedDbVerseCache(): VerseCacheStore {
  return {
    async get(key) {
      const db = await openCacheDb();
      try {
        return await promisify(
          db
            .transaction(CACHE_STORE, "readonly")
            .objectStore(CACHE_STORE)
            .get(key) as IDBRequest<CachedVerse | undefined>
        );
      } finally {
        db.close();
      }
    },
    async set(key, value) {
      const db = await openCacheDb();
      try {
        const transaction = db.transaction(CACHE_STORE, "readwrite");
        transaction.objectStore(CACHE_STORE).put(value, key);
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        db.close();
      }
    }
  };
}

export type CacheOptions = {
  store?: VerseCacheStore;
  ttlMs?: number;
  /** Injectable clock, so a test can age a row without waiting a month. */
  now?: () => number;
};

/**
 * Wraps a provider so a verse is asked for once and then read from disk until
 * it expires.
 *
 * An expired row is kept, not dropped: it is the last thing this app saw, and
 * Paso 4.3 offers it, clearly labelled, when there is no network. An empty
 * answer is never cached — it means "not this provider's translation", not "no
 * text" — and neither is a failure.
 */
export function withCache(
  provider: ScriptureTextProvider,
  { store, ttlMs = CACHE_TTL_MS, now = Date.now }: CacheOptions = {}
): ScriptureTextProvider {
  const cache = store ?? indexedDbVerseCache();
  return {
    async getVerseText(ref: VerseRange, translationId: string) {
      const key = cacheKey(ref, translationId);
      const cached = await cache.get(key);
      if (cached && now() - cached.fetchedAt < ttlMs) return cached.text;

      const text = await provider.getVerseText(ref, translationId);
      if (text) await cache.set(key, { text, fetchedAt: now() });
      return text;
    }
  };
}
