/*
This file is part of the Notesnook project (https://notesnook.com/)

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

import { expect, test } from "vitest";
import {
  buildStudyDocument,
  studyDocumentHtml,
  studyDocumentDocx
} from "../study-document.js";
import { sanitizeHtml } from "../html-parser.js";
import { Tiptap } from "../../content-types/tiptap.js";
import * as docx from "docx";

const verseHtml =
  '<p class="scripture-block-text"><span data-verse-line="true"><sup data-verse-number="36">36</sup> Primero</span><span data-verse-line="true"><sup data-verse-number="1">1</sup> Segundo</span></p>';
const html = `<div data-scripture-block="true" data-translation-id="VBL"><p class="scripture-block-reference">Juan 3:36–4:1</p>${verseHtml}<div class="scripture-block-parallel" data-translation-id="BSB">${verseHtml}</div></div><p><span class="scripture-reference" data-scripture-ref="JHN.3.16">Juan 3:16</span></p>`;

test("sanitizing and plain exports preserve real verse numbers and line breaks", () => {
  const sanitized = sanitizeHtml(html);
  expect(sanitized).toContain('data-verse-number="36"');
  const content = new Tiptap(sanitized);
  expect(content.toTXT()).toMatch(/\[36\] Primero\s+\[1\] Segundo/);
  expect(content.toMD()).toMatch(/\[36\] Primero[\s\S]+\[1\] Segundo/);
});

test("PDF HTML and Word keep superscripts for blocks, parallel columns and reference notes", async () => {
  const document = await buildStudyDocument(sanitizeHtml(html), {
    title: "Estudio",
    author: "Ana",
    locale: "es-MX",
    preferred: "VBL",
    resolveVerse: async () => ({
      text: "[16] Texto de nota",
      translationId: "VBL"
    }),
    attributionOf: (id) => id,
    translationName: (id) => id
  });
  expect(document).toBeDefined();
  if (!document) return;
  const block = document.blocks.find((block) => block.type === "scripture");
  expect(
    block?.type === "scripture" && block.columns.map((column) => column.text)
  ).toEqual(["[36] Primero\n[1] Segundo", "[36] Primero\n[1] Segundo"]);
  const rendered = studyDocumentHtml(document);
  expect(rendered).toContain(
    '<sup class="verse-number">36</sup> Primero<br><sup class="verse-number">1</sup> Segundo'
  );
  expect(rendered).toContain(
    '<sup class="verse-number">16</sup> Texto de nota'
  );
  const base64 = await studyDocumentDocx(document, docx, "base64");
  // Word packages are ZIPs; inspect document and footnote XML as shipped.
  const { default: JSZip } = await import("jszip");
  const files = await JSZip.loadAsync(base64, { base64: true });
  const body = await files.file("word/document.xml")!.async("string");
  const notes = await files.file("word/footnotes.xml")!.async("string");
  expect(body).toContain('w:val="superscript"');
  expect(body).toContain(">36</w:t>");
  expect(notes).toContain('w:val="superscript"');
  expect(notes).toContain(">16</w:t>");
}, 15000);
