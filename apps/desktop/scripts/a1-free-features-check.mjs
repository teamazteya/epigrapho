// SPDX-License-Identifier: GPL-3.0-or-later
// Epigrapho is free, so nothing may sit behind a paywall and nothing may offer
// to sell anything. This checks both halves against a running app with nobody
// signed in: the features the app delivers on its own report as available, and
// the places that used to ask for money are gone.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// The module that decides what is available, reached from the page by its path
// on disk. It is the built copy on purpose: that is the one the app itself
// imports, and Vite refuses to serve the package sources from outside the web
// app's own root.
const FEATURES_MODULE = `/@fs/${fileURLToPath(
  new URL(
    "../../../packages/common/dist/esm/utils/is-feature-available.js",
    import.meta.url
  )
)
  .split(path.sep)
  .join("/")}`;

// The features that need no server of any kind. The ones left out — storage,
// attachment size, monographs, SMS two-factor — are a separate question and
// are still gated where they reach for that server.
const OFFLINE_FEATURES = [
  "blockLinking",
  "taskList",
  "outlineList",
  "callout",
  "colors",
  "tags",
  "notebooks",
  "activeReminders",
  "shortcuts",
  "defaultNotebookAndTag",
  "recurringReminders",
  "defaultSidebarTab",
  "customHomepage",
  "markdownShortcuts",
  "fontLigatures",
  "customToolbarPreset",
  "customizableSidebar",
  "disableTrashCleanup",
  "appLock",
  "maxNoteVersions",
  "expiringNotes",
  "exportTableAsCsv",
  "importCsvToTable"
];

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-free-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/** Opens settings, types into its search and returns the section titles found. */
async function searchSettings(term) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  await page.locator(".ReactModal__Content").waitFor();
  await page.locator('[data-test-id="settings-search"]').fill(term);
  await page.waitForTimeout(500);
  const results = await page.locator(".ReactModal__Content").innerText();
  await page.keyboard.press("Escape");
  await page
    .locator(".ReactModal__Content")
    .waitFor({ state: "detached", timeout: 15000 });
  return results;
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();

  // 1. Nobody is signed in and there is no subscription anywhere, which is the
  // exact state that used to put all of these behind the upgrade dialog.
  const denied = await page.evaluate(
    async ([module, ids]) => {
      const { isFeatureAvailable } = await import(module);
      const out = [];
      for (const id of ids) {
        const result = await isFeatureAvailable(id);
        if (!result.isAllowed) out.push(`${id} (${result.error})`);
      }
      return out;
    },
    [FEATURES_MODULE, OFFLINE_FEATURES]
  );
  assert.deepEqual(
    denied,
    [],
    `features todavía bloqueados: ${denied.join(", ")}`
  );
  console.log(
    `1. ${OFFLINE_FEATURES.length} features locales disponibles sin cuenta ni suscripción`
  );

  // 2. And nothing offers to sell anything any more.
  const subscription = await searchSettings("subscription");
  assert.ok(
    !/Subscription|Suscripción|Upgrade|Mejorar/i.test(subscription),
    `Ajustes todavía ofrece una suscripción: ${subscription
      .split("\n")
      .slice(0, 4)
      .join(" · ")}`
  );
  console.log("2. Ajustes no ofrece ninguna suscripción");

  const circle = await searchSettings("circle");
  assert.ok(
    !/Notesnook Circle/i.test(circle),
    "Ajustes todavía muestra Notesnook Circle"
  );
  console.log("3. Notesnook Circle ya no está en Ajustes");

  // 3. The profile menu in the sidebar was the other way in.
  await page.locator('[data-test-id="profile-dropdown"]').click();
  await page.locator('.menu-container, [role="menu"]').first().waitFor();
  const menu = await page
    .locator('.menu-container, [role="menu"]')
    .first()
    .innerText();
  await page.keyboard.press("Escape");
  assert.ok(
    !/Pro|Upgrade|Mejorar/i.test(menu),
    `el menú de perfil todavía ofrece Pro: ${menu.split("\n").join(" · ")}`
  );
  console.log(
    `4. el menú de perfil no ofrece Pro: ${menu.split("\n").join(" · ")}`
  );

  console.log(
    "GREEN: sin cuenta y sin suscripción, los features locales están disponibles y no queda ningún punto de venta."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
