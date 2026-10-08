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

// Epigrapho (A3): note templates on the desktop. What they are and where they
// are kept is shared with the phone (@notesnook/core, note-templates.ts);
// opening the note, the menus and the dialogs are this app's.
import {
  builtInTemplates,
  Note,
  NoteTemplate,
  addTemplate,
  deleteTemplate as removeTemplate,
  newNoteFromTemplate as createFromTemplate,
  renameTemplate as retitleTemplate,
  userTemplates as storedTemplates
} from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { db } from "./db";
import { getUiLocale } from "./ui-locale";
import { useEditorStore } from "../stores/editor-store";
import { useEditorManager } from "../components/editor/manager";
import { store as notesStore } from "../stores/note-store";
import { MenuItem } from "@notesnook/ui";
import { PromptDialog } from "../dialogs/prompt";
import { showToast } from "../utils/toast";

export type Template = NoteTemplate;
export { builtInTemplates };

export async function userTemplates(): Promise<Template[]> {
  return storedTemplates(db);
}

/** Creates a note with the template's content and opens it. */
export async function newNoteFromTemplate(template: Template) {
  const id = await createFromTemplate(db, template, getUiLocale());
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
  await addTemplate(db, title.trim() || note.title, html);
}

export const renameTemplate = (id: string, title: string) =>
  retitleTemplate(db, id, title);

export const deleteTemplate = (id: string) => removeTemplate(db, id);

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
