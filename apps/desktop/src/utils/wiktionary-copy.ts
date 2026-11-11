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

import { createHash } from "crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { inflateRawSync } from "zlib";

/**
 * The weekly Wiktionary copy (A6 Fase 6), kept apart from the app's own:
 * <root>/<folder>/wikt-*.json, and <root>/current.json naming the folder.
 * Same shape as WiktionaryManifest in @notesnook/original-languages.
 */
export type WiktionaryManifest = {
  format: number;
  date: string;
  source: string;
  sha256: string;
  size: number;
};
export type WiktionaryCopy = WiktionaryManifest & { folder: string };

/**
 * The files in a zip. Only what publish.sh in teamazteya/epigrapho-datos
 * writes: stored or deflated entries, no zip64 (the copy is about 15 MB).
 */
export function unzip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("not a zip file");
  const files = new Map<string, Buffer>();
  let at = zip.readUInt32LE(end + 16);
  for (let left = zip.readUInt16LE(end + 10); left > 0; left--) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("broken zip");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method !== 0 && method !== 8)
      throw new Error(`zip method ${method} in ${name}`);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
  }
  return files;
}

export async function currentWiktionary(
  root: string
): Promise<WiktionaryCopy | undefined> {
  try {
    return JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
  } catch {
    // No copy yet: the app's own is in use.
    return undefined;
  }
}

/**
 * Installs a downloaded copy, or throws and leaves the one in use as it was:
 * the switch is the last write, of current.json, after every file is there.
 */
export async function installWiktionary(
  root: string,
  manifest: WiktionaryManifest,
  zip: Buffer
): Promise<WiktionaryCopy> {
  const sha256 = createHash("sha256").update(zip).digest("hex");
  if (sha256 !== manifest.sha256)
    throw new Error(`wikt.zip has SHA-256 ${sha256}, not ${manifest.sha256}`);
  const files = unzip(zip);
  if (!files.has("wikt-index.json"))
    throw new Error("wikt.zip has no wikt-index.json");
  // The names become paths: nothing but wikt-*.json in this folder.
  for (const name of files.keys())
    if (!/^wikt-[^/\\]+\.json$/.test(name) || name.includes(".."))
      throw new Error(`unexpected file ${name} in wikt.zip`);
  const folder = `${manifest.date}-${sha256.slice(0, 12)}`;
  const temporary = path.join(root, `${folder}.part`);
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  for (const [name, data] of files)
    await writeFile(path.join(temporary, name), data);
  await rm(path.join(root, folder), { recursive: true, force: true });
  await rename(temporary, path.join(root, folder));
  const copy = { ...manifest, folder };
  await writeFile(path.join(root, "current.json.part"), JSON.stringify(copy));
  await rename(
    path.join(root, "current.json.part"),
    path.join(root, "current.json")
  );
  for (const old of await readdir(root))
    if (old !== folder && old !== "current.json")
      await rm(path.join(root, old), { recursive: true, force: true });
  return copy;
}
