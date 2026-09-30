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

export type DictionaryEntryAttributes = {
  /** The entry's id in the dictionary packs, "EAS:bethel" or "TW:kt/grace". */
  id: string;
  /** Its term, kept so the note reads even where the packs are missing. */
  label?: string;
};

/** An entry, as the block shows it. */
export type DictionaryEntryView = {
  term: string;
  /** The work it comes from, "Easton's Bible Dictionary (1897)". */
  sourceName: string;
  body: string;
  /** BCP 47 of the body: "en" or "es". */
  lang: string;
  credit: string;
};

export type DictionaryEntryOptions = {
  /** Reads an entry; the dictionaries live with the app (A2 Fase 6). */
  load?: (id: string) => Promise<DictionaryEntryView | undefined>;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dictionaryEntry: {
      insertDictionaryEntry: (
        attributes: DictionaryEntryAttributes
      ) => ReturnType;
    };
  }
}

export const DictionaryEntry = Node.create<DictionaryEntryOptions>({
  name: "dictionaryEntry",
  group: "block",
  // Like the interlinear: the note keeps the id, the words come from the pack.
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {};
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-dictionary-entry"),
        renderHTML: (attributes) =>
          attributes.id ? { "data-dictionary-entry": attributes.id } : {}
      },
      label: {
        default: null,
        parseHTML: (element) =>
          element.querySelector(".dictionary-entry-term")?.textContent || null,
        renderHTML: () => ({})
      }
    };
  },

  parseHTML() {
    return [{ tag: "div[data-dictionary-entry]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "dictionary-entry" }),
      [
        "p",
        { class: "dictionary-entry-term" },
        node.attrs.label || node.attrs.id
      ]
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      const attributes = mergeAttributes(HTMLAttributes, {
        class: "dictionary-entry"
      });
      for (const [name, value] of Object.entries(attributes))
        if (value !== null && value !== undefined)
          dom.setAttribute(name, String(value));
      dom.contentEditable = "false";

      const term = document.createElement("p");
      term.className = "dictionary-entry-term";
      term.textContent = node.attrs.label || node.attrs.id;
      const source = document.createElement("p");
      source.className = "dictionary-entry-source";
      const body = document.createElement("p");
      body.className = "dictionary-entry-body";
      body.textContent = strings.loading();
      const credit = document.createElement("p");
      credit.className = "dictionary-entry-credit";
      dom.append(term, source, body, credit);

      const { load } = this.options;
      (load?.(node.attrs.id) ?? Promise.resolve(undefined))
        .then((entry) => {
          if (!entry) {
            body.textContent = strings.dictionaryEntryUnavailable();
            return;
          }
          term.textContent = entry.term;
          source.textContent = entry.sourceName;
          body.textContent = entry.body;
          body.lang = entry.lang;
          credit.textContent = entry.credit;
        })
        .catch((error) => {
          console.error("could not read the dictionary entry", error);
          body.textContent = strings.dictionaryEntryUnavailable();
        });

      return { dom, ignoreMutation: () => true };
    };
  },

  addCommands() {
    return {
      insertDictionaryEntry:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: attributes },
            { type: "paragraph" }
          ])
    };
  }
});
