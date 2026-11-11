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

// The dictionary search (A6 Fase 3). Nothing here reads a file, so the tests
// run it on the real packs without a page.
import type {
  DictionaryPack,
  DictionarySource,
  DictionaryWordsPack,
  TranslationWordsPack,
  WiktionaryIndexPack
} from "./pack.ts";

/** Accents, breathings and points off, so "agape" and "αγαπη" both find ἀγάπη. */
// The class is U+0300–U+036F (Greek accents and breathings), U+0591–U+05C7
// (Hebrew points and cantillation), the transliteration's syllable dots and
// its apostrophes.
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-֑ͯ-ׇ.'’ʼ]/g, "")
    .toLowerCase();

/** Folded for comparing terms: "Bet-el", "Betel" and "BETEL" are one. */
export const foldTerm = (text: string) => fold(text).replace(/[\s-]/g, "");

export type DictionaryEntry = {
  /** "EAS:bethel", "TW:kt/grace": what a note keeps. */
  id: string;
  term: string;
  source: DictionarySource;
};

export type DictionaryHit = DictionaryEntry & {
  /** Found by its title, or only in its text ("Aparece en"). */
  match: "term" | "text";
  /** A Wiktionary lemma also shown as a biblical source. */
  biblical?: true;
};

/** The dictionary screen's three sections, in the order it shows them. */
export const DICTIONARY_SECTIONS = ["biblical", "spanish", "english"] as const;
export type DictionarySection = (typeof DICTIONARY_SECTIONS)[number];

export function dictionarySection(hit: DictionaryHit): DictionarySection {
  if (hit.source === "WIKT") return hit.biblical ? "biblical" : "spanish";
  return ["EAS", "SMI", "HIT"].includes(hit.source) ? "english" : "biblical";
}

/** The hits by section, each in search order; empty sections left out. */
export function groupDictionaryHits(hits: DictionaryHit[]) {
  return DICTIONARY_SECTIONS.map(
    (section) =>
      [section, hits.filter((hit) => dictionarySection(hit) === section)] as const
  ).filter(([, found]) => found.length > 0);
}

/** A word in the Real Academia's dictionary (A6 Paso 7.3). */
export const dleUrl = (word: string) =>
  `https://dle.rae.es/${encodeURIComponent(word.trim())}`;

/**
 * The file a Wiktionary lemma or form is in: its first two folded letters,
 * so looking one up reads a few hundred KB, not the whole dictionary.
 */
export const wiktionaryGroup = (term: string) =>
  foldTerm(term)
    .slice(0, 2)
    .replace(/[^a-z0-9]/g, "_")
    .padEnd(2, "_");

// The order results come in: the Spanish works first (A2 Fase 7), the modern
// before the 1890 one, then the general Spanish one, then the English ones.
const SOURCE_ORDER: DictionarySource[] = [
  "TW",
  "RAND",
  "EASES",
  "WIKT",
  "EAS",
  "SMI",
  "HIT"
];

// Words too common to say where a term appears. Lookups are by whole word, so
// these only keep the index small and "de" from listing every entry.
const STOPWORDS = new Set(
  "las los del por con una uno unos unas para que como mas pero sus este esta estos estas ese esa eso aquel fue era son ser han hay sin sobre entre hasta desde cuando donde tambien muy todo toda todos todas otro otra otros otras cual cuales quien les nos ella ellos ellas dicho dicha the and for that with was were are this from his her its which who whom been have has had not but they their them into than then there also one two may might shall would could should upon our out any all".split(
    " "
  )
);

/** The words of an entry's text, folded, each once. */
function words(body: string) {
  const found = new Set<string>();
  for (const word of fold(body).split(/[^\p{L}\p{N}]+/u))
    if (word.length > 2 && !STOPWORDS.has(word)) found.add(word);
  return found;
}

/**
 * The plural and singular a query may stand for: "profetas" → "profeta",
 * "leyes" → "ley", "luces" → "luz", "cities" → "city", and back; and the
 * 1890 "-em" of "Jerusalén".
 * shortcut: suffixes only; Wikcionario's inflected forms (Fase 4) cover verbs
 * and irregular nouns.
 */
