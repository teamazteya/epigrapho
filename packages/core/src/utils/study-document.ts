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

// Epigrapho (A3 Fase 6, M1 Fase 5c): the study export. A note becomes one
// document model (a cover, its blocks, and a note for every inline reference
// with the verse in full); the PDF and the .docx are both written from it.
// It lives here so the desktop and the phone write the same documents; each
// app hands in how it reads a verse.
import { strings } from "@notesnook/intl";
import { parseHTML } from "./html-parser.js";
import type * as Docx from "docx";

export type Inline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** 1-based number of this reference's note. */
  note?: number;
};

export type Block =
  | { type: "heading"; level: number; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | {
      type: "scripture";
      label: string;
      columns: { text: string; attribution: string }[];
    }
  /** A study block (interlinear, dictionary entry…) or anything else, as is. */
  | { type: "other"; html: string; text: string };

export type VerseNote = {
  label: string;
  text: string;
  attribution: string;
  /** Why this is not the translation that was asked for, if it is not. */
  notice?: string;
};

export type StudyDocument = {
  title: string;
  author: string;
  /** The interface locale it was written in. */
  locale: string;
  date: string;
  translations: string[];
  blocks: Block[];
  notes: VerseNote[];
};

export type StudyVerse = { text: string; translationId: string };

export type StudyDocumentOptions = {
  title: string;
  author: string;
  /** The interface locale, for the date and the page's language. */
  locale: string;
  /** The translation the person reads in. */
  preferred: string;
  /** Reads a USFM reference in a translation, falling back as the app does. */
  resolveVerse: (
    ref: string,
    translationId: string
  ) => Promise<StudyVerse | undefined>;
  attributionOf: (translationId: string) => string;
  /** "Nueva Traducción Viviente (NTV)". */
  translationName: (translationId: string) => string;
};

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const childElements = (element: Element, match: (child: Element) => boolean) =>
  Array.from(element.children).filter(match);
const hasClass = (name: string) => (child: Element) =>
  child.classList.contains(name);

/** Reads the note's HTML (study blocks already rendered) into the model. */
export async function buildStudyDocument(
  html: string,
  options: StudyDocumentOptions
): Promise<StudyDocument | undefined> {
  const body = parseHTML(html)?.body;
  if (!body) return;

  const translations = new Set<string>();
  const notes: VerseNote[] = [];
  const { preferred } = options;
  const pending: Promise<void>[] = [];

  function addNote(ref: string, label: string) {
    const index = notes.length;
    notes.push({ label, text: "", attribution: "" });
    pending.push(
      (async () => {
        const verse = await options
          .resolveVerse(ref, preferred)
          .catch(() => undefined);
        if (!verse?.text) return;
        translations.add(verse.translationId);
        notes[index] = {
          label,
          text: verse.text,
          attribution: options.attributionOf(verse.translationId),
          notice:
            verse.translationId !== preferred
              ? strings.studyExport.shownInstead(verse.translationId, preferred)
              : undefined
        };
      })()
    );
    return index + 1;
  }

  // Node types by number: on the phone the DOM is linkedom's, without the
  // browser's Node and Element globals.
  function inlinesOf(element: Element): Inline[] {
    const out: Inline[] = [];
    const walk = (node: Node, style: Omit<Inline, "text">) => {
      if (node.nodeType === TEXT_NODE) {
        if (node.textContent) out.push({ text: node.textContent, ...style });
        return;
      }
      if (node.nodeType !== ELEMENT_NODE) return;
      const element = node as Element;
      const tag = element.tagName.toLowerCase();
      if (tag === "br") return void out.push({ text: "\n", ...style });
      const next = {
        ...style,
        bold: style.bold || tag === "strong" || tag === "b",
        italic: style.italic || tag === "em" || tag === "i",
        underline: style.underline || tag === "u"
      };
      element.childNodes.forEach((child) => walk(child, next));
      const ref = element.getAttribute("data-scripture-ref");
      if (ref && element.classList.contains("scripture-reference"))
        out.push({
          text: "",
          note: addNote(ref, element.textContent || ref)
        });
    };
    element.childNodes.forEach((child) => walk(child, {}));
    return out;
  }

  const textOf = (element: Element) =>
    childElements(element, hasClass("scripture-block-text"))[0]?.textContent ||
    "";

  const blocks: Block[] = [];
  for (const element of Array.from(body.children)) {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag))
      blocks.push({
        type: "heading",
        level: Number(tag[1]),
        inlines: inlinesOf(element)
      });
    else if (tag === "p" || tag === "blockquote")
      blocks.push({ type: "paragraph", inlines: inlinesOf(element) });
    else if (tag === "ul" || tag === "ol")
      blocks.push({
        type: "list",
        ordered: tag === "ol",
        items: childElements(
          element,
          (child) => child.tagName.toLowerCase() === "li"
        ).map((li) => inlinesOf(li))
      });
    else if (element.hasAttribute("data-scripture-block")) {
      const columns = [
        {
          id: element.getAttribute("data-translation-id") || "",
          text: textOf(element)
        },
        ...childElements(element, hasClass("scripture-block-parallel")).map(
          (column) => ({
            id: column.getAttribute("data-translation-id") || "",
            text:
              column.querySelector(".scripture-block-text")?.textContent || ""
          })
        )
      ];
      columns.forEach((column) => translations.add(column.id));
      blocks.push({
        type: "scripture",
        label:
          element.querySelector(".scripture-block-reference")?.textContent ||
          element.getAttribute("data-scripture-ref") ||
          "",
        columns: columns.map((column) => ({
          text: column.text,
          attribution: options.attributionOf(column.id)
        }))
      });
    } else
      blocks.push({
        type: "other",
        html: element.outerHTML,
        text: element.textContent || ""
      });
  }
  await Promise.all(pending);

  return {
    title: options.title,
    author: options.author,
    locale: options.locale,
    date: new Date().toLocaleDateString(options.locale, { dateStyle: "long" }),
    translations: [...translations]
      .filter(Boolean)
      .map(options.translationName),
    blocks,
    notes
  };
}
const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function inlineHtml(inlines: Inline[]) {
  return inlines
    .map((inline) => {
      if (inline.note)
        return `<sup class="note-ref"><a href="#note-${inline.note}" id="ref-${inline.note}">${inline.note}</a></sup>`;
      let html = escape(inline.text).replace(/\n/g, "<br>");
      if (inline.bold) html = `<strong>${html}</strong>`;
      if (inline.italic) html = `<em>${html}</em>`;
      if (inline.underline) html = `<u>${html}</u>`;
      return html;
    })
    .join("");
}

