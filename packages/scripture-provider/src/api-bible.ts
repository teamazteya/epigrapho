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

const ENDPOINT = "https://api.scripture.api.bible/v1";

/**
 * The brand translations Epigrapho may request, and the id API.Bible knows
 * each of them by.
 *
 * This table is the limit. The key itself opens 249 versions, so nothing on
 * API.Bible's side stops the app from asking for more: what keeps Epigrapho
 * inside the three versions it is licensed for is this whitelist, and asking
 * for anything else never leaves the machine.
 */
export const API_BIBLE_IDS: Record<string, string> = {
  NTV: "826f63861180e056-01",
  NBLA: "ce11b813f9a27e20-01",
  NASB: "b8ee27bcd1cae43a-01"
};

/**
 * Everything switched off but the words: no footnotes, no section titles, no
 * chapter or verse numbers.
 */
const QUERY = [
  "content-type=text",
  "include-notes=false",
  "include-titles=false",
  "include-chapter-numbers=false",
  "include-verse-numbers=false",
  "include-verse-spans=false"
].join("&");

/** The passage id API.Bible uses is the USFM reference itself. */
export function apiBiblePassageId(ref: VerseRange): string {
  const start = `${ref.book}.${ref.chapter}.${ref.verse}`;
  if (!ref.endChapter && !ref.endVerse) return start;

  const endChapter = ref.endChapter ?? ref.chapter;
  const endVerse = ref.endVerse ?? ref.verse;
  return `${start}-${ref.book}.${endChapter}.${endVerse}`;
}

export type ApiBibleOptions = {
  /**
   * Read when a request is about to go out, never at construction: the key
   * lives outside the repository and outside this package, and the less time
   * it spends in memory the better.
   */
  apiKey: () => Promise<string | undefined> | string | undefined;
  /** Injectable so a test can see the exact request. */
  fetch?: typeof globalThis.fetch;
};

/**
 * The online layer. It sends the canonical reference and the translation id,
 * and nothing else: no note, no title, no user id, no request body at all.
 * That is not a promise about how it is called, it is the shape of the call —
 * this function is given a VerseRange, so there is nothing of the person's to
 * send even by accident.
 */
export function createApiBibleProvider({
  apiKey,
  fetch = globalThis.fetch
}: ApiBibleOptions): ScriptureTextProvider {
  return {
    async getVerseText(ref: VerseRange, translationId: string) {
      const bibleId = API_BIBLE_IDS[translationId];
      if (!bibleId) return "";

      const key = await apiKey();
      if (!key) return "";

      const response = await fetch(
        `${ENDPOINT}/bibles/${bibleId}/passages/${apiBiblePassageId(
          toTranslation(ref, translationId)
        )}?${QUERY}`,
        {
          method: "GET",
          headers: { "api-key": key },
          // This layer keeps its own thirty day cache; letting the HTTP stack
          // keep a second, invisible one only blurs when a verse was really
          // fetched.
          cache: "no-store"
        }
      );
      if (!response.ok)
        throw new Error(`API.Bible responded ${response.status}`);

      const { data } = (await response.json()) as {
        data?: { content?: string };
      };
      return (data?.content || "").replace(/\s+/g, " ").trim();
    }
  };
}
