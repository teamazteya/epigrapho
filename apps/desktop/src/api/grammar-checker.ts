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

import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { config } from "../utils/config";
import {
  checkGrammar,
  grammarCheckerPid,
  grammarCheckerStatus,
  startGrammarChecker,
  stopGrammarChecker
} from "../utils/grammar-check";

const t = initTRPC.create();

/** Settings and the editor talk to the grammar checker through here (ADR-0010). */
export const grammarCheckerRouter = t.router({
  settings: t.procedure.query(() => ({
    enabled: config.isGrammarCheckerEnabled,
    style: config.grammarStyleRules,
    status: grammarCheckerStatus(),
    pid: grammarCheckerPid()
  })),
  toggle: t.procedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input: { enabled } }) => {
      config.isGrammarCheckerEnabled = enabled;
      if (enabled) startGrammarChecker();
      else stopGrammarChecker();
    }),
  toggleStyle: t.procedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input: { enabled } }) => {
      config.grammarStyleRules = enabled;
    }),
  // One paragraph at a time: a note is checked as it is edited, never sent
  // whole, and the limit keeps a pasted book from stalling the checker.
  check: t.procedure
    .input(z.object({ text: z.string().max(100_000) }))
    .query(({ input: { text } }) => checkGrammar(text))
});
