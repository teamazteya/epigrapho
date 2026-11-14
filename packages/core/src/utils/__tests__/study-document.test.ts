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
  studyDocumentDocx,
  studyPdfFonts
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
  // The PDF carries its three faces, so it prints the same offline anywhere.
  const withFonts = studyDocumentHtml(document, await studyPdfFonts());
  for (const family of [
    "Source Sans 3",
    "Source Serif 4",
    "Cormorant Garamond"
  ])
    expect(withFonts).toMatch(
      new RegExp(
        `font-family:"${family}";[^}]+src:url\\(data:font/woff2;base64,`
      )
    );
  expect(withFonts).not.toMatch(/"Inter"/);
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

// A7: section titles, as the editor writes them into a block.
const headedText =
  '<p class="scripture-block-text"><span data-verse-heading="s1" style="display:block;font-weight:600">El amor de Dios</span><span data-verse-heading="d" style="display:block;font-style:italic">Un Salmo.</span><span data-verse-line="true"><sup data-verse-number="16">16</sup> Porque</span></p>';
const headedHtml = `<div data-scripture-block="true" data-translation-id="VBL"><p class="scripture-block-reference">Juan 3:16</p>${headedText}<p class="scripture-block-attribution">VBL · Títulos: PdDpt</p><div class="scripture-block-parallel" data-translation-id="BSB">${headedText}</div></div>`;

test("plain exports put each heading on its own line, in bold or italics, never as #", () => {
  const content = new Tiptap(sanitizeHtml(headedHtml));
  const txt = content.toTXT();
  expect(txt).toMatch(/El amor de Dios\s*\n\s*Un Salmo\.\s*\n\s*\[16\] Porque/);
  const md = content.toMD();
  // The block stays inline HTML in Markdown, as it did before A7.
  expect(md).toMatch(
    /<strong>El amor de Dios<\/strong>|\*\*El amor de Dios\*\*/
  );
  expect(md).toMatch(/<em>Un Salmo\.<\/em>|\*Un Salmo\.\*/);
  expect(md).not.toMatch(/^#/m);
  for (const out of [txt, md]) expect(out).not.toContain("[§");
});

test("Word and PDF style the headings without Word heading styles, and credit them", async () => {
  const document = await buildStudyDocument(sanitizeHtml(headedHtml), {
    title: "Estudio",
    author: "",
    locale: "es-MX",
    preferred: "VBL",
    resolveVerse: async () => undefined,
    attributionOf: (id, text) =>
      text?.includes("[§s1]") && id === "VBL" ? `${id} · Títulos: PdDpt` : id,
    translationName: (id) => id
  });
  if (!document) throw new Error("no document");
  const block = document.blocks.find((block) => block.type === "scripture");
  expect(block?.type === "scripture" && block.columns).toEqual([
    {
      text: "[§s1] El amor de Dios\n[§d] Un Salmo.\n[16] Porque",
      attribution: "VBL · Títulos: PdDpt"
    },
    {
      text: "[§s1] El amor de Dios\n[§d] Un Salmo.\n[16] Porque",
      attribution: "BSB"
    }
  ]);
  const rendered = studyDocumentHtml(document);
  expect(rendered).toContain(
    '<span class="verse-heading-s1">El amor de Dios</span><br><span class="verse-heading-d">Un Salmo.</span><br><sup class="verse-number">16</sup> Porque'
  );
  expect(rendered).toContain("VBL · Títulos: PdDpt");
  expect(rendered).not.toContain("[§");

  const base64 = await studyDocumentDocx(document, docx, "base64");
  const { default: JSZip } = await import("jszip");
  const files = await JSZip.loadAsync(base64, { base64: true });
  const body = await files.file("word/document.xml")!.async("string");
  expect(body).toMatch(/<w:b\/>[\s\S]*?>El amor de Dios<\/w:t>/);
  expect(body).toMatch(/<w:i\/>[\s\S]*?>Un Salmo\.<\/w:t>/);
  expect(body).toContain("VBL · Títulos: PdDpt");
  expect(body).not.toMatch(/w:pStyle w:val="Heading/);
  expect(body).not.toContain("[§");
}, 15000);
