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
/* eslint-disable no-var */

import { ELECTRON_TRPC_CHANNEL } from "electron-trpc/main";
import { ipcRenderer, contextBridge, webFrame } from "electron";

declare global {
  var os: () => "mas" | typeof process.platform;
  var electronTRPC: any;
}

const electronTRPC = {
  sendMessage: (operation: any) =>
    ipcRenderer.send(ELECTRON_TRPC_CHANNEL, operation),
  onMessage: (callback: any) =>
    ipcRenderer.on(ELECTRON_TRPC_CHANNEL, (_event, args) => callback(args))
};

const os = () => (MAC_APP_STORE ? "mas" : process.platform);

// The preload runs inside the page, but this package is typed for the main
// process, where there is no DOM. This is the whole of the DOM it touches.
declare const document: {
  querySelector(selectors: string): { dataset: Record<string, string> } | null;
};

/**
 * Epigrapho: spell checking is ours, not Chromium's (see utils/spell-check.ts).
 *
 * Chromium hands us the words it is about to underline and waits for the list
 * of the ones that are wrong. The answer is asked of the main process, which
 * asks a worker thread, so neither the thread that draws the editor nor the
 * one that runs the window ever reads a dictionary.
 */
webFrame.setSpellCheckProvider("es-MX", {
  spellCheck: (words, callback) =>
    ipcRenderer
      // The note being written travels with the words, because a word can be
      // ignored inside one note and still be an error everywhere else
      // (Paso 6.3). The editor writes the id on the element it marks active.
      .invoke(
        "epigrapho:spellcheck",
        words,
        document.querySelector(".active[data-note-id]")?.dataset.noteId
      )
      // A spell checker that fails is a spell checker that says nothing is
      // misspelled, never one that leaves the editor waiting.
      .then(callback)
      .catch(() => callback([]))
});

contextBridge.exposeInMainWorld("electronTRPC", electronTRPC);
contextBridge.exposeInMainWorld("os", os);
