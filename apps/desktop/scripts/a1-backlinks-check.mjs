// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the reference index: two notes citing Romans 8:28 both appear under
// it, and taking the reference out of one takes that note out (PRD §31.10,
// Paso 5.1). The last block reloads the app to prove the index is rebuilt
// from the notes themselves, not only kept up to date as you type.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// The specifier the application itself is served under, so this reaches the
// module the editor writes to and not a second copy of it.
const INDEX_MODULE = "/common/reference-index.ts";
const REF = "ROM.8.28";
const A = "Epigrapho 5.1 A";
const B = "Epigrapho 5.1 B";

const profile = await mkdtemp(
  path.join(profilesRoot(), "epigrapho-backlinks-")
);
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/** The titles of the notes the index says cite `ref`, sorted for comparing. */
const citing = (ref) =>
  page.evaluate(
    async ([url, ref]) => {
      const { notesFor } = await import(/* @vite-ignore */ url);
      const notes = await notesFor(ref);
      return notes.map((note) => note.title).sort();
    },
    [INDEX_MODULE, ref]
  );

/** Waits for the editor to say the note is stored, not merely typed. */
async function waitSaved() {
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
}

/**
 * Polls the index until it says what is expected, or gives up and returns
 * what it last said so the assertion can print the difference. Saving is
 * debounced, so asking once right after typing measures the race, not the
 * index.
 */
async function citingSettles(ref, expected) {
  const deadline = Date.now() + 20000;
  let last = [];
  for (;;) {
    last = await citing(ref);
    if (
      last.length === expected.length &&
      last.every((title, index) => title === expected[index])
    )
      return last;
    if (Date.now() > deadline) return last;
    await page.waitForTimeout(250);
  }
}

async function writeNote(title, body) {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(title);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type(body, { delay: 25 });
  await waitSaved();
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // 1. one note citing the passage.
  await writeNote(A, "Romanos 8:28 es el ancla de esta nota.");
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .first()
    .waitFor({ timeout: 20000 });
  const first = await citingSettles(REF, [A]);
  console.log("tras la primera nota:", JSON.stringify(first));
  assert.deepEqual(first, [A]);

  // 2. a second note citing the same passage, written the other way round.
  await writeNote(B, "En Romans 8:28 dice lo mismo.");
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .first()
    .waitFor({ timeout: 20000 });
  const both = await citingSettles(REF, [A, B].sort());
  console.log("tras la segunda nota:", JSON.stringify(both));
  // Written in Spanish in one note and in English in the other, and the index
  // holds one reference: that is the point of storing the canonical form.
  assert.deepEqual(both, [A, B].sort());

  // 3. taking the reference out of the first note takes it out of the index.
  await page.getByText(A, { exact: true }).first().click();
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Esta nota ya no cita nada.", { delay: 25 });
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .waitFor({ state: "detached", timeout: 20000 });
  await waitSaved();
  const afterEdit = await citingSettles(REF, [B]);
  console.log("tras borrar la referencia de A:", JSON.stringify(afterEdit));
  assert.deepEqual(afterEdit, [B]);

  // 4. the index is derived from the notes, not remembered: a reload drops
  // everything in memory, and reading it back scans what was stored.
  // The evaluate can be cut short by the reload it just asked for, and that
  // is the point of the call, not a failure. Waiting for the load afterwards
  // is what keeps the next locator off the page that is leaving.
  await page
    .evaluate(() => {
      window.location.hash = "/";
      window.location.reload();
    })
    .catch(() => undefined);
  await page.waitForLoadState("load");
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  const afterReload = await citingSettles(REF, [B]);
  console.log("tras recargar la aplicación:", JSON.stringify(afterReload));
  assert.deepEqual(afterReload, [B]);

  console.log(
    `GREEN: dos notas que citan ${REF} aparecen en el índice, quitar la referencia de una la saca, y recargar reconstruye lo mismo desde las notas.`
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
