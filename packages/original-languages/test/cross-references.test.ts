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
import { buildCrossReferences } from "../scripts/cross-references.ts";
import { fetchSources } from "../scripts/sources.ts";

test("cross references: USFM, most voted first, ranges kept", async () => {
  await fetchSources();
  const books = buildCrossReferences();
  assert.equal(books.size, 66);
  const john = books.get("JHN")!["3.16"];
  assert.equal(john[0], "ROM.5.8");
  assert.ok(john.includes("1JN.4.9-1JN.4.10"));
  for (const ref of john)
    assert.match(ref, /^[1-3A-Z]{3}\.\d+\.\d+(-[1-3A-Z]{3}\.\d+\.\d+)?$/);
  // A verse nobody linked has no entry rather than an empty list.
  assert.ok(Object.values(books.get("PSA")!).every((list) => list.length > 0));
});
