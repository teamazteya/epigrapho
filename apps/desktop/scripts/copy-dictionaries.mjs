// SPDX-License-Identifier: GPL-3.0-or-later
// Puts the spelling dictionaries next to the bundled worker that reads them.
//
// They cannot be bundled: esbuild inlines code, and these are data files that
// nspell opens at runtime. They cannot be read from node_modules either, since
// the packaged app ships none (see the `files` list in electron-builder.config.js).
// So they are copied into build/, which is what gets packaged.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, "build", "dictionaries");

// dictionary-es exports only its entry point, so the folder is found through
// that rather than through a subpath the package does not expose.
const source = path.dirname(require.resolve("dictionary-es"));

await mkdir(target, { recursive: true });
for (const [from, to] of [
  ["index.aff", "es.aff"],
  ["index.dic", "es.dic"]
])
  await copyFile(path.join(source, from), path.join(target, to));

// The biblical Resource Pack travels the same road: the worker reads it at
// startup and adds every term to the dictionary (Paso 6.2).
await copyFile(
  path.join(root, "resources", "bible-terms-es.json"),
  path.join(target, "bible-terms-es.json")
);

console.log(`dictionaries -> ${target}`);
