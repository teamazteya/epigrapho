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

import { describe, expect, test, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { handleMouseDown } from "../input.js";

const schema = new Schema({ nodes: { doc: { content: "text*" }, text: {} } });

/** Just enough of a view for a mousedown in a cell to reach the drag tracking. */
function viewWithCell() {
  const dom = document.createElement("div");
  const cell = document.createElement("td");
  dom.append(cell);
  const root = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const view = {
    dom,
    root,
    state: EditorState.create({ schema })
  } as unknown as EditorView;
  return { view, cell, root };
}

function mousedown(target: HTMLElement, button: number) {
  const event = new MouseEvent("mousedown", { button, bubbles: true });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

const tracked = (root: { addEventListener: ReturnType<typeof vi.fn> }) =>
  root.addEventListener.mock.calls.map(([type]) => type);

describe("table mousedown", () => {
  test("a right click in a cell does not start a cell drag", () => {
    const { view, cell, root } = viewWithCell();
    handleMouseDown(view, mousedown(cell, 2));
    expect(tracked(root)).not.toContain("mousemove");
  });

  test("a left click in a cell still starts one", () => {
    const { view, cell, root } = viewWithCell();
    handleMouseDown(view, mousedown(cell, 0));
    expect(tracked(root)).toContain("mousemove");
  });
});
