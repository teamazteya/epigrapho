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

const SELECTOR = "span[data-scripture-ref]";
/** One popover serves every reference, so one id is enough to point at it. */
const POPOVER_ID = "scripture-popover";
/**
 * How long the popover waits once the pointer leaves. WCAG 1.4.13 asks that
 * what appears on hover can also be reached with the pointer, and the gap
 * between the reference and the box has to be crossable to reach it.
 */
const CLOSE_DELAY = 120;

/** Why what is shown is not the fresh text of the translation asked for. */
export type VerseNotice = "stale" | "fallback";

export type ResolvedVerse = {
  text: string;
  /** The translation the text came from, which is what gets credited. */
  translationId: string;
  notice?: VerseNotice;
};

/**
 * What the popover needs from whichever app is showing it (Fase 8). This
 * package knows the markup and nothing else: the reference stays a USFM
 * string, so the parser is not a dependency here, and where the words come
 * from — a local pack, a saved copy, the network — is the app's business.
 */
export type ScripturePopoverOptions = {
  /** The translation this person reads in, read at the moment of the hover. */
  translation: () => string;
  resolve: (ref: string, translationId: string) => Promise<ResolvedVerse>;
  attributionOf: (translationId: string) => string;
};

let popover: HTMLElement | undefined;
let verseElement: HTMLElement | undefined;
let attributionElement: HTMLElement | undefined;
let noticeElement: HTMLElement | undefined;
/** The reference the popover describes, so the link can be undone on hide. */
let describing: HTMLElement | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped on every hide, so a slow lookup cannot fill a stale popover. */
let request = 0;

function cancelClose() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = undefined;
}

/** Leaves the box up long enough for the pointer to travel onto it. */
function scheduleClose() {
  cancelClose();
  closeTimer = setTimeout(hide, CLOSE_DELAY);
}

function createPopover() {
  // Everything about how this looks is in styles.css, beside the block's. Only
  // where it sits is worked out here, because only that changes per hover.
  const element = document.createElement("div");
  element.id = POPOVER_ID;
  element.className = "scripture-popover";
  element.setAttribute("role", "tooltip");
  element.dataset.testId = "scripture-popover";
  // The box is reachable with the pointer: moving onto it keeps it open, and
  // leaving it closes it the same way leaving the reference does.
  element.addEventListener("pointerenter", cancelClose);
  element.addEventListener("pointerleave", scheduleClose);

  const verse = document.createElement("div");
  verse.className = "scripture-popover-text";
  verse.dataset.testId = "scripture-popover-text";

  const attribution = document.createElement("div");
  attribution.className = "scripture-popover-attribution";
  attribution.dataset.testId = "scripture-popover-attribution";

  // Why this is not the fresh text of what was asked for reads at full
  // strength, not as fine print trailing the credit: it is the one line here
  // that changes what the reader should trust.
  const notice = document.createElement("div");
  notice.className = "scripture-popover-notice";
  notice.dataset.testId = "scripture-popover-notice";
  notice.hidden = true;

  element.append(verse, attribution, notice);
  document.body.append(element);
  verseElement = verse;
  attributionElement = attribution;
  noticeElement = notice;
  return element;
}

function place(target: HTMLElement) {
  if (!popover) return;
  const anchor = target.getBoundingClientRect();
  const gap = 6;
  const size = popover.getBoundingClientRect();

  const below = anchor.bottom + gap;
  const top =
    below + size.height > window.innerHeight
      ? Math.max(gap, anchor.top - gap - size.height)
      : below;
  const left = Math.min(
    Math.max(gap, anchor.left),
    Math.max(gap, window.innerWidth - size.width - gap)
  );

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;

  // The box can still grow after it has been placed: a longer verse rewraps,
  // a font finishes loading. Measuring once more and pulling it back is
  // cheaper and surer than trying to predict the final size, and a popover
  // hanging off the edge of the window is unreadable.
  const placed = popover.getBoundingClientRect();
  const overflow = placed.right - (window.innerWidth - gap);
  if (overflow > 0) popover.style.left = `${Math.max(gap, left - overflow)}px`;
}

/** The line that explains a saved copy or a substitute translation. */
function noticeFor(notice: string | undefined, translationId: string) {
  if (notice === "stale") return strings.scriptureSavedCopy(translationId);
  if (notice === "fallback")
    return strings.scriptureShowingInstead(translationId);
  return "";
}

function hide() {
  cancelClose();
  request++;
  // The reference stops pointing at a box that is no longer there.
  describing?.removeAttribute("aria-describedby");
  describing = undefined;
  popover?.remove();
  popover = undefined;
  verseElement = undefined;
  attributionElement = undefined;
  noticeElement = undefined;
}

