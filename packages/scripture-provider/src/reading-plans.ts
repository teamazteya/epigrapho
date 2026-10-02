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

// Epigrapho (A3 Fase 3): reading plans. A reading is a compact USFM string of
// its own: "GEN.9" (a chapter), "GEN.9-10" (chapters) or "PSA.119.1-24"
// (verses of one chapter). Plans are not stored in notes, so this format never
// reaches one; readingRef() turns a reading into a note's reference.
import { MCHEYNE } from "./mcheyne-data.ts";
import { VRS_SOURCES } from "./versification-data.ts";

export type ReadingPlanId =
  | "mcheyne"
  | "chronological"
  | "nt90"
  | "psalms-proverbs";
export const READING_PLAN_IDS: ReadingPlanId[] = [
  "mcheyne",
  "chronological",
  "nt90",
  "psalms-proverbs"
];

/**
 * Chapter counts of the 66 books, from the canonical versification (eng.vrs).
 * Mapping lines ("JOL 3:1 = JOL 4:1") and the deuterocanon after Revelation
 * are not books' chapter lists.
 */
export function chapterCounts(vrs = VRS_SOURCES.eng) {
  const counts = new Map<string, number>();
  for (const line of vrs.split("\n")) {
    if (line.includes("=")) continue;
    const [book, ...chapters] = line.trim().split(/\s+/);
    if (/^[0-9A-Z]{3}$/.test(book) && chapters[0]?.includes(":"))
      counts.set(book, chapters.length);
    if (book === "REV") break;
  }
  return counts;
}

/** Consecutive chapters of one book become one reading. */
function group(chapters: [string, number][]) {
  const readings: string[] = [];
  let start = 0;
  for (let i = 1; i <= chapters.length; i++) {
    const [book, chapter] = chapters[i - 1];
    const next = chapters[i];
    if (next && next[0] === book && next[1] === chapter + 1) continue;
    const first = chapters[start][1];
    readings.push(
      first === chapter ? `${book}.${chapter}` : `${book}.${first}-${chapter}`
    );
    start = i;
  }
  return readings;
}

/**
 * The New Testament in 90 days: its 260 chapters in order, split as evenly as
 * whole chapters allow (two or three a day).
 */
function newTestament90() {
  const counts = [...chapterCounts()];
  const nt = counts.slice(counts.findIndex(([book]) => book === "MAT"));
  const chapters = nt.flatMap(([book, total]) =>
    Array.from({ length: total }, (_, i) => [book, i + 1] as [string, number])
  );
  return Array.from({ length: 90 }, (_, day) =>
    group(
      chapters.slice(
        Math.floor((day * chapters.length) / 90),
        Math.floor(((day + 1) * chapters.length) / 90)
      )
    )
  );
}

/**
 * Psalms and Proverbs in a month: on day d, Psalms d, d+30, d+60, d+90 and
 * d+120, and Proverbs d. The 31st day is Proverbs 31 alone.
 */
function psalmsProverbs() {
  return Array.from({ length: 31 }, (_, i) => {
    const day = i + 1;
    const psalms =
      day <= 30 ? [0, 30, 60, 90, 120].map((add) => `PSA.${day + add}`) : [];
    return [...psalms, `PRO.${day}`];
  });
}

/** Verses per chapter, "BOOK.C" → count, from eng.vrs. */
function verseCounts(vrs = VRS_SOURCES.eng) {
  const counts = new Map<string, number>();
  for (const line of vrs.split("\n")) {
    if (line.includes("=")) continue;
    const [book, ...chapters] = line.trim().split(/\s+/);
    if (!/^[0-9A-Z]{3}$/.test(book) || !chapters[0]?.includes(":")) continue;
    for (const each of chapters) {
      const [chapter, verses] = each.split(":");
      counts.set(`${book}.${chapter}`, Number(verses));
    }
    if (book === "REV") break;
  }
  return counts;
}

const psalms = (...numbers: number[]) => numbers.map((n) => `PSA.${n}`);