/**
 * The PDF's page: a cover, the note, and its verses in full. Chromium does not
 * lay out footnotes per page, so they are gathered at the end under "Notas",
 * numbered and linked both ways.
 *
 * ponytail: notes at the end; per-page footnotes need a paged-media polyfill
 * (paged.js), a new dependency the person has to approve.
 */
export function studyDocumentHtml(document: StudyDocument) {
  const blocks = document.blocks
    .map((block) => {
      if (block.type === "heading")
        return `<h${block.level}>${inlineHtml(block.inlines)}</h${
          block.level
        }>`;
      if (block.type === "paragraph")
        return `<p>${inlineHtml(block.inlines)}</p>`;
      if (block.type === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}>${block.items
          .map((item) => `<li>${inlineHtml(item)}</li>`)
          .join("")}</${tag}>`;
      }
      if (block.type === "scripture")
        return `<div class="scripture" style="--columns:${
          block.columns.length
        }"><p class="label">${escape(
          block.label
        )}</p><div class="columns">${block.columns
          .map(
            (column) =>
              `<div><p class="verse">${escape(
                column.text
              )}</p><p class="credit">${escape(column.attribution)}</p></div>`
          )
          .join("")}</div></div>`;
      return `<div class="study">${block.html}</div>`;
    })
    .join("\n");

  const notes = document.notes.length
    ? `<section class="notes"><h2>${escape(
        strings.studyExport.notes()
      )}</h2><ol>${document.notes
        .map(
          (note, i) =>
            `<li id="note-${i + 1}"><strong>${escape(
              note.label
            )}.</strong> ${escape(
              note.text || strings.studyExport.noText()
            )} <span class="credit">${escape(note.attribution)}${
              note.notice ? ` · ${escape(note.notice)}` : ""
            }</span> <a href="#ref-${i + 1}">↩</a></li>`
        )
        .join("")}</ol></section>`
    : "";

  return `<!doctype html>
