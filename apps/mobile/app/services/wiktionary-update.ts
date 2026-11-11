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

import NetInfo from "@react-native-community/netinfo";
import {
  setWiktionaryCopy,
  WIKTIONARY_FORMAT,
  type WiktionaryIndexPack,
  type WiktionaryManifest
} from "@notesnook/original-languages";
import { Platform } from "react-native";
import RNFetchBlob from "react-native-blob-util";
import { unzip } from "react-native-zip-archive";
import { create } from "zustand";
import { MMKV } from "../common/database/mmkv";
import SettingsService from "./settings";

/**
 * The weekly Wiktionary copy (A6 Fase 6), as on the desktop
 * (apps/desktop/src/api/dictionary.ts): the latest release of
 * teamazteya/epigrapho-datos, checked once a week on Wi-Fi, or with the
 * button on any network. It lives in DocumentDir/wiktionary/<folder>/; both
 * the editor's page (WIKTIONARY_COPY) and the export here read it from there.
 */
const DATOS =
  "https://github.com/teamazteya/epigrapho-datos/releases/latest/download/";
const KEY = "wiktionary";
const WEEK = 7 * 24 * 60 * 60 * 1000;
const root = `${RNFetchBlob.fs.dirs.DocumentDir}/wiktionary`;

type WiktionaryCopy = WiktionaryManifest & { folder: string };
type State = { copy?: WiktionaryCopy; checked?: number };

const state = () => (MMKV.getMap(KEY) as State | null) || {};
const save = (change: Partial<State>) =>
  MMKV.setMap(KEY, { ...state(), ...change });

export const useWiktionaryStore = create<{ date?: string; busy: boolean }>(
  () => ({ busy: false })
);

/** The folder of the copy in use, or undefined for the app's own. */
function wiktionaryFolder() {
  const copy = state().copy;
  return copy ? `${root}/${copy.folder}/` : undefined;
}

/** Where a pack is: in the app package, or in the copy for wikt-*. */
export function originalPath(name: string) {
  const copy = name.startsWith("wikt-") && wiktionaryFolder();
  if (copy) return copy + name;
  return Platform.OS === "ios"
    ? `${RNFetchBlob.fs.dirs.MainBundleDir}/build.bundle/original/${name}`
    : `bundle-assets://original/${name}`;
}

async function wiktionaryInUse() {
  const { date, sha256 } = JSON.parse(
    await RNFetchBlob.fs.readFile(originalPath("wikt-index.json"), "utf8")
  ) as WiktionaryIndexPack;
  return { date, source: sha256 };
}

/** For the editor's page, which reads it with file:// requests. */
export const wiktionaryCopyUrl = () => {
  const folder = wiktionaryFolder();
  return folder ? `file://${folder}` : undefined;
};

/** A debug build reads the releases from a local server in the test. */
async function testDatos() {
  const file = `${RNFetchBlob.fs.dirs.DocumentDir}/wiktionary-datos-url`;
  if (!__DEV__ || !(await RNFetchBlob.fs.exists(file))) return undefined;
  return (await RNFetchBlob.fs.readFile(file, "utf8")).trim();
}

async function fetchOk(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response;
}

/**
 * Installs the latest copy if it is in the format the app reads and newer
 * than the one in use; on any failure the one in use stays as it was.
 */
export async function updateWiktionary() {
  useWiktionaryStore.setState({ busy: true });
  try {
    const datos = (await testDatos()) || DATOS;
    const inUse = await wiktionaryInUse();
    const manifest = (await (
      await fetchOk(`${datos}manifest.json`)
    ).json()) as WiktionaryManifest;
    save({ checked: Date.now() });
    if (manifest.format !== WIKTIONARY_FORMAT) return "incompatible" as const;
    if (manifest.source === inUse.source || manifest.date < inUse.date)
      return "current" as const;

    const zip = `${RNFetchBlob.fs.dirs.CacheDir}/wikt.zip`;
    try {
      await RNFetchBlob.config({ path: zip }).fetch("GET", `${datos}wikt.zip`);
      const sha256 = await RNFetchBlob.fs.hash(zip, "sha256");
      if (sha256 !== manifest.sha256)
        throw new Error(`wikt.zip has SHA-256 ${sha256}, not ${manifest.sha256}`);
      const folder = `${manifest.date}-${sha256.slice(0, 12)}`;
      const temporary = `${root}/${folder}.part`;
      if (await RNFetchBlob.fs.exists(temporary))
        await RNFetchBlob.fs.unlink(temporary);
      await unzip(zip, temporary);
      const names = await RNFetchBlob.fs.ls(temporary);
      if (!names.includes("wikt-index.json") || names.some((name) => !/^wikt-.+\.json$/.test(name)))
        throw new Error("wikt.zip does not hold a Wiktionary copy");
      if (await RNFetchBlob.fs.exists(`${root}/${folder}`))
        await RNFetchBlob.fs.unlink(`${root}/${folder}`);
      await RNFetchBlob.fs.mv(temporary, `${root}/${folder}`);
      // The switch: the folders left behind go at the next start, because an
      // open editor may still be reading the old one.
      save({ copy: { ...manifest, folder } });
    } finally {
      await RNFetchBlob.fs.unlink(zip).catch(() => undefined);
    }
    // Forgets the packs already read here, so the export reads the new copy.
    setWiktionaryCopy(undefined);
    useWiktionaryStore.setState({ date: manifest.date });
    return "updated" as const;
  } finally {
    useWiktionaryStore.setState({ busy: false });
  }
}

/** At start: drops old copies, then checks once a week, on Wi-Fi only. */
export async function startWiktionaryUpdates() {
  const current = state().copy?.folder;
  if (await RNFetchBlob.fs.exists(root))
    for (const name of await RNFetchBlob.fs.ls(root))
      if (name !== current) await RNFetchBlob.fs.unlink(`${root}/${name}`);
  useWiktionaryStore.setState({ date: (await wiktionaryInUse()).date });

  if (SettingsService.get().wiktionaryAutoUpdate === false) return;
  if (Date.now() - (state().checked || 0) < WEEK) return;
  if ((await NetInfo.fetch()).type !== "wifi") return;
  await updateWiktionary();
}
