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

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { OSIS_TO_USFM } from "@notesnook/scripture-parser";
import type { CrossReferencePack } from "../src/pack.ts";
import { CACHE } from "./sources.ts";

/** "Rom.5.8" to "ROM.5.8"; undefined for a book Epigrapho does not know. */
function usfm(osis: string) {
  const [book, ...rest] = osis.split(".");
  const code = OSIS_TO_USFM[book];
  return code && rest.length === 2 ? [code, ...rest].join(".") : undefined;
}

/**
 * OpenBible.info's cross references (CC BY, A3 Paso 2.1), one pack per book:
 * for each "chapter.verse", its references most voted first. They already use
 * the English versification, which is the canonical one (ADR-0004). A
 * reference people voted down is not one.
 */
export function buildCrossReferences() {
  const text = gunzipSync(
    readFileSync(CACHE + "openbible-cross-references.txt.gz")
  ).toString("utf8");
  const voted = new Map<string, [string, number][]>();
  for (const line of text.split("\n").slice(1)) {
    const [from, to, votes] = line.trim().split("\t");
    if (!to || !(Number(votes) > 0)) continue;
    const source = usfm(from);
    const ends = to.split("-").map(usfm);
    if (!source || ends.some((end) => !end)) continue;
    const target = ends[0] === ends[1] ? ends[0]! : ends.join("-");
    let list = voted.get(source);
    if (!list) voted.set(source, (list = []));
    list.push([target, Number(votes)]);
  }

  const books = new Map<string, CrossReferencePack>();
  for (const [verse, list] of voted) {
    const [book, chapter, number] = verse.split(".");
    let pack = books.get(book);
    if (!pack) books.set(book, (pack = {}));
    pack[`${chapter}.${number}`] = list
      .sort((a, b) => b[1] - a[1])
      .map(([target]) => target);
  }
  return books;
}