<html lang="${escape(document.locale)}">
<head>
<meta charset="utf-8">
<title>${escape(document.title)}</title>
<style>
  @page { margin: 22mm 20mm; }
  body { font-family: "Inter", "Segoe UI", system-ui, sans-serif; font-size: 11pt; line-height: 1.55; color: #17223b; }
  .cover { height: 230mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; break-after: page; }
  .cover h1 { font-size: 30pt; line-height: 1.15; margin: 0 0 18pt; }
  .cover p { margin: 4pt 0; font-size: 12pt; }
  .cover .translations { margin-top: 18pt; font-size: 10pt; color: #4a5468; }
  h1, h2, h3, h4 { line-height: 1.25; break-after: avoid; }
  .scripture { margin: 12pt 0; padding: 10pt 12pt; border: 1px solid #d9d2c3; border-radius: 4pt; background: #f4efe4; break-inside: avoid; }
  .scripture .label { margin: 0 0 4pt; font-weight: 600; font-size: 10pt; color: #4a5468; }
  .scripture .columns { display: grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); gap: 14pt; }
  .verse { margin: 0; font-family: "Cormorant Garamond", "Source Serif 4", Georgia, serif; font-size: 12pt; line-height: 1.5; }
  .credit { margin: 4pt 0 0; font-size: 8.5pt; color: #4a5468; }
  .study { margin: 10pt 0; break-inside: avoid; }
  sup.note-ref a { text-decoration: none; color: #2e6b5e; font-size: 8pt; }
  .notes { break-before: page; font-size: 10pt; }
  .notes li { margin-bottom: 6pt; }
  .notes a { color: #2e6b5e; text-decoration: none; }
</style>
</head>
<body>
<section class="cover">
  <h1>${escape(document.title)}</h1>
  ${document.author ? `<p>${escape(document.author)}</p>` : ""}
  <p>${escape(document.date)}</p>
  ${
    document.translations.length
      ? `<p class="translations">${escape(
          strings.studyExport.translationsUsed(document.translations.join(", "))
        )}</p>`
      : ""
  }
</section>
${blocks}
${notes}
</body>
</html>`;
}

/** A file name the three systems accept, from the note's title. */
export const studyFileName = (title: string, extension: string) =>
  `${(title || "Epigrapho")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim()}.${extension}`;

/**
 * The .docx: the same structure, with Word's own footnotes. Each app passes
 * in the docx library (`await import("docx")`), so builds that never write
 * Word documents, like the editor's page on the phone, do not carry it.
 */
export async function studyDocumentDocx(
  document: StudyDocument,
  docx: unknown,
  output: "blob"
): Promise<Blob>;
export async function studyDocumentDocx(
  document: StudyDocument,
  docx: unknown,
  output: "base64"
): Promise<string>;
export async function studyDocumentDocx(
  document: StudyDocument,
  docx: unknown,
  output: "blob" | "base64"
) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    FootnoteReferenceRun,
    HeadingLevel,
    LevelFormat,
    Packer,
    PageBreak,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
  } = docx as typeof Docx;

  const SERIF = "Georgia";
  const MUTED = "4A5468";
  const runs = (inlines: Inline[]) =>
    inlines.map((inline) =>
      inline.note
        ? new FootnoteReferenceRun(inline.note)
        : new TextRun({
            text: inline.text,
            bold: inline.bold,
            italics: inline.italic,
            underline: inline.underline ? {} : undefined,
            break: inline.text === "\n" ? 1 : undefined
          })
    );
  const headings = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6
  ];
  const border = { style: BorderStyle.SINGLE, size: 4, color: "D9D2C3" };

  const children: (
    | InstanceType<typeof Paragraph>
    | InstanceType<typeof Table>
  )[] = [
    new Paragraph({ spacing: { before: 2400 } }),
    new Paragraph({
      children: [new TextRun({ text: document.title, bold: true, size: 60 })],
      spacing: { after: 360 }
    }),
    ...(document.author
      ? [
          new Paragraph({
            children: [new TextRun({ text: document.author, size: 24 })]
          })
        ]
      : []),
    new Paragraph({
      children: [new TextRun({ text: document.date, size: 24 })]
    }),
    ...(document.translations.length
      ? [
          new Paragraph({
            spacing: { before: 360 },
            children: [
              new TextRun({
                text: strings.studyExport.translationsUsed(
                  document.translations.join(", ")
                ),
                size: 20,
                color: MUTED
              })
            ]
          })
        ]
      : []),
    new Paragraph({ children: [new PageBreak()] })
  ];

  for (const block of document.blocks) {
    if (block.type === "heading")
      children.push(
        new Paragraph({
          heading: headings[Math.min(block.level, 6) - 1],
          children: runs(block.inlines)
        })
      );
    else if (block.type === "paragraph")
      children.push(new Paragraph({ children: runs(block.inlines) }));
    else if (block.type === "list")
      for (const item of block.items)
        children.push(
          new Paragraph({
            children: runs(item),
            ...(block.ordered
              ? { numbering: { reference: "ordered", level: 0 } }
              : { bullet: { level: 0 } })
          })
        );
    else if (block.type === "scripture")
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: border,
            bottom: border,
            left: border,
            right: border,
            insideHorizontal: {
              style: BorderStyle.NONE,
              size: 0,
              color: "FFFFFF"
            },
            insideVertical: {
              style: BorderStyle.NONE,
              size: 0,
              color: "FFFFFF"
            }
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  columnSpan: block.columns.length,
                  shading: {
                    type: ShadingType.CLEAR,
                    fill: "F4EFE4",
                    color: "auto"
                  },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: block.label,
                          bold: true,
                          size: 20,
                          color: MUTED
                        })
                      ]
                    })
                  ]
                })
              ]
            }),
            new TableRow({
              children: block.columns.map(
                (column) =>
                  new TableCell({
                    shading: {
                      type: ShadingType.CLEAR,
                      fill: "F4EFE4",
                      color: "auto"
                    },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: column.text,
                            font: SERIF,
                            size: 24
                          })
                        ]
                      }),
                      new Paragraph({
                        spacing: { before: 80 },
                        children: [
                          new TextRun({
                            text: column.attribution,
                            size: 16,
                            color: MUTED
                          })
                        ]
                      })
                    ]
                  })
              )
            })
          ]
        }),
        new Paragraph({})
      );
    else
      for (const line of block.text.split(/\n+/).filter((line) => line.trim()))
        children.push(new Paragraph({ children: [new TextRun(line)] }));
  }

  const footnotes: Record<
    number,
    { children: InstanceType<typeof Paragraph>[] }
  > = {};
  document.notes.forEach((note, i) => {
    footnotes[i + 1] = {
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: `${note.label}. `, bold: true }),
            new TextRun({
              text: note.text || strings.studyExport.noText(),
              font: SERIF
            }),
            new TextRun({
              text: ` ${note.attribution}${
                note.notice ? ` · ${note.notice}` : ""
              }`,
              color: MUTED
            })
          ]
        })
      ]
    };
  });

  const file = new Document({
    creator: document.author || "Epigrapho",
    title: document.title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START
            }
          ]
        }
      ]
    },
    footnotes,
    sections: [{ children }]
  });
  return output === "blob" ? Packer.toBlob(file) : Packer.toBase64String(file);
}
