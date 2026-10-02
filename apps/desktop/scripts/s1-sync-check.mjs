// SPDX-License-Identifier: GPL-3.0-or-later
// S1 Paso 4.4: two computers, one account, Epigrapho's sync server.
//
// Two Electron windows with their own profiles sign in to the same account on
// the real server (sync/auth/events.azteya.tech) and check that:
//   1. a note written in A shows up in B in under 5 seconds (live sync);
//   2. a reference (Romanos 8:28), a Scripture Block and an interlinear arrive
//      exactly as A wrote them;
//   3. an attachment arrives, and B's account shows it stored;
//   4. with B offline, both edit the note; once B is back the Merger keeps
//      one version and marks the conflict, so the other is not lost;
//   5. a file above the 500 MB an account may store is refused in Spanish.
//
// The account is a test account with two-factor by authenticator app, so the
// check can sign in on its own. Its details never go in the repo:
//   S1_EMAIL, S1_PASSWORD, S1_TOTP_SECRET
// The server's 413 at 500 MB stored is not exercised here, since that needs
// half a gigabyte uploaded per run; it was checked once by hand (S1 runbook).
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp, open as openFile, writeFile } from "node:fs/promises";
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
const TITLE = `S1 ${RUN}`;
const LIVE_LIMIT_MS = 5000;
const DIFF = '[data-test-id="diff-viewer"]';

const sessions = [];

async function launch(name) {
  const profile = await mkdtemp(
    path.join(profilesRoot(), `epigrapho-s1-${name}-`)
  );
  const app = await _electron.launch({
    args: [path.join(root, "build", "electron.js")],
    env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
    timeout: 60000
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (error) =>
    console.error(`[${name}] pageerror:`, error.message)
  );
  const session = { name, profile, app, page };
  sessions.push(session);
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  return session;
}

/** Signs in the way a person does: email, the app's code, then the password. */
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

const editorHtml = (page) =>
  page.evaluate(() =>
    document.querySelector(".active .ProseMirror").editor.getHTML()
  );

const saved = (page) =>
  page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });

/**
 * Puts the cursor in an empty paragraph at the end of the note, adding one if
 * the note ends in a block. Clicking would land on whatever is under the
 * mouse (a reference, an attachment chip), and typing replaces a selected chip.
 */
async function toEnd(page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const { editor } = document.querySelector(".active .ProseMirror");
    const last = editor.state.doc.lastChild;
    if (last.type.name !== "paragraph" || last.content.size > 0)
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: "paragraph"
      });
    editor.commands.focus("end");
  });
}

async function insertFromMenu(page, item, title, input) {
  await toEnd(page);
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator(`[data-test-id="menu-button-${item}"]`).click();
  await page
    .locator('[data-test-id="dialog-title"]', { hasText: title })
    .waitFor();
  await page.keyboard.type(input);
  await page.locator('[data-test-id="dialog-yes"]').click();
}

async function attach(page, file) {
  await toEnd(page);
  const chooser = page.waitForEvent("filechooser");
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-attachment"]').click();
  await (await chooser).setFiles(file);
}

async function openNote({ page }) {
  await page.getByText(TITLE).first().click();
  await page.locator(DIFF).waitFor({ state: "detached" });
  await page.locator(".active .ProseMirror").waitFor();
}

