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

import { test, expect } from "vitest";
import { createEditor } from "../../../../test-utils/index.js";
import { ScriptureBlock } from "../scripture-block.js";

const ATTRIBUTION = "VBL — CC BY-SA 4.0";

function block() {
  const { editor } = createEditor({
    initialContent: "<p></p>",
    extensions: {
      scriptureBlock: ScriptureBlock.configure({
        attributionOf: () => ATTRIBUTION
      })
    }
  });
  return {
    spec: editor.schema.nodes.scriptureBlock.spec as {
      toText?: (props: { node: unknown }) => string;
    },
    node: editor.schema.nodes.scriptureBlock.create({
      ref: "JHN.3.16",
      label: "Juan 3:16",
      translationId: "VBL",
      text: "Porque Dios amó al mundo"
    })
  };
}

// The block holds no text children, so without this hook the clipboard finds
// nothing in it and copying a verse yields an empty line.
test("copying a scripture block carries the verse, the reference and the credit", () => {
  const { spec, node } = block();
  expect(spec.toText).toBeTypeOf("function");
  expect(spec.toText?.({ node })).toBe(
    `«Porque Dios amó al mundo» — Juan 3:16 (VBL)\n${ATTRIBUTION}`
  );
});

// Blocks written before the label existed still have to name their passage.
test("a block with no label falls back to the canonical reference", () => {
  const { editor } = createEditor({
    initialContent: "<p></p>",
    extensions: {
      scriptureBlock: ScriptureBlock.configure({
        attributionOf: () => ATTRIBUTION
      })
    }
  });
  const spec = editor.schema.nodes.scriptureBlock.spec as {
    toText?: (props: { node: unknown }) => string;
  };
  const node = editor.schema.nodes.scriptureBlock.create({
    ref: "JHN.3.16",
    translationId: "VBL",
    text: "Porque Dios amó al mundo"
  });
  expect(spec.toText?.({ node })).toBe(
    `«Porque Dios amó al mundo» — JHN.3.16 (VBL)\n${ATTRIBUTION}`
  );
});
