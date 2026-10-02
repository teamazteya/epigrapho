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

// Epigrapho (A3 Fase 6): the study export. A note becomes one document model
// (a cover, its blocks, and a note for every inline reference with the verse
// in full); the PDF and the .docx are both written from it.
import { exportContent } from "@notesnook/common";
import { Note } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { parseRef } from "@notesnook/scripture-parser";
import { attributionOf, PROVENANCE } from "@notesnook/scripture-provider";
import { saveAs } from "file-saver";
import { db } from "./db";
import { resolveVerse } from "./scripture";
import { getTranslation } from "./translation";
import { getUiLocale } from "./ui-locale";
import Vault from "./vault";
import Config from "../utils/config";
import { PromptDialog } from "../dialogs/prompt";

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
  date: string;
  translations: string[];
  blocks: Block[];
  notes: VerseNote[];
};

const AUTHOR_KEY = "exportAuthor";

/**
 * The name on the cover: the account's profile name, or the one this device
 * was given the first time. Undefined when the person declines to give one.
 */
export async function exportAuthor(): Promise<string | undefined> {
  const name =
    db.settings.getProfile()?.fullName?.trim() ||
    Config.get<string>(AUTHOR_KEY, "");
  if (name) return name;
  const asked = await PromptDialog.show({
    title: strings.studyExport.authorTitle(),
    description: strings.studyExport.authorDesc()
  });
  if (typeof asked !== "string") return undefined;
  Config.set(AUTHOR_KEY, asked.trim());
  return asked.trim();
}

const translationName = (id: string) =>
  PROVENANCE[id] ? `${PROVENANCE[id].name} (${id})` : id;

/** Reads the note's HTML (study blocks already rendered) into the model. */
export async function buildStudyDocument(
  note: Note,
  author: string
): Promise<StudyDocument | undefined> {
  const html = await exportContent(note, {
    format: "html",
    disableTemplate: true,
    unlockVault: Vault.unlockVault
  });
  if (typeof html !== "string") return;
  const body = new DOMParser().parseFromString(html, "text/html").body;

  const translations = new Set<string>();
  const notes: VerseNote[] = [];
  const preferred = getTranslation();
  const pending: Promise<void>[] = [];

  function addNote(ref: string, label: string) {
    const index = notes.length;
    notes.push({ label, text: "", attribution: "" });
    pending.push(
      (async () => {
        const range = parseRef(ref);
        if (!range) return;
        const verse = await resolveVerse(range, preferred).catch(
          () => undefined
        );
        if (!verse?.text) return;
        translations.add(verse.translationId);
        notes[index] = {
          label,
          text: verse.text,
          attribution: attributionOf(verse.translationId),
          notice:
            verse.translationId !== preferred
              ? strings.studyExport.shownInstead(verse.translationId, preferred)
              : undefined
        };
      })()
    );
    return index + 1;
  }

  function inlinesOf(element: Element): Inline[] {
    const out: Inline[] = [];
    const walk = (node: Node, style: Omit<Inline, "text">) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) out.push({ text: node.textContent, ...style });
        return;
      }
      if (!(node instanceof Element)) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "br") return void out.push({ text: "\n", ...style });
      const next = {
        ...style,
        bold: style.bold || tag === "strong" || tag === "b",
        italic: style.italic || tag === "em" || tag === "i",
        underline: style.underline || tag === "u"
      };
      node.childNodes.forEach((child) => walk(child, next));
      const ref = node.getAttribute("data-scripture-ref");
      if (ref && node.classList.contains("scripture-reference"))
        out.push({ text: "", note: addNote(ref, node.textContent || ref) });
    };
    element.childNodes.forEach((child) => walk(child, {}));
    return out;
  }

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
        items: Array.from(element.querySelectorAll(":scope > li")).map((li) =>
          inlinesOf(li)
        )
      });
    else if (element.hasAttribute("data-scripture-block")) {
      const primary = element.getAttribute("data-translation-id") || "";
      const columns = [
        {
          id: primary,
          text:
            element.querySelector(":scope > .scripture-block-text")
              ?.textContent || ""
        },
        ...Array.from(
          element.querySelectorAll(":scope > .scripture-block-parallel")
        ).map((column) => ({
          id: column.getAttribute("data-translation-id") || "",
          text: column.querySelector(".scripture-block-text")?.textContent || ""
        }))
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
          attribution: attributionOf(column.id)
        }))
      });
    } else
      blocks.push({
        type: "other",
        html: element.outerHTML,
        text: (element as HTMLElement).innerText || element.textContent || ""
      });
  }
  await Promise.all(pending);

  return {
    title: note.title,
    author,
    date: new Date().toLocaleDateString(getUiLocale(), { dateStyle: "long" }),
    translations: [...translations].filter(Boolean).map(translationName),
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
<html lang="${escape(getUiLocale())}">
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

const fileName = (title: string, extension: string) =>
  `${(title || "Epigrapho")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim()}.${extension}`;

/** The .docx: the same structure, with Word's own footnotes. */
export async function studyDocumentDocx(document: StudyDocument) {
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
  } = await import("docx");

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

  const docx = new Document({
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
  return Packer.toBlob(docx);
}

/** "Exportar como" PDF or Word, from the note's menu. */
export async function exportStudy(note: Note, format: "pdf" | "docx") {
  const author = await exportAuthor();
  if (author === undefined) return false;
  const document = await buildStudyDocument(note, author);
  if (!document) return false;
  if (format === "docx") {
    saveAs(await studyDocumentDocx(document), fileName(note.title, "docx"));
    return true;
  }
  const { exportToPDF } = await import("./export");
  return exportToPDF(note.title, studyDocumentHtml(document));
}
