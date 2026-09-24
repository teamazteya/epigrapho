// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the translation picker says which translations can be read with no
// network and which need one (PRD §31.3, Paso 4.4).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const OFFLINE = ["VBL", "BSB", "KJV", "PdDpt"];
const ONLINE_ONLY = ["NTV", "NBLA", "NASB"];

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-badges-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  await page.evaluate(() => (window.location.hash = "/settings"));
  // The dialog mounts on the hash change; filling the search before it
  // is there types into the box that is on its way out.
  await page.locator(".ReactModal__Content").waitFor();
  await page.locator('[data-test-id="settings-search"]').fill("editor");
  const select = page.locator(
    '[data-test-id="setting-scripture-translation"] select'
  );
  await select.waitFor();
  const options = await select.locator("option").evaluateAll((list) =>
    list.map((option) => ({
      value: option.value,
      label: option.textContent,
      // Qué traducciones se leen sin red es un encabezado del desplegable, no
      // un sufijo del nombre: lo dice el optgroup que contiene la opción.
      group: option.closest("optgroup")?.label
    }))
  );
  for (const option of options)
    console.log(`${option.value.padEnd(5)} [${option.group}] ${option.label}`);

  assert.deepEqual(
    options.map((option) => option.value),
    [...OFFLINE, ...ONLINE_ONLY]
  );

  for (const option of options) {
    const expected = OFFLINE.includes(option.value)
      ? "Funciona sin conexión"
      : "Necesita conexión";
    assert.equal(
      option.group,
      expected,
      `${option.value} debería ir en "${expected}" y va en "${option.group}"`
    );
    // El grupo es un añadido, no un reemplazo: el nombre sigue ahí.
    assert.match(option.label, new RegExp(`\\(${option.value}\\)`));
  }

  console.log(
    `GREEN: ${OFFLINE.join(
      ", "
    )} se ofrecen como sin conexión; ${ONLINE_ONLY.join(
      ", "
    )} como solo en línea.`
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
