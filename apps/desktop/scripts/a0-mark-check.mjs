// SPDX-License-Identifier: GPL-3.0-or-later
// Applies the scriptureReference mark to text in a real note, reloads the app
// and checks the mark and its ref survived the round trip through storage.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Epigrapho 5.2";
const MARKED_HTML =
  '<p><span data-scripture-ref="JHN.3.16" data-versification="default">Juan 3:16</span> es el verso.</p>';

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-mark-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);

const readMark = () =>
  page.evaluate(() => {
    const span = document.querySelector(
      ".active .ProseMirror span[data-scripture-ref]"
    );
    return span
      ? {
          ref: span.getAttribute("data-scripture-ref"),
          versification: span.getAttribute("data-versification"),
          className: span.getAttribute("class"),
          text: span.textContent,
          paragraph: span.parentElement?.textContent
        }
      : undefined;
  });

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);

  // The mark is applied by pasting HTML that carries it: that exercises the
  // same parseHTML rules the editor uses when a stored note is reopened.
  await page.locator(".active .ProseMirror").click();
  await page.evaluate((html) => {
    const editor = document.querySelector(".active .ProseMirror");
    const data = new DataTransfer();
    data.setData("text/html", html);
    editor.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true
      })
    );
  }, MARKED_HTML);

  const applied = await readMark();
  console.log("aplicado:", JSON.stringify(applied));
  assert.ok(applied, "el mark no se aplico al pegar");
  assert.equal(applied.ref, "JHN.3.16");

  // A keystroke after the paste makes the editor dirty for sure; then wait for
  // the save indicator to come back before pulling the rug out with a reload.
  await page.keyboard.type(" ");
  await page
    .locator('[data-test-id="editor-save-state-notsaved"]')
    .waitFor({ timeout: 15000 })
    .catch(() => undefined);
  await page.locator('[data-test-id="editor-save-state-saved"]').waitFor();
  await page.waitForTimeout(2000);

  await page.reload();
  await page.getByText("Notas", { exact: true }).first().waitFor();
  const mark = page.locator(".active .ProseMirror span[data-scripture-ref]");
  try {
    // The app usually restores the open tab by itself after a reload.
    await mark.waitFor({ timeout: 20000 });
  } catch {
    await page
      .locator('[data-test-id="title"]', { hasText: TITLE })
      .first()
      .click();
    await mark.waitFor();
  }

  const reloaded = await readMark();
  console.log("tras recargar:", JSON.stringify(reloaded));
  assert.ok(reloaded, "el mark no sobrevivio a la recarga");
  assert.equal(reloaded.ref, "JHN.3.16");
  // The fixture is written the way A0 wrote marks, with "default". Reloading
  // it upgrades the attribute to the canonical table's real name: the two
  // strings always meant the same numbering, and the mapping answers to both,
  // so a note written before Paso 4.5 keeps working and stops being special.
  assert.equal(reloaded.versification, "eng");
  assert.equal(reloaded.text, "Juan 3:16");
  assert.equal(reloaded.className, "scripture-reference");
  assert.equal(reloaded.paragraph.trim(), "Juan 3:16 es el verso.");
  console.log(
    "GREEN: el mark scriptureReference y su ref sobreviven la recarga."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
