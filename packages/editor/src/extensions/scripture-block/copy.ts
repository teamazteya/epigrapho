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

const BLOCK = ".scripture-block";
/** The copy control the block renders, which is the only thing that copies. */
const BUTTON = "[data-scripture-copy]";

/**
 * What copying needs from whichever app is showing the block (Fase 8). The
 * reference is written the way the person reads it, which is a matter of the
 * interface language and so belongs to the app; the clipboard, on a phone and
 * on a desktop, is reached differently too.
 */
export type ScriptureCopyOptions = {
  /** A USFM reference as a person reads it, in the app's language. */
  formatReference: (ref: string) => string;
  attributionOf: (translationId: string) => string;
  copy: (text: string) => void | Promise<void>;
};

/**
 * The quoted verse, the reference as a person reads it, the translation and,
 * for translations that carry one, their copyright note.
 */
export function formatVerseForClipboard(
  ref: string,
  text: string,
  translationId: string,
  options: Pick<ScriptureCopyOptions, "formatReference" | "attributionOf">
) {
  // The book name is written in the language the person is reading the app in;
  // the reference itself, in the clipboard as everywhere else, stays USFM.
  const line = `«${text}» — ${options.formatReference(ref)} (${translationId})`;
  const attribution = options.attributionOf(translationId);
  return attribution ? `${line}\n${attribution}` : line;
}

/**
 * Copies a scripture block's verse when its copy button is pressed. Returns
 * the cleanup for the caller's effect.
 *
 * The button is a real one, so the keyboard reaches it and a screen reader
 * says what it does; pressing it is also what a click on the rest of the
 * block no longer means.
 */
export function attachScriptureCopy(
  dom: HTMLElement,
  options: ScriptureCopyOptions
) {
  const onClick = async (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest?.(BUTTON);
    const block = button?.closest?.(BLOCK);
    if (!block) return;
    // The button sits inside the note; pressing it is not an edit of it.
    event.preventDefault();

    const ref = block.getAttribute("data-scripture-ref");
    const text = block
      .querySelector(".scripture-block-text")
      ?.textContent?.trim();
    if (!ref || !text) return;

    const translationId = block.getAttribute("data-translation-id") || "VBL";
    await options.copy(
      formatVerseForClipboard(ref, text, translationId, options)
    );
  };

  dom.addEventListener("click", onClick);
  return () => dom.removeEventListener("click", onClick);
}
