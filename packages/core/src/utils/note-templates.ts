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

import { strings } from "@notesnook/intl";
import type Database from "../api/index.js";
import type { EpigraphoTemplate } from "../types.js";

/**
 * Epigrapho (A3 Fase 1): note templates, shared by the desktop and the phone
 * (M1 Fase 5c). The four built-in ones are written here from the catalog; the
 * person's own travel with the account as one setting.
 */
const SETTING = "epigrapho:templates";

export type NoteTemplate = EpigraphoTemplate & { builtIn?: boolean };

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A heading followed by an empty paragraph to write in. */
const section = (title: string) => `<h2>${escape(title)}</h2><p></p>`;
const point = (title: string) => `<h3>${escape(title)}</h3><p></p>`;
const list = (title: string, tag: "ul" | "ol") =>
  `<h2>${escape(title)}</h2><${tag}><li><p></p></li></${tag}>`;

export function builtInTemplates(): NoteTemplate[] {
  const t = strings.templates;
  const builtIn = (id: string, title: string, html: string): NoteTemplate => ({
    id: `builtin:${id}`,
    title,
    html,
    updatedAt: 0,
    builtIn: true
  });
  return [
    builtIn(
      "sermon",
      t.sermon(),
      [
        section(t.baseText()),
        section(t.bigIdea()),
        section(t.context()),
        `<h2>${escape(t.outline())}</h2>`,
        point(t.firstPoint()),
        point(t.secondPoint()),
        point(t.thirdPoint()),
        section(t.illustrations()),
        section(t.application()),
        section(t.conclusion())
      ].join("")
    ),
    builtIn(
      "soap",
      t.soap(),
      [
        section(t.scripture()),
        section(t.observation()),
        section(t.application()),
        section(t.prayer())
      ].join("")
    ),
    builtIn(
      "inductive",
      t.inductive(),
      [
        section(t.passage()),
        section(t.observation()),
        section(t.interpretation()),
        section(t.application()),
        list(t.questions(), "ul")
      ].join("")
    ),
    builtIn(
      "class",
      t.classNotes(),
      [
        section(t.topic()),
        section(t.passage()),
        section(t.teacher()),
        list(t.mainPoints(), "ul"),
        list(t.classQuestions(), "ol"),
        section(t.homework())
      ].join("")
    )
  ];
}

export function userTemplates(db: Database): NoteTemplate[] {
  // A copy: with no templates yet, settings hands back its shared default.
  return [...(db.settings.getEpigrapho(SETTING) || [])];
}

export function allTemplates(db: Database): NoteTemplate[] {
  return [...builtInTemplates(), ...userTemplates(db)];
}

// ponytail: the whole list is one setting, so when two devices change it at
// the same moment the newest list wins. A per-template record is the upgrade
// if people edit templates on several devices at once.
async function saveUserTemplates(db: Database, templates: NoteTemplate[]) {
  await db.settings.setEpigrapho(
    SETTING,
    templates.map(({ id, title, html, updatedAt }) => ({
      id,
      title,
      html,
      updatedAt
    }))
  );
}

/** Creates a note with the template's content; the title carries the date. */
export function newNoteFromTemplate(
  db: Database,
  template: NoteTemplate,
  locale: string
) {
  const date = new Date().toLocaleDateString(locale, { dateStyle: "long" });
  return db.notes.add({
    title: `${template.title} — ${date}`,
    content: { type: "tiptap", data: template.html }
  });
}

export async function addTemplate(db: Database, title: string, html: string) {
  const templates = userTemplates(db);
  templates.push({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: title.trim(),
    html,
    updatedAt: Date.now()
  });
  await saveUserTemplates(db, templates);
}

export async function renameTemplate(db: Database, id: string, title: string) {
  const templates = userTemplates(db);
  const template = templates.find((t) => t.id === id);
  if (!template || !title.trim()) return;
  template.title = title.trim();
  template.updatedAt = Date.now();
  await saveUserTemplates(db, templates);
}

export async function deleteTemplate(db: Database, id: string) {
  await saveUserTemplates(
    db,
    userTemplates(db).filter((t) => t.id !== id)
  );
}
