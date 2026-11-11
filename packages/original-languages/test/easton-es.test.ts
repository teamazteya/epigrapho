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
  KNOWN_MISMATCHES,
  buildEastonEs,
  readEastonEs,
  referenceMismatches
} from "../scripts/easton-es.ts";
import { buildDictionaryEn } from "../scripts/import.ts";
import { buildDictionaryIndex, searchIndex } from "../src/search.ts";

test("Easton in Spanish: every translation cites what Easton cites", () => {
  const english = buildDictionaryEn();
  const translated = readEastonEs();
  for (const id of Object.keys(translated))
    assert.ok(english[id]?.[1] === "EAS", `${id} no es de Easton`);
  const easton = Object.keys(english).filter((id) => english[id][1] === "EAS");
  assert.deepEqual(easton.filter((id) => !translated[id]), []);
  for (const id of Object.keys(KNOWN_MISMATCHES))
    assert.ok(translated[id], `${id} no está traducido`);
  assert.deepEqual(referenceMismatches(english, translated), []);

  const pack = buildEastonEs();
  assert.deepEqual(pack["EASES:accho"]?.slice(0, 2), ["Aco (Achô)", "EASES"]);
  // The modern name and RV1909's both find it.
  const index = buildDictionaryIndex(pack);
  for (const query of ["Aco", "Achô", "acho"])
    assert.equal(searchIndex(index, query)[0]?.id, "EASES:accho", query);
});
