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

import { parseRef } from "@notesnook/scripture-parser";
import {
  PACK_FILES,
  PROVENANCE,
  apiBiblePassageId,
  textInRange,
  toTranslation
} from "@notesnook/scripture-provider";
import { Platform } from "react-native";
import RNFetchBlob from "react-native-blob-util";
import { useSettingStore } from "../stores/use-setting-store";

/**
 * Verses on the app's side of the phone (M1 Fase 5c): the reading plans and
 * the PDF and Word export read them here, outside the editor's page. The
 * editor has its own reader (packages/editor-mobile/src/common/scripture.ts),
 * on the page's IndexedDB, which this side cannot open.
 *
 * ponytail: a whole pack is parsed the first time a translation is read
 * (4–5 MB, kept in memory while the app runs), and a brand translation read
 * without network falls back to VBL instead of a saved copy. Index the packs
 * by book, or share the editor's cache, if either ever shows.
 */
export const DEFAULT_TRANSLATION = "VBL";
const VERSE_HOST = "https://notas.azteya.tech";

type Pack = Map<string, Map<string, string>>;
const packs = new Map<string, Promise<Pack>>();

async function readPack(translationId: string): Promise<Pack> {
  const file = PACK_FILES[translationId];
  const path =
    Platform.OS === "ios"
      ? `${RNFetchBlob.fs.dirs.MainBundleDir}/build.bundle/${file}`
      : `bundle-assets://${file}`;
  const { verses } = JSON.parse(await RNFetchBlob.fs.readFile(path, "utf8")) as {
    verses: [string, number, number, string][];
  };
  const books: Pack = new Map();
  for (const [book, chapter, verse, text] of verses) {
    if (!books.has(book)) books.set(book, new Map());
    books.get(book)!.set(`${chapter}:${verse}`, text);
  }
  return books;
}

async function embeddedText(ref: string, translationId: string) {
  const range = parseRef(ref);
  if (!range || !PACK_FILES[translationId]) return "";
  let pack = packs.get(translationId);
  if (!pack) {
    pack = readPack(translationId);
    packs.set(translationId, pack);
    pack.catch(() => packs.delete(translationId));
  }
  const local = toTranslation(range, translationId);
  const book = (await pack).get(local.book);
  return book ? textInRange(book, local) : "";
}

async function onlineText(ref: string, translationId: string) {
  const range = parseRef(ref);
  if (!range) return "";
  const response = await fetch(
    `${VERSE_HOST}/api/verse?ref=${apiBiblePassageId(range)}&t=${translationId}`
  );
  if (!response.ok) throw new Error(`verse server responded ${response.status}`);
  const { text } = (await response.json()) as { text?: string };
  return text || "";
}

/** The translation chosen in Settings. */
export const getTranslation = () =>
  useSettingStore.getState().settings.scriptureTranslation ||
  DEFAULT_TRANSLATION;

/**
 * A USFM reference's words, in the order of ADR 0002: the packs always, a
 * brand translation from the server, and VBL in its place when that fails.
 */
export async function resolveVerse(ref: string, translationId: string) {
  try {
    const text =
      PROVENANCE[translationId]?.deliveryMode === "online-cached"
        ? await onlineText(ref, translationId)
        : await embeddedText(ref, translationId);
    if (text) return { text, translationId };
  } catch (error) {
    console.error("could not read the verse", error);
  }
  if (translationId === DEFAULT_TRANSLATION)
    return { text: "", translationId };
  return {
    text: await embeddedText(ref, DEFAULT_TRANSLATION),
    translationId: DEFAULT_TRANSLATION
  };
}
