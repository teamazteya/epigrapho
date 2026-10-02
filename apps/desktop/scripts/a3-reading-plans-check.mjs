// SPDX-License-Identifier: GPL-3.0-or-later
// A3 Fase 3: reading plans.
//
// Two Electron windows sign in to the same test account and check that:
//   1. M'Cheyne started two days ago shows day 3, its four readings in
//      Spanish and the two earlier days as pending;
//   2. a reading's text opens from the embedded translation;
//   3. marking days as read moves the progress, and it reaches the other
//      window through the account;
//   4. the plan's daily reminder exists at 8:00 and follows a new time;
//   5. "Escribir sobre esto" makes the day's note, its readings already marked
//      as references, and the plan never makes one on its own;
//   6. leaving the plan deletes its progress and its reminder.
//
// Same account and variables as s1-sync-check.mjs:
//   S1_EMAIL, S1_PASSWORD, S1_TOTP_SECRET
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const { generateSync } = createRequire(
  new URL("../../web/package.json", import.meta.url)
)("otplib");

const root = fileURLToPath(new URL("../", import.meta.url));
const { S1_EMAIL, S1_PASSWORD, S1_TOTP_SECRET } = process.env;
if (!S1_EMAIL || !S1_PASSWORD || !S1_TOTP_SECRET)
  throw new Error("Faltan S1_EMAIL, S1_PASSWORD o S1_TOTP_SECRET.");

const sessions = [];

async function launch(name) {
  const profile = await mkdtemp(
    path.join(profilesRoot(), `epigrapho-a3-plans-${name}-`)
  );
  const app = await _electron.launch({
    args: [path.join(root, "build", "electron.js")],
    env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
    timeout: 60000
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) =>
    console.error(`[${name}] pageerror:`, error.message)
  );
  const session = { name, profile, app, page };
  sessions.push(session);
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  return session;
}

async function login({ page }) {
  await page.evaluate(() => window.location.assign("/login#/"));
  await page.locator("#authForm").waitFor();
  await page.fill("#email", S1_EMAIL);
  await page.locator('[data-test-id="submitButton"]').click();
  await page.locator("#code").waitFor();
  await page.fill("#code", generateSync({ secret: S1_TOTP_SECRET }));
  await page.locator('[data-test-id="submitButton"]').click();
  await page.locator("#password").waitFor();
  await page.fill("#password", S1_PASSWORD);
  await page.locator('[data-test-id="submitButton"]').click();
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  await page.locator('[data-test-id="sync-status-synced"]').waitFor();
  // The first sync brings the account's plan down before anything is touched.
  const synced = page.locator('[data-test-id="sync-status-synced"]');
  for (let quiet = 0; quiet < 6; ) {
    quiet = (await synced.count()) ? quiet + 1 : 0;
    await page.waitForTimeout(500);
  }
}

const openPlans = (page) =>
  page
    .locator('[data-test-id="navigation-menu"]')
    .getByText("Planes de lectura", { exact: true })
    .click();

/** The plan's reminder, read from the database. */
const reminder = (page) =>
  page.evaluate(async () => {
    const { db } = await import("/common/db.ts");
    const plan = db.settings.getEpigrapho("epigrapho:readingPlan");
    const item =
      plan?.reminderId && (await db.reminders.reminder(plan.reminderId));
    if (!item) return undefined;
    const date = new Date(item.date);
    return {
      title: item.title,
      recurringMode: item.recurringMode,
      time: `${String(date.getHours()).padStart(2, "0")}:${String(
        date.getMinutes()
      ).padStart(2, "0")}`
    };
  });

const leavePlan = async (page) => {
  await page.getByText("Dejar este plan", { exact: true }).click();
  await page
    .locator(".ReactModal__Content")
    .getByRole("button", { name: "Dejar este plan", exact: true })
    .click();
  await page.locator('[data-test-id="reading-plan-mcheyne"]').waitFor();
};

