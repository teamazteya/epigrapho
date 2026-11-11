// SPDX-License-Identifier: GPL-3.0-or-later
// The desktop spell checker's list of biblical names and terms (A6 Fase 8):
// the VBL's proper names, Rand's titles, the Translation Words' titles and
// Wiktionary's biblical lemmas. Words only, never a verse: the worker adds
// them as right and offers them as suggestions.
import type {
  DictionaryPack,
  TranslationWordsPack,
  WiktionaryIndexPack
} from "../src/pack.ts";
import { readVerses } from "../../bible-pack/scripts/import-usfm.ts";

const fold = (word: string) =>
  word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const WORD = /\p{L}[\p{L}\p{M}]*/gu;
const capitalised = (word: string) => /^\p{Lu}/u.test(word);

/**
 * The proper names of a text: capitalised in the middle of a sentence at
 * least twice, and never written in lower case ("Señor" is both; "Hijo" too).
 * And the words it writes in lower case.
 */
export function namesOf(texts: Iterable<string>) {
  const upper = new Map<string, number>();
  const lower = new Set<string>();
  for (const text of texts)
    for (const sentence of text.split(/[.!?:;¿¡“”«»"—()]/))
      (sentence.match(WORD) ?? []).forEach((word, at) => {
        if (!capitalised(word)) lower.add(word.toLowerCase());
        else if (at > 0) upper.set(word, (upper.get(word) ?? 0) + 1);
      });
  const names = [...upper]
    .filter(([word, count]) => count >= 2 && !lower.has(word.toLowerCase()))
    .map(([word]) => word);
  return { names, lower };
}

/** The words of titles like "Zur o Sur" or "amor, amar, amado". */
const wordsOf = (titles: Iterable<string>) =>
  [...titles].flatMap((title) => title.match(WORD) ?? []);

export function buildSpellTerms(
  vbl: Iterable<string>,
  rand: DictionaryPack,
  words: TranslationWordsPack,
  wiktionary?: Pick<WiktionaryIndexPack, "biblical">
): string[] {
  const { names, lower } = namesOf(vbl);
  const modern = new Set([
    ...names,
    ...wordsOf(Object.values(words).map(([title]) => title)),
    ...wordsOf(wiktionary?.biblical ?? [])
  ]);
  const folded = new Map([...modern].map((word) => [fold(word), word]));
  // Rand writes 1890's spellings ("Aaron"): where a newer source has the
  // word, its spelling is the one to keep, and "Aaron" is a typo for it.
  const old = wordsOf(Object.values(rand).map(([term]) => term)).filter(
    (word) => (folded.get(fold(word)) ?? word) === word
  );
  // Titles are capitalised: "Uvas" is a common word the VBL writes in lower
  // case, which the language's own dictionary already knows.
  return [...new Set([...modern, ...old])]
    .filter(
      (word) =>
        word.length > 2 &&
        !(capitalised(word) && lower.has(word.toLowerCase()))
    )
    .sort();
}

/** The VBL's verses, for namesOf. */
export function* vblTexts() {
  for (const { text } of readVerses("VBL")) yield text;
}
