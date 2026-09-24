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

import path from "path";
import { existsSync } from "fs";
import fs from "fs/promises";
import chokidar from "chokidar";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";
import treekill from "tree-kill";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..");
// The one native module the app cannot start without.
const SQLITE_BINDING = path.join(
  root,
  "node_modules",
  "better-sqlite3-multiple-ciphers",
  "build",
  "Release",
  "better_sqlite3.node"
);
const RUNNING_PROCESSES = [];
const RESTARTABLE_PROCESSES = [];
let lastBundleHash = null;
const ENV = {
  ...process.env,
  NO_COLOR: "true",
  FORCE_COLOR: "false",
  COLOR: "0"
};
process.chdir(root);

await onChange(true);

console.log("Watching...");

const watcher = chokidar.watch("src/", { ignoreInitial: true });
watcher.on("all", () => {
  onChange(false);
});

process.on("SIGINT", async (s) => {
  await cleanup();
});

async function onChange(first) {
  if (first) {
    await fs.rm("./build/", { force: true, recursive: true });

    await exec(
      "npm run postinstall --verbose",
      path.join(root, "node_modules", "electron")
    );

    // Rebuilding the native modules needs a C++ toolchain, which not every
    // machine that only wants to run the app has. When the binding Electron
    // needs is already sitting there, there is nothing to rebuild.
    if (!existsSync(SQLITE_BINDING))
      await exec("npm exec --no -- electron-builder install-app-deps", root);
  }

  await exec(`npm run bundle`, root);
  await exec(`npm run build`, root);

  if (await isBundleSame()) {
    console.log("Bundle is same. Doing nothing.");
    return;
  }

  if (first) {
    await spawnAndWaitUntil(
      ["npm", "run", "tx", "web:start:desktop"],
      path.join(root, "..", ".."),
      (data) => data.includes("Network: use --host to expose")
    );
  }

  if (!first) {
    console.log("Restarting...", RESTARTABLE_PROCESSES.length);
    await killProcesses(RESTARTABLE_PROCESSES);
  }

  execAsync(
    "npm",
    ["exec", "--no", "--", "electron", path.join("build", "electron.js")],
    true,
    cleanup
  );
}

function spawnAndWaitUntil(cmd, cwd, predicate) {
  return new Promise((resolve, reject) => {
    console.log(">", ...cmd);

    const s = spawn(cmd[0], cmd.slice(1), {
      cwd,
      env: ENV,
      shell: process.platform === "win32"
    });

    RUNNING_PROCESSES.push(s);
    s.once("error", reject);
    s.once("exit", (code) => reject(new Error(`Dev server exited: ${code}`)));

    s.stderr.pipe(process.stderr);
    s.stdout.on("data", (data) => {
      process.stdout.write(data);
      if (predicate(data)) resolve(undefined); //
    });
  });
}

async function exec(cmd, cwd) {
  console.log(">", cmd, cwd);

  return execSync(cmd, {
    env: ENV,
    stdio: "inherit",
    cwd: cwd || process.cwd()
  });
}

function execAsync(cmd, args, restartable, onExit) {
  try {
    console.log(">", cmd, ...args);

    const proc = spawn(cmd, args, {
      stdio: "inherit",
      env: ENV,
      shell: process.platform === "win32"
    });

    const array = restartable ? RESTARTABLE_PROCESSES : RUNNING_PROCESSES;
    array.push(proc);
    proc.on("exit", (code, signal) => {
      console.log(cmd, ...args, "closed with code", code);
      if (code === 0 && !signal) {
        array.splice(array.indexOf(proc), 1);
        onExit && onExit();
      }
    });
  } catch {
    //ignore
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killProcesses(processes) {
  for (const process of processes.slice()) {
    processes.splice(processes.indexOf(process), 1);
    await new Promise((resolve, reject) =>
      treekill(process.pid, (err) => (err ? reject(err) : resolve()))
    );
  }
}

async function cleanup() {
  console.log("Cleaning up");

  await killProcesses(RESTARTABLE_PROCESSES);
  await killProcesses(RUNNING_PROCESSES);
  await sleep(1000);

  await fs.rm("./build/", { force: true, recursive: true });
  process.exit();
}

async function isBundleSame() {
  const bundle = Buffer.concat([
    await fs.readFile(path.join(__dirname, "..", "build", "electron.js")),
    await fs.readFile(path.join(__dirname, "..", "build", "preload.js"))
  ]);

  const hashSum = crypto.createHash("sha256");
  hashSum.update(bundle);
  const hex = hashSum.digest("hex");

  if (!lastBundleHash) {
    lastBundleHash = hex;
    return false;
  }
  if (hex === lastBundleHash) return true;
  lastBundleHash = hex;
  return false;
}