/** Psalms placed beside the events they belong to; the rest go by group. */
const PLACED_PSALMS = {
  moses: [90],
  saulPursues: [11, 59],
  inFlight: [34, 52, 54, 56, 57, 142],
  ark: [15, 24, 68, 96, 105, 106],
  wars: [60],
  bathsheba: [32, 51],
  absalom: [3, 4, 12, 13, 28, 55],
  absalomWar: [26, 40, 58, 61, 62, 64],
  return: [5, 38, 41],
  deliverance: [18],
  census: [30],
  solomon: [72],
  temple: [127],
  hezekiah: [46, 48, 76],
  exile: [74, 79, 137]
};
/** David's own, by their titles, that no event above claims. */
const DAVID = [
  1, 2, 6, 7, 8, 9, 10, 14, 16, 17, 19, 20, 21, 22, 23, 25, 27, 29, 31, 33, 35,
  36, 37, 39, 63, 65, 69, 70, 71, 86, 101, 103, 108, 109, 110, 122, 124, 131,
  133, 138, 139, 140, 141, 143, 144, 145
];
/** The sons of Korah, Asaph, Heman and Ethan: the temple's singers. */
const TEMPLE_SINGERS = [
  42, 43, 44, 45, 47, 49, 50, 73, 75, 77, 78, 80, 81, 82, 83, 84, 87, 88, 89
];

/**
 * Epigrapho's own chronological order (A3, 2026-10-02: no free plan exists,
 * and the person chose one of our own). Built on the common chronology: Job in
 * the patriarchs' time, the Psalms beside David's life, the prophets beside
 * the kings they spoke to, the Gospels in harmony by blocks, and the letters
 * inside Acts where they were written.
 */
function chronologicalOrder() {
  const placed = new Set([
    ...Object.values(PLACED_PSALMS).flat(),
    ...DAVID,
    ...TEMPLE_SINGERS
  ]);
  const returnPsalms = Array.from({ length: 150 }, (_, i) => i + 1).filter(
    (n) => !placed.has(n)
  );
  const P = PLACED_PSALMS;
  return [
    "GEN.1-11",
    "JOB.1-42",
    "GEN.12-50",
    "EXO.1-40",
    "LEV.1-27",
    "NUM.1-36",
    "DEU.1-34",
    ...psalms(...P.moses),
    "JOS.1-24",
    "JDG.1-21",
    "RUT.1-4",
    "1SA.1-17",
    "1SA.18-20",
    ...psalms(...P.saulPursues),
    "1SA.21-24",
    ...psalms(...P.inFlight),
    "1SA.25-31",
    "2SA.1-4",
    "1CH.1-10",
    "2SA.5-6",
    "1CH.11-16",
    ...psalms(...P.ark),
    "2SA.7",
    "1CH.17",
    "2SA.8-10",
    "1CH.18-19",
    ...psalms(...P.wars),
    "2SA.11-12",
    "1CH.20",
    ...psalms(...P.bathsheba),
    "2SA.13-15",
    ...psalms(...P.absalom),
    "2SA.16-18",
    ...psalms(...P.absalomWar),
    "2SA.19-21",
    ...psalms(...P.return),
    "2SA.22-23",
    ...psalms(...P.deliverance),
    "2SA.24",
    "1CH.21-22",
    ...psalms(...P.census),
    ...psalms(...DAVID),
    "1CH.23-29",
    "1KI.1-4",
    "2CH.1",
    ...psalms(...P.solomon),
    "SNG.1-8",
    "PRO.1-31",
    "1KI.5-11",
    "2CH.2-9",
    ...psalms(...P.temple),
    "ECC.1-12",
    ...psalms(...TEMPLE_SINGERS),
    "1KI.12-14",
    "2CH.10-12",
    "1KI.15-16",
    "2CH.13-16",
    "1KI.17-22",
    "2CH.17-20",
    "2KI.1-8",
    "2CH.21-22",
    "OBA.1",
    "2KI.9-11",
    "2CH.23-24",
    "JOL.1-3",
    "2KI.12-14",
    "2CH.25",
    "JON.1-4",
    "AMO.1-9",
    "2KI.15",
    "2CH.26-27",
    "HOS.1-14",
    "ISA.1-12",
    "MIC.1-7",
    "2KI.16-17",
    "2CH.28",
    "2KI.18-20",
    "2CH.29-32",
    "ISA.13-39",
    ...psalms(...P.hezekiah),
    "ISA.40-66",
    "2KI.21",
    "2CH.33",
    "NAM.1-3",
    "2KI.22-23",
    "2CH.34-35",
    "ZEP.1-3",
    "JER.1-12",
    "HAB.1-3",
    "JER.13-29",
    "2KI.24",
    "JER.30-39",
    "EZK.1-24",
    "2KI.25",
    "2CH.36",
    "JER.40-52",
    "LAM.1-5",
    ...psalms(...P.exile),
    "EZK.25-48",
    "DAN.1-12",
    "EZR.1-6",
    "HAG.1-2",
    "ZEC.1-14",
    ...psalms(...returnPsalms),
    "EST.1-10",
    "EZR.7-10",
    "NEH.1-13",
    "MAL.1-4",
    "LUK.1-2",
    "MAT.1-2",
    "JHN.1",
    "MAT.3-4",
    "MRK.1",
    "LUK.3-4",
    "JHN.2-4",
    "MAT.5-7",
    "LUK.5-6",
    "MRK.2-3",
    "JHN.5",
    "MAT.8-13",
    "MRK.4-5",
    "LUK.7-8",
    "MAT.14-18",
    "MRK.6-9",
    "LUK.9",
    "JHN.6-10",
    "LUK.10-19",
    "JHN.11-12",
    "MAT.19-25",
    "MRK.10-13",
    "LUK.20-21",
    "MAT.26-28",
    "MRK.14-16",
    "LUK.22-24",
    "JHN.13-21",
    "ACT.1-12",
    "JAS.1-5",
    "ACT.13-14",
    "GAL.1-6",
    "ACT.15-17",
    "1TH.1-5",
    "2TH.1-3",
    "ACT.18-19",
    "1CO.1-16",
    "2CO.1-13",
    "ROM.1-16",
    "ACT.20-28",
    "EPH.1-6",
    "PHP.1-4",
    "COL.1-4",
    "PHM.1",
    "1TI.1-6",
    "TIT.1-3",
    "1PE.1-5",
    "2TI.1-4",
    "2PE.1-3",
    "HEB.1-13",
    "JUD.1",
    "1JN.1-5",
    "2JN.1",
    "3JN.1",
    "REV.1-22"
  ];
}

