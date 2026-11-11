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
import { Extension } from "@tiptap/core";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { fillScripturePreview, ScripturePopoverOptions } from "./popover.js";

/**
 * Where the open panel's reference starts, or null. Only a position: the
 * panel is a decoration, so it is never in the note, never synced and never
 * something undo can bring back.
 */
type PanelState = { at: number | null; opened: number };

const panelKey = new PluginKey<PanelState>("scriptureInlinePreview");
const MARK = "scriptureReference";

export type ScriptureInlinePreviewOptions = {
  preview?: ScripturePopoverOptions;
};

/** The reference mark at `pos`, if the text there carries one. */
function referenceAt(state: EditorState, pos: number) {
  if (pos < 0 || pos >= state.doc.content.size) return undefined;
  const node = state.doc.nodeAt(pos);
  return node?.isText
    ? node.marks.find((mark) => mark.type.name === MARK)
    : undefined;
}

/** Where a tapped reference starts, walking back over the text it marks. */
function startOf(state: EditorState, tapped: number) {
  // A tap on the right half of the last letter lands just past the mark.
  const pos = referenceAt(state, tapped) ? tapped : tapped - 1;
  const ref = referenceAt(state, pos)?.attrs.ref;
  if (!ref) return undefined;
  const $pos = state.doc.resolve(pos);
  let start = $pos.start();
  $pos.parent.forEach((child, offset) => {
    const from = $pos.start() + offset;
    if (from > pos) return;
    const mark = child.marks.find((each) => each.type.name === MARK);
    if (!mark || mark.attrs.ref !== ref) start = from + child.nodeSize;
  });
  return start;
}

function setPanel(view: EditorView, at: number | null) {
  view.dispatch(
    view.state.tr
      .setMeta(panelKey, at)
      // Opening a preview is not an edit.
      .setMeta("addToHistory", false)
  );
}

function panelElement(
  view: EditorView,
  at: number,
  options: ScripturePopoverOptions,
  opened: number
) {
  const element = document.createElement("div");
  element.className = "scripture-inline-preview";
  element.dataset.testId = "scripture-inline-preview";
  element.contentEditable = "false";
  element.setAttribute("role", "region");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "scripture-inline-preview-close";
  close.textContent = strings.close();
  close.addEventListener("click", () => setPanel(view, null));

  // The fill needs the reference's own element ("See also" puts its
  // reference right after it), which is only certain to be drawn once the
  // update that asked for this panel is done.
  queueMicrotask(() => {
    const current = () => panelKey.getState(view.state)?.opened === opened;
    if (!current()) return;
    const { node } = view.domAtPos(at + 1);
    const target = (
      node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
    )?.closest?.("span[data-scripture-ref]") as HTMLElement | null;
    if (!target) return;
    element.dataset.scriptureRef = target.dataset.scriptureRef;
    element.setAttribute("aria-label", target.textContent ?? "");
    void fillScripturePreview(element, target, options, {
      current,
      resized: () => undefined,
      inserted: () => undefined
    });
    element.append(close);
  });
  return element;
}

/**
 * The phone's verse preview (A6). A floating box over a note closed the
 * moment a finger moved inside it, so on a phone the passage opens in the
 * note itself, under the block holding the reference, and is read by
 * scrolling the note. A tap on the reference opens it; another closes it.
 */
export const ScriptureInlinePreview =
  Extension.create<ScriptureInlinePreviewOptions>({
    name: "scriptureInlinePreview",

    addOptions() {
      return { preview: undefined };
    },

    addProseMirrorPlugins() {
      const options = this.options.preview;
      if (!options) return [];
      return [
        new Plugin<PanelState>({
          key: panelKey,
          state: {
            init: () => ({ at: null, opened: 0 }),
            apply(tr, value, _old, state) {
              const asked = tr.getMeta(panelKey) as number | null | undefined;
              if (asked !== undefined)
                return { at: asked, opened: value.opened + 1 };
              if (value.at === null || !tr.docChanged) return value;
              // Swapping in another note replaces the whole document; editing
              // the reference away removes its mark. Either closes the panel.
              const mapped = tr.mapping.mapResult(value.at, 1);
              if (mapped.deleted || !referenceAt(state, mapped.pos))
                return { at: null, opened: value.opened };
              return { at: mapped.pos, opened: value.opened };
            }
          },
          props: {
            decorations(state) {
              const { at, opened } = panelKey.getState(state) ?? {};
              if (at == null || opened == null) return null;
              const $at = state.doc.resolve(at);
              // Under the block, inside whatever holds it: a list item, a
              // table cell.
              const below = $at.after($at.depth);
              return DecorationSet.create(state.doc, [
                Decoration.widget(
                  below,
                  (view) => panelElement(view, at, options, opened),
                  {
                    key: `scripture-inline-preview-${opened}`,
                    side: -1,
                    ignoreSelection: true,
                    stopEvent: () => true
                  }
                )
              ]);
            },
            handleClick(view, pos, event) {
              const tapped = (event.target as Element | null)?.closest?.(
                "span[data-scripture-ref]"
              );
              if (!tapped) return false;
              const start = startOf(view.state, pos);
              if (start === undefined) return false;
              const { at } = panelKey.getState(view.state) ?? {};
              setPanel(view, at === start ? null : start);
              // The caret still goes where the finger landed.
              return false;
            }
          }
        })
      ];
    }
  });