try {
  const a = await launch("a");
  await login(a);
  await openPlans(a.page);
  // A run that failed half way leaves its plan behind.
  if (await a.page.locator('[data-test-id="reading-plan-name"]').count())
    await leavePlan(a.page);

  // ---- 1. start two days ago ----
  const start = new Date(Date.now() - 2 * 86400000);
  const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(start.getDate()).padStart(2, "0")}`;
  await a.page.locator('[data-test-id="reading-plan-start"]').fill(iso);
  await a.page
    .locator('[data-test-id="reading-plan-mcheyne"]')
    .getByText("Empezar el plan")
    .click();
  const day = a.page.locator('[data-test-id="reading-day"]');
  await day.waitFor();
  assert.match(await day.innerText(), /^Día 3 de 365/);
  const readings = await day
    .locator('[data-test-id="reading"]')
    .evaluateAll((items) =>
      items.map((item) => item.querySelector("div")?.innerText.split("\n")[0])
    );
  console.log("1. hoy:", readings.join(", "));
  assert.deepEqual(readings, ["Génesis 3", "Mateo 3", "Esdras 3", "Hechos 3"]);
  assert.equal(
    await a.page.locator('[data-test-id="reading-plan-pending"]').innerText(),
    "2 días anteriores sin leer"
  );

  // ---- 2. a reading's text ----
  await day
    .locator('[data-test-id="reading"]')
    .first()
    .getByText("Mostrar el texto")
    .click();
  const text = await day.locator('[data-test-id="reading-text"]').innerText();
  console.log("2. Génesis 3:", text.slice(0, 70), "…");
  assert.ok(text.length > 1000, "el capítulo no se mostró completo");

  // ---- 3. progress, and it travels ----
  await day.locator('[data-test-id="reading-day-read"]').click();
  await a.page.getByText("1 de 365 días leídos").waitFor();
  await a.page
    .locator('[data-test-id="reading-plan-pending"]')
    .locator("..")
    .getByRole("button", { name: "1", exact: true })
    .click();
  await a.page.getByText(/^Día 1 de 365/).waitFor();
  await day.locator('[data-test-id="reading-day-read"]').click();
  await a.page.getByText("2 de 365 días leídos").waitFor();
  assert.equal(
    await a.page.locator('[data-test-id="reading-plan-pending"]').innerText(),
    "1 día anterior sin leer"
  );
  const b = await launch("b");
  await login(b);
  await openPlans(b.page);
  await b.page.getByText("2 de 365 días leídos").waitFor({ timeout: 30000 });
  assert.equal(
    await b.page.locator('[data-test-id="reading-plan-name"]').innerText(),
    "M'Cheyne"
  );
  console.log("3. dos días leídos, y el avance llegó a la otra sesión");

  // ---- 4. the reminder ----
  assert.deepEqual(await reminder(a.page), {
    title: "Lectura de hoy: M'Cheyne",
    recurringMode: "day",
    time: "08:00"
  });
  await a.page
    .locator('[data-test-id="reading-plan-reminder-time"]')
    .fill("07:30");
  await a.page.waitForFunction(async () => {
    const { db } = await import("/common/db.ts");
    const plan = db.settings.getEpigrapho("epigrapho:readingPlan");
    const item = await db.reminders.reminder(plan.reminderId);
    return new Date(item.date).getHours() === 7;
  });
  assert.equal((await reminder(a.page)).time, "07:30");
  console.log("4. recordatorio diario a las 8:00, y sigue la hora nueva");

  // ---- 5. write about this ----
  const notesBefore = await a.page.evaluate(async () => {
    const { db } = await import("/common/db.ts");
    return db.notes.all.count();
  });
  await a.page.getByText("Escribir sobre esto", { exact: true }).click();
  await a.page.waitForFunction(() =>
    (
      document.querySelector('.active [data-test-id="editor-title"]')?.value ||
      ""
    ).startsWith("M'Cheyne, día 1 — ")
  );
  const marked = await a.page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .evaluateAll((spans) => spans.map((span) => span.dataset.scriptureRef));
  console.log("5. la nota del día marca:", marked.join(", "));
  assert.deepEqual(marked, [
    "GEN.1.1-GEN.1.31",
    "MAT.1.1-MAT.1.25",
    "EZR.1.1-EZR.1.11",
    "ACT.1.1-ACT.1.26"
  ]);
  const notesAfter = await a.page.evaluate(async () => {
    const { db } = await import("/common/db.ts");
    return db.notes.all.count();
  });
  assert.equal(notesAfter, notesBefore + 1, "el plan creó notas por su cuenta");

  // ---- 6. leave ----
  // The plans stay in the list column beside the new note. (Clicking the
  // route that is already open would hide that column, as Notesnook does.)
  await a.page.locator('[data-test-id="reading-plan-name"]').waitFor();
  await leavePlan(a.page);
  assert.equal(await reminder(a.page), undefined);
  console.log("6. dejar el plan borra el avance y su recordatorio");

  console.log(
    "GREEN: el plan muestra el día, guarda el avance en la cuenta, avisa a diario y escribe la nota del día solo cuando se pide."
  );
} catch (error) {
  for (const { name, page } of sessions)
    console.error(
      `plan en ${name}:`,
      await page
        .evaluate(async () => {
          const { db } = await import("/common/db.ts");
          return JSON.stringify(
            db.settings.getEpigrapho("epigrapho:readingPlan")
          );
        })
        .catch((e) => e.message)
    );
  for (const { page, profile } of sessions)
    await page
      .screenshot({ path: path.join(profile, "failure.png") })
      .catch(() => undefined);
  console.error("Evidencia:", sessions.map((s) => s.profile).join(", "));
  throw error;
} finally {
  for (const { app } of sessions) await app.close().catch(() => undefined);
}
