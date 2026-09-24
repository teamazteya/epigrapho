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
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { strings } from "@notesnook/intl";
import { formatVerseForClipboard } from "./copy.js";

export type ScriptureBlockAttributes = {
  /** Canonical USFM reference, e.g. "JHN.3.16". */
  ref: string;
  /**
   * The reference as the person read it when the block was inserted, e.g.
   * "Juan 3:16". It is written into the block instead of being worked out
   * again on every render, so a later change of interface language leaves the
   * note exactly as it was.
   */
  label?: string;
  translationId: string;
  text: string;
};

export type ScriptureBlockOptions = {
  /**
   * The attribution line for a translation. This package must not depend on the
   * scripture packages, so the app injects the lookup; without it the block
   * credits the translation by its id alone.
   */
  attributionOf: (translationId: string) => string;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    scriptureBlock: {
      insertScriptureBlock: (
        attributes: ScriptureBlockAttributes
      ) => ReturnType;
    };
  }
}

export const ScriptureBlock = Node.create<ScriptureBlockOptions>({
  name: "scriptureBlock",
  group: "block",
  // The verse is not the user's prose: it is read from the pack and shown whole,
  // so the block holds no editable content.
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { attributionOf: (translationId: string) => translationId };
  },

  addAttributes() {
    return {
      ref: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-scripture-ref"),
        renderHTML: (attributes) =>
          attributes.ref ? { "data-scripture-ref": attributes.ref } : {}
      },
      label: {
        default: null,
        parseHTML: (element) =>
          element.querySelector(".scripture-block-reference")?.textContent ||
          null,
        // Like the verse, it is the block's own markup and not an attribute:
        // an exported note has to stay readable outside the editor.
        renderHTML: () => ({})
      },
      translationId: {
        default: "VBL",
        parseHTML: (element) =>
          element.getAttribute("data-translation-id") || "VBL",
        renderHTML: (attributes) => ({
          "data-translation-id": attributes.translationId
        })
      },
      text: {
        default: "",
        parseHTML: (element) =>
          element.querySelector(".scripture-block-text")?.textContent || "",
        // The text is rendered as the block's own markup, so it does not also
        // travel as an attribute: a note stays readable outside the editor.
        renderHTML: () => ({})
      }
    };
  },

  parseHTML() {
    return [{ tag: "div[data-scripture-block]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Blocks written before this line existed have no label; the canonical
    // reference is what they can show, and it is still a reference.
    const label = node.attrs.label || node.attrs.ref;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        // A value, not an empty string: mergeAttributes drops empty ones.
        "data-scripture-block": "true",
        class: "scripture-block"
      }),
      ["p", { class: "scripture-block-reference" }, label],
      ["p", { class: "scripture-block-text" }, node.attrs.text],
      [
        "p",
        { class: "scripture-block-attribution" },
        this.options.attributionOf(node.attrs.translationId)
      ]
    ];
  },

  /**
   * The same block, plus the button that copies it.
   *
   * The button is drawn here and not in `renderHTML` on purpose. What
   * `renderHTML` returns is what gets stored in the note and what leaves in an
   * export, and the button's label is a piece of interface written in the
   * language of the moment: keeping it there put "Copiar versículo" inside the
   * note, changed the note when the interface changed language, and printed it
   * in the middle of an exported verse. Drawn from here it is only ever on
   * screen.
   */
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      const attributes = mergeAttributes(HTMLAttributes, {
        "data-scripture-block": "true",
        class: "scripture-block"
      });
      for (const [name, value] of Object.entries(attributes))
        if (value !== null && value !== undefined)
          dom.setAttribute(name, String(value));

      const label = node.attrs.label || node.attrs.ref;
      const reference = document.createElement("p");
      reference.className = "scripture-block-reference";
      reference.textContent = label;

      const text = document.createElement("p");
      text.className = "scripture-block-text";
      text.textContent = node.attrs.text;

      const attribution = document.createElement("p");
      attribution.className = "scripture-block-attribution";
      attribution.textContent = this.options.attributionOf(
        node.attrs.translationId
      );

      // Copying is a button, not the whole block: a click meant to select a
      // block should not quietly take over the clipboard, and a control has to
      // say what it does and which passage it does it to.
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scripture-block-copy";
      button.contentEditable = "false";
      button.setAttribute("data-scripture-copy", "true");
      button.setAttribute("aria-label", `${strings.copyVerse()}: ${label}`);
      button.textContent = strings.copyVerse();

      dom.append(reference, text, attribution, button);
      return { dom };
    };
  },

  extendNodeSchema(extension) {
    if (extension.name !== "scriptureBlock") return {};
    const { attributionOf } = extension.options as ScriptureBlockOptions;
    return {
      // The block holds no text children, so the clipboard finds nothing in it
      // and copying one used to yield an empty line. This is the hook
      // Notesnook's own serializer looks for (extensions/clipboard).
      toText: ({ node }: { node: ProseMirrorNode }) =>
        formatVerseForClipboard(
          node.attrs.ref,
          node.attrs.text,
          node.attrs.translationId,
          {
            // The label is how this person read the reference when they wrote
            // it, which beats working the name out again at copy time.
            formatReference: () => node.attrs.label || node.attrs.ref,
            attributionOf
          }
        )
    };
  },

  addCommands() {
    return {
      insertScriptureBlock:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes })
    };
  }
});
