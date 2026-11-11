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

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatRef, parseReferences } from "@notesnook/scripture-parser";
import { BOOKS, type DictionaryPack } from "../src/pack.ts";
import { buildDictionaryEn } from "./import.ts";
import { CACHE } from "./sources.ts";

/**
 * Easton in Spanish (A6 Fase 5): a machine translation of each Easton entry,
 * kept as source data in data/easton-es.json ("EAS:<id>" → [term, body]) so
 * the import never translates again. The rules each translation follows:
 */
export const RULES = `Traduce al español esta entrada del Easton's Bible Dictionary (1897).
- Nombres propios de la Biblia en su forma moderna, la de la Reina-Valera 1960 (Hezekiah → Ezequías, Accho → Aco). Si la RV1909 lo escribe distinto, su forma va entre paréntesis en el título y la primera vez que el nombre sale en el texto: «Ezequías (Ezechîas)»; después, solo la moderna.
- Citas con estas abreviaturas: Gn Éx Lv Nm Dt Jos Jue Rt 1 S 2 S 1 R 2 R 1 Cr 2 Cr Esd Neh Est Job Sal Pr Ec Cnt Is Jer Lm Ez Dn Os Jl Am Abd Jon Mi Nah Hab Sof Hag Zac Mal Mt Mr Lc Jn Hch Ro 1 Co 2 Co Gá Ef Fil Col 1 Ts 2 Ts 1 Ti 2 Ti Tit Flm He Stg 1 P 2 P 1 Jn 2 Jn 3 Jn Jud Ap. Capítulo y versículo con dos puntos: «Gn 28:19».
- Sin citas de libros apócrifos (1 Macc., Ecclus., Tobit…): se quita la cita, no el texto que la rodea.
- Fuera de eso, sin añadir ni quitar contenido: ni notas, ni explicaciones, ni correcciones de Easton. Se conservan los párrafos, la numeración «(1.)» y los «(See X.)» como «(Véase X.)».
- Las palabras hebreas o griegas transliteradas quedan como están.
- Fechas «B.C. 762» como «762 a. C.»; comillas «»; miles con punto («2.000»).
- El título se traduce como el nombre propio o la palabra española de la entrada.`;

export const DATA = new URL("../data/easton-es.json", import.meta.url);

export type EastonEs = Record<string, [term: string, body: string]>;

export const readEastonEs = (): EastonEs =>
  existsSync(DATA) ? JSON.parse(readFileSync(DATA, "utf8")) : {};

/** The translated entries, as "EASES:<id>". */
export function buildEastonEs(): DictionaryPack {
  const pack: DictionaryPack = {};
  for (const [id, [term, body]] of Object.entries(readEastonEs()))
    pack[`EASES:${id.slice(4)}`] = [term, "EASES", body];
  return pack;
}

const references = (text: string, locale: "es" | "en") =>
  parseReferences(text, [locale]).map(formatRef).sort().join(" ");

// Easton's book names the parser does not read («Cant. 8:11», «Judge. 3:3»).
const readableEaston = (text: string) =>
  text.replace(/\bCant\./g, "Song").replace(/\bJudge\./g, "Judg.");

/**
 * Citations of apocryphal books («1 Mac 1:57», «Eclo 3:4»): the Spanish
 * entries leave them out, though Easton cites them.
 */
export const APOCRYPHA = /\b(?:[12] ?Mac|Eclo|Sab|Tob|Jdt|Bar|Sir)\.? ?\d+[:.]\d+/;

/**
 * Entries whose citations differ only because the parser reads one of the
 * two texts wrong; each translation was checked by hand against Easton.
 */
