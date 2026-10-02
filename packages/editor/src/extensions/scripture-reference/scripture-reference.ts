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
import { MarkType, Node as ProseMirrorNode } from "@tiptap/pm/model";
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

/**
 * Ranges ([from, to] pairs, flattened), in the current document, of what
 * changed since the last detection. Detection used to read only the block the cursor was in
 * when the wait ended, so a reference typed right before Enter (or before
 * clicking elsewhere) was never marked: the cursor had already left it.
 */
type DetectionState = { dirty: number[]; round: number };

const detectionKey = new PluginKey<DetectionState>(
  "scriptureReferenceDetection"
);

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
    // Our own transactions empty the list and bump the round, so the marks we
    // apply never trigger another round of detection.
    return [
      new Plugin<DetectionState>({
        key: detectionKey,
        state: {
          init: () => ({ dirty: [], round: 0 }),
          apply: (tr, value) => {
            if (tr.getMeta(detectionKey))
              return { dirty: [], round: value.round + 1 };
            if (!tr.docChanged) return value;
            const dirty = value.dirty.map((pos) => tr.mapping.map(pos));
            tr.mapping.maps.forEach((map, index) => {
              const after = tr.mapping.slice(index + 1);
              map.forEach((_from, _to, start, end) =>
                dirty.push(after.map(start), after.map(end))
              );
            });
            return { dirty, round: value.round };
          }
        },
        view: () => ({
          update(view, previous) {
            if (view.state.doc.eq(previous.doc)) return;
            if (
              detectionKey.getState(view.state)?.round !==
              detectionKey.getState(previous)?.round
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

/** Re-marks the references of every block changed since the last time. */
function detect(
  view: EditorView,
  markType: MarkType,
  parse: (text: string) => ScriptureMatch[]
) {
  const { state } = view;
  const dirty = detectionKey.getState(state)?.dirty ?? [];
  const size = state.doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
  const starts = new Set<number>();
  const add = (node: ProseMirrorNode, start: number) => {
    if (node.isTextblock && !node.type.spec.code) starts.add(start);
  };
  for (let i = 0; i < dirty.length; i += 2) {
    const [from, to] = [clamp(dirty[i]), clamp(dirty[i + 1])].sort(
      (a, b) => a - b
    );
    // The blocks the change touches at either end, and every one inside it.
    for (const pos of [from, to]) {
      const $pos = state.doc.resolve(pos);
      add($pos.parent, $pos.start());
    }
    state.doc.nodesBetween(from, to, (node, pos) => {
      add(node, pos + 1);
      return !node.isTextblock;
    });
  }
  // Notesnook swaps the EditorView now and then (a paste can do it), and a new
  // view starts with an empty list; the cursor's block is the old behaviour.
  const { $from } = state.selection;
  add($from.parent, $from.start());

  // Marks never change positions, so every start stays valid in this one
  // transaction.
  const tr = state.tr;
  for (const start of starts) {
    const end = start + state.doc.resolve(start).parent.content.size;
    // textBetween with a placeholder for leaf nodes keeps the offsets the
    // parser reports lined up with document positions.
    const text = state.doc.textBetween(start, end, undefined, "￼");
    tr.removeMark(start, end, markType);
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
  }

  // Re-marking a block that is already right (text that just arrived from
  // another computer, say) must not count as an edit: that would save the
  // note again and overwrite its history. Only the emptied list is kept then.
  const out = tr.doc.eq(state.doc) ? state.tr : tr;
  out.setMeta(detectionKey, true);
  // ponytail: detection is not an edit the user made, so it stays out of undo.
  out.setMeta("addToHistory", false);
  view.dispatch(out);
}
