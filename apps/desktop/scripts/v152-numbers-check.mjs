// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import { profilesRoot } from "./profiles-root.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = fileURLToPath(
  new URL("../../../../evidence/v152/", import.meta.url)
);
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-v152-"));
const app = await _electron.launch({
  args: [path.join(root, "build/electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  page.setDefaultTimeout(60000);
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator(".active .ProseMirror").waitFor();
  await page.evaluate(() => {
    const { editor } = document.querySelector(".active .ProseMirror");
    editor.commands.setContent(
      '<p><span data-scripture-ref="JHN.3.16-JHN.3.18">Juan 3:16-18</span></p><p></p>'
    );
  });
  const reference = page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .first();
  await reference.hover();
  const preview = page.locator('[data-test-id="scripture-popover-text"]');
  await preview.locator("sup").first().waitFor();
  assert.deepEqual(await preview.locator("sup").allTextContents(), [
    "16",
    "17",
    "18"
  ]);
  await page.screenshot({ path: path.join(evidence, "popover-desktop.png") });
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const { editor } = document.querySelector(".active .ProseMirror");
    editor.commands.focus("end");
    editor.commands.insertScriptureBlock({
      ref: "JHN.3.16-JHN.3.18",
      label: "Juan 3:16-18",
      translationId: "VBL",
      text: "Texto antiguo",
      parallel: [{ translationId: "BSB", text: "Old text" }]
    });
  });
  const block = page.locator(".active .scripture-block");
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll(".active .scripture-block sup").length === 6,
      undefined,
      { timeout: 15000 }
    )
    .catch(async (error) => {
      console.error(
        await page.evaluate(async () => {
          const { editor } = document.querySelector(".active .ProseMirror");
          const options = editor.extensionManager.extensions.find(
            (extension) => extension.name === "scriptureBlock"
          ).options;
          return {
            html: editor.getHTML(),
            resolve: typeof options.resolve,
            served: await options.resolve?.("JHN.3.16-JHN.3.18", "VBL")
          };
        })
      );
      throw error;
    });
  assert.deepEqual(await block.locator("sup").allTextContents(), [
    "16",
    "17",
    "18",
    "16",
    "17",
    "18"
  ]);
  assert.equal(
    await block
      .locator("sup")
      .first()
      .evaluate((el) => getComputedStyle(el).verticalAlign),
    "super"
  );
  await page.screenshot({ path: path.join(evidence, "block-desktop.png") });
  const saved = await page.evaluate(() =>
    document.querySelector(".active .ProseMirror").editor.getHTML()
  );
  assert.ok(!saved.includes("Texto antiguo") && !saved.includes("Old text"));
  await page.evaluate(
    (html) =>
      document
        .querySelector(".active .ProseMirror")
        .editor.commands.setContent(html),
    saved
  );
  assert.deepEqual(await block.locator("sup").allTextContents(), [
    "16",
    "17",
    "18",
    "16",
    "17",
    "18"
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await reference.scrollIntoViewIfNeeded();
  await reference.hover();
  await preview.locator("sup").first().waitFor();
  await page.screenshot({ path: path.join(evidence, "popover-narrow.png") });
  console.log(
    "GREEN: popover, bloque antiguo, paralelo, reapertura y viewport estrecho; números reales 16–18."
  );
  console.log(`Evidencia: ${evidence}`);
} finally {
  await app.close();
}
