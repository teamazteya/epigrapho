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

// Epigrapho: what the study blocks of a shared note load, read from the same
// static files the app uses (original/, served next to the page). The verse of
// an inline reference comes from /api/verse.
//
// ponytail: loadInterlinear, loadLexicon and loadDictionaryEntry mirror
// apps/web/src/common/interlinear.ts and dictionary.ts, minus the app's
// dialogs. Move them to a shared package when M1 needs them too.
import {
  shortStrong,
  type DictionaryEntryView,
  type InterlinearData,
  type LexiconView,
  type ResolvedVerse
} from "@notesnook/editor";
import {
  dictionaryArticle,
  isOldTestament,
  lexiconEntry,
  originalTokens,
  translationWord,
  type DictionarySource
} from "@notesnook/original-languages";
import { parseRef } from "@notesnook/scripture-parser";
import { STUDY_PROVENANCE, attributionOf } from "@notesnook/scripture-provider";
import { TRANSLATION_OF, type PageLocale } from "./locale";

const locale = () => document.documentElement.lang as PageLocale;
const spanish = () => locale() !== "en";

export const translation = () => TRANSLATION_OF[locale()];
export { attributionOf };

export async function resolveVerse(
  ref: string,
  translationId: string
): Promise<ResolvedVerse> {
  const response = await fetch(
    `/api/verse?${new URLSearchParams({ ref, t: translationId })}`
  );
  if (!response.ok) throw new Error(`verse ${ref}: ${response.status}`);
  const { text } = await response.json();
  return { text, translationId };
}

export async function loadInterlinear(
  ref: string
): Promise<InterlinearData | undefined> {
  const range = parseRef(ref);
  if (!range) return;
  const verses = await originalTokens(range);
  return {
    rtl: isOldTestament(range.book),
    verses: verses.map((tokens) => ({
      verse: tokens[0].ref.split(".").slice(1).join(":"),
      words: tokens.map((token) => ({
        surface: token.surface,
        transliteration: token.transliteration,
        strong: token.strong,
        morph: token.morph,
        gloss: spanish() ? token.glossEs : token.glossEn,
        lang: token.lang
      }))
    })),
    credit: [
      STUDY_PROVENANCE.STEP.attribution,
      ...(spanish() ? [STUDY_PROVENANCE.RV09A.attribution] : [])
    ].join(" · ")
  };
}

export async function loadLexicon(
  strong: string
): Promise<LexiconView | undefined> {
  const entry = await lexiconEntry(strong);
  if (!entry) return;
  const [lemma, transliteration, , , definitionEn, usageEs, es419] = entry;
  const articles = await Promise.all(es419.map((id) => translationWord(id)));
  return {
    lemma,
    transliteration,
    strong: shortStrong(strong),
    lang: strong.startsWith("G") ? "grc" : "he",
    definitionEn,
    usageEs,
    es419: articles
      .filter((article) => !!article)
      .map(([title, body]) => ({ title, body }))
  };
}

const DICTIONARY_NAMES: Record<DictionarySource, string> = {
  TW: "Palabras de Traducción (es-419)",
  RAND: "Diccionario de la Santa Biblia (Rand, 1890)",
  EAS: "Easton's Bible Dictionary (1897)",
  SMI: "Smith's Bible Dictionary (1863)",
  HIT: "Hitchcock's Bible Names Dictionary (1869)"
};
const DICTIONARY_CREDITS: Record<DictionarySource, string> = {
  TW: STUDY_PROVENANCE.ES419TW.attribution,
  RAND: "Rand, Diccionario de la Santa Biblia (1890) — dominio público",
  EAS: STUDY_PROVENANCE.NEUU.attribution,
  SMI: STUDY_PROVENANCE.NEUU.attribution,
  HIT: STUDY_PROVENANCE.NEUU.attribution
};

export async function loadDictionaryEntry(
  id: string
): Promise<DictionaryEntryView | undefined> {
  const article = await dictionaryArticle(id);
  if (!article) return;
  return {
    term: article.term,
    sourceName: DICTIONARY_NAMES[article.source],
    body: article.body,
    lang: article.source === "TW" || article.source === "RAND" ? "es" : "en",
    credit: DICTIONARY_CREDITS[article.source]
  };
}
