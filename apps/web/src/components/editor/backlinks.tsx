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

import {
  extractRefs,
  formatReadableRef,
  parseRef
} from "@notesnook/scripture-parser";
import { strings } from "@notesnook/intl";
import { Box, Button, Flex, Text } from "@theme-ui/components";
import { useEffect, useState } from "react";
import { Section } from "../properties";
import { ScopedThemeProvider } from "../theme-provider";
import { TITLE_BAR_HEIGHT } from "../title-bar";
import { useEditorManager } from "./manager";
import { useEditorStore } from "../../stores/editor-store";
import { noteIdsFor, notesForAll } from "../../common/reference-index";
import { getBookNameLocale } from "../../common/ui-locale";

type Backlink = { ref: string; label: string; notes: BacklinkNote[] };
type BacklinkNote = { id: string; title: string };

/**
 * The passages this note cites, and which other notes cite each of them
 * (PRD §31.10, Paso 5.2). It reads the passages off the open document, so a
 * reference is listed the moment it is written, and asks the reference index
 * who else cites it.
 */
function Backlinks({ sessionId }: { sessionId: string }) {
  const session = useEditorStore((store) =>
    store.getSession(sessionId, ["default", "readonly"])
  );
  const noteId = session && "note" in session ? session.note.id : undefined;
  // Re-read when the note is stored: that is when the index learns what this
  // note now cites, and when another note's edit can change the answer.
  const saveState =
    session && "saveState" in session ? session.saveState : undefined;
  const [backlinks, setBacklinks] = useState<Backlink[] | undefined>();

  useEffect(() => {
    let alive = true;
    (async () => {
      const content = useEditorManager
        .getState()
        .getEditor(sessionId)
        ?.editor?.getContent();
      const locale = getBookNameLocale();
      // A passage cited twice is still one passage, and two groups under the
      // same key is also two React children claiming one id.
      const refs = [...new Set(extractRefs(content || ""))];
      // One query for every passage at once. The index already knows which
      // note belongs to which passage, so the grouping is done here rather
      // than by asking the database once per reference.
      const notes = await notesForAll(refs);
      if (!alive) return;
      const byId = new Map(notes.map((note) => [note.id, note]));

      const found: Backlink[] = [];
      for (const ref of refs) {
        const range = parseRef(ref);
        const cited = await noteIdsFor(ref);
        if (!alive) return;
        found.push({
          ref,
          label: range ? formatReadableRef(range, locale) : ref,
          notes: cited
            // A note is not a backlink to itself, and one deleted since the
            // index last saw it is no longer in the query's answer.
            .filter((id) => id !== noteId)
            .map((id) => byId.get(id))
            .flatMap((note) => (note ? [{ id: note.id, title: note.title }] : []))
        });
      }
      setBacklinks(found);
    })().catch((error) => console.error("could not read backlinks", error));
    return () => {
      alive = false;
    };
  }, [sessionId, noteId, saveState]);

  const withNotes = backlinks?.filter((item) => item.notes.length > 0) ?? [];

  return (
    <Flex
      sx={{
        display: "flex",
        top: TITLE_BAR_HEIGHT,
        zIndex: 999,
        height: "100%",
        borderLeft: "1px solid",
        borderLeftColor: "border"
      }}
    >
      <ScopedThemeProvider
        scope="editorSidebar"
        sx={{
          flex: 1,
          display: "flex",
          bg: "background",
          overflowY: "auto",
          overflowX: "hidden",
          flexDirection: "column"
        }}
      >
        <Section title={strings.verseBacklinks()} sx={{ flex: 1 }}>
          <Flex
            data-test-id="backlinks-pane"
            aria-busy={backlinks === undefined}
            sx={{ flexDirection: "column", p: 1 }}
          >
            {backlinks === undefined ? (
              // The first ask reads the whole library to learn what cites
              // what. An empty pane for those seconds reads as a broken one.
              <Flex
                data-test-id="backlinks-loading"
                sx={{ flexDirection: "column", gap: 2, p: 1 }}
              >
                {["70%", "45%", "60%"].map((width) => (
                  <Box
                    key={width}
                    sx={{
                      width,
                      height: 12,
                      borderRadius: "default",
                      bg: "background-secondary"
                    }}
                  />
                ))}
              </Flex>
            ) : backlinks.length === 0 ? (
              <Text
                data-test-id="backlinks-empty"
                variant="body"
                sx={{ p: 1, color: "paragraph-secondary" }}
              >
                {strings.noteCitesNoPassages()}
              </Text>
            ) : withNotes.length === 0 ? (
              <Text
                data-test-id="backlinks-empty"
                variant="body"
                sx={{ p: 1, color: "paragraph-secondary" }}
              >
                {strings.noVerseBacklinks()}
              </Text>
            ) : (
              withNotes.map((item) => (
                <Flex
                  key={item.ref}
                  data-test-id="backlink-group"
                  data-backlink-ref={item.ref}
                  sx={{ flexDirection: "column", mb: 2 }}
                >
                  <Text
                    as="h3"
                    data-test-id="backlink-reference"
                    variant="subBody"
                    sx={{
                      px: 1,
                      py: 1,
                      m: 0,
                      color: "accent",
                      fontWeight: "bold"
                    }}
                  >
                    {item.label}
                  </Text>
                  {item.notes.map((note) => (
                    <Button
                      key={note.id}
                      data-test-id="backlink-note"
                      variant="menuitem"
                      sx={{ textAlign: "left", py: 1 }}
                      onClick={() =>
                        useEditorStore.getState().openSession(note.id)
                      }
                    >
                      <Text variant="body">{note.title}</Text>
                    </Button>
                  ))}
                </Flex>
              ))
            )}
          </Flex>
        </Section>
      </ScopedThemeProvider>
    </Flex>
  );
}

export default Backlinks;
