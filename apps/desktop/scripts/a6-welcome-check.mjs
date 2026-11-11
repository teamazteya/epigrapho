// SPDX-License-Identifier: GPL-3.0-or-later
// The welcome center (A6 Fase 9): a new profile shows it and a profile from
// 1.5.x does not; its nine pages and their captures, which are files of the
// app, in Spanish and in English; "Don't show again", Close, a restart, the
// first note, a logout, and Help → Welcome center behave as agreed.
// Run while npm run start:desktop is serving the app on localhost:3000 (a
// release build strips the data-test-ids), after welcome-captures.mjs:
// node scripts/a6-welcome-check.mjs
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const DIALOG = '[data-test-id="welcome-dialog"]';
const TITLES = {
  es: [
    "Escribe. Estudia. Conecta las Escrituras.",
    "Una referencia abre todo un pasaje.",
    "Conecta lo que estudias con lo que ya escribiste.",
    "Consulta una palabra sin abandonar tu estudio.",
    "Acércate a las palabras del texto original.",
    "Haz espacio para leer cada día.",
    "Del primer apunte a una enseñanza preparada.",
    "Hazlo tuyo. Llévalo contigo.",
    "Tus notas, bajo tu control."
  ],
  en: [
    "Write. Study. Connect the Scriptures.",
    "A reference opens a whole passage.",
    "Connect what you study with what you already wrote.",
    "Look up a word without leaving your study.",
    "Come closer to the words of the original text.",
    "Make room to read every day.",
    "From a first draft to a prepared teaching.",
    "Make it yours. Take it with you.",
    "Your notes, under your control."
  ]
};

const newProfile = (name) => mkdtemp(path.join(profilesRoot(), `epigrapho-a6-welcome-${name}-`));

const apps = [];
async function launch(profile, welcome = "on") {
  const app = await _electron.launch({
    args: [path.join(root, "build", "electron.js")],
    env: { ...process.env, CUSTOM_USER_DATA_DIR: profile, EPIGRAPHO_WELCOME: welcome },
    timeout: 60000
  });
  apps.push(app);
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.locator('[data-test-id="create-new-note"]').first().waitFor({ state: "attached" });
  return { app, page };
}

const hidden = (page) => page.evaluate(() => localStorage.getItem("welcome:hide"));

