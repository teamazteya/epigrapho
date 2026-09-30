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

import { Extension } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { strings } from "@notesnook/intl";

/** One finding of the grammar checker, with offsets into the text it was given. */
export type GrammarMatch = {
  offset: number;
  length: number;
  message: string;
  ruleId: string;
  replacements: string[];
};

export type GrammarCheckOptions = {
  /**
   * Checks one paragraph of plain text. The checker lives outside this
   * package (ADR-0010), so the app injects it; left undefined, nothing is
   * checked.
   */
  check?: (text: string) => Promise<GrammarMatch[]>;
  /** Remembers that the person dismissed this finding in this note. */
  ignore?: (key: string) => void;
  /** Milliseconds of quiet typing before the edited paragraphs are checked. */
  debounce: number;
};

type Finding = GrammarMatch & { key: string };

type State = {
  decorations: DecorationSet;
  /** Start positions of the paragraphs that need a check. */
  dirty: number[];
  /** Paragraphs being checked, by request id, so their positions keep up with edits. */
  inflight: Record<number, number>;
};

type Meta =
  | { take: Record<number, number> }
  | { result: { id: number; text: string; matches: GrammarMatch[] } }
  | { recheck: true }
  | { ignore: string };

export const grammarCheckKey = new PluginKey<State>("grammarCheck");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    grammarCheck: {
      /** Checks every paragraph again, e.g. after the checker was switched. */
      recheckGrammar: () => ReturnType;
    };
  }
}

/** The key a dismissal is stored under: the rule and the words it flagged. */
export function findingKey(ruleId: string, text: string) {
  return `${ruleId}:${text}`;
}

/** The paragraphs grammar is checked in: text, not code. */
function isCheckable(node: ProseMirrorNode) {
  return node.isTextblock && !node.type.spec.code;
}

/**
 * The words of a paragraph, one character per document position: leaf nodes
 * become a placeholder, so an offset the checker reports is a position.
 */
function textOf(doc: ProseMirrorNode, pos: number) {
  const node = doc.nodeAt(pos);
  if (!node || !isCheckable(node)) return undefined;
  return doc.textBetween(pos + 1, pos + 1 + node.content.size, undefined, "￼");
}

function allParagraphs(doc: ProseMirrorNode) {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (isCheckable(node)) found.push(pos);
    return !node.isTextblock;
  });
  return found;
}

/** The paragraphs a transaction touched, in the new document. */
function touched(tr: Transaction) {
  const found = new Set<number>();
  tr.steps.forEach((step, index) => {
    const rest = tr.mapping.slice(index + 1);
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = rest.map(newStart, -1);
      const to = Math.min(rest.map(newEnd, 1), tr.doc.content.size);
      tr.doc.nodesBetween(Math.max(0, from - 1), to, (node, pos) => {
        if (isCheckable(node)) found.add(pos);
        return !node.isTextblock;
      });
    });
  });
  return [...found];
}

function withoutParagraph(
  decorations: DecorationSet,
  doc: ProseMirrorNode,
  pos: number
) {
  const node = doc.nodeAt(pos);
  if (!node) return decorations;
  return decorations.remove(decorations.find(pos, pos + node.nodeSize));
}

function apply(tr: Transaction, previous: State, state: EditorState): State {
  const meta = tr.getMeta(grammarCheckKey) as Meta | undefined;
  let decorations = previous.decorations.map(tr.mapping, tr.doc);
  let dirty = previous.dirty.map((pos) => tr.mapping.map(pos));
  const inflight: Record<number, number> = {};
  for (const [id, pos] of Object.entries(previous.inflight))
    inflight[Number(id)] = tr.mapping.map(pos);

  if (tr.docChanged) {
    for (const pos of touched(tr)) {
      decorations = withoutParagraph(decorations, tr.doc, pos);
      dirty.push(pos);
    }
  }

  if (meta && "take" in meta) {
    dirty = [];
    Object.assign(inflight, meta.take);
  }

  if (meta && "recheck" in meta) {
    decorations = DecorationSet.empty;
    dirty = allParagraphs(state.doc);
  }

  if (meta && "ignore" in meta) {
    decorations = decorations.remove(
      decorations.find(undefined, undefined, (spec) => spec.key === meta.ignore)
    );
  }

  if (meta && "result" in meta) {
    const { id, text, matches } = meta.result;
    const pos = inflight[id];
    delete inflight[id];
    if (pos !== undefined) {
      // Edited while it was being checked: the answer is about words that are
      // no longer there, so the paragraph goes back in the queue.
      if (textOf(tr.doc, pos) !== text) dirty.push(pos);
      else {
        decorations = withoutParagraph(decorations, tr.doc, pos).add(
          tr.doc,
          matches.map((match) => {
            const from = pos + 1 + match.offset;
            const finding: Finding = {
              ...match,
              key: findingKey(
                match.ruleId,
                text.slice(match.offset, match.offset + match.length)
              )
            };
            return Decoration.inline(
              from,
              from + match.length,
              { class: "grammar-error", "data-grammar-rule": match.ruleId },
              finding
            );
          })
        );
      }
    }
  }

  return { decorations, dirty: [...new Set(dirty)], inflight };
}

