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

import type { VerseRange } from "@notesnook/scripture-parser";
import {
  BOOKS,
  isOldTestament,
  type BookPack,
  type ConcordancePack,
  type CrossReferencePack,
  type DictionaryPack,
  type DictionarySource,
  type LexiconEntry,
  type LexiconPack,
  type TranslationWordsPack
} from "./pack";

export * from "./pack";

/** One original-language word of a verse (ADR-0009). */
export type OriginalToken = {
  /** Canonical reference of its verse, "JHN.3.16". */
  ref: string;
  /** 1-based place in the verse. */
  position: number;
  surface: string;
  transliteration: string;
  /** Extended Strong number, "G0025" or "H7225G". */
  strong: string;
  morph: string;
  glossEn: string;
  /** Empty where RV1909 does not render the word. */
  glossEs: string;
  /** BCP 47: "he", "arc" (STEP's grammar starts with A) or "grc". */
  lang: "he" | "arc" | "grc";
};

const DB = "epigrapho-original";
// Bump when the packs change: opening a newer version drops every file kept
// from the old one, which would otherwise be read forever.
const DATA_VERSION = 1;
const STORE = "files";

function request<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb() {
  const open = indexedDB.open(DB, DATA_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
    db.createObjectStore(STORE);
  };
  return request(open);
}

/** Same reason as scripture-provider's readPack: XHR can read file://. */
function download<T>(url: string) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "json";
    xhr.onload = () =>
      xhr.response
        ? resolve(xhr.response as T)
        : reject(new Error(`No pack at ${url} (status ${xhr.status}).`));
    xhr.onerror = () => reject(new Error(`Could not read ${url}.`));
    xhr.send();
  });
}

let base = "/";
/** Where original/ sits next to the page; "/" for a served app. */
export function setOriginalBase(url: string) {
  base = url;
}

const files = new Map<string, Promise<unknown>>();

/**
 * A pack file, read once per page. The first time on a device it is fetched
 * and kept in IndexedDB, so a book downloads when it is first used and never
 * again (A2 Paso 2.5); on the desktop the fetch is a local file.
 */
function file<T>(name: string): Promise<T> {
  let found = files.get(name) as Promise<T> | undefined;
  if (!found) {
    found = (async () => {
      const db = await openDb();
      try {
        const stored = await request(
          db.transaction(STORE).objectStore(STORE).get(name)
        );
        if (stored) return stored as T;
        const pack = await download<T>(`${base}original/${name}`);
        await request(
          db.transaction(STORE, "readwrite").objectStore(STORE).put(pack, name)
        );
        return pack;
      } finally {
        db.close();
      }
    })();
    // A failed read is tried again next time instead of being remembered.
    found.catch(() => files.delete(name));
    files.set(name, found);
  }
  return found;
}

/** Every original-language word of a verse or range, verse by verse. */
export async function originalTokens(
  ref: VerseRange
): Promise<OriginalToken[][]> {
  const pack = await file<BookPack>(`${ref.book}.json`);
  const endChapter = ref.endChapter ?? ref.chapter;
  const endVerse = ref.endVerse ?? (ref.endChapter ? Infinity : ref.verse);
  const hebrew = isOldTestament(ref.book);
  const verses: OriginalToken[][] = [];
  for (const [key, tokens] of Object.entries(pack.verses)) {
    const [chapter, verse] = key.split(":").map(Number);
    const at = chapter * 1e4 + verse;
    if (at < ref.chapter * 1e4 + ref.verse || at > endChapter * 1e4 + endVerse)
      continue;
    verses.push(
      tokens.map(
        (
          [surface, transliteration, strong, morph, glossEn, glossEs],
          index
        ) => ({
          ref: `${ref.book}.${chapter}.${verse}`,
          position: index + 1,
          surface,
          transliteration,
          strong,
          morph,
          glossEn,
          glossEs,
          lang: hebrew ? (morph.startsWith("A") ? "arc" : "he") : "grc"
        })
      )
    );
  }
  return verses;
}