export function nearForms(word: string) {
  const forms = new Set<string>();
  if (word.endsWith("ces")) forms.add(`${word.slice(0, -3)}z`);
  if (word.endsWith("ies")) forms.add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) forms.add(word.slice(0, -2));
  if (word.endsWith("s")) forms.add(word.slice(0, -1));
  if (word.endsWith("z")) forms.add(`${word.slice(0, -1)}ces`);
  // Rand (1890) writes "Jerusalem", "Matusalem" for today's -én.
  if (word.endsWith("n")) forms.add(`${word.slice(0, -1)}m`);
  if (word.endsWith("m")) forms.add(`${word.slice(0, -1)}n`);
  forms.add(`${word}s`);
  forms.add(`${word}es`);
  forms.delete(word);
  return [...forms].filter((form) => form.length > 1);
}

/** The packs as one, with es-419 under "TW:". */
export function mergeDictionaries(
  packs: DictionaryPack[],
  words: TranslationWordsPack
): DictionaryPack {
  const all: DictionaryPack = Object.assign({}, ...packs);
  for (const [id, [title, body]] of Object.entries(words))
    all[`TW:${id}`] = [title, "TW", body];
  return all;
}

/**
 * Each folded word of the entries' text → the entries that have it. The
 * import writes it as dictionary-words.json: building it on a phone takes
 * longer than reading it.
 */
export function buildWordIndex(pack: DictionaryPack): DictionaryWordsPack {
  const ids = Object.keys(pack);
  // No prototype: "constructor" is a word of Easton's text.
  const found: Record<string, number[]> = Object.create(null);
  ids.forEach((id, n) => {
    for (const word of words(pack[id][2])) (found[word] ??= []).push(n);
  });
  return { ids, words: found };
}

export type DictionaryIndex = {
  entries: Map<string, DictionaryEntry>;
  /** Folded term → ids, of the packs. */
  terms: Map<string, string[]>;
  /** The packs' folded terms in order, for prefix search. */
  sorted: string[];
  words: DictionaryWordsPack;
  /** Wiktionary's lemmas, folded and in order as the import wrote them. */
  wiktionary?: WiktionaryIndexPack;
  /** Wiktionary ids shown as biblical too. */
  biblical: Set<string>;
};

function add(map: Map<string, string[]>, key: string, id: string) {
  const ids = map.get(key);
  if (!ids) map.set(key, [id]);
  else if (ids[ids.length - 1] !== id) ids.push(id);
}

/**
 * The index of the packs' titles. Wiktionary's lemmas and the words of the
 * text come ready from the import (the words are built here when not given):
 * building them on the emulator took 2.8 s.
 */
export function buildDictionaryIndex(
  pack: DictionaryPack,
  wiktionary?: WiktionaryIndexPack,
  words = buildWordIndex(pack)
): DictionaryIndex {
  const index: DictionaryIndex = {
    entries: new Map(),
    terms: new Map(),
    sorted: [],
    words,
    wiktionary,
    biblical: new Set(wiktionary?.biblical.map((lemma) => `WIKT:${lemma}`))
  };
  for (const [id, [term, source]] of Object.entries(pack)) {
    index.entries.set(id, { id, term, source });
    // "amor, amar, amado" (es-419), "Zur o Sur" (Rand) and "Aco (Achô)"
    // (Easton in Spanish) name several.
    for (const each of term.split(/,| o |[()]/)) {
      const folded = foldTerm(each);
      if (folded) add(index.terms, folded, id);
    }
  }
  index.sorted = [...index.terms.keys()].sort();
  return index;
}

/**
 * Builds the index on the first search and keeps it: the packs are read and
 * combined once per session, not on each keystroke. A failed build is tried
 * again next time.
 */
export function indexOnce(
  load: () => Promise<
    [DictionaryPack, WiktionaryIndexPack?, DictionaryWordsPack?]
  >
) {
  let built: Promise<DictionaryIndex> | undefined;
  return () => {
    if (!built) {
      built = load().then((packs) => buildDictionaryIndex(...packs));
      built.catch(() => (built = undefined));
    }
    return built;
  };
}

