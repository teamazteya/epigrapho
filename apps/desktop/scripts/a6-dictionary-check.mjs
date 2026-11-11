// SPDX-License-Identifier: GPL-3.0-or-later
// The dictionary screen (A6 Fase 7): the hits come in three sections
// (Biblical, General Spanish, English); a General Spanish entry and an empty
// search offer the DLE in the browser; a failed search says so; the blocks
// of A2 still read, the new WIKT and EASES ones too, and a WIKT lemma the
// weekly copy dropped keeps its term with a link to Wiktionary; an export
// carries their words; and the interface in English names the sections.
// Run while npm run start:desktop is serving the app on localhost:3000 (a
// release build strips the data-test-ids): node scripts/a6-dictionary-check.mjs
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

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-a6-dictionary-"));
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

// The links go to the browser through shell.openExternal: record them instead.
await app.evaluate(({ shell }) => {
  globalThis.__opened = [];
  shell.openExternal = async (url) => void globalThis.__opened.push(url);
});
const opened = () => app.evaluate(() => globalThis.__opened);

const PANE = '[data-test-id="dictionary-pane"]';

async function search(query) {
  await page.locator('[data-test-id="dictionary-input"]').fill(query);
  await page.locator('[data-test-id="dictionary-input"]').press("Enter");
  // Right after Enter the pane still shows the last search, not busy.
  await page.waitForTimeout(300);
  await page.waitForFunction(
    (pane) => document.querySelector(pane)?.getAttribute("aria-busy") === "false",
    PANE
  );
}

/** The sections on screen, each with its heading and the ids of its hits. */
const sections = () =>
  page.evaluate((pane) =>
    [...document.querySelectorAll(`${pane} [data-test-id^="dictionary-section-"]`)].map(
      (section) => ({
        section: section.getAttribute("data-test-id").replace("dictionary-section-", ""),
        heading: section.querySelector("h3").textContent,
        ids: [...section.querySelectorAll('[data-test-id="dictionary-hit"]')].map(
          (hit) => hit.getAttribute("data-entry-id")
        )
      })
    ),
  PANE);

async function chooseLanguage(locale) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  await page.locator(".ReactModal__Content").waitFor();
  await page.locator('[data-test-id="settings-search"]').fill("appearance");
  const select = page.locator('[data-test-id="setting-ui-language"] select');
  await select.waitFor();
  await select.selectOption(locale);
  await page.waitForLoadState("load");
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  await page.evaluate(() => (window.location.hash = "/")).catch(() => undefined);
  const modal = page.locator(".ReactModal__Content");
  if (await modal.isVisible().catch(() => false)) await modal.press("Escape");
  await modal.waitFor({ state: "detached" });
}

