/*
This file is part of the Notesnook project (https://notesnook.com/)

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

import { DOMSerializer, type DOMOutputSpec } from "@tiptap/pm/model";

/** Providers keep real verse numbers as portable [16] markers, never counters. */
export function verseTextMarkup(text: string): (DOMOutputSpec | string)[] {
  return text.split("\n").map<DOMOutputSpec | string>((line) => {
    const match = /^\[(\d+[a-z]?(?:[-–]\d+[a-z]?)?)\]\s*(.*)$/i.exec(line);
    if (!match) return line;
    return [
      "span",
      { "data-verse-line": "true", style: "display:block" },
      [
        "sup",
        {
          "data-verse-number": match[1],
          style:
            "font-size:0.75em;line-height:0;color:var(--paragraph-secondary,#4a5468)"
        },
        match[1]
      ],
      ` ${match[2]}`
    ];
  });
}

export function renderVerseText(element: HTMLElement, text: string) {
  element.replaceChildren(
    ...verseTextMarkup(text).map((part) =>
      typeof part === "string"
        ? element.ownerDocument.createTextNode(part)
        : DOMSerializer.renderSpec(element.ownerDocument, part).dom
    )
  );
}

/** Restore the portable text when reopening, copying or exporting saved HTML. */
export function readVerseText(element: Element | null): string {
  if (!element) return "";
  const lines = [...element.querySelectorAll("[data-verse-line]")];
  if (!lines.length) return element.textContent || "";
  return lines
    .map((line) => {
      const number = line.querySelector("[data-verse-number]");
      const label = number?.getAttribute("data-verse-number");
      return label && /^\d+[a-z]?(?:[-–]\d+[a-z]?)?$/i.test(label)
        ? `[${label}] ${(line.textContent || "")
            .slice(number?.textContent?.length || 0)
            .trimStart()}`
        : line.textContent || "";
    })
    .join("\n");
}
