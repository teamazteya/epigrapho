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

import { Mark, mergeAttributes } from "@tiptap/core";
import { MarkType } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

export type ScriptureReferenceAttributes = {
  /** Canonical USFM reference, e.g. "JHN.3.16". */
  ref: string;
  versification: string;
};

export type ScriptureMatch = ScriptureReferenceAttributes & {
  /** Offsets of the matched text inside the parsed string, [start, end). */
  indices: [number, number];
};

export type ScriptureReferenceOptions = {
  /**
   * Finds references in a block of plain text. Left undefined, the mark still
   * works but nothing is detected automatically.
   */
  parse?: (text: string) => ScriptureMatch[];
  /** Milliseconds of quiet typing before the block is parsed. */
  debounce: number;
};

const detectionKey = new PluginKey<number>("scriptureReferenceDetection");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    scriptureReference: {
      setScriptureReference: (
        attributes: ScriptureReferenceAttributes
      ) => ReturnType;
      unsetScriptureReference: () => ReturnType;
    };
  }
}

type ScriptureReferenceStorage = {
  timer: ReturnType<typeof setTimeout> | undefined;
};

export const ScriptureReference = Mark.create<
  ScriptureReferenceOptions,
  ScriptureReferenceStorage
>({
  name: "scriptureReference",

  addOptions() {
    return { parse: undefined, debounce: 400 };
  },

  // The mark decorates what the user typed; it never owns the text. Keeping it
  // non-inclusive means typing right after a reference does not extend it.
  inclusive: false,

  addAttributes() {
    return {
      ref: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-scripture-ref"),
        renderHTML: (attributes) =>
          attributes.ref ? { "data-scripture-ref": attributes.ref } : {}
      },
      versification: {
        // Matches CANONICAL_VERSIFICATION in @notesnook/scripture-parser.
        // Marks written before ADR 0004 carry "default", which named the same
        // numbering; the provider reads both.
        default: "eng",
        parseHTML: (element) =>
          element.getAttribute("data-versification") || "eng",
        renderHTML: (attributes) => ({
          "data-versification": attributes.versification
        })
      }
    };
  },

  // ponytail: a span with data-* attributes instead of a custom element, so the
  // mark survives DOMPurify (core/utils/html-parser.ts) with no allowlist entry.
  parseHTML() {
    return [{ tag: "span[data-scripture-ref]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "scripture-reference" }),
      0
    ];
  },

  addStorage() {
    // The timer lives on the editor, not on the view: Notesnook swaps the
    // EditorView while typing, and a view-scoped timer was cleared every time.
    return { timer: undefined };
  },

  onDestroy() {
    if (this.storage.timer) clearTimeout(this.storage.timer);
  },

  addProseMirrorPlugins() {
    const parse = this.options.parse;
    if (!parse) return [];

    const editor = this.editor;
    const storage = this.storage;
    const markType = this.type;
    const wait = this.options.debounce;
    // The plugin state is a counter bumped by our own transactions, so the
    // marks we apply never trigger another round of detection.
    return [
      new Plugin({
        key: detectionKey,
        state: {
          init: () => 0,
          apply: (tr, value) => (tr.getMeta(detectionKey) ? value + 1 : value)
        },
        view: () => ({
          update(view, previous) {
            if (view.state.doc.eq(previous.doc)) return;
            if (
              detectionKey.getState(view.state) !==
              detectionKey.getState(previous)
            )
              return;
            if (storage.timer) clearTimeout(storage.timer);
            storage.timer = setTimeout(() => {
              if (editor.isDestroyed) return;
              detect(editor.view, markType, parse);
            }, wait);
          }
        })
      })
    ];
  },

  addCommands() {
    return {
      setScriptureReference:
        (attributes) =>
        ({ commands }) =>
          commands.setMark(this.name, attributes),
      unsetScriptureReference:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name)
    };
  }
});

/** Re-marks the references of the block the cursor is in. */
function detect(
  view: EditorView,
  markType: MarkType,
  parse: (text: string) => ScriptureMatch[]
) {
  const { state } = view;
  const { $from } = state.selection;
  const block = $from.parent;
  if (!block.isTextblock || block.type.spec.code) return;

  const start = $from.start();
  const end = start + block.content.size;
  // textBetween with a placeholder for leaf nodes keeps the offsets the parser
  // reports lined up with document positions.
  const text = state.doc.textBetween(start, end, undefined, "￼");

  const tr = state.tr.removeMark(start, end, markType);
  for (const match of parse(text)) {
    tr.addMark(
      start + match.indices[0],
      start + match.indices[1],
      markType.create({
        ref: match.ref,
        versification: match.versification
      })
    );
  }
  if (!tr.steps.length) return;

  tr.setMeta(detectionKey, true);
  // ponytail: detection is not an edit the user made, so it stays out of undo.
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}
