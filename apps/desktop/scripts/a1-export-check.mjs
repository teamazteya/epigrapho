// SPDX-License-Identifier: GPL-3.0-or-later
// Fase 9, punto 8: exports a note holding both kinds of reference — one
// written inline and one inserted as a Scripture Block — and checks the
// passage is still readable in Markdown, plain text and HTML (PRD §31.12).
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Epigrapho 9.8";
const FORMATS = ["md", "txt", "html"];

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-export-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/**
 * Catches the exported file instead of letting it become a download.
 *
 * The app hands the file to `file-saver`, which builds an anchor with a blob
 * behind it and dispatches a click on it. A real click would open the native
 * save dialog and stop the test there, so the click is caught on the
 * prototype and the blob is read straight out of the URL it points at.
 */
const captureDownloads = () =>
  page.evaluate(() => {
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

/** Exports the open note in one format and returns what was written. */
async function exportAs(format) {
  await page.evaluate(() => (globalThis.__exported.length = 0));
  await page
    .getByText(TITLE, { exact: true })
    .first()
    .click({ button: "right" });
  // The submenu opens past the edge of the window, where a real click cannot
  // reach it; the menu answers a dispatched one just the same.
  await page.locator('[data-test-id="menu-button-export"]').click();
  await page
    .locator(`[data-test-id="menu-button-${format}"]`)
    .dispatchEvent("click");
  await page.waitForFunction(
    () => globalThis.__exported.length > 0,
    undefined,
    {
      timeout: 60000
    }
  );
  const file = await page.evaluate(async () => {
    const { name, href } = globalThis.__exported[0];
    return {
      name,
      text: await fetch(href).then((response) => response.text())
    };
  });
  // The export dialog stays up over the app and swallows the next click.
  await page
    .locator('[data-test-id="dialog-yes"]')
    .click({ timeout: 10000 })
    .catch(() => undefined);
  await page
    .locator(".ReactModal__Content")
    .waitFor({ state: "detached", timeout: 20000 })
    .catch(() => undefined);
  return file;
}

try {
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.getByText("Notas", { exact: true }).first().waitFor();

  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.keyboard.type("Hoy leí Romanos 8:28 otra vez.", { delay: 25 });
  await page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .first()
    .waitFor({ timeout: 20000 });

  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  await page
    .locator('[data-test-id="dialog-title"]', {
      hasText: /Insertar Escritura|Insert Scripture/
    })
    .waitFor();
  await page.locator(".ReactModal__Content input").first().fill("Juan 3:16");
  await page.locator('[data-test-id="dialog-yes"]').click();
  await page
    .locator(".active .ProseMirror .scripture-block")
    .waitFor({ timeout: 20000 });
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);

  await captureDownloads();

  const exported = {};
  for (const format of FORMATS) {
    const file = await exportAs(format);
    exported[format] = file.text;
    console.log(`--- ${format} (${file.name}) ---`);
    // The HTML export carries a stylesheet of its own; the note is what this
    // is about, so the log keeps the body and leaves the rest on disk.
    console.log(
      file.text.includes("<body>")
        ? file.text.slice(file.text.indexOf("<body>"))
        : file.text
    );
    assert.equal(file.name, `Epigrapho-9.8.${format}`);
    // The reference written inline keeps the words the person typed, and the
    // one inserted as a block keeps the label it was given: both readable in
    // a file nobody opens with this app.
    assert.ok(
      file.text.includes("Romanos 8:28"),
      `${format}: falta la referencia escrita`
    );
    assert.ok(
      file.text.includes("Juan 3:16"),
      `${format}: falta la referencia del bloque`
    );
    assert.ok(
      file.text.includes("Porque Dios amó al mundo"),
      `${format}: falta el verso`
    );
    assert.ok(
      file.text.includes("VBL — CC BY-SA 4.0"),
      `${format}: falta la atribución`
    );
  }

  // HTML is the only format that carries markup, and it is the one a note
  // could be read back from: there the canonical reference survives too.
  assert.match(exported.html, /data-scripture-ref="ROM\.8\.28"/);
  assert.match(exported.html, /data-scripture-ref="JHN\.3\.16"/);
  console.log("el HTML conserva los refs USFM de la marca y del bloque");

  console.log(
    "GREEN: exportada a Markdown, texto plano y HTML, la nota conserva legibles tanto la referencia escrita como la del bloque, con su verso y su atribución."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