/** A Strong number's lexicon entry; "G25" finds "G0025" too. */
export async function lexiconEntry(
  strong: string
): Promise<LexiconEntry | undefined> {
  const [, letter, digits, suffix = ""] =
    /^([GHA])(\d+)([A-Za-z]?)$/.exec(strong) ?? [];
  if (!letter) return;
  const lexicon = await file<LexiconPack>(
    `lexicon-${letter === "G" ? "G" : "H"}.json`
  );
  const padded = `${letter === "A" ? "H" : letter}${digits.padStart(4, "0")}`;
  return (
    lexicon[padded + suffix] ??
    lexicon[padded] ??
    // A bare number names the word; its entry may carry a sense letter.
    Object.entries(lexicon).find(([key]) => key.startsWith(padded))?.[1]
  );
}

/** An es-419 Palabras de Traducción entry. */
export async function translationWord(id: string) {
  return (await file<TranslationWordsPack>("es-419-tw.json"))[id];
}

/** "G26", "g0026" or "H7225G" → "G0026" / "H7225"; anything else → undefined. */
export function baseStrong(query: string) {
  const [, letter, digits] = /^\s*([GHA])0*(\d{1,4})[A-Za-z]?\s*$/i.exec(query) ?? [];
  if (!letter) return;
  const upper = letter.toUpperCase();
  return `${upper === "A" ? "H" : upper}${digits.padStart(4, "0")}`;
}

export type Concordance = {
  strong: string;
  /** Every occurrence, "JHN.13.35", in canonical order; a verse with the word
   * twice is listed twice. */
  total: number;
  /** The corpus the count comes from, as the panel must say (PRD §16). */
  corpus: "TAGNT" | "TAHOT";
  books: { book: string; verses: { ref: string; count: number }[] }[];
};

/** Where a Strong number occurs in the original text (A2 Fase 5). */
/**
 * A verse's cross references (OpenBible.info, A3), most voted first, as USFM
 * references or ranges. Empty for a verse nobody linked.
 */
export async function crossReferences(ref: string): Promise<string[]> {
  const [book, chapter, verse] = ref.split(".");
  if (!book || !chapter || !verse) return [];
  const pack = await file<CrossReferencePack>(`xref-${book}.json`).catch(
    () => ({}) as CrossReferencePack
  );
  return pack[`${chapter}.${verse}`] ?? [];
}

export async function concordance(
  strong: string
): Promise<Concordance | undefined> {
  const base = baseStrong(strong);
  if (!base) return;
  const index = await file<ConcordancePack>(`concordance-${base[0]}.json`);
  const byBook = index[base];
  if (!byBook) return;
  const books = BOOKS.filter((book) => byBook[book]).map((book) => {
    const counts = new Map<string, number>();
    for (const verse of byBook[book])
      counts.set(verse, (counts.get(verse) ?? 0) + 1);
    return {
      book,
      verses: [...counts].map(([verse, count]) => ({
        ref: `${book}.${verse.replace(":", ".")}`,
        count
      }))
    };
  });
  return {
    strong: base,
    total: Object.values(byBook).flat().length,
    corpus: base[0] === "G" ? "TAGNT" : "TAHOT",
    books
  };
}

/** Accents, breathings and points off, so "agape" and "αγαπη" both find ἀγάπη. */
// The class is U+0300–U+036F (Greek accents and breathings), U+0591–U+05C7
// (Hebrew points and cantillation), the transliteration's syllable dots and
// its apostrophes.
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-֑ͯ-ׇ.'’ʼ]/g, "")
    .toLowerCase();

export type OriginalWordMatch = {
  strong: string;
  lemma: string;
  transliteration: string;
  glossEn: string;
};

/**
 * The lexicon entries whose lemma or transliteration matches `query`, for
 * searching the concordance by original word. Exact matches come first.
 */
