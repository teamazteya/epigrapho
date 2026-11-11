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
import { app, net } from "electron";
import { z } from "zod";
import {
  currentWiktionary,
  installWiktionary,
  type WiktionaryManifest
} from "../utils/wiktionary-copy";

const t = initTRPC.create();

/**
 * The weekly Wiktionary copy (A6 Fase 6), from teamazteya/epigrapho-datos.
 * The page cannot fetch it: GitHub sends release files without CORS headers.
 */
const DATOS =
  process.env.EPIGRAPHO_DATOS_URL ||
  "https://github.com/teamazteya/epigrapho-datos/releases/latest/download/";

export const wiktionaryRoot = () =>
  `${app.getPath("userData")}/wiktionary`;

async function fetchOk(url: string) {
  const response = await net.fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response;
}

export const dictionaryRouter = t.router({
  copy: t.procedure.query(() => currentWiktionary(wiktionaryRoot())),
  /**
   * Installs the latest copy if it is in the format the page reads and newer
   * than the one in use (`date` and `source` of its wikt-index.json).
   */
  update: t.procedure
    .input(
      z.object({ format: z.number(), date: z.string(), source: z.string() })
    )
    .mutation(async ({ input }) => {
      const manifest = (await (
        await fetchOk(`${DATOS}manifest.json`)
      ).json()) as WiktionaryManifest;
      if (manifest.format !== input.format)
        return { status: "incompatible" as const };
      if (manifest.source === input.source || manifest.date < input.date)
        return { status: "current" as const };
      const zip = Buffer.from(
        await (await fetchOk(`${DATOS}wikt.zip`)).arrayBuffer()
      );
      const copy = await installWiktionary(wiktionaryRoot(), manifest, zip);
      return { status: "updated" as const, copy };
    })
});
