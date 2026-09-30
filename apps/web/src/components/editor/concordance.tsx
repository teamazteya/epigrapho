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
  baseStrong,
  concordance,
  lexiconEntry,
  searchOriginalWord,
  type Concordance as Found,
  type OriginalWordMatch
} from "@notesnook/original-languages";
import {
  BOOK_NAMES,
  formatReadableRef,
  parseRef
} from "@notesnook/scripture-parser";
import { strings } from "@notesnook/intl";
import { Box, Button, Flex, Input, Text } from "@theme-ui/components";
import { useEffect, useState } from "react";
import { Section } from "../properties";
import { ScopedThemeProvider } from "../theme-provider";
import { TITLE_BAR_HEIGHT } from "../title-bar";
import { useEditorManager } from "./manager";
import { useEditorStore } from "../../stores/editor-store";
import { getBookNameLocale } from "../../common/ui-locale";
import { getTranslation } from "../../common/translation";
import { resolveVerse } from "../../common/scripture";

// A book with this many occurrences or fewer starts open; above it, a click
// opens it, so a word like אֱלֹהִים does not read 2 600 verses at once.
const OPEN_UP_TO = 40;

type Result =
  | { type: "strong"; found: Found; lemma?: string }
  | { type: "words"; matches: OriginalWordMatch[] }
  | { type: "none" };

/** One occurrence: the verse in the person's translation, and a click that
 * puts its reference in the note. */
function Occurrence({
  sessionId,
  reference,
  count
}: {
  sessionId: string;
  reference: string;
  count: number;
}) {
  const range = parseRef(reference);
  const label = range ? formatReadableRef(range, getBookNameLocale()) : reference;
  const [text, setText] = useState<string>();
  useEffect(() => {
    if (!range) return;
    let alive = true;
    resolveVerse(range, getTranslation())
      .then((verse) => alive && setText(verse.text))
      .catch(() => alive && setText(""));
    return () => {
      alive = false;
    };
  }, [reference]);

  return (
    <Button
      variant="menuitem"
      data-test-id="concordance-occurrence"
      data-ref={reference}
      title={strings.insertReference(label)}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        textAlign: "left",
        py: 1,
        px: 1,
        gap: "2px"
      }}
      onClick={() =>
        useEditorManager
          .getState()
          .getEditor(sessionId)
          ?.editor?.insertText(`${label} `)
      }
    >
      <Text variant="body" sx={{ fontWeight: "bold", color: "accent" }}>
        {label}
        {count > 1 ? ` (×${count})` : ""}
      </Text>
      <Text variant="subBody" sx={{ whiteSpace: "normal" }}>
        {text ?? "…"}
      </Text>
    </Button>
  );
}

function BookGroup({
  sessionId,
  book,
  verses,
  open
}: {
  sessionId: string;
  book: string;
  verses: Found["books"][number]["verses"];
  open: boolean;
}) {
  const [expanded, setExpanded] = useState(open);
  const count = verses.reduce((sum, verse) => sum + verse.count, 0);
  return (
    <Flex sx={{ flexDirection: "column", mb: 1 }} data-test-id="concordance-book">
      <Button
        variant="menuitem"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        sx={{ textAlign: "left", py: 1, px: 1, fontWeight: "bold" }}
      >
        {BOOK_NAMES[getBookNameLocale()][book] || book} ({count})
      </Button>
      {expanded &&
        verses.map((verse) => (
          <Occurrence
            key={verse.ref}
            sessionId={sessionId}
            reference={verse.ref}
            count={verse.count}
          />
        ))}
    </Flex>
  );
}

/**
 * The concordance (A2 Fase 5): every place a Strong number or an original
 * word occurs in the Hebrew and Greek text, never in a translation's tags.
 */
function ConcordancePanel({ sessionId }: { sessionId: string }) {
  const query = useEditorStore((store) => store.concordanceQuery) ?? "";
  const [input, setInput] = useState(query);
  const [result, setResult] = useState<Result>();

  useEffect(() => setInput(query), [query]);
  useEffect(() => {
    if (!query.trim()) return setResult(undefined);
    let alive = true;
    setResult(undefined);
    (async (): Promise<Result> => {
      if (baseStrong(query)) {
        const found = await concordance(query);
        if (!found) return { type: "none" };
        const entry = await lexiconEntry(found.strong);
        return { type: "strong", found, lemma: entry?.[0] };
      }
      const matches = await searchOriginalWord(query);
      return matches.length ? { type: "words", matches } : { type: "none" };
    })()
      .then((next) => alive && setResult(next))
      .catch((error) => {
        console.error("could not search the concordance", error);
        if (alive) setResult({ type: "none" });
      });
    return () => {
      alive = false;
    };
  }, [query]);

  const search = (text: string) =>
    useEditorStore.getState().openConcordance(text);

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
        <Section title={strings.concordance()} sx={{ flex: 1 }}>
          <Flex
            data-test-id="concordance-pane"
            aria-busy={!!query && result === undefined}
            sx={{ flexDirection: "column", p: 1, gap: 1 }}
          >
            <Input
              data-test-id="concordance-input"
              aria-label={strings.concordanceSearch()}
              placeholder={strings.concordanceSearch()}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") search(input);
              }}
              sx={{ fontSize: "body" }}
            />
            {!query ? (
              <Text variant="body" sx={{ color: "paragraph-secondary", p: 1 }}>
                {strings.concordanceHint()}
              </Text>
            ) : result === undefined ? (
              <Text variant="body" sx={{ color: "paragraph-secondary", p: 1 }}>
                {strings.loading()}
              </Text>
            ) : result.type === "none" ? (
              <Text
                data-test-id="concordance-empty"
                variant="body"
                sx={{ color: "paragraph-secondary", p: 1 }}
              >
                {strings.concordanceNothing(query)}
              </Text>
            ) : result.type === "words" ? (
              result.matches.map((match) => (
                <Button
                  key={match.strong}
                  variant="menuitem"
                  data-test-id="concordance-word"
                  sx={{ textAlign: "left", py: 1, px: 1 }}
                  onClick={() => search(match.strong)}
                >
                  <Text
                    as="span"
                    lang={match.strong.startsWith("G") ? "grc" : "he"}
                    sx={{ fontSize: "title", mr: 2 }}
                  >
                    {match.lemma}
                  </Text>
                  <Text as="span" variant="subBody">
                    {match.transliteration} · {match.strong} · {match.glossEn}
                  </Text>
                </Button>
              ))
            ) : (
              <>
                <Box sx={{ px: 1 }}>
                  {result.lemma && (
                    <Text
                      as="p"
                      lang={result.found.corpus === "TAGNT" ? "grc" : "he"}
                      sx={{ fontSize: "title", m: 0 }}
                    >
                      {result.lemma}
                    </Text>
                  )}
                  <Text
                    as="p"
                    data-test-id="concordance-total"
                    variant="subBody"
                    sx={{ m: 0 }}
                  >
                    {strings.concordanceTotal(
                      result.found.total,
                      `STEPBible ${result.found.corpus}`
                    )}
                  </Text>
                </Box>
                {result.found.books.map(({ book, verses }) => (
                  <BookGroup
                    key={`${result.found.strong}-${book}`}
                    sessionId={sessionId}
                    book={book}
                    verses={verses}
                    open={result.found.total <= OPEN_UP_TO}
                  />
                ))}
              </>
            )}
          </Flex>
        </Section>
      </ScopedThemeProvider>
    </Flex>
  );
}

export default ConcordancePanel;
