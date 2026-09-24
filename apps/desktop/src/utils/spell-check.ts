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

import { ipcMain } from "electron";
import path from "path";
import { Worker } from "worker_threads";
import { config } from "./config";
import { userDictionary } from "./user-dictionary";

/**
 * Epigrapho's own spell checker (PRD §31.11, Paso 6.1).
 *
 * Chromium's built-in checker cannot be taught: it takes a language, not a
 * dictionary, and it downloads that language from a server. Neither suits a
 * program that has to work with no network and has to accept "Tesalonicenses",
 * "Yahvé" and whatever else the person writes (Pasos 6.2 and 6.3). So the
 * built-in one is turned off when the window is built, the renderer asks us
 * through `webFrame.setSpellCheckProvider` (see preload.ts), and the answer
 * comes from a dictionary living on a worker thread.
 *
 * Nothing about the words is stored or sent anywhere: they come in, they are
 * compared against a dictionary on this machine, and the list of the ones that
 * are not in it goes back.
 */
const CHANNEL = "epigrapho:spellcheck";

type Question = { words?: string[]; suggest?: string };
type Answer = { misspelled: string[]; suggestions: string[] };
const NOTHING: Answer = { misspelled: [], suggestions: [] };

let worker: Worker | undefined;
let nextRequest = 0;
const pending = new Map<number, (answer: Answer) => void>();

function spellWorker() {
  if (worker) return worker;

  worker = new Worker(path.join(__dirname, "spell-worker.js"));
  worker.on("message", ({ id, ...answer }: Answer & { id: number }) => {
    pending.get(id)?.(answer);
    pending.delete(id);
  });
  // A spell checker that breaks must not take the editor with it: every
  // question in flight is answered "nothing is misspelled", and the next
  // question starts a new worker.
  worker.on("error", stop);
  worker.on("exit", stop);
  // The worker must not be a reason for the app to stay alive on quit.
  worker.unref();
  return worker;
}

function stop() {
  for (const answer of pending.values()) answer(NOTHING);
  pending.clear();
  worker = undefined;
}

function ask(question: Question): Promise<Answer> {
  return new Promise((resolve) => {
    const id = nextRequest++;
    pending.set(id, resolve);
    spellWorker().postMessage({ id, ...question });
  });
}

/**
 * What to offer for a word the dictionary does not know (Paso 6.2). The list
 * is only a list: the context menu shows it and the person picks, because a
 * biblical term is never corrected on its own.
 */
export async function spellingSuggestions(word: string): Promise<string[]> {
  if (!config.isSpellCheckerEnabled || !word) return [];
  return (await ask({ suggest: word })).suggestions;
}

export function setupSpellChecker() {
  // A second window would otherwise try to register the same handler twice.
  ipcMain.removeHandler(CHANNEL);
  ipcMain.handle(CHANNEL, async (_event, words: string[], noteId?: string) => {
    if (!config.isSpellCheckerEnabled) return [];
    if (!Array.isArray(words) || words.length === 0) return [];
    const { misspelled } = await ask({ words });
    // The last word belongs to the person: whatever they added or told the
    // app to leave alone is not an error, here or in this note (Paso 6.3).
    return misspelled.filter((word) => !userDictionary.accepts(word, noteId));
  });
}
