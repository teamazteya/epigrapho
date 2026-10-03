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

import { i18n } from "@lingui/core";
import { Messages, setI18nGlobal } from "@notesnook/intl";

/**
 * Epigrapho: a shared note speaks the reader's language. Spanish, or English
 * for any other browser language. Without the header at all (link previews,
 * crawlers), Spanish, which is who Epigrapho is written for.
 */
export type PageLocale = "es-MX" | "en";

export function localeOf(acceptLanguage: string | null): PageLocale {
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase();
  return !first || first.startsWith("es") ? "es-MX" : "en";
}

/** The translation the verse previews use for each language. */
export const TRANSLATION_OF: Record<PageLocale, "VBL" | "BSB"> = {
  "es-MX": "VBL",
  en: "BSB"
};

export async function loadCatalog(locale: PageLocale) {
  const { default: catalog } =
    locale === "en"
      ? await import("@notesnook/intl/locales/$en.json")
      : await import("@notesnook/intl/locales/$es-MX.json");
  i18n.load({ [locale]: catalog.messages as unknown as Messages });
}

/** Makes `strings` answer in this language. Catalogs must be loaded first. */
export function activate(locale: PageLocale) {
  i18n.activate(locale);
  setI18nGlobal(i18n);
}
