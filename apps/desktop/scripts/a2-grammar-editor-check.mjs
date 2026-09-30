// SPDX-License-Identifier: GPL-3.0-or-later
// Grammar in the editor (A2 Paso 1.4): a missing accent on an interrogative is
// marked with its suggestion, a correct sentence is not, picking the
// suggestion fixes the words (with the mouse or the keyboard), "Ignorar"
// leaves a finding alone in this note, and checking never stalls typing in a
// long note.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const LINES = [
  "¿Que hora es?",
  "No sé que decir.",
  "¿Cual prefieres?",
  "Dijo que vendría.",
  "Es tan alto como su padre."
];

const profile = await mkdtemp(
  path.join(profilesRoot(), "epigrapho-grammar-editor-")
);
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const paragraph = (n) => `.active .ProseMirror p:nth-of-type(${n})`;
const findings = (n) =>
  page.locator(`${paragraph(n)} .grammar-error`).allInnerTexts();

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
  await work();
  return page.evaluate(() => {
    cancelAnimationFrame(window.__stall.frame);
    return Math.round(window.__stall.worst);
  });
}

try {
  await page.getByText("Notas", { exact: true }).first().waitFor();
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill("Gramática");
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  for (const [index, line] of LINES.entries()) {
    if (index) await page.keyboard.press("Enter");
    await page.keyboard.type(line, { delay: 20 });
  }

  // The first check of each language loads its rules (~3 s, ADR-0010).
  await page
    .locator(`${paragraph(3)} .grammar-error`)
    .first()
    .waitFor({ timeout: 60000 });
  const marked = {};
  for (let n = 1; n <= LINES.length; n++)
    marked[LINES[n - 1]] = await findings(n);
  console.log("marcas:", JSON.stringify(marked));

  // 1. The interrogatives are marked, the correct sentences are not.
  assert.deepEqual(marked[LINES[0]], ["Que"]);
  assert.deepEqual(marked[LINES[1]], ["que"]);
  assert.deepEqual(marked[LINES[2]], ["Cual"]);
  assert.deepEqual(marked[LINES[3]], []);
  assert.deepEqual(marked[LINES[4]], []);

  // 2. Picking the suggestion fixes the words and the mark goes.
  await page.locator(`${paragraph(1)} .grammar-error`).click();
  const popover = page.locator('[data-test-id="grammar-popover"]');
  await popover.waitFor();
  console.log("mensaje:", await popover.innerText());
  await popover
    .locator('[data-test-id="grammar-replacement"]', { hasText: "Qué" })
    .click();
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.textContent === "¿Qué hora es?",
    paragraph(1)
  );
  await page.waitForTimeout(3000);
  assert.deepEqual(await findings(1), []);

  // 2b. The same from the keyboard: Shift+F10 inside the word opens the box
  //     with the first suggestion focused, and Enter takes it.
  await page.locator(paragraph(3)).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+F10");
  await popover.waitFor();
  const focused = await page.evaluate(
    () => document.activeElement?.textContent
  );
  console.log("foco al abrir con teclado:", focused);
  assert.equal(focused, "Cuál");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.textContent === "¿Cuál prefieres?",
    paragraph(3)
  );

  // 3. "Ignorar" leaves it alone in this note, and says so for later.
  await page.locator(`${paragraph(2)} .grammar-error`).click();
  await popover.locator('[data-test-id="grammar-ignore"]').click();
  assert.deepEqual(await findings(2), []);
  const stored = await page.evaluate(() =>
    localStorage.getItem("grammar:ignored")
  );
  console.log("ignorado:", stored);
  assert.match(stored ?? "", /QUE_TILDE2:que/);
  // Editing the paragraph checks it again, and the dismissal still holds.
  await page.locator(paragraph(2)).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Nada.", { delay: 20 });
  await page.waitForTimeout(3000);
  assert.deepEqual(await findings(2), []);

  // 4. A long note keeps typing responsive while it is checked.
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.press("Control+End");
  const text =
    "Pablo escribió a los tesalonicenses sobre la esperanza y la paciencia, " +
    "y les recordó que el trabajo de cada día también es servicio. ";
  await page.keyboard.insertText(`\n${text.repeat(400)}`);
  await page.waitForTimeout(2000);
  const stall = await rendererStall(() =>
    page.keyboard.type(
      " Y despues de todo esto seguimos escribiendo sin parar en la misma nota.",
      { delay: 15 }
    )
  );
  console.log("pausa máxima del editor:", stall, "ms");
  // The same bound as a1-spellcheck-check: what it has to catch is checking
  // on the editor's thread, which costs seconds, not ordinary jitter.
  assert.ok(stall < 400, `el editor se detuvo ${stall} ms entre cuadros`);

  console.log(
    "GREEN: los interrogativos sin tilde se marcan con su sugerencia, lo correcto no, la sugerencia corrige, Ignorar se respeta y escribir no se traba."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
