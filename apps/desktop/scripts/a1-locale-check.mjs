// SPDX-License-Identifier: GPL-3.0-or-later
// Switches the interface language to English and back to Spanish from Settings,
// and checks the note written in between comes back untouched, references and
// all (PRD §31.2).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Epigrapho 2.3";
const BODY = "Juan 3:16 y John 3:16 en la misma nota.";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-locale-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/** Everything about the note that must survive a language change. */
const readNote = () =>
  page.evaluate(() => {
    const editor = document.querySelector(".active .ProseMirror");
    return {
      title: document.querySelector('.active [data-test-id="editor-title"]')
        ?.value,
      text: editor?.textContent,
      refs: [
        ...(editor?.querySelectorAll("span[data-scripture-ref]") ?? [])
      ].map((span) => span.getAttribute("data-scripture-ref"))
    };
  });

/** Picks a language in Settings > Appearance. The app reloads on its own. */
async function chooseLanguage(locale) {
  // Settings is a hash route, so this opens it whatever the sidebar is called.
  await page.evaluate(() => (window.location.hash = "/settings"));
  // The dialog mounts on the hash change; filling the search before it
  // is there types into the box that is on its way out.
  await page.locator(".ReactModal__Content").waitFor();
  // The section id is the same in every language, so the search finds the
  // group whatever the interface is showing.
  await page.locator('[data-test-id="settings-search"]').fill("appearance");
  const select = page.locator('[data-test-id="setting-ui-language"] select');
  await select.waitFor();
  await select.selectOption(locale);
  // The window reloads itself; wait for the app to come back up.
  await page.waitForLoadState("load");
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  // The hash is what keeps the dialog open, so moving off it is enough most
  // of the time. Reloading is the fallback, and it is worth avoiding: a
  // second reload on the heels of the one a language change already does
  // catches the database mid-transaction and the app comes up on its error
  // screen ("Safety level may not be changed inside a transaction").
  const modal = page.locator(".ReactModal__Content");
  await page
    .evaluate(() => (window.location.hash = "/"))
    .catch(() => undefined);
  let closed = await modal
    .waitFor({ state: "detached", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    // Nothing in the app listens for the hash to leave, so the dialog can sit
    // there; it does close on Escape, which is what a person would press.
    await modal.press("Escape").catch(() => undefined);
    closed = await modal
      .waitFor({ state: "detached", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!closed) {
    await page.evaluate(() => window.location.reload()).catch(() => undefined);
    await page.waitForLoadState("load");
    await modal.waitFor({ state: "detached" });
  }
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
}

/** Opens the note by its title and returns what it holds. */
async function openNote() {
  const editor = page.locator(".active .ProseMirror");
  if (!(await editor.isVisible().catch(() => false))) {
    await page
      .locator('[data-test-id="title"]', { hasText: TITLE })
      .first()
      .click();
  }
  await editor.waitFor();
  await page.locator("span[data-scripture-ref]").first().waitFor();
  return readNote();
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  // The first keystrokes are lost if they arrive before the editor has the
  // focus, and typing at full speed drops the odd one in the middle; either
  // way a mangled reference stops being a reference.
  await page.waitForTimeout(1000);
  await page.keyboard.type(BODY, { delay: 25 });
  // Both spellings are marked one after the other, so wait for the second.
  await page.locator("span[data-scripture-ref]").nth(1).waitFor();

  const written = await readNote();
  console.log("escrita:", JSON.stringify(written));
  assert.deepEqual(written.refs, ["JHN.3.16", "JHN.3.16"]);

  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);

  await chooseLanguage("en-US");
  await page.getByText("Notes", { exact: true }).first().waitFor();
  console.log("interfaz en inglés: se ve «Notes» en la navegación");

  const inEnglish = await openNote();
  console.log("con la interfaz en inglés:", JSON.stringify(inEnglish));
  assert.deepEqual(inEnglish, written, "la nota cambió al pasar a inglés");

  await chooseLanguage("es-MX");
  await page.getByText("Notas", { exact: true }).first().waitFor();
  console.log("interfaz en español: se ve «Notas» en la navegación");

  const backInSpanish = await openNote();
  console.log("de vuelta en español:", JSON.stringify(backInSpanish));
  assert.deepEqual(
    backInSpanish,
    written,
    "la nota cambió al volver a español"
  );

  console.log(
    "GREEN: la interfaz cambia de idioma y vuelve sin alterar la nota, y las referencias siguen en USFM."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
