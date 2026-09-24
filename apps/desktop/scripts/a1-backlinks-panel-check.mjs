// SPDX-License-Identifier: GPL-3.0-or-later
// Locates two notes on the same passage through the backlinks pane, and opens
// one from there (PRD §31.10 criterion 10, Paso 5.2).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const A = "Epigrapho 5.2 A";
const B = "Epigrapho 5.2 B";
const C = "Epigrapho 5.2 C";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-panel-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const openBacklinks = () =>
  page.getByTitle("Notas sobre el mismo pasaje").first().click();

/** What the pane shows: one entry per passage, with who else cites it. */
const paneContents = () =>
  page.evaluate(() => {
    const pane = document.querySelector('[data-test-id="backlinks-pane"]');
    if (!pane) return undefined;
    const empty = pane.querySelector('[data-test-id="backlinks-empty"]');
    if (empty) return { empty: empty.textContent };
    return {
      groups: [...pane.querySelectorAll('[data-test-id="backlink-group"]')].map(
        (group) => ({
          ref: group.getAttribute("data-backlink-ref"),
          label: group.querySelector('[data-test-id="backlink-reference"]')
            ?.textContent,
          notes: [
            ...group.querySelectorAll('[data-test-id="backlink-note"]')
          ].map((note) => note.textContent)
        })
      )
    };
  });

/** Polls the pane until it shows something other than what it showed first. */
async function paneSettles(predicate) {
  const deadline = Date.now() + 20000;
  let last;
  for (;;) {
    last = await paneContents();
    if (last && predicate(last)) return last;
    if (Date.now() > deadline) return last;
    await page.waitForTimeout(250);
  }
}

async function writeNote(title, body, marks) {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(title);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type(body, { delay: 25 });
  // The references have to be recognised before the note is worth reading:
  // waiting only for the save would measure the typing, not the marks.
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .nth(marks - 1)
    .waitFor({ timeout: 20000 });
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
}

/** Opens a note from the list and waits for it to be the one on screen. */
async function openFromList(title) {
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.active [data-test-id="editor-title"]')?.value ===
      expected,
    title,
    { timeout: 20000 }
  );
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  // Two notes on the same passage, written in different languages, and a
  // third on a different passage so the pane has something to leave out.
  await writeNote(A, "Romanos 8:28 es el ancla de esta nota.", 1);
  await writeNote(B, "Romans 8:28 dice lo mismo, y Juan 3:16 también.", 2);
  await writeNote(C, "Salmos 23:1 y nada más.", 1);

  // 1. the third note cites a passage nobody else does.
  await openBacklinks();
  // While the pane is still reading, it shows neither the message nor a
  // group; waiting for "either" would measure that moment instead.
  const alone = await paneSettles(
    (pane) => !!pane.empty || pane.groups?.length > 0
  );
  console.log("nota C:", JSON.stringify(alone));
  // C cites a passage; what it has not got is company.
  assert.match(alone.empty ?? "", /Todavía ninguna otra nota/);

  // 2. open the first note: the pane finds the second through the passage.
  await openFromList(A);
  const fromA = await paneSettles((pane) => pane.groups?.length > 0);
  console.log("nota A:", JSON.stringify(fromA));
  assert.deepEqual(fromA.groups, [
    { ref: "ROM.8.28", label: "Romanos 8:28", notes: [B] }
  ]);

  // 3. following it opens that note, and from there the pane points back.
  await page.locator('[data-test-id="backlink-note"]').first().click();
  await page
    .locator('.active [data-test-id="editor-title"]')
    .and(page.locator(`[value="${B}"]`))
    .waitFor({ timeout: 20000 })
    .catch(() => undefined);
  const openedTitle = await page
    .locator('.active [data-test-id="editor-title"]')
    .inputValue();
  console.log("nota abierta desde el panel:", JSON.stringify(openedTitle));
  assert.equal(openedTitle, B);

  const fromB = await paneSettles((pane) => pane.groups?.length > 0);
  console.log("nota B:", JSON.stringify(fromB));
  // B cites two passages; only the one it shares with A has a backlink, and
  // the pane leaves the other out instead of listing it empty.
  assert.deepEqual(fromB.groups, [
    { ref: "ROM.8.28", label: "Romanos 8:28", notes: [A] }
  ]);

  console.log(
    "GREEN: dos notas con el mismo pasaje se localizan por backlinks, y abrir una desde el panel funciona en los dos sentidos."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
