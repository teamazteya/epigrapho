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
  buildBooks,
  buildConcordance,
  buildDictionaryEn,
  buildLexicon,
  buildTranslationWords
} from "../scripts/import.ts";
import { fetchSources, readSource } from "../scripts/sources.ts";
import { buildRand, correctOcr, modernize } from "../scripts/rand.ts";

const nfc = (text: string) => text.normalize("NFC");

// The corpus is built once; every assertion reads from it.
await fetchSources();
const { books, coverage } = buildBooks();
const words = buildTranslationWords();
const lexicon = buildLexicon(books, words);

test("JHN 3:16 da los 25 tokens griegos de NA28", () => {
  const tokens = books.get("JHN")!.verses["3:16"];
  assert.equal(tokens.length, 25);
  const loved = tokens.find(([surface]) => surface === nfc("ἠγάπησεν"))!;
  assert.deepEqual(loved.slice(1, 4), ["ēgapēsen", "G0025", "V-AAI-3S"]);
});

test("GEN 1:1 da los tokens hebreos en orden, sin cantilación", () => {
  const tokens = books.get("GEN")!.verses["1:1"];
  assert.deepEqual(
    tokens.map(([surface]) => surface),
    ["בְּרֵאשִׁית", "בָּרָא", "אֱלֹהִים", "אֵת", "הַשָּׁמַיִם", "וְאֵת", "הָאָרֶץ"].map(nfc)
  );
  assert.equal(tokens[0][2], "H7225G");
});

test("los 66 libros están", () => {
  assert.equal(books.size, 66);
});

test("ἠγάπησεν lleva la glosa RV1909 «amó»", () => {
  const loved = books
    .get("JHN")!
    .verses["3:16"].find(([surface]) => surface === nfc("ἠγάπησεν"))!;
  assert.equal(loved[5], "amó");
});

// The alignment itself leaves ~15 % of the source words unrendered (articles,
// particles, the object marker), and no gloss is ever made up for them. What
// this guards is the join: it may lose at most one point against what Clear
// Bible aligned.
test("la unión con la alineación pierde menos de un punto", () => {
  for (const [testament, source, alignment] of [
    ["NT", "SBLGNT.tsv", "SBLGNT-RV09-manual.json"],
    ["OT", "WLCM.tsv", "WLCM-RV09-manual.json"]
  ] as const) {
    const aligned = new Set<string>();
    for (const record of JSON.parse(readSource(alignment)).records)
      for (const id of record.source) aligned.add(id);
    const sourceWords = new Map<string, boolean>();
    for (const line of readSource(source).split("\n").slice(1)) {
      const id = line.split("\t")[0];
      if (!id) continue;
      const word = id.slice(0, 12);
      sourceWords.set(word, !!sourceWords.get(word) || aligned.has(id));
    }
    const ceiling =
      [...sourceWords.values()].filter(Boolean).length / sourceWords.size;
    const { tokens, withSpanish } = coverage[testament];
    console.log(
      `${testament}: ${((withSpanish / tokens) * 100).toFixed(1)} % con glosa, la alineación cubre ${(ceiling * 100).toFixed(1)} %`
    );
    assert.ok(withSpanish / tokens > ceiling - 0.01);
  }
});

test("G0026 tiene definición, uso en RV1909 y entrada es-419", () => {
  const [lemma, , , , definition, usage, es419] = lexicon.G["G0026"];
  assert.equal(lemma, nfc("ἀγάπη"));
  assert.match(definition, /love, goodwill/);
  const rendered = usage.map(([word]) => word);
  assert.ok(rendered.includes("amor") && rendered.includes("caridad"));
  assert.ok(es419.includes("kt/love"));
  assert.equal(words["kt/love"][0], "amor, amar, amado");
});

test("el uso en RV1909 no cuenta artículos sueltos", () => {
  for (const pack of Object.values(lexicon))
    for (const [, , , , , usage] of Object.values(pack))
      for (const [word] of usage) assert.ok(!["el", "la", "de"].includes(word));
});

test("G26 aparece 116 veces en TAGNT (NA28), agrupado por libro", () => {
  const { G } = buildConcordance(books);
  const byBook = G["G0026"];
  const total = Object.values(byBook).flat().length;
  assert.equal(total, 116);
  assert.equal(Object.keys(byBook)[0], "MAT");
  assert.ok(byBook["1CO"].includes("13:4"));
});

// TAGNT numbers as the NRSV does; the canonical versification is the English
// one, which follows the KJV where they differ (ADR-0004).
test("el NT sigue la numeración inglesa: 2 Co 13:14 es la bendición", () => {
  const blessing = books.get("2CO")!.verses["13:14"];
  assert.ok(blessing.some(([, , strong]) => strong === "G0026"));
  assert.equal(books.get("2CO")!.verses["13:15"], undefined);
});

test("es-419 se muestra como texto, sin marcas de Markdown", () => {
  const [, body] = words["kt/love"];
  assert.doesNotMatch(body, /^\* |\*\*|\]\(/m);
  assert.match(body, /^• /m);
});

test("Bethel está en Easton y en Smith, cada uno con su fuente", () => {
  const dictionary = buildDictionaryEn();
  const [term, source, body] = dictionary["EAS:bethel"];
  assert.equal(term, "Bethel");
  assert.equal(source, "EAS");
  assert.match(body, /^House of God/);
  assert.equal(dictionary["SMI:bethel"][1], "SMI");
  assert.ok(Object.keys(dictionary).length > 10000);
});

test("Rand: la tilde de los monosílabos se moderniza, y nada más", () => {
  assert.equal(
    modernize("Á sus hijos fué á ver, ó dió piés; él vió á Dios"),
    "A sus hijos fue a ver, o dio pies; él vio a Dios"
  );
  assert.equal(modernize("Jacob, Moisés, María"), "Jacob, Moisés, María");
});

test("Rand: Betel es una entrada limpia, sin pies de grabado", () => {
  const rand = buildRand();
  const [term, source, body] = rand["RAND:betel"];
  assert.equal(term, "Betel");
  assert.equal(source, "RAND");
  assert.match(body, /^BETEL, o BETH EL, casa de Dios/);
  assert.doesNotMatch(body, /¬/);
  for (const [, , text] of Object.values(rand))
    assert.doesNotMatch(text, /DICCIONARIO DE LA/);
});

test("Rand: las lecturas erróneas del OCR se corrigen, con sus mayúsculas", () => {
  const fixes = new Map([["cindadanos", "ciudadanos"], ["yna", "una"], ["jernsalem", "jerusalem"]]);
  assert.equal(
    correctOcr("300,000 cindadanos, yna calle de JERNSALEM a Jernsalem", fixes),
    "300,000 ciudadanos, una calle de JERUSALEM a Jerusalem"
  );
  // The "ó" read as a six, but not a six that counts.
  assert.equal(
    correctOcr("gobernante 6 consejero, cobre 6 bronce", fixes),
    "gobernante o consejero, cobre o bronce"
  );
  assert.equal(
    correctOcr("como 6 millas, de 6 a 8, tuvo 6 hijos; HIEL, 6 HIHEL", fixes),
    "como 6 millas, de 6 a 8, tuvo 6 hijos; HIEL, o HIHEL"
  );
});
