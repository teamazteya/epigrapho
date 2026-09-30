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
  dictionaryArticle,
  searchDictionary,
  type DictionaryArticle,
  type DictionaryHit
} from "@notesnook/original-languages";
import { strings } from "@notesnook/intl";
import { shortStrong } from "@notesnook/editor";
import { Button, Flex, Input, Text } from "@theme-ui/components";
import { useEffect, useState } from "react";
import { Section } from "../properties";
import { ScopedThemeProvider } from "../theme-provider";
import { TITLE_BAR_HEIGHT } from "../title-bar";
import { useEditorManager } from "./manager";
import { useEditorStore } from "../../stores/editor-store";
import { DICTIONARY_NAMES, dictionaryLanguage } from "../../common/dictionary";

/** One result: its term and dictionary, and the entry once it is opened. */
function Hit({
  sessionId,
  hit,
  inserting
}: {
  sessionId: string;
  hit: DictionaryHit;
  inserting: boolean;
}) {
  const [article, setArticle] = useState<DictionaryArticle | null>();
  const open = article !== undefined;

  return (
    <Flex
      data-test-id="dictionary-hit"
      data-entry-id={hit.id}
      sx={{ flexDirection: "column", mb: 1 }}
    >
      <Button
        variant="menuitem"
        aria-expanded={open}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          textAlign: "left",
          py: 1,
          px: 1
        }}
        onClick={() =>
          open
            ? setArticle(undefined)
            : dictionaryArticle(hit.id)
                .then((found) => setArticle(found ?? null))
                .catch(() => setArticle(null))
        }
      >
        <Text variant="body" sx={{ fontWeight: "bold" }}>
          {hit.term}
        </Text>
        <Text variant="subBody" data-test-id="dictionary-source">
          {DICTIONARY_NAMES[hit.source]}
        </Text>
      </Button>
      {open && (
        <Text
          as="p"
          variant="body"
          lang={dictionaryLanguage(hit.source)}
          data-test-id="dictionary-article"
          sx={{ px: 1, m: 0, whiteSpace: "pre-line", userSelect: "text" }}
        >
          {article?.body ?? strings.dictionaryEntryUnavailable()}
        </Text>
      )}
      {open && !!article?.strongs.length && (
        <Text
          as="p"
          variant="subBody"
          data-test-id="dictionary-strongs"
          sx={{ px: 1, mt: 1, mb: 0 }}
        >
          Strong: {article.strongs.map(shortStrong).join(", ")}
        </Text>
      )}
      {inserting && (
        <Button
          variant="secondary"
          data-test-id="dictionary-insert"
          sx={{ alignSelf: "flex-start", mx: 1, mt: 1 }}
          onClick={() => {
            useEditorManager
              .getState()
              .getEditor(sessionId)
              ?.editor?.insertDictionaryEntry(hit.id, hit.term);
            useEditorStore.setState({ dictionaryPane: undefined });
          }}
        >
          {strings.insertInNote()}
        </Button>
      )}
    </Flex>
  );
}

/**
 * The Bible dictionaries (A2 Fases 6 and 7): search by term, read an entry,
 * and, when the "+" menu opened it, pick one to insert in the note. The
 * Spanish works come first, then the English ones.
 */
function DictionaryPanel({ sessionId }: { sessionId: string }) {
  const pane = useEditorStore((store) => store.dictionaryPane);
  const query = pane?.query ?? "";
  const inserting = !!pane?.inserting;
  const [input, setInput] = useState(query);
  const [hits, setHits] = useState<DictionaryHit[]>();

  useEffect(() => setInput(query), [query]);
  useEffect(() => {
    if (!query.trim()) return setHits(undefined);
    let alive = true;
    setHits(undefined);
    searchDictionary(query)
      .then((found) => alive && setHits(found))
      .catch((error) => {
        console.error("could not search the dictionary", error);
        if (alive) setHits([]);
      });
    return () => {
      alive = false;
    };
  }, [query]);

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
        <Section
          title={
            inserting ? strings.insertDictionaryEntry() : strings.bibleDictionary()
          }
          sx={{ flex: 1 }}
        >
          <Flex
            data-test-id="dictionary-pane"
            aria-busy={!!query && hits === undefined}
            sx={{ flexDirection: "column", p: 1, gap: 1 }}
          >
            <Input
              data-test-id="dictionary-input"
              aria-label={strings.dictionarySearch()}
              placeholder={strings.dictionarySearch()}
              autoFocus
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  useEditorStore.getState().openDictionary(input, inserting);
              }}
              sx={{ fontSize: "body" }}
            />
            {!query ? (
              <Text variant="body" sx={{ color: "paragraph-secondary", p: 1 }}>
                {inserting ? strings.dictionaryPickHint() : strings.dictionaryHint()}
              </Text>
            ) : hits === undefined ? (
              <Text variant="body" sx={{ color: "paragraph-secondary", p: 1 }}>
                {strings.loading()}
              </Text>
            ) : hits.length === 0 ? (
              <Text
                data-test-id="dictionary-empty"
                variant="body"
                sx={{ color: "paragraph-secondary", p: 1 }}
              >
                {strings.dictionaryNothing(query)}
              </Text>
            ) : (
              hits.map((hit) => (
                <Hit
                  key={hit.id}
                  sessionId={sessionId}
                  hit={hit}
                  inserting={inserting}
                />
              ))
            )}
          </Flex>
        </Section>
      </ScopedThemeProvider>
    </Flex>
  );
}

export default DictionaryPanel;
