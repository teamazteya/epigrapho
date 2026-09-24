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
import { safeStorage } from "electron";

import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { net } from "electron";
import { readFile } from "fs/promises";
import { homedir } from "os";
import path from "path";
import {
  API_BIBLE_IDS,
  createApiBibleProvider
} from "@notesnook/scripture-provider";

const t = initTRPC.create();

/**
 * Epigrapho: the API.Bible key never reaches the renderer.
 *
 * It is read here, in the main process, from a file outside the repository,
 * and the request goes out from here too. The renderer asks for a reference
 * and gets words back; it never holds the key, so a compromised page, an
 * extension or a devtools session has nothing to take.
 */
/**
 * Deliberately not app.getPath("appData"): the portable build and the test
 * profiles redirect that into their own folder, and this key belongs to the
 * person, not to an install. So it is read from the account's own config
 * directory, wherever the operating system puts it.
 */
function keyFile() {
  const directory =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(directory, "Epigrapho", "api-bible.key");
}

async function readKey() {
  try {
    const key = (await readFile(keyFile(), "utf8")).trim();
    return key || undefined;
  } catch {
    // No key file is a normal state: the brand translations are simply not
    // available, and the app falls back to the embedded ones.
    return undefined;
  }
}

/**
 * net.fetch rather than the global one: it goes through Chromium's network
 * stack, so it honours the app's proxy settings and, in a test, the offline
 * emulation that cuts the network.
 */
const provider = createApiBibleProvider({
  apiKey: readKey,
  fetch: (...args) => net.fetch(...(args as Parameters<typeof net.fetch>))
});

const reference = z.object({
  book: z.string().max(3),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
  endChapter: z.number().int().positive().optional(),
  endVerse: z.number().int().positive().optional(),
  versification: z.string()
});

export const scriptureRouter = t.router({
  /**
   * The text of a reference in one of the brand translations. Only the three
   * Epigrapho is licensed for are accepted, here as well as in the provider:
   * the key opens hundreds, and neither side of this call may widen that.
   */
  verse: t.procedure
    .input(
      z.object({
        reference,
        translationId: z.enum(
          Object.keys(API_BIBLE_IDS) as [string, ...string[]]
        )
      })
    )
    .query(({ input }) =>
      provider.getVerseText(input.reference, input.translationId)
    )
});
