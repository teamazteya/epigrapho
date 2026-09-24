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
      words: customWords()
    });
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
