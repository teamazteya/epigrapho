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

import { readFileSync } from "fs";
import path from "path";
import { parentPort, workerData } from "worker_threads";
import nspell from "nspell";

/**
 * The dictionary, on a thread of its own (PRD §31.11, Paso 6.1).
 *
 * Reading a Hunspell dictionary is not free: 57,000 stems and their affix
 * rules take a second or so to turn into the structure that answers a word,
 * and every keystroke in a long note asks about a handful of words. On the
 * thread that draws the editor that shows up as stutter, and in the main
 * process it would stall the menus and the window. So it happens here, and
 * the two threads that a person can feel only ever send and receive words.
 */
const dictionaries = path.join(__dirname, "dictionaries");
const load = (language: string) =>
  nspell({
    aff: readFileSync(path.join(dictionaries, `${language}.aff`)),
    dic: readFileSync(path.join(dictionaries, `${language}.dic`))
  });
// The languages the person picked in Settings, Spanish when nothing says
// otherwise: the biblical pack is Spanish, and it is what the app is written
// for. A word any of them knows is not an error. Changing the choice starts a
// new worker (see utils/spell-check), so the list is fixed for this one's life.
const languages: string[] = workerData?.languages?.length
  ? workerData.languages
  : ["es"];
const spellers = languages.map(load);
// A token with no letters ("8:28", "3,16", "2026") is a number, and no
// dictionary has numbers: without this every verse reference was underlined.
const correct = (word: string) =>
  !/\p{L}/u.test(word) || spellers.some((speller) => speller.correct(word));

/**
 * The biblical Resource Pack (PRD §31.11, Paso 6.2).
 *
 * A general Spanish dictionary does not know "Yahvé", "Neftalí" or
 * "hamartiología", and a person writing about the Bible types them all day.
 * Every entry of the pack is added to the dictionary, so no biblical term is
 * ever marked as an error — including the spellings of older editions, which
 * are right for the edition they come from.
 *
 * `status` is what the suggestions are built on:
 * - `preferred` and `accepted`: offered as they are.
 * - `variant` ("Yahweh", "Cafarnaúm"): both spellings are right, so the
 *   preferred one is offered first and the variant stays on the list.
 * - `deprecated` ("Ephraim", "Gethsemaní"): accepted when written, never
 *   suggested — the modern spelling takes its place on the list.
 *
 * Nothing here replaces anything: the answer is a list, and it is the person
 * who picks from it.
 */
type Status = "preferred" | "accepted" | "deprecated" | "variant";
type Entry = {
  word: string;
  status: Status;
  categories: string[];
  sourceId: string;
  preferred?: string;
};

const pack: { entries: Entry[] } = JSON.parse(
  readFileSync(path.join(dictionaries, "bible-terms-es.json"), "utf8")
);
const terms = new Map<string, Entry>();
for (const entry of pack.entries) {
  // Added to every dictionary: a name like "Neftalí" is right whichever
  // language the person writes about it in.
  for (const speller of spellers) speller.add(entry.word);
  terms.set(entry.word, entry);
}

const corrections: Record<string, string[]> = JSON.parse(
  readFileSync(path.join(dictionaries, "spelling-corrections-es.json"), "utf8")
).entries;
const folded = (word: string) =>
  word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Damerau distance keeps a swapped pair (amro → amor) a single typo. */
function distance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  rows[0] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1])
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[a.length][b.length];
}

function suggest(word: string, candidates: string[] = []): string[] {
  if (word.length > 64 || correct(word)) return [];
  const lower = word.toLowerCase();
  const spanish = languages.includes("es");
  const preferred = spanish ? corrections[lower] || [] : [];
  const valid = (value: string) =>
    !!value.trim() &&
    value.length <= 128 &&
    /\p{L}/u.test(value) &&
    value
      .trim()
      .split(/\s+/)
      .every((part) => correct(part)) &&
    !(/^[\p{Lu}\d]+$/u.test(value) && /^\p{Ll}+$/u.test(word));
  const close = (value: string) =>
    distance(folded(word), folded(value)) <= (word.length <= 3 ? 1 : 2);
  const order = (values: string[]) =>
    [...new Set(values)]
      .filter((value) => valid(value) && close(value))
      .sort(
        (a, b) =>
          distance(folded(word), folded(a)) - distance(folded(word), folded(b))
      );
  const modern = (values: string[]) =>
    values.flatMap((value) => {
      const term = terms.get(value);
      return term?.preferred
        ? [term.preferred, ...(term.status === "deprecated" ? [] : [value])]
        : [value];
    });
  const external = order(modern(candidates));
  const biblical = order(modern([...terms.keys()]));
  let fallback: string[] = [];
  if (!external.length) {
    fallback = spellers
      .flatMap((speller) =>
        speller.suggest(word).map((value, rank) => ({ value, rank }))
      )
      .sort((a, b) => a.rank - b.rank || a.value.localeCompare(b.value))
      .map((item) => item.value);
    if (spanish) {
      // Known Spanish sound confusions expand candidates; dictionaries still validate every result.
      const forms = new Set([
        lower.replace(/k/g, "c"),
        lower.replace(/s/g, "c"),
        lower.replace(/s/g, "z"),
        lower.replace(/j/g, "g"),
        lower.replace(/g/g, "j"),
        lower.replace(/b/g, "v"),
        lower.replace(/v/g, "b"),
        lower.replace(/ll/g, "y"),
        lower.replace(/y/g, "ll"),
        lower.startsWith("h") ? lower.slice(1) : `h${lower}`
      ]);
      for (const form of forms)
        if (form !== lower) {
          fallback.push(form);
          fallback.push(...spellers[languages.indexOf("es")].suggest(form));
        }
    }
    fallback = order(modern(fallback));
  }
  const unique = new Map<string, string>();
  for (let value of modern([
    ...preferred.filter(valid),
    ...external,
    ...biblical,
    ...fallback
  ])) {
    if (/^\p{Lu}/u.test(word) && /^\p{Ll}/u.test(value))
      value = value[0].toUpperCase() + value.slice(1);
    if (!unique.has(value.toLowerCase()))
      unique.set(value.toLowerCase(), value);
  }
  return [...unique.values()].slice(0, 5);
}

type Request = {
  id: number;
  words?: string[];
  suggest?: string;
  candidates?: string[];
};

// Messages that arrive while the dictionary is still loading wait in the
// port's queue: the listener is attached after the dictionary is ready, and
// nothing is lost, only answered a moment later.
parentPort?.on(
  "message",
  ({ id, words, suggest: word, candidates }: Request) => {
    parentPort?.postMessage({
      id,
      misspelled: words?.filter((each) => !correct(each)) ?? [],
      suggestions: word ? suggest(word, candidates) : []
    });
  }
);
