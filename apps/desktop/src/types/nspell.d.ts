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

/**
 * nspell ships no types, and @types/nspell would be a fourth library where A1
 * allows three. What is used of it is this much.
 */
declare module "nspell" {
  type Dictionary = { aff: Buffer | string; dic: Buffer | string };
  type Speller = {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): Speller;
    remove(word: string): Speller;
  };
  export default function nspell(dictionary: Dictionary): Speller;
}
