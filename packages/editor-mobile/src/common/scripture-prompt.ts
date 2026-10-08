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

import { strings } from "@notesnook/intl";
import {
  MAX_PARALLEL,
  type ParallelColumn,
  type ScriptureBlockAttributes
} from "@notesnook/editor";
import { formatRef, parseReferences } from "@notesnook/scripture-parser";
import { PROVENANCE } from "@notesnook/scripture-provider";
import { ask, choose } from "./prompt";
import { formatReference, getTranslation, resolveVerse } from "./scripture";

export type ScriptureToInsert = {
  ref: string;
  label: string;
  translationId: string;
  text: string;
};

/**
 * Asks for a reference and comes back with the verse to insert, or nothing if
 * the person changed their mind (Fase 8).
 */
export function askForScripture(): Promise<ScriptureToInsert | undefined> {
  return ask<ScriptureToInsert>({
    id: "scripture-prompt",
    title: strings.insertScripture(),
    description: strings.scripturePromptDesc(),
    submit: async (typed) => {
      // The parser reads every language it knows, so a person with the
      // interface in English can still type "Juan 3:16" here.
      const [reference] = parseReferences(typed);
      if (!reference) return { error: strings.scriptureNotRecognized(typed) };

      const asked = getTranslation();
      const ref = formatRef(reference);
      try {
        const verse = await resolveVerse(ref, asked);
        if (!verse.text)
          return { error: strings.scriptureNoTextFor(asked, typed) };
        // The block records the translation that actually served the words,
        // so its attribution stays true even when a substitute was used.
        return {
          value: {
            ref,
            label: formatReference(ref),
            translationId: verse.translationId,
            text: verse.text
          }
        };
      } catch (failure) {
        // A pack that will not open used to leave the button dead and the
        // dialog open with nothing said.
        console.error("could not read the verse", failure);
        return { error: strings.scriptureLookupFailed() };
      }
    }
  });
}

/**
 * "Comparar" on a scripture block (A3 Fase 5), as on the desktop
 * (compareScripture in apps/web/src/components/editor/tiptap.tsx): every
 * other translation, checked when it is already a column.
 */
export function compareScripture(
  block: ScriptureBlockAttributes,
  update: (parallel: ParallelColumn[]) => void
) {
  const columns = block.parallel ?? [];
  return choose({
    id: "compare-prompt",
    title: strings.compareTranslations(),
    items: Object.values(PROVENANCE)
      .filter((translation) => translation.id !== block.translationId)
      .map((translation) => ({
        key: translation.id,
        label: `${translation.id} — ${translation.name}`,
        checked: columns.some((c) => c.translationId === translation.id)
      })),
    pick: async (translationId) => {
      if (columns.some((c) => c.translationId === translationId)) {
        update(columns.filter((c) => c.translationId !== translationId));
        return;
      }
      if (columns.length >= MAX_PARALLEL) return strings.compareMax();
      const verse = await resolveVerse(block.ref, translationId);
      if (!verse.text)
        return strings.scriptureNoTextFor(
          translationId,
          block.label || block.ref
        );
      // Offline, an online translation falls back to a pack: the column
      // credits what was actually shown, and is not shown twice.
      if (
        verse.translationId !== translationId &&
        (verse.translationId === block.translationId ||
          columns.some((c) => c.translationId === verse.translationId))
      )
        return strings.scriptureShowingInstead(verse.translationId);
      update([
        ...columns,
        { translationId: verse.translationId, text: verse.text }
      ]);
    }
  });
}
