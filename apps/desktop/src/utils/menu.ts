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

import { strings } from "@notesnook/intl";
import { Menu, MenuItem, clipboard, shell } from "electron";
import { spellingSuggestions } from "./spell-check";
import { userDictionary } from "./user-dictionary";

/**
 * Tells the app a word was accepted, so it reaches the account and every
 * other machine (Fase 7). The menu is built here, where the database is not.
 */
function tellTheApp(call: string) {
  globalThis.window?.webContents
    .executeJavaScript(`window.epigrapho?.${call}`)
    .catch(() => undefined);
}

/** The note open in the editor, or nothing if none is. */
function noteBeingEdited(): Promise<string> {
  return (
    globalThis.window?.webContents
      .executeJavaScript(
        'document.querySelector(".active[data-note-id]")?.dataset.noteId ?? ""'
      )
      .catch(() => "") ?? Promise.resolve("")
  );
}

function setupMenu() {
  if (!globalThis.window) return;

  globalThis.window.webContents.on("context-menu", async (_event, params) => {
    const menu = new Menu();

    // Chromium fills `params.dictionarySuggestions` from its own dictionary,
    // which this app turned off (Paso 6.1): the suggestions come from ours,
    // and they take a message to a worker thread to arrive.
    for (const suggestion of await spellingSuggestions(params.misspelledWord)) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () =>
            globalThis.window?.webContents.replaceMisspelling(suggestion)
        })
      );
    }

    // What to do with a word the dictionary does not know (Paso 6.3): keep it
    // for good, leave it alone until the app closes, or leave it alone inside
    // this note. Nothing here changes the text.
    const misspelled = params.misspelledWord;
    if (misspelled) {
      const noteId = await noteBeingEdited();
      // Chromium does not ask again about a word it has already marked, so
      // the underline would stay until that line is touched. Replacing the
      // word with itself changes nothing and makes it ask.
      const askAgain = () =>
        globalThis.window?.webContents.replaceMisspelling(misspelled);

      // Each of these accepts the word here, so the underline clears without
      // a round trip, and tells the app, which is what makes it last. The
      // word goes through JSON so a quote in it cannot end up as code.
      const word = JSON.stringify(misspelled);
      for (const [label, accept] of <[string, () => void][]>[
        [
          strings.addToDictionary(),
          () => {
            userDictionary.add(misspelled);
            tellTheApp(`addWord(${word})`);
          }
        ],
        [strings.ignoreOnce(), () => userDictionary.ignoreOnce(misspelled)],
        ...(noteId
          ? [
              [
                strings.ignoreInNote(),
                () => {
                  userDictionary.ignoreInNote(misspelled, noteId);
                  tellTheApp(
                    `ignoreWordInNote(${word}, ${JSON.stringify(noteId)})`
                  );
                }
              ]
            ]
          : [])
      ])
        menu.append(
          new MenuItem({
            label,
            click: () => {
              accept();
              askAgain();
            }
          })
        );
    }

    if (menu.items.length > 0)
      menu.append(
        new MenuItem({
          type: "separator"
        })
      );

    if (params.linkURL.length) {
      menu.append(
        new MenuItem({
          label: strings.openInBrowser(),
          click: () => shell.openExternal(params.linkURL)
        })
      );
    }

    if (params.isEditable) {
      menu.append(
        new MenuItem({
          label: strings.undo(),
          role: "undo",
          enabled: params.isEditable,
          accelerator: "CommandOrControl+Z"
        })
      );

      menu.append(
        new MenuItem({
          label: strings.redo(),
          role: "redo",
          enabled: params.isEditable,
          accelerator: "CommandOrControl+Y"
        })
      );

      menu.append(
        new MenuItem({
          type: "separator"
        })
      );
    }

    if (params.isEditable)
      menu.append(
        new MenuItem({
          label: strings.cut(),
          role: "cut",
          enabled: params.selectionText.length > 0,
          accelerator: "CommandOrControl+X"
        })
      );

    if (params.linkURL?.length) {
      menu.append(
        new MenuItem({
          label: strings.copyLink(),
          click() {
            clipboard.writeText(params.linkURL);
          }
        })
      );

      menu.append(
        new MenuItem({
          label: strings.copyLinkText(),
          click() {
            clipboard.writeText(params.linkText);
          }
        })
      );
    }

    if (params.selectionText.length) {
      menu.append(
        new MenuItem({
          label: strings.copy(),
          role: "copy",
          accelerator: "CommandOrControl+C"
        })
      );
    }

    if (params.mediaType === "image")
      menu.append(
        new MenuItem({
          id: "copy-image",
          label: strings.copyImage(),
          click() {
            globalThis.window?.webContents.copyImageAt(params.x, params.y);
          }
        })
      );

    if (params.isEditable) {
      menu.append(
        new MenuItem({
          label: strings.paste(),
          role: "paste",
          enabled: clipboard.readText("clipboard").length > 0,
          accelerator: "CommandOrControl+V"
        })
      );

      menu.append(
        new MenuItem({
          label:
            process.platform === "darwin"
              ? strings.pasteAndMatchStyle()
              : strings.pasteWithoutFormatting(),
          role: "pasteAndMatchStyle",
          enabled: clipboard.readText("clipboard").length > 0,
          accelerator:
            process.platform === "darwin"
              ? "Option+Shift+Command+V"
              : "Shift+CommandOrControl+V"
        })
      );

      menu.append(
        new MenuItem({
          type: "separator"
        })
      );
      menu.append(
        new MenuItem({
          label: strings.spellCheck(),
          role: "toggleSpellChecker"
        })
      );
    }

    if (menu.items.length > 0) menu.popup();
  });
}
export { setupMenu };
