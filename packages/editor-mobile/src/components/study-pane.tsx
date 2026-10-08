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

import { shortStrong } from "@notesnook/editor";
import { strings } from "@notesnook/intl";
import {
  baseStrong,
  concordance,
  dictionaryArticle,
  lexiconEntry,
  searchDictionary,
  searchOriginalWord,
  type Concordance,
  type DictionaryArticle,
  type DictionaryHit,
  type OriginalWordMatch
} from "@notesnook/original-languages";
import { BOOK_NAMES } from "@notesnook/scripture-parser";
import { useEffect, useState } from "react";
import {
  formatReference,
  getBookNameLocale,
  getTranslation,
  resolveVerse
} from "../common/scripture";
import {
  DICTIONARY_NAMES,
  dictionaryLanguage,
  useStudyPane
} from "../common/study";

// A book with this many occurrences or fewer starts open, as on the desktop.
const OPEN_UP_TO = 40;

/** One occurrence: the verse in the chosen translation; a tap puts its
 * reference in the note. */
function Occurrence({
  reference,
  count
}: {
  reference: string;
  count: number;
}) {
  const label = formatReference(reference);
  const [text, setText] = useState<string>();
  useEffect(() => {
    let alive = true;
    resolveVerse(reference, getTranslation())
      .then((verse) => alive && setText(verse.text))
      .catch(() => alive && setText(""));
    return () => {
      alive = false;
    };
  }, [reference]);

  return (
    <button
      className="study-item"
      data-test-id="concordance-occurrence"
      data-ref={reference}
      aria-label={strings.insertReference(label)}
      onClick={() => {
        const { editor, close } = useStudyPane.getState();
        editor?.chain().focus().insertContent(`${label} `).run();
        close();
      }}
    >
      <strong>
        {label}
        {count > 1 ? ` (×${count})` : ""}
      </strong>
      <span>{text ?? "…"}</span>
    </button>
  );
}

function BookGroup({
  book,
  verses,
  open
}: {
  book: string;
  verses: Concordance["books"][number]["verses"];
  open: boolean;
}) {
  const [expanded, setExpanded] = useState(open);
  const count = verses.reduce((sum, verse) => sum + verse.count, 0);
  return (
    <div data-test-id="concordance-book">
      <button
        className="study-item study-heading"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {BOOK_NAMES[getBookNameLocale()][book] || book} ({count})
      </button>
      {expanded &&
        verses.map((verse) => (
          <Occurrence
            key={verse.ref}
            reference={verse.ref}
            count={verse.count}
          />
        ))}
    </div>
  );
}

type Found =
  | { type: "strong"; found: Concordance; lemma?: string }
  | { type: "words"; matches: OriginalWordMatch[] }
  | { type: "none" };

