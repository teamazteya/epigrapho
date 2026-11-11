// SPDX-License-Identifier: GPL-3.0-or-later
// A6 Fase 1: a misspelled word in a table cell, right click, pick the
// suggestion, and the next mouse move and keystroke are plain editing, not a
// cell selection. Before the fix the right click started the table's drag
// tracking; where the menu opens on mousedown (macOS, Linux) it swallows the
// mouseup, and moving the pointer afterwards selected cells. Windows sends
// mouseup before the menu (measured: mousedown, mouseup, auxclick,
// contextmenu), so there this is the whole flow by hand, not a repro: the
// fix itself is covered by prosemirror-tables/__tests__/input.test.ts.
//
// The mouse is the system's (Windows SendInput), not the page's. The menu is
// the app's own, drawn natively; its suggestion is picked through the item's
// own handler, what a click on it runs (keys sent to a native menu sometimes
// reach the page first). Windows only; the window is put on top while it
// runs, so leave the mouse alone.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const WRONG = "Tesalonisenses";
const RIGHT = "Tesalonicenses";
const EDITOR = ".active .ProseMirror";

/**
 * Real input, in physical screen pixels: "move x y", "rdown", "rup",
 * "wait ms", separated by ";".
 */
function system(steps) {
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Input {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
}
"@
[Input]::SetProcessDPIAware() | Out-Null
foreach ($step in "${steps}".Split(";")) {
  $a = $step.Trim().Split(" ")
  switch ($a[0]) {
    "move" { [Input]::SetCursorPos([int]$a[1], [int]$a[2]) | Out-Null }
    "rdown" { [Input]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero) }
    "rup" { [Input]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero) }
    "wait" { Start-Sleep -Milliseconds ([int]$a[1]) }
  }
  Start-Sleep -Milliseconds 30
}`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(result.stderr);
}

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-table-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

try {
  await page.getByText("Notas", { exact: true }).first().waitFor();
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill("A6 tabla");
  await page.locator(EDITOR).click();
  await page.waitForTimeout(1000);
  await page.evaluate(
    (selector) =>
      document
        .querySelector(selector)
        .editor.commands.insertTable({ rows: 2, cols: 2 }),
    EDITOR
  );
  await page.keyboard.type(WRONG, { delay: 25 });
  // The dictionary is read once, on the first question.
  await page.waitForTimeout(4000);

  // Where the page is on the screen, in physical pixels.
  const screen = await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setAlwaysOnTop(true);
    window.focus();
    const bounds = window.getContentBounds();
    return {
      x: bounds.x,
      y: bounds.y,
      scale: screen.getDisplayMatching(bounds).scaleFactor,
      zoom: window.webContents.getZoomFactor()
    };
  });
  const at = (box, dx, dy) =>
    [
      Math.round((screen.x + (box.x + dx) * screen.zoom) * screen.scale),
      Math.round((screen.y + (box.y + dy) * screen.zoom) * screen.scale)
    ].join(" ");

  const cells = page.locator(`${EDITOR} :is(td, th)`);
  const word = await cells.nth(0).locator("p").boundingBox();
  const other = await cells.nth(3).boundingBox();
  const menuShown = app.evaluate(
    ({ Menu }) =>
      new Promise((resolve) => {
        const popup = Menu.prototype.popup;
        Menu.prototype.popup = function (options) {
          Menu.prototype.popup = popup;
          globalThis.__menu = this;
          resolve(this.items.map((item) => item.label).filter(Boolean));
          return popup.call(this, options);
        };
      })
  );
  // Let the hook reach the main process before spawnSync blocks this one.
  await page.waitForTimeout(300);
  // Right click on the word: the app shows its menu.
  system(`move ${at(word, 30, word.height / 2)}; wait 200; rdown; rup`);
  const labels = await menuShown;
  console.log("1. menú:", JSON.stringify(labels.slice(0, 6)));
  assert.equal(labels[0], RIGHT, "el menú no ofrece primero la corrección");
  // The suggestion is picked and the menu goes away; then the hand wanders to
  // another cell.
  const route = Array.from({ length: 10 }, (_, i) => {
    const t = (i + 1) / 10;
    return `move ${at(
      {
        x: word.x + (other.x + other.width / 2 - word.x - 30) * t,
        y: word.y + (other.y + other.height / 2 - word.y - word.height / 2) * t
      },
      30,
      word.height / 2
    )}`;
  }).join("; ");
  await page.waitForTimeout(800);
  await app.evaluate(({ BrowserWindow }, label) => {
    const menu = globalThis.__menu;
    const window = BrowserWindow.getAllWindows()[0];
    menu.items
      .find((item) => item.label === label)
      .click(undefined, window, window.webContents);
    menu.closePopup();
  }, RIGHT);
  system(`wait 800; ${route}`);
  await page.waitForTimeout(500);
  const moved = await page.evaluate(
    (selector) =>
      document.querySelector(selector).editor.state.selection.toJSON().type,
    EDITOR
  );
  console.log("2. selección tras mover el ratón:", moved);
  await page.keyboard.type("x");
  await page.waitForTimeout(300);

  const result = await page.evaluate((selector) => {
    const editor = document.querySelector(selector).editor;
    return {
      selection: editor.state.selection.toJSON().type,
      cells: [...document.querySelectorAll(`${selector} :is(td, th)`)].map(
        (cell) => cell.textContent
      )
    };
  }, EDITOR);
  console.log("3. tras escribir:", JSON.stringify(result));
  assert.notEqual(moved, "cell", "el ratón seleccionó celdas");
  assert.notEqual(result.selection, "cell", "el ratón seleccionó celdas");
  assert.equal(result.cells[0], `${RIGHT}x`);

  console.log(
    "GREEN: en una celda, el clic derecho ofrece la corrección, la aplica, y mover el ratón y escribir siguen editando la celda."
  );
  console.log(`Evidencia: ${profile}`);
} finally {
  await app
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setAlwaysOnTop(false)
    )
    .catch(() => undefined);
  await app.close();
}
