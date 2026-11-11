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

import { describe, expect, test } from "vitest";
import { undoDepth } from "prosemirror-history";
import { createEditor } from "../../../../test-utils/index.js";
import { ScriptureReference } from "../scripture-reference.js";
import { ScriptureInlinePreview } from "../inline-preview.js";

const NOTE = `<p>Lee <span data-scripture-ref="JHN.3.16">Juan 3:16</span> hoy.</p><p>Después.</p>`;

function setup() {
  const { editor } = createEditor({
    element: document.createElement("div"),
    initialContent: NOTE,
    extensions: {
      scriptureReference: ScriptureReference,
      scriptureInlinePreview: ScriptureInlinePreview.configure({
        preview: {
          translation: () => "VBL",
          resolve: async () => ({
            text: "Porque de tal manera…",
            translationId: "VBL"
          }),
          attributionOf: (id) => `${id} credit`
        }
      })
    }
  });
  const view = editor.view;
  /** A tap on the reference, as ProseMirror reports it. */
  const tap = () => {
    const span = view.dom.querySelector("span[data-scripture-ref]")!;
    const pos = view.posAtDOM(span.firstChild!, 3);
    const event = new MouseEvent("click");
    Object.defineProperty(event, "target", { value: span });
    view.someProp("handleClick", (handle) => handle(view, pos, event));
  };
  const panel = () => view.dom.querySelector(".scripture-inline-preview");
  return { editor, tap, panel };
}

describe("scripture inline preview", () => {
  test("a tap opens the passage under the block, another closes it", async () => {
    const { editor, tap, panel } = setup();
    const before = editor.getHTML();

    tap();
    expect(panel()).not.toBeNull();
    // Under the paragraph that holds the reference, not inside it.
    expect(panel()?.previousElementSibling?.tagName).toBe("P");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel()?.textContent).toContain("Porque de tal manera");

    // Not part of the note, and nothing undo would bring back.
    expect(editor.getHTML()).toBe(before);
    expect(undoDepth(editor.state)).toBe(0);

    tap();
    expect(panel()).toBeNull();
  });

  test("deleting the reference closes it", () => {
    const { editor, tap, panel } = setup();
    tap();
    expect(panel()).not.toBeNull();
    editor.commands.setContent("<p>Otra nota.</p>");
    expect(panel()).toBeNull();
  });
});
