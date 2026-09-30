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

import { shortStrong } from "@notesnook/editor";
import type {
  Editor,
  InterlinearData,
  LexiconView
} from "@notesnook/editor";
import { strings } from "@notesnook/intl";
import {
  isOldTestament,
  lexiconEntry,
  originalTokens,
  translationWord
} from "@notesnook/original-languages";
import {
  formatReadableRef,
  formatRef,
  parseReferences,
  parseRef
} from "@notesnook/scripture-parser";
import { STUDY_PROVENANCE } from "@notesnook/scripture-provider";
import { PromptDialog } from "../dialogs/prompt";
import { showToast } from "../utils/toast";
import { getBookNameLocale, getUiLocale } from "./ui-locale";

/** A2 Paso 3.1: longer passages are refused, never cut short in silence. */
export const MAX_INTERLINEAR_VERSES = 10;

/**
 * The words of a stored reference, glossed in the interface language: RV1909
 * in Spanish, STEP's own gloss in English.
 */
export async function loadInterlinear(
  ref: string
): Promise<InterlinearData | undefined> {
  const range = parseRef(ref);
  if (!range) return;
  const spanish = getUiLocale() !== "en-US";
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
        gloss: spanish ? token.glossEs : token.glossEn,
        lang: token.lang
      }))
    })),
    credit: [
      STUDY_PROVENANCE.STEP.attribution,
      ...(spanish ? [STUDY_PROVENANCE.RV09A.attribution] : [])
    ].join(" · ")
  };
}

/** A Strong number's lexicon entry, with its es-419 articles (Fase 4). */
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

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * What an export carries in place of the block (A2 Paso 3.3): a table with
 * one row per word, which reads in Markdown, HTML and print alike.
 */
export async function renderInterlinearForExport(ref: string, label: string) {
  const data = await loadInterlinear(ref).catch(() => undefined);
  if (!data?.verses.length) return;
  const head = [
    "#",
    strings.originalWord(),
    strings.transliteration(),
    "Strong",
    strings.morphology(),
    strings.gloss()
  ];
  const rows = data.verses.flatMap(({ verse, words }) =>
    words.map((word) =>
      [
        verse,
        escape(word.surface),
        escape(word.transliteration),
        shortStrong(word.strong),
        escape(word.morph),
        escape(word.gloss)
      ]
        .map((cell) => `<td>${cell}</td>`)
        .join("")
    )
  );
  // ponytail: no wrapper and no markup inside the cells. Showdown turns a
  // bare table into a Markdown one and leaves anything fancier as raw HTML.
  return `<p><strong>${escape(label || ref)}</strong></p><table><thead><tr>${head
    .map((cell) => `<th>${cell}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row}</tr>`)
    .join("")}</tbody></table><p><em>${escape(data.credit)}</em></p>`;
}

/** Asks for a verse or a short range and inserts its interlinear. */
export async function insertInterlinear(editor: Editor) {
  const input = await PromptDialog.show({
    title: strings.insertInterlinear(),
    description: strings.interlinearPromptDesc()
  });
  if (!input) return;

  const [reference] = parseReferences(input);
  if (!reference) {
    showToast("error", strings.scriptureNotRecognized(input));
    return;
  }
  // Counting the verses the corpus has also proves it can show them.
  const verses = await originalTokens(reference).catch((error) => {
    console.error("could not read the original-language pack", error);
    return [];
  });
  if (verses.length > MAX_INTERLINEAR_VERSES) {
    showToast("error", strings.interlinearTooLong(input));
    return;
  }
  if (!verses.length) {
    showToast("error", strings.interlinearUnavailable());
    return;
  }

  editor
    .chain()
    .focus()
    .insertInterlinear({
      ref: formatRef(reference),
      label: formatReadableRef(reference, getBookNameLocale())
    })
    .run();
}
