// SPDX-License-Identifier: GPL-3.0-or-later
// Puts the spelling dictionaries next to the bundled worker that reads them.
//
// They cannot be bundled: esbuild inlines code, and these are data files that
// nspell opens at runtime. They cannot be read from node_modules either, since
// the packaged app ships none (see the `files` list in electron-builder.config.js).
// So they are copied into build/, which is what gets packaged.
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, "build", "dictionaries");

// dictionary-en exports only its entry point, so the folder is found through
// that rather than through a subpath the package does not expose.
await mkdir(target, { recursive: true });
for (const language of ["es", "en"]) {
  const source =
    language === "es"
      ? path.join(root, "resources", "rla-es-2.9")
      : path.dirname(require.resolve("dictionary-en"));
  for (const extension of ["aff", "dic"])
    await copyFile(
      path.join(source, `${language === "es" ? "es" : "index"}.${extension}`),
      path.join(target, `${language}.${extension}`)
    );
}

// The biblical Resource Pack travels the same road: the worker reads it at
// startup and adds every term to the dictionary (Paso 6.2).
await copyFile(
  path.join(root, "resources", "bible-terms-es.json"),
  path.join(target, "bible-terms-es.json")
);
await copyFile(
  path.join(root, "resources", "spelling-corrections-es.json"),
  path.join(target, "spelling-corrections-es.json")
);
const spanish = path.join(root, "resources", "rla-es-2.9");
const provenance = JSON.parse(
  await readFile(path.join(spanish, "provenance.json"), "utf8")
);
for (const [name, hash] of Object.entries(provenance.sha256)) {
  const actual = createHash("sha256")
    .update(await readFile(path.join(spanish, name)))
    .digest("hex");
  if (actual !== hash) throw new Error(`RLA-ES checksum mismatch: ${name}`);
}
for (const name of [
  "LICENSE.md",
  "GPLv3.txt",
  "LGPLv3.txt",
  "MPL-1.1.txt",
  "README.txt",
  "provenance.json"
])
  await copyFile(path.join(spanish, name), path.join(target, `rla-es-${name}`));

console.log(`dictionaries -> ${target}`);
