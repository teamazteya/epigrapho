/*
This file is part of the Notesnook project (https://notesnook.com/)

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

import { initTRPC } from "@trpc/server";
import { dialog } from "electron";
import { z } from "zod";
import { strings } from "@notesnook/intl";
import { config } from "../utils/config";
import { userDictionary } from "../utils/user-dictionary";

const t = initTRPC.create();

/**
 * Settings talk to the spell checker through here (Pasos 6.1 and 6.3).
 *
 * There is no list of languages any more: Chromium's checker is off and its
 * list of downloadable languages said nothing about what this app can read.
 * What is left is the switch, the person's own words, and a file to carry
 * them to another machine.
 *
 * The words themselves belong to the account since Fase 7. This process only
 * keeps the copy it answers with, so what crosses here is the list going down
 * and the file going either way.
 */
export const spellCheckerRouter = t.router({
  isEnabled: t.procedure.query(() => config.isSpellCheckerEnabled),
  toggle: t.procedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input: { enabled } }) => {
      config.isSpellCheckerEnabled = enabled;
    }),
  /**
   * The account's lists, handed over whenever they change (Fase 7). They are
   * replaced whole: a word deleted in settings has to disappear here too.
   */
  setWords: t.procedure
    .input(
      z.object({
        words: z.array(z.string()),
        byNote: z.record(z.string(), z.array(z.string()))
      })
    )
    .mutation(({ input: { words, byNote } }) => {
      userDictionary.replaceWith(words, byNote);
    }),
  /**
   * The words Paso 6.3 kept in this machine's settings file, handed over once
   * so the account can take them, and erased from there as they go: from now
   * on they live encrypted with everything else.
   */
  adoptWords: t.procedure.mutation(() => {
    const kept = {
      words: config.customWords,
      byNote: config.ignoredWordsByNote
    };
    if (kept.words.length) config.customWords = [];
    if (Object.keys(kept.byNote).length) config.ignoredWordsByNote = {};
    return kept;
  }),
  exportWords: t.procedure.mutation(async () => {
    if (!globalThis.window) return false;
    const result = await dialog.showSaveDialog(globalThis.window, {
      title: strings.exportDictionary(),
      defaultPath: "epigrapho-dictionary.json",
      filters: [{ name: strings.dictionaryFile(), extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return false;
    await userDictionary.exportTo(result.filePath);
    return true;
  }),
  importWords: t.procedure.mutation(async () => {
    if (!globalThis.window) return [];
    const result = await dialog.showOpenDialog(globalThis.window, {
      title: strings.importDictionary(),
      properties: ["openFile"],
      filters: [{ name: strings.dictionaryFile(), extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return [];
    return userDictionary.wordsFrom(result.filePaths[0]);
  })
});