let nextRequest = 0;

/** Checks the queued paragraphs one after another; the checker is one process. */
async function checkQueued(
  view: EditorView,
  check: NonNullable<GrammarCheckOptions["check"]>
) {
  const state = grammarCheckKey.getState(view.state);
  if (!state?.dirty.length) return;
  const take: Record<number, number> = {};
  const texts: Record<number, string> = {};
  for (const pos of state.dirty) {
    const text = textOf(view.state.doc, pos);
    if (text === undefined) continue;
    const id = nextRequest++;
    take[id] = pos;
    texts[id] = text;
  }
  view.dispatch(
    view.state.tr
      .setMeta(grammarCheckKey, { take } satisfies Meta)
      .setMeta("addToHistory", false)
  );
  for (const [id, text] of Object.entries(texts)) {
    let matches: GrammarMatch[] = [];
    // An empty line has nothing to say; it still answers, to leave the queue.
    if (text.trim()) {
      try {
        matches = await check(text);
      } catch (error) {
        console.error("grammar check failed", error);
      }
    }
    if (view.isDestroyed) return;
    view.dispatch(
      view.state.tr
        .setMeta(grammarCheckKey, {
          result: { id: Number(id), text, matches }
        } satisfies Meta)
        .setMeta("addToHistory", false)
    );
  }
}

type GrammarStorage = {
  timer: ReturnType<typeof setTimeout> | undefined;
  running: boolean;
};

export const GrammarCheck = Extension.create<
  GrammarCheckOptions,
  GrammarStorage
>({
  name: "grammarCheck",

  addOptions() {
    return { check: undefined, ignore: undefined, debounce: 800 };
  },

  addStorage() {
    // On the editor, not the view: the view is swapped while typing (see the
    // scripture reference extension, which learned this first).
    return { timer: undefined, running: false };
  },

  onDestroy() {
    if (this.storage.timer) clearTimeout(this.storage.timer);
    hidePopover();
  },

  addCommands() {
    return {
      recheckGrammar:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch)
            tr.setMeta(grammarCheckKey, {
              recheck: true
            } satisfies Meta).setMeta("addToHistory", false);
          return true;
        }
    };
  },

  addProseMirrorPlugins() {
    const { check, ignore, debounce } = this.options;
    if (!check) return [];
    const editor = this.editor;
    const storage = this.storage;

    const schedule = () => {
      if (storage.timer) clearTimeout(storage.timer);
      storage.timer = setTimeout(async () => {
        if (editor.isDestroyed || storage.running) return;
        storage.running = true;
        try {
          await checkQueued(editor.view, check);
        } finally {
          storage.running = false;
        }
        // Edits that arrived during the round are next.
        if (
          !editor.isDestroyed &&
          grammarCheckKey.getState(editor.state)?.dirty.length
        )
          schedule();
      }, debounce);
    };

    return [
      new Plugin<State>({
        key: grammarCheckKey,
        state: {
          // A note that opens is checked whole, once.
          init: (_, state) => ({
            decorations: DecorationSet.empty,
            dirty: allParagraphs(state.doc),
            inflight: {}
          }),
          apply: (tr, value, _old, state) => apply(tr, value, state)
        },
        props: {
          decorations: (state) => grammarCheckKey.getState(state)?.decorations,
          handleClick: (view, pos) => {
            const found = grammarCheckKey
              .getState(view.state)
              ?.decorations.find(pos, pos);
            const decoration = found?.[0];
            if (!decoration) {
              hidePopover();
              return false;
            }
            showPopover(view, decoration, ignore);
            return false;
          },
          handleDOMEvents: {
            /**
             * The keyboard path, and the right click: the context-menu key or
             * Shift+F10 on a marked word opens the same box, with the first
             * suggestion focused, instead of the native menu.
             */
            contextmenu: (view, event) => {
              const at =
                event.clientX || event.clientY
                  ? view.posAtCoords({
                      left: event.clientX,
                      top: event.clientY
                    })?.pos
                  : view.state.selection.head;
              if (at === undefined) return false;
              const decoration = grammarCheckKey
                .getState(view.state)
                ?.decorations.find(at, at)[0];
              if (!decoration) return false;
              event.preventDefault();
              showPopover(view, decoration, ignore, true);
              return true;
            }
          }
        },
        view: () => {
          schedule();
          return {
            update(view) {
              if (grammarCheckKey.getState(view.state)?.dirty.length)
                schedule();
            }
          };
        }
      })
    ];
  }
});

