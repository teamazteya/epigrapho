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

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";

const state = vi.hoisted(() => ({
  config: { isGrammarCheckerEnabled: true, grammarStyleRules: false },
  languages: ["es", "en"]
}));
vi.mock("../src/utils/config", () => ({ config: state.config }));
vi.mock("../src/utils/spell-check", () => ({
  spellCheckerLanguages: () => state.languages
}));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => process.cwd() }
}));
vi.mock("net", () => ({
  createServer: () => ({
    once: vi.fn(),
    listen: (_port: number, _host: string, done: () => void) => done(),
    address: () => ({ port: 12345 }),
    close: (done: () => void) => done()
  })
}));
vi.mock("child_process", () => ({
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      kill: () => child.emit("exit")
    });
    return child;
  }
}));
import {
  checkGrammar,
  grammarSpellingSuggestions,
  startGrammarChecker,
  stopGrammarChecker
} from "../src/utils/grammar-check";

beforeEach(() => {
  state.config.isGrammarCheckerEnabled = true;
});
afterEach(() => {
  stopGrammarChecker();
  vi.unstubAllGlobals();
});

test("only a ready local sidecar suggests spelling, in each enabled language", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:12345\/v2\//);
    if (url.endsWith("languages")) return { ok: true };
    const body = init?.body as URLSearchParams;
    expect(body.get("enabledOnly")).toBe("true");
    const rule = body.get("enabledRules");
    expect(["MORFOLOGIK_RULE_ES", "MORFOLOGIK_RULE_EN_US"]).toContain(rule);
    return {
      ok: true,
      json: async () => ({
        matches: [
          {
            offset: 0,
            length: 7,
            rule: { id: rule },
            replacements: [{ value: "corazón" }]
          },
          {
            offset: 1,
            length: 6,
            rule: { id: rule },
            replacements: [{ value: "parcial" }]
          },
          {
            offset: 0,
            length: 7,
            rule: { id: "OTHER" },
            replacements: [{ value: "ajeno" }]
          }
        ]
      })
    };
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await grammarSpellingSuggestions("korazon")).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
  await startGrammarChecker();
  expect(await grammarSpellingSuggestions("korazon")).toEqual([
    "corazón",
    "corazón"
  ]);
  state.config.isGrammarCheckerEnabled = false;
  fetcher.mockClear();
  expect(await grammarSpellingSuggestions("korazon")).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});

test("HTTP failure falls back and grammar still disables duplicate spelling underlines", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ matches: [] })
  }));
  vi.stubGlobal("fetch", fetcher);
  await startGrammarChecker();
  fetcher.mockRejectedValueOnce(new Error("sidecar stopped"));
  expect(await grammarSpellingSuggestions("korazon")).toEqual([]);
  await checkGrammar("Dijo que vendría");
  const body = fetcher.mock.calls.at(-1)?.[1]?.body as URLSearchParams;
  expect(body.get("disabledRules")).toContain("MORFOLOGIK_RULE_ES");
});
