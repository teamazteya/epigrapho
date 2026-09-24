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
  API_BIBLE_IDS,
  apiBiblePassageId,
  createApiBibleProvider
} from "../src/api-bible.ts";
import { PROVENANCE } from "../src/provenance.ts";

const JOHN = {
  book: "JHN",
  chapter: 3,
  verse: 16,
  versification: "default"
};

/** Records every request and answers with a verse. */
function spyFetch(
  body: unknown = { data: { content: "  Porque tanto amó  " } }
) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => body
    } as Response;
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

test("la petición lleva la referencia y nada más", async () => {
  const { calls, fetch } = spyFetch();
  const provider = createApiBibleProvider({
    apiKey: () => "llave-de-prueba",
    fetch
  });

  const text = await provider.getVerseText(JOHN, "NBLA");

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.scripture.api.bible/v1/bibles/ce11b813f9a27e20-01/passages/JHN.3.16" +
      "?content-type=text&include-notes=false&include-titles=false" +
      "&include-chapter-numbers=false&include-verse-numbers=false" +
      "&include-verse-spans=false"
  );
  assert.deepEqual(calls[0].init, {
    method: "GET",
    headers: { "api-key": "llave-de-prueba" },
    cache: "no-store"
  });
  // No body at all: there is no field a note could travel in.
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(text, "Porque tanto amó");
});

// The whole request, printed, so a person can read what leaves the machine.
test("nada del usuario aparece en la petición", async () => {
  const { calls, fetch } = spyFetch();
  const provider = createApiBibleProvider({
    apiKey: () => "llave-de-prueba",
    fetch
  });
  await provider.getVerseText(JOHN, "NTV");

  const request = JSON.stringify(calls[0]);
  console.log("petición completa:", request);
  // Everything in it is either the endpoint, the bible id, the reference, the
  // switches or the key. The only words are these.
  const words = request.match(/[A-Za-zÀ-ÿ]{3,}/g) ?? [];
  const allowed = new Set([
    "https",
    "api",
    "scripture",
    "bible",
    "bibles",
    "passages",
    "JHN",
    "content",
    "type",
    "text",
    "include",
    "notes",
    "false",
    "titles",
    "chapter",
    "numbers",
    "verse",
    "spans",
    "url",
    "init",
    "method",
    "GET",
    "headers",
    "key",
    "cache",
    "no",
    "store",
    "llave",
    "prueba"
  ]);
  assert.deepEqual(
    words.filter((word) => !allowed.has(word)),
    []
  );
});

test("un rango pide un pasaje, no un verso suelto", () => {
  assert.equal(apiBiblePassageId(JOHN), "JHN.3.16");
  assert.equal(
    apiBiblePassageId({ ...JOHN, endVerse: 18 }),
    "JHN.3.16-JHN.3.18"
  );
  assert.equal(
    apiBiblePassageId({ ...JOHN, endChapter: 4, endVerse: 2 }),
    "JHN.3.16-JHN.4.2"
  );
});

test("una traducción fuera de la lista blanca no sale a la red", async () => {
  const { calls, fetch } = spyFetch();
  const provider = createApiBibleProvider({
    apiKey: () => "llave-de-prueba",
    fetch
  });

  // RVR09 exists on API.Bible and this key opens it. Epigrapho is not licensed
  // for it, so it never leaves the machine.
  assert.equal(await provider.getVerseText(JOHN, "RVR09"), "");
  assert.equal(await provider.getVerseText(JOHN, "VBL"), "");
  assert.deepEqual(calls, []);
});

test("sin llave no hay petición", async () => {
  const { calls, fetch } = spyFetch();
  const provider = createApiBibleProvider({ apiKey: () => undefined, fetch });

  assert.equal(await provider.getVerseText(JOHN, "NBLA"), "");
  assert.deepEqual(calls, []);
});

test("un error de la API se propaga, no se disfraza de verso vacío", async () => {
  const fetch = (async () =>
    ({
      ok: false,
      status: 429,
      json: async () => ({})
    } as Response)) as unknown as typeof globalThis.fetch;
  const provider = createApiBibleProvider({
    apiKey: () => "llave-de-prueba",
    fetch
  });

  await assert.rejects(() => provider.getVerseText(JOHN, "NBLA"), /429/);
});

test("las tres de marca tienen id y atribución, y son online", () => {
  assert.deepEqual(Object.keys(API_BIBLE_IDS), ["NTV", "NBLA", "NASB"]);
  for (const id of Object.keys(API_BIBLE_IDS)) {
    assert.equal(PROVENANCE[id].deliveryMode, "online-cached");
    assert.ok(
      PROVENANCE[id].attribution.length > 40,
      `${id} necesita la línea de copyright del editor`
    );
  }
});
