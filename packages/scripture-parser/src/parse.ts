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

import { bcv_parser } from "bible-passage-reference-parser/esm/bcv_parser.js";
import * as es from "bible-passage-reference-parser/esm/lang/es.js";
import * as en from "bible-passage-reference-parser/esm/lang/en.js";

/**
 * Every reference is stored in a single canonical versification, so this is a
 * constant rather than a parser option (ADR 0004). It is SIL's "English"
 * table, the numbering most Spanish and English Bibles print and the one a
 * person is typing when they write "3 Juan 15".
 *
 * A translation that numbers verses differently is mapped when its text is
 * read, in `@notesnook/scripture-provider`, never when the reference is
 * parsed or stored. A0 wrote "default" here before the tables existed; it
 * named this same numbering, and the mapping still answers to it.
 */
export const CANONICAL_VERSIFICATION = "eng";

/** What a reference points at, with no tie to the text it came from. */
export type VerseRange = {
  /** USFM book code, e.g. "JHN". Never a display name. */
  book: string;
  chapter: number;
  verse: number;
  endChapter?: number;
  endVerse?: number;
  versification: string;
};

export type CanonicalReference = VerseRange & {
  /** Offsets of the matched text inside the parsed string, [start, end). */
  indices: [number, number];
};

const GRAMMARS = { es, en };
export type SupportedLocale = keyof typeof GRAMMARS;

/** OSIS book id (what the parser emits) to USFM book code (what we persist). */
export const OSIS_TO_USFM: Record<string, string> = {
  Gen: "GEN",
  Exod: "EXO",
  Lev: "LEV",
  Num: "NUM",
  Deut: "DEU",
  Josh: "JOS",
  Judg: "JDG",
  Ruth: "RUT",
  "1Sam": "1SA",
  "2Sam": "2SA",
  "1Kgs": "1KI",
  "2Kgs": "2KI",
  "1Chr": "1CH",
  "2Chr": "2CH",
  Ezra: "EZR",
  Neh: "NEH",
  Esth: "EST",
  Job: "JOB",
  Ps: "PSA",
  Prov: "PRO",
  Eccl: "ECC",
  Song: "SNG",
  Isa: "ISA",
  Jer: "JER",
  Lam: "LAM",
  Ezek: "EZK",
  Dan: "DAN",
  Hos: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obad: "OBA",
  Jonah: "JON",
  Mic: "MIC",
  Nah: "NAM",
  Hab: "HAB",
  Zeph: "ZEP",
  Hag: "HAG",
  Zech: "ZEC",
  Mal: "MAL",
  Matt: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Rom: "ROM",
  "1Cor": "1CO",
  "2Cor": "2CO",
  Gal: "GAL",
  Eph: "EPH",
  Phil: "PHP",
  Col: "COL",
  "1Thess": "1TH",
  "2Thess": "2TH",
  "1Tim": "1TI",
  "2Tim": "2TI",
  Titus: "TIT",
  Phlm: "PHM",
  Heb: "HEB",
  Jas: "JAS",
  "1Pet": "1PE",
  "2Pet": "2PE",
  "1John": "1JN",
  "2John": "2JN",
  "3John": "3JN",
  Jude: "JUD",
  Rev: "REV"
};

// The library's `parse()` is declared as returning `any`, so this is the shape
// we actually read out of `parsed_entities()`. A top level entry is either a
// passage or a collection of passages; both carry `entities`.
type BcvEntity = {
  osis?: string;
  indices?: [number, number];
  start?: { b?: string; c?: number; v?: number };
  end?: { b?: string; c?: number; v?: number };
  entities?: BcvEntity[];
};

const parsers = new Map<SupportedLocale, bcv_parser>();
function parserFor(locale: SupportedLocale) {
  let parser = parsers.get(locale);
  if (!parser) {
    parser = new bcv_parser(GRAMMARS[locale]);
    parsers.set(locale, parser);
  }
  return parser;
}

function toCanonical(entity: BcvEntity): CanonicalReference | undefined {
  const { start, end, indices } = entity;
  if (!start?.b || !start.c || !start.v || !indices) return undefined;

  const book = OSIS_TO_USFM[start.b];
  if (!book) return undefined;

  const reference: CanonicalReference = {
    book,
    chapter: start.c,
    verse: start.v,
    versification: CANONICAL_VERSIFICATION,
    indices
  };

  // Ranges that cross a book boundary are out of A0, so only the start of such
  // a range is kept.
  if (end?.b === start.b) {
    if (end.c && end.c !== start.c) reference.endChapter = end.c;
    if (end.v && (end.v !== start.v || reference.endChapter))
      reference.endVerse = end.v;
  }
  return reference;
}

