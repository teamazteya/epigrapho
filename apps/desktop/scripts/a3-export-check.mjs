// SPDX-License-Identifier: GPL-3.0-or-later
// A3 Fase 6: the study export to PDF and Word.
//
// Writes a note with a heading, an inline reference, a list and a Scripture
// Block compared in two translations, and checks that:
//   1. the document model has its cover (title, author, date, translations),
//      its blocks, and a note with the full verse for the inline reference;
//   2. the PDF prints on letter and A4 with the cover on its own page, the
//      block's columns side by side and the notes at the end;
//   3. the .docx is a valid package: cover, the block as a two-column table,
//      and a native Word footnote with the verse;
//   4. "Exportar como" offers Word (.docx) next to PDF.
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
const TITLE = "El amor de Dios";
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-export-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

try {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(TITLE);
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const { editor } = document.querySelector(".active .ProseMirror");
    editor.commands.setContent(
      "<h2>Idea central</h2><p>Dios nos amó primero.</p><ul><li><p>Primer punto</p></li><li><p>Segundo punto</p></li></ul><p></p>"
    );
    editor.commands.focus("end");
  });
  await page.keyboard.type("Lo dice Juan 3:16 con claridad.", { delay: 25 });
  await page
    .locator('.active .ProseMirror span[data-scripture-ref="JHN.3.16"]')
    .waitFor({ timeout: 20000 });
  await page.keyboard.press("Enter");
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  await page.keyboard.type("Romanos 8:28");
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

  // ---- 1. the model ----
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
      html: study.studyDocumentHtml(document),
      docx: btoa(binary)
    };
  }, TITLE);
  const { document } = built;
  console.log(
    "1. bloques:",
    document.blocks.map((b) => b.type).join(", "),
    "| traducciones:",
    document.translations.join("; ")
  );
  assert.equal(document.title, TITLE);
  assert.equal(document.author, "Ana Pérez");
  assert.deepEqual(
    document.blocks.map((b) => b.type),
    ["heading", "paragraph", "list", "paragraph", "scripture"]
  );
  assert.equal(document.notes.length, 1);
  assert.equal(document.notes[0].label, "Juan 3:16");
  assert.match(document.notes[0].text, /Porque Dios amó al mundo/);
  const scripture = document.blocks.find((b) => b.type === "scripture");
  assert.equal(scripture.columns.length, 2);
  assert.ok(document.translations.some((t) => t.includes("(VBL)")));
  assert.ok(document.translations.some((t) => t.includes("(BSB)")));

  // ---- 2. the PDF, as Chromium prints it ----
  for (const pageSize of ["Letter", "A4"]) {
    const result = await app.evaluate(
      async ({ BrowserWindow }, { html, pageSize }) => {
        const window = new BrowserWindow({
          show: false,
          width: 900,
          height: 1200
        });
        await window.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
        );
        const layout = await window.webContents.executeJavaScript(`(() => {
          const columns = [...document.querySelectorAll(".scripture .columns > div")]
            .map((c) => Math.round(c.getBoundingClientRect().top));
          return {
            cover: !!document.querySelector(".cover h1"),
            columnsSideBySide: columns.length === 2 && columns[0] === columns[1],
            noteLink: !!document.querySelector('sup.note-ref a[href="#note-1"]'),
            note: document.querySelector("#note-1")?.textContent || ""
          };
        })()`);
        const pdf = await window.webContents.printToPDF({
          pageSize,
          printBackground: true
        });
        window.destroy();
        return { layout, pdf: pdf.toString("base64") };
      },
      { html: built.html, pageSize }
    );
    const pdf = Buffer.from(result.pdf, "base64");
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || [])
      .length;
    await writeFile(path.join(profile, `estudio-${pageSize}.pdf`), pdf);
    console.log(
      `2. PDF ${pageSize}: ${pages} páginas`,
      JSON.stringify(result.layout)
    );
    assert.ok(result.layout.cover && result.layout.columnsSideBySide);
    assert.ok(result.layout.noteLink);
    assert.match(result.layout.note, /Juan 3:16\. .*Porque Dios amó/);
    assert.ok(pages >= 3, "la portada y las notas van en sus propias páginas");
  }

  // ---- 3. the .docx ----
  const docx = Buffer.from(built.docx, "base64");
  await writeFile(path.join(profile, "estudio.docx"), docx);
  const zip = await JSZip.loadAsync(docx);
  const body = await zip.file("word/document.xml").async("string");
  const footnotes = await zip.file("word/footnotes.xml").async("string");
  assert.match(body, /El amor de Dios/);
  assert.match(body, /Ana Pérez/);
  assert.match(body, /<w:footnoteReference w:id="1"\/>/);
  assert.match(body, /<w:tbl>/);
  assert.match(body, /<w:gridSpan w:val="2"\/>/);
  assert.match(footnotes, /Porque Dios amó al mundo/);
  assert.match(body, /Sabemos que en todas las cosas/);
  assert.match(body, /And we know that God works/);
  console.log(
    "3. .docx válido: portada, bloque en tabla de dos columnas y nota al pie nativa"
  );

  // ---- 4. the menu ----
  await page
    .locator('[data-test-id="list-item"]')
    .filter({ hasText: TITLE })
    .first()
    .click({ button: "right" });
  await page.locator('[data-test-id="menu-button-export"]').click();
  await page.locator('[data-test-id="menu-button-docx"]').waitFor();
  await page.locator('[data-test-id="menu-button-pdf"]').waitFor();
  await page.keyboard.press("Escape");
  console.log("4. «Exportar como» ofrece PDF y Word (.docx)");

  console.log(
    "GREEN: el PDF y el .docx salen con portada, bloques comparados y el versículo completo de cada referencia."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
