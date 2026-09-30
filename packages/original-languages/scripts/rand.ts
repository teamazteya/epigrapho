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
import { fileURLToPath } from "node:url";
import type { DictionaryPack } from "../src/pack.ts";
import { readSource } from "./sources.ts";

/**
 * Rand, Diccionario de la Santa Biblia (1890), from the OCR archive.org made
 * of the Library of Congress copy (A2 Paso 7.2). The scan is laid out in two
 * columns, which the OCR already reads one after the other; what is left is
 * page furniture, words broken across lines, and the entries themselves.
 */

// Page furniture: page numbers, the running title, and the three-letter
// catchwords at the head of each column ("ZUR", or "zuz" when misread).
const FURNITURE = [
  /^\d{1,3}$/,
  // The running title, sometimes read on one line with the catchwords
  // ("ahí DICCIONARIO DE LA BIBLIA. air").
  /DICCIONARIO DE LA (SANTA )?BIBLIA/,
  /^[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,4}$/,
  // Specks the scanner read as characters.
  /^[^\p{L}\d]{1,3}$/u,
  // Captions of the engravings ("TUMBA DE ABSALÓM.") and the letter heads
  // ("B."): all capitals. Every line of an entry has lower-case letters, and
  // a caption left in would cut the entry it is printed inside in two.
  /^(?=.*\p{L}.*\p{L})[^\p{Ll}]+$/u
];

// An entry opens a paragraph with its headword in capitals, followed by a
// comma, a full stop, a bracket, or "ó"/"o" and another capitalised form:
// "AARON, maestro…", "ZUR o SUR, roca…", "ZORRAS. Este…".
const HEADWORD =
  /^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'\- ]*?)(?=\s*[,.(]|\s+(?:ó|o|y)\s+[A-ZÁÉÍÓÚÑÜ]{2})/;
const ROMAN = /^[IVXL]+$/;

/** 1890 spelling that reads as a mistake today: the accent on monosyllables. */
// A whole word: JavaScript's \b takes "ó" for a non-letter, so it cannot
// tell where "dió" ends.
const word = (pattern: string) =>
  new RegExp(`(?<!\\p{L})${pattern}(?!\\p{L})`, "gu");

export function modernize(text: string) {
  return text
    .replace(word("á"), "a")
    .replace(word("Á"), "A")
    .replace(word("Ó"), "O")
    .replace(word("é"), "e")
    .replace(word("ó"), "o")
    .replace(word("ú"), "u")
    .replace(word("([Ff])ué"), "$1ue")
    .replace(word("([Ff])uí"), "$1ui")
    .replace(word("([DdVv])ió"), "$1io")
    .replace(word("([Pp])ié(s?)"), "$1ie$2");
}

/** "ZUR o SUR" → "Zur o Sur". Capitals in 1890 carry no accents. */
const titleCase = (headword: string) =>
  headword
    .toLowerCase()
    .split(" ")
    .map((word, index) =>
      index > 0 && /^(o|ó|y|de|del|la|las|los|el|en|con)$/.test(word)
        ? word.replace("ó", "o")
        : word.replace(/(^|-)(\p{L})/gu, (_, dash, letter) => dash + letter.toUpperCase())
    )
    .join(" ");

const slug = (term: string) =>
  term
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The OCR text as paragraphs of one line each, without page furniture. */
function paragraphs(text: string) {
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim());
  const start = lines.findIndex((line) => line.startsWith("A, la primera letra"));
  const end = lines.findIndex((line, index) => index > start && line === "APÉNDICE.");
  const out: string[] = [];
  let current = "";
  let blank = false;
  for (const line of lines.slice(start, end)) {
    if (!line) {
      blank = true;
      continue;
    }
    if (FURNITURE.some((pattern) => pattern.test(line))) continue;
    const opens =
      blank &&
      HEADWORD.test(line) &&
      !ROMAN.test(HEADWORD.exec(line)![1].trim());
    // A blank line inside an entry is a new paragraph ("II. Nombre de…")
    // when the text before it ended a sentence; otherwise it is a page or
    // column break in the middle of one.
    const newParagraph =
      blank && /[.;:]$/.test(current) && /^[\p{Lu}\d“"]/u.test(line);
    blank = false;
    if (opens && current) {
      out.push(current);
      current = "";
    }
    if (!current) current = line;
    // "seme¬ jantes": the printer's mark for a word broken at the line end.
    else if (current.endsWith("¬")) current = current.slice(0, -1) + line;
    // The OCR sometimes reads that mark as a hyphen; a hyphen before a
    // lower-case continuation is the same break.
    else if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(line))
      current = current.slice(0, -1) + line;
    else current += (newParagraph ? "\n\n" : " ") + line;
  }
  if (current) out.push(current);
  return out;
}

/** The OCR's entries as single strings, before any correction. */
export const paragraphsOfRand = () =>
  paragraphs(readSource("rand-1890_djvu.txt"));

/**
 * The OCR misreadings to correct, from data/rand-ocr-fixes.tsv (written and
 * reviewed with scripts/rand-ocr-fixes.ts): lower-case "wrong\tright".
 */
function ocrFixes() {
  const table = new Map<string, string>();
  const file = fileURLToPath(new URL("../data/rand-ocr-fixes.tsv", import.meta.url));
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const [wrong, right] = line.split("\t");
    if (wrong && right) table.set(wrong, right);
  }
  return table;
}

/** Corrects the misread words, keeping each one's capitals. */
export function correctOcr(text: string, fixes: Map<string, string>) {
  return (
    text
      .replace(/\p{L}+/gu, (word) => {
        const right = fixes.get(word.toLowerCase());
        if (!right) return word;
        if (word === word.toUpperCase()) return right.toUpperCase();
        if (word[0] === word[0].toUpperCase())
          return right[0].toUpperCase() + right.slice(1);
        return right;
      })
      // "gobernante 6 consejero": the "ó" read as a six. A six between two
      // words stays a number when a count follows it ("6 millas", "de 6 a").
      .replace(
        /(?<=\p{L},? )6(?= (?!a\b)\p{Ll}+\b(?<!s))/gu,
        "o"
      )
      .replace(/(?<=\p{Lu}{2},? )6(?= \p{Lu}{2})/gu, "o")
  );
}

/** Rand's entries, cleaned, as a dictionary pack. */
export function buildRand(): DictionaryPack {
  const pack: DictionaryPack = {};
  const fixes = ocrFixes();
  for (const raw of paragraphsOfRand()) {
    const paragraph = correctOcr(raw, fixes);
    const headword = HEADWORD.exec(paragraph)![1].trim();
    // A letter heading ("B.") is not an entry.
    if (paragraph.length <= headword.length + 2) continue;
    const body = modernize(
      paragraph
        .replace(/ +([,.;:])/g, "$1")
        .replace(/([“(]) /g, "$1")
        .replace(/ ([”)])/g, "$1")
    );
    const term = titleCase(modernize(headword));
    let id = `RAND:${slug(term)}`;
    // The same headword twice (two people called Zur) keeps both.
    for (let n = 2; pack[id]; n++) id = `RAND:${slug(term)}-${n}`;
    pack[id] = [term, "RAND", body];
  }
  return pack;
}
