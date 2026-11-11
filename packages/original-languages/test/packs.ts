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

import { existsSync, readFileSync } from "node:fs";
import type {
  DictionaryPack,
  DictionaryWordsPack,
  TranslationWordsPack,
  WiktionaryIndexPack
} from "../src/pack.ts";
import { mergeDictionaries, wiktionaryGroup } from "../src/search.ts";

// The packs npm run build writes, read the way dictionaries() in index.ts
// combines them.
const PACKS = new URL("../../../apps/web/public/original/", import.meta.url);
export const built = existsSync(new URL("wikt-index.json", PACKS));

export const readPack = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(name, PACKS), "utf8"));

export function loadPacks(): [
  DictionaryPack,
  WiktionaryIndexPack,
  DictionaryWordsPack
] {
  return [
    mergeDictionaries(
      [
        readPack<DictionaryPack>("dictionary-en.json"),
        readPack<DictionaryPack>("dictionary-es-rand.json"),
        readPack<DictionaryPack>("dictionary-es-easton.json")
      ],
      readPack<TranslationWordsPack>("es-419-tw.json")
    ),
    readPack<WiktionaryIndexPack>("wikt-index.json"),
    readPack<DictionaryWordsPack>("dictionary-words.json")
  ];
}

/** The Wiktionary forms a query's group has, as searchDictionary reads them. */
export function formsFor(index: WiktionaryIndexPack, query: string) {
  const group = wiktionaryGroup(query.trim());
  return index.forms.includes(group)
    ? readPack<Record<string, string[]>>(`wikt-forms-${group}.json`)
    : undefined;
}
