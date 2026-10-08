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
import { attributionOf, getTranslation, resolveVerse } from "./scripture";

/**
 * Sermon mode on a phone (A3 Fase 4, M1 Fase 5c), as on the desktop
 * (apps/web/src/components/sermon-mode): the note, read-only, in large type,
 * with A− and A+, a stopwatch, and a tap on a reference to open its verse.
 *
 * ponytail: the page already shows the note, so this is a copy of what the
 * editor drew, in a `<dialog>` over it — no second renderer and nothing sent
 * back to the app. The back gesture closes it like any dialog here.
 */
const SIZE_KEY = "sermonFontSize";
const SIZES = { min: 18, max: 64, step: 4, initial: 32 };

function storedSize() {
  try {
    const size = Number(localStorage.getItem(SIZE_KEY));
    return size >= SIZES.min && size <= SIZES.max ? size : SIZES.initial;
  } catch {
    return SIZES.initial;
  }
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

async function toggleVerse(reference: HTMLElement) {
  const ref = reference.dataset.scriptureRef;
  const block = reference.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote");
  if (!ref || !block) return;
  const open = block.nextElementSibling as HTMLElement | null;
  if (
    open?.classList.contains("sermon-verse") &&
    open.dataset.scriptureRef === ref
  ) {
    open.remove();
    return;
  }
  const verse = await resolveVerse(ref, getTranslation());
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

export function openSermonMode(title: string, content: HTMLElement) {
  const dialog = document.createElement("dialog");
  dialog.className = "sermon-mode";
  dialog.dataset.testId = "sermon-mode";

  const article = document.createElement("article");
  article.className = "sermon-mode-text";
  article.dataset.testId = "sermon-mode-text";
  article.setAttribute("aria-label", strings.sermonMode.title());
  let size = storedSize();
  article.style.fontSize = `${size}px`;
  const heading = document.createElement("h1");
  heading.textContent = title;
  const body = content.cloneNode(true) as HTMLElement;
  body.removeAttribute("contenteditable");
  body.querySelectorAll("[contenteditable]").forEach((element) => {
    element.removeAttribute("contenteditable");
  });
  article.append(heading, body);

  const controls = document.createElement("div");
  controls.className = "sermon-mode-controls";
  const button = (label: string, testId: string, onClick: () => void) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "scripture-prompt-button";
    element.dataset.testId = testId;
    element.textContent = label;
    element.addEventListener("click", onClick);
    return element;
  };
  const grow = (direction: 1 | -1) => {
    size = Math.min(
      SIZES.max,
      Math.max(SIZES.min, size + direction * SIZES.step)
    );
    article.style.fontSize = `${size}px`;
    try {
      localStorage.setItem(SIZE_KEY, `${size}`);
    } catch {
      // Remembering the size is a convenience.
    }
  };
  const smaller = button("A−", "sermon-smaller", () => grow(-1));
  smaller.setAttribute("aria-label", strings.sermonMode.smaller());
  const larger = button("A+", "sermon-larger", () => grow(1));
  larger.setAttribute("aria-label", strings.sermonMode.larger());

  const timer = document.createElement("span");
  timer.className = "sermon-timer";
  timer.dataset.testId = "sermon-timer";
  let seconds = 0;
  let ticking: ReturnType<typeof setInterval> | undefined;
  const show = () => (timer.textContent = clock(seconds));
  show();
  const toggle = button(
    strings.sermonMode.start(),
    "sermon-timer-toggle",
    () => {
      if (ticking) {
        clearInterval(ticking);
        ticking = undefined;
      } else
        ticking = setInterval(() => {
          seconds++;
          show();
        }, 1000);
      toggle.textContent = ticking
        ? strings.sermonMode.pause()
        : strings.sermonMode.start();
    }
  );
  const reset = button(strings.sermonMode.reset(), "sermon-timer-reset", () => {
    clearInterval(ticking);
    ticking = undefined;
    seconds = 0;
    show();
    toggle.textContent = strings.sermonMode.start();
  });
  const exit = button(strings.sermonMode.exit(), "sermon-exit", () =>
    dialog.close()
  );
  controls.append(smaller, larger, timer, toggle, reset, exit);

  article.addEventListener("click", (event) => {
    const reference = (event.target as Element).closest?.(
      "[data-scripture-ref]"
    );
    if (reference && !reference.classList.contains("sermon-verse"))
      void toggleVerse(reference as HTMLElement);
  });

  dialog.addEventListener("close", () => {
    clearInterval(ticking);
    dialog.remove();
  });
  dialog.append(article, controls);
  document.body.append(dialog);
  dialog.showModal();
}
