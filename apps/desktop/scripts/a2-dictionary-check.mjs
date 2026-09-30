// SPDX-License-Identifier: GPL-3.0-or-later
// The Bible dictionaries (A2 Fases 6 and 7): the pane finds "Bethel" in
// Easton and Smith, each with its source; "gracia" finds the es-419 entry
// with its Strong numbers, before any English one; "+" → "Insertar entrada
// de diccionario" leaves a block that keeps only the id; and an export
// carries the entry's words.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const profile = await mkdtemp(
  path.join(profilesRoot(), "epigrapho-dictionary-")
);
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

const PANE = '[data-test-id="dictionary-pane"]';

/** Searches the dictionary pane and returns its hits. */
async function search(query) {
  await page.locator('[data-test-id="dictionary-input"]').fill(query);
  await page.locator('[data-test-id="dictionary-input"]').press("Enter");
  await page.waitForFunction(
    (pane) => document.querySelector(pane)?.getAttribute("aria-busy") === "false",
    PANE
  );
  return page.evaluate(
    (pane) =>
      [...document.querySelectorAll(`${pane} [data-test-id="dictionary-hit"]`)].map(
        (hit) => ({
          id: hit.getAttribute("data-entry-id"),
          source: hit.querySelector('[data-test-id="dictionary-source"]')
            .textContent
        })
      ),
    PANE
  );
}

try {
  await page.getByText("Notas", { exact: true }).first().waitFor();
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill("Diccionario");
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.type("Notas sobre Betel.");

  // 1. The pane, from the action bar: "Bethel" in Easton and Smith.
  await page.locator('[data-test-id="Diccionario bíblico"]').click();
  await page.locator(PANE).waitFor();
  const bethel = await search("Bethel");
  console.log("Bethel:", JSON.stringify(bethel));
  const eas = bethel.find((hit) => hit.id === "EAS:bethel");
  const smi = bethel.find((hit) => hit.id === "SMI:bethel");
  assert.equal(eas?.source, "Easton's Bible Dictionary (1897)");
  assert.equal(smi?.source, "Smith's Bible Dictionary (1863)");
  await page
    .locator(`${PANE} [data-entry-id="EAS:bethel"] button`)
    .first()
    .click();
  const article = await page
    .locator(`${PANE} [data-test-id="dictionary-article"]`)
    .first()
    .innerText();
  assert.match(article, /^House of God/);
  // Reading only: without the "+" menu there is nothing to insert.
  assert.equal(
    await page.locator(`${PANE} [data-test-id="dictionary-insert"]`).count(),
    0
  );

  // 2. "gracia": es-419 first, with its Strong numbers.
  const grace = await search("gracia");
  console.log("gracia:", JSON.stringify(grace.slice(0, 3)));
  assert.equal(grace[0].source, "Palabras de Traducción (es-419)");
  await page.locator(`${PANE} [data-test-id="dictionary-hit"] button`).first().click();
  const strongs = await page
    .locator(`${PANE} [data-test-id="dictionary-strongs"]`)
    .first()
    .innerText();
  console.log("Strong de gracia:", strongs);
  assert.match(strongs, /G5485/);

  // 2b. "Betel": es-419 first, then Rand (1890), then the English ones.
  const betel = await search("Betel");
  console.log("Betel:", JSON.stringify(betel.slice(0, 4)));
  assert.equal(betel[0].id, "TW:names/bethel");
  assert.equal(betel[1].id, "RAND:betel");
  assert.equal(betel[1].source, "Diccionario de la Santa Biblia (Rand, 1890)");
  await page.locator(`${PANE} [data-entry-id="RAND:betel"] button`).first().click();
  const rand = await page
    .locator(`${PANE} [data-entry-id="RAND:betel"] [data-test-id="dictionary-article"]`)
    .innerText();
  assert.match(rand, /^BETEL, o BETH EL, casa de Dios/);

  // 3. "+" → "Insertar entrada de diccionario": the block keeps the id.
  //    The reading pane is put away first, as a person would to write.
  await page.locator('[data-test-id="Diccionario bíblico"]').click();
  await page.locator(PANE).waitFor({ state: "detached" });
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-dictionaryEntry"]').click();
  await page.locator('[data-test-id="dictionary-input"]').waitFor();
  await search("Bethel");
  await page
    .locator(`${PANE} [data-entry-id="EAS:bethel"] [data-test-id="dictionary-insert"]`)
    .click();
  const block = page.locator(".active .ProseMirror .dictionary-entry");
  await block.locator(".dictionary-entry-credit").filter({ hasText: /\S/ }).waitFor();
  const shown = await block.innerText();
  console.log("bloque:", shown.slice(0, 160).replace(/\n/g, " | "));
  assert.match(shown, /House of God/);
  assert.match(shown, /NEUU/);
  const html = await page.evaluate(() =>
    document.querySelector(".active .ProseMirror").editor.getHTML()
  );
  const stored = html.match(/<div[^>]*dictionary-entry[^>]*>.*?<\/div>/)?.[0];
  console.log("HTML de la nota:", stored);
  assert.match(html, /data-dictionary-entry="EAS:bethel"/);
  assert.doesNotMatch(html, /House of God/);
  await page.screenshot({ path: path.join(profile, "diccionario.png") });

  // 4. An export carries the entry's words.
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    globalThis.__exported = [];
    const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
    HTMLAnchorElement.prototype.dispatchEvent = function (event) {
      if (event.type === "click" && this.download) {
        globalThis.__exported.push({ name: this.download, href: this.href });
        return true;
      }
      return dispatch.call(this, event);
    };
  });
  await page
    .getByText("Diccionario", { exact: true })
    .first()
    .click({ button: "right" });
  await page.locator('[data-test-id="menu-button-export"]').click();
  await page.locator('[data-test-id="menu-button-md"]').dispatchEvent("click");
  await page.waitForFunction(() => globalThis.__exported.length > 0, undefined, {
    timeout: 60000
  });
  const markdown = await page.evaluate(() =>
    fetch(globalThis.__exported[0].href).then((response) => response.text())
  );
  console.log("md:", markdown.split("\n").filter((l) => /Bethel|House of God/.test(l)).slice(0, 3));
  assert.match(markdown, /House of God/);

  console.log(
    "GREEN: el diccionario encuentra Bethel en Easton y Smith con su fuente, gracia da es-419 primero con sus Strong, el bloque guarda solo el id y el export lleva el texto."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
