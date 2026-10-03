// SPDX-License-Identifier: GPL-3.0-or-later
// v1.4.0: sharing a note with a link (A5). Runs against a local stack: the
// account server (see epigrapho-sync-server/deploy/notas-check.mjs for what it
// needs) and the public page from apps/monograph on localhost:5173, started
// with API_HOST=http://localhost:5264 PUBLIC_URL=http://localhost:5173.
//
// Checks that:
//   1. "Compartir" opens "Publicar con enlace" with the approved warning;
//   2. the note publishes and its page shows it, with the verse preview;
//   3. "Actualizar" changes what the page shows;
//   4. with a password the page asks for it, refuses a wrong one and opens;
//   5. the view count reaches the dialog;
//   6. "Dejar de compartir" takes the page down;
//   7. a note that reads itself away is gone after its first view.
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, chromium } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const SERVERS = {
  API_HOST: "http://localhost:5264",
  AUTH_HOST: "http://localhost:8264",
  SSE_HOST: "http://localhost:7264",
  MONOGRAPH_HOST: "http://localhost:5173"
};
const WARNING = /Cualquiera con el enlace podrá leer esta nota/;
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-share-"));

async function launch() {
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

let { app, page } = await launch();
await page.evaluate(
  (servers) => localStorage.setItem("serverUrls", JSON.stringify(servers)),
  SERVERS
);
await app.close();
({ app, page } = await launch());

// A reader's browser, in Spanish, with no cache between visits. Playwright's
// own Chromium, or the one READER_BROWSER points at.
const browser = await chromium.launch({
  executablePath: process.env.READER_BROWSER || undefined
});
const reader = async (url) => {
  const context = await browser.newContext({ locale: "es-MX" });
  const tab = await context.newPage();
  await tab.goto(url, { waitUntil: "networkidle" });
  return tab;
};

// The share popup sits outside the accessibility tree, so its buttons are
// found by their text.
const button = (page, text) =>
  page.locator("button").filter({ hasText: text }).first();
const shareButton = () =>
  page.locator('[data-test-id="Compartir"], [data-test-id="Compartida"]');
async function closeShare() {
  // A click outside closes it, as it does for a person.
  if (await page.getByText(/Cualquiera con el enlace/).count())
    await page.mouse.click(400, 400);
  await page
    .getByText(/Cualquiera con el enlace/)
    .waitFor({ state: "detached" });
}
async function openShare() {
  await closeShare();
  await shareButton().first().click();
  await page.getByText(/Cualquiera con el enlace/).waitFor();
}
const publishedUrl = () =>
  page
    .locator("a")
    .filter({ hasText: SERVERS.MONOGRAPH_HOST })
    .first()
    .innerText();

try {
  // An account, through the app's own signup.
  await page.evaluate(() => window.location.assign("/signup#/"));
  await page.locator("#authForm").waitFor();
  await page.fill("#email", `a5-${Date.now()}@example.com`);
  await page.fill("#password", "a5-share-password");
  await page.fill("#confirm-password", "a5-share-password");
  await page.locator('[data-test-id="submitButton"]').click();
  const recovery = page.locator('[data-test-id="recovery-key-dialog"]');
  await recovery.locator('[data-test-id="recovery-key"]').waitFor();
  await recovery.locator('[data-test-id="dialog-yes"]').click();
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();

  // A note with a reference in it.
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('[data-test-id="editor-title"]').fill("El buen pastor");
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.type("Lo dice en Juan 10:11 ", { delay: 20 });
  await page.keyboard.type("y lo repite después.", { delay: 5 });
  await page.locator(".active .scripture-reference").first().waitFor();
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });

  // ---- 1 ----
  await openShare();
  await page.getByText(WARNING).waitFor();
  await page.getByText("Qué se puede publicar").waitFor();
  console.log(
    "1. «Compartir» abre «Publicar con enlace» con el aviso aprobado"
  );

  // ---- 2 ----
  await button(page, "Publicar con enlace").click();
  const url = await (async () => {
    for (let i = 0; i < 60; i++) {
      const found = await page
        .locator("a")
        .filter({ hasText: SERVERS.MONOGRAPH_HOST })
        .count();
      if (found) return publishedUrl();
      await page.waitForTimeout(500);
    }
    throw new Error("no apareció el enlace");
  })();
  let tab = await reader(url);
  await tab.getByText("Lo dice en").waitFor();
  await tab.locator(".scripture-reference").first().hover();
  await tab.waitForFunction(
    () =>
      /buen pastor/i.test(
        document.querySelector(".scripture-popover")?.innerText || ""
      ),
    null,
    { timeout: 15000 }
  );
  assert.match(
    await tab.locator("footer").innerText(),
    /Escrito con Epigrapho/
  );
  await tab.context().close();
  console.log(
    `2. se publica (${url}) y la página la muestra, con el versículo`
  );

  // ---- 3 ----
  await closeShare();
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Versión nueva.", { delay: 5 });
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
  await openShare();
  await button(page, "Actualizar").click();
  await page
    .getByText(/Se publicó|publicada/i)
    .first()
    .waitFor()
    .catch(() => {});
  await page.waitForTimeout(1500);
  tab = await reader(url);
  await tab.getByText("Versión nueva.").waitFor();
  await tab.context().close();
  console.log("3. «Actualizar» cambia lo que muestra la página");

  // ---- 4 ----
  await openShare();
  await page.getByPlaceholder("Sin contraseña").fill("pastor");
  await button(page, "Actualizar").click();
  await page.waitForTimeout(2000);
  tab = await reader(url);
  const password = tab.getByPlaceholder("Escribe la contraseña para leerla");
  await password.waitFor();
  assert.equal(await tab.getByText("Lo dice en").count(), 0);
  await password.fill("otra");
  await tab.getByRole("button", { name: "Abrir" }).click();
  await tab.getByText("La contraseña no es correcta.").waitFor();
  await password.fill("pastor");
  await tab.getByRole("button", { name: "Abrir" }).click();
  await tab.getByText("Lo dice en").waitFor();
  await tab.context().close();
  console.log(
    "4. con contraseña la pide, rechaza una mala y abre con la buena"
  );

  // ---- 5 ----
  await openShare();
  await page.getByText("Vistas").waitFor();
  let views = 0;
  for (let i = 0; i < 20 && views < 1; i++) {
    const text = await page.getByText("Vistas").locator("..").innerText();
    views = Number(text.match(/\d+/)?.[0] || 0);
    if (views < 1) {
      await page.getByText("Vistas").locator("..").locator("button").click();
      await page.waitForTimeout(500);
    }
  }
  assert.ok(views >= 1, "el contador no llegó al diálogo");
  console.log(`5. el contador de vistas llega al diálogo (${views})`);

  // ---- 6 ----
  await button(page, "Dejar de compartir").click();
  // The button goes back to "Compartir" once the app knows.
  await page.locator('[data-test-id="Compartir"]').first().waitFor();
  tab = await reader(url);
  await tab.getByText("Esta nota no existe o ya no se comparte.").waitFor();
  await tab.context().close();
  console.log("6. «Dejar de compartir» quita la página");

  // ---- 7 ----
  await openShare();
  await page.getByText("Borrar después de la primera lectura").click();
  await button(page, "Publicar con enlace").click();
  for (let i = 0; i < 60; i++) {
    if (
      await page
        .locator("a")
        .filter({ hasText: SERVERS.MONOGRAPH_HOST })
        .count()
    )
      break;
    await page.waitForTimeout(500);
  }
  const once = await publishedUrl();
  tab = await reader(once);
  await tab.getByText("Lo dice en").waitFor();
  await tab.context().close();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  tab = await reader(once);
  await tab.getByText("Esta nota no existe o ya no se comparte.").waitFor();
  await tab.context().close();
  console.log(
    "7. la que se borra al leerla desaparece después de la primera vista"
  );

  console.log(
    "GREEN: las notas se comparten con un enlace, se actualizan, se protegen, cuentan vistas y se dejan de compartir."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await browser.close();
  await app.close();
}
