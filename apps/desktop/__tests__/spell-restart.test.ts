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

import { expect, test, vi } from "vitest";
import type { EventEmitter } from "node:events";
const state = vi.hoisted(() => ({
  workers: [] as (EventEmitter & { postMessage: ReturnType<typeof vi.fn> })[]
}));
vi.mock("electron", () => ({
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() }
}));
vi.mock("../src/utils/config", () => ({
  config: { spellCheckerLanguages: ["es"], isSpellCheckerEnabled: true }
}));
vi.mock("../src/utils/user-dictionary", () => ({
  userDictionary: { accepts: () => false }
}));
vi.mock("worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      postMessage = vi.fn();
      terminate = vi.fn(async () => undefined);
      constructor() {
        super();
        state.workers.push(this);
      }
      unref() {}
    }
  };
});
import {
  restartSpellChecker,
  spellingSuggestions
} from "../src/utils/spell-check";

test("an old worker exiting after a language change cannot cancel its replacement's answers", async () => {
  const first = spellingSuggestions("qe");
  const old = state.workers[0];
  old.emit("message", {
    id: old.postMessage.mock.calls[0][0].id,
    suggestions: ["que"],
    misspelled: []
  });
  expect(await first).toEqual(["que"]);
  restartSpellChecker();
  const second = spellingSuggestions("oy");
  const current = state.workers[1];
  old.emit("exit", 0);
  current.emit("message", {
    id: current.postMessage.mock.calls[0][0].id,
    suggestions: ["hoy"],
    misspelled: []
  });
  expect(await second).toEqual(["hoy"]);
  restartSpellChecker();
});
