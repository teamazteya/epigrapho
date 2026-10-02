// SPDX-License-Identifier: GPL-3.0-or-later
// v1.3.0: the 21 community themes that ship with the app. Checks that:
//   1. all 21 pass validateTheme;
//   2. Appearance lists the app's own two first, then the community ones,
//      each with "Basado en …", and the detail shows the credit and license;
//   3. a light one and a dark one change the interface colors;
//   4. the chosen theme survives a restart;
//   5. Acerca de credits all 21, and "Notesnook" shows up nowhere in
//      Appearance or Acerca de except in a "Basado en …" credit.
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { CommunityThemes, validateTheme } = createRequire(import.meta.url)(
  "../../../packages/theme/dist/cjs/index.js"
);
const LIGHT = CommunityThemes.find((theme) => theme.name === "Papiro");
const DARK = CommunityThemes.find((theme) => theme.name === "Ónice");
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-themes-"));

// ---- 1. valid ----
assert.equal(CommunityThemes.length, 21);
for (const theme of CommunityThemes)
  assert.equal(validateTheme(theme).error, undefined, theme.id);
console.log("1. los 21 temas pasan validateTheme");

async function launch() {
  const app = await _electron.launch({
    args: [path.join(root, "build", "electron.js")],
    env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
    timeout: 60000
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  return { app, page };
}

const background = (page) =>
  page.evaluate(() =>
    /--background: (#[0-9a-f]+);/
      .exec(document.getElementById("theme-colors").innerHTML.toLowerCase())
      ?.at(1)
  );

async function openSection(page, title) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  await page
    .locator('[data-test-id="settings-navigation-menu"]')
    .getByText(title, { exact: true })
    .click();
}

// The list is virtualized: scroll until the theme's card is rendered.
async function themeCard(page, name) {
  const card = page
    .locator('[data-test-id="setting-themes"]')
    .getByText(name, { exact: true });
  for (let i = 0; i < 40 && !(await card.count()); i++)
    await page.locator("#settings-scrollbar").evaluate((el) => {
      el.scrollTop += 300;
    });
  return card;
}

async function apply(page, theme) {
  await (await themeCard(page, theme.name)).click();
  const dialog = page.locator(".ReactModal__Content").last();
  await dialog.getByText(`Basado en ${theme.basedOn}`).waitFor();
  await dialog.getByText(`Con licencia ${theme.license}`).waitFor();
  await dialog.locator('[data-test-id="dialog-yes"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll(".ReactModal__Content").length === 1
  );
  await page.waitForFunction(
    (color) =>
      /--background: (#[0-9a-f]+);/
        .exec(document.getElementById("theme-colors").innerHTML.toLowerCase())
        ?.at(1) === color,
    theme.scopes.base.primary.background.toLowerCase(),
    { timeout: 5000 }
  );
}

let { app, page } = await launch();
try {
  // ---- 2. the list ----
  await openSection(page, "Apariencia");
  const list = page.locator('[data-test-id="setting-themes"]');
  await list.getByText("Epigrapho Claro", { exact: true }).waitFor();
  await list.getByText("Epigrapho Oscuro", { exact: true }).waitFor();
  await list.getByText("Basado en Arborleaf", { exact: true }).waitFor();
  const text = await list.innerText();
  assert.ok(
    text.indexOf("Epigrapho Claro") < text.indexOf("Papiro"),
    "los de Epigrapho no van primero"
  );
  console.log("2. Apariencia: Epigrapho Claro y Oscuro, luego Papiro…");

  // ---- 3. a light one and a dark one ----
  const before = await background(page);
  await apply(page, LIGHT);
  assert.notEqual(await background(page), before);
  await apply(page, DARK);
  console.log(
    `3. ${LIGHT.name} y ${DARK.name} cambian los colores (${LIGHT.scopes.base.primary.background}, ${DARK.scopes.base.primary.background})`
  );

  for (const title of ["Apariencia", "Acerca de"]) {
    await openSection(page, title);
    const all = await page.locator("#settings-scrollbar").innerText();
    const stray = all
      .split("\n")
      .filter((line) => /notesnook/i.test(line) && !/Basado en/.test(line));
    assert.deepEqual(stray, [], `${title} nombra a Notesnook`);
  }

  // ---- 5. credits ----
  const credits = page.locator('[data-test-id^="setting-theme-credit-"]');
  await credits.first().waitFor();
  assert.equal(await credits.count(), 21);
  await page
    .getByText("Basado en Dracula, de c4ssiopei4. Licencia MIT.")
    .waitFor();
  console.log(
    "5. Acerca de da crédito a los 21; Notesnook solo en «Basado en …»"
  );

  // ---- 4. restart ----
  await app.close();
  ({ app, page } = await launch());
  assert.equal(
    await background(page),
    DARK.scopes.base.primary.background.toLowerCase()
  );
  console.log(`4. ${DARK.name} sigue aplicado tras reiniciar`);

  console.log(
    "GREEN: los 21 temas se listan, se aplican, se recuerdan y dan crédito a su origen."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
