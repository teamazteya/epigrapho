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

import { extractRefs } from "@notesnook/scripture-parser";
import { db } from "./db";

/**
 * Which notes cite which passage (PRD §31.10, Paso 5.1).
 *
 * The index is held in memory and nowhere else, on purpose. Verses are public
 * and live unencrypted in their own store; this is the opposite kind of thing.
 * "Which passages this person studies, and in which notes" is as private as
 * the notes themselves, and the notes sit in an encrypted database. Writing
 * `ROM.8.28 -> <note id>` into a plain IndexedDB table would carry that
 * outside the encryption for the sake of a few milliseconds at startup.
 *
 * Holding it in memory also means there is nothing to migrate, nothing to
 * repair and nothing that can go stale: the notes are the truth, and the
 * index is derived from them on each launch.
 *
 * ponytail: a full scan the first time backlinks are asked for, then one
 * update per save. If the scan ever becomes slow on a large library, the next
 * step is to keep it inside the encrypted database, not to spill it out.
 */
type IndexState = {
  notesByRef: Map<string, Set<string>>;
  refsByNote: Map<string, Set<string>>;
  seeding?: Promise<void>;
};

/**
 * The maps hang off the global rather than off this module. A module can be
 * instantiated more than once in a browser — the dev server does it on a hot
 * reload, and a build can put the same file in two chunks — and two copies of
 * an index that only lives in memory would each hold half the answer and
 * neither would look wrong. One holder, one answer.
 */
const state: IndexState = ((
  globalThis as { __epigraphoReferences?: IndexState }
).__epigraphoReferences ??= {
  notesByRef: new Map(),
  refsByNote: new Map()
});
const { notesByRef, refsByNote } = state;

/** Replaces what a note cites. Called on every save. */
export function indexNote(noteId: string, html: string) {
  const refs = new Set(extractRefs(html));

  for (const ref of refsByNote.get(noteId) ?? []) {
    if (refs.has(ref)) continue;
    const notes = notesByRef.get(ref);
    notes?.delete(noteId);
    if (notes && notes.size === 0) notesByRef.delete(ref);
  }

  for (const ref of refs) {
    const notes = notesByRef.get(ref) ?? new Set<string>();
    notes.add(noteId);
    notesByRef.set(ref, notes);
  }

  if (refs.size === 0) refsByNote.delete(noteId);
  else refsByNote.set(noteId, refs);
}

/** Reads every note once, so the index knows about notes written earlier. */
export async function ensureIndexed(): Promise<void> {
  if (!state.seeding)
    state.seeding = (async () => {
      const notes = await db.notes.all
        .fields(["notes.id", "notes.contentId"])
        .items();
      for (const note of notes) {
        if (!note.contentId) continue;
        const content = await db.content.get(note.contentId);
        const data = content && "data" in content ? content.data : undefined;
        if (typeof data === "string") indexNote(note.id, data);
      }
    })().catch((error) => {
      // A failed scan must not poison the index for the rest of the session:
      // the next call tries again, and what the saves added is still there.
      state.seeding = undefined;
      throw error;
    });
  return state.seeding;
}

/**
 * The notes that cite any of these references, as notes rather than as ids:
 * reading them back through the database is what keeps a note deleted in this
 * session from showing up as a backlink to nowhere.
 *
 * Every caller has a set of references, not one — a note cites several, a
 * passage search matches several — so the database is asked once for all of
 * them instead of once per reference in a loop.
 */
export async function notesForAll(refs: Iterable<string>) {
  await ensureIndexed();
  const ids = new Set<string>();
  for (const ref of refs)
    for (const id of notesByRef.get(ref) ?? []) ids.add(id);
  if (ids.size === 0) return [];
  return db.notes.all.fields(["notes.id", "notes.title"]).items([...ids]);
}

/** The notes that cite one reference. */
export function notesFor(ref: string) {
  return notesForAll([ref]);
}

/**
 * Which notes cite a reference, by id and without reading the database. It is
 * how a caller that already holds the notes groups them by passage.
 */
export async function noteIdsFor(ref: string): Promise<string[]> {
  await ensureIndexed();
  return [...(notesByRef.get(ref) ?? [])];
}

/** Every reference any note cites. */
export async function indexedRefs(): Promise<string[]> {
  await ensureIndexed();
  return [...notesByRef.keys()];
}
