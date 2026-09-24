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
import { parentPort } from "worker_threads";
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
// Spanish first: the biblical pack is Spanish, and it is what the app is
// written for. English sits beside it because notes quote English
// translations (BSB, KJV) and people write in both. A word either dictionary
// knows is not an error.
// ponytail: both are always on; a per-person choice of languages is the
// upgrade if a Spanish word that happens to be English slips through.
const speller = load("es");
const english = load("en");
// A token with no letters ("8:28", "3,16", "2026") is a number, and neither
// dictionary has numbers: without this every verse reference was underlined.
const correct = (word: string) =>
  !/\p{L}/u.test(word) || speller.correct(word) || english.correct(word);

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
  speller.add(entry.word);
  terms.set(entry.word, entry);
}

function suggest(word: string): string[] {
  const suggestions: string[] = [];
  for (const suggestion of [
    ...speller.suggest(word),
    ...english.suggest(word)
  ]) {
    const term = terms.get(suggestion);
    // An old spelling points at the current one instead of at itself; a
    // variant keeps its place but lets the preferred form go first.
    if (term?.preferred) suggestions.push(term.preferred);
    if (term?.status !== "deprecated") suggestions.push(suggestion);
  }
  return [...new Set(suggestions)];
}

type Request = { id: number; words?: string[]; suggest?: string };

// Messages that arrive while the dictionary is still loading wait in the
// port's queue: the listener is attached after the dictionary is ready, and
// nothing is lost, only answered a moment later.
parentPort?.on("message", ({ id, words, suggest: word }: Request) => {
  parentPort?.postMessage({
    id,
    misspelled: words?.filter((each) => !correct(each)) ?? [],
    suggestions: word ? suggest(word) : []
  });
});
