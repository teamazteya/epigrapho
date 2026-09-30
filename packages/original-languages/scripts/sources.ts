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

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

/**
 * The corpora of ADR-0009 are ~210 MB, too much to version (A2 Paso 2.1), so
 * the build downloads them from a fixed commit and refuses any file whose
 * checksum moved. They land in the root node_modules/.cache, which git
 * ignores and a package's own reinstall leaves alone; a clean clone fetches
 * them once.
 */
export const CACHE = fileURLToPath(
  new URL("../../../node_modules/.cache/original-languages/", import.meta.url)
);

const STEP =
  "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/b99716b0cddb648ddb95cc786a197180f2f97d48/";
const CLEAR =
  "https://raw.githubusercontent.com/Clear-Bible/Alignments/c99bd0ae6946775f932517656308ca19fc706921/data/";
const TAGNT = (books: string) =>
  `${STEP}Translators Amalgamated OT+NT/TAGNT ${books} - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt`;
const TAHOT = (books: string) =>
  `${STEP}Translators Amalgamated OT+NT/TAHOT ${books} - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt`;

const NEUU =
  "https://raw.githubusercontent.com/neuu-org/bible-dictionary-dataset/b8e82aa7ca847f4d97fb432cd965e398a111333c/data/02_sources/";
const LETTERS = "abcdefghijklmnopqrstuvwyz".split("");

/**
 * Local name, where it comes from and the SHA-256 it must have. A source
 * with `files` is a folder: each file is `url` + its name, and the checksum
 * covers them all, read in name order.
 */
export const SOURCES: Record<
  string,
  { url: string; sha256: string; files?: string[] }
> = {
  "TAGNT-Mat-Jhn.txt": {
    url: TAGNT("Mat-Jhn"),
    sha256: "ab8eaaeb68e17a1dcfa34e1e9350358f22f03bc2a97244d848750ad81044bc8e"
  },
  "TAGNT-Act-Rev.txt": {
    url: TAGNT("Act-Rev"),
    sha256: "524e32375361e6d3fa2f7ef00b87605fdc4317a762f395651a05fdc31ad031b7"
  },
  "TAHOT-Gen-Deu.txt": {
    url: TAHOT("Gen-Deu"),
    sha256: "e9b8546ee48fe0bfc57c3b70f5f40e98d96580e803526d19026224e31753368b"
  },
  "TAHOT-Jos-Est.txt": {
    url: TAHOT("Jos-Est"),
    sha256: "195fee1dc3653bab33701f170734eb894ed647c10cd08cc61749375fe8b73775"
  },
  "TAHOT-Job-Sng.txt": {
    url: TAHOT("Job-Sng"),
    sha256: "84e118a97e5725e3847cdfdd593873513021c790c63cc91a0d41fca2b5db2ed5"
  },
  "TAHOT-Isa-Mal.txt": {
    url: TAHOT("Isa-Mal"),
    sha256: "f3ded203d2a74d6368932c97ae550d1d0754b271af491dc0dedf36fe3ba0bcc5"
  },
  "TBESG.txt": {
    url: `${STEP}Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt`,
    sha256: "312f723d7b8ef263bbdfb0451c9b8057125804dfff390b6f8544cff2a84b57f4"
  },
  "TBESH.txt": {
    url: `${STEP}Lexicons/TBESH - Translators Brief lexicon of Extended Strongs for Hebrew - STEPBible.org CC BY.txt`,
    sha256: "464dccadd95fd8620dd05fa0d7a4caba58ec3c4d5db3ebf38e43d046ca25b591"
  },
  // Clear-Bible's own source texts are read only to find which of their
  // tokens a STEP word is; nothing of them ships.
  "SBLGNT.tsv": {
    url: `${CLEAR}sources/SBLGNT.tsv`,
    sha256: "df632b6b788aece04ac83495a315ac3933d122dca09da849efb1bc17d9c2a0be"
  },
  "WLCM.tsv": {
    url: `${CLEAR}sources/WLCM.tsv`,
    sha256: "eec7b7e31b72019a67a74be0718f3b65efe1e88ce85716ddc194c031a3eb17e8"
  },
  "nt_RV09.tsv": {
    url: `${CLEAR}spa/targets/RV09/nt_RV09.tsv`,
    sha256: "2400cd69284c0a123d25a9fab946e97ee5f32911509ef942e7c7d861d42b9cdf"
  },
  "ot_RV09.tsv": {
    url: `${CLEAR}spa/targets/RV09/ot_RV09.tsv`,
    sha256: "11998b3c596eaa9276c254f3079c4a4f507d34e64632cd6d734a28ce501c52fb"
  },
  "SBLGNT-RV09-manual.json": {
    url: `${CLEAR}spa/alignments/RV09/SBLGNT-RV09-manual.json`,
    sha256: "3ac4b7c44c8ed6b1298ef83b2d02e99aea55b532037536610fdebe330b94f01e"
  },
  "WLCM-RV09-manual.json": {
    url: `${CLEAR}spa/alignments/RV09/WLCM-RV09-manual.json`,
    sha256: "953ffd1ed3881a26e6af0be4525013f2d070f449666e38e1122d890d88849ca8"
  },
  // A release tag's archive: Door43 is a Gitea, with no raw file per commit
  // worth fetching a thousand times.
  "es-419_tw-v37.tar.gz": {
    url: "https://git.door43.org/es-419_gl/es-419_tw/archive/v37.tar.gz",
    sha256: "008a180673f638d76b9b7be22efc79a31ad858b58ed62a77f9ce7c6430e5ed99"
  },
  // Rand, Diccionario de la Santa Biblia (1890): archive.org's OCR of the
  // Library of Congress copy, public domain (A2 Paso 7.2).
  "rand-1890_djvu.txt": {
    url: "https://archive.org/download/diccionariodelas00rand/diccionariodelas00rand_djvu.txt",
    sha256: "ed0977149a09451567d03ca4ebf39caabd88f676919606291c92be0ba9704350"
  },
  // Easton (1897), Smith (1863) and Hitchcock's names, as NEUU parsed them
  // from CCEL: one file per dictionary and letter (A2 Fase 6).
  neuu: {
    url: NEUU,
    sha256: "a77b62688eef87c274910564a54b69983e6be163833f4d031a3ae6ce9d01f4c5",
    files: ["easton", "smith", "hitchcock"].flatMap((dictionary) =>
      LETTERS.filter(
        (letter) => dictionary !== "hitchcock" || !"wy".includes(letter)
      ).map((letter) => `${dictionary}/${letter}.json`)
    )
  }
};

