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
  CACHE_TTL_MS,
  cacheKey,
  withCache,
  type CachedVerse,
  type VerseCacheStore
} from "../src/cache.ts";
import type { ScriptureTextProvider } from "../src/provider.ts";

const JOHN = { book: "JHN", chapter: 3, verse: 16, versification: "default" };

/** A store that lives in a Map, so a test can read what was written. */
function memoryStore(): VerseCacheStore & { rows: Map<string, CachedVerse> } {
  const rows = new Map<string, CachedVerse>();
  return {
    rows,
    async get(key) {
      return rows.get(key);
    },
    async set(key, value) {
      rows.set(key, value);
    }
  };
}

/** A provider that counts how many times it was actually asked. */
function countingProvider(
  answer: (call: number) => string | Promise<string>
): ScriptureTextProvider & { calls: number } {
  const provider = {
    calls: 0,
    async getVerseText() {
      provider.calls++;
      return answer(provider.calls);
    }
  };
  return provider;
}

test("la segunda lectura no vuelve a pedir el verso", async () => {
  const store = memoryStore();
  const online = countingProvider(() => "Porque de tal manera amó Dios");
  const clock = { now: 1_000_000 };
  const provider = withCache(online, { store, now: () => clock.now });

  const first = await provider.getVerseText(JOHN, "NBLA");
  const second = await provider.getVerseText(JOHN, "NBLA");

  assert.equal(online.calls, 1, "la segunda lectura salió a la red");
  assert.equal(first, second);
  assert.deepEqual([...store.rows.keys()], ["NBLA:JHN.3.16"]);
  assert.equal(store.rows.get("NBLA:JHN.3.16").fetchedAt, 1_000_000);
});

test("pasados los 30 dias el verso se vuelve a pedir", async () => {
  const store = memoryStore();
  const online = countingProvider((call) => `respuesta ${call}`);
  const clock = { now: 1_000_000 };
  const provider = withCache(online, { store, now: () => clock.now });

  assert.equal(await provider.getVerseText(JOHN, "NBLA"), "respuesta 1");

  // One second short of the window: still the stored copy.
  clock.now += CACHE_TTL_MS - 1000;
  assert.equal(await provider.getVerseText(JOHN, "NBLA"), "respuesta 1");
  assert.equal(online.calls, 1);

  // Past it: asked again, and the row is refreshed.
  clock.now += 2000;
  assert.equal(await provider.getVerseText(JOHN, "NBLA"), "respuesta 2");
  assert.equal(online.calls, 2);
  assert.equal(store.rows.get("NBLA:JHN.3.16").fetchedAt, clock.now);
});

test("cada traduccion y cada rango tienen su propia fila", async () => {
  const store = memoryStore();
  const online = countingProvider(() => "texto");
  const provider = withCache(online, { store });

  await provider.getVerseText(JOHN, "NBLA");
  await provider.getVerseText(JOHN, "NTV");
  await provider.getVerseText({ ...JOHN, endVerse: 18 }, "NBLA");

  assert.deepEqual(
    [...store.rows.keys()],
    ["NBLA:JHN.3.16", "NTV:JHN.3.16", "NBLA:JHN.3.16-3.18"]
  );
  assert.equal(online.calls, 3);
  assert.equal(cacheKey(JOHN, "NBLA"), "NBLA:JHN.3.16");
});

// Empty means "not this provider's translation", not "no text": caching it
// would answer for a provider that never spoke.
test("una respuesta vacia no se guarda", async () => {
  const store = memoryStore();
  const online = countingProvider(() => "");
  const provider = withCache(online, { store });

  assert.equal(await provider.getVerseText(JOHN, "VBL"), "");
  assert.equal(await provider.getVerseText(JOHN, "VBL"), "");

  assert.deepEqual([...store.rows.keys()], []);
  assert.equal(online.calls, 2);
});

test("un fallo no se guarda ni tapa lo que ya estaba", async () => {
  const store = memoryStore();
  const online = countingProvider((call) => {
    if (call === 2) throw new Error("API.Bible responded 429");
    return "texto bueno";
  });
  const clock = { now: 1_000_000 };
  const provider = withCache(online, { store, now: () => clock.now });

  await provider.getVerseText(JOHN, "NBLA");
  clock.now += CACHE_TTL_MS + 1;

  await assert.rejects(() => provider.getVerseText(JOHN, "NBLA"), /429/);
  // The expired copy survives: Paso 4.3 shows it, labelled, when there is no
  // network.
  assert.equal(store.rows.get("NBLA:JHN.3.16").text, "texto bueno");
});
