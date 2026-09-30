// SPDX-License-Identifier: GPL-3.0-or-later
// A whole chapter in the verse preview stays on screen and scrolls inside the
// box without closing it, and a range that crosses a chapter shows every
// verse, not only the first.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-popover-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const TEXT = '[data-test-id="scripture-popover-text"]';
const POPOVER = '[data-test-id="scripture-popover"]';

/** Hovers a reference and waits for its words to replace the "…". */
async function preview(mark) {
  await page.locator('.active [data-test-id="editor-title"]').hover();
  await page.locator(POPOVER).waitFor({ state: "detached" });
  await mark.hover();
  await page.waitForFunction(
    (selector) => {
      const text = document.querySelector(selector)?.textContent;
      return !!text && text !== "…";
    },
    TEXT,
    { timeout: 20000 }
  );
  return page.evaluate(
    ({ TEXT, POPOVER }) => {
      const box = document.querySelector(POPOVER).getBoundingClientRect();
      const text = document.querySelector(TEXT);
      return {
        text: text.textContent,
        scrolls: text.scrollHeight > text.clientHeight,
        onScreen:
          box.top >= 0 &&
          box.left >= 0 &&
          box.bottom <= window.innerHeight &&
          box.right <= window.innerWidth
      };
    },
    { TEXT, POPOVER }
  );
}

try {
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
  await page.locator('.active [data-test-id="editor-title"]').fill("A2 popover");
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type(
    "Leo Salmo 119 y Romanos 8:38-39 y Romanos 8:38-9:2.",
    { delay: 25 }
  );
  const marks = page.locator(".active .ProseMirror span[data-scripture-ref]");
  await marks.nth(2).waitFor({ timeout: 20000 });

  // 1. A whole chapter: on screen, and its words scroll inside the box.
  const chapter = await preview(marks.nth(0));
  console.log(
    "Salmo 119:",
    JSON.stringify({ ...chapter, text: chapter.text.length })
  );
  assert.ok(chapter.onScreen, "el popover se salió de la pantalla");
  assert.ok(chapter.scrolls, "el capítulo no tiene scroll");

  // 2. Scrolling inside it moves the words and leaves the box open.
  const box = await page.locator(TEXT).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(500);
  const scrolled = await page.evaluate(
    (selector) => document.querySelector(selector)?.scrollTop ?? -1,
    TEXT
  );
  console.log("scrollTop tras la rueda:", scrolled);
  assert.ok(scrolled > 0, "el popover se cerró o no se movió al hacer scroll");

  // 3. A range across chapters reads past the chapter's end.
  const within = await preview(marks.nth(1));
  const across = await preview(marks.nth(2));
  console.log("Romanos 8:38-39:", within.text);
  console.log("Romanos 8:38-9:2:", across.text);
  assert.ok(across.text.startsWith(within.text));
  assert.ok(
    across.text.length > within.text.length + 40,
    "el rango entre capítulos solo mostró el primero"
  );

  console.log(
    "GREEN: el capítulo se lee con scroll dentro del popover y el rango entre capítulos muestra todos sus versos."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