let popover: HTMLElement | undefined;
let onOutside: ((event: PointerEvent) => void) | undefined;
let onKey: ((event: KeyboardEvent) => void) | undefined;

function hidePopover() {
  popover?.remove();
  popover = undefined;
  if (onOutside) document.removeEventListener("pointerdown", onOutside, true);
  if (onKey) document.removeEventListener("keydown", onKey, true);
  onOutside = undefined;
  onKey = undefined;
}

/**
 * What the checker found, where it found it: the explanation, the words it
 * suggests, and a way to leave it be. Nothing changes until the person picks.
 */
function showPopover(
  view: EditorView,
  decoration: Decoration,
  ignore: GrammarCheckOptions["ignore"],
  focus = false
) {
  hidePopover();
  const finding = decoration.spec as Finding;
  const { from, to } = decoration;

  const element = document.createElement("div");
  element.className = "grammar-popover";
  element.setAttribute("role", "dialog");
  element.dataset.testId = "grammar-popover";

  const message = document.createElement("div");
  message.className = "grammar-popover-message";
  message.textContent = finding.message;
  element.append(message);

  const actions = document.createElement("div");
  actions.className = "grammar-popover-actions";
  for (const replacement of finding.replacements) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "grammar-popover-replacement";
    button.dataset.testId = "grammar-replacement";
    button.textContent = replacement;
    button.addEventListener("click", () => {
      hidePopover();
      view.dispatch(view.state.tr.insertText(replacement, from, to));
      view.focus();
    });
    actions.append(button);
  }
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "grammar-popover-ignore";
  dismiss.dataset.testId = "grammar-ignore";
  dismiss.textContent = strings.grammarIgnore();
  dismiss.addEventListener("click", () => {
    hidePopover();
    ignore?.(finding.key);
    view.dispatch(
      view.state.tr
        .setMeta(grammarCheckKey, { ignore: finding.key } satisfies Meta)
        .setMeta("addToHistory", false)
    );
    view.focus();
  });
  actions.append(dismiss);
  element.append(actions);
  document.body.append(element);
  popover = element;

  // Below the words, pulled back inside the window like the verse preview.
  const anchor = view.coordsAtPos(from);
  const size = element.getBoundingClientRect();
  const gap = 6;
  const top =
    anchor.bottom + gap + size.height > window.innerHeight
      ? Math.max(gap, anchor.top - gap - size.height)
      : anchor.bottom + gap;
  const left = Math.min(
    Math.max(gap, anchor.left),
    Math.max(gap, window.innerWidth - size.width - gap)
  );
  element.style.top = `${top}px`;
  element.style.left = `${left}px`;

  onOutside = (event) => {
    if (!element.contains(event.target as Node)) hidePopover();
  };
  onKey = (event) => {
    if (event.key !== "Escape") return;
    // Back to the words, if the box had taken the focus from them.
    const hadFocus = element.contains(document.activeElement);
    hidePopover();
    if (hadFocus) view.focus();
  };
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  if (focus) actions.querySelector("button")?.focus();
}