const span = (reference: CanonicalReference) =>
  reference.indices[1] - reference.indices[0];

/**
 * Finds every Bible reference in `text` and returns it in canonical (USFM)
 * form. Every locale is tried, so a reference is never reported twice: when two
 * of them claim overlapping text the longer match wins, and the earlier locale
 * wins a tie. Without that, "1 John 1:1" would be read by the Spanish grammar,
 * which knows "John" but not "1 John", as plain John.
 */
export function parseReferences(
  text: string,
  locales: SupportedLocale[] = ["es", "en"]
): CanonicalReference[] {
  const found: CanonicalReference[] = [];

  for (const locale of locales) {
    const roots = parserFor(locale)
      .parse(text)
      .parsed_entities() as BcvEntity[];
    for (const root of roots)
      for (const entity of root.entities ?? [root]) {
        const reference = toCanonical(entity);
        if (!reference) continue;

        // ponytail: linear overlap scan; a sorted sweep only pays off if a note
        // ever holds thousands of references in one block.
        const overlapping = found.filter(
          (other) =>
            reference.indices[0] < other.indices[1] &&
            other.indices[0] < reference.indices[1]
        );
        if (!overlapping.every((other) => span(other) < span(reference)))
          continue;

        for (const other of overlapping) found.splice(found.indexOf(other), 1);
        found.push(reference);
      }
  }

  return found.sort((a, b) => a.indices[0] - b.indices[0]);
}

/**
 * Renders a reference as the string stored in the editor mark, e.g. "JHN.3.16"
 * or "JHN.3.16-JHN.3.18" for a range.
 */
export function formatRef(reference: CanonicalReference): string {
  const start = `${reference.book}.${reference.chapter}.${reference.verse}`;
  if (!reference.endChapter && !reference.endVerse) return start;

  const end = `${reference.book}.${reference.endChapter ?? reference.chapter}.${
    reference.endVerse ?? reference.verse
  }`;
  return end === start ? start : `${start}-${end}`;
}

/** USFM book code, chapter and verse, optionally followed by the range end. */
const REF = /^([A-Z0-9]{3})\.(\d+)\.(\d+)(?:-([A-Z0-9]{3})\.(\d+)\.(\d+))?$/;

/** Reads back what formatRef wrote. Returns undefined for anything else. */
export function parseRef(ref: string): VerseRange | undefined {
  const match = REF.exec(ref);
  if (!match) return undefined;

  const [, book, chapter, verse, endBook, endChapter, endVerse] = match;
  // Ranges that cross a book boundary are out of A0.
  if (endBook && endBook !== book) return undefined;

  return {
    book,
    chapter: Number(chapter),
    verse: Number(verse),
    ...(endChapter
      ? { endChapter: Number(endChapter), endVerse: Number(endVerse) }
      : {}),
    versification: CANONICAL_VERSIFICATION
  };
}

/**
 * USFM book code to the name a person reads (in a copied verse, for instance),
 * one table per locale. The locale here is the one the UI is running in, not
 * the one a reference was typed in: a note written in Spanish inside an English
 * UI still copies as "John 3:16".
 */
