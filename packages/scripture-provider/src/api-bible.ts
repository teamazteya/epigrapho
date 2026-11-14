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
 * Keep the provider's real verse numbers, including merged verses. The
 * portable [number] markers are also used by the embedded packs.
 */
const QUERY = [
  "content-type=text",
  "include-notes=false",
  "include-titles=false",
  "include-chapter-numbers=false",
  "include-verse-numbers=true",
  "include-verse-spans=false"
].join("&");

/**
 * With headings (A7). Plain text runs a title into the verse after it, so the
 * titles are asked for as HTML, where each is a paragraph with its USFM
 * marker as class: <p class="s1">El relato de la creación</p>.
 */
const QUERY_WITH_HEADINGS = [
  "content-type=html",
  "include-notes=false",
  "include-titles=true",
  "include-chapter-numbers=false",
  "include-verse-numbers=true",
  "include-verse-spans=false"
].join("&");

/**
 * The headings A7 shows, from the classes API.Bible gives them. NBLA and NASB
 * write a section title as plain "s". Major sections (ms, "Salmo 23") and
 * parallel passages (r) stay out, as in the packs.
 */
const HEADING_CLASSES: Record<string, string> = {
  s: "s1",
  s1: "s1",
  s2: "s2",
  d: "d",
  sp: "sp"
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

/**
 * Titles A7 does not show. They are dropped whole: text mode without titles
 * never had them, so they must not run into the verse after them either.
 */
const DROPPED_CLASSES = /^(ms\d?|mr|mt\d?|mte\d?|r|sr|s3|s4|qa|cl|cp|d\d)$/;

/** Where a verse starts, kept apart from the whitespace being collapsed. */
const VERSE_BREAK = "\u0001";

function plain(html: string) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) =>
      name[0] === "#"
        ? String.fromCodePoint(
            name[1] === "x" || name[1] === "X"
              ? parseInt(name.slice(2), 16)
              : Number(name.slice(1))
          )
        : ENTITIES[name.toLowerCase()] ?? entity
    );
}

/**
 * API.Bible's HTML as the portable lines every layer uses: "[16] text" per
 * verse and "[§s1] title" per heading (the format of embedded.ts).
 *
 * ponytail: regular expressions, not a DOM parser. This runs in the server and
 * the desktop main process, which have no DOM, and the markup is flat: one
 * level of <p>, verse numbers as <span class="v">.
 */
export function apiBibleHtmlToText(html: string): string {
  const lines: string[] = [];
  let open = "";
  const flush = () => {
    for (const line of open.replace(/\s+/g, " ").split(VERSE_BREAK))
      if (line.trim()) lines.push(line.trim());
    open = "";
  };
  for (const [, attributes, inner] of html.matchAll(
    /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  )) {
    const name = /class="([^"]*)"/.exec(attributes)?.[1] ?? "";
    if (DROPPED_CLASSES.test(name)) continue;
    const kind = HEADING_CLASSES[name];
    if (kind) {
      const title = plain(inner).replace(/\s+/g, " ").trim();
      if (!title) continue;
      flush();
      lines.push(`[§${kind}] ${title}`);
      continue;
    }
    open +=
      " " +
      plain(
        inner.replace(
          /<span\b[^>]*class="v"[^>]*>([^<]*)<\/span>/g,
          (_, number: string) => `${VERSE_BREAK}[${number.trim()}] `
        )
      );
  }
  flush();
  return lines.filter(Boolean).join("\n");
}

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
    async getVerseText(
      ref: VerseRange,
      translationId: string,
      options?: VerseTextOptions
    ) {
      const bibleId = API_BIBLE_IDS[translationId];
      if (!bibleId) return "";

      const key = await apiKey();
      if (!key) return "";

      const response = await fetch(
        `${ENDPOINT}/bibles/${bibleId}/passages/${apiBiblePassageId(
          toTranslation(ref, translationId)
        )}?${options?.headings ? QUERY_WITH_HEADINGS : QUERY}`,
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
      if (options?.headings) return apiBibleHtmlToText(data?.content || "");
      return (data?.content || "")
        .replace(/\s+/g, " ")
        .replace(/\s*\[(\d+[a-z]?(?:[-–]\d+[a-z]?)?)\]\s*/gi, "\n[$1] ")
        .trim();
    }
  };
}
