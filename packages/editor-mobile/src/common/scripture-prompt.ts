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

import { strings } from "@notesnook/intl";
import { formatRef, parseReferences } from "@notesnook/scripture-parser";
import { formatReference, getTranslation, resolveVerse } from "./scripture";

export type ScriptureToInsert = {
  ref: string;
  label: string;
  translationId: string;
  text: string;
};

/**
 * Asks for a reference and comes back with the verse to insert, or nothing if
 * the person changed their mind (Fase 8).
 *
 * ponytail: this is a `<dialog>`, which is a browser on its own — modal,
 * focus-trapped, closed by the back gesture — instead of a dialog component
 * and the state that would come with it. The app around this page has its own
 * dialogs, but reaching them means a message, an answer and a timeout for a
 * question that is answered right here.
 */
export function askForScripture(): Promise<ScriptureToInsert | undefined> {
  // How any of this looks is in the editor's styles.css, which this page
  // already loads, next to the rules for the block and the preview.
  const dialog = document.createElement("dialog");
  dialog.className = "scripture-prompt";
  dialog.dataset.testId = "scripture-prompt";

  const title = document.createElement("h3");
  title.id = "scripture-prompt-title";
  title.className = "scripture-prompt-title";
  title.textContent = strings.insertScripture();
  // A dialog announces itself by its heading, so it has to point at one.
  dialog.setAttribute("aria-labelledby", title.id);

  const description = document.createElement("p");
  description.id = "scripture-prompt-desc";
  description.className = "scripture-prompt-description";
  description.textContent = strings.scripturePromptDesc();

  const input = document.createElement("input");
  input.className = "scripture-prompt-input";
  input.dataset.testId = "scripture-prompt-input";
  // Without these the field is announced as "edit text, blank": the heading
  // above it is not its name and the line under it is not its hint.
  input.setAttribute("aria-label", strings.insertScripture());
  input.setAttribute("aria-describedby", description.id);

  const error = document.createElement("p");
  error.className = "scripture-prompt-error";
  error.dataset.testId = "scripture-prompt-error";
  // Read out when it changes: a reference typed wrong is the one moment this
  // dialog has something to say, and it says it while the field has focus.
  error.setAttribute("role", "alert");

  /** Shows a problem with what was typed, and marks the field as holding it. */
  const fail = (message: string) => {
    error.textContent = message;
    input.setAttribute("aria-invalid", "true");
    confirm.disabled = false;
    input.focus();
  };

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "scripture-prompt-button";
  cancel.dataset.testId = "scripture-prompt-cancel";
  cancel.textContent = strings.cancel();

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "scripture-prompt-button";
  confirm.dataset.primary = "true";
  confirm.dataset.testId = "scripture-prompt-confirm";
  confirm.textContent = strings.insert();

  const buttons = document.createElement("div");
  buttons.className = "scripture-prompt-actions";
  buttons.append(cancel, confirm);

  dialog.append(title, description, input, error, buttons);
  document.body.append(dialog);

  return new Promise<ScriptureToInsert | undefined>((resolve) => {
    const finish = (result?: ScriptureToInsert) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };

    const submit = async () => {
      const typed = input.value.trim();
      // An empty field pressed Insert on purpose; saying nothing back reads as
      // a broken button.
      if (!typed) return fail(strings.scripturePromptDesc());
      confirm.disabled = true;
      error.textContent = "";
      input.removeAttribute("aria-invalid");

      // The parser reads every language it knows, so a person with the
      // interface in English can still type "Juan 3:16" here.
      const [reference] = parseReferences(typed);
      if (!reference) return fail(strings.scriptureNotRecognized(typed));

      const asked = getTranslation();
      const ref = formatRef(reference);
      try {
        const verse = await resolveVerse(ref, asked);
        if (!verse.text) return fail(strings.scriptureNoTextFor(asked, typed));
        // The block records the translation that actually served the words, so
        // its attribution stays true even when a substitute was used.
        finish({
          ref,
          label: formatReference(ref),
          translationId: verse.translationId,
          text: verse.text
        });
      } catch (failure) {
        // A pack that will not open used to leave the button dead and the
        // dialog open with nothing said.
        console.error("could not read the verse", failure);
        fail(strings.scriptureLookupFailed());
      }
    };

    cancel.addEventListener("click", () => finish());
    confirm.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void submit();
    });
    // The back gesture and the escape key close a dialog on their own.
    dialog.addEventListener("cancel", () => finish());

    dialog.showModal();
    input.focus();
  });
}
