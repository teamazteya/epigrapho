// SPDX-License-Identifier: GPL-3.0-or-later
// Epigrapho: the page serves the same Bible data the app does. The packages
// write it into apps/web/public on their build (bible-pack, original-languages);
// this copies what a shared note needs: VBL and BSB for verse previews, and
// original/ for the interlinear, the lexicon and the dictionaries.
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../web/public/", import.meta.url));
const to = fileURLToPath(new URL("../public/", import.meta.url));
for (const name of ["vbl.json", "bsb.json", "original"]) {
  if (!existsSync(from + name))
    throw new Error(`${from + name} is missing: build packages/bible-pack and packages/original-languages first`);
  cpSync(from + name, to + name, { recursive: true });
}
console.log("Bible data copied to public/");
