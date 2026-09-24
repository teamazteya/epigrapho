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
  attributionOf,
  embeddedProvider,
  loadPacks
} from "@notesnook/scripture-provider";

/**
 * Scripture as the mobile editor sees it (Fase 8).
 *
 * The editor on a phone is this page inside a WebView, so everything the
 * desktop and web builds do in the renderer is done here — with one
 * difference: there is no main process holding the API.Bible key, so the
 * brand translations are not available and only the packs shipped beside this
 * page are read. That is the same fallback the web build takes when it runs
 * outside Electron, not a separate code path.
 */

/** Epigrapho is written in Spanish first, so it reads Spanish first too. */
export const DEFAULT_TRANSLATION = "VBL";

/**
 * ponytail: the phone reads in the default translation for now. The chosen
 * one is a setting in the database (Fase 7), which lives in the app around
 * this page, not in the page; wiring it across is a message and its plumbing,
 * and nothing on this screen offers the choice yet.
 */
export function getTranslation() {
  return DEFAULT_TRANSLATION;
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

/**
 * The words a reference points at. Only the embedded packs, and the default
 * translation as the substitute when the asked-for one has nothing here.
 */
export async function resolveVerse(
  ref: string,
  translationId: string
): Promise<ResolvedVerse> {
  const range = parseRef(ref);
  if (!range) return { text: "", translationId };

  const text = await embeddedProvider.getVerseText(range, translationId);
  if (text) return { text, translationId };

  if (translationId === DEFAULT_TRANSLATION) return { text: "", translationId };
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
