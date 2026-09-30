// SPDX-License-Identifier: GPL-3.0-or-later
// The grammar checker's settings (A2 Paso 1.5): on and without style rules in
// a clean install; style rules add their findings; it checks in the
// languages of the spell checker; and switching it off clears the note.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const profile = await mkdtemp(
  path.join(profilesRoot(), "epigrapho-grammar-settings-")
);
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const paragraph = (n) => `.active .ProseMirror p:nth-of-type(${n})`;
const findings = (n) =>
  page.locator(`${paragraph(n)} .grammar-error`).allInnerTexts();
const toggle = (key) =>
  page.locator(`[data-test-id="setting-${key}"] [data-checked]`).first();

/** Opens Settings > Editor, runs `work` there, and closes it again. */
async function inEditorSettings(work) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  await page.locator(".ReactModal__Content").waitFor();
  await page
    .locator(
      '[data-test-id="settings-navigation-menu"] [data-test-id="navigation-item"]'
    )
    .filter({ hasText: /^Editor$/ })
    .click();
  await page.locator('[data-test-id="setting-grammar-checker"]').waitFor();
  const result = await work();
  await page.keyboard.press("Escape");
  await page.locator(".ReactModal__Content").waitFor({ state: "detached" });
  return result;
}

/** Waits until paragraph n shows `expected` findings. */
async function until(n, expected, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await findings(n);
    if (expected(last)) return last;
    await page.waitForTimeout(500);
  }
  return last;
}

try {
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // 1. A clean install: grammar on, style off.
  const defaults = await inEditorSettings(async () => ({
    grammar: await toggle("grammar-checker").getAttribute("data-checked"),
    style: await toggle("grammar-style").getAttribute("data-checked")
  }));
  console.log("por defecto:", JSON.stringify(defaults));
  assert.deepEqual(defaults, { grammar: "true", style: "false" });

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill("Ajustes");
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type("Él vino. Él comió. Él se fue. Él volvió.", {
    delay: 15
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("¿Que hora es?", { delay: 15 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("He go to school yesterday.", { delay: 15 });
  // The accent is found, so the checker has answered for the whole note.
  assert.deepEqual(await until(2, (found) => found.length > 0, 60000), ["Que"]);
  const before = { style: await findings(1), english: await findings(3) };
  console.log("sin estilo, solo español:", JSON.stringify(before));
  assert.deepEqual(before.style, []);
  assert.deepEqual(before.english, []);

  // 2. Style on: the repeated opening word is marked.
  await inEditorSettings(() => toggle("grammar-style").evaluate((input) => input.click()));
  const style = await until(1, (found) => found.length > 0);
  console.log("con estilo:", JSON.stringify(style));
  assert.ok(style.length > 0, "las reglas de estilo no marcaron nada");

  // 3. English ticked for the spell checker: English grammar is checked too.
  await inEditorSettings(() =>
    page.locator('[data-test-id="spell-checker-language-en"]').check()
  );
  const english = await until(3, (found) => found.length > 0);
  console.log("inglés:", JSON.stringify(english));
  assert.deepEqual(english, ["go"]);

  // 4. Off: every mark leaves the note.
  await inEditorSettings(() => toggle("grammar-checker").evaluate((input) => input.click()));
  const off = await until(2, (found) => found.length === 0);
  console.log("apagado:", JSON.stringify(off));
  assert.deepEqual(off, []);
  assert.equal(
    await page.locator(".active .ProseMirror .grammar-error").count(),
    0
  );

  console.log(
    "GREEN: el corrector gramatical viene activado y sin estilo, el estilo agrega sus marcas, revisa en los idiomas del corrector y al apagarlo la nota queda limpia."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
