// SPDX-License-Identifier: GPL-3.0-or-later
// Fase 8: runs the whole A0 flow in the real app, first with the network up and
// then with the renderer's network switched off, and checks both passes match.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const ATTRIBUTION = "VBL — CC BY-SA 4.0";
const NO_TEXT = "no tiene texto";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-final-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const readMarks = () =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".active .ProseMirror span[data-scripture-ref]"
      )
    ].map((span) => ({
      ref: span.getAttribute("data-scripture-ref"),
      text: span.textContent
    }))
  );

const readPopover = () =>
  page.evaluate(() => {
    const popover = document.querySelector(
      '[data-test-id="scripture-popover"]'
    );
    return popover
      ? {
          text: popover.querySelector('[data-test-id="scripture-popover-text"]')
            ?.textContent,
          attribution: popover.querySelector(
            '[data-test-id="scripture-popover-attribution"]'
          )?.textContent
        }
      : undefined;
  });

const readBlock = () =>
  page.evaluate(() => {
    const block = document.querySelector(
      ".active .ProseMirror .scripture-block"
    );
    return block
      ? {
          ref: block.getAttribute("data-scripture-ref"),
          translationId: block.getAttribute("data-translation-id"),
          text: block.querySelector(".scripture-block-text")?.textContent,
          attribution: block.querySelector(".scripture-block-attribution")
            ?.textContent
        }
      : undefined;
  });

async function hoverAndRead(index) {
  const marks = page.locator(".active .ProseMirror span[data-scripture-ref]");
  await marks.nth(index).hover();
  await page.waitForFunction(
    () => {
      const text = document.querySelector(
        '[data-test-id="scripture-popover-text"]'
      )?.textContent;
      return !!text && text !== "…";
    },
    undefined,
    { timeout: 15000 }
  );
  const popover = await readPopover();
  // Moving away closes it, so the next hover starts from nothing.
  await page.locator('.active [data-test-id="editor-title"]').hover();
  await page
    .locator('[data-test-id="scripture-popover"]')
    .waitFor({ state: "detached", timeout: 15000 });
  return popover;
}

/** Puntos 2 a 6 del runbook, en una nota nueva. */
async function runFlow(title) {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(title);
  await page.locator(".active .ProseMirror").click();
  // The editor swallows the first keystrokes if it is still settling.
  await page.waitForTimeout(1000);

  // 2 y 3: ambos idiomas se reconocen en la misma nota.
  await page.keyboard.type("Hoy lei Romanos 8:28 y John 3:16.");
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .nth(1)
    .waitFor({ timeout: 15000 });
  const marks = await readMarks();
  console.log(`[${title}] marks:`, JSON.stringify(marks));
  assert.deepEqual(
    marks.map((mark) => mark.ref),
    ["ROM.8.28", "JHN.3.16"]
  );
  assert.deepEqual(
    marks.map((mark) => mark.text),
    ["Romanos 8:28", "John 3:16"]
  );

  // 4: cada referencia muestra su verso de VBL.
  const romans = await hoverAndRead(0);
  console.log(`[${title}] popover Romanos 8:28:`, JSON.stringify(romans));
  assert.ok(romans.text && !romans.text.includes(NO_TEXT), "VBL sin texto");
  assert.ok(romans.text.length > 20, "el verso llegó vacío");
  assert.equal(romans.attribution, ATTRIBUTION);

  const john = await hoverAndRead(1);
  console.log(`[${title}] popover John 3:16:`, JSON.stringify(john));
  assert.match(john.text, /^“Porque Dios amó al mundo/);
  assert.equal(john.attribution, ATTRIBUTION);

  // 5: el Scripture Block trae el verso con atribución.
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.press("End");
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  await page
    .locator('[data-test-id="dialog-title"]', { hasText: "Insertar Escritura" })
    .waitFor();
  await page.keyboard.type("Juan 3:16");
  await page.locator('[data-test-id="dialog-yes"]').click();
  await page
    .locator(".active .ProseMirror .scripture-block")
    .waitFor({ timeout: 15000 });
  const block = await readBlock();
  console.log(`[${title}] bloque:`, JSON.stringify(block));
  assert.equal(block.ref, "JHN.3.16");
  assert.equal(block.translationId, "VBL");
  assert.match(block.text, /^“Porque Dios amó al mundo/);
  assert.equal(block.attribution, ATTRIBUTION);

  // 6: copiar el verso deja texto, referencia legible y traducción.
  // Copia el botón del bloque, no el bloque entero.
  await app.evaluate(({ clipboard }) => clipboard.writeText("vacio"));
  await page
    .locator(".active .ProseMirror .scripture-block [data-scripture-copy]")
    .click();
  let copied = "vacio";
  for (let attempt = 0; attempt < 20 && copied === "vacio"; attempt++) {
    copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    if (copied === "vacio") await page.waitForTimeout(250);
  }
  console.log(`[${title}] portapapeles:`, JSON.stringify(copied));
  const [quoted, attribution] = copied.split(/\r?\n/);
  assert.ok(quoted.startsWith("«“Porque Dios amó al mundo"), "falta el verso");
  assert.ok(
    quoted.includes("» — Juan 3:16 (VBL)"),
    "falta la referencia legible o la traducción"
  );
  assert.equal(attribution, ATTRIBUTION);

  return { marks, block, copied };
}

try {
  // 1: la app abre en español de México.
  await page.getByText("Notas", { exact: true }).first().waitFor();
  console.log("1. la app abrió en español (Notas)");

  // El pack de versos se carga al arrancar; el resto lo lee de ahí.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("verses")) {
            db.close();
            return resolve(false);
          }
          const count = db
            .transaction("verses", "readonly")
            .objectStore("verses")
            .count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result > 0);
          };
          count.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        open.onerror = () => resolve(false);
      }),
    undefined,
    { timeout: 180000 }
  );

  const online = await runFlow("Epigrapho 8 con red");
  console.log("2-6. el flujo completo pasa con la red arriba");

  // 7: la misma nota, sin red. Chromium corta toda la red del renderer,
  // localhost incluido, así que lo que siga funcionando es local de verdad.
  // The window runs on its own session, so the default one is not the one to
  // cut.
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.session.enableNetworkEmulation({ offline: true });
  });
  await page
    .context()
    .setOffline(true)
    .catch(() => undefined);
  // navigator.onLine keeps saying true under emulation, so the proof is a real
  // request that has to fail.
  const blocked = await page.evaluate(() =>
    fetch("/vbl.json", { cache: "no-store" }).then(
      () => "la red sigue arriba",
      (error) => `bloqueada: ${error.message}`
    )
  );
  console.log("7. red del renderer:", blocked);
  assert.match(blocked, /^bloqueada:/, "no se pudo cortar la red");

  const offline = await runFlow("Epigrapho 8 sin red");
  assert.deepEqual(offline.marks, online.marks);
  assert.deepEqual(offline.block, online.block);
  assert.equal(offline.copied, online.copied);
  console.log("7. el mismo flujo pasa igual con la red abajo");

  await page.screenshot({ path: path.join(profile, "green.png") });
  console.log("GREEN: los 7 puntos de la Fase 8 se cumplen sin red.");
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.session.disableNetworkEmulation();
    })
    .catch(() => undefined);
  await app.close();
}
