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

import { findingKey, type GrammarMatch } from "@notesnook/editor";
import { desktop } from "./desktop-bridge";
import Config from "../utils/config";

const IGNORED = "grammar:ignored";

/** Findings the person dismissed, per note. */
function ignored(noteId: string): string[] {
  return Config.get<Record<string, string[]>>(IGNORED, {})[noteId] ?? [];
}

/**
 * The grammar checker, for the editor of one note (ADR-0010). It runs in the
 * desktop app's main process; on the web there is none, and the editor then
 * checks nothing.
 *
 * ponytail: dismissals live in this device's settings, not in the synced
 * account; move them to synced-preferences if they should follow the note.
 */
export function grammarFor(noteId: string) {
  if (!desktop) return {};
  return {
    checkGrammar: async (text: string): Promise<GrammarMatch[]> => {
      const matches =
        (await desktop?.grammarChecker.check.query({ text })) ?? [];
      const skip = new Set(ignored(noteId));
      return matches.filter(
        (match) =>
          !skip.has(
            findingKey(
              match.ruleId,
              text.slice(match.offset, match.offset + match.length)
            )
          )
      );
    },
    ignoreGrammar: (key: string) => {
      const all = Config.get<Record<string, string[]>>(IGNORED, {});
      all[noteId] = [...new Set([...(all[noteId] ?? []), key])];
      Config.set(IGNORED, all);
    }
  };
}