// localeCompare builds a collator on each call; "amor" sorts thousands.
const collator = new Intl.Collator("es");

/** The first place in `sorted` at or after `key`. */
function lowerBound(sorted: string[], key: string) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The entries whose term matches `query`: exact first, then its plural or
 * singular or the lemma of the form it is (`forms`, from Wiktionary's
 * wikt-forms-<group>.json), then the terms that start with it, each group in
 * SOURCE_ORDER.
 * After them, up to `limit` more whose text has the word or its near forms,
 * marked "text" for the "Aparece en" group.
 */
export function searchIndex(
  index: DictionaryIndex,
  query: string,
  limit = 60,
  forms?: Record<string, string[]>
): DictionaryHit[] {
  const wanted = foldTerm(query.trim());
  if (!wanted) return [];
  const wiktionary = index.wiktionary;
  // Wiktionary's entries are made when found, not kept: 139,000 of them.
  const entry = (id: string): DictionaryEntry =>
    index.entries.get(id) ?? { id, term: id.slice(5), source: "WIKT" };
  const ranks = new Map<string, number>();
  const rank = (ids: string[] | undefined, base: number) => {
    for (const id of ids ?? []) {
      const value = base + SOURCE_ORDER.indexOf(entry(id).source);
      if (value < (ranks.get(id) ?? Infinity)) ranks.set(id, value);
    }
  };
  /** Each place in `sorted` equal to `key`, or starting with it. */
  const scan = (
    sorted: string[],
    key: string,
    found: (at: number) => void,
    prefix = false
  ) => {
    // Wiktionary has thousands of words for "a"; the first ones in order do.
    const first = lowerBound(sorted, key);
    for (
      let at = first;
      at < sorted.length &&
      at < first + limit * 4 &&
      (prefix ? sorted[at].startsWith(key) : sorted[at] === key);
      at++
    )
      found(at);
  };
  const lemmaAt = (base: number) => (at: number) =>
    rank([`WIKT:${wiktionary!.lemmas[at]}`], base);
  for (const [key, base] of [
    [wanted, 0],
    ...nearForms(wanted).map((form) => [form, 10])
  ] as [string, number][]) {
    rank(index.terms.get(key), base);
    if (wiktionary) scan(wiktionary.keys, key, lemmaAt(base));
  }
  // Not a form whose lemma this copy of Wiktionary does not have.
  for (const lemma of forms?.[wanted] ?? [])
    scan(wiktionary?.keys ?? [], foldTerm(lemma), (at) => {
      if (wiktionary!.lemmas[at] === lemma) rank([`WIKT:${lemma}`], 10);
    });
  scan(
    index.sorted,
    wanted,
    (at) => rank(index.terms.get(index.sorted[at]), 20),
    true
  );
  if (wiktionary) scan(wiktionary.keys, wanted, lemmaAt(20), true);

  const order = (ids: Iterable<string>) =>
    [...ids]
      .map(entry)
      .sort(
        (a, b) =>
          (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0) ||
          collator.compare(a.term, b.term)
      );
  const hit = (
    entry: DictionaryEntry,
    match: DictionaryHit["match"]
  ): DictionaryHit =>
    index.biblical.has(entry.id)
      ? { ...entry, match, biblical: true }
      : { ...entry, match };
  const byTerm = order(ranks.keys())
    .slice(0, limit)
    .map((entry) => hit(entry, "term"));

  // The entries whose text has every word of the query ("mar Muerto"), each
  // in any of its forms. Common words alone have no "Aparece en".
  let mention: Set<string> | undefined;
  for (const word of words(query)) {
    const found = new Set<string>();
    for (const each of [word, ...nearForms(word)])
      if (Object.hasOwn(index.words.words, each))
        for (const n of index.words.words[each]) {
          const id = index.words.ids[n];
          if (!mention || mention.has(id)) found.add(id);
        }
    mention = found;
  }
  ranks.clear();
  rank([...(mention ?? [])], 0);
  for (const { id } of byTerm) ranks.delete(id);
  const byText = order(ranks.keys())
    .slice(0, limit)
    .map((entry) => hit(entry, "text"));
  return [...byTerm, ...byText];
}
