// SPDX-License-Identifier: GPL-3.0-or-later
// The built page (build.bundle/, the one copied into the app) has to load
// without throwing and define loadApp, or every note opens blank on the
// phone. In 1.5.2 a value import from @notesnook/editor ran the editor's
// modules before Buffer was polyfilled; the dev server does not show it.
//
// Run after npm run build: node scripts/load-check.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const PAGE = new URL("../build.bundle/index.html", import.meta.url);
assert.ok(existsSync(fileURLToPath(PAGE)), "build the page first: npm run build");

// The installed Chrome: GitHub's runners have it, so CI downloads no browser.
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(PAGE.href);
  await page.waitForLoadState("load");
  assert.deepEqual(errors, [], "the page threw while loading");
  assert.equal(
    await page.evaluate(() => typeof globalThis.loadApp),
    "function",
    "the page never defined loadApp"
  );
  console.log("load-check: the editor page loads");
} finally {
  await browser.close();
}
