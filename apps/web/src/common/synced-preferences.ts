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

import { EVENTS } from "@notesnook/core";
import { db } from "./db";
import { desktop } from "./desktop-bridge";
import Config from "../utils/config";

/**
 * The preferences that belong to the person rather than to the machine
 * (Fase 7): the interface language, the translation they read in, and the
 * words they taught the spell checker.
 *
 * They are kept in the database's settings collection, which syncs encrypted
 * exactly like a note does, so a second machine that signs in finds them
 * already chosen. What each machine keeps beside the database is a copy:
 *
 * - `Config` (localStorage) holds the two strings, because the interface
 *   language has to be known before the database is open, and because reading
 *   a preference while drawing the editor cannot be an await;
 * - the desktop main process holds the two word lists, because the spell
 *   checker answers there, once per keystroke, and cannot ask the database.
 *
 * The database is the truth and both copies are written from it. Nothing here
 * touches a note, and no reference metadata is involved: a reference is USFM
 * inside the note's content, which syncs on its own.
 */

/** The preferences that are a single string, and where each one is cached. */
const PREFERENCES = {
  uiLocale: "epigrapho:uiLocale",
  translation: "epigrapho:translation"
} as const;

type Preference = keyof typeof PREFERENCES;

/** Remembers a choice on this machine and in the account. */
export async function setPreference(name: Preference, value: string) {
  Config.set(name, value);
  await db.settings.setEpigrapho(PREFERENCES[name], value);
}

/** The words the person added, as the account has them. */
export function customWords(): string[] {
  return db.settings.getEpigrapho("epigrapho:words");
}

function ignoredWords(): Record<string, string[]> {
  return db.settings.getEpigrapho("epigrapho:wordsByNote");
}

/**
 * Hands the desktop spell checker the lists it answers with. It is a copy and
 * it is replaced whole: a word deleted in settings has to disappear there too.
 */
async function copyWordsToSpellChecker() {
  await desktop?.spellChecker.setWords.mutate({
    words: customWords(),
    byNote: ignoredWords()
  });
}

export async function saveWords(words: string[]) {
  await db.settings.setEpigrapho("epigrapho:words", [
    ...new Set(words.filter(Boolean))
  ]);
  await copyWordsToSpellChecker();
}

export async function addWord(word: string) {
  if (!word || customWords().includes(word)) return;
  await saveWords([...customWords(), word]);
}

export async function removeWord(word: string) {
  await saveWords(customWords().filter((each) => each !== word));
}

/**
 * A word that is only right inside one note. The note's id is what it is
 * filed under, so it travels with the account and means the same thing on
 * every machine.
 */
export async function ignoreWordInNote(word: string, noteId: string) {
  if (!word || !noteId) return;
  const byNote = ignoredWords();
  if (byNote[noteId]?.includes(word)) return;
  await db.settings.setEpigrapho("epigrapho:wordsByNote", {
    ...byNote,
    [noteId]: [...(byNote[noteId] || []), word]
  });
  await copyWordsToSpellChecker();
}

/**
 * Brings both copies back in line with the account. Run when the database
 * opens, after a sync, and after a backup is restored.
 */
export async function pullSyncedPreferences() {
  let languageChanged = false;
  for (const name of Object.keys(PREFERENCES) as Preference[]) {
    const synced = db.settings.getEpigrapho(PREFERENCES[name]);
    const local = Config.get<string | undefined>(name, undefined);
    if (!synced) {
      // Nothing in the account yet, so this machine's choice is the choice.
      if (local) await db.settings.setEpigrapho(PREFERENCES[name], local);
      continue;
    }
    if (synced === local) continue;
    Config.set(name, synced);
    if (name === "uiLocale") languageChanged = true;
  }

  // Words this machine kept on its own before Fase 7 are adopted instead of
  // being thrown away. The main process empties its side as it hands them
  // over, so this happens once and then has nothing to do.
  const kept = await desktop?.spellChecker.adoptWords.mutate();
  if (kept?.words.length)
    await db.settings.setEpigrapho("epigrapho:words", [
      ...new Set([...customWords(), ...kept.words])
    ]);
  if (kept && Object.keys(kept.byNote).length) {
    const byNote = { ...ignoredWords() };
    for (const [noteId, inNote] of Object.entries(kept.byNote))
      byNote[noteId] = [...new Set([...(byNote[noteId] || []), ...inNote])];
    await db.settings.setEpigrapho("epigrapho:wordsByNote", byNote);
  }
  await copyWordsToSpellChecker();

  // Every string is read at render time, so reloading is how the app changes
  // language — the same thing setUiLocale does when the person picks one.
  if (languageChanged) window.location.reload();
}

declare global {
  interface Window {
    epigrapho?: {
      addWord(word: string): Promise<void>;
      ignoreWordInNote(word: string, noteId: string): Promise<void>;
    };
  }
}

/**
 * ponytail: the native context menu is built in the main process, where the
 * database is not, so accepting a word there calls back in through this. A
 * message channel of its own would be the same two calls with more parts.
 */
export async function initSyncedPreferences() {
  window.epigrapho = { addWord, ignoreWordInNote };
  db.eventManager.subscribe(EVENTS.syncCompleted, () =>
    pullSyncedPreferences()
  );
  await pullSyncedPreferences();
}