try {
  await page.getByText("Notas", { exact: true }).first().waitFor();
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill("Diccionario A6");
  await page.locator(".active .ProseMirror").click();
  await page.keyboard.type("Notas sobre la gracia.");
  await page.locator('[data-test-id="Diccionario bíblico"]').click();
  await page.locator(PANE).waitFor();

  // 1. A search that cannot read the dictionaries says so. The packs are
  //    read on the first search, so this one goes first.
  await page.evaluate(() => {
    globalThis.__fetch = window.fetch;
    window.fetch = () => Promise.reject(new TypeError("sin red"));
    globalThis.__xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      throw new TypeError("sin red");
    };
  });
  await search("gracia");
  const failed = await page.locator(`${PANE} [data-test-id="dictionary-error"]`).innerText();
  assert.equal(failed, "No se pudo buscar en los diccionarios. Inténtalo de nuevo.");
  await page.evaluate(() => {
    window.fetch = globalThis.__fetch;
    XMLHttpRequest.prototype.open = globalThis.__xhrOpen;
  });
  console.log("1. una búsqueda que falla lo dice:", failed);

  // 2. The sections, in order: "Abraham" has all three; "gracia" has no
  //    English entry (Easton files it under "grace"), and Wiktionary's goes
  //    under General Spanish.
  const brief = (found) =>
    JSON.stringify(found.map(({ section, heading, ids }) => [section, heading, ids.slice(0, 4)]));
  await search("Abraham");
  const all = await sections();
  console.log("2. Abraham:", brief(all));
  assert.deepEqual(
    all.map(({ heading }) => heading),
    ["Bíblico", "Español general", "Inglés"]
  );
  assert.ok(all[0].ids.includes("TW:names/abraham"));
  assert.ok(all[2].ids.includes("EAS:abraham"));
  assert.ok(all[2].ids.every((id) => /^(EAS|SMI|HIT):/.test(id)));
  await search("gracia");
  const grace = await sections();
  console.log("   gracia:", brief(grace));
  assert.deepEqual(
    grace.map(({ section }) => section),
    ["biblical", "spanish"]
  );
  assert.ok(grace[1].ids.includes("WIKT:gracia"));
  assert.ok(grace[0].ids.includes("TW:kt/grace"));

  // 3. Opened, a General Spanish entry offers the DLE; a biblical one not.
  await page.locator(`${PANE} [data-entry-id="WIKT:gracia"] button`).first().click();
  const wikt = page.locator(`${PANE} [data-entry-id="WIKT:gracia"]`);
  assert.match(await wikt.locator('[data-test-id="dictionary-article"]').innerText(), /^Sustantivo femenino\n1\. /);
  const dle = wikt.locator('[data-test-id="dictionary-dle"]');
  assert.equal(await dle.innerText(), "Ver en el DLE (RAE)");
  assert.equal(await dle.getAttribute("href"), "https://dle.rae.es/gracia");
  await dle.click();
  await page.waitForTimeout(1000);
  assert.deepEqual(await opened(), ["https://dle.rae.es/gracia"]);
  await page.locator(`${PANE} [data-entry-id="TW:kt/grace"] button`).first().click();
  assert.equal(
    await page.locator(`${PANE} [data-entry-id="TW:kt/grace"] [data-test-id="dictionary-dle"]`).count(),
    0
  );
  console.log("3. Wikcionario abre el DLE en el navegador:", (await opened())[0]);

  // 4. An empty search offers the DLE with the word.
  await search("zzqxv");
  assert.match(await page.locator(`${PANE} [data-test-id="dictionary-empty"]`).innerText(), /zzqxv/);
  assert.equal(
    await page.locator(`${PANE} [data-test-id="dictionary-dle"]`).getAttribute("href"),
    "https://dle.rae.es/zzqxv"
  );
  console.log("4. sin resultados: el DLE con la palabra");

  // 5. The blocks: A2's still read, the new ones too, and a dropped lemma
  //    keeps its term with a link to Wiktionary.
  await page.locator('[data-test-id="Diccionario bíblico"]').click();
  await page.locator(PANE).waitFor({ state: "detached" });
  const blocks = ["EAS:bethel", "TW:kt/grace", "RAND:betel", "WIKT:amar", "EASES:accho", "WIKT:zzqxv"];
  await page.evaluate((ids) => {
    const editor = document.querySelector(".active .ProseMirror").editor;
    editor.commands.setContent(
      "<p>Notas sobre la gracia.</p>" +
        ids
          .map(
            (id) =>
              `<div data-dictionary-entry="${id}"><p class="dictionary-entry-term">${id.split(":")[1]}</p></div>`
          )
          .join(""),
      true
    );
  }, blocks);
  const block = (id) => page.locator(`.active .ProseMirror [data-dictionary-entry="${id}"]`);
  for (const id of blocks.slice(0, 5))
    await block(id).locator(".dictionary-entry-credit").filter({ hasText: /\S/ }).waitFor();
  const shown = {};
  for (const id of blocks) shown[id] = await block(id).innerText();
  for (const [id, text] of Object.entries(shown))
    console.log("   ", id, "|", text.slice(0, 110).replace(/\n+/g, " | "));
  assert.match(shown["EAS:bethel"], /House of God/);
  assert.match(shown["TW:kt/grace"], /gracia/i);
  assert.match(shown["RAND:betel"], /casa de Dios/);
  assert.match(shown["WIKT:amar"], /Wikcionario/);
  assert.match(shown["EASES:accho"], /Aco/);
  await block("WIKT:zzqxv").locator("a").waitFor();
  assert.match(shown["WIKT:zzqxv"] = await block("WIKT:zzqxv").innerText(), /^zzqxv\n+Ya no está en Wikcionario\./);
  const wiktLink = block("WIKT:zzqxv").locator("a");
  assert.equal(await wiktLink.innerText(), "Abrir en Wikcionario");
  assert.equal(await wiktLink.getAttribute("href"), "https://es.wiktionary.org/wiki/zzqxv");
  await wiktLink.click();
  await page.waitForTimeout(1000);
  assert.equal((await opened()).at(-1), "https://es.wiktionary.org/wiki/zzqxv");
  const html = await page.evaluate(() => document.querySelector(".active .ProseMirror").editor.getHTML());
  assert.doesNotMatch(html, /House of God|Ya no está/);
  await page.screenshot({ path: path.join(profile, "bloques.png") });
  console.log("5. los bloques de A2 y los nuevos se leen; el lema que ya no está lleva a Wikcionario");

  // 6. An export carries the words of the new blocks.
  await page.locator('[data-test-id="editor-save-state-saved"]').waitFor({ timeout: 30000 });
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
  await page.getByText("Diccionario A6", { exact: true }).first().click({ button: "right" });
  await page.locator('[data-test-id="menu-button-export"]').click();
  await page.locator('[data-test-id="menu-button-md"]').dispatchEvent("click");
  await page.waitForFunction(() => globalThis.__exported.length > 0, undefined, { timeout: 60000 });
  const markdown = await page.evaluate(() =>
    fetch(globalThis.__exported[0].href).then((response) => response.text())
  );
  const amar = shown["WIKT:amar"].split("\n").filter(Boolean)[2];
  const accho = shown["EASES:accho"].split("\n").filter(Boolean)[2];
  assert.ok(markdown.includes(amar.slice(0, 40)), "el md no lleva amar");
  assert.ok(markdown.includes(accho.slice(0, 40)), "el md no lleva Aco");
  // The PDF is Chromium printing the study's HTML; the .docx is its own build.
  const study = await page.evaluate(async () => {
    const { db } = await import("/common/db.ts");
    const study = await import("/common/study-export.ts");
    const note = (await db.notes.all.items()).find((n) => n.title === "Diccionario A6");
    const document = await study.buildStudyDocument(note, "Ana Pérez");
    const bytes = new Uint8Array(await (await study.studyDocumentDocx(document)).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { html: study.studyDocumentHtml(document), docx: btoa(binary) };
  });
  const docx = Buffer.from(study.docx, "base64");
  await writeFile(path.join(profile, "diccionario.docx"), docx);
  const word = await (await JSZip.loadAsync(docx)).file("word/document.xml").async("string");
  const pdf = await app.evaluate(async ({ BrowserWindow }, html) => {
    const window = new BrowserWindow({ show: false });
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const text = await window.webContents.executeJavaScript("document.body.innerText");
    const pdf = await window.webContents.printToPDF({ pageSize: "Letter" });
    window.destroy();
    return { text, pdf: pdf.toString("base64") };
  }, study.html);
  await writeFile(path.join(profile, "diccionario.pdf"), Buffer.from(pdf.pdf, "base64"));
  const firstWords = (text) => text.slice(0, 30).replace(/[«»"&<>]/g, "").trim();
  for (const text of [amar, accho]) {
    assert.ok(word.includes(firstWords(text)), `el .docx no lleva «${firstWords(text)}»`);
    assert.ok(pdf.text.includes(firstWords(text)), `el PDF no lleva «${firstWords(text)}»`);
  }
  console.log("6. md, .docx y PDF llevan amar (Wikcionario) y Aco (Easton en español)");

  // 7. In English, the sections and the link are named in English.
  await chooseLanguage("en-US");
  await page.getByText("Diccionario A6", { exact: true }).first().click();
  await page.locator('[data-test-id="Bible dictionary"]').click();
  await page.locator(PANE).waitFor();
  await search("Abraham");
  const english = await sections();
  assert.deepEqual(
    english.map(({ heading }) => heading),
    ["Biblical", "General Spanish", "English"]
  );
  await page
    .locator(`${PANE} [data-test-id="dictionary-section-spanish"] [data-test-id="dictionary-hit"] button`)
    .first()
    .click();
  assert.equal(
    await page.locator(`${PANE} [data-test-id="dictionary-dle"]`).innerText(),
    "View in the DLE (RAE)"
  );
  console.log("7. en inglés:", english.map(({ heading }) => heading).join(" / "));

  console.log(
    "GREEN: tres secciones, el DLE en el navegador, el error se dice, los bloques viejos y nuevos se leen, el lema que falta lleva a Wikcionario y el export lleva el texto."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
