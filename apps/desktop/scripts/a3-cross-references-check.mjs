// SPDX-License-Identifier: GPL-3.0-or-later
// A3 Fase 2: "Ver también" in the verse preview.
//
// Hovers Juan 3:16 and checks that the preview lists its five most voted
// cross references (OpenBible.info) with their credit, that "Ver todas" lists
// the rest, and that clicking one puts it in the note as its own reference,
// after the one previewed.
//
// Offline is covered where it means something: a2-offline-check runs the
// release bundle with the network cut, and the packs come from the same place.
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-xref-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const popover = page.locator('[data-test-id="scripture-popover"]');
const seeAlso = popover.locator('[data-test-id="scripture-popover-see-also"]');

try {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill("A3 Fase 2");
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type("Hoy lei Juan 3:16 en la mañana.", { delay: 25 });

  const marks = page.locator(".active .ProseMirror span[data-scripture-ref]");
  await marks.first().waitFor({ timeout: 20000 });

  // ---- 1. five, most voted first, with the credit ----
  await marks.first().hover();
  await seeAlso.waitFor({ state: "visible", timeout: 20000 });
  const first = await seeAlso
    .locator("button[data-scripture-ref]")
    .evaluateAll((buttons) =>
      buttons.map((b) => [b.dataset.scriptureRef, b.textContent])
    );
  console.log("1. ver también:", JSON.stringify(first));
  assert.equal(first.length, 5);
  assert.deepEqual(first[0], ["ROM.5.8", "Romanos 5:8"]);
  const text = await seeAlso.innerText();
  assert.match(text, /Ver también/);
  assert.match(text, /OpenBible\.info — CC BY/);

  // ---- 2. see all ----
  const all = seeAlso.locator('[data-test-id="scripture-popover-see-all"]');
  assert.match(await all.innerText(), /^Ver todas \(\d+\)$/);
  const total = Number((await all.innerText()).match(/\d+/)[0]);
  await all.click();
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(
        '[data-test-id="scripture-popover-see-also"] button[data-scripture-ref]'
      ).length === count,
    total
  );
  console.log(`2. ver todas: ${total} referencias`);

  // ---- 3. a click inserts it after the previewed reference ----
  await seeAlso.locator('button[data-scripture-ref="ROM.5.8"]').click();
  await popover.waitFor({ state: "detached" });
  await page
    .locator('.active .ProseMirror span[data-scripture-ref="ROM.5.8"]')
    .waitFor({ timeout: 20000 });
  const paragraph = await page
    .locator(".active .ProseMirror p")
    .first()
    .innerText();
  console.log("3. la nota dice:", paragraph);
  assert.match(paragraph, /Juan 3:16; Romanos 5:8 en la mañana\./);
  assert.equal(
    await page
      .locator('.active .ProseMirror span[data-scripture-ref="JHN.3.16"]')
      .innerText(),
    "Juan 3:16"
  );

  console.log(
    "GREEN: «Ver también» muestra las referencias más votadas de OpenBible, «Ver todas» el resto, y un clic las inserta como referencias."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
