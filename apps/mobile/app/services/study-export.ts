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

import { exportContent, setGeneratedBlockRenderer } from "@notesnook/common";
import {
  buildStudyDocument,
  Note,
  studyDocumentDocx,
  studyDocumentHtml
} from "@notesnook/core";
import { strings } from "@notesnook/intl";
import {
  dictionaryArticle,
  originalTokens,
  setOriginalReader,
  type DictionarySource
} from "@notesnook/original-languages";
import { parseRef } from "@notesnook/scripture-parser";
import {
  attributionOf,
  PROVENANCE,
  STUDY_PROVENANCE
} from "@notesnook/scripture-provider";
import { Platform } from "react-native";
import RNFetchBlob from "react-native-blob-util";
import { db } from "../common/database";
import { MMKV } from "../common/database/mmkv";
import { getTranslation, resolveVerse } from "../common/scripture";
import { getUiLocale } from "../common/ui-locale";
import { presentDialog } from "../components/dialog/functions";

/**
 * Exporting a note with study blocks (M1 Fase 4, A2 Paso 3.3): a note keeps
 * only the reference or the entry id, so the export has to write the words
 * out. The desktop does this in apps/web/src/common/export.ts; this is the
 * same table and the same text, read here from the packs inside the app
 * package, because the export runs in the app and not in the editor's page.
 */
setOriginalReader(async (name) => {
  const path =
    Platform.OS === "ios"
      ? `${RNFetchBlob.fs.dirs.MainBundleDir}/build.bundle/original/${name}`
      : `bundle-assets://original/${name}`;
  return JSON.parse(await RNFetchBlob.fs.readFile(path, "utf8"));
});

const shortStrong = (strong: string) =>
  strong.replace(/^([GHA])0+(\d)/, "$1$2");

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

async function renderInterlinear(ref: string, label: string) {
  const range = parseRef(ref);
  if (!range) return;
  const spanish = getUiLocale() !== "en-US";
  const verses = await originalTokens(range).catch(() => []);
  if (!verses.length) return;
  const head = [
    "#",
    strings.originalWord(),
    strings.transliteration(),
    "Strong",
    strings.morphology(),
    strings.gloss()
  ];
  const rows = verses.flatMap((tokens) =>
    tokens.map((token) =>
      [
        token.ref.split(".").slice(1).join(":"),
        escape(token.surface),
        escape(token.transliteration),
        shortStrong(token.strong),
        escape(token.morph),
        escape(spanish ? token.glossEs : token.glossEn)
      ]
        .map((cell) => `<td>${cell}</td>`)
        .join("")
    )
  );
  const credit = [
    STUDY_PROVENANCE.STEP.attribution,
    ...(spanish ? [STUDY_PROVENANCE.RV09A.attribution] : [])
  ].join(" · ");
  return `<p><strong>${escape(
    label || ref
  )}</strong></p><table><thead><tr>${head
    .map((cell) => `<th>${cell}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row}</tr>`)
    .join("")}</tbody></table><p><em>${escape(credit)}</em></p>`;
}

const DICTIONARY_NAMES: Record<DictionarySource, string> = {
  TW: "Palabras de Traducción (es-419)",
  RAND: "Diccionario de la Santa Biblia (Rand, 1890)",
  EAS: "Easton's Bible Dictionary (1897)",
  SMI: "Smith's Bible Dictionary (1863)",
  HIT: "Hitchcock's Bible Names Dictionary (1869)"
};

const CREDITS: Record<DictionarySource, string> = {
  TW: STUDY_PROVENANCE.ES419TW.attribution,
  RAND: "Rand, Diccionario de la Santa Biblia (1890) — dominio público",
  EAS: STUDY_PROVENANCE.NEUU.attribution,
  SMI: STUDY_PROVENANCE.NEUU.attribution,
  HIT: STUDY_PROVENANCE.NEUU.attribution
};

async function renderDictionaryEntry(id: string) {
  const article = await dictionaryArticle(id).catch(() => undefined);
  if (!article) return;
  const paragraphs = article.body
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escape(paragraph)}</p>`)
    .join("");
  return `<h4>${escape(article.term)}</h4><p><em>${escape(
    DICTIONARY_NAMES[article.source]
  )}</em></p>${paragraphs}<p><em>${escape(CREDITS[article.source])}</em></p>`;
}

// ponytail: the same markup as the desktop's renderers, written again here
// because theirs import the web app. Moving both into one package is worth it
// the day a third caller appears.
setGeneratedBlockRenderer((attribute, value, label) =>
  attribute === "data-interlinear-ref"
    ? renderInterlinear(value, label)
    : renderDictionaryEntry(value)
);

const AUTHOR_KEY = "epigrapho:exportAuthor";

/**
 * The name on the cover of a PDF or Word export (A3 Fase 6): the account's
 * profile name, or the one this phone was given the first time; an empty
 * answer exports without a name. Undefined when the person cancels.
 */
export function studyAuthor(context: string): Promise<string | undefined> {
  const stored = MMKV.getString(AUTHOR_KEY) ?? undefined;
  const name = db.settings.getProfile()?.fullName?.trim() || stored;
  if (name !== undefined) return Promise.resolve(name);
  return new Promise((resolve) => {
    let answered = false;
    presentDialog({
      context,
      title: strings.studyExport.authorTitle(),
      paragraph: strings.studyExport.authorDesc(),
      input: true,
      inputPlaceholder: strings.studyExport.authorTitle(),
      positiveText: strings.done(),
      negativeText: strings.cancel(),
      positivePress: async (value?: string) => {
        answered = true;
        const author = (value || "").trim();
        MMKV.setString(AUTHOR_KEY, author);
        resolve(author);
        return true;
      },
      onClose: () => {
        if (!answered) resolve(undefined);
      }
    });
  });
}

/** The PDF's page or the .docx (as base64) of one note, as on the desktop. */
export async function studyExportData(
  note: Note,
  format: "pdf" | "docx",
  author: string,
  unlockVault: () => Promise<boolean>
) {
  const html = await exportContent(note, {
    format: "html",
    disableTemplate: true,
    unlockVault
  });
  if (typeof html !== "string") return;
  const document = await buildStudyDocument(html, {
    title: note.title,
    author,
    locale: getUiLocale(),
    preferred: getTranslation(),
    resolveVerse,
    attributionOf,
    translationName: (id) =>
      PROVENANCE[id] ? `${PROVENANCE[id].name} (${id})` : id
  });
  if (!document) return;
  return format === "docx"
    ? studyDocumentDocx(document, await import("docx"), "base64")
    : studyDocumentHtml(document);
}
