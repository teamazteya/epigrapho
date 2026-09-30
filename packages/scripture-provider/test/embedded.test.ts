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

import { test } from "node:test";
import assert from "node:assert/strict";
import { textInRange } from "../src/embedded.ts";

const ROM = new Map([
  ["8:37", "a"],
  ["8:38", "b"],
  ["8:39", "c"],
  ["9:1", "d"],
  ["9:2", "e"],
  ["9:3", "f"]
]);

test("un verso solo", () => {
  assert.equal(textInRange(ROM, { book: "ROM", chapter: 8, verse: 38 }), "b");
});

test("un rango dentro de un capítulo", () => {
  assert.equal(
    textInRange(ROM, { book: "ROM", chapter: 8, verse: 37, endVerse: 38 }),
    "a b"
  );
});

test("un rango que cruza capítulos lee los dos", () => {
  assert.equal(
    textInRange(ROM, {
      book: "ROM",
      chapter: 8,
      verse: 38,
      endChapter: 9,
      endVerse: 2
    }),
    "b c d e"
  );
});
