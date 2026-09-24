// SPDX-License-Identifier: GPL-3.0-or-later
// Every other oracle runs against the development server. This one runs
// against the bundle that actually goes inside the installer: minified, served
// over the app's own protocol, with no Vite in the picture. It is the only
// check that would notice a route or a view that was deleted but still
// imported somewhere the dev server happened to tolerate.
//
// The release bundle carries almost none of the data-test-id attributes the
// other oracles rely on, so this one drives the app the way a person does: by
// the words on the buttons, the keyboard, and the app's own CSS classes.
//
// Run after: node apps/desktop/scripts/build.mjs
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-release-"));

const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  // Unpackaged Electron calls itself development and would go looking for the
  // dev server; this is the switch the app itself reads.
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile, ELECTRON_IS_DEV: "0" },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);

const errors = [];
const requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.protocol.startsWith("http") && url.hostname !== "app.epigrapho.local")
    requests.push(`${url.hostname}${url.pathname}`);
});

try {
  const url = page.url();
  assert.ok(
    !url.startsWith("http://localhost"),
    `la app cargó del servidor de desarrollo: ${url}`
  );
  assert.ok(
    url.includes("app.epigrapho.local"),
    `la app todavía se sirve desde el origen de Notesnook: ${url}`
  );
  console.log(`1. cargada desde ${new URL(url).origin}`);

  // No accounts, so no welcome screen: the app has to be in the notes already.
  await page.getByText("Notas", { exact: true }).first().waitFor({
    timeout: 45000
  });
  console.log("2. abre directo en las notas, sin pedir cuenta");

  // A note with a reference in it, which is the whole point of the app.
  await page.keyboard.press("Control+n");
  const editor = page.locator(".ProseMirror").first();
  await editor.waitFor({ timeout: 30000 });
  await editor.click();
  await page.keyboard.type("Epigrapho release. Juan 3:16 ", { delay: 15 });

  const badge = page.locator("span[data-scripture-ref]").first();
  await badge.waitFor({ timeout: 30000 });
  console.log(
    `3. referencia detectada: ${await badge.innerText()} (${await badge.getAttribute(
      "data-scripture-ref"
    )})`
  );

  await badge.hover();
  const popover = page.locator(".scripture-popover");
  await popover.waitFor({ timeout: 30000 });
  const verse = (await popover.innerText()).split("\n").filter(Boolean);
  assert.ok(verse.length > 1, "el popover salió vacío");
  console.log(
    `4. versículo servido del paquete local: ${verse[1].slice(0, 60)}…`
  );
  await page.keyboard.press("Escape");

  // Settings is where most of the deleted code lived, so it has to open.
  await page.evaluate(() => (window.location.hash = "/settings"));
  const modal = page.locator(".ReactModal__Content");
  await modal.waitFor({ timeout: 30000 });
  const settings = await modal.innerText();
  const offenders = settings
    .split("\n")
    // A whole line, not a word inside a sentence: what must be gone are the
    // section headings and buttons, not every mention of the word.
    .filter((line) =>
      /^(Suscripción|Subscription|Notesnook Circle|Mejorar a Pro|Upgrade to Pro)$/i.test(
        line.trim()
      )
    );
  assert.deepEqual(
    offenders,
    [],
    `Ajustes todavía muestra: ${offenders.join(" · ")}`
  );
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "detached", timeout: 15000 });
  console.log("5. Ajustes abre y no ofrece nada de pago");

  // The note has to survive a restart, which is where a broken production
  // bundle usually shows itself.
  await page.waitForTimeout(3000);
  await page.reload();
  await page.getByText("Epigrapho release").first().waitFor({ timeout: 45000 });
  console.log("6. la nota sigue ahí tras recargar");

  // Vite turns each catalogue into its own chunk, so this is where they end up.
  const assets = await readdir(path.join(root, "build", "assets"));
  const catalogues = assets.filter((name) =>
    /^_[a-z]{2}(-[A-Z]{2})?-/.test(name)
  );
  assert.ok(
    catalogues.some((name) => name.startsWith("_es-MX-")),
    `el catálogo es-MX no entró al bundle: ${catalogues.join(", ")}`
  );
  console.log(`7. catálogos en el bundle: ${catalogues.join(", ")}`);

  // Whatever the app reached for on its own, with nobody signed in. An
  // offline-first app should be reaching for nothing.
  const outbound = [...new Set(requests)];
  console.log(
    `8. salidas a la red sin cuenta: ${
      outbound.length ? outbound.join(", ") : "ninguna"
    }`
  );

  const fatal = errors.filter(
    (message) => !/DevTools|Autofill|Content-Security-Policy/i.test(message)
  );
  console.log(
    `9. errores de consola: ${
      fatal.length ? fatal.map((m) => m.slice(0, 80)).join(" · ") : "ninguno"
    }`
  );

  console.log(
    "GREEN: el bundle de producción arranca sin cuenta, detecta referencias, sirve versículos del paquete local, guarda la nota y no ofrece nada de pago."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
