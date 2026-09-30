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

import { desktop } from "../common/desktop-bridge";
import { useEditorManager } from "../components/editor/manager";

/** Open notes show what the checker says now, not under the old setting. */
function recheckOpenNotes() {
  for (const context of Object.values(useEditorManager.getState().editors))
    context?.editor?.recheckGrammar();
}
import BaseStore from "../stores";
import createStore from "../common/store";
import {
  customWords,
  removeWord,
  saveWords
} from "../common/synced-preferences";

class SpellCheckerStore extends BaseStore<SpellCheckerStore> {
  enabled = true;
  words: string[] = [];
  /** The dictionaries in use; the list itself is fixed (es, en). */
  languages: string[] = [];
  // The grammar checker (ADR-0010) reads in the same languages.
  grammar = { enabled: true, style: false, failed: false };

  toggleSpellChecker = async () => {
    const enabled = this.get().enabled;
    await desktop?.spellChecker.toggle.mutate({ enabled: !enabled });
    this.set({
      enabled: !enabled
    });
  };

  // The switch is this machine's; the words are the account's (Fase 7), so
  // they are read from the database and not from the main process.
  refresh = async () => {
    this.set({
      enabled: await desktop?.spellChecker.isEnabled.query(),
      languages: (await desktop?.spellChecker.languages.query())?.enabled,
      words: customWords()
    });
    const grammar = await desktop?.grammarChecker.settings.query();
    if (grammar)
      this.set({
        grammar: {
          enabled: grammar.enabled,
          style: grammar.style,
          failed: grammar.status === "failed"
        }
      });
  };

  toggleGrammar = async () => {
    const enabled = !this.get().grammar.enabled;
    await desktop?.grammarChecker.toggle.mutate({ enabled });
    await this.get().refresh();
    recheckOpenNotes();
  };

  toggleGrammarStyle = async () => {
    const enabled = !this.get().grammar.style;
    await desktop?.grammarChecker.toggleStyle.mutate({ enabled });
    await this.get().refresh();
    recheckOpenNotes();
  };

  setLanguages = async (languages: ("es" | "en")[]) => {
    // At least one: an empty list would silently fall back to the interface
    // language, which is not what unticking the last box asks for.
    if (!languages.length) return;
    await desktop?.spellChecker.setLanguages.mutate({ languages });
    this.set({ languages });
    // Grammar is checked in the same languages.
    recheckOpenNotes();
  };

  deleteWord = async (word: string) => {
    await removeWord(word);
    await this.get().refresh();
  };

  // The person's dictionary, out to a file and back in (Paso 6.3). The file
  // is chosen in a native dialog, so both of these pass through the main
  // process; what comes back from it is words, which are stored here.
  exportWords = async () => {
    await desktop?.spellChecker.exportWords.mutate();
  };

  importWords = async () => {
    const imported = (await desktop?.spellChecker.importWords.mutate()) || [];
    // Importing adds: it must not empty the dictionary of the machine it is
    // imported on.
    if (imported.length) await saveWords([...customWords(), ...imported]);
    await this.get().refresh();
  };
}

const [useSpellChecker] = createStore<SpellCheckerStore>(
  (set, get) => new SpellCheckerStore(set, get)
);
export { useSpellChecker };