/**
 * Splits passages in order into `days` days of about the same number of
 * verses, never splitting a chapter.
 */
function spread(passages: string[], days: number) {
  const verses = verseCounts();
  const chapters: [string, number][] = passages.flatMap((passage) => {
    const [book, range] = [passage.slice(0, 3), passage.slice(4)];
    const [first, last = first] = range.split("-").map(Number);
    return Array.from(
      { length: last - first + 1 },
      (_, i) => [book, first + i] as [string, number]
    );
  });
  const total = chapters.reduce(
    (sum, [book, c]) => sum + (verses.get(`${book}.${c}`) ?? 0),
    0
  );
  const plan: [string, number][][] = Array.from({ length: days }, () => []);
  let read = 0;
  for (const chapter of chapters) {
    const size = verses.get(`${chapter[0]}.${chapter[1]}`) ?? 0;
    // The day whose share the middle of this chapter falls in.
    const day = Math.min(
      days - 1,
      Math.floor(((read + size / 2) / total) * days)
    );
    plan[day].push(chapter);
    read += size;
  }
  return plan.map(group);
}

const cache = new Map<ReadingPlanId, string[][]>();

/** Every day of a plan, each day a list of readings. */
export function readingPlanDays(id: ReadingPlanId): string[][] {
  let days = cache.get(id);
  if (!days) {
    days =
      id === "mcheyne"
        ? MCHEYNE
        : id === "chronological"
        ? spread(chronologicalOrder(), 365)
        : id === "nt90"
        ? newTestament90()
        : psalmsProverbs();
    cache.set(id, days);
  }
  return days;
}

const VERSES = /^([0-9A-Z]{3})\.(\d+)\.(\d+)-(\d+)$/;
const CHAPTERS = /^([0-9A-Z]{3})\.(\d+)(?:-(\d+))?$/;

/**
 * A reading as the reference a note stores: "GEN.9-10" becomes
 * "GEN.9.1-GEN.10.32", whole chapters from their first verse to their last.
 */
export function readingRef(reading: string): string {
  const verses = VERSES.exec(reading);
  if (verses) {
    const [, book, chapter, from, to] = verses;
    return `${book}.${chapter}.${from}-${book}.${chapter}.${to}`;
  }
  const chapters = CHAPTERS.exec(reading);
  if (!chapters) return reading;
  const [, book, first, last = first] = chapters;
  const line = VRS_SOURCES.eng
    .split("\n")
    .find((each) => each.startsWith(`${book} `) && !each.includes("="));
  const lastVerse = line
    ?.trim()
    .split(/\s+/)
    .slice(1)
    .find((each) => each.startsWith(`${last}:`))
    ?.split(":")[1];
  return `${book}.${first}.1-${book}.${last}.${lastVerse ?? 1}`;
}
