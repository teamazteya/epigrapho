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

/** What the lexicon popover shows for one Strong number (A2 Fase 4). */
export type LexiconView = {
  lemma: string;
  transliteration: string;
  /** "G25", as a person writes it. */
  strong: string;
  lang: string;
  /** STEP's brief lexicon: English, and marked as such. */
  definitionEn: string;
  /** RV1909's commonest renderings, with how often. */
  usageEs: [word: string, count: number][];
  /** es-419 Palabras de Traducción entries for this number. */
  es419: { title: string; body: string }[];
};

let open: { element: HTMLElement; close: () => void } | undefined;

export function hideLexicon() {
  open?.close();
}

function add(parent: HTMLElement, tag: string, className: string, text = "") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

/**
 * Opens the lexicon for a word under `anchor`. It lives on the body, like the
 * verse preview, closes with Escape or a click outside, and takes the focus
 * so it can be read and left by keyboard.
 */
export function showLexicon(
  anchor: HTMLElement,
  load: Promise<LexiconView | undefined>,
  openConcordance?: (strong: string) => void
) {
  hideLexicon();
  const element = document.createElement("div");
  element.className = "lexicon-popover";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", strings.lexicon());
  element.tabIndex = -1;
  element.dataset.testId = "lexicon-popover";
  add(element, "p", "lexicon-status", strings.loading());
  document.body.append(element);

  // On the side of the word with more room, and never taller than that room,
  // so the box does not cover the word it explains (as the verse preview).
  const place = () => {
    const box = anchor.getBoundingClientRect();
    const gap = 6;
    const below = window.innerHeight - box.bottom - 2 * gap;
    const above = box.top - 2 * gap;
    element.style.maxHeight = "";
    const natural = element.getBoundingClientRect().height;
    const onBelow = natural <= below || below >= above;
    element.style.maxHeight = `${Math.max(120, Math.min(onBelow ? below : above, 480))}px`;
    const size = element.getBoundingClientRect();
    const top = onBelow
      ? box.bottom + gap
      : Math.max(gap, box.top - gap - size.height);
    element.style.top = `${top}px`;
    element.style.left = `${Math.min(
      Math.max(gap, box.left),
      Math.max(gap, window.innerWidth - size.width - gap)
    )}px`;
  };
  place();

  const onOutside = (event: PointerEvent) => {
    if (!element.contains(event.target as Node) && event.target !== anchor)
      close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close(true);
  };
  function close(refocus = false) {
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    element.remove();
    if (open?.element === element) open = undefined;
    if (refocus) anchor.focus();
  }
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  open = { element, close };

  load
    .then((entry) => {
      if (open?.element !== element) return;
      element.replaceChildren();
      if (!entry) {
        add(element, "p", "lexicon-status", strings.lexiconUnavailable());
        place();
        return;
      }
      const head = add(element, "div", "lexicon-head");
      const lemma = add(head, "span", "lexicon-lemma", entry.lemma);
      lemma.lang = entry.lang;
      add(head, "span", "lexicon-transliteration", entry.transliteration);
      add(head, "span", "lexicon-strong", entry.strong);

      const scroll = add(element, "div", "lexicon-scroll");
      if (entry.usageEs.length)
        add(
          scroll,
          "p",
          "lexicon-usage",
          strings.lexiconUsage(
            entry.usageEs.map(([word, count]) => `${word} (${count})`).join(", ")
          )
        );
      for (const { title, body } of entry.es419) {
        const section = add(scroll, "section", "lexicon-es419");
        section.lang = "es";
        add(section, "h4", "lexicon-label", title);
        add(section, "p", "lexicon-text", body);
      }
      const english = add(scroll, "section", "lexicon-english");
      add(english, "h4", "lexicon-label", strings.lexiconDefinitionEn());
      add(english, "p", "lexicon-text", entry.definitionEn).lang = "en";

      if (openConcordance) {
        const all = add(element, "button", "lexicon-concordance", strings.seeAllOccurrences());
        (all as HTMLButtonElement).type = "button";
        all.dataset.testId = "lexicon-concordance";
        all.addEventListener("click", () => {
          close();
          openConcordance(entry.strong);
        });
      }
      place();
      element.focus();
    })
    .catch((error) => {
      console.error("could not read the lexicon", error);
      if (open?.element !== element) return;
      element.replaceChildren();
      add(element, "p", "lexicon-status", strings.lexiconUnavailable());
    });
}
