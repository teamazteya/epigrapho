// SPDX-License-Identifier: GPL-3.0-or-later
// v1.2.0: the update notice. When a new version is ready the app opens a
// notice by itself with that version's notes (the release's, fetched from
// GitHub) and two buttons, "Instalar ahora" and "Recordarme más tarde".
//
// The updater's events are published by hand, as the desktop bridge would,
// for v1.1.0, whose release notes are real. Checks that:
//   1. the notice opens by itself with the notes and both buttons;
//   2. "Recordarme más tarde" closes it, and the same version does not open
//      it again for a day;
//   3. the status bar still opens it on a click;
//   4. "Instalar ahora" reaches the installer in the main process (in a dev
//      build electron-updater has nothing downloaded and says so).
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const VERSION = "1.1.0";
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-notice-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const notice = page.locator('[data-test-id="confirm-dialog"]');
// The app's own instance of the module: once vite has hot-updated a file
// it serves it with ?t=, and a bare import would get a second copy.
const events = () =>
  import(
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => name.includes("/common/app-events.ts"))
  );
const downloaded = () =>
  page.evaluate(
    async ([version, events]) => {
      const { AppEventManager, AppEvents } = await eval(events)();
      AppEventManager.publish(AppEvents.updateDownloadCompleted, { version });
    },
    [VERSION, events.toString()]
  );

try {
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();

  // ---- 1. it opens by itself, with the notes ----
  await downloaded();
  await notice.waitFor();
  await notice.getByText(`Epigrapho ${VERSION} está lista`).waitFor();
  await notice.getByText("Novedades de esta versión:").waitFor();
  await notice.getByText(/Sincroniza tus notas entre computadoras/).waitFor();
  assert.ok(
    (await notice.locator("li").count()) >= 3,
    "las novedades no son una lista"
  );
  const install = notice.getByRole("button", { name: "Instalar ahora" });
  const later = notice.getByRole("button", { name: "Recordarme más tarde" });
  await install.waitFor();
  await later.waitFor();
  console.log(
    `1. se abre solo: «Epigrapho ${VERSION} está lista», ${await notice
      .locator("li")
      .count()} novedades, «Instalar ahora» y «Recordarme más tarde»`
  );

  // ---- 2. later: closed, and quiet for a day ----
  await later.click();
  await notice.waitFor({ state: "detached" });
  const snooze = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("updateSnooze"))
  );
  assert.equal(snooze.version, VERSION);
  const hours = (snooze.until - Date.now()) / 3600000;
  assert.ok(hours > 23.9 && hours <= 24, `pospuesto ${hours} h`);
  await downloaded();
  await page.waitForTimeout(3000);
  assert.equal(await notice.count(), 0, "volvió a abrirse");
  console.log(
    "2. «Recordarme más tarde» lo cierra y no vuelve a abrirse en 24 h"
  );

  // ---- 3. the status bar still opens it ----
  await page.getByText(`v${VERSION} descargada (clic para instalar)`).click();
  await notice.getByText(`Epigrapho ${VERSION} está lista`).waitFor();
  console.log("3. la barra de estado lo abre aunque esté pospuesto");

  // ---- 4. install now goes to the installer ----
  const refused = page.evaluate(
    (events) =>
      new Promise(async (resolve) => {
        const { AppEventManager, AppEvents } = await eval(events)();
        AppEventManager.subscribe(AppEvents.updateError, (error) =>
          resolve(String(error?.message ?? error))
        );
      }),
    events.toString()
  );
  await notice.getByRole("button", { name: "Instalar ahora" }).click();
  await notice.waitFor({ state: "detached" });
  const error = await Promise.race([
    refused,
    page.waitForTimeout(15000).then(() => "sin respuesta")
  ]);
  assert.match(error, /quit and install/i);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("updateSnooze")),
    null
  );
  console.log(`4. «Instalar ahora» llega al instalador («${error}»)`);

  console.log(
    "GREEN: al estar lista una versión, la app muestra sus novedades y ofrece instalar ahora o recordarlo más tarde."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