/** The dialog opens once the app is up, or not at all. */
async function opens(page) {
  try {
    await page.locator(DIALOG).waitFor({ timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/** Every page, every capture: loaded, and from the app itself. */
async function walk(page, language) {
  const dialog = page.locator(DIALOG);
  await dialog.locator('[data-test-id="welcome-step-1"]').click();
  assert.equal(await dialog.locator('[data-test-id="welcome-back"]').isDisabled(), true);
  const captures = [];
  for (let step = 1; step <= 9; step++) {
    const count = await dialog.locator('[data-test-id="welcome-count"]').innerText();
    assert.equal(count, language === "es" ? `${step} de 9` : `${step} of 9`);
    assert.equal(
      await dialog.locator('[data-test-id="welcome-title"]').innerText(),
      TITLES[language][step - 1]
    );
    const choices = dialog.locator(".ew-capture-choices button");
    for (let shot = 0; shot < Math.max(1, await choices.count()); shot++) {
      if (await choices.count()) await choices.nth(shot).click();
      const image = dialog.locator('[data-test-id="welcome-capture"]');
      await page.waitForFunction(
        (element) => element.complete && element.naturalWidth > 0,
        await image.elementHandle()
      );
      const src = await image.evaluate((element) => element.src);
      const url = new URL(src);
      assert.equal(url.origin, new URL(page.url()).origin, src);
      assert.match(url.pathname, new RegExp(`^/welcome/${language}/0${step}-[a-z]+\\.webp$`));
      captures.push(url.pathname);
    }
    if (step < 9) await dialog.locator('[data-test-id="welcome-next"]').click();
  }
  await dialog.locator('[data-test-id="welcome-first-note"]').waitFor();
  const text = await dialog.innerText();
  // Offline is only promised for the embedded translations (ADR 0002).
  assert.doesNotMatch(text, /(NTV|NBLA|NASB)[^.]*(sin conexión|offline)/);
  return captures;
}

const profiles = [];
try {
  // ---- 1. A new profile shows it, in Spanish, with the box checked. ----
  const fresh = await newProfile("nuevo");
  profiles.push(fresh);
  let { app, page } = await launch(fresh);
  assert.equal(await opens(page), true, "un perfil nuevo muestra el centro");
  let dialog = page.locator(DIALOG);
  assert.equal(await dialog.locator('[data-test-id="welcome-dont-show"]').isChecked(), true);
  const es = await walk(page, "es");
  assert.equal(es.length, 14);
  await dialog.locator('[data-test-id="welcome-step-2"]').click();
  assert.match(await dialog.innerText(), /VBL, BSB y KJV están incluidas sin conexión; NTV, NBLA y NASB requieren Internet\./);
  console.log("1. perfil nuevo: se muestra; 9 páginas y 14 capturas en español, del propio programa");

  // ---- 2. The enlarged capture closes with Escape; the tour stays. ----
  await dialog.locator(".ew-capture-open").click();
  await dialog.locator(".ew-zoom").waitFor();
  await page.keyboard.press("Escape");
  await dialog.locator(".ew-zoom").waitFor({ state: "detached" });
  assert.equal(await dialog.isVisible(), true);
  console.log("2. la captura ampliada se cierra con Escape y el recorrido sigue abierto");

  // ---- 3. Quit without an answer: it opens again. Unchecked and ----
  //      closed: it comes back on the next start.
  await app.close();
  ({ app, page } = await launch(fresh));
  dialog = page.locator(DIALOG);
  assert.equal(await opens(page), true, "sin respuesta, vuelve a mostrarse");
  assert.equal(await hidden(page), null);
  await dialog.locator('[data-test-id="welcome-dont-show"]').uncheck();
  await dialog.locator('[data-test-id="welcome-close"]').click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await hidden(page), "false");
  await app.close();
  ({ app, page } = await launch(fresh));
  dialog = page.locator(DIALOG);
  assert.equal(await opens(page), true, "desmarcado, vuelve a mostrarse");
  assert.equal(await dialog.locator('[data-test-id="welcome-dont-show"]').isChecked(), false);
  console.log("3. sin responder, vuelve; desmarcado y cerrado: vuelve al reiniciar, con la casilla desmarcada");

  // ---- 4. Checked, "Create my first note": closed, a new note open. ----
  await dialog.locator('[data-test-id="welcome-dont-show"]').check();
  await dialog.locator('[data-test-id="welcome-step-9"]').click();
  await dialog.locator('[data-test-id="welcome-first-note"]').click();
  await dialog.waitFor({ state: "detached" });
  await page.locator('.active [data-test-id="editor-title"]').waitFor();
  assert.equal(await hidden(page), "true");
  await app.close();
  ({ app, page } = await launch(fresh));
  assert.equal(await opens(page), false, "marcado, no vuelve");
  console.log("4. «Crear mi primera nota» abre una nota; marcado, no vuelve al reiniciar");

  // ---- 5. Help → Welcome center opens it again, and keeps the answer. ----
  async function fromHelp(search, open) {
    await page.evaluate(() => (window.location.hash = "/settings"));
    await page.locator('[data-test-id="settings-search"]').fill(search);
    await page
      .locator('[data-test-id="setting-welcome-center"]')
      .getByRole("button", { name: open, exact: true })
      .click();
    await page.locator(DIALOG).waitFor();
  }
  await fromHelp("bienvenida", "Abrir");
  await page.keyboard.press("Escape");
  await page.locator(DIALOG).waitFor({ state: "detached" });
  assert.equal(await hidden(page), "true");
  console.log("5. Ayuda → Centro de bienvenida lo abre; Escape lo cierra sin cambiar la respuesta");

  // ---- 6. A logout keeps the answer, either way. The app's own logout ----
  //      runs Config.logout() (stores/user-store.ts); no account is needed
  //      to run that half of it.
  async function logout() {
    await page.evaluate(async () => {
      const { default: Config } = await import("/utils/config.ts");
      Config.logout();
    });
    await page.reload();
    await page.locator('[data-test-id="create-new-note"]').first().waitFor({ state: "attached" });
  }
  await logout();
  assert.equal(await opens(page), false, "tras cerrar sesión, sigue sin mostrarse");
  assert.equal(await hidden(page), "true");
  await page.evaluate(() => localStorage.setItem("welcome:hide", "false"));
  await logout();
  assert.equal(await opens(page), true, "tras cerrar sesión, sigue mostrándose");
  assert.equal(await hidden(page), "false");
  assert.equal(await page.locator('[data-test-id="welcome-dont-show"]').isChecked(), false);
  await page.locator('[data-test-id="welcome-dont-show"]').check();
  await page.locator('[data-test-id="welcome-enter"]').click();
  await page.locator(DIALOG).waitFor({ state: "detached" });
  assert.equal(await hidden(page), "true");
  console.log("6. la respuesta sobrevive al cierre de sesión, sea cual sea; «Entrar a Epigrapho» guarda la casilla");

  // ---- 7. In English: the same nine pages, with the English captures. ----
  await page.evaluate(() => localStorage.setItem("uiLocale", JSON.stringify("en-US")));
  await page.reload();
  await page.getByText("Notes", { exact: true }).first().waitFor();
  await fromHelp("welcome", "Open");
  const en = await walk(page, "en");
  assert.equal(en.length, 14);
  assert.deepEqual(
    en.map((file) => file.replace("/en/", "/")),
    es.map((file) => file.replace("/es/", "/"))
  );
  await page.locator('[data-test-id="welcome-close"]').click();
  await app.close();
  console.log("7. en inglés: 9 páginas y 14 capturas en inglés, las mismas vistas");

  // ---- 8. A profile from 1.5.x: preferences, no answer yet. ----
  const old = await newProfile("1-5");
  profiles.push(old);
  ({ app, page } = await launch(old, "off"));
  await page.evaluate(() => localStorage.removeItem("welcome:hide"));
  const before = await page.evaluate(() => Object.keys(localStorage).length);
  assert.ok(before > 0);
  await app.close();
  ({ app, page } = await launch(old));
  assert.equal(await opens(page), false, "un perfil de 1.5.x no lo muestra");
  assert.equal(await hidden(page), "true");
  await app.close();
  console.log(`8. perfil de 1.5.x (${before} preferencias, sin respuesta): no se muestra y queda en «no mostrar»`);

  console.log("GREEN: el centro de bienvenida se muestra, se cierra y se recuerda como se acordó.");
  console.log(`Evidencia: ${profiles.join(", ")}`);
} catch (error) {
  console.error(`Evidencia: ${profiles.join(", ")}`);
  throw error;
} finally {
  for (const instance of apps) await instance.close().catch(() => undefined);
}
