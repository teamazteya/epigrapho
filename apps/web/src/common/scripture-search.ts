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
  parseRef,
  parseReferences,
  VerseRange
} from "@notesnook/scripture-parser";
import type {
  FilteredSelector,
  Item,
  Note,
  SortOptions,
  VirtualizedGrouping
} from "@notesnook/core";
import { indexedRefs, notesForAll } from "./reference-index";

/**
 * Searching the notes by passage (PRD §31.10, Paso 5.3).
 *
 * Text search cannot answer this. "Ro 8", "Romanos 8" and "Romans 8" are three
 * different strings and none of them is what the note says; the note says
 * "Romanos 8:28", or "Rom. 8:28", or cites verse 39 and never names 28 at all.
 * What the three queries share is the passage they name, and the passage is
 * already stored: the parser turns each of them into the same canonical range,
 * and the reference index knows which notes cite which range.
 */

/** Chapter and verse as one number, so two passages compare with < and >. */
const position = (chapter: number, verse: number) => chapter * 1000 + verse;

/** The first and last verse a range covers. */
function bounds(range: VerseRange): [number, number] {
  return [
    position(range.chapter, range.verse),
    position(range.endChapter ?? range.chapter, range.endVerse ?? range.verse)
  ];
}

/**
 * The passage a query names, if the query is nothing but a passage.
 *
 * The whole query has to be the reference. "Romanos 8" asks for a passage;
 * "notas sobre Romanos 8" is someone searching their own words, and answering
 * that with a passage search would drop every note that phrases it differently.
 */
export function queryRange(query: string): VerseRange | undefined {
  const trimmed = query.trim();
  const [reference, ...rest] = parseReferences(trimmed);
  if (!reference || rest.length > 0) return undefined;

  const [start, end] = reference.indices;
  if (start !== 0 || end !== trimmed.length) return undefined;
  return reference;
}

/** The notes citing any verse of a passage, whichever way they wrote it. */
export async function notesCiting(range: VerseRange): Promise<Note[]> {
  const [from, to] = bounds(range);

  // ponytail: one pass over the references in the index, which is a few
  // hundred at most. A book-keyed index only pays off if that stops being true.
  // The pass itself touches no database: it narrows the references first, and
  // the notes behind all of them are read in a single query at the end.
  const matching = (await indexedRefs()).filter((ref) => {
    const cited = parseRef(ref);
    if (!cited || cited.book !== range.book) return false;

    // Overlap, not equality: a note that cites Romans 8:28-39 answers a search
    // for Romans 8:31 even though neither reference is the other.
    const [start, end] = bounds(cited);
    return start <= to && end >= from;
  });
  return notesForAll(matching);
}

/**
 * Passage search for a note list, or undefined when the query is not a
 * passage and the usual text search should answer it.
 */
export async function lookupScripture(
  query: string,
  notes: FilteredSelector<Note>,
  sortOptions?: SortOptions
): Promise<VirtualizedGrouping<Item> | undefined> {
  const range = queryRange(query);
  if (!range) return undefined;

  const ids = (await notesCiting(range)).map((note) => note.id);
  // `where` mutates the selector it is called on, so the caller's list is
  // cloned first — the same trap `notesWithHighlighting` documents.
  // An empty list still has to produce a query, so it matches an id no note
  // can have rather than an empty `in ()`, which is not valid SQL.
  const selector = notes
    .clone()
    .where((eb) => eb("notes.id", "in", ids.length > 0 ? ids : [""]));
  return sortOptions
    ? selector.sorted(sortOptions)
    : selector.sorted({ sortBy: "dateEdited", sortDirection: "desc" });
}
