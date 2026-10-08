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

// Epigrapho: sets the app version, `node scripts/bump-version.mjs 1.5.0`.
// The release tag decides it, as on the desktop. Android derives its version
// code from package.json in build.gradle (1.5.0 -> 10500); iOS reads both
// numbers from the build configs, so the build number follows the same rule.
import { readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
  console.error(`Uso: node scripts/bump-version.mjs x.y.z (llegó "${version}")`);
  process.exit(1);
}
const [major, minor, patch] = version.split(".").map(Number);
const build = major * 10000 + minor * 100 + patch;

const mobile = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const edit = (file, change) =>
  writeFileSync(file, change(readFileSync(file, "utf8")));

// The first "version" of each file is the app's own.
for (const name of ["package.json", "package-lock.json"])
  edit(path.join(mobile, name), (s) =>
    s.replace(/"version": "[^"]*"/, `"version": "${version}"`)
  );
const lock = path.join(mobile, "package-lock.json");
edit(lock, (s) =>
  s.replace(/("packages": \{\s*"": \{\s*"name": "[^"]*",\s*"version": )"[^"]*"/, `$1"${version}"`)
);
const configs = path.join(mobile, "ios", "build-configs");
for (const name of readdirSync(configs).filter((n) => n.endsWith(".xcconfig")))
  edit(path.join(configs, name), (s) =>
    s
      .replace(/IOS_MARKETING_VERSION = .*/, `IOS_MARKETING_VERSION = ${version}`)
      .replace(/IOS_CURRENT_PROJECT_VERSION = .*/, `IOS_CURRENT_PROJECT_VERSION = ${build}`)
  );
console.log(`Versión ${version}, build ${build}`);
