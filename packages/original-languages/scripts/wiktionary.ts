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

import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import {
  WIKTIONARY_FORMAT,
  type DictionaryPack,
  type WiktionaryIndexPack
} from "../src/pack.ts";
import { foldTerm, wiktionaryGroup } from "../src/search.ts";
import { fetchWiktionary, WIKTIONARY } from "./sources.ts";

/**
 * The Spanish Wiktionary for the dictionary (A6 Fase 4): every Spanish lemma
 * with its parts of speech, senses, examples, etymology, synonyms and
 * antonyms, as plain text; each inflected form only as a pointer to its
 * lemma ("amó" → "amar"). Translations, pronunciation and audio stay out.
 */

type Example = { text?: string; ref?: string };
type Sense = {
  glosses?: string[];
  categories?: string[];
  examples?: Example[];
  form_of?: { word: string }[];
};
type Word = { word: string };
type Entry = {
  word: string;
  lang_code: string;
  pos_title?: string;
  senses: Sense[];
  categories?: string[];
  etymology_texts?: string[];
  synonyms?: Word[];
  antonyms?: Word[];
  forms?: { form: string }[];
};

// Wiktionary has no category for the Bible as such (measured 2026-11-04:
// "Palabras de origen bíblico" holds three words, and "Cristianismo" and
// "Judaísmo" are mostly liturgy and later history: Lutero, Navidad). A lemma
// counts as biblical when a sense names the Bible or one of its parts
// ("Melquisedec: … mencionado en el capítulo 14 del libro de Génesis"), or
// it is in that category.
const BIBLICAL_CATEGORY = "ES:Palabras de origen bíblico";
const BIBLICAL_TEXT =
  /(?<!\p{L})(Biblia|bíblic[oa]s?|Antiguo Testamento|Nuevo Testamento|Evangelios?|Génesis|Éxodo|Levítico|Deuteronomio|Apocalipsis|Pentateuco)(?!\p{L})/u;

/** "ES:Términos anticuados" → "anticuados": how a sense is used. */
const usage = (sense: Sense) =>
  (sense.categories ?? [])
    .filter((category) => category.startsWith("ES:Términos "))
    .map((category) => category.slice("ES:Términos ".length));

const unique = (words: Word[] | undefined) => [
  ...new Set((words ?? []).map(({ word }) => word))
];

