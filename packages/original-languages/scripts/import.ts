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

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BOOKS,
  type BookPack,
  type ConcordancePack,
  type DictionaryPack,
  type LexiconPack,
  type PackToken,
  type TranslationWordsPack
} from "../src/pack.ts";
import {
  fetchSources,
  readArchive,
  readFolder,
  readSource
} from "./sources.ts";
import { buildRand } from "./rand.ts";

/** The 30-entry sample of Rand was reviewed and approved, with the OCR
 * corrections, on 2026-09-27 (A2 Paso 7.2). */
const RAND_APPROVED = true;

/** STEP's book abbreviations, in canonical order, as USFM codes. */
const STEP_BOOKS: Record<string, string> = Object.fromEntries(
  "Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh Est Job Psa Pro Ecc Sng Isa Jer Lam Ezk Dan Hos Jol Amo Oba Jon Mic Nam Hab Zep Hag Zec Mal Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php Col 1Th 2Th 1Ti 2Ti Tit Phm Heb Jas 1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev"
    .split(" ")
    .map((step, index) => [step, BOOKS[index]])
);

// Book.chapter.verse as the NRSV numbers it, then any other tradition's
// numbering where it differs, the word, and the text type. TAHOT puts the
// Hebrew in round brackets ("Mal.4.1(3.19)"); TAGNT puts the KJV in square
// ones, NA in round ones and others in curly ones ("2Co.13.13[13.14]").
const REF =
  /^([1-3]?[A-Z][a-z]{1,2})\.(\d+)\.(\d+)((?:[([{]\d+\.\d+[)\]}])*)#(\d+)=(\S+)$/;

