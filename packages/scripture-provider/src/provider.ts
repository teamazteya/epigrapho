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

import type { VerseRange } from "@notesnook/scripture-parser";

/**
 * The one shape every layer of scripture text answers to (ADR 0002): the
 * embedded packs, and the online layer for the brand translations. Whoever
 * asks for a verse does not know, and must not care, which one served it.
 *
 * An empty string means this provider has no text for that reference. That is
 * a real answer, not a failure: a translation can be missing a verse, and a
 * provider can be asked for a translation it does not serve. Anything that
 * actually went wrong throws.
 */
export type ScriptureTextProvider = {
  getVerseText(ref: VerseRange, translationId: string): Promise<string>;
};
