// SPDX-License-Identifier: GPL-3.0-or-later
// M1 Fase 5b: the phone and the desktop, one account, Epigrapho's sync server.
//
// The phone signs in from Settings the way a person does; a desktop window
// (as in apps/desktop/scripts/s1-sync-check.mjs) signs in to the same account.
// Then:
//   1. a note written on the desktop shows up on the phone in under 5 s;
//   2. a reference, a Scripture Block, an interlinear and an attachment
//      arrive on the phone exactly as the desktop wrote them;
//   3. a note written on the phone shows up on the desktop in under 5 s;
//   4. the phone shares that note with a link, the link opens on
//      notas.azteya.tech in a browser, and stops opening once unshared.
//
// The account is the S1 test account; its details never go in the repo:
//   S1_EMAIL, S1_PASSWORD, S1_TOTP_SECRET
// Needs what m1-device-check.mjs needs (a debug build on adb and its dev
// server), plus npm run start:desktop serving the desktop app. The shared
// link is read in Playwright's Chromium, or the browser READER_BROWSER names.
//
//   node scripts/m1-sync-check.mjs
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP,
  adb,
  connectToEditor,
  editorTools,
  screen,
  shot,
  sleep,
  tap,
  typeText,
  waitFor
} from "./device.mjs";

const desktop = fileURLToPath(new URL("../../desktop/", import.meta.url));
const requireDesktop = createRequire(path.join(desktop, "package.json"));
const { _electron, chromium } = requireDesktop("playwright-core");
const { generateSync } = createRequire(
  new URL("../../web/package.json", import.meta.url)
)("otplib");
const { profilesRoot } = await import(
  new URL("../../desktop/scripts/profiles-root.mjs", import.meta.url)
);

const { S1_EMAIL, S1_PASSWORD, S1_TOTP_SECRET } = process.env;
if (!S1_EMAIL || !S1_PASSWORD || !S1_TOTP_SECRET)
  throw new Error("Faltan S1_EMAIL, S1_PASSWORD o S1_TOTP_SECRET.");

const RUN = Date.now().toString(36);
const TITLE = `M1 ${RUN}`;
const FROM_PHONE = `Desde el teléfono ${RUN}`;
const LIVE_LIMIT_MS = 5000;

/** Polls until `read` returns something `ok` accepts, or fails with the last value. */
async function until(read, ok, ms, what) {
  const end = Date.now() + ms;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (ok(value)) return value;
    await sleep(500);
  }
  assert.fail(`${what}: ${JSON.stringify(value)?.slice(-600)}`);
}

const onPhone = (text) =>
  screen().some((node) => node.text.includes(text) || node.desc.includes(text));

