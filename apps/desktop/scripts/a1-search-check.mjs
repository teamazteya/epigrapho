// SPDX-License-Identifier: GPL-3.0-or-later
// "Ro 8", "Romanos 8" and "Romans 8" return the same notes (Paso 5.3).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const A = "Epigrapho 5.3 A";
const B = "Epigrapho 5.3 B";
const C = "Epigrapho 5.3 C";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-search-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/** The note titles the list is showing right now. */
const listedTitles = () =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-test-id="list-item"] [data-test-id="title"]'
      )
    ].map((title) => title.textContent)
  );

/**
 * Reads the list once it stops moving.
 *
 * Every keystroke starts a search of its own: the header debounces the query,
 * but it builds a new debounced function on each render, so each partial query
 * gets its own timer and lands in turn. "Romanos" is a text search and
 * "Romanos 8" is a passage search, and waiting for "a list that is not the
 * unfiltered one" would measure the first of the two.
 */
async function stableTitles() {
  const deadline = Date.now() + 30000;
  let previous;
  let repeats = 0;
  for (;;) {
    await page.waitForTimeout(400);
    const titles = JSON.stringify(await listedTitles());
    if (titles === previous) repeats++;
    else {
      previous = titles;
      repeats = 0;
    }
    if (repeats >= 3 || Date.now() > deadline) return JSON.parse(titles).sort();
  }
}

async function writeNote(title, body) {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(title);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type(body, { delay: 25 });
  // The note is only searchable by passage once its reference is marked.
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .first()
    .waitFor({ timeout: 20000 });
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
}

/** Types a query the way a person would and reads what the list settles on. */
async function search(query) {
  const input = page.locator('[data-test-id="search-input"]');
  await input.click();
  // `fill` would set the value without a keystroke, and the search only starts
  // on keyup.
  await input.pressSequentially(query, { delay: 30 });
  return stableTitles();
}

/** Clears the search and waits for every note to be back. */
async function clearSearch() {
  await page.locator('[data-test-id="search-input"]').fill("");
  await page.keyboard.press("Escape");
  return stableTitles();
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // Two notes inside Romans 8, written differently and citing different
  // verses, and a third outside it so the search has something to leave out.
  await writeNote(A, "Romanos 8:28 es el ancla de esta nota.");
  await writeNote(B, "Romans 8:39 cierra el capítulo.");
  await writeNote(C, "Juan 3:16 y nada más.");

  const all = await clearSearch();
  console.log("lista completa:", JSON.stringify(all.length));
  assert.equal(all.length, 3);

  const expected = [A, B].sort();
  const results = {};
  for (const query of ["Ro 8", "Romanos 8", "Romans 8"]) {
    results[query] = await search(query);
    console.log(`${query}:`, JSON.stringify(results[query]));
    await clearSearch();
  }

  // 1. the three ways of writing the passage find the same notes,
  assert.deepEqual(results["Ro 8"], expected);
  assert.deepEqual(results["Romanos 8"], expected);
  assert.deepEqual(results["Romans 8"], expected);
  // 2. and neither the note citing 8:28 nor the one citing 8:39 was missed
  //    even though no note says "Ro 8" anywhere.
  assert.ok(results["Ro 8"].includes(A) && results["Ro 8"].includes(B));
  assert.ok(!results["Ro 8"].includes(C));

  // 3. a passage nobody cites returns nothing, rather than everything.
  const empty = await search("Romanos 9");
  console.log("Romanos 9:", JSON.stringify(empty));
  assert.deepEqual(empty, []);
  await clearSearch();

  // 4. ordinary text search still works: the query is not a passage, so it
  //    goes to the usual index and finds the note by its words.
  const words = await search("ancla");
  console.log("ancla:", JSON.stringify(words));
  // A text search lists the note and the matching line separately; what
  // matters here is that the note is found by a word and nothing else is.
  assert.ok(words.includes(A));
  assert.ok(!words.includes(B) && !words.includes(C));

  console.log(
    "GREEN: Ro 8, Romanos 8 y Romans 8 devuelven el mismo conjunto de notas, y la búsqueda de texto sigue intacta."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
