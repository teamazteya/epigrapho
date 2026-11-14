// SPDX-License-Identifier: GPL-3.0-or-later
// A7 Fase 6: section titles in every export.
//
// Writes a note with a Scripture Block of Juan 3:16-18 in VBL, compared with
// BSB, and exports it to Markdown, text, PDF and Word. Checks that:
//   1. the block carries its titles: VBL's borrowed from PdDpt, with the
//      credit "Títulos: PdDpt", and BSB's own;
//   2. Markdown and text put each title on its own line, never as "#";
//   3. the PDF HTML styles the titles and prints;
//   4. the .docx has the titles in bold or italics, no paragraph uses
//      Heading1/Heading2, and the credit is there;
//   5. "[§" appears nowhere.
// The PDF and the .docx stay in the profile folder, to open by hand.
//
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const JSZip = createRequire(new URL("../../web/package.json", import.meta.url))(
  "jszip"
);
const root = fileURLToPath(new URL("../", import.meta.url));
const TITLE = "Estudio A7";
const VBL_TITLE = "El amor de Dios";
const profile = await mkdtemp(
  path.join(profilesRoot(), "epigrapho-a7-export-")
);
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

/** Catches file-saver's download instead of opening the save dialog. */
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

async function exportAs(format) {
  await page.evaluate(() => (globalThis.__exported.length = 0));
  await page
    .locator('[data-test-id="list-item"]')
    .filter({ hasText: TITLE })
    .first()
    .click({ button: "right" });
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
  const text = await page.evaluate(async () =>
    fetch(globalThis.__exported[0].href).then((response) => response.text())
  );
  await page
    .locator('[data-test-id="dialog-yes"]')
    .click({ timeout: 10000 })
    .catch(() => undefined);
  await page
    .locator(".ReactModal__Content")
    .waitFor({ state: "detached", timeout: 20000 })
    .catch(() => undefined);
  return text;
}

try {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  await page.keyboard.type("Juan 3:16-18");
  await page.locator('[data-test-id="dialog-yes"]').click();
  const block = page.locator(".active .ProseMirror .scripture-block");
  await block.waitFor();
  await block.locator('[data-scripture-compare="true"]').click();
  await page.locator('[data-test-id="menu-button-BSB"]').click();
  await block.locator(".scripture-block-parallel").waitFor();
  await page
    .locator('[data-test-id="editor-save-state-notsaved"]')
    .waitFor({ timeout: 5000 })
    .catch(() => undefined);
  await page.locator('[data-test-id="editor-save-state-saved"]').waitFor();
  await page.waitForTimeout(1500);

  // ---- 1. the block ----
  const built = await page.evaluate(async (title) => {
    const { db } = await import("/common/db.ts");
    const study = await import("/common/study-export.ts");
    const note = (await db.notes.all.items()).find((n) => n.title === title);
    const document = await study.buildStudyDocument(note, "Ana Pérez");
    const docx = await study.studyDocumentDocx(document);
    const bytes = new Uint8Array(await docx.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return {
      document,
      html: study.studyDocumentHtml(document, await study.studyPdfFonts()),
      docx: btoa(binary)
    };
  }, TITLE);
  const scripture = built.document.blocks.find((b) => b.type === "scripture");
  const [vbl, bsb] = scripture.columns;
  console.log("1. VBL:", JSON.stringify(vbl.text.split("\n").slice(0, 2)));
  console.log("   BSB:", JSON.stringify(bsb.text.split("\n").slice(0, 2)));
  assert.ok(vbl.text.startsWith(`[§s1] ${VBL_TITLE}\n[16] `), vbl.text);
  assert.match(vbl.attribution, /Títulos: PdDpt/);
  assert.match(bsb.text, /^\[§s1\] .+\n\[16\] /);
  assert.doesNotMatch(bsb.attribution, /Títulos|Headings/);
  const bsbTitle = bsb.text.match(/^\[§s1\] (.+)$/m)[1];

  // ---- 2. Markdown and text ----
  await captureDownloads();
  for (const format of ["md", "txt"]) {
    const text = await exportAs(format);
    console.log(`2. ${format}:`, JSON.stringify(text.slice(0, 300)));
    assert.match(
      text,
      new RegExp(`(^|\\n|>)\\s*(\\*\\*|<strong>)?${VBL_TITLE}`)
    );
    assert.ok(text.includes(bsbTitle), `${format}: falta el título de BSB`);
    assert.ok(text.includes("Títulos: PdDpt"), `${format}: falta el crédito`);
    assert.doesNotMatch(text, /^#+ .*(El amor de Dios|Títulos)/m);
    assert.ok(!text.includes("[§"), `${format}: quedó una marca [§`);
  }

  // ---- 3. the PDF ----
  assert.ok(!built.html.includes("[§"));
  const result = await app.evaluate(async ({ BrowserWindow }, html) => {
    const window = new BrowserWindow({ show: false, width: 900, height: 1200 });
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    );
    const styles = await window.webContents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        const style = (kind) => {
          const element = document.querySelector(".verse-heading-" + kind);
          if (!element) return null;
          const computed = getComputedStyle(element);
          return { text: element.textContent, weight: computed.fontWeight, italic: computed.fontStyle };
        };
        // The embedded faces, not system fallbacks, are what was laid out.
        const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
        return { s1: style("s1"), credit: document.body.textContent.includes("Títulos: PdDpt"), loaded: [...new Set(loaded)] };
      })()`);
    const shot = await window.webContents.capturePage();
    const pdf = await window.webContents.printToPDF({ printBackground: true });
    window.destroy();
    return {
      styles,
      pdf: pdf.toString("base64"),
      shot: shot.toPNG().toString("base64")
    };
  }, built.html);
  await writeFile(
    path.join(profile, "titulos.pdf"),
    Buffer.from(result.pdf, "base64")
  );
  await writeFile(
    path.join(profile, "titulos.png"),
    Buffer.from(result.shot, "base64")
  );
  console.log("3. PDF:", JSON.stringify(result.styles));
  for (const family of [
    "Source Sans 3",
    "Source Serif 4",
    "Cormorant Garamond"
  ])
    assert.ok(result.styles.loaded.includes(family), `no cargó ${family}`);
  assert.equal(result.styles.s1.text, VBL_TITLE);
  assert.ok(Number(result.styles.s1.weight) >= 600, "s1 va en negrita");
  assert.ok(result.styles.credit);

  // ---- 4. the .docx ----
  const docx = Buffer.from(built.docx, "base64");
  await writeFile(path.join(profile, "titulos.docx"), docx);
  const zip = await JSZip.loadAsync(docx);
  const body = await zip.file("word/document.xml").async("string");
  const run = (text) =>
    body.match(
      new RegExp(
        `<w:r>(?:(?!<w:r>).)*?>${text.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )}</w:t>`
      )
    )?.[0] ?? "";
  assert.match(run(VBL_TITLE), /<w:b\/>/, "el título va en negrita");
  assert.match(run(bsbTitle), /<w:b\/>/);
  assert.doesNotMatch(body, /w:pStyle w:val="Heading/);
  assert.match(body, /Títulos: PdDpt/);
  assert.ok(!body.includes("[§"));
  console.log("4. .docx: títulos en negrita, sin estilos Heading, con crédito");

  console.log(
    "GREEN: los títulos salen en Markdown, texto, PDF y Word, con su estilo y su crédito."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
