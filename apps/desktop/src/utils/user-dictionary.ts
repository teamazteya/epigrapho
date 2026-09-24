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

import { readFile, writeFile } from "fs/promises";

/**
 * The words the person accepted, on three shelves (PRD §31.11, Paso 6.3):
 *
 * - the dictionary: words they added, good everywhere;
 * - ignored in this note: filed under a note's id, because a name that only
 *   makes sense inside one note should not follow them everywhere;
 * - ignored once: until the app closes, and no further.
 *
 * Since Fase 7 the first two belong to the account: they are settings in the
 * database, encrypted and synced with everything else there, and the database
 * lives in the other process. What is here is a copy in memory, handed over
 * whenever it changes, because the spell checker answers on every keystroke
 * and cannot wait on the app to ask the database for it.
 *
 * Nothing here is written to disk. `add` and `ignoreInNote` are what the
 * native context menu calls so the underline clears at once; the same click
 * also tells the app, which writes the word where it belongs and hands the
 * whole list back.
 */
let words = new Set<string>();
let byNote = new Map<string, Set<string>>();
const once = new Set<string>();

export const userDictionary = {
  /** The account's lists, replacing whatever was here. */
  replaceWith(accepted: string[], ignored: Record<string, string[]>) {
    words = new Set(accepted);
    byNote = new Map(
      Object.entries(ignored).map(([note, inNote]) => [note, new Set(inNote)])
    );
  },

  words() {
    return [...words].sort((a, b) => a.localeCompare(b));
  },

  add(word: string) {
    if (word) words.add(word);
  },

  /** Until the app closes, and only for this word. */
  ignoreOnce(word: string) {
    if (word) once.add(word);
  },

  /** For as long as the note exists. Without a note, it is only once. */
  ignoreInNote(word: string, noteId?: string) {
    if (!word) return;
    if (!noteId) return this.ignoreOnce(word);
    byNote.set(noteId, (byNote.get(noteId) ?? new Set<string>()).add(word));
  },

  /**
   * Whether the person has already said this word is fine. The comparison is
   * exact: adding "Onésimo" accepts that word, not every form of it, which is
   * what a person adding a proper name expects.
   */
  accepts(word: string, noteId?: string) {
    return (
      words.has(word) ||
      once.has(word) ||
      (!!noteId && !!byNote.get(noteId)?.has(word))
    );
  },

  /** The dictionary as a file, so it can be carried to another machine. */
  async exportTo(file: string) {
    await writeFile(
      file,
      JSON.stringify({ version: 1, words: this.words() }, undefined, 2),
      "utf-8"
    );
  },

  /**
   * The words such a file holds. They are not added here: the app puts them
   * in the account, which hands the list back like any other change.
   */
  async wordsFrom(file: string): Promise<string[]> {
    const read: unknown = JSON.parse(await readFile(file, "utf-8"));
    const imported =
      read && typeof read === "object" && "words" in read ? read.words : [];
    if (!Array.isArray(imported))
      throw new Error("This file carries no words.");
    return imported.filter((word) => typeof word === "string" && word);
  }
};