export async function searchOriginalWord(
  query: string,
  limit = 20
): Promise<OriginalWordMatch[]> {
  const wanted = fold(query.trim());
  if (!wanted) return [];
  const found: (OriginalWordMatch & { exact: boolean })[] = [];
  for (const language of ["G", "H"] as const) {
    const lexicon = await file<LexiconPack>(`lexicon-${language}.json`);
    for (const [strong, [lemma, transliteration, , glossEn]] of Object.entries(
      lexicon
    )) {
      const forms = [fold(lemma), fold(transliteration)];
      if (!forms.some((form) => form.startsWith(wanted))) continue;
      found.push({
        strong,
        lemma,
        transliteration,
        glossEn,
        exact: forms.includes(wanted)
      });
    }
  }
  return found
    .sort((a, b) => Number(b.exact) - Number(a.exact))
    .slice(0, limit)
    .map(({ exact: _, ...match }) => match);
}

export type DictionaryHit = {
  /** "EAS:bethel", "TW:kt/grace": what a note keeps. */
  id: string;
  term: string;
  source: DictionarySource;
};

export type DictionaryArticle = DictionaryHit & {
  body: string;
  /** es-419 lists the Strong numbers an entry covers. */
  strongs: string[];
};

// The order results come in: the Spanish works first (A2 Fase 7), the modern
// before the 1890 one, then the English ones.
const SOURCE_ORDER: DictionarySource[] = ["TW", "RAND", "EAS", "SMI", "HIT"];

/** Every dictionary, as one pack: the English file plus es-419. */
async function dictionaries(): Promise<DictionaryPack> {
  const [english, rand, words] = await Promise.all([
    file<DictionaryPack>("dictionary-en.json"),
    file<DictionaryPack>("dictionary-es-rand.json"),
    file<TranslationWordsPack>("es-419-tw.json")
  ]);
  const all: DictionaryPack = { ...english, ...rand };
  for (const [id, [title, body]] of Object.entries(words))
    all[`TW:${id}`] = [title, "TW", body];
  return all;
}

/** Folded for comparing terms: "Bet-el", "Betel" and "BETEL" are one. */
const foldTerm = (text: string) => fold(text).replace(/[\s-]/g, "");

/**
 * The dictionary entries whose term matches `query`: exact matches first,
 * then the ones that start with it, each group in SOURCE_ORDER. es-419
 * titles list several terms ("amor, amar, amado"); any of them counts.
 */
export async function searchDictionary(
  query: string,
  limit = 60
): Promise<DictionaryHit[]> {
  const wanted = foldTerm(query.trim());
  if (!wanted) return [];
  const hits: (DictionaryHit & { rank: number })[] = [];
  for (const [id, [term, source]] of Object.entries(await dictionaries())) {
    // "amor, amar, amado" (es-419) and "Zur o Sur" (Rand) name several.
    const terms = term.split(/,| o /).map(foldTerm);
    const exact = terms.includes(wanted);
    if (!exact && !terms.some((each) => each.startsWith(wanted))) continue;
    hits.push({
      id,
      term,
      source,
      rank: (exact ? 0 : 10) + SOURCE_ORDER.indexOf(source)
    });
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map(({ rank: _, ...hit }) => hit);
}

/** One dictionary entry by the id a note keeps. */
export async function dictionaryArticle(
  id: string
): Promise<DictionaryArticle | undefined> {
  if (id.startsWith("TW:")) {
    const found = await translationWord(id.slice(3));
    return found && {
      id,
      term: found[0],
      source: "TW",
      body: found[1],
      strongs: found[2]
    };
  }
  const found = (
    await file<DictionaryPack>(
      id.startsWith("RAND:") ? "dictionary-es-rand.json" : "dictionary-en.json"
    )
  )[id];
  return found && { id, term: found[0], source: found[1], body: found[2], strongs: [] };
}