export const KNOWN_MISMATCHES: Record<string, string> = {
  "EAS:beth-haccerem": "«40 feet» se lee como Is 40",
  "EAS:ezion-geber": "«is 10 miles» se lee como Is 10",
  "EAS:galilee-sea-of": "«is 12 1/2 miles», «is 27 miles» se leen como Isaías",
  "EAS:christ": "el parser inglés no lee «Isaiah (61:1)»",
  "EAS:benjamin": "el parser inglés no lee «Jeremiah (20:2)»",
  "EAS:carve": "el parser inglés no lee «Isaiah (44:13-17)»",
  "EAS:cave": "el parser inglés no lee «Joshua (10:16, 27)»",
  "EAS:gold": "el parser inglés no lee «Isaiah (14:4)»",
  "EAS:hebrew-language": "el parser inglés no lee «Isaiah (19:18)»",
  "EAS:jaaz-aniah": "el parser inglés no lee «Ezekiel (11:1)»",
  "EAS:kidron": "«is 2 3/4 miles» se lee como Is 2:3-4",
  "EAS:lamentations-book-of": "el parser inglés no lee «Psalms (25, 34, 37, 119)»",
  "EAS:magog": "el parser inglés no lee «Ezekiel (38:2; 39:6)»",
  "EAS:merom": "«is 7 feet» se lee como Is 7",
  "EAS:ophel": "«is 4 feet» se lee como Is 4",
  "EAS:peter-second-epistle-of":
    "el parser inglés lee «1 Thess. 4:13-5:11» como dos versículos sueltos",
  "EAS:philip":"el parser español no lee «Isaías (53:6, 7)»",
  "EAS:pools-of-solomon": "«220 in breadth, and 20 to 30» se lee como Is 20",
  "EAS:pottery": "el parser español no lee «Jeremías (18:3)»",
  "EAS:prayer": "el parser español no lee «Jeremías (42:2-10)»",
  "EAS:samuel-books-of": "el parser español no lee «Samuel (5-12)»",
  "EAS:seir": "el parser inglés no lee la errata «Exek. 25:8»",
  "EAS:seraiah": "el parser inglés no lee «Ezra the scribe (7:1)»",
  "EAS:stater": "«2s. 6d.» (chelines) se lee como 2 S 6",
  "EAS:temple-solomon-s": "«is 3 feet» se lee como Is 3",
  "EAS:siloam-pool-of":
    "«53 feet» se lee como Is 53; el parser inglés no lee «Isaiah (8:6)»",
  "EAS:refuge-cities-of":"«(Num. 35). 1. On the west» se lee como Nm 1",
  "EAS:resurrection-of-christ":
    "el parser inglés no lee «John (20:11-18)», «Matthew (28:1-10)», «John (21:1-23)»",
  "EAS:psalms":"el parser español no lee «salmos siguientes (42-72)»; el inglés lee «18 of which» como Sal 18",
  "EAS:job-book-of": "«lamentation (ch. 3)» se lee como Lm 3",
  "EAS:joel-book-of": "«texto hebreo 4» se lee como He 4"
};

/**
 * The entries whose translation does not cite the same verses as Easton: a
 * book read wrong, a citation lost or one added; or that cite the Apocrypha.
 */
export function referenceMismatches(
  english: DictionaryPack,
  translated: EastonEs
) {
  return Object.entries(translated).flatMap(([id, [, body]]) => {
    const want = references(readableEaston(english[id][2]), "en");
    const apocrypha = APOCRYPHA.test(body);
    const got = references(body, "es") + (apocrypha ? " apócrifos" : "");
    // The allowlist forgives the parser, never an apocryphal citation.
    if (want === got || (KNOWN_MISMATCHES[id] && !apocrypha)) return [];
    return [{ id, want, got }];
  });
}

/** The RV1909 text of each verse an Easton entry cites, to check its names. */
function rv1909(english: DictionaryPack, ids: string[]) {
  const wanted = new Map<string, string>();
  for (const id of ids)
    for (const reference of parseReferences(english[id]?.[2] ?? "", ["en"])) {
      const book = String(BOOKS.indexOf(reference.book) + 1).padStart(2, "0");
      const verse = `${book}${String(reference.chapter).padStart(
        3,
        "0"
      )}${String(reference.verse).padStart(3, "0")}`;
      wanted.set(verse, `${id} ${formatRef(reference).split("-")[0]}`);
    }
  const text = new Map<string, string>();
  for (const file of ["ot_RV09.tsv", "nt_RV09.tsv"])
    for (const line of readFileSync(CACHE + file, "utf8").split("\n")) {
      const [token, , word, joined] = line.split("\t");
      const verse = token?.slice(0, 8);
      if (wanted.has(verse))
        text.set(verse, (text.get(verse) ?? "") + word + (joined ? "" : " "));
    }
  for (const [verse, label] of wanted)
    console.log(`${label}: ${text.get(verse)?.trim()}`);
}

const readBatch = (file: string): EastonEs =>
  JSON.parse(readFileSync(file, "utf8"));

