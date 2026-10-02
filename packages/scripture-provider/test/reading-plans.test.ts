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

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chapterCounts,
  readingPlanDays,
  readingRef
} from "../src/reading-plans.ts";
import { chaptersOf } from "../scripts/build-reading-plans.ts";

/** How many times each chapter is read over the whole plan. */
function tally(days: string[][]) {
  const read = new Map<string, number>();
  for (const day of days)
    for (const chapter of new Set(day.flatMap(chaptersOf)))
      read.set(chapter, (read.get(chapter) ?? 0) + 1);
  return read;
}

test("the 66 books, without the deuterocanon or mapping lines", () => {
  const counts = chapterCounts();
  assert.equal(counts.size, 66);
  assert.equal(counts.get("JOL"), 3);
  assert.equal(counts.get("PSA"), 150);
});

test("M'Cheyne: 365 days of four readings", () => {
  const days = readingPlanDays("mcheyne");
  assert.equal(days.length, 365);
  assert.deepEqual(days[0], ["GEN.1", "MAT.1", "EZR.1", "ACT.1"]);
  const read = tally(days);
  assert.ok((read.get("GEN.50") ?? 0) >= 1);
  assert.ok((read.get("PSA.23") ?? 0) >= 2);
  assert.ok((read.get("REV.22") ?? 0) >= 2);
});

test("New Testament in 90 days: each of its 260 chapters once", () => {
  const days = readingPlanDays("nt90");
  assert.equal(days.length, 90);
  const read = tally(days);
  assert.equal(read.size, 260);
  assert.ok([...read.values()].every((times) => times === 1));
  assert.ok(days.every((day) => day.flatMap(chaptersOf).length >= 2));
});

test("Psalms and Proverbs in a month: every psalm and proverb once", () => {
  const days = readingPlanDays("psalms-proverbs");
  assert.equal(days.length, 31);
  const read = tally(days);
  assert.equal(read.size, 150 + 31);
  assert.ok([...read.values()].every((times) => times === 1));
});

test("a reading becomes the reference a note stores", () => {
  assert.equal(readingRef("GEN.9-10"), "GEN.9.1-GEN.10.32");
  assert.equal(readingRef("PSA.119.1-24"), "PSA.119.1-PSA.119.24");
  assert.equal(readingRef("JUD.1"), "JUD.1.1-JUD.1.25");
});

test("chronological: every chapter of the Bible once, in 365 days", () => {
  const days = readingPlanDays("chronological");
  assert.equal(days.length, 365);
  assert.ok(days.every((day) => day.length > 0));
  const read = tally(days);
  assert.equal(read.size, 1189);
  assert.ok([...read.values()].every((times) => times === 1));
  assert.equal(days[0][0], "GEN.1-3");
  assert.ok(days[364].at(-1)!.startsWith("REV."));
});
