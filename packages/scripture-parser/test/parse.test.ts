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
  BOOK_NAMES,
  OSIS_TO_USFM,
  extractRefs,
  formatReadableRef,
  formatRef,
  parseRef,
  parseReferences
} from "../src/parse.ts";

// ponytail: node:test + node:assert instead of vitest. The repo's runner would
// mean a second install for five assertions; run with
// `node --experimental-strip-types --test test/parse.test.ts` (Node 22).

function only(text: string) {
  const references = parseReferences(text);
  assert.equal(references.length, 1, `se esperaba una referencia en ${text}`);
  return references[0];
}

for (const text of ["Juan 3:16", "Jn 3:16", "John 3:16"]) {
  test(`${text} es JHN 3:16`, () => {
    const reference = only(text);
    assert.equal(reference.book, "JHN");
    assert.equal(reference.chapter, 3);
    assert.equal(reference.verse, 16);
  });
}

test("1 Corintios 13 es el capitulo 13 de 1CO", () => {
  const reference = only("1 Corintios 13");
  assert.equal(reference.book, "1CO");
  assert.equal(reference.chapter, 13);
});

// The Spanish grammar knows "John" but not "1 John", so the shorter Spanish
// match must not win over the longer English one.
test("1 John 1:1 es 1JN, no JHN", () => {
  assert.equal(only("1 John 1:1").book, "1JN");
});

test("Juan 3:16-18 es un rango dentro del capitulo", () => {
  const reference = only("Juan 3:16-18");
  assert.equal(reference.book, "JHN");
  assert.equal(reference.chapter, 3);
  assert.equal(reference.verse, 16);
  assert.equal(reference.endVerse, 18);
});

// A0 ends with both languages recognised inside one note (Fase 8, puntos 2-3).
test("espanol e ingles conviven en el mismo texto", () => {
  const text = "Escribi Juan 3:16 y John 3:16 aqui.";
  const references = parseReferences(text);
  assert.equal(references.length, 2);
  assert.deepEqual(
    references.map((reference) => text.slice(...reference.indices)),
    ["Juan 3:16", "John 3:16"]
  );
  for (const reference of references) assert.equal(reference.book, "JHN");
});

test("la tabla OSIS_TO_USFM cubre los 66 libros", () => {
  assert.equal(Object.keys(OSIS_TO_USFM).length, 66);
  assert.equal(new Set(Object.values(OSIS_TO_USFM)).size, 66);
});

test("formatRef escribe el ref que guarda el mark del editor", () => {
  const [single] = parseReferences("Juan 3:16");
  assert.equal(formatRef(single), "JHN.3.16");

  const [range] = parseReferences("Juan 3:16-18");
  assert.equal(formatRef(range), "JHN.3.16-JHN.3.18");
});

test("parseRef deshace formatRef", () => {
  for (const text of ["Juan 3:16", "Juan 3:16-18", "Salmo 23:1"]) {
    const [reference] = parseReferences(text);
    const back = parseRef(formatRef(reference));
    assert.ok(back, `no se pudo leer ${text}`);
    assert.equal(back.book, reference.book);
    assert.equal(back.chapter, reference.chapter);
    assert.equal(back.verse, reference.verse);
    assert.equal(back.endVerse, reference.endVerse);
  }
  assert.equal(parseRef("Juan 3:16"), undefined);
});

test("formatReadableRef escribe la referencia como la lee una persona", () => {
  const readable = (text: string) => formatReadableRef(only(text), "es");
  assert.equal(readable("Juan 3:16"), "Juan 3:16");
  assert.equal(readable("John 3:16"), "Juan 3:16");
  assert.equal(readable("Juan 3:16-18"), "Juan 3:16-18");
  assert.equal(readable("Salmo 23:1"), "Salmos 23:1");
});

// The visible name follows the UI locale, not the locale the reference was
// typed in: the same stored ref reads differently in each UI language.
test("formatReadableRef usa el locale de la interfaz", () => {
  const ref = parseRef("JHN.3.16")!;
  assert.equal(formatReadableRef(ref, "en"), "John 3:16");
  assert.equal(formatReadableRef(ref, "es"), "Juan 3:16");
});

// Every name has to survive the round trip, or a copied verse would not parse
// back into the reference it came from.
for (const locale of ["es", "en"] as const)
  test(`los 66 nombres en ${locale} vuelven a su propio libro`, () => {
    assert.equal(Object.keys(BOOK_NAMES[locale]).length, 66);
    for (const book of Object.values(OSIS_TO_USFM)) {
      const readable = formatReadableRef(
        { book, chapter: 1, verse: 1, versification: "default" },
        locale
      );
      assert.equal(
        only(readable).book,
        book,
        `${readable} no volvió a ${book}`
      );
    }
  });

// --- what a saved note cites (Paso 5.1) ---

test("extractRefs saca las referencias de un documento guardado", () => {
  const html =
    '<p><span data-scripture-ref="ROM.8.28">Romanos 8:28</span> y ' +
    '<span data-scripture-ref="JHN.3.16-JHN.3.18">Juan 3:16-18</span>.</p>' +
    '<div class="scripture-block" data-scripture-ref="PSA.23.1" ' +
    'data-translation-id="VBL"><p>El Señor es mi pastor.</p></div>';
  assert.deepEqual(extractRefs(html), [
    "ROM.8.28",
    "JHN.3.16-JHN.3.18",
    "PSA.23.1"
  ]);
});

test("extractRefs no repite una referencia citada dos veces", () => {
  const html =
    '<p><span data-scripture-ref="ROM.8.28">Romanos 8:28</span></p>' +
    '<p><span data-scripture-ref="ROM.8.28">Romans 8:28</span></p>';
  assert.deepEqual(extractRefs(html), ["ROM.8.28"]);
});

// An attribute that is not a canonical reference is not a reference. Letting
// one through would put a row in the index that nothing can ever look up.
test("extractRefs descarta lo que no es una referencia canonica", () => {
  const html =
    '<p><span data-scripture-ref="">vacia</span>' +
    '<span data-scripture-ref="Romanos 8:28">sin normalizar</span>' +
    '<span data-scripture-ref="ROM.8.28-JHN.1.1">cruza de libro</span>' +
    '<span data-scripture-ref="ROM.8.28">buena</span></p>';
  assert.deepEqual(extractRefs(html), ["ROM.8.28"]);
});

test("extractRefs devuelve una lista vacia si la nota no cita nada", () => {
  assert.deepEqual(extractRefs("<p>Una nota sin referencias.</p>"), []);
  assert.deepEqual(extractRefs(""), []);
});
