// SPDX-License-Identifier: GPL-3.0-or-later
// A3 Fase 5: translations compared side by side.
//
// Inserts Juan 3:16 as a Scripture Block (VBL) and, with "Comparar", adds BSB
// and KJV as two more columns. Checks that a fourth is refused, that the three
// columns survive a reload, that they leave in the HTML export and in a copy,
// that unchecking one takes it away, and that the columns stack when the
// block is narrow.
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "A3 Fase 5";
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-parallel-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));
// Wide enough for three columns; part 4 narrows the block on purpose.
await (
  await app.browserWindow(page)
).evaluate((window) => {
  window.webContents.closeDevTools();
  window.setContentSize(1600, 900);
});

const block = page.locator(".active .ProseMirror .scripture-block");
/** The columns as the editor holds them: translation and the start of the text. */
const columns = () =>
  page.evaluate(() => {
    const { editor } = document.querySelector(".active .ProseMirror");
    let found;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "scriptureBlock") found = node.attrs;
    });
    return [
      [found.translationId, found.text.slice(0, 20)],
      ...found.parallel.map((c) => [c.translationId, c.text.slice(0, 20)])
    ];
  });

async function compare(translation) {
  await block.locator('[data-scripture-compare="true"]').click();
  await page
    .locator('[data-test-id="menu-container"]')
    .locator(`[data-test-id="menu-button-${translation}"]`)
    .click();
}

const saved = async () => {
  await page
    .locator('[data-test-id="editor-save-state-notsaved"]')
    .waitFor({ timeout: 5000 })
    .catch(() => undefined);
  await page.locator('[data-test-id="editor-save-state-saved"]').waitFor();
};

try {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  await page
    .locator('[data-test-id="dialog-title"]', { hasText: "Insertar Escritura" })
    .waitFor();
  await page.keyboard.type("Juan 3:16");
  await page.locator('[data-test-id="dialog-yes"]').click();
  await block.waitFor();

  // ---- 1. BSB and KJV beside VBL ----
  await compare("BSB");
  await block.locator(".scripture-block-parallel").first().waitFor();
  await compare("KJV");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".active .ProseMirror .scripture-block-parallel"
      ).length === 2
  );
  const three = await columns();
  console.log("1. columnas:", JSON.stringify(three));
  assert.deepEqual(
    three.map(([id]) => id),
    ["VBL", "BSB", "KJV"]
  );
  assert.match(three[1][1], /^For God so loved/);
  assert.match(three[2][1], /^For God so loved/);
  const layout = await block.evaluate((element) => ({
    columns: element.getAttribute("data-columns"),
    tops: [
      ...element.querySelectorAll(
        ":scope > .scripture-block-text, :scope > .scripture-block-parallel"
      )
    ].map((child) => Math.round(child.getBoundingClientRect().top))
  }));
  assert.equal(layout.columns, "3");
  assert.ok(
    new Set(layout.tops).size === 1,
    `las columnas no están lado a lado: ${layout.tops}`
  );

  // ---- 2. a fourth is refused ----
  await compare("NTV");
  await page
    .getByText("Un pasaje se puede comparar en hasta tres traducciones.")
    .waitFor();
  assert.equal((await columns()).length, 3);
  console.log("2. una cuarta traducción no entra");

  // ---- 3. reload, export, copy ----
  await saved();
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByText("Notas", { exact: true }).first().waitFor();
  try {
    await block.waitFor({ timeout: 20000 });
  } catch {
    await page
      .locator('[data-test-id="title"]', { hasText: TITLE })
      .first()
      .click();
    await block.waitFor();
  }
  assert.deepEqual(await columns(), three);
  const html = await page.evaluate(() =>
    document.querySelector(".active .ProseMirror").editor.getHTML()
  );
  assert.equal((html.match(/scripture-block-parallel/g) || []).length, 2);
  assert.match(html, /data-columns="3"/);
  const copied = await page.evaluate(() => {
    const { editor } = document.querySelector(".active .ProseMirror");
    let text;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "scriptureBlock")
        text = node.type.spec.toText({ node });
    });
    return text;
  });
  assert.match(copied, /\(VBL\)[\s\S]*\(BSB\)[\s\S]*\(KJV\)/);
  console.log(
    "3. las tres columnas siguen tras recargar, salen en el HTML y al copiar"
  );

  // ---- 4. narrow stacks ----
  await block.evaluate((element) => (element.style.width = "360px"));
  const stacked = await block.evaluate((element) =>
    [
      ...element.querySelectorAll(
        ":scope > .scripture-block-text, :scope > .scripture-block-parallel"
      )
    ].map((child) => Math.round(child.getBoundingClientRect().left))
  );
  assert.equal(new Set(stacked).size, 1, `no se apilan: ${stacked}`);
  await block.evaluate((element) => (element.style.width = ""));
  console.log("4. en un bloque angosto las columnas se apilan");

  // ---- 5. unchecking takes one away ----
  await compare("BSB");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".active .ProseMirror .scripture-block-parallel"
      ).length === 1
  );
  assert.deepEqual(
    (await columns()).map(([id]) => id),
    ["VBL", "KJV"]
  );
  console.log("5. desmarcar BSB la quita");

  console.log(
    "GREEN: «Comparar» pone hasta tres traducciones lado a lado, guardadas en la nota."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