async function show(target: HTMLElement, options: ScripturePopoverOptions) {
  cancelClose();
  // Re-entering the same reference — the pointer wobbling, the caret moving
  // inside it — is not a new request.
  if (describing === target && popover) return;

  const ref = target.getAttribute("data-scripture-ref");
  if (!ref) return;

  hide();
  const current = request;
  // Read now, not at module load: the person can change it between two hovers.
  const translationId = options.translation();
  popover = createPopover();
  // Which reference is on show, so a reader — or a test — can tell one
  // popover from the next instead of guessing by its text.
  popover.dataset.scriptureRef = ref;
  // A screen reader stays on the reference and reads the verse as its
  // description; until the words arrive there is nothing worth reading.
  popover.setAttribute("aria-busy", "true");
  describing = target;
  target.setAttribute("aria-describedby", POPOVER_ID);
  if (verseElement) verseElement.textContent = "…";
  if (attributionElement)
    attributionElement.textContent = options.attributionOf(translationId);
  place(target);

  let verse: ResolvedVerse = { text: "", translationId };
  try {
    verse = await options.resolve(ref, translationId);
  } catch (error) {
    console.error("could not read the verse", error);
  }
  // The pointer may have moved on while the pack was being read.
  if (current !== request || !verseElement) return;

  verseElement.textContent =
    verse.text || strings.scriptureNoTextForRef(translationId);
  // Credit what was actually served; the notice below it says why that is not
  // the fresh text of what was asked for.
  if (attributionElement)
    attributionElement.textContent = options.attributionOf(verse.translationId);
  if (noticeElement) {
    const notice = noticeFor(verse.notice, verse.translationId);
    noticeElement.textContent = notice;
    noticeElement.hidden = !notice;
  }
  popover?.setAttribute("aria-busy", "false");
  // Placed again now that the verse is in: the box was measured at its
  // loading size and the words almost always make it wider. Doing it here
  // rather than on the next frame means there is never a frame in which the
  // popover is drawn hanging off the edge of the window.
  place(target);
}

/**
 * The reference the caret sits inside, if it is one this popover serves.
 *
 * Strictly inside: a caret resting against either edge is someone typing next
 * to a reference, and the verse rising over their words while they write is
 * exactly what the preview must not do.
 */
function referenceOf(selection: Selection | null, within: HTMLElement) {
  const node = selection?.focusNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return undefined;
  const offset = selection?.focusOffset ?? 0;
  if (offset === 0 || offset === (node.textContent?.length ?? 0))
    return undefined;

  const reference = node.parentElement?.closest?.(SELECTOR);
  return reference && within.contains(reference)
    ? (reference as HTMLElement)
    : undefined;
}

/**
 * Shows the verse a reference points at when the pointer rests on it, when it
 * is tapped, or when the caret lands inside it. Returns the cleanup for the
 * caller's effect.
 */
export function attachScripturePopover(
  dom: HTMLElement,
  options: ScripturePopoverOptions
) {
  const onPointerOver = (event: PointerEvent) => {
    const target = (event.target as Element | null)?.closest?.(SELECTOR);
    if (target) void show(target as HTMLElement, options);
  };

  const onPointerOut = (event: PointerEvent) => {
    const from = (event.target as Element | null)?.closest?.(SELECTOR);
    const to = (event.relatedTarget as Element | null)?.closest?.(SELECTOR);
    // Heading for the box itself is not leaving: it is how the verse gets read
    // with a magnifier, or selected.
    if (popover?.contains(event.relatedTarget as Node)) return;
    if (from && from !== to) scheduleClose();
  };

  /**
   * The keyboard path. Inside a note the caret is how a person moves, not the
   * tab key, so landing in a reference is what asks for its verse — the same
   * thing resting the pointer on it does.
   */
  const onSelectionChange = () => {
    const target = referenceOf(document.getSelection(), dom);
    if (target) void show(target, options);
    else if (describing) hide();
  };

  // Dismissable without moving the pointer, which hovering alone is not.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && popover) hide();
  };

  /**
   * On a phone a tap fires pointerover and the finger never leaves, so
   * pointerout may never come and the box stays up over the note. Touching
   * anywhere else is what closes it — the same gesture that closes everything
   * else on the screen.
   */
  const onPointerDown = (event: PointerEvent) => {
    if (!popover) return;
    const node = event.target as Node | null;
    if (popover.contains(node)) return;
    // Tapping another reference is a new preview, not a dismissal.
    if ((node as Element | null)?.closest?.(SELECTOR)) return;
    hide();
  };

  dom.addEventListener("pointerover", onPointerOver);
  dom.addEventListener("pointerout", onPointerOut);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown, true);
  // The popover is fixed to the viewport, so anything that moves the text
  // under it has to close it. Passive: closing a box never cancels a scroll,
  // and saying so lets the browser scroll without waiting to hear it.
  window.addEventListener("scroll", hide, { capture: true, passive: true });
  window.addEventListener("resize", hide);

  return () => {
    dom.removeEventListener("pointerover", onPointerOver);
    dom.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("scroll", hide, true);
    window.removeEventListener("resize", hide);
    hide();
  };
}
