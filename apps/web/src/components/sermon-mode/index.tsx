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

// Epigrapho (A3 Fase 4): sermon mode. The note, read-only, filling the
// screen in large type, with the few controls a preacher needs. One window
// only; no second screen.
import { Note, sanitizeHtml } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { parseRef } from "@notesnook/scripture-parser";
import { attributionOf } from "@notesnook/scripture-provider";
import { Box, Button, Flex, Text } from "@theme-ui/components";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BaseDialogProps, DialogManager } from "../../common/dialog-manager";
import { db } from "../../common/db";
import { resolveVerse } from "../../common/scripture";
import { getTranslation } from "../../common/translation";
import { useEditorStore } from "../../stores/editor-store";
import Config from "../../utils/config";
import { useEditorManager } from "../editor/manager";
import { ScopedThemeProvider } from "../theme-provider";

const SIZE_KEY = "sermonFontSize";
const SIZES = { min: 18, max: 64, step: 4, initial: 32 };

/** What the person sees: an open editor may hold edits not yet saved. */
async function noteHtml(note: Note) {
  const open = useEditorStore
    .getState()
    .getSessionsForNote(note.id)
    .map((session) => useEditorManager.getState().getEditor(session.id))
    .find((editor) => editor?.editor);
  if (open?.editor) return open.editor.getContent();
  const content = note.contentId && (await db.content.get(note.contentId));
  return content && !content.locked && typeof content.data === "string"
    ? content.data
    : "";
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * A tap on a reference opens its verse under the paragraph it sits in, and a
 * second tap closes it.
 */
async function toggleVerse(reference: HTMLElement) {
  const ref = reference.dataset.scriptureRef;
  const block = reference.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote");
  if (!ref || !block) return;
  const open = block.nextElementSibling;
  if (
    open?.classList.contains("sermon-verse") &&
    (open as HTMLElement).dataset.scriptureRef === ref
  ) {
    open.remove();
    return;
  }
  const range = parseRef(ref);
  if (!range) return;
  const verse = await resolveVerse(range, getTranslation());
  const box = document.createElement("div");
  box.className = "sermon-verse";
  box.dataset.scriptureRef = ref;
  box.dataset.testId = "sermon-verse";
  const text = document.createElement("p");
  text.textContent = verse.text;
  const credit = document.createElement("p");
  credit.className = "sermon-verse-credit";
  credit.textContent = `${reference.textContent} · ${attributionOf(
    verse.translationId
  )}`;
  box.append(text, credit);
  block.after(box);
}

type SermonModeProps = BaseDialogProps<false> & { note: Note };

export const SermonMode = DialogManager.register(function SermonMode(
  props: SermonModeProps
) {
  const { note, onClose } = props;
  const root = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string>();
  const [size, setSize] = useState(() =>
    Config.get<number>(SIZE_KEY, SIZES.initial)
  );
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    noteHtml(note).then((data) => setHtml(sanitizeHtml(data)));
  }, [note]);

  // The whole screen, through the platform's own full screen: leaving it
  // (Esc, or the system's gesture) is leaving sermon mode.
  useEffect(() => {
    const element = root.current;
    element?.requestFullscreen?.().catch(() => undefined);
    const onChange = () => {
      if (!document.fullscreenElement) onClose(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose(false);
      else if (event.key === "+" || event.key === "=") grow(1);
      else if (event.key === "-") grow(-1);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
      if (document.fullscreenElement)
        document.exitFullscreen().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  function grow(direction: 1 | -1) {
    setSize((current) => {
      const next = Math.min(
        SIZES.max,
        Math.max(SIZES.min, current + direction * SIZES.step)
      );
      Config.set(SIZE_KEY, next);
      return next;
    });
  }

  // The dialog manager renders into a detached element; dialogs reach the page
  // through react-modal's portal, and this one through its own.
  return createPortal(
    <ScopedThemeProvider scope="base" injectCssVars>
      <Box
        ref={root}
        data-test-id="sermon-mode"
        className="sermon-mode"
        onClick={(event) => {
          const reference = (event.target as Element).closest?.(
            "[data-scripture-ref]"
          );
          if (reference && !reference.classList.contains("sermon-verse"))
            void toggleVerse(reference as HTMLElement);
        }}
        sx={{
          position: "fixed",
          inset: 0,
          zIndex: 2147482000,
          overflowY: "auto",
          bg: "background",
          color: "paragraph",
          fontFamily: "body"
        }}
      >
        <article
          className="sermon-mode-text"
          data-test-id="sermon-mode-text"
          style={{ fontSize: size }}
          aria-label={strings.sermonMode.title()}
        >
          <h1>{note.title}</h1>
          {html !== undefined && (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </article>

        <Flex
          className="sermon-mode-controls"
          sx={{
            position: "fixed",
            right: 3,
            bottom: 3,
            gap: 1,
            alignItems: "center",
            p: 1,
            bg: "background-secondary",
            border: "1px solid var(--border)",
            borderRadius: "default"
          }}
        >
          <Button
            variant="secondary"
            title={strings.sermonMode.smaller()}
            aria-label={strings.sermonMode.smaller()}
            data-test-id="sermon-smaller"
            onClick={() => grow(-1)}
          >
            A−
          </Button>
          <Button
            variant="secondary"
            title={strings.sermonMode.larger()}
            aria-label={strings.sermonMode.larger()}
            data-test-id="sermon-larger"
            onClick={() => grow(1)}
          >
            A+
          </Button>
          <Text
            data-test-id="sermon-timer"
            sx={{
              fontVariantNumeric: "tabular-nums",
              minWidth: 56,
              textAlign: "center"
            }}
          >
            {clock(seconds)}
          </Text>
          <Button
            variant="secondary"
            data-test-id="sermon-timer-toggle"
            onClick={() => setRunning(!running)}
          >
            {running ? strings.sermonMode.pause() : strings.sermonMode.start()}
          </Button>
          <Button
            variant="secondary"
            data-test-id="sermon-timer-reset"
            onClick={() => {
              setRunning(false);
              setSeconds(0);
            }}
          >
            {strings.sermonMode.reset()}
          </Button>
          <Button
            variant="secondary"
            data-test-id="sermon-exit"
            onClick={() => onClose(false)}
          >
            {strings.sermonMode.exit()}
          </Button>
        </Flex>
      </Box>
    </ScopedThemeProvider>,
    document.body
  );
});
