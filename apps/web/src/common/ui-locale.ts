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

import { i18n } from "@lingui/core";
import type { Messages } from "@notesnook/intl";
import type { SupportedLocale } from "@notesnook/scripture-parser";
import Config from "../utils/config";
import { setPreference } from "./synced-preferences";

/**
 * Epigrapho keeps three locales apart, and this file is where the only one a
 * person chooses lives:
 *
 * - the interface locale, chosen here, which decides the catalog lingui reads;
 * - the parser locales, which are always every language the grammar knows, so
 *   that "Juan 3:16" and "John 3:16" are both recognised whatever the
 *   interface is set to (see parseReferences' own default);
 * - the book-name locale, which follows the interface because a book name is
 *   something the person reads, not something the app stores.
 *
 * What is persisted follows none of them: a reference is always USFM in the
 * canonical versification.
 */

/** The interface languages a person can pick, and how each one is labelled. */
export const UI_LOCALES = {
  "es-MX": "Español (México)",
  "en-US": "English (US)"
} as const;

export type UiLocale = keyof typeof UI_LOCALES;

/** Epigrapho is written in Spanish first, so that is what it opens in. */
export const DEFAULT_UI_LOCALE: UiLocale = "es-MX";

/** The locale this person chose, or the default if they never chose one. */
export function getUiLocale(): UiLocale {
  const stored = Config.get<string>("uiLocale", DEFAULT_UI_LOCALE);
  return stored in UI_LOCALES ? (stored as UiLocale) : DEFAULT_UI_LOCALE;
}

/**
 * The locale scripture book names are shown in. It follows the interface: the
 * parser is not involved, and neither is what gets stored.
 */
export function getBookNameLocale(): SupportedLocale {
  return getUiLocale() === "en-US" ? "en" : "es";
}

/**
 * Loads a locale's catalog and activates it. The import paths are written out
 * one by one because the bundler has to see them; a path built from a variable
 * would leave the catalogs out of the build.
 */
export async function activateUiLocale(locale: UiLocale) {
  const { default: catalog } =
    locale === "en-US"
      ? await import("@notesnook/intl/locales/$en-US.json")
      : await import("@notesnook/intl/locales/$es-MX.json");
  i18n.load({ [locale]: catalog.messages as unknown as Messages });
  i18n.activate(locale);
}

/**
 * Remembers the choice and repaints the app in the new language.
 *
 * ponytail: every string is read at render time, so reloading the window is
 * the cheapest way to repaint all of them. It writes to this preference and
 * nothing else: notes are never touched.
 */
export async function setUiLocale(locale: UiLocale) {
  if (locale === getUiLocale()) return;
  // The choice belongs to the person, not to this machine, so it is written
  // where it syncs and only then read back from the copy (Fase 7).
  await setPreference("uiLocale", locale);
  window.location.reload();
}
