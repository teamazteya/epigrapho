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

/** What a submit answers: the result, or why the text typed will not do. */
export type Answer<T> = { value: T } | { error: string };

/**
 * One line of text asked for in a `<dialog>` (Fase 8, M1 Fase 4).
 *
 * ponytail: a `<dialog>` is a browser on its own — modal, focus-trapped,
 * closed by the back gesture — instead of a dialog component and the state
 * that would come with it. The app around this page has its own dialogs, but
 * reaching them means a message, an answer and a timeout for a question that
 * is answered right here. How it looks is in the editor's styles.css.
 *
 * `id` names the dialog for tests: `<id>`, `<id>-input`, `<id>-confirm`…
 */
export function ask<T>(options: {
  id: string;
  title: string;
  description: string;
  submit: (typed: string) => Promise<Answer<T>>;
}): Promise<T | undefined> {
  const { id } = options;
  const dialog = document.createElement("dialog");
  dialog.className = "scripture-prompt";
  dialog.dataset.testId = id;

  const title = document.createElement("h3");
  title.id = `${id}-title`;
  title.className = "scripture-prompt-title";
  title.textContent = options.title;
  // A dialog announces itself by its heading, so it has to point at one.
  dialog.setAttribute("aria-labelledby", title.id);

  const description = document.createElement("p");
  description.id = `${id}-desc`;
  description.className = "scripture-prompt-description";
  description.textContent = options.description;

  const input = document.createElement("input");
  input.className = "scripture-prompt-input";
  input.dataset.testId = `${id}-input`;
  // Without these the field is announced as "edit text, blank": the heading
  // above it is not its name and the line under it is not its hint.
  input.setAttribute("aria-label", options.title);
  input.setAttribute("aria-describedby", description.id);

  const error = document.createElement("p");
  error.className = "scripture-prompt-error";
  error.dataset.testId = `${id}-error`;
  // Read out when it changes: a mistake typed is the one moment this dialog
  // has something to say, and it says it while the field has focus.
  error.setAttribute("role", "alert");

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "scripture-prompt-button";
  cancel.dataset.testId = `${id}-cancel`;
  cancel.textContent = strings.cancel();

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "scripture-prompt-button";
  confirm.dataset.primary = "true";
  confirm.dataset.testId = `${id}-confirm`;
  confirm.textContent = strings.insert();

  const buttons = document.createElement("div");
  buttons.className = "scripture-prompt-actions";
  buttons.append(cancel, confirm);

  dialog.append(title, description, input, error, buttons);
  document.body.append(dialog);

  /** Shows a problem with what was typed, and marks the field as holding it. */
  const fail = (message: string) => {
    error.textContent = message;
    input.setAttribute("aria-invalid", "true");
    confirm.disabled = false;
    input.focus();
  };

  return new Promise<T | undefined>((resolve) => {
    const finish = (result?: T) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };

    const submit = async () => {
      const typed = input.value.trim();
      // An empty field pressed Insert on purpose; saying nothing back reads as
      // a broken button.
      if (!typed) return fail(options.description);
      confirm.disabled = true;
      error.textContent = "";
      input.removeAttribute("aria-invalid");
      const answer = await options.submit(typed);
      if ("error" in answer) fail(answer.error);
      else finish(answer.value);
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
