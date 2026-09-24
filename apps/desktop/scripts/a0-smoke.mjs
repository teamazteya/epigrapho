// SPDX-License-Identifier: GPL-3.0-or-later
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-a0-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  // A0 arranca en es-MX: la navegación debe estar en español.
  await page.getByText("Notas", { exact: true }).first().waitFor();
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page
    .locator('.active [data-test-id="editor-title"]')
    .fill("A0 verification");
  await page.locator(".active .ProseMirror").fill("Nota local de prueba A0.");
  await page.locator('[data-test-id="editor-save-state-saved"]').waitFor();
  await page.reload();
  await page.locator(".active .ProseMirror").waitFor();
  assert.match(
    await page.locator(".active .ProseMirror").innerText(),
    /Nota local de prueba A0\./
  );
  await page.screenshot({ path: path.join(profile, "green.png") });
  console.log("GREEN: Electron abrió; nota creada y conservada al recargar.");
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  console.error((await page.locator("body").innerText()).slice(0, 5000));
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