/** One part of speech of a lemma, as text. */
function render(entry: Entry) {
  const lines: string[] = [entry.pos_title ?? ""];
  entry.senses.forEach((sense, n) => {
    const labels = usage(sense);
    const gloss = (sense.glosses ?? []).join(" ");
    if (!gloss) return;
    lines.push(
      `${n + 1}. ${labels.length ? `(${labels.join(", ")}) ` : ""}${gloss}`
    );
    for (const { text, ref } of sense.examples ?? [])
      if (text) lines.push(`   «${text}»${ref ? ` (${ref})` : ""}`);
  });
  if (entry.etymology_texts?.length)
    lines.push(`Etimología: ${entry.etymology_texts.join(" ")}`);
  const synonyms = unique(entry.synonyms);
  if (synonyms.length) lines.push(`Sinónimos: ${synonyms.join(", ")}`);
  const antonyms = unique(entry.antonyms);
  if (antonyms.length) lines.push(`Antónimos: ${antonyms.join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

export type Wiktionary = {
  index: WiktionaryIndexPack;
  /** Group → id → entry, as the files wikt-<group>.json. */
  articles: Map<string, DictionaryPack>;
  /** Group → folded form → lemmas, as the files wikt-forms-<group>.json. */
  forms: Map<string, Record<string, string[]>>;
};

export async function buildWiktionary(fresh = false): Promise<Wiktionary> {
  const { date, sha256 } = await fetchWiktionary(fresh);
  const bodies = new Map<string, string[]>();
  const biblical = new Set<string>();
  const pointers = new Map<string, Set<string>>();
  const point = (form: string, lemma: string) => {
    // Pages for phrases ("haber amado") are not words one looks up.
    if (/\s/.test(form) || form === lemma) return;
    const key = foldTerm(form);
    if (!key) return;
    let lemmas = pointers.get(key);
    if (!lemmas) pointers.set(key, (lemmas = new Set()));
    lemmas.add(lemma);
  };

  const lines = createInterface({
    input: createReadStream(WIKTIONARY.file).pipe(createGunzip()),
    crlfDelay: Infinity
  });
  for await (const line of lines) {
    const entry = JSON.parse(line) as Entry;
    if (entry.lang_code !== "es") continue;
    entry.word = entry.word.normalize("NFC");
    const own = entry.senses.filter((sense) => !sense.form_of);
    // A page only for an inflected form points to its lemma.
    if (!own.length) {
      for (const sense of entry.senses)
        for (const { word } of sense.form_of ?? [])
          point(entry.word, word.normalize("NFC"));
      continue;
    }
    const text = render({ ...entry, senses: own });
    if (!text.includes("\n")) continue;
    let parts = bodies.get(entry.word);
    if (!parts) bodies.set(entry.word, (parts = []));
    parts.push(text);
    for (const { form } of entry.forms ?? [])
      point(form.normalize("NFC"), entry.word);
    if (
      [
        ...(entry.categories ?? []),
        ...own.flatMap((s) => s.categories ?? [])
      ].includes(BIBLICAL_CATEGORY) ||
      own.some((sense) => BIBLICAL_TEXT.test((sense.glosses ?? []).join(" ")))
    )
      biblical.add(entry.word);
  }

  // In the order of their folded keys, which search looks up by halves.
  const keyed = [...bodies.keys()]
    .map((lemma) => [foldTerm(lemma), lemma])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1));
  const lemmas = keyed.map(([, lemma]) => lemma);
  const articles = new Map<string, DictionaryPack>();
  for (const lemma of lemmas) {
    const group = wiktionaryGroup(lemma);
    let pack = articles.get(group);
    if (!pack) articles.set(group, (pack = {}));
    pack[`WIKT:${lemma}`] = [lemma, "WIKT", bodies.get(lemma)!.join("\n\n")];
  }
  const forms = new Map<string, Record<string, string[]>>();
  for (const [key, targets] of [...pointers].sort(([a], [b]) =>
    a < b ? -1 : 1
  )) {
    // Only forms that lead somewhere, and not a lemma to itself.
    const found = [...targets].filter((lemma) => bodies.has(lemma));
    if (!found.length || found.every((lemma) => foldTerm(lemma) === key))
      continue;
    const group = wiktionaryGroup(key);
    let pack = forms.get(group);
    if (!pack) forms.set(group, (pack = {}));
    pack[key] = found;
  }
  return {
    index: {
      date,
      sha256,
      keys: keyed.map(([key]) => key),
      lemmas,
      biblical: lemmas.filter((lemma) => biblical.has(lemma)),
      forms: [...forms.keys()]
    },
    articles,
    forms
  };
}

/** The copy's files, by the names the app reads. */
export function wiktionaryFiles({
  index,
  articles,
  forms
}: Wiktionary): [string, unknown][] {
  return [
    ["wikt-index.json", index],
    ...[...articles].map(([group, pack]): [string, unknown] => [
      `wikt-${group}.json`,
      pack
    ]),
    ...[...forms].map(([group, pack]): [string, unknown] => [
      `wikt-forms-${group}.json`,
      pack
    ])
  ];
}

// `wiktionary.ts <folder>`: the latest extraction's files alone, for the weekly
// copy in teamazteya/epigrapho-datos (A6 Fase 6). Prints what its
// manifest.json starts from.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) throw new Error("uso: wiktionary.ts <carpeta>");
  const wiktionary = await buildWiktionary(true);
  mkdirSync(folder, { recursive: true });
  for (const [name, data] of wiktionaryFiles(wiktionary))
    writeFileSync(`${folder}/${name}`, JSON.stringify(data));
  const { date, sha256: source } = wiktionary.index;
  console.log(JSON.stringify({ format: WIKTIONARY_FORMAT, date, source }));
}