// --- The desktop, as in s1-sync-check.mjs ----------------------------------
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-m1-sync-"));
const app = await _electron.launch({
  args: [path.join(desktop, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
await page.addLocatorHandler(
  page.getByText("¿Quieres recibir novedades de Epigrapho por correo?"),
  () => page.getByRole("button", { name: "No, gracias" }).click()
);
const editorHtml = () =>
  page.evaluate(() =>
    document.querySelector(".active .ProseMirror").editor.getHTML()
  );
const saved = () =>
  page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
async function toEnd() {
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
async function insertFromMenu(item, title, input) {
  await toEnd();
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator(`[data-test-id="menu-button-${item}"]`).click();
  await page
    .locator('[data-test-id="dialog-title"]', { hasText: title })
    .waitFor();
  await page.keyboard.type(input);
  await page.locator('[data-test-id="dialog-yes"]').click();
}

try {
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
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
  await page.locator('[data-test-id="sync-status-synced"]').waitFor();
  console.log("el escritorio inició sesión");

  // --- The phone, from a clean start, signs in from Settings ----------------
  adb("shell", "pm", "clear", APP);
  adb("reverse", "tcp:8081", "tcp:8081");
  adb(
    "shell",
    "monkey",
    "-p",
    APP,
    "-c",
    "android.intent.category.LAUNCHER",
    "1"
  );
  await tap("Empezar", 180000);
  await waitFor("Buscar en Notas");
  adb("shell", "input", "tap", "118", "191"); // the menu button in the search bar
  await tap("sidemenu-settings-icon");
  await tap("Ajustes");
  await tap("Sincronizar entre dispositivos");
  await tap("input.email");
  typeText(S1_EMAIL);
  await tap("Continuar");
  await tap("input.totp");
  typeText(generateSync({ secret: S1_TOTP_SECRET }));
  await tap("Siguiente");
  await tap("input.password");
  typeText(S1_PASSWORD);
  // The keyboard covers "Continue"; its own key sends the form, as a thumb would.
  adb("shell", "input", "keyevent", "KEYCODE_ENTER");
  // Back in Settings, the account shows at the top.
  await until(
    () => {
      const nodes = screen();
      return (
        nodes.some((node) => node.text === S1_EMAIL) &&
        !nodes.some((node) => node.id === "input.password")
      );
    },
    Boolean,
    120000,
    "el teléfono no volvió a Ajustes con la cuenta"
  );
  shot("sync-1-account");
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await sleep(1000);
  adb("shell", "input", "tap", "1000", "1200"); // outside the side menu
  await waitFor("Buscar en Notas");
  // The first sync downloads the whole account; the clock starts after it,
  // once the list has not changed for a few looks in a row.
  for (let quiet = 0, last = ""; quiet < 3; await sleep(2000)) {
    const now = screen()
      .map((node) => node.text)
      .join("\n");
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
  console.log(
    "el teléfono inició sesión desde Ajustes y terminó el primer sync"
  );

  // --- 1. desktop to phone, live ---------------------------------------------
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  adb("logcat", "-c");
  await saved();
  let start = Date.now();
  await until(
    () => onPhone(TITLE),
    Boolean,
    30000,
    "la nota no llegó al teléfono"
  );
  // Reading the screen takes seconds on the emulator, so the clock stops at
  // the phone's own log: once the sync that brought the note stops, the note
  // is in its database. The emulator's clock is the computer's, give or take
  // the offset measured here.
  const offset = Number(adb("shell", "date", "+%s%3N").trim()) - Date.now();
  const stopped = adb("logcat", "-d", "-v", "epoch", "-s", "ReactNativeJS:*")
    .split("\n")
    .filter((line) => line.includes("Stopping sync"))
    .map((line) => Number(line.trim().split(/\s+/)[0]) * 1000 - offset)
    .find((time) => time > start);
  assert.ok(stopped, "el log del teléfono no muestra el sync");
  const toPhone = Math.round(stopped - start);
  console.log(`1. la nota del escritorio llegó al teléfono en ${toPhone} ms`);
  assert.ok(toPhone < LIVE_LIMIT_MS, `tardó ${toPhone} ms`);

  // --- 2. what a study note holds --------------------------------------------
  await page.locator(".active .ProseMirror").click();
  await page.mouse.move(0, 0);
  await page.keyboard.type("Romanos 8:28 dice que todo ayuda a bien. ");
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .first()
    .waitFor();
  await insertFromMenu("scripture", "Insertar Escritura", "Juan 3:16");
  await page.locator(".active .ProseMirror .scripture-block").first().waitFor();
  await insertFromMenu("interlinear", "Insertar interlineal", "Juan 3:16");
  await page
    .locator(".active .ProseMirror .interlinear .interlinear-word")
    .first()
    .waitFor();
  const file = path.join(profile, `m1-adjunto-${RUN}.txt`);
  await writeFile(file, `Adjunto de prueba ${RUN}\n`.repeat(200));
  await toEnd();
  const chooser = page.waitForEvent("filechooser");
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-attachment"]').click();
  await (await chooser).setFiles(file);
  const written = await until(
    editorHtml,
    (html) => /data-hash="[^"]+"/.test(html),
    60000,
    "el escritorio no insertó el adjunto"
  );
  await saved();
  assert.match(written, /data-scripture-ref="ROM\.8\.28"/);
  assert.match(written, /data-interlinear-ref="JHN\.3\.16"/);

  // Opened once its preview shows, so the content is already on the phone.
  await until(
    () => onPhone("dice que todo ayuda"),
    Boolean,
    60000,
    "el texto no llegó al teléfono"
  );
  await tap(TITLE);
  let cdp = await connectToEditor();
  try {
    const arrived = await until(
      () =>
        cdp.evaluate(
          `document.querySelector(".ProseMirror")?.editor?.getHTML() ?? ""`
        ),
      (html) => html === written,
      60000,
      "el teléfono no tiene la misma nota"
    );
    assert.ok(arrived);
  } finally {
    cdp.close();
  }
  shot("sync-2-note");
  console.log(
    "2. la referencia, el bloque, el interlineal y el adjunto llegaron iguales"
  );

  // --- 3. phone to desktop, live ---------------------------------------------
  // The first presses may only close the keyboard or a selection.
  for (let i = 0; i < 5 && !onPhone("Buscar en Notas"); i++) {
    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await sleep(2000);
  }
  await waitFor("Buscar en Notas");
  // The "+" button; a swipe would reopen the note just read.
  await tap("buttons.add");
  await sleep(2000);
  cdp = await connectToEditor();
  try {
    await until(
      () => cdp.evaluate(`!!document.querySelector(".ProseMirror")?.editor`),
      Boolean,
      30000,
      "el editor del teléfono no cargó"
    );
    await cdp.evaluate(
      `document.querySelector(".ProseMirror").editor.commands.focus("end")`
    );
    await cdp.send("Input.insertText", { text: FROM_PHONE });
  } finally {
    cdp.close();
  }
  start = Date.now();
  await page.getByText(FROM_PHONE).first().waitFor({ timeout: 30000 });
  const toDesktop = Date.now() - start;
  console.log(`3. la nota del teléfono llegó al escritorio en ${toDesktop} ms`);
  assert.ok(toDesktop < LIVE_LIMIT_MS, `tardó ${toDesktop} ms`);

  // --- 4. share with a link (A5) -------------------------------------------
  cdp = await connectToEditor();
  try {
    const { $, tapOn } = editorTools(cdp);
    // The editor's "⋮" (the last header button outside a closed menu), then
    // Properties.
    await $(
      `(() => { const row = [...document.querySelectorAll("#header > div button")].filter((b) => !b.closest('[role="menu"]')); row[row.length - 1].dataset.m1 = "menu"; return true; })()`
    );
    await tapOn('[data-m1="menu"]');
    await $(
      `(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.includes("Propiedades")); item.dataset.m1 = "properties"; return true; })()`
    );
    await tapOn('[data-m1="properties"]');
  } finally {
    cdp.close();
  }
  await tap("icon-publish");
  // The sheet's heading says the same as its button, which comes last.
  const publish = await until(
    () => screen().filter((node) => node.text === "Publicar con enlace"),
    (nodes) => nodes.length > 0,
    30000,
    "no se abrió la hoja de compartir"
  );
  const button = publish[publish.length - 1];
  adb("shell", "input", "tap", `${button.x}`, `${button.y}`);
  const link = (
    await until(
      () =>
        screen().find((node) =>
          node.text.startsWith("https://notas.azteya.tech/")
        ),
      Boolean,
      60000,
      "no apareció el enlace publicado"
    )
  ).text;
  shot("sync-4-shared");
  console.log(`4. compartida: ${link}`);

  const browser = await chromium.launch({
    executablePath: process.env.READER_BROWSER || undefined
  });
  try {
    const visit = async () => {
      const context = await browser.newContext({ locale: "es-MX" });
      const tab = await context.newPage();
      await tab.goto(link, { waitUntil: "networkidle" });
      const text = await tab.locator("body").innerText();
      await context.close();
      return text;
    };
    assert.match(await visit(), new RegExp(FROM_PHONE));
    console.log("   el enlace abre la nota en el navegador");

    await tap("Dejar de compartir");
    await until(
      () => onPhone("https://notas.azteya.tech/"),
      (shown) => !shown,
      30000,
      "el enlace siguió en la hoja"
    );
    assert.doesNotMatch(await visit(), new RegExp(FROM_PHONE));
    console.log("   y deja de abrirla al dejar de compartir");
  } finally {
    await browser.close();
  }

  console.log(
    "GREEN: el teléfono y el escritorio, con la misma cuenta, se sincronizan en vivo en los dos sentidos, una nota de estudio con adjunto llega igual, y el teléfono comparte una nota con un enlace que abre en notas.azteya.tech."
  );
} catch (error) {
  shot("sync-failure");
  await page
    .screenshot({ path: path.join(profile, "failure-desktop.png") })
    .catch(() => undefined);
  console.error("Evidencia:", profile);
  throw error;
} finally {
  await app.close().catch(() => undefined);
}
