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

/** The 66 books in canonical order, as USFM codes. */
export const BOOKS =
  "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(
    " "
  );

/** The Old Testament is Hebrew and Aramaic, read right to left. */
export const isOldTestament = (book: string) => BOOKS.indexOf(book) < 39;

/**
 * One original-language word as it ships: a tuple keeps a book's file about
 * half the size of objects. `glossEs` is empty where RV1909 does not render
 * the word; it is never made up.
 */
export type PackToken = [
  surface: string,
  transliteration: string,
  strong: string,
  morph: string,
  glossEn: string,
  glossEs: string
];

/**
 * A lexicon entry, keyed by the extended Strong number the tokens carry
 * ("G0026", "H7225G"). The definition is STEP's English, flattened to text.
 */
export type LexiconEntry = [
  lemma: string,
  transliteration: string,
  morph: string,
  glossEn: string,
  definitionEn: string,
  /** RV1909's commonest renderings of this word, with how often. */
  usageEs: [word: string, count: number][],
  /** es-419 Palabras de Traducción entries that list this number. */
  es419: string[]
];

/** One lexicon file: "G" for Greek, "H" for Hebrew and Aramaic. */
export type LexiconPack = Record<string, LexiconEntry>;

/** es-419 Palabras de Traducción, by id ("kt/love"). */
export type TranslationWordsPack = Record<
  string,
  [title: string, body: string, strongs: string[]]
>;

/**
 * Base Strong number ("G0026") → book → "chapter:verse" of each occurrence,
 * repeated when a verse has the word twice.
 */
export type ConcordancePack = Record<string, Record<string, string[]>>;

/**
 * A Bible dictionary: id ("EAS:bethel") → the entry. The note keeps only the
 * id (A2); the words come from here each time the entry is shown.
 */
export type DictionaryPack = Record<
  string,
  [term: string, source: DictionarySource, body: string]
>;

/** Easton, Smith and Hitchcock (English); es-419 and Rand (Spanish). */
export type DictionarySource = "EAS" | "SMI" | "HIT" | "TW" | "RAND";

/** One book of the corpus, in canonical versification (ADR-0004). */
export type BookPack = {
  book: string;
  /** "chapter:verse" → the verse's words in reading order. */
  verses: Record<string, PackToken[]>;
};
