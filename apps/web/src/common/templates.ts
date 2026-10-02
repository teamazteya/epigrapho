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

// Epigrapho (A3): note templates. The four built-in ones are written here in
// the interface's language; the ones the person saves live in the account's
// settings, so they travel like the translation and the word lists.
//
// ponytail: the built-in templates live in the web app because their text
// comes from the catalog; M1 can move them to a shared package when the
// mobile app needs them.
import { EpigraphoTemplate, Note } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { db } from "./db";
import { getUiLocale } from "./ui-locale";
import { useEditorStore } from "../stores/editor-store";
import { useEditorManager } from "../components/editor/manager";
import { store as notesStore } from "../stores/note-store";
import { MenuItem } from "@notesnook/ui";
import { PromptDialog } from "../dialogs/prompt";
import { showToast } from "../utils/toast";

const SETTING = "epigrapho:templates";

export type Template = EpigraphoTemplate & { builtIn?: boolean };

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A heading followed by an empty paragraph to write in. */
const section = (title: string) => `<h2>${escape(title)}</h2><p></p>`;
const point = (title: string) => `<h3>${escape(title)}</h3><p></p>`;
const list = (title: string, tag: "ul" | "ol") =>
  `<h2>${escape(title)}</h2><${tag}><li><p></p></li></${tag}>`;

export function builtInTemplates(): Template[] {
  const t = strings.templates;
  const builtIn = (id: string, title: string, html: string): Template => ({
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

export async function userTemplates(): Promise<Template[]> {
  // A copy: with no templates yet, settings hands back its shared default.
  return [...(db.settings.getEpigrapho(SETTING) || [])];
}

export async function allTemplates(): Promise<Template[]> {
  return [...builtInTemplates(), ...(await userTemplates())];
}

// ponytail: the whole list is one setting, so when two computers change it
// at the same moment the newest list wins. A per-template record is the
// upgrade if people edit templates on several machines at once.
async function saveUserTemplates(templates: Template[]) {
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

/** Creates a note with the template's content and opens it. */
export async function newNoteFromTemplate(template: Template) {
  const date = new Date().toLocaleDateString(getUiLocale(), {
    dateStyle: "long"
  });
  const id = await db.notes.add({
    title: `${template.title} — ${date}`,
    content: { type: "tiptap", data: template.html }
  });
  if (!id) return;
  await notesStore.refresh();
  await useEditorStore.getState().openSession(id);
  return id;
}

/** Saves the note's current content as a template of the person's own. */
export async function saveNoteAsTemplate(note: Note, title: string) {
  const content = note.contentId && (await db.content.get(note.contentId));
  if (content && content.locked)
    throw new Error(strings.templates.cannotSaveLocked());
  // An open note may hold edits the save has not reached yet; the editor has
  // what the person sees.
  const open = useEditorStore
    .getState()
    .getSessionsForNote(note.id)
    .map((session) => useEditorManager.getState().getEditor(session.id))
    .find((editor) => editor?.editor);
  const html = open?.editor?.getContent() || (content && content.data);
  if (typeof html !== "string") return;
  const templates = await userTemplates();
  templates.push({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: title.trim() || note.title,
    html,
    updatedAt: Date.now()
  });
  await saveUserTemplates(templates);
}

export async function renameTemplate(id: string, title: string) {
  const templates = await userTemplates();
  const template = templates.find((t) => t.id === id);
  if (!template || !title.trim()) return;
  template.title = title.trim();
  template.updatedAt = Date.now();
  await saveUserTemplates(templates);
}

export async function deleteTemplate(id: string) {
  await saveUserTemplates((await userTemplates()).filter((t) => t.id !== id));
}

/** The menu that lists every template; choosing one starts a note with it. */
export function templateMenuItems(): MenuItem[] {
  const button = (template: Template): MenuItem => ({
    type: "button",
    key: template.id,
    title: template.title,
    onClick: () => newNoteFromTemplate(template)
  });
  return [
    ...builtInTemplates().map(button),
    { type: "separator", key: "user-templates" },
    {
      type: "lazy-loader",
      key: "user-template-list",
      items: async () => {
        const templates = await userTemplates();
        return templates.length
          ? templates.map(button)
          : [
              {
                type: "button",
                key: "no-templates",
                title: strings.templates.none(),
                isDisabled: true
              }
            ];
      }
    }
  ];
}

/** Asks for a name and keeps the note as one of the person's templates. */
export async function promptSaveAsTemplate(note: Note) {
  const title = await PromptDialog.show({
    title: strings.templates.saveAsTemplate(),
    // No default value: the prompt hands it back on Cancel too, which would
    // save the template anyway.
    description: strings.templates.templateName()
  });
  if (!title) return;
  try {
    await saveNoteAsTemplate(note, title);
    showToast("success", strings.templates.saved(title.trim()));
  } catch (e) {
    showToast("error", (e as Error).message);
  }
}
