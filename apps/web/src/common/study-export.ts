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

// Epigrapho (A3 Fase 6): the study export. The document itself is written in
// @notesnook/core (utils/study-document.ts), shared with the phone; this file
// gives it the desktop's verses, the name on the cover and the file.
import { exportContent } from "@notesnook/common";
import {
  buildStudyDocument as buildDocument,
  Note,
  StudyDocument,
  studyDocumentDocx as docxOf,
  studyDocumentHtml,
  studyFileName
} from "@notesnook/core";
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

export { studyDocumentHtml };
export type { StudyDocument };

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

export const translationName = (id: string) =>
  PROVENANCE[id] ? `${PROVENANCE[id].name} (${id})` : id;

/** Reads the note's HTML (study blocks already rendered) into the model. */
export async function buildStudyDocument(note: Note, author: string) {
  const html = await exportContent(note, {
    format: "html",
    disableTemplate: true,
    unlockVault: Vault.unlockVault
  });
  if (typeof html !== "string") return;
  return buildDocument(html, {
    title: note.title,
    author,
    locale: getUiLocale(),
    preferred: getTranslation(),
    resolveVerse: async (ref, translationId) => {
      const range = parseRef(ref);
      return range ? resolveVerse(range, translationId) : undefined;
    },
    attributionOf,
    translationName
  });
}

export const studyDocumentDocx = async (document: StudyDocument) =>
  docxOf(document, await import("docx"), "blob");

/** "Exportar como" PDF or Word, from the note's menu. */
export async function exportStudy(note: Note, format: "pdf" | "docx") {
  const author = await exportAuthor();
  if (author === undefined) return false;
  const document = await buildStudyDocument(note, author);
  if (!document) return false;
  if (format === "docx") {
    saveAs(
      await studyDocumentDocx(document),
      studyFileName(note.title, "docx")
    );
    return true;
  }
  const { exportToPDF } = await import("./export");
  return exportToPDF(note.title, studyDocumentHtml(document));
}
