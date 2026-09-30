// SPDX-License-Identifier: GPL-3.0-or-later
// In-app updates on Windows: an installed 1.0.0 finds a newer release, says
// so, downloads it by itself and offers to install it. The "release" is a
// folder served on 127.0.0.1 with the installer and latest.yml
// electron-builder wrote for it, standing in for GitHub; the app is an
// unpacked build (output/win-unpacked) whose app-update.yml is pointed at
// that folder for the run and put back afterwards.
//
// The install itself is not clicked: it would run the NSIS installer over
// whatever Epigrapho this machine has installed.
//
// Usage: node scripts/update-check.mjs <feed folder>
import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const feed = process.argv[2];
assert.ok(feed && existsSync(path.join(feed, "latest.yml")), "falta la carpeta del release");
const release = /version: (\S+)/.exec(await readFile(path.join(feed, "latest.yml"), "utf8"))[1];

const unpacked = path.join(root, "output", "win-unpacked");
const updateYml = path.join(unpacked, "resources", "app-update.yml");
const original = await readFile(updateYml, "utf8");
assert.match(original, /owner: teamazteya/, "el paquete no apunta a los releases de Epigrapho");
assert.match(original, /repo: epigrapho/);

const served = [];
const server = http
  .createServer((request, response) => {
    const file = path.join(feed, decodeURIComponent(new URL(request.url, "http://x").pathname));
    served.push(path.basename(file));
    if (!existsSync(file)) return response.writeHead(404).end();
    createReadStream(file).pipe(response);
  })
  .listen(8123, "127.0.0.1");

// The cache folder stays the packaged one, so the download is fresh and
// the cleanup below finds it.
const cache = /updaterCacheDirName: (\S+)/.exec(original)?.[1];
assert.ok(cache, "app-update.yml sin updaterCacheDirName");
const cacheDir = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), cache);
await rm(cacheDir, { recursive: true, force: true });
await writeFile(
  updateYml,
  `provider: generic\nurl: http://127.0.0.1:8123/\nupdaterCacheDirName: ${cache}\n`
);
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-update-"));
const app = await _electron.launch({
  executablePath: path.join(unpacked, "Epigrapho.exe"),
  args: [],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(180000);

try {
  const installed = await app.evaluate(({ app }) => app.getVersion());
  console.log(`1. instalada ${installed}, release ${release}`);
  assert.notEqual(installed, release);

  // Automatic updates are on by default: found, downloaded, offered.
  const ready = page.getByText(`v${release} descargada (clic para instalar)`);
  await ready.waitFor();
  console.log(`2. barra de estado: «${await ready.innerText()}»`);
  assert.ok(served.includes("latest.yml"), "no leyó latest.yml");
  assert.ok(served.includes("epigrapho_win_x64.exe"), "no descargó el instalador");
  console.log(`3. del release pidió: ${[...new Set(served)].join(", ")}`);

  await page.evaluate(() => (window.location.hash = "/settings"));
  await page.locator(".ReactModal__Content").getByText("Acerca de").first().click();
  await page
    .locator(".ReactModal__Content")
    .getByText(`v${release} descargada (clic para instalar)`)
    .waitFor();
  await page.getByRole("button", { name: "Instalar la actualización" }).waitFor();
  console.log("4. Ajustes → Acerca de dice que está descargada y ofrece «Instalar la actualización»");

  console.log(
    `GREEN: la ${installed} encuentra la ${release}, la descarga sola y ofrece instalarla.`
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
  server.close();
  await writeFile(updateYml, original);
  // What electron-updater downloaded, so it is not offered to the real app.
  await rm(cacheDir, { recursive: true, force: true });
}