// `sample`: the 30 entries a person read before Easton in Spanish shipped
// (A6 Paso 5.3), in docs/easton-es-muestra-30.md beside the original.
// `batches <dir> [chars]`: the entries not yet translated, in files of about
// `chars` characters, for translating in parallel.
// `check <file>…`: the entries of a translated batch that cite other verses.
// `merge <dir>`: the translated batches, into data/easton-es.json.
// `verses <EAS:id>…`: the RV1909 text of the verses each entry cites.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command = "sample", ...args] = process.argv.slice(2);
  const english = buildDictionaryEn();
  const ids = Object.keys(english).filter((id) => id.startsWith("EAS:"));
  const translated = readEastonEs();
  const report = (batch: EastonEs) => {
    const mismatches = referenceMismatches(english, batch);
    for (const { id, want, got } of mismatches)
      console.error(`${id}\n  en: ${want}\n  es: ${got}`);
    return mismatches;
  };

  if (command === "verses") rv1909(english, args);
  else if (command === "check") {
    const batch: EastonEs = Object.assign({}, ...args.map(readBatch));
    const foreign = Object.keys(batch).filter(
      (id) => !id.startsWith("EAS:") || !english[id]
    );
    if (foreign.length) console.error(`no son de Easton: ${foreign.join(" ")}`);
    const mismatches = report(batch);
    console.log(
      `${Object.keys(batch).length} entradas, ${
        mismatches.length
      } con otras citas`
    );
    if (foreign.length || mismatches.length) process.exit(1);
  } else if (command === "batches") {
    const [dir, chars = "45000"] = args;
    let batch: EastonEs = {};
    let size = 0;
    let n = 0;
    const flush = () => {
      if (!size) return;
      writeFileSync(
        path.join(dir, `${String(++n).padStart(2, "0")}.json`),
        JSON.stringify(batch, null, 1)
      );
      batch = {};
      size = 0;
    };
    for (const id of ids.filter((id) => !translated[id])) {
      batch[id] = [english[id][0], english[id][2]];
      size += english[id][2].length;
      if (size >= Number(chars)) flush();
    }
    flush();
    console.log(`${n} lotes en ${dir}`);
  } else if (command === "merge") {
    const [dir] = args;
    const batch: EastonEs = Object.assign(
      {},
      ...readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => readBatch(path.join(dir, file)))
    );
    for (const [id, entry] of Object.entries(batch))
      if (
        !english[id] ||
        !id.startsWith("EAS:") ||
        entry.length !== 2 ||
        !entry.every((part) => typeof part === "string" && part)
      )
        throw new Error(`${id}: no es una entrada de Easton traducida`);
    const all = { ...translated, ...batch };
    const sorted = Object.fromEntries(
      Object.keys(all)
        .sort()
        .map((id) => [id, all[id]])
    );
    writeFileSync(DATA, JSON.stringify(sorted, null, 2) + "\n");
    const missing = ids.filter((id) => !sorted[id]);
    console.log(
      `${Object.keys(batch).length} nuevas; ${Object.keys(sorted).length} de ${
        ids.length
      }; faltan: ${missing.join(" ")}`
    );
    report(sorted);
  } else if (command === "sample") {
    // mulberry32, seed 1897: the same 30 every time.
    let seed = 1897;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const picked = new Set<string>();
    while (picked.size < 30) picked.add(ids[Math.floor(random() * ids.length)]);
    const sample = [...picked].sort();
    const missing = sample.filter((id) => !translated[id]);
    if (missing.length) {
      console.log(
        JSON.stringify(
          Object.fromEntries(
            missing.map((id) => [id, [english[id][0], english[id][2]]])
          ),
          null,
          1
        )
      );
      process.exit(1);
    }
    const mismatches = report(
      Object.fromEntries(sample.map((id) => [id, translated[id]]))
    );
    const lines = [
      "# Easton en español — muestra de 30 entradas para revisión (A6 Paso 5.3)",
      "",
      `Traducción automática (IA) de ${sample.length} entradas al azar de las ${ids.length} de Easton (1897), semilla 1897, en orden alfabético. Reglas: nombres propios en su forma moderna (RV1960), con la de la RV1909 entre paréntesis cuando es distinta; citas con abreviaturas españolas; sin añadir ni quitar contenido. En la app cada entrada dice «Easton (1897), traducción automática al español».`,
      "",
      "Aprobada el 2026-11-04, con los nombres en forma moderna y la de 1909 entre paréntesis.",
      "",
      `Citas comprobadas con el parser de la app: ${
        mismatches.length
          ? `${
              mismatches.length
            } entradas no citan lo mismo que el original: ${mismatches
              .map(({ id }) => id)
              .join(", ")}`
          : "las 30 citan los mismos versículos que el original"
      }.`,
      ""
    ];
    sample.forEach((id, n) => {
      const [term, , body] = english[id];
      const [termEs, bodyEs] = translated[id];
      lines.push(
        `## ${n + 1}. ${termEs}  \`EASES:${id.slice(4)}\``,
        "",
        bodyEs,
        "",
        `> **Original — ${term}:** ${body.replace(/\n+/g, " ")}`,
        ""
      );
    });
    writeFileSync(
      new URL("../../../../docs/easton-es-muestra-30.md", import.meta.url),
      lines.join("\n")
    );
    console.log(sample.join(" "));
  } else throw new Error(`orden desconocida: ${command}`);
}
