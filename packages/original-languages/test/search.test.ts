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
import type { DictionaryPack } from "../src/pack.ts";
import {
  buildDictionaryIndex,
  buildWordIndex,
  dleUrl,
  fold,
  groupDictionaryHits,
  indexOnce,
  nearForms,
  searchIndex,
  wiktionaryGroup
} from "../src/search.ts";
import { built, formsFor, loadPacks, readPack } from "./packs.ts";

test("near forms: plural and singular", () => {
  assert.ok(nearForms("profetas").includes("profeta"));
  assert.ok(nearForms("leyes").includes("ley"));
  assert.ok(nearForms("luces").includes("luz"));
  assert.ok(nearForms("luz").includes("luces"));
  assert.ok(nearForms("cities").includes("city"));
  assert.ok(nearForms("profeta").includes("profetas"));
  assert.ok(nearForms("matusalen").includes("matusalem"));
});

test("fold: accents and points off, letters kept", () => {
  assert.equal(fold("ἀγάπη"), "αγαπη");
  assert.equal(fold("אֱלֹהִים"), "אלהים");
  assert.equal(fold("Jerusalén"), "jerusalen");
});

test("the index is built once", async () => {
  let loads = 0;
  const pack: DictionaryPack = { "EAS:bethel": ["Bethel", "EAS", "A town."] };
  const index = indexOnce(async () => (loads++, [pack]));
  await index();
  await index();
  assert.equal(loads, 1);

  // A failed load is tried again.
  let tries = 0;
  const flaky = indexOnce(async () => {
    if (tries++ === 0) throw new Error("offline");
    return [pack];
  });
  await assert.rejects(flaky());
  assert.ok((await flaky()).entries.has("EAS:bethel"));
});

test(
  "search: spellings, plurals and «Aparece en»",
  { skip: !built && "sin packs: npm run build" },
  () => {
    const packs = loadPacks();
    const [pack] = packs;
    const index = buildDictionaryIndex(...packs);
    const ids = (query: string) =>
      searchIndex(index, query)
        .filter((hit) => hit.match === "term")
        .map((hit) => hit.id);

    for (const query of ["Betel", "bet-el", "BETEL", "Bet el"])
      assert.ok(
        ids(query).some((id) => /^RAND:bet-?el$/i.test(id)),
        `${query}: ${ids(query).slice(0, 5)}`
      );
    const prophets = searchIndex(index, "profetas");
    assert.equal(prophets[0].match, "term");
    assert.match(prophets[0].term, /^profeta/i);

    // Title hits are not repeated under «Aparece en».
    const betel = searchIndex(index, "Betel");
    const text = betel.filter((hit) => hit.match === "text");
    assert.ok(text.length > 0, "nada menciona Betel");
    const titles = new Set(
      betel.filter((hit) => hit.match === "term").map((hit) => hit.id)
    );
    assert.ok(text.every((hit) => !titles.has(hit.id)));

    // Common words have no «Aparece en»; several words must all be there.
    assert.ok(searchIndex(index, "de").every((hit) => hit.match === "term"));
    const sea = searchIndex(index, "mar Muerto");
    assert.ok(sea.length > 0, "nada menciona el mar Muerto");
    for (const hit of sea.filter((hit) => hit.match === "text").slice(0, 5))
      assert.match(pack[hit.id][2], /muerto/i);
  }
);

test(
  "Wikcionario: forms lead to their lemma, biblical lemmas are marked",
  { skip: !built && "sin packs: npm run build" },
  () => {
    const [pack, wiktionary, words] = loadPacks();
    const index = buildDictionaryIndex(pack, wiktionary, words);
    // The words built here are the ones the import wrote.
    assert.equal(JSON.stringify(words), JSON.stringify(buildWordIndex(pack)));
    const search = (query: string) =>
      searchIndex(index, query, 60, formsFor(wiktionary, query));

    // "amó" is no lemma: its form points to "amar".
    assert.ok(search("amó").some((hit) => hit.id === "WIKT:amar"));
    assert.ok(search("amaron").some((hit) => hit.id === "WIKT:amar"));
    // Exact titles first: es-419's "amor, amar, amado", then Wiktionary's.
    assert.deepEqual(
      search("amar")
        .slice(0, 2)
        .map((hit) => hit.id),
      ["TW:kt/love", "WIKT:amar"]
    );

    const melchizedek = search("Melquisedec").find(
      (hit) => hit.source === "WIKT"
    );
    assert.equal(melchizedek?.biblical, true);
    assert.equal(
      search("perro").find((hit) => hit.source === "WIKT")?.biblical,
      undefined
    );

    // The article is in its group's file, with senses and etymology.
    const [term, source, body] = readPack<DictionaryPack>(
      `wikt-${wiktionaryGroup("amar")}.json`
    )["WIKT:amar"];
    assert.equal(term, "amar");
    assert.equal(source, "WIKT");
    assert.match(body, /^Verbo transitivo\n1\. /);
    assert.match(body, /Etimología: Del latín amāre/);
    assert.doesNotMatch(body, /Inglés|loved/);

    // A query of one letter stays bounded.
    assert.ok(search("a").length <= 60 * 2);
  }
);

test("the dictionary screen groups hits in three sections (A6 Fase 7)", () => {
  const hit = (id: string, biblical?: true) => ({
    id,
    term: id,
    source: id.split(":")[0] as "TW",
    match: "term" as const,
    ...(biblical ? { biblical } : {})
  });
  const groups = groupDictionaryHits([
    hit("EAS:grace"),
    hit("WIKT:gracia"),
    hit("TW:kt/grace"),
    hit("WIKT:melquisedec", true),
    hit("EASES:grace"),
    hit("RAND:gracia")
  ]);
  assert.deepEqual(
    groups.map(([section, hits]) => [section, hits.map((h) => h.id)]),
    [
      ["biblical", ["TW:kt/grace", "WIKT:melquisedec", "EASES:grace", "RAND:gracia"]],
      ["spanish", ["WIKT:gracia"]],
      ["english", ["EAS:grace"]]
    ]
  );
  assert.deepEqual(groupDictionaryHits([hit("SMI:x")]).map(([s]) => s), ["english"]);
  assert.equal(dleUrl(" año "), "https://dle.rae.es/a%C3%B1o");
});
