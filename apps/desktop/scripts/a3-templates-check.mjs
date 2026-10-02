// SPDX-License-Identifier: GPL-3.0-or-later
// A3 Fase 1: note templates.
//
// Two Electron windows sign in to the same test account and check that:
//   1. a built-in template (the expository sermon) starts a note with its
//      sections, in Spanish;
//   2. a note saved with "Guardar como plantilla" is listed with the others,
//      and a note started from it carries the same content;
//   3. the saved template reaches the other window through the account;
//   4. Settings > Editor > Plantillas renames and deletes it.
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

const RUN = Date.now().toString(36);
const TEMPLATE = `Plantilla ${RUN}`;
const RENAMED = `Renombrada ${RUN}`;
const MARKER = `Bosquejo propio ${RUN}`;

const sessions = [];

async function launch(name) {
  const profile = await mkdtemp(
    path.join(profilesRoot(), `epigrapho-a3-templates-${name}-`)
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
  // A4: the test account is asked once about the news emails. Whichever
  // session sees the question says no and carries on.
  await page.addLocatorHandler(
    page.getByText("¿Quieres recibir novedades de Epigrapho por correo?"),
    () => page.getByRole("button", { name: "No, gracias" }).click()
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
}

/** Waits until the sync icon has said "synced" for a few seconds in a row. */
async function settled(page) {
  const synced = page.locator('[data-test-id="sync-status-synced"]');
  for (let quiet = 0; quiet < 6; ) {
    quiet = (await synced.count()) ? quiet + 1 : 0;
    await page.waitForTimeout(500);
  }
}

const editorText = (page) =>
  page.locator(".active .ProseMirror").first().innerText();

/** Opens the template menu and starts a note with the one named `title`. */
async function fromTemplate(page, title) {
  await page.locator('[data-test-id="new-note-from-template"]').click();
  await page
    .locator('[data-test-id="menu-container"]')
    .getByText(title, { exact: true })
    .click();
  await page.waitForFunction((prefix) => {
    const title = document.querySelector(
      '.active [data-test-id="editor-title"]'
    );
    return (title?.value || title?.textContent || "").startsWith(prefix);
  }, `${title} — `);
  await page.waitForTimeout(1000);
}

async function templateMenu(page) {
  await page.locator('[data-test-id="new-note-from-template"]').click();
  const menu = page.locator('[data-test-id="menu-container"]');
  await menu.waitFor();
  await page.waitForTimeout(1000);
  const text = await menu.innerText();
  await page.keyboard.press("Escape");
  return text;
}

try {
  const a = await launch("a");
  await login(a);
  // The first sync after signing in brings the account's templates down; a
  // template saved before it ends would race it (see templates.ts).
  await settled(a.page);

  // ---- 1. built in ----
  await fromTemplate(a.page, "Sermón expositivo");
  const sermon = await editorText(a.page);
  for (const heading of [
    "Idea central",
    "Bosquejo",
    "Primer punto",
    "Aplicación"
  ])
    assert.ok(sermon.includes(heading), `falta «${heading}» en el sermón`);
  console.log("1. el sermón expositivo trae sus secciones en español");

  // ---- 2. save as template, start a note from it ----
  await a.page.evaluate((marker) => {
    const { editor } = document.querySelector(".active .ProseMirror");
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      content: [{ type: "text", text: marker }]
    });
  }, MARKER);
  await a.page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
  const title = await a.page
    .locator('.active [data-test-id="editor-title"]')
    .evaluate((e) => e.value || e.textContent);
  await a.page
    .locator('[data-test-id="list-item"]')
    .filter({ hasText: title })
    .first()
    .click({ button: "right" });
  await a.page.locator('[data-test-id="menu-button-save-as-template"]').click();
  await a.page.locator(".ReactModal__Content input").fill(TEMPLATE);
  await a.page.keyboard.press("Enter");
  await a.page.getByText(`Se guardó «${TEMPLATE}» como plantilla.`).waitFor();
  assert.ok((await templateMenu(a.page)).includes(TEMPLATE));
  await fromTemplate(a.page, TEMPLATE);
  const copy = await editorText(a.page);
  assert.ok(copy.includes(MARKER) && copy.includes("Idea central"));
  console.log("2. la plantilla propia aparece en el menú y crea notas iguales");

  // ---- 3. it travels ----
  const b = await launch("b");
  await login(b);
  const start = Date.now();
  for (;;) {
    if ((await templateMenu(b.page)).includes(TEMPLATE)) break;
    assert.ok(Date.now() - start < 60000, "la plantilla no llegó a B");
    await b.page.waitForTimeout(3000);
  }
  console.log(
    `3. la plantilla llegó a la otra sesión en ${Date.now() - start} ms`
  );

  // ---- 4. rename and delete in Settings ----
  await a.page.evaluate(() => (window.location.hash = "/settings"));
  await a.page
    .locator('[data-test-id="settings-navigation-menu"]')
    .getByText("Editor", { exact: true })
    .click();
  const setting = a.page.locator('[data-test-id="setting-note-templates"]');
  await setting.waitFor();
  const row = setting
    .locator('[data-test-id="user-template"]')
    .filter({ hasText: TEMPLATE });
  await row.getByText("Renombrar", { exact: true }).click();
  await a.page.locator(".ReactModal__Content input").last().fill(RENAMED);
  await a.page.keyboard.press("Enter");
  const renamed = setting
    .locator('[data-test-id="user-template"]')
    .filter({ hasText: RENAMED });
  await renamed.waitFor();
  await renamed.getByText("Eliminar", { exact: true }).click();
  await renamed.waitFor({ state: "detached" });
  // The deleted row had the focus; Escape only reaches the dialog from inside.
  await setting.getByText("Tus plantillas").click();
  await a.page.keyboard.press("Escape");
  await a.page.locator(".ReactModal__Content").waitFor({ state: "detached" });
  assert.ok(!(await templateMenu(a.page)).includes(RENAMED));
  console.log("4. Ajustes renombra y borra la plantilla");

  console.log(
    "GREEN: las plantillas de fábrica y las propias crean notas, y las propias viajan con la cuenta."
  );
} catch (error) {
  for (const { page, profile } of sessions)
    await page
      .screenshot({ path: path.join(profile, "failure.png") })
      .catch(() => undefined);
  console.error("Evidencia:", sessions.map((s) => s.profile).join(", "));
  throw error;
} finally {
  for (const { app } of sessions) await app.close().catch(() => undefined);
}
