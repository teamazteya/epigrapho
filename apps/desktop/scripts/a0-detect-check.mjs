// SPDX-License-Identifier: GPL-3.0-or-later
// Types a note with Bible references and checks the debounced detection marks
// them without touching what was typed.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Epigrapho 5.3";
const TYPED = "Escribi Juan 3:16 y John 3:16 hoy.";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-detect-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const readBlock = () =>
  page.evaluate(() => {
    const block = document.querySelector(".active .ProseMirror p");
    if (!block) return undefined;
    const plainStyle = getComputedStyle(block);
    return {
      text: block.textContent,
      marks: [...block.querySelectorAll("span[data-scripture-ref]")].map(
        (span) => {
          const style = getComputedStyle(span);
          return {
            ref: span.getAttribute("data-scripture-ref"),
            versification: span.getAttribute("data-versification"),
            text: span.textContent,
            color: style.color,
            decoration: style.textDecorationLine,
            plainColor: plainStyle.color
          };
        }
      )
    };
  });

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  // The editor swallows the first keystrokes if it is still settling.
  await page.waitForTimeout(1000);

  const startedTyping = Date.now();
  await page.keyboard.type(TYPED);
  const typingEnded = Date.now();

  // Debounced means nothing is marked while the keys are still coming in.
  const immediate = await readBlock();
  const elapsed = Date.now() - typingEnded;
  console.log(
    `tecleado en ${typingEnded - startedTyping} ms; leido ${elapsed} ms despues`
  );
  if (elapsed < 300) {
    assert.equal(
      immediate.marks.length,
      0,
      "la deteccion no esperó al debounce"
    );
  } else {
    console.log("aviso: lectura demasiado tardía para probar el debounce");
  }

  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .first()
    .waitFor({ timeout: 5000 });
  const detected = await readBlock();
  console.log(JSON.stringify(detected, null, 2));

  assert.equal(detected.text, TYPED, "la deteccion cambió el texto escrito");
  assert.equal(detected.marks.length, 2);
  assert.deepEqual(
    detected.marks.map((mark) => mark.text),
    ["Juan 3:16", "John 3:16"]
  );
  for (const mark of detected.marks) {
    assert.equal(mark.ref, "JHN.3.16");
    // The canonical table got its real name in Paso 4.5; marks written
    // before that carry "default", which a0-mark-check still exercises.
    assert.equal(mark.versification, "eng");
    assert.notEqual(mark.color, mark.plainColor, "el mark no se ve distinto");
    assert.match(mark.decoration, /underline/);
  }

  // Editing the block re-runs the detection over that block only.
  await page.keyboard.type(" Y Salmo 23:1.");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".active .ProseMirror span[data-scripture-ref]")
        .length === 3,
    undefined,
    { timeout: 5000 }
  );
  const edited = await readBlock();
  assert.equal(edited.text, `${TYPED} Y Salmo 23:1.`);
  assert.deepEqual(
    edited.marks.map((mark) => mark.ref),
    ["JHN.3.16", "JHN.3.16", "PSA.23.1"]
  );
  console.log(
    "marks tras editar:",
    JSON.stringify(edited.marks.map((m) => m.text))
  );

  console.log(
    "GREEN: referencias detectadas con debounce y sin tocar el texto."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