const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

/** Downloads whatever is missing from the cache, and checks every file. */
export async function fetchSources() {
  mkdirSync(CACHE, { recursive: true });
  for (const [name, { url, sha256: expected, files }] of Object.entries(
    SOURCES
  )) {
    const download = async (from: string, to: string) => {
      if (existsSync(to)) return;
      console.error(`descargando ${from.slice(from.lastIndexOf("/") + 1)}`);
      // A mirror that does not answer (archive.org hands out a different
      // data node per request) should not fail the build: four tries, the
      // last one about a minute after the first.
      for (let attempt = 1; ; attempt++) {
        try {
          const response = await fetch(encodeURI(from));
          if (!response.ok)
            throw new Error(`${from} respondió ${response.status}`);
          writeFileSync(to, Buffer.from(await response.arrayBuffer()));
          return;
        } catch (error) {
          if (attempt === 4) throw error;
          const wait = 5000 * 2 ** (attempt - 1);
          console.error(`  falló (${(error as Error).message}); reintento en ${wait / 1000} s`);
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
    };
    let actual: string;
    if (files) {
      mkdirSync(CACHE + name, { recursive: true });
      const local = (file: string) => `${CACHE}${name}/${file.replace("/", "-")}`;
      for (const file of files) await download(url + file, local(file));
      const hash = createHash("sha256");
      for (const file of files.map(local).sort()) hash.update(readFileSync(file));
      actual = hash.digest("hex");
    } else {
      await download(url, CACHE + name);
      actual = sha256(readFileSync(CACHE + name));
    }
    if (actual !== expected)
      throw new Error(
        `${name}: el checksum no coincide (${actual}). Bórralo del caché y revisa si la fuente cambió.`
      );
  }
}

/**
 * A source file's text, once fetchSources has run. NFC, because STEP writes
 * some Greek accents with the oxia code points and some with tonos, and a
 * word must compare equal to itself when it is searched for.
 */
export const readSource = (name: keyof typeof SOURCES) =>
  readFileSync(CACHE + name, "utf8").normalize("NFC");

/**
 * The text files of a .tar.gz source, by path. ponytail: a tar reader in a
 * dozen lines instead of a dependency; it knows plain ustar entries and pax
 * long paths, which is all git archive writes.
 */
export function readArchive(name: keyof typeof SOURCES) {
  const tar = gunzipSync(readFileSync(CACHE + name));
  const files = new Map<string, string>();
  let longPath = "";
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    const field = (from: number, to: number) =>
      header.subarray(from, to).toString("utf8").replace(/\0.*$/s, "");
    if (!field(0, 100)) break;
    const size = parseInt(field(124, 136).trim() || "0", 8);
    const type = field(156, 157);
    const body = tar.subarray(at + 512, at + 512 + size).toString("utf8");
    if (type === "x") longPath = /\d+ path=(.*)\n/.exec(body)?.[1] ?? "";
    else {
      const prefix = field(345, 500);
      const path =
        longPath || (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
      if (type === "0" || type === "") files.set(path, body.normalize("NFC"));
      longPath = "";
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Every JSON file of a folder source, parsed, by local file name. */
export function readFolder(name: keyof typeof SOURCES) {
  const folder = `${CACHE}${name}/`;
  return new Map(
    readdirSync(folder)
      .sort()
      .map((file) => [
        file,
        JSON.parse(readFileSync(folder + file, "utf8").normalize("NFC"))
      ])
  );
}
