// SPDX-License-Identifier: GPL-3.0-or-later
// Hovers a detected reference and checks the popover shows the VBL verse with
// its attribution, all offline.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Epigrapho 6.1";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-preview-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const readPopover = () =>
  page.evaluate(() => {
    const popover = document.querySelector(
      '[data-test-id="scripture-popover"]'
    );
    if (!popover) return undefined;
    const box = popover.getBoundingClientRect();
    return {
      text: popover.querySelector('[data-test-id="scripture-popover-text"]')
        ?.textContent,
      attribution: popover.querySelector(
        '[data-test-id="scripture-popover-attribution"]'
      )?.textContent,
      box: {
        top: Math.round(box.top),
        left: Math.round(box.left),
        bottom: Math.round(box.bottom),
        right: Math.round(box.right)
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      onScreen:
        box.top >= 0 &&
        box.left >= 0 &&
        box.bottom <= window.innerHeight &&
        box.right <= window.innerWidth
    };
  });

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // The verse pack loads right after startup; the popover needs it.
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

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  // Typed with a delay: at full speed the editor drops the odd keystroke and a
  // mangled reference stops being a reference.
  await page.keyboard.type("Hoy lei Juan 3:16 y Salmo 23:1.", { delay: 25 });

  const marks = page.locator(".active .ProseMirror span[data-scripture-ref]");
  await marks.nth(1).waitFor({ timeout: 20000 });

  await marks.first().hover();
  await page
    .locator('[data-test-id="scripture-popover"]')
    .waitFor({ timeout: 10000 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-test-id="scripture-popover-text"]')
        ?.textContent !== "…",
    undefined,
    { timeout: 10000 }
  );
  const john = await readPopover();
  console.log("Juan 3:16:", JSON.stringify(john));
  assert.match(john.text, /^“Porque Dios amó al mundo/);
  assert.equal(john.attribution, "VBL — CC BY-SA 4.0");
  assert.ok(john.onScreen, "el popover se salió de la pantalla");

  // Moving off the reference closes it.
  await page.locator('.active [data-test-id="editor-title"]').hover();
  await page
    .locator('[data-test-id="scripture-popover"]')
    .waitFor({ state: "detached", timeout: 10000 });

  // A second reference shows its own verse.
  await marks.nth(1).hover();
  await page.waitForFunction(
    () => {
      const text = document.querySelector(
        '[data-test-id="scripture-popover-text"]'
      )?.textContent;
      return !!text && text !== "…";
    },
    undefined,
    { timeout: 10000 }
  );
  const psalm = await readPopover();
  console.log("Salmo 23:1:", JSON.stringify(psalm));
  assert.match(psalm.text, /^El Señor es mi pastor/);
  assert.equal(psalm.attribution, "VBL — CC BY-SA 4.0");

  console.log("GREEN: el popover muestra el verso de VBL con su atribución.");
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
