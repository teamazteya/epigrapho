// SPDX-License-Identifier: GPL-3.0-or-later
// A3 Fase 4: sermon mode.
//
// Opens a note in sermon mode from its menu and checks that it fills the
// screen in large type, that A+ and A- change the size (and the size is
// remembered), that the timer runs, pauses and resets, that a tap on a
// reference opens its verse and a second tap closes it, and that Esc leaves
// without touching the note.
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "A3 Fase 4";
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-sermon-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const sermon = page.locator('[data-test-id="sermon-mode"]');
const text = page.locator('[data-test-id="sermon-mode-text"]');
const fontSize = () =>
  text.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
const editorHtml = () =>
  page.evaluate(() =>
    document.querySelector(".active .ProseMirror").editor.getHTML()
  );

async function openSermon() {
  await page
    .locator('[data-test-id="list-item"]')
    .filter({ hasText: TITLE })
    .first()
    .click({ button: "right" });
  await page.locator('[data-test-id="menu-button-sermon-mode"]').click();
  await sermon.waitFor();
}

try {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type("Hoy predicamos Juan 3:16 con alegria.", {
    delay: 25
  });
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .waitFor({ timeout: 20000 });
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
  const before = await editorHtml();

  // ---- 1. the whole window, in large type ----
  await openSermon();
  const box = await sermon.boundingBox();
  const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
  assert.ok(box.width >= viewport[0] - 1 && box.height >= viewport[1] - 1);
  assert.match(await text.innerText(), /Hoy predicamos Juan 3:16/);
  const initial = await fontSize();
  assert.ok(initial >= 28, `la letra es chica: ${initial}px`);
  console.log(
    `1. modo sermón a pantalla completa (${box.width}×${box.height}), letra de ${initial}px`
  );

  // ---- 2. A+ / A- ----
  await page.locator('[data-test-id="sermon-larger"]').click();
  await page.locator('[data-test-id="sermon-larger"]').click();
  assert.equal(await fontSize(), initial + 8);
  await page.locator('[data-test-id="sermon-smaller"]').click();
  assert.equal(await fontSize(), initial + 4);
  console.log(`2. A+ y A− cambian la letra a ${initial + 4}px`);

  // ---- 3. the timer ----
  const timer = page.locator('[data-test-id="sermon-timer"]');
  await page.locator('[data-test-id="sermon-timer-toggle"]').click();
  await page.waitForTimeout(2300);
  await page.locator('[data-test-id="sermon-timer-toggle"]').click();
  const stopped = await timer.innerText();
  assert.match(stopped, /^0:0[2-3]$/);
  await page.waitForTimeout(1200);
  assert.equal(await timer.innerText(), stopped, "el cronómetro no se pausó");
  await page.locator('[data-test-id="sermon-timer-reset"]').click();
  assert.equal(await timer.innerText(), "0:00");
  console.log(
    `3. el cronómetro corrió hasta ${stopped}, se pausó y volvió a 0:00`
  );

  // ---- 4. a tap opens the verse, another closes it ----
  const reference = text.locator('span[data-scripture-ref="JHN.3.16"]');
  await reference.click();
  const verse = text.locator('[data-test-id="sermon-verse"]');
  await verse.waitFor();
  const verseText = await verse.innerText();
  assert.match(verseText, /Porque Dios amó al mundo/);
  assert.match(verseText, /VBL/);
  await reference.click();
  await verse.waitFor({ state: "detached" });
  console.log("4. un toque despliega Juan 3:16 y otro lo pliega");

  // ---- 5. Esc leaves, the note is untouched, the size is remembered ----
  await page.keyboard.press("Escape");
  await sermon.waitFor({ state: "detached" });
  assert.equal(await editorHtml(), before, "el modo sermón cambió la nota");
  await openSermon();
  assert.equal(await fontSize(), initial + 4);
  await page.locator('[data-test-id="sermon-exit"]').click();
  await sermon.waitFor({ state: "detached" });
  console.log("5. Esc sale sin tocar la nota, y el tamaño se recuerda");

  console.log(
    "GREEN: el modo sermón muestra la nota en grande, con A+/A−, cronómetro y referencias que se despliegan."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