function ConcordanceResults({ query }: { query: string }) {
  const [result, setResult] = useState<Found>();
  useEffect(() => {
    let alive = true;
    setResult(undefined);
    (async (): Promise<Found> => {
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

  if (!result) return <p className="study-note">{strings.loading()}</p>;
  if (result.type === "none")
    return (
      <p className="study-note" data-test-id="concordance-empty">
        {strings.concordanceNothing(query)}
      </p>
    );
  if (result.type === "words")
    return (
      <>
        {result.matches.map((match) => (
          <button
            key={match.strong}
            className="study-item"
            data-test-id="concordance-word"
            onClick={() =>
              useStudyPane
                .getState()
                .open({ type: "concordance", query: match.strong })
            }
          >
            <strong lang={match.strong.startsWith("G") ? "grc" : "he"}>
              {match.lemma}
            </strong>
            <span>
              {match.transliteration} · {match.strong} · {match.glossEn}
            </span>
          </button>
        ))}
      </>
    );
  return (
    <>
      {result.lemma && (
        <p
          className="study-lemma"
          lang={result.found.corpus === "TAGNT" ? "grc" : "he"}
        >
          {result.lemma}
        </p>
      )}
      <p className="study-note" data-test-id="concordance-total">
        {strings.concordanceTotal(
          result.found.total,
          `STEPBible ${result.found.corpus}`
        )}
      </p>
      {result.found.books.map(({ book, verses }) => (
        <BookGroup
          key={`${result.found.strong}-${book}`}
          book={book}
          verses={verses}
          open={result.found.total <= OPEN_UP_TO}
        />
      ))}
    </>
  );
}

function Hit({ hit, inserting }: { hit: DictionaryHit; inserting: boolean }) {
  const [article, setArticle] = useState<DictionaryArticle | null>();
  const open = article !== undefined;
  return (
    <div data-test-id="dictionary-hit" data-entry-id={hit.id}>
      <button
        className="study-item"
        aria-expanded={open}
        onClick={() =>
          open
            ? setArticle(undefined)
            : dictionaryArticle(hit.id)
                .then((found) => setArticle(found ?? null))
                .catch(() => setArticle(null))
        }
      >
        <strong>{hit.term}</strong>
        <span data-test-id="dictionary-source">
          {DICTIONARY_NAMES[hit.source]}
        </span>
      </button>
      {open && (
        <p
          className="study-article"
          lang={dictionaryLanguage(hit.source)}
          data-test-id="dictionary-article"
        >
          {article?.body ?? strings.dictionaryEntryUnavailable()}
        </p>
      )}
      {open && !!article?.strongs.length && (
        <p className="study-note" data-test-id="dictionary-strongs">
          Strong: {article.strongs.map(shortStrong).join(", ")}
        </p>
      )}
      {inserting && (
        <button
          className="scripture-prompt-button study-insert"
          data-primary="true"
          data-test-id="dictionary-insert"
          onClick={() => {
            const { editor, close } = useStudyPane.getState();
            editor
              ?.chain()
              .focus()
              .insertDictionaryEntry({ id: hit.id, label: hit.term })
              .run();
            close();
          }}
        >
          {strings.insertInNote()}
        </button>
      )}
    </div>
  );
}

function DictionaryResults({
  query,
  inserting
}: {
  query: string;
  inserting: boolean;
}) {
  const [hits, setHits] = useState<DictionaryHit[]>();
  useEffect(() => {
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

  if (!hits) return <p className="study-note">{strings.loading()}</p>;
  if (!hits.length)
    return (
      <p className="study-note" data-test-id="dictionary-empty">
        {strings.dictionaryNothing(query)}
      </p>
    );
  return (
    <>
      {hits.map((hit) => (
        <Hit key={hit.id} hit={hit} inserting={inserting} />
      ))}
    </>
  );
}

/**
 * The concordance and the Bible dictionaries (A2 Fases 5–7) on a phone: a
 * sheet over the note, where the desktop has a side panel. It opens from the
 * lexicon ("concordance") and from the "+" menu (a dictionary entry).
 */
export function StudyPane() {
  const pane = useStudyPane((state) => state.pane);
  const [input, setInput] = useState("");
  useEffect(() => setInput(pane?.query ?? ""), [pane]);
  if (!pane) return null;

  const concordancePane = pane.type === "concordance";
  const inserting = pane.type === "dictionary" && pane.inserting;
  const title = concordancePane
    ? strings.concordance()
    : inserting
    ? strings.insertDictionaryEntry()
    : strings.bibleDictionary();
  const placeholder = concordancePane
    ? strings.concordanceSearch()
    : strings.dictionarySearch();
  const search = () =>
    useStudyPane.getState().open({ ...pane, query: input.trim() });

  return (
    <div
      className="study-pane"
      // ponytail: read, not subscribed — useSafeArea keeps one listener, the
      // editor's, and the insets do not change while the sheet is open.
      style={{
        paddingTop: 12 + (globalThis.safeAreaController?.previous?.top || 0),
        paddingBottom:
          12 + (globalThis.safeAreaController?.previous?.bottom || 0)
      }}
      role="dialog"
      aria-label={title}
      data-test-id={concordancePane ? "concordance-pane" : "dictionary-pane"}
    >
      <div className="study-header">
        <h3>{title}</h3>
        <button
          className="scripture-prompt-button"
          data-test-id="study-close"
          onClick={() => useStudyPane.getState().close()}
        >
          {strings.close()}
        </button>
      </div>
      <input
        className="scripture-prompt-input"
        data-test-id={
          concordancePane ? "concordance-input" : "dictionary-input"
        }
        aria-label={placeholder}
        placeholder={placeholder}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") search();
        }}
      />
      <div className="study-results">
        {!pane.query ? (
          <p className="study-note">
            {concordancePane
              ? strings.concordanceHint()
              : inserting
              ? strings.dictionaryPickHint()
              : strings.dictionaryHint()}
          </p>
        ) : concordancePane ? (
          <ConcordanceResults query={pane.query} />
        ) : (
          <DictionaryResults query={pane.query} inserting={inserting} />
        )}
      </div>
    </div>
  );
}
