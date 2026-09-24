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
import {
  PROVENANCE,
  cacheKey,
  embeddedProvider,
  indexedDbVerseCache,
  withCache,
  type ScriptureTextProvider
} from "@notesnook/scripture-provider";
import { desktop } from "./desktop-bridge";
import { DEFAULT_TRANSLATION } from "./translation";

/** Why what is shown is not the fresh text of the translation that was asked for. */
export type VerseNotice = "stale" | "fallback";

export type ResolvedVerse = {
  text: string;
  /** The translation the text actually came from, which is what gets credited. */
  translationId: string;
  notice?: VerseNotice;
};

/**
 * The online layer as seen from the renderer: it asks the main process, which
 * holds the key and makes the request. On the web build there is no main
 * process, so the brand translations are simply unavailable and the fallback
 * below takes over.
 */
const onlineProvider: ScriptureTextProvider = {
  async getVerseText(ref: VerseRange, translationId: string) {
    if (!desktop) return "";
    return desktop.scripture.verse.query({
      reference: ref,
      translationId
    });
  }
};

// One store for both readers: what the cache wrapper writes is what the stale
// path reads.
const verseCache = indexedDbVerseCache();
const cachedOnline = withCache(onlineProvider, { store: verseCache });

/**
 * The resolution order of ADR 0002, in one place:
 *
 * - an embedded translation is read from the local pack, always;
 * - a brand translation comes from the cache while it is fresh, then from the
 *   network;
 * - with no network (or no key) the last copy is shown, marked as saved;
 * - and with no copy at all, the embedded default is shown, marked as a
 *   substitute.
 *
 * What never happens is a raw error or an empty box: that is the point of the
 * step.
 */
export async function resolveVerse(
  ref: VerseRange,
  translationId: string
): Promise<ResolvedVerse> {
  const provenance = PROVENANCE[translationId];
  if (!provenance || provenance.deliveryMode === "embedded-offline")
    return {
      text: await embeddedProvider.getVerseText(ref, translationId),
      translationId
    };

  try {
    const text = await cachedOnline.getVerseText(ref, translationId);
    if (text) return { text, translationId };
  } catch (error) {
    console.error("could not reach the online layer", error);
  }

  const stale = await verseCache
    .get(cacheKey(ref, translationId))
    .catch(() => undefined);
  if (stale?.text) return { text: stale.text, translationId, notice: "stale" };

  return {
    text: await embeddedProvider.getVerseText(ref, DEFAULT_TRANSLATION),
    translationId: DEFAULT_TRANSLATION,
    notice: "fallback"
  };
}
