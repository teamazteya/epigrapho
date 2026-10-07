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

import type { ResolvedVerse } from "@notesnook/editor";
import {
  formatReadableRef,
  parseRef,
  type SupportedLocale
} from "@notesnook/scripture-parser";
import {
  PROVENANCE,
  apiBiblePassageId,
  attributionOf,
  cacheKey,
  embeddedProvider,
  indexedDbVerseCache,
  loadPacks,
  withCache,
  type ScriptureTextProvider
} from "@notesnook/scripture-provider";

/**
 * Scripture as the mobile editor sees it (Fase 8).
 *
 * The editor on a phone is this page inside a WebView, so everything the
 * desktop and web builds do in the renderer is done here. The brand
 * translations (NTV, NBLA, NASB) are asked of Epigrapho's server, as installed
 * desktop apps do (M1 Fase 5c): no key ships inside the app (ADR-0002).
 */

/** Epigrapho is written in Spanish first, so it reads Spanish first too. */
export const DEFAULT_TRANSLATION = "VBL";

/**
 * The translation chosen in the app's settings. The app hands it across with
 * the rest of the editor settings (setSettings), and it is read when a verse
 * is shown, so a change applies without reloading the page.
 */
export function getTranslation(): string {
  return (
    globalThis.settingsController?.previous?.scriptureTranslation ||
    DEFAULT_TRANSLATION
  );
}

/** The language book names are written in, following the interface. */
export function getBookNameLocale(): SupportedLocale {
  return `${globalThis.LINGUI_LOCALE || "en"}`.startsWith("es") ? "es" : "en";
}

/** A USFM reference as a person reads it, in the interface's language. */
export function formatReference(ref: string) {
  const range = parseRef(ref);
  return range ? formatReadableRef(range, getBookNameLocale()) : ref;
}

const VERSE_HOST = "https://notas.azteya.tech";

/**
 * The server holds the key and answers with the words. The page is a file://
 * page allowed to reach other origins (allowUniversalAccessFromFileURLs), so
 * no CORS is involved.
 */
const onlineProvider: ScriptureTextProvider = {
  async getVerseText(ref, translationId) {
    const response = await fetch(
      `${VERSE_HOST}/api/verse?ref=${apiBiblePassageId(ref)}&t=${translationId}`
    );
    if (!response.ok)
      throw new Error(`verse server responded ${response.status}`);
    const { text } = (await response.json()) as { text?: string };
    return text || "";
  }
};
const verseCache = indexedDbVerseCache();
const cachedOnline = withCache(onlineProvider, { store: verseCache });

/**
 * The resolution order of ADR 0002, as on the desktop
 * (apps/web/src/common/scripture.ts): the embedded packs always; a brand
 * translation from the cache or the server; without network the last copy,
 * marked as saved; and with no copy at all, the default, marked as a
 * substitute.
 */
export async function resolveVerse(
  ref: string,
  translationId: string
): Promise<ResolvedVerse> {
  const range = parseRef(ref);
  if (!range) return { text: "", translationId };

  const provenance = PROVENANCE[translationId];
  if (provenance?.deliveryMode === "online-cached") {
    try {
      const text = await cachedOnline.getVerseText(range, translationId);
      if (text) return { text, translationId };
    } catch (error) {
      console.error("could not reach the online layer", error);
    }
    const stale = await verseCache
      .get(cacheKey(range, translationId))
      .catch(() => undefined);
    if (stale?.text)
      return { text: stale.text, translationId, notice: "stale" };
  } else {
    const text = await embeddedProvider.getVerseText(range, translationId);
    if (text) return { text, translationId };
    if (translationId === DEFAULT_TRANSLATION)
      return { text: "", translationId };
  }

  return {
    text: await embeddedProvider.getVerseText(range, DEFAULT_TRANSLATION),
    translationId: DEFAULT_TRANSLATION,
    notice: "fallback"
  };
}

export { attributionOf };

/**
 * Fills the verse store from the packs shipped beside this page. On a phone
 * that is `file:///android_asset/`, where the page itself came from, so the
 * empty base — a plain relative path — is right on every platform.
 */
export function loadScripturePacks() {
  return loadPacks("");
}
