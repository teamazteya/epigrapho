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

import {
  setWiktionaryCopy,
  WIKTIONARY_FORMAT,
  wiktionaryInUse
} from "@notesnook/original-languages";
import { create } from "zustand";
import Config from "../utils/config";
import { desktop } from "./desktop-bridge";

/**
 * The weekly Wiktionary copy on the desktop (A6 Fase 6). The main process
 * downloads and installs it (apps/desktop/src/api/dictionary.ts) and serves
 * it under /wiktionary/<folder>/; the browser app keeps the copy it has.
 */
const WEEK = 7 * 24 * 60 * 60 * 1000;
export const AUTO_UPDATE_KEY = "wiktionaryAutoUpdate";
const CHECKED_KEY = "wiktionaryChecked";

export const useWiktionaryStore = create<{ date?: string; busy: boolean }>(
  () => ({ busy: false })
);

const use = (folder: string) => setWiktionaryCopy(`/wiktionary/${folder}/`);

/** At start: the downloaded copy if there is one, then the weekly check. */
export async function startWiktionaryUpdates() {
  if (!desktop) return;
  const copy = await desktop.dictionary.copy.query();
  if (copy) use(copy.folder);
  useWiktionaryStore.setState({ date: (await wiktionaryInUse()).date });
  await checkWiktionaryWeekly();
}

export async function checkWiktionaryWeekly() {
  if (
    Config.get(AUTO_UPDATE_KEY, true) &&
    Date.now() - Config.get(CHECKED_KEY, 0) > WEEK
  )
    await updateWiktionary().catch(console.error);
}

/** Checks now; the copy in use stays if anything fails. */
export async function updateWiktionary() {
  if (!desktop) return;
  useWiktionaryStore.setState({ busy: true });
  try {
    const result = await desktop.dictionary.update.mutate({
      format: WIKTIONARY_FORMAT,
      ...(await wiktionaryInUse())
    });
    Config.set(CHECKED_KEY, Date.now());
    if (result.status === "updated") {
      use(result.copy.folder);
      useWiktionaryStore.setState({ date: result.copy.date });
    }
    return result.status;
  } finally {
    useWiktionaryStore.setState({ busy: false });
  }
}
