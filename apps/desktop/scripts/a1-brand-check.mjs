// SPDX-License-Identifier: GPL-3.0-or-later
// Nothing a person sees names Notesnook, its company or its community, and
// nothing the app does asks their servers: the home screen and every section
// of Settings are read, and every request the page makes is watched.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const UPSTREAM = /notesnook|streetwriters|discord|telegram|mastodon/i;
// The one place Notesnook may be named: the importer, as an app to bring
// notes from.
const IMPORT_SOURCE = /^Notesnook$/;

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-brand-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const requests = [];
page.on("request", (request) => {
  if (UPSTREAM.test(new URL(request.url()).hostname))
    requests.push(request.url());
});

/** Lines of `text` that name upstream. */
const upstream = (text) =>
  text
    .split("\n")
    .filter((line) => UPSTREAM.test(line) && !IMPORT_SOURCE.test(line.trim()));

try {
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  // Tips and the status bar settle a moment after the list.
  await page.waitForTimeout(3000);
  const found = { inicio: upstream(await page.locator("body").innerText()) };

  await page.evaluate(() => (window.location.hash = "/settings"));
  await page.locator(".ReactModal__Content").waitFor();
  const sections = page.locator(
    '[data-test-id="settings-navigation-menu"] [data-test-id="navigation-item"]'
  );
  const count = await sections.count();
  for (let index = 0; index < count; index++) {
    const name = (await sections.nth(index).innerText()).trim();
    await sections.nth(index).click();
    // Appearance used to ask the theme server here; give it the chance.
    await page.waitForTimeout(1000);
    const lines = upstream(
      await page.locator(".ReactModal__Content").innerText()
    );
    if (lines.length) found[name] = lines;
  }
  console.log(`secciones leídas: ${count}`);

  // Notesnook's backups share Epigrapho's format, so picking it in the
  // importer explains how to make one and offers the restore.
  await sections.filter({ hasText: /^Importador$/ }).click();
  await page
    .locator("select")
    .filter({ hasText: "Notesnook" })
    .selectOption("notesnook");
  await page
    .getByText("En Notesnook abre Ajustes > Respaldo y exportación")
    .waitFor();
  await page
    .getByRole("button", { name: "Elige el archivo de respaldo" })
    .waitFor();
  console.log("importador: Notesnook ofrece restaurar su respaldo");

  const named = Object.fromEntries(
    Object.entries(found).filter(([, lines]) => lines.length)
  );
  console.log("menciones:", JSON.stringify(named, null, 1));
  console.log("peticiones:", JSON.stringify(requests));
  assert.ok(count > 10, "Ajustes no mostró sus secciones");
  assert.deepEqual(named, {});
  assert.deepEqual(requests, []);

  console.log(
    "GREEN: ni el inicio ni ninguna sección de Ajustes nombra a Notesnook, y nada pidió a sus servidores."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
