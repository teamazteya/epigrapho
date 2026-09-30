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

import { Node, mergeAttributes } from "@tiptap/core";
import { strings } from "@notesnook/intl";
import { showLexicon, type LexiconView } from "./lexicon-popover.js";

export type InterlinearAttributes = {
  /** Canonical reference, "JHN.3.16" or "JHN.3.16-JHN.3.18". */
  ref: string;
  /** The reference as the person read it when inserting, "Juan 3:16". */
  label?: string;
};

/** One original-language word, as the block shows it. */
export type InterlinearWord = {
  surface: string;
  transliteration: string;
  strong: string;
  morph: string;
  /** In the interface language: RV1909's word in Spanish, STEP's in English. */
  gloss: string;
  lang: string;
};

export type InterlinearData = {
  /** Old Testament: the words run right to left. */
  rtl: boolean;
  verses: { verse: string; words: InterlinearWord[] }[];
  /** The corpus credit shown at the foot. */
  credit: string;
};

export type InterlinearOptions = {
  /**
   * Reads the words of a reference. The data lives with the app (ADR-0009),
   * so it injects this; without it the block shows only its reference.
   */
  load?: (ref: string) => Promise<InterlinearData | undefined>;
  /** A word's lexicon entry, shown when it is clicked (A2 Fase 4). */
  lexicon?: (strong: string) => Promise<LexiconView | undefined>;
  /** "See all occurrences": opens the concordance for a Strong number. */
  openConcordance?: (strong: string) => void;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    interlinear: {
      insertInterlinear: (attributes: InterlinearAttributes) => ReturnType;
    };
  }
}

/** "G0025" reads as "G25", the way Strong numbers are written. */
export const shortStrong = (strong: string) =>
  strong.replace(/^([GHA])0+(\d)/, "$1$2");

/** The rows a person can hide, with the class that hides each. */
const TOGGLES = [
  { row: "transliteration", title: () => strings.transliteration() },
  { row: "morph", title: () => strings.morphology() }
] as const;

function renderWords(
  data: InterlinearData,
  { lexicon, openConcordance }: InterlinearOptions
) {
  const body = document.createElement("div");
  body.className = "interlinear-body";
  if (data.rtl) body.dir = "rtl";
  for (const { verse, words } of data.verses) {
    const number = document.createElement("span");
    number.className = "interlinear-verse";
    number.textContent = verse;
    body.append(number);
    for (const word of words) {
      const column = document.createElement(lexicon ? "button" : "span");
      column.className = "interlinear-word";
      if (column instanceof HTMLButtonElement && lexicon) {
        column.type = "button";
        column.setAttribute(
          "aria-label",
          `${word.surface}, ${shortStrong(word.strong)}, ${word.gloss}`
        );
        column.addEventListener("click", () =>
          showLexicon(column, lexicon(word.strong), openConcordance)
        );
      }
      const rows: [string, string, string?][] = [
        ["surface", word.surface, word.lang],
        ["transliteration", word.transliteration],
        ["strong", shortStrong(word.strong)],
        ["morph", word.morph],
        ["gloss", word.gloss || "—"]
      ];
      for (const [row, text, lang] of rows) {
        const cell = document.createElement("span");
        cell.className = `interlinear-${row}`;
        cell.textContent = text;
        if (lang) cell.lang = lang;
        // The rest of the column is Latin text inside a right-to-left block.
        else cell.dir = "ltr";
        column.append(cell);
      }
      body.append(column);
    }
  }
  return body;
}

export const Interlinear = Node.create<InterlinearOptions>({
  name: "interlinear",
  group: "block",
  // The words are generated from the pack every time it is shown: the note
  // keeps only the reference (A2, "la nota guarda solo la referencia").
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {};
  },

  addAttributes() {
    return {
      ref: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-interlinear-ref"),
        renderHTML: (attributes) =>
          attributes.ref ? { "data-interlinear-ref": attributes.ref } : {}
      },
      label: {
        default: null,
        parseHTML: (element) =>
          element.querySelector(".interlinear-reference")?.textContent || null,
        renderHTML: () => ({})
      }
    };
  },

  parseHTML() {
    return [{ tag: "div[data-interlinear-ref]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "interlinear" }),
      ["p", { class: "interlinear-reference" }, node.attrs.label || node.attrs.ref]
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      const attributes = mergeAttributes(HTMLAttributes, {
        class: "interlinear"
      });
      for (const [name, value] of Object.entries(attributes))
        if (value !== null && value !== undefined)
          dom.setAttribute(name, String(value));
      dom.contentEditable = "false";

      const header = document.createElement("div");
      header.className = "interlinear-header";
      const reference = document.createElement("p");
      reference.className = "interlinear-reference";
      reference.textContent = node.attrs.label || node.attrs.ref;
      header.append(reference);

      // Showing or hiding a row is how this person reads right now, not part
      // of the note, so it changes the view and never the document.
      for (const { row, title } of TOGGLES) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "interlinear-toggle";
        toggle.setAttribute("data-row", row);
        toggle.setAttribute("aria-pressed", "true");
        toggle.textContent = title();
        toggle.addEventListener("click", () => {
          const shown = toggle.getAttribute("aria-pressed") !== "true";
          toggle.setAttribute("aria-pressed", String(shown));
          dom.classList.toggle(`interlinear-hide-${row}`, !shown);
        });
        header.append(toggle);
      }

      const status = document.createElement("p");
      status.className = "interlinear-status";
      status.textContent = strings.loading();
      const credit = document.createElement("p");
      credit.className = "interlinear-credit";
      dom.append(header, status, credit);

      const { load } = this.options;
      if (load)
        load(node.attrs.ref)
          .then((data) => {
            if (!data?.verses.length) {
              status.textContent = strings.interlinearUnavailable();
              return;
            }
            status.replaceWith(renderWords(data, this.options));
            credit.textContent = data.credit;
          })
          .catch((error) => {
            console.error("could not read the interlinear", error);
            status.textContent = strings.interlinearUnavailable();
          });
      else status.textContent = strings.interlinearUnavailable();

      return {
        dom,
        // The toggles and words are the view's own; the editor must not treat
        // a click on them as an edit or a selection inside the block.
        stopEvent: (event) =>
          event.target instanceof HTMLElement &&
          !!event.target.closest("button"),
        ignoreMutation: () => true
      };
    };
  },

  addCommands() {
    return {
      insertInterlinear:
        (attributes) =>
        ({ commands }) =>
          // With a paragraph after it, so the cursor leaves the block and
          // the next insert or keystroke does not replace it.
          commands.insertContent([
            { type: this.name, attrs: attributes },
            { type: "paragraph" }
          ])
    };
  }
});
