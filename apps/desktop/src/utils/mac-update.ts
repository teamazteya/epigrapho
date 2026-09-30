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
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { app, shell } from "electron";
import type { UpdateInfo } from "electron-updater";

/**
 * macOS updates without an Apple certificate.
 *
 * electron-updater installs through Squirrel.Mac, which refuses an app that
 * is not signed with a Developer ID. Epigrapho is signed ad hoc, so here the
 * update is the release's .dmg instead: downloaded for this Mac's
 * architecture, checked against the checksum the release publishes, and
 * opened for the person to drag over the old app. Their notes live in the
 * user data folder and are not touched.
 */

const RELEASES = "https://github.com/teamazteya/epigrapho/releases/download";

/** The .dmg of a release for an architecture ("arm64" or "x64"). */
export function macDmgFor(info: UpdateInfo, arch = process.arch) {
  const name = `epigrapho_mac_${arch === "arm64" ? "arm64" : "x64"}.dmg`;
  const listed = info.files.find((file) => file.url.endsWith(name));
  return {
    url: `${RELEASES}/v${info.version}/${listed?.url ?? name}`,
    sha512: listed?.sha512,
    name
  };
}

let downloaded: string | undefined;

/**
 * Downloads the release's .dmg into Downloads, reporting progress as a
 * percentage. A file whose checksum does not match the release's is deleted
 * and the download fails: an update must be the file that was published.
 */
export async function downloadMacUpdate(
  info: UpdateInfo,
  onProgress: (percent: number) => void
) {
  const dmg = macDmgFor(info);
  const target = path.join(app.getPath("downloads"), dmg.name);
  const response = await fetch(dmg.url);
  if (!response.ok || !response.body)
    throw new Error(`${dmg.url} respondió ${response.status}`);

  const total = Number(response.headers.get("content-length")) || 0;
  const hash = createHash("sha512");
  const out = createWriteStream(target);
  let received = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      if (!out.write(chunk))
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      received += chunk.length;
      if (total) onProgress((received / total) * 100);
    }
    await new Promise<void>((resolve, reject) =>
      out.end((error?: Error | null) => (error ? reject(error) : resolve()))
    );
  } catch (error) {
    out.destroy();
    await rm(target, { force: true });
    throw error;
  }

  if (dmg.sha512 && hash.digest("base64") !== dmg.sha512) {
    await rm(target, { force: true });
    throw new Error(`${dmg.name}: el checksum no coincide con el del release`);
  }
  downloaded = target;
  return target;
}

/**
 * Opens the downloaded .dmg and quits, so the app can be replaced while it
 * is not running.
 */
export async function installMacUpdate() {
  if (!downloaded) return;
  const error = await shell.openPath(downloaded);
  if (error) throw new Error(error);
  app.quit();
}
