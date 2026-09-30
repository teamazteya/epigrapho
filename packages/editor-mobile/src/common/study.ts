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

import {
  shortStrong,
  type DictionaryEntryView,
  type Editor,
  type InterlinearData,
  type LexiconView
} from "@notesnook/editor";
import { strings } from "@notesnook/intl";
import {
  dictionaryArticle,
  isOldTestament,
  lexiconEntry,
  originalTokens,
  setOriginalBase,
  translationWord,
  type DictionarySource
} from "@notesnook/original-languages";
import {
  formatReadableRef,
  formatRef,
  parseReferences,
  parseRef
} from "@notesnook/scripture-parser";
import { STUDY_PROVENANCE } from "@notesnook/scripture-provider";
import { create } from "zustand";
import { ask } from "./prompt";
import { getBookNameLocale } from "./scripture";

/**
 * The study tools of A2 on a phone (M1 Fase 4). The data and the loaders are
 * the web app's (apps/web/src/common/interlinear.ts and dictionary.ts); what
 * differs is where the packs sit — beside this page, in the app package — and
 * that the concordance and the dictionaries open in a sheet over the note
 * instead of a side panel.
 */

// The packs are read from beside the page, like the scripture packs: on a
// phone that is file:///android_asset/, where a relative path is right.
setOriginalBase("");

const spanish = () => `${globalThis.LINGUI_LOCALE || "es"}`.startsWith("es");

/** A2 Paso 3.1: longer passages are refused, never cut short in silence. */
export const MAX_INTERLINEAR_VERSES = 10;

/** A stored reference's words, glossed in the interface language. */
export async function loadInterlinear(
  ref: string
): Promise<InterlinearData | undefined> {
  const range = parseRef(ref);
  if (!range) return;
  const inSpanish = spanish();
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
        gloss: inSpanish ? token.glossEs : token.glossEn,
        lang: token.lang
      }))
    })),
    credit: [
      STUDY_PROVENANCE.STEP.attribution,
      ...(inSpanish ? [STUDY_PROVENANCE.RV09A.attribution] : [])
    ].join(" · ")
  };
}

/** A Strong number's lexicon entry, with its es-419 articles. */
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

/** Each dictionary's title, as its own publisher wrote it. */
export const DICTIONARY_NAMES: Record<DictionarySource, string> = {
  TW: "Palabras de Traducción (es-419)",
  RAND: "Diccionario de la Santa Biblia (Rand, 1890)",
  EAS: "Easton's Bible Dictionary (1897)",
  SMI: "Smith's Bible Dictionary (1863)",
  HIT: "Hitchcock's Bible Names Dictionary (1869)"
};

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

/** Asks for a verse or a short range and inserts its interlinear. */
export async function insertInterlinear(editor: Editor) {
  const reference = await ask({
    id: "interlinear-prompt",
    title: strings.insertInterlinear(),
    description: strings.interlinearPromptDesc(),
    submit: async (typed) => {
      const [found] = parseReferences(typed);
      if (!found) return { error: strings.scriptureNotRecognized(typed) };
      // Counting the verses the corpus has also proves it can show them.
      const verses = await originalTokens(found).catch((error) => {
        console.error("could not read the original-language pack", error);
        return [];
      });
      if (verses.length > MAX_INTERLINEAR_VERSES)
        return { error: strings.interlinearTooLong(typed) };
      if (!verses.length) return { error: strings.interlinearUnavailable() };
      return { value: found };
    }
  });
  if (!reference) return;
  editor
    .chain()
    .focus()
    .insertInterlinear({
      ref: formatRef(reference),
      label: formatReadableRef(reference, getBookNameLocale())
    })
    .run();
}

/** Which study sheet is open over the note, if any. */
export type StudyPane =
  | { type: "concordance"; query: string }
  | { type: "dictionary"; query: string; inserting: boolean };

export const useStudyPane = create<{
  pane?: StudyPane;
  editor?: Editor;
  open: (pane: StudyPane, editor?: Editor) => void;
  close: () => void;
}>((set) => ({
  open: (pane, editor) =>
    set((state) => ({ pane, editor: editor ?? state.editor })),
  close: () => set({ pane: undefined })
}));