/** The chapter and verse inside one kind of bracket of a ref, if any. */
function bracketed(others: string, open: "(" | "[") {
  for (const [, bracket, chapter, verse] of others.matchAll(
    /([([{])(\d+)\.(\d+)/g
  ))
    if (bracket === open) return [Number(chapter), Number(verse)] as const;
}

/** A STEP word, plus what it takes to find it in Clear-Bible's text. */
type StepWord = {
  book: string;
  chapter: number;
  verse: number;
  /** The verse in Clear-Bible's numbering: "BBCCCVVV". */
  sourceVerse: string;
  token: PackToken;
  /** Strong numbers to match on, without prefixes or letter suffixes. */
  numbers: number[];
};

const number = (strong: string) => Number(/\d+/.exec(strong)?.[0] ?? NaN);
const verseId = (book: string, chapter: number, verse: number) =>
  String(BOOKS.indexOf(book) + 1).padStart(2, "0") +
  String(chapter).padStart(3, "0") +
  String(verse).padStart(3, "0");

// Cantillation marks, meteg, paseq and sof pasuq: reading aids that would
// split one word's column into noise. The vowels stay.
const CANTILLATION = /[֑-ֽ֯׀׃]/g;

function* readStep(files: string[], hebrew: boolean): Generator<StepWord> {
  for (const file of files)
    for (const line of readSource(file).split("\n")) {
      const columns = line.split("\t");
      const ref = REF.exec(columns[0]);
      if (!ref) continue;
      const [, step, c, v, others, , type] = ref;
      // Hebrew: the Leningrad text and its qere. Greek: the words NA28/NA27
      // print (upper-case N); the rest are variants of other editions.
      if (hebrew ? !/^[LQ]/.test(type) : !type.includes("N")) continue;
      const book = STEP_BOOKS[step];
      const nrsv = [Number(c), Number(v)] as const;
      // The canonical versification is the English one (ADR-0004), which
      // follows the KJV where it and the NRSV part ways. Clear-Bible numbers
      // its source as the Hebrew Bible and NA do.
      const [chapter, verse] = hebrew ? nrsv : bracketed(others, "[") ?? nrsv;
      const [sourceChapter, sourceVerseNumber] =
        bracketed(others, "(") ?? nrsv;
      const sourceVerse = verseId(book, sourceChapter, sourceVerseNumber);

      if (hebrew) {
        const [, word, transliteration, gloss, strongs, morph] = columns;
        const all = strongs.match(/[HA]\d+[A-Za-z]?/g) ?? [];
        const main = /\{([HA]\d+[A-Za-z]?)\}/.exec(strongs)?.[1] ?? all[0];
        yield {
          book,
          chapter,
          verse,
          sourceVerse,
          numbers: all.map(number).filter((n) => n < 9000),
          token: [
            word.replace(/[/\\]/g, "").replace(CANTILLATION, "").trim(),
            transliteration.replace(/\//g, ""),
            main ?? "",
            morph ?? "",
            gloss.replace(/\//g, "").trim(),
            ""
          ]
        };
      } else {
        const [, greek, gloss, strongMorph] = columns;
        const [, word, transliteration] = /^(.*?)\s*\((.*)\)$/.exec(greek) ?? [
          "",
          greek,
          ""
        ];
        const [strongs, morph] = strongMorph.split("=");
        const strong = strongs.split("«").pop()!.split("|").pop()!;
        yield {
          book,
          chapter,
          verse,
          sourceVerse,
          numbers: [number(strong)],
          token: [word, transliteration, strong, morph ?? "", gloss.trim(), ""]
        };
      }
    }
}

/** One word of Clear-Bible's source text and the target words aligned to it. */
type SourceWord = { numbers: number[]; spanish: string[] };

/**
 * Clear-Bible's source text (SBLGNT or WLCM) by verse, with the RV1909
 * words its alignment gives each source word. WLCM splits a Hebrew word into
 * morphemes; they are joined back into the word STEP has.
 */
function readAlignment(
  sourceFile: string,
  targetFile: string,
  alignmentFile: string
) {
  const target = new Map<string, string>();
  for (const line of readSource(targetFile).split("\n").slice(1)) {
    const [id, , text] = line.split("\t");
    if (id) target.set(id, text);
  }
  const aligned = new Map<string, string[]>();
  const { records } = JSON.parse(readSource(alignmentFile)) as {
    records: { source: string[]; target: string[] }[];
  };
  for (const record of records)
    for (const source of record.source)
      aligned.set(source, [...(aligned.get(source) ?? []), ...record.target]);

  const verses = new Map<string, SourceWord[]>();
  const words = new Map<string, SourceWord & { targets: Set<string> }>();
  for (const line of readSource(sourceFile).split("\n").slice(1)) {
    const [id, , , strongs] = line.split("\t");
    if (!id) continue;
    // n40001001001 (Greek word) or o010010010011 (Hebrew morpheme).
    const wordId = id.slice(0, 12);
    let word = words.get(wordId);
    if (!word) {
      word = { numbers: [], spanish: [], targets: new Set() };
      words.set(wordId, word);
      const verse = wordId.slice(1, 9);
      verses.set(verse, [...(verses.get(verse) ?? []), word]);
    }
    word.numbers.push(number(strongs));
    for (const targetId of aligned.get(id) ?? []) word.targets.add(targetId);
  }
  for (const word of words.values())
    word.spanish = [...word.targets]
      .sort()
      .map((id) => target.get(id) ?? "")
      .filter((text) => /\p{L}/u.test(text));
  return verses;
}

/**
 * Pairs a verse's STEP words with Clear-Bible's words. The two texts are the
 * same tradition but not the same edition, so a word is matched on its Strong
 * number a few places ahead; if that fails and both verses have as many words,
 * the word in the same position is taken.
 */
function pair(step: StepWord[], source: SourceWord[]) {
  const used = new Set<number>();
  let cursor = 0;
  step.forEach((word, index) => {
    let found = -1;
    for (let k = cursor; k < Math.min(cursor + 5, source.length); k++)
      if (
        !used.has(k) &&
        source[k].numbers.some((n) => word.numbers.includes(n))
      ) {
        found = k;
        break;
      }
    if (found < 0 && step.length === source.length && !used.has(index))
      found = index;
    if (found < 0) return;
    used.add(found);
    cursor = Math.max(cursor, found + 1);
    // ponytail: no Spanish is ever made up. A word RV1909 does not render
    // (most Greek articles) keeps an empty gloss.
    word.token[5] = source[found].spanish.join(" ");
  });
}

export type Coverage = { tokens: number; withSpanish: number };

/** Every book, glossed in Spanish where the alignment allows. */
export function buildBooks() {
  const books = new Map<string, BookPack>();
  const coverage: Record<"OT" | "NT", Coverage> = {
    OT: { tokens: 0, withSpanish: 0 },
    NT: { tokens: 0, withSpanish: 0 }
  };
  for (const hebrew of [true, false]) {
    const source = hebrew
      ? readAlignment("WLCM.tsv", "ot_RV09.tsv", "WLCM-RV09-manual.json")
      : readAlignment("SBLGNT.tsv", "nt_RV09.tsv", "SBLGNT-RV09-manual.json");
    const files = hebrew
      ? [
          "TAHOT-Gen-Deu.txt",
          "TAHOT-Jos-Est.txt",
          "TAHOT-Job-Sng.txt",
          "TAHOT-Isa-Mal.txt"
        ]
      : ["TAGNT-Mat-Jhn.txt", "TAGNT-Act-Rev.txt"];

    // A verse's words, collected until the next verse starts.
    let verse: StepWord[] = [];
    const flush = () => {
      if (!verse.length) return;
      const [{ book, chapter, verse: number, sourceVerse }] = verse;
      pair(verse, source.get(sourceVerse) ?? []);
      let pack = books.get(book);
      if (!pack) books.set(book, (pack = { book, verses: {} }));
      // A verse the traditions divide differently can come in pieces.
      (pack.verses[`${chapter}:${number}`] ??= []).push(
        ...verse.map((word) => word.token)
      );
      const counts = coverage[hebrew ? "OT" : "NT"];
      counts.tokens += verse.length;
      counts.withSpanish += verse.filter((word) => word.token[5]).length;
      verse = [];
    };
    for (const word of readStep(files, hebrew)) {
      const [last] = verse;
      if (
        last &&
        (last.chapter !== word.chapter ||
          last.verse !== word.verse ||
          last.sourceVerse !== word.sourceVerse)
      )
        flush();
      verse.push(word);
    }
    flush();
  }
  return { books, coverage };
}

/** "G26", "G0026" and "G0026G" all share the base "G0026". */
const base = (strong: string) => {
  const [, letter, digits] = /^([GHA])(\d+)/.exec(strong) ?? [];
  return letter ? letter.replace("A", "H") + digits.padStart(4, "0") : strong;
};

/** STEP's definitions are HTML; the app shows them as text. */
const htmlToText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

/**
 * es-419 Palabras de Traducción, keeping of each entry what a reader wants:
 * its definition and what it says about the word. The translation advice,
 * the Bible references and the Open Bible Stories examples are for
 * translators and stay out.
 */
export function buildTranslationWords(): TranslationWordsPack {
  const pack: TranslationWordsPack = {};
  for (const [path, text] of readArchive("es-419_tw-v37.tar.gz")) {
    const id = /^es-419_tw\/bible\/(\w+\/[\w-]+)\.md$/.exec(path)?.[1];
    if (!id) continue;
    const title = /^# (.+)$/m.exec(text)?.[1].trim() ?? id;
    const strongs = (
      /Números? de Strong:?\s*(.+)/.exec(text)?.[1].match(/[GHA]\d+/g) ?? []
    ).map(base);
    const body = text
      .replace(/^# .+\n/, "")
      .replace(/^\s*## Definición\s*/, "")
      .split(/^## (?:Sugerencias de traducción|Referencias bíblicas|Ejemplos de las historias|Datos de )/m)[0]
      // Links to other entries keep their words; the paths mean nothing here.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*/g, "")
      // Shown as plain text: a Markdown bullet becomes a real one.
      .replace(/^\s*[*-] /gm, "• ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    pack[id] = [title, body, strongs];
  }
  return pack;
}

const FUNCTION_WORDS = new Set(
  "el la lo los las un una unos unas de del a al y e o u en con por para que se su sus mi mis tu tus".split(
    " "
  )
);

/** STEP's brief lexicon, with RV1909's usage and the es-419 entries. */
export function buildLexicon(
  books: Map<string, BookPack>,
  words: TranslationWordsPack
): Record<"G" | "H", LexiconPack> {
  // What RV1909 says for each Strong number, counted over the whole corpus.
  const usage = new Map<string, Map<string, number>>();
  for (const pack of books.values())
    for (const tokens of Object.values(pack.verses))
      for (const [, , strong, , , glossEs] of tokens) {
        const word = glossEs.toLowerCase().replace(/[^\p{L}\s]/gu, "").trim();
        // An article or preposition alone is the alignment catching a
        // neighbour, not a way RV1909 renders the word.
        if (!word || FUNCTION_WORDS.has(word)) continue;
        const counts = usage.get(strong) ?? new Map<string, number>();
        counts.set(word, (counts.get(word) ?? 0) + 1);
        usage.set(strong, counts);
      }
  const es419 = new Map<string, string[]>();
  for (const [id, [, , strongs]] of Object.entries(words))
    for (const strong of strongs)
      es419.set(strong, [...(es419.get(strong) ?? []), id]);

  const lexicon: Record<"G" | "H", LexiconPack> = { G: {}, H: {} };
  for (const file of ["TBESG.txt", "TBESH.txt"] as const)
    for (const line of readSource(file).split("\n")) {
      const [eStrong, dStrong, , lemma, transliteration, morph, gloss, html] =
        line.split("\t");
      if (!/^[GH]\d+[A-Za-z]?$/.test(eStrong ?? "")) continue;
      const strong = dStrong.split(" ")[0];
      // ponytail: only the numbers the corpus uses. TBESG also covers the
      // Septuagint, which would double the file for words no verse shows.
      if (!usage.has(strong) && !usage.has(eStrong)) continue;
      const counts = usage.get(strong) ?? usage.get(eStrong)!;
      lexicon[file === "TBESG.txt" ? "G" : "H"][strong] = [
        lemma,
        transliteration,
        morph,
        gloss,
        htmlToText(html ?? ""),
        [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6),
        es419.get(base(strong)) ?? []
      ];
    }
  return lexicon;
}

/**
 * Where every Strong number occurs (A2 Fase 5), by its base number so a word's
 * senses count together: "G0026" → { JHN: ["13:35", …] }, one entry per
 * occurrence, books in canonical order.
 */
export function buildConcordance(
  books: Map<string, BookPack>
): Record<"G" | "H", ConcordancePack> {
  const concordance: Record<"G" | "H", ConcordancePack> = { G: {}, H: {} };
  for (const book of BOOKS) {
    const pack = books.get(book);
    if (!pack) continue;
    for (const [verse, tokens] of Object.entries(pack.verses))
      for (const [, , strong] of tokens) {
        if (!strong) continue;
        const key = base(strong);
        const index = concordance[key[0] as "G" | "H"];
        const byBook = (index[key] ??= {});
        (byBook[book] ??= []).push(verse);
      }
  }
  return concordance;
}

type NeuuEntry = {
  name: string;
  slug: string;
  definitions: { source: string; text: string }[];
};

/** Easton, Smith and Hitchcock, one entry per dictionary and term (Fase 6). */
export function buildDictionaryEn(): DictionaryPack {
  const pack: DictionaryPack = {};
  for (const [file, entries] of readFolder("neuu")) {
    const source = (
      { easton: "EAS", smith: "SMI", hitchcock: "HIT" } as const
    )[file.split("-")[0] as "easton" | "smith" | "hitchcock"];
    for (const { name, slug, definitions } of Object.values(
      entries as Record<string, NeuuEntry>
    )) {
      const body = definitions
        .filter((definition) => definition.source === source)
        .map((definition) => definition.text.trim())
        .filter(Boolean)
        .join("\n\n");
      if (body) pack[`${source}:${slug}`] = [name, source, body];
    }
  }
  return pack;
}

const percent = ({ tokens, withSpanish }: Coverage) =>
  ((withSpanish / tokens) * 100).toFixed(1);

// ponytail: no CLI parser. `--build <folder>` writes original/<BOOK>.json
// there; a reference like "JHN 3:16" prints that verse's tokens.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await fetchSources();
  const { books, coverage } = buildBooks();
  console.error(
    `glosa en español: AT ${percent(coverage.OT)} %, NT ${percent(coverage.NT)} %`
  );
  if (process.argv[2] === "--build") {
    const out = `${process.argv[3]}/original`;
    mkdirSync(out, { recursive: true });
    for (const [book, pack] of books)
      writeFileSync(`${out}/${book}.json`, JSON.stringify(pack));
    const words = buildTranslationWords();
    writeFileSync(`${out}/es-419-tw.json`, JSON.stringify(words));
    const lexicon = buildLexicon(books, words);
    for (const [language, entries] of Object.entries(lexicon))
      writeFileSync(`${out}/lexicon-${language}.json`, JSON.stringify(entries));
    writeFileSync(
      `${out}/dictionary-en.json`,
      JSON.stringify(buildDictionaryEn())
    );
    // Rand ships only once a person has read a sample of the cleaned OCR
    // (A2 Paso 7.2, 🛑); until then the file is there, and empty.
    writeFileSync(
      `${out}/dictionary-es-rand.json`,
      JSON.stringify(RAND_APPROVED ? buildRand() : {})
    );
    for (const [language, index] of Object.entries(buildConcordance(books)))
      writeFileSync(
        `${out}/concordance-${language}.json`,
        JSON.stringify(index)
      );
    console.error(
      `${books.size} libros, ${Object.keys(words).length} entradas es-419 y ${Object.keys(lexicon.G).length + Object.keys(lexicon.H).length} del léxico escritos en ${out}`
    );
  } else {
    const [book, rest] = (process.argv[2] ?? "JHN 3:16").split(/\s+/);
    console.log(JSON.stringify(books.get(book)?.verses[rest], null, 1));
  }
}
