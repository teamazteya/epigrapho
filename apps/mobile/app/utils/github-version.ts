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

import { getVersion } from "react-native-device-info";

export interface GithubRelease {
  url: string;
  assets_url: string;
  upload_url: string;
  html_url: string;
  id: number;
  author: unknown;
  node_id: string;
  tag_name: string;
  target_commitish: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  created_at: Date;
  published_at: Date;
  assets: unknown[];
  tarball_url: string;
  zipball_url: string;
  body: string;
  mentions_count: number;
  reactions: unknown;
  discussion_url: string;
}
export type GithubVersionInfo = {
  version: string | null;
  releasedAt: string;
  notes: string;
  body: string;
  url: string;
  lastChecked: string;
  needsUpdate: boolean;
  current: string;
};
/** Epigrapho's releases: one tag vX.Y.Z carries the desktop installers and the APK. */
export const RELEASES = "https://github.com/teamazteya/epigrapho/releases";
export const APK_NAME = "epigrapho_android.apk";

/** True when `a` is a later version than `b` (1.10.0 > 1.9.2). */
export function isNewer(a: string, b: string) {
  const parts = (v: string) => v.split("-")[0].split(".").map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++)
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

export const getGithubVersion = async (): Promise<GithubVersionInfo | null> => {
  let res;
  try {
    // The latest published release, never a draft or a pre-release.
    res = await fetch(
      "https://api.github.com/repos/teamazteya/epigrapho/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } }
    );
  } catch (e) {
    console.warn(e);
  }

  if (!res?.ok) return null;
  const latest = (await res.json()) as GithubRelease;
  const version = latest.tag_name.replace(/^v/, "");
  return {
    version: version || null,
    releasedAt: new Date(latest.published_at).toISOString(),
    notes: "",
    body: latest.body,
    url: latest.html_url,
    lastChecked: new Date().toISOString(),
    needsUpdate: isNewer(version, getVersion()),
    current: getVersion()
  };
};
