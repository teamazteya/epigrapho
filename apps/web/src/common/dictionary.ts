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

import type { DictionaryEntryView } from "@notesnook/editor";
import {
  dictionaryArticle,
  type DictionarySource
} from "@notesnook/original-languages";
import { STUDY_PROVENANCE } from "@notesnook/scripture-provider";

/** Each dictionary's title, as its own publisher wrote it. */
export const DICTIONARY_NAMES: Record<DictionarySource, string> = {
  TW: "Palabras de Traducción (es-419)",
  RAND: "Diccionario de la Santa Biblia (Rand, 1890)",
  EAS: "Easton's Bible Dictionary (1897)",
  SMI: "Smith's Bible Dictionary (1863)",
  HIT: "Hitchcock's Bible Names Dictionary (1869)"
};

/** The language a dictionary is written in. */
export const dictionaryLanguage = (source: DictionarySource) =>
  source === "TW" || source === "RAND" ? "es" : "en";

const CREDITS: Record<DictionarySource, string> = {
  TW: STUDY_PROVENANCE.ES419TW.attribution,
  RAND: "Rand, Diccionario de la Santa Biblia (1890) — dominio público",
  EAS: STUDY_PROVENANCE.NEUU.attribution,
  SMI: STUDY_PROVENANCE.NEUU.attribution,
  HIT: STUDY_PROVENANCE.NEUU.attribution
};

/** A stored entry id, ready for the block to show. */
export async function loadDictionaryEntry(
  id: string
): Promise<DictionaryEntryView | undefined> {
  const article = await dictionaryArticle(id);
  if (!article) return;
  return {
    term: article.term,
    sourceName: DICTIONARY_NAMES[article.source],
    body: article.body,
    lang: dictionaryLanguage(article.source),
    credit: CREDITS[article.source]
  };
}

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** What an export carries in place of the block: the entry, as text. */
export async function renderDictionaryEntryForExport(id: string) {
  const entry = await loadDictionaryEntry(id).catch(() => undefined);
  if (!entry) return;
  const paragraphs = entry.body
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escape(paragraph)}</p>`)
    .join("");
  return `<h4>${escape(entry.term)}</h4><p><em>${escape(entry.sourceName)}</em></p>${paragraphs}<p><em>${escape(entry.credit)}</em></p>`;
}
