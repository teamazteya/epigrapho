/*
This file is part of the Notesnook project (https://notesnook.com/)

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

import { LoaderFunctionArgs } from "@remix-run/node";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LRUCache } from "lru-cache";
import { parseRef } from "@notesnook/scripture-parser";
import {
  API_BIBLE_IDS,
  attributionOf,
  borrowHeadings,
  createApiBibleProvider,
  headingSourceOf,
  textInRange,
  toTranslation,
  type Heading,
  type HeadingKind
} from "@notesnook/scripture-provider";

/**
 * Epigrapho: the verse behind a reference.
 *
 *   /api/verse?ref=JHN.3.16&t=VBL
 *
 * VBL and BSB ship with the page (both free to quote) and serve shared notes.
 * NTV, NBLA and NASB are fetched from API.Bible with the key in
 * API_BIBLE_KEY, which lives only on the server: the desktop app asks here so
 * no installer ever carries it. Without the key they answer 404 and the app
 * falls back to its embedded packs.
 *
 * &headings=1 (A7) adds the section titles as "[§s1] ..." lines. Only with
 * &numbers=1: an app that asks for one asks for both.
 */
type Pack = {
  verses: [string, number, number, string][];
  headings?: [string, number, number, HeadingKind, string][];
};
type LoadedPack = {
  books: Map<string, Map<string, string>>;
  headings: Map<string, Heading[]>;
};
const PACKS = ["VBL", "BSB"];
const packs = new Map<string, Promise<LoadedPack>>();

function load(translationId: string) {
  let pack = packs.get(translationId);
  if (!pack) {
    pack = (async () => {
      const name = `${translationId.toLowerCase()}.json`;
      // public/ while developing, build/client/ once built.
      const file = ["public", "build/client"]
        .map((dir) => path.join(process.cwd(), dir, name))
        .find((candidate) => existsSync(candidate));
      if (!file) throw new Error(`${name} is missing`);
      const pack = JSON.parse(await readFile(file, "utf-8")) as Pack;
      const books = new Map<string, Map<string, string>>();
      for (const [book, chapter, verse, text] of pack.verses) {
        if (!books.has(book)) books.set(book, new Map());
        books.get(book)!.set(`${chapter}:${verse}`, text);
      }
      const headings = new Map<string, Heading[]>();
      for (const [book, chapter, verse, kind, text] of pack.headings ?? []) {
        if (!headings.has(book)) headings.set(book, []);
        headings.get(book)!.push({ chapter, verse, kind, text });
      }
      return { books, headings };
    })();
    packs.set(translationId, pack);
  }
  return pack;
}

const apiBible = createApiBibleProvider({
  apiKey: () => process.env.API_BIBLE_KEY
});
// Every app shares one key, so a verse many people read is fetched once a
// day, and one address can't spend the key's daily quota on its own.
const verses = new LRUCache<string, string>({ max: 5000, ttl: 86_400_000 });
const hits = new LRUCache<string, number>({ max: 10_000, ttl: 60_000 });
const PER_MINUTE = 60;

// Existing installers keep their plain-text response until they upgrade.
function displayText(request: Request, text: string | undefined) {
  return new URL(request.url).searchParams.get("numbers") === "1"
    ? text
    : text?.replace(/(^|\n)\[\d+[a-z]?(?:[-–]\d+[a-z]?)?\]\s*/gi, " ").trim();
}

function wantsHeadings(request: Request) {
  const { searchParams } = new URL(request.url);
  return (
    searchParams.get("headings") === "1" && searchParams.get("numbers") === "1"
  );
}

/** What embedded.ts headingsFor does, from the packs in memory. */
async function packHeadings(translationId: string, book: string) {
  const own = (await load(translationId)).headings.get(book) ?? [];
  const source = headingSourceOf(translationId);
  if (!source) return own;
  return borrowHeadings(
    translationId,
    book,
    own,
    (await load(source)).headings.get(book) ?? []
  );
}

async function brandVerse(
  request: Request,
  ref: string,
  translationId: string
) {
  if (!process.env.API_BIBLE_KEY)
    return Response.json({ error: "Not available" }, { status: 404 });

  const headings = wantsHeadings(request);
  const key = `${translationId}:${ref}${headings ? ":h" : ""}`;
  let text = verses.get(key);
  if (text === undefined) {
    // Caddy overwrites X-Forwarded-For with the real address.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "";
    const count = (hits.get(ip) ?? 0) + 1;
    hits.set(ip, count, { noUpdateTTL: true });
    if (count > PER_MINUTE)
      return Response.json({ error: "Too many requests" }, { status: 429 });

    try {
      text = await apiBible.getVerseText(parseRef(ref)!, translationId, {
        headings
      });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "Upstream failed" }, { status: 502 });
    }
    if (text) verses.set(key, text);
  }
  return Response.json(
    {
      text: displayText(request, text),
      translationId,
      attribution: attributionOf(translationId)
    },
    // The app keeps its own thirty day copy; a second, hidden one in the HTTP
    // cache would blur when a verse was really fetched.
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const translationId = url.searchParams.get("t") || "VBL";
  const refParam = url.searchParams.get("ref") || "";
  const range = parseRef(refParam);
  if (!range) return Response.json({ error: "Bad request" }, { status: 400 });
  if (Object.hasOwn(API_BIBLE_IDS, translationId))
    return brandVerse(request, refParam, translationId);
  if (!PACKS.includes(translationId))
    return Response.json({ error: "Bad request" }, { status: 400 });

  // References are stored in the canonical numbering (ADR 0004).
  const ref = toTranslation(range, translationId);
  const book = (await load(translationId)).books.get(ref.book);
  const text = !book
    ? ""
    : wantsHeadings(request)
    ? textInRange(book, ref, await packHeadings(translationId, ref.book))
    : textInRange(book, ref);
  return Response.json(
    {
      text: displayText(request, text),
      translationId,
      attribution: attributionOf(translationId)
    },
    { headers: { "Cache-Control": "public, max-age=604800" } }
  );
}
