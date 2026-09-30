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
import { MMKV } from "./database/mmkv";

/**
 * The interface language, as on the desktop (apps/web/src/common/ui-locale.ts):
 * Spanish unless the person picks English. It is read from MMKV because the
 * catalog has to be loaded before anything renders, long before the database
 * opens; the database keeps the same choice under the same key, so it travels
 * in a backup like the desktop's does.
 */
export const UI_LOCALES = {
  "es-MX": "Español (México)",
  "en-US": "English (US)"
} as const;

export type UiLocale = keyof typeof UI_LOCALES;

export const UI_LOCALE_KEY = "epigrapho:uiLocale";

export function getUiLocale(): UiLocale {
  const stored = MMKV.getString(UI_LOCALE_KEY);
  return stored && stored in UI_LOCALES ? (stored as UiLocale) : "es-MX";
}

/** The locale scripture book names are shown in; it follows the interface. */
export function getBookNameLocale(): "es" | "en" {
  return getUiLocale() === "en-US" ? "en" : "es";
}

/**
 * Loads and activates the chosen catalog. The requires are written out one by
 * one so the bundler sees both files.
 */
export function activateUiLocale() {
  const locale = getUiLocale();
  const catalog =
    locale === "en-US"
      ? require("@notesnook/intl/dist/locales/$en-US.json")
      : require("@notesnook/intl/dist/locales/$es-MX.json");
  i18n.load({ [locale]: catalog.messages as Messages });
  i18n.activate(locale);
}

/**
 * ponytail: many strings are read once, when their module loads (the settings
 * lists among them), so a new language shows after the app restarts; the
 * picker says so. A restart module would be a native dependency for one
 * setting.
 */
export function setUiLocale(locale: UiLocale) {
  MMKV.setString(UI_LOCALE_KEY, locale);
}
