// SPDX-License-Identifier: GPL-3.0-or-later
// A misspelled word is underlined, a correct one is not, and typing in a long
// note blocks neither the editor's thread nor the main process (Paso 6.1).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const WRONG = "Tesalonisenses";
const RIGHT = "Tesalonicenses";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-spell-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/**
 * What Chromium thinks of the word under a point.
 *
 * The squiggle is painted by the browser and is not in the DOM, so it cannot
 * be read there. What can be read is what Chromium reports when asked for a
 * context menu: `misspelledWord` is filled only for a word it has marked.
 * The app's own menu listeners are removed first, because a native menu would
 * open and block the test on a popup nobody can close from here.
 */
async function wordAt(selector) {
  const box = await page.locator(selector).boundingBox();
  const capture = app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.removeAllListeners("context-menu");
    return new Promise((resolve) => {
      contents.once("context-menu", (_event, params) =>
        resolve({
          word: params.misspelledWord,
          suggestions: params.dictionarySuggestions
        })
      );
    });
  });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right"
  });
  return capture;
}

/** Longest gap between animation frames while `work` runs: editor stutter. */
async function rendererStall(work) {
  await page.evaluate(() => {
    const state = (window.__stall = { last: performance.now(), worst: 0 });
    const tick = () => {
      const now = performance.now();
      state.worst = Math.max(state.worst, now - state.last);
      state.last = now;
      state.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
  });
  const main = await mainStall(work);
  const renderer = await page.evaluate(() => {
    cancelAnimationFrame(window.__stall.frame);
    return Math.round(window.__stall.worst);
  });
  return { renderer, main };
}

/** Longest delay of a 50 ms timer in the main process: a blocked window. */
async function mainStall(work) {
  await app.evaluate(() => {
    globalThis.__stall = { worst: 0, last: Date.now() };
    globalThis.__stallTimer = setInterval(() => {
      const now = Date.now();
      globalThis.__stall.worst = Math.max(
        globalThis.__stall.worst,
        now - globalThis.__stall.last - 50
      );
      globalThis.__stall.last = now;
    }, 50);
  });
  await work();
  return app.evaluate(() => {
    clearInterval(globalThis.__stallTimer);
    return Math.round(globalThis.__stall.worst);
  });
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page
    .locator('.active [data-test-id="editor-title"]')
    .fill("Epigrapho 6.1");
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);

  // One word per line, so a right click lands on the word and nothing else.
  await page.keyboard.type(WRONG, { delay: 25 });
  await page.keyboard.press("Enter");
  await page.keyboard.type(RIGHT, { delay: 25 });
  // The dictionary is read once, on the first question; the first answer is
  // the slow one.
  await page.waitForTimeout(4000);

  const wrong = await wordAt(".active .ProseMirror p:nth-of-type(1)");
  console.log("palabra mal escrita:", JSON.stringify(wrong));
  const right = await wordAt(".active .ProseMirror p:nth-of-type(2)");
  console.log("palabra correcta:", JSON.stringify(right));

  // 1. the wrong one is marked, the right one is not: a real dictionary
  //    answered, not a provider that says yes or no to everything.
  assert.equal(wrong.word, WRONG);
  assert.equal(right.word, "");

  // 2. a long note keeps typing responsive.
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.press("Control+End");
  const paragraph =
    "Pablo escribió a los tesalonicenses sobre la esperanza y la paciencia, " +
    "y les recordó que el trabajo de cada día también es servicio. ";
  await page.keyboard.insertText(`\n${paragraph.repeat(400)}`);
  await page.waitForTimeout(2000);
  const length = await page.evaluate(
    () => document.querySelector(".active .ProseMirror").textContent.length
  );
  console.log("largo del documento:", length);

  const started = Date.now();
  const stall = await rendererStall(() =>
    page.keyboard.type(
      " Y despues de todo esto seguimos escribiendo sin parar en la misma nota.",
      { delay: 15 }
    )
  );
  const typing = Date.now() - started;
  console.log("tecleo:", typing, "ms · pausas máximas:", JSON.stringify(stall));

  // Measured at around 44 ms in the editor and 17 ms in the main process on a
  // 53,000 character note. The margin is wide on purpose: what these numbers
  // have to catch is a dictionary read on one of these two threads, which
  // costs about a second, not the ordinary jitter of a busy machine.
  assert.ok(
    stall.renderer < 400,
    `el editor se detuvo ${stall.renderer} ms entre cuadros`
  );
  assert.ok(
    stall.main < 250,
    `el proceso principal se detuvo ${stall.main} ms`
  );

  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });

  console.log(
    "GREEN: la palabra mal escrita se subraya, la correcta no, y escribir en un documento largo no traba la interfaz."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