export const BOOK_NAMES: Record<SupportedLocale, Record<string, string>> = {
  es: {
    GEN: "Génesis",
    EXO: "Éxodo",
    LEV: "Levítico",
    NUM: "Números",
    DEU: "Deuteronomio",
    JOS: "Josué",
    JDG: "Jueces",
    RUT: "Rut",
    "1SA": "1 Samuel",
    "2SA": "2 Samuel",
    "1KI": "1 Reyes",
    "2KI": "2 Reyes",
    "1CH": "1 Crónicas",
    "2CH": "2 Crónicas",
    EZR: "Esdras",
    NEH: "Nehemías",
    EST: "Ester",
    JOB: "Job",
    PSA: "Salmos",
    PRO: "Proverbios",
    ECC: "Eclesiastés",
    SNG: "Cantares",
    ISA: "Isaías",
    JER: "Jeremías",
    LAM: "Lamentaciones",
    EZK: "Ezequiel",
    DAN: "Daniel",
    HOS: "Oseas",
    JOL: "Joel",
    AMO: "Amós",
    OBA: "Abdías",
    JON: "Jonás",
    MIC: "Miqueas",
    NAM: "Nahúm",
    HAB: "Habacuc",
    ZEP: "Sofonías",
    HAG: "Hageo",
    ZEC: "Zacarías",
    MAL: "Malaquías",
    MAT: "Mateo",
    MRK: "Marcos",
    LUK: "Lucas",
    JHN: "Juan",
    ACT: "Hechos",
    ROM: "Romanos",
    "1CO": "1 Corintios",
    "2CO": "2 Corintios",
    GAL: "Gálatas",
    EPH: "Efesios",
    PHP: "Filipenses",
    COL: "Colosenses",
    "1TH": "1 Tesalonicenses",
    "2TH": "2 Tesalonicenses",
    "1TI": "1 Timoteo",
    "2TI": "2 Timoteo",
    TIT: "Tito",
    PHM: "Filemón",
    HEB: "Hebreos",
    JAS: "Santiago",
    "1PE": "1 Pedro",
    "2PE": "2 Pedro",
    "1JN": "1 Juan",
    "2JN": "2 Juan",
    "3JN": "3 Juan",
    JUD: "Judas",
    REV: "Apocalipsis"
  },
  en: {
    GEN: "Genesis",
    EXO: "Exodus",
    LEV: "Leviticus",
    NUM: "Numbers",
    DEU: "Deuteronomy",
    JOS: "Joshua",
    JDG: "Judges",
    RUT: "Ruth",
    "1SA": "1 Samuel",
    "2SA": "2 Samuel",
    "1KI": "1 Kings",
    "2KI": "2 Kings",
    "1CH": "1 Chronicles",
    "2CH": "2 Chronicles",
    EZR: "Ezra",
    NEH: "Nehemiah",
    EST: "Esther",
    JOB: "Job",
    PSA: "Psalms",
    PRO: "Proverbs",
    ECC: "Ecclesiastes",
    SNG: "Song of Songs",
    ISA: "Isaiah",
    JER: "Jeremiah",
    LAM: "Lamentations",
    EZK: "Ezekiel",
    DAN: "Daniel",
    HOS: "Hosea",
    JOL: "Joel",
    AMO: "Amos",
    OBA: "Obadiah",
    JON: "Jonah",
    MIC: "Micah",
    NAM: "Nahum",
    HAB: "Habakkuk",
    ZEP: "Zephaniah",
    HAG: "Haggai",
    ZEC: "Zechariah",
    MAL: "Malachi",
    MAT: "Matthew",
    MRK: "Mark",
    LUK: "Luke",
    JHN: "John",
    ACT: "Acts",
    ROM: "Romans",
    "1CO": "1 Corinthians",
    "2CO": "2 Corinthians",
    GAL: "Galatians",
    EPH: "Ephesians",
    PHP: "Philippians",
    COL: "Colossians",
    "1TH": "1 Thessalonians",
    "2TH": "2 Thessalonians",
    "1TI": "1 Timothy",
    "2TI": "2 Timothy",
    TIT: "Titus",
    PHM: "Philemon",
    HEB: "Hebrews",
    JAS: "James",
    "1PE": "1 Peter",
    "2PE": "2 Peter",
    "1JN": "1 John",
    "2JN": "2 John",
    "3JN": "3 John",
    JUD: "Jude",
    REV: "Revelation"
  }
};

/**
 * Renders a reference the way a person writes it in `locale`, e.g. "Juan 3:16",
 * "Juan 3:16-18" or "John 3:16-4:2". Unknown books keep their USFM code.
 */
export function formatReadableRef(
  reference: VerseRange,
  locale: SupportedLocale
): string {
  const book = BOOK_NAMES[locale][reference.book] || reference.book;
  const start = `${book} ${reference.chapter}:${reference.verse}`;
  if (!reference.endChapter && !reference.endVerse) return start;

  const endChapter = reference.endChapter ?? reference.chapter;
  const endVerse = reference.endVerse ?? reference.verse;
  if (endChapter === reference.chapter)
    return endVerse === reference.verse ? start : `${start}-${endVerse}`;
  return `${start}-${endChapter}:${endVerse}`;
}

/** Every `data-scripture-ref` an editor document carries, in the attribute. */
const REF_ATTRIBUTE = /data-scripture-ref="([^"]+)"/g;

/**
 * The references a saved note cites, in the order they appear and without
 * repeats. It reads the stored document rather than the words: the marks and
 * the scripture blocks already carry the canonical reference, so nothing has
 * to be parsed again, and a reference written in Spanish and the same one
 * written in English come out as one string.
 *
 * ponytail: a regular expression over the attribute, not a DOM parse. The
 * documents are HTML the editor itself wrote, the attribute is always quoted,
 * and this runs on every save of every note.
 */
export function extractRefs(html: string): string[] {
  const found: string[] = [];
  // parseRef is the gate: an attribute that is not a canonical reference
  // does not belong in an index of references.
  for (const [, ref] of html.matchAll(REF_ATTRIBUTE))
    if (parseRef(ref) && !found.includes(ref)) found.push(ref);
  return found;
}
