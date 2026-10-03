// SPDX-License-Identifier: GPL-3.0-or-later
// v1.3.0: the news emails are opt-in and reach El Dugout. Runs against a local
// account server (see epigrapho-sync-server/deploy/marketing-consent-check.mjs
// for the stack it needs), with EPIGRAPHO_DUGOUT_SECRET=local-check-secret.
// This script stands in for El Dugout (8899) and S3 (9000) itself.
//
// Checks that:
//   1. signing up with the box ticked says yes, in the interface language;
//   2. Privacidad shows it and turns it off;
//   3. an account from before 1.3.0 is asked once, after the first sync,
//      and the answer reaches the server;
//   4. once answered it is not asked again;
//   5. signing up with the box empty says nothing to El Dugout and is never
//      asked.
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const SERVERS = {
  API_HOST: "http://localhost:5264",
  AUTH_HOST: "http://localhost:8264",
  SSE_HOST: "http://localhost:7264"
};
const ASK = "¿Quieres recibir novedades de Epigrapho por correo?";
const OPT_IN =
  "Quiero recibir novedades y ofertas de Epigrapho por correo (una al mes como máximo)";

const events = [];
const dugout = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const signature = createHmac("sha256", "local-check-secret")
      .update(body)
      .digest("hex");
    res.statusCode =
      req.headers["x-epigrapho-signature"] === signature ? 200 : 401;
    if (res.statusCode === 200) events.push(JSON.parse(body));
    res.end();
  });
}).listen(8899);
const s3 = createServer((req, res) => {
  res.setHeader("Content-Type", "application/xml");
  res.end(
    '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>attachments</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>'
  );
})
  // Another stand-in may already be serving 9000; that one will do.
  .on("error", () => {})
  .listen(9000);

async function launch(profile) {
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

async function freshApp(name) {
  const profile = await mkdtemp(
    path.join(profilesRoot(), `epigrapho-consent-${name}-`)
  );
  let { app, page } = await launch(profile);
  await page.evaluate(
    (servers) => localStorage.setItem("serverUrls", JSON.stringify(servers)),
    SERVERS
  );
  await app.close();
  ({ app, page } = await launch(profile));
  return { app, page, profile };
}

async function signup(page, tick) {
  const email = `a4-${Date.now()}@example.com`;
  await page.evaluate(() => window.location.assign("/signup#/"));
  await page.locator("#authForm").waitFor();
  await page.fill("#email", email);
  await page.fill("#password", "a4-consent-password");
  await page.fill("#confirm-password", "a4-consent-password");
  await page.getByText(OPT_IN).waitFor();
  if (tick) {
    await page.getByText(OPT_IN).click();
    assert.ok(
      await page.locator('[data-test-id="signup-marketing"]').isChecked()
    );
  }
  await page.locator('[data-test-id="submitButton"]').click();
  const recovery = page.locator('[data-test-id="recovery-key-dialog"]');
  await recovery.waitFor();
  await recovery.locator('[data-test-id="recovery-key"]').waitFor();
  await recovery.locator('[data-test-id="dialog-yes"]').click();
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  return email;
}

async function privacyToggle(page) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  await page
    .locator('[data-test-id="settings-navigation-menu"]')
    .getByText("Privacidad", { exact: true })
    .click();
  const setting = page.locator('[data-test-id="setting-marketing"]');
  await setting.getByText(OPT_IN).waitFor();
  return setting.locator("input[type=checkbox]");
}

async function waitForEvents(count, timeout = 20000) {
  const start = Date.now();
  while (events.length < count) {
    if (Date.now() - start > timeout)
      throw new Error(`esperaba ${count} avisos, llegaron ${events.length}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// The app's own instance of a module (vite may serve it with ?t=).
const appModule = (page, file) =>
  page.evaluate(
    (file) =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => name.includes(file)),
    file
  );

let current;
try {
  // ---- 1. ticked ----
  current = await freshApp("si");
  const email = await signup(current.page, true);
  await waitForEvents(1);
  assert.deepEqual(
    [events[0].event, events[0].email, events[0].consent, events[0].locale],
    ["consent", email, true, "es-MX"]
  );
  console.log("1. registrarse con la casilla marcada dice que sí, en es-MX");

  // ---- 2. Privacidad ----
  let toggle = await privacyToggle(current.page);
  assert.equal(await toggle.isChecked(), true);
  await toggle.click({ force: true });
  await waitForEvents(2);
  assert.equal(events[1].consent, false);
  await current.page.waitForFunction(
    () =>
      !document.querySelector(
        '[data-test-id="setting-marketing"] input[type=checkbox]'
      ).checked
  );
  console.log("2. Privacidad lo muestra y lo apaga");

  // ---- 3. an account from before 1.3.0 ----
  const db = await appModule(current.page, "/common/db.ts");
  await current.page.evaluate(async (db) => {
    const { db: database } = await import(db);
    await database.settings.setEpigrapho("epigrapho:marketingAsked", undefined);
  }, db);
  await current.page.locator('[data-test-id="sync-status-synced"]').waitFor();
  await current.app.close();
  current = { ...current, ...(await launch(current.profile)) };
  const question = current.page.locator('[data-test-id="confirm-dialog"]');
  await question.getByText(ASK).waitFor({ timeout: 45000 });
  await question.getByRole("button", { name: "Sí, quiero" }).click();
  await waitForEvents(3);
  assert.equal(events[2].consent, true);
  toggle = await privacyToggle(current.page);
  assert.equal(await toggle.isChecked(), true);
  console.log(
    "3. una cuenta de antes de 1.3.0 recibe la pregunta y el sí llega"
  );

  // ---- 4. not again ----
  await current.app.close();
  current = { ...current, ...(await launch(current.profile)) };
  await current.page.waitForTimeout(35000);
  assert.equal(await current.page.getByText(ASK).count(), 0);
  await current.app.close();
  console.log("4. ya respondida, no vuelve a preguntar");

  // ---- 5. empty box ----
  current = await freshApp("no");
  await signup(current.page, false);
  toggle = await privacyToggle(current.page);
  assert.equal(await toggle.isChecked(), false);
  await current.app.close();
  current = { ...current, ...(await launch(current.profile)) };
  await current.page.waitForTimeout(35000);
  assert.equal(await current.page.getByText(ASK).count(), 0);
  assert.equal(events.length, 3, "la casilla vacía avisó a El Dugout");
  console.log("5. con la casilla vacía no se avisa a El Dugout ni se pregunta");

  console.log(
    "GREEN: los correos de novedades son de alta, se preguntan una vez y El Dugout se entera."
  );
  console.log(`Evidencia: ${current.profile}`);
} catch (error) {
  await current?.page
    ?.screenshot({ path: path.join(current.profile, "failure.png") })
    .catch(() => {});
  console.error(`Evidencia: ${current?.profile}`);
  throw error;
} finally {
  await current?.app.close().catch(() => {});
  dugout.close();
  s3.close();
}
