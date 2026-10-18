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

import { test, expect, vi } from "vitest";
import { createEditor } from "../../../../test-utils/index.js";
import { ScriptureBlock } from "../scripture-block.js";
import { attachScriptureCopy } from "../copy.js";

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

test("numbered verses survive saving, reopening and copying without duplicate numbers", async () => {
  const make = (initialContent: string) =>
    createEditor({
      initialContent,
      extensions: {
        scriptureBlock: ScriptureBlock.configure({
          attributionOf: () => ATTRIBUTION
        })
      }
    }).editor;
  const editor = make("<p></p>");
  editor.commands.insertScriptureBlock({
    ref: "JHN.3.36-JHN.4.1",
    label: "Juan 3:36–4:1",
    translationId: "VBL",
    text: "[36] Primero <seguro>\n[1] Segundo",
    parallel: [{ translationId: "BSB", text: "[36] First\n[1] Second" }]
  });
  const html = editor.getHTML();
  expect(html).toContain('data-verse-number="36"');
  expect(html).toContain("&lt;seguro&gt;");
  const reopened = make(html);
  expect(reopened.state.doc.firstChild?.attrs.text).toBe(
    "[36] Primero <seguro>\n[1] Segundo"
  );
  expect(reopened.state.doc.firstChild?.attrs.parallel[0].text).toBe(
    "[36] First\n[1] Second"
  );
  const copy = vi.fn();
  const detach = attachScriptureCopy(reopened.view.dom, {
    copy,
    attributionOf: () => ATTRIBUTION,
    formatReference: () => "Juan 3:36–4:1"
  });
  (
    reopened.view.dom.querySelector(
      "[data-scripture-copy]"
    ) as HTMLButtonElement
  ).click();
  await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
  expect(copy.mock.calls[0][0]).toContain("[36] Primero <seguro>\n[1] Segundo");
  expect(copy.mock.calls[0][0]).toContain("[36] First\n[1] Second");
  detach();
  editor.destroy();
  reopened.destroy();
});

test("private editors automatically number old blocks and parallel columns", async () => {
  const resolve = vi.fn(async (_ref: string, translationId: string) => ({
    translationId,
    text: "[16] Actualizado"
  }));
  const { editor } = createEditor({
    initialContent:
      '<div data-scripture-block="true" data-scripture-ref="JHN.3.16" data-translation-id="VBL"><p class="scripture-block-text">Antiguo</p><div class="scripture-block-parallel" data-translation-id="BSB"><p class="scripture-block-text">Old</p></div></div>',
    extensions: { scriptureBlock: ScriptureBlock.configure({ resolve }) }
  });
  await vi.waitFor(() =>
    expect(editor.state.doc.firstChild?.attrs.text).toBe("[16] Actualizado")
  );
  expect(editor.state.doc.firstChild?.attrs.parallel[0].text).toBe(
    "[16] Actualizado"
  );
  expect(resolve).toHaveBeenCalledTimes(2);
  editor.destroy();
});

test("an unavailable brand translation never overwrites an old block with fallback text", async () => {
  const resolve = vi.fn(async () => ({
    translationId: "VBL",
    text: "[16] Sustituto",
    notice: "fallback"
  }));
  const { editor } = createEditor({
    initialContent:
      '<div data-scripture-block="true" data-scripture-ref="JHN.3.16" data-translation-id="NBLA"><p class="scripture-block-text">Texto guardado</p></div>',
    extensions: { scriptureBlock: ScriptureBlock.configure({ resolve }) }
  });
  await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
  await new Promise((done) => setTimeout(done, 0));
  expect(editor.state.doc.firstChild?.attrs.text).toBe("Texto guardado");
  editor.destroy();
});

test("a late refresh cannot restore a block the person deleted", async () => {
  let complete = (_verse: { text: string; translationId: string }) => {};
  const pending = new Promise<{ text: string; translationId: string }>(
    (resolve) => {
      complete = resolve;
    }
  );
  const { editor } = createEditor({
    initialContent:
      '<div data-scripture-block="true" data-scripture-ref="JHN.3.16" data-translation-id="VBL"><p class="scripture-block-text">Antiguo</p></div>',
    extensions: {
      scriptureBlock: ScriptureBlock.configure({ resolve: () => pending })
    }
  });
  editor.commands.setContent("<p>Mis palabras</p>");
  complete({ text: "[16] Tardío", translationId: "VBL" });
  await new Promise((done) => setTimeout(done, 0));
  expect(editor.state.doc.textContent).toBe("Mis palabras");
  editor.destroy();
});