/** Polls until `read` returns something `ok` accepts, or fails with the last value. */
async function until(read, ok, ms, what) {
  const end = Date.now() + ms;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (ok(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(`${what}: ${JSON.stringify(value)?.slice(-600)}`);
}

// Chromium's offline mode: requests fail and the sync hub's socket drops, as
// when the network goes away.
const offline = ({ page }, value) => page.context().setOffline(value);

async function typeAtEnd(page, text) {
  await toEnd(page);
  await page.keyboard.type(text);
}

/** Whether one of the note's saved versions on this computer has `text`. */
async function historyHas(page, text) {
  await page
    .getByTitle(/^(Propiedades|Properties)$/)
    .first()
    .click();
  const items = page.locator('[data-test-id="session-item"]');
  await items.first().waitFor({ timeout: 15000 });
  for (let i = 0; i < (await items.count()); ++i) {
    await items.nth(i).click();
    await page.locator(DIFF).waitFor();
    if ((await page.locator(DIFF).innerText()).includes(text)) return true;
  }
  return false;
}

try {
  const a = await launch("a");
  const b = await launch("b");
  await login(a);
  await login(b);
  // The first sync after signing in downloads the whole account, and while
  // it runs the live messages are set aside; the clock starts after it.
  for (const { page } of [a, b]) await settled(page);
  console.log("las dos ventanas iniciaron sesión con la misma cuenta");

  // ---- 1. live ----
  await a.page.locator('[data-test-id="create-new-note"]').first().click();
  await a.page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await saved(a.page);
  const start = Date.now();
  await b.page.getByText(TITLE).first().waitFor({ timeout: 30000 });
  const live = Date.now() - start;
  console.log(`1. la nota llegó a B en ${live} ms`);
  assert.ok(live < LIVE_LIMIT_MS, `tardó ${live} ms, más de ${LIVE_LIMIT_MS}`);

  // ---- 2. a reference, a Scripture Block and an interlinear ----
  await a.page.locator(".active .ProseMirror").click();
  await a.page.mouse.move(0, 0);
  await a.page.keyboard.type("Romanos 8:28 dice que todo ayuda a bien. ");
  await a.page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .first()
    .waitFor();
  await insertFromMenu(a.page, "scripture", "Insertar Escritura", "Juan 3:16");
  await a.page
    .locator(".active .ProseMirror .scripture-block")
    .first()
    .waitFor();
  await insertFromMenu(
    a.page,
    "interlinear",
    "Insertar interlineal",
    "Juan 3:16"
  );
  await a.page
    .locator(".active .ProseMirror .interlinear .interlinear-word")
    .first()
    .waitFor();
  await saved(a.page);
  const written = await editorHtml(a.page);
  assert.match(written, /data-scripture-ref="ROM\.8\.28"/);
  assert.match(written, /data-interlinear-ref="JHN\.3\.16"/);

  // The list's preview comes with the note itself; once it shows A's text,
  // the content is here too. Opening the note while its content is still on
  // the way can leave the editor empty until it is reopened (upstream).
  await b.page
    .locator('[data-test-id="list-item"]', { hasText: "dice que todo ayuda" })
    .first()
    .waitFor({ timeout: 60000 });
  await settled(b.page);
  await openNote(b);
  const arrived = await until(
    () => editorHtml(b.page),
    (html) => html === written,
    60000,
    "B no tiene la misma nota"
  );
  assert.match(arrived, /scripture-block|data-scripture-block/);
  console.log("2. la referencia, el bloque y el interlineal llegaron iguales");

  // ---- 3. an attachment ----
  const file = path.join(a.profile, `s1-adjunto-${RUN}.txt`);
  await writeFile(file, `Adjunto de prueba ${RUN}\n`.repeat(2000));
  await attach(a.page, file);
  // The node view draws a chip; the hash is in the note's HTML.
  const hash = (
    await until(
      () => editorHtml(a.page),
      (html) => /data-hash="[^"]+"/.test(html),
      60000,
      "A no insertó el adjunto"
    )
  ).match(/data-hash="([^"]+)"/)[1];
  await saved(a.page);
  await until(
    () => editorHtml(b.page),
    (html) => html.includes(hash),
    60000,
    "el adjunto no llegó a B"
  );
  const stored = await until(
    async () => {
      await b.page.evaluate(() => (window.location.hash = "/settings"));
      await b.page.locator(".ReactModal__Content").waitFor();
      const text = await b.page.locator(".ReactModal__Content").innerText();
      await b.page.keyboard.press("Escape");
      return text.match(/([\d.,]+ \w+) de 500 MB en adjuntos/)?.[1];
    },
    (used) => used && !/^0 /.test(used),
    90000,
    "la cuenta de B no muestra el adjunto guardado"
  );
  console.log(
    `3. el adjunto llegó a B y la cuenta muestra ${stored} de 500 MB`
  );

  // ---- 4. both edit while B is offline ----
  // The protocol is upstream's and is not touched (S1 rule). What the Merger
  // does depends on the order things reach the server: if B fetches before
  // it sends, edits more than a minute apart are a conflict and B shows both
  // versions side by side; if B's edit goes up first, it is the newest and
  // wins, and A's version stays in A's note history. Either way neither is
  // lost, and that is what this checks.
  // One word each: the side-by-side view marks changes word by word, so a
  // shared word would split the text of each version.
  const editA = ` alfa${RUN}`;
  const editB = ` beta${RUN}`;
  await offline(b, true);
  await typeAtEnd(a.page, editA);
  await saved(a.page);
  await a.page.waitForTimeout(3000);
  assert.ok(
    !(await editorHtml(b.page)).includes(editA.trim()),
    "B recibió la edición sin red"
  );
  await b.page.waitForTimeout(62000);
  await typeAtEnd(b.page, editB);
  await saved(b.page);
  await offline(b, false);
  await b.page.locator('[data-test-id^="sync-status-"]').click();

  const outcome = await until(
    async () => {
      for (const { name, page } of [b, a])
        if (await page.locator(DIFF).count()) return { conflict: name };
      const [inA, inB] = await Promise.all([
        editorHtml(a.page),
        editorHtml(b.page)
      ]);
      if (inA === inB) return { kept: inA.includes(editB.trim()) ? "b" : "a" };
    },
    Boolean,
    90000,
    "las dos ventanas no llegaron a la misma nota"
  );
  if (outcome.conflict) {
    const { page } = outcome.conflict === "a" ? a : b;
    const text = await until(
      () => page.locator(DIFF).innerText(),
      (text) => text.includes(editA.trim()) && text.includes(editB.trim()),
      30000,
      "el conflicto no muestra las dos versiones"
    );
    assert.ok(text);
    console.log(
      `4. sin red en B: ${outcome.conflict.toUpperCase()} marcó el conflicto y muestra las dos versiones`
    );
  } else {
    const lost = outcome.kept === "a" ? b : a;
    const lostEdit = (outcome.kept === "a" ? editB : editA).trim();
    assert.ok(
      await historyHas(lost.page, lostEdit),
      `la edición de ${lost.name.toUpperCase()} no quedó en su historial`
    );
    console.log(
      `4. sin red en B: quedó la versión de ${outcome.kept.toUpperCase()} en las dos, y la de ${lost.name.toUpperCase()} está en su historial`
    );
  }

  // ---- 5. a file over the 500 MB an account may store ----
  const big = path.join(a.profile, "grande.bin");
  const handle = await openFile(big, "w");
  await handle.truncate(501 * 1024 * 1024);
  await handle.close();
  await openNote(a);
  await attach(a.page, big);
  const refused = await a.page
    .locator('[data-test-id="toast"]', { hasText: "500 MB" })
    .first()
    .innerText();
  console.log("5. aviso:", refused);
  assert.match(refused, /pesa más de 500 MB/);

  console.log(
    "GREEN: sync en vivo, contenido bíblico, adjuntos, conflicto y tope, en el servidor de Epigrapho."
  );
} catch (error) {
  for (const { name, page, profile } of sessions)
    await page
      .screenshot({ path: path.join(profile, `failure-${name}.png`) })
      .catch(() => undefined);
  console.error("Evidencia:", sessions.map((s) => s.profile).join(" · "));
  throw error;
} finally {
  for (const { app } of sessions) await app.close().catch(() => undefined);
}
