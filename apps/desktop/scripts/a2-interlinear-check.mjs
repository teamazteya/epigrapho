// SPDX-License-Identifier: GPL-3.0-or-later
// The interlinear block (A2 Pasos 2.5, 3.1 and 3.2): "Juan 3:16" goes in from
// the "+" menu and keeps only its reference in the note; Greek reads left to
// right and Hebrew right to left; the toggles hide rows without touching the
// note; more than ten verses is refused; with the outside network cut the
// words still come, and inserting John downloads John alone.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const profile = await mkdtemp(
  path.join(profilesRoot(), "epigrapho-interlinear-")
);
const app = await _electron.launch({
  args: [path.join(root, "build", "electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

// The network is cut: anything that is not the app itself fails.
const outside = [];
const packs = [];
await page.context().route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === "localhost" || url.protocol !== "http:" && url.protocol !== "https:") {
    if (url.pathname.startsWith("/original/")) packs.push(url.pathname);
    return route.continue();
  }
  outside.push(url.href);
  return route.abort("internetdisconnected");
});

const BLOCK = ".active .ProseMirror .interlinear";
const editorHtml = () =>
  page.evaluate(() =>
    document.querySelector(".active .ProseMirror").editor.getHTML()
  );

/** Inserts an interlinear for `input` through the "+" menu. */
async function insert(input) {
  // The last paragraph: a click on a block would select it, and the insert
  // would replace it.
  await page.locator(".active .ProseMirror > p").last().click();
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-interlinear"]').click();
  await page
    .locator('[data-test-id="dialog-title"]', { hasText: "Insertar interlineal" })
    .waitFor();
  await page.keyboard.type(input);
  await page.locator('[data-test-id="dialog-yes"]').click();
}

/** The words of the nth block, in the order they sit on screen. */
const columns = (n) =>
  page.evaluate(
    ({ BLOCK, n }) => {
      const block = document.querySelectorAll(BLOCK)[n];
      const words = [...block.querySelectorAll(".interlinear-word")];
      const body = block.querySelector(".interlinear-body");
      return {
        dir: getComputedStyle(body).direction,
        // Left edge on screen, so the order is what a reader sees.
        onScreen: words
          .map((word) => ({
            surface: word.querySelector(".interlinear-surface").textContent,
            lang: word.querySelector(".interlinear-surface").lang,
            x: word.getBoundingClientRect().left,
            y: Math.round(word.getBoundingClientRect().top)
          }))
          .filter((word, _, all) => word.y === all[0].y)
          .sort((a, b) => a.x - b.x),
        first: words[0] && {
          surface: words[0].querySelector(".interlinear-surface").textContent,
          transliteration: words[0].querySelector(".interlinear-transliteration")
            .textContent,
          strong: words[0].querySelector(".interlinear-strong").textContent,
          morph: words[0].querySelector(".interlinear-morph").textContent,
          gloss: words[0].querySelector(".interlinear-gloss").textContent
        },
        count: words.length,
        credit: block.querySelector(".interlinear-credit").textContent
      };
    },
    { BLOCK, n }
  );

try {
  await page.getByText("Notas", { exact: true }).first().waitFor();
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill("Interlineal");

  // 1. John 3:16: 25 Greek words, left to right, with every row.
  await insert("Juan 3:16");
  await page.locator(`${BLOCK} .interlinear-word`).first().waitFor();
  const john = await columns(0);
  console.log("Juan 3:16:", JSON.stringify({ ...john, onScreen: john.onScreen.map((w) => w.surface) }));
  assert.equal(john.count, 25);
  assert.equal(john.dir, "ltr");
  assert.equal(john.onScreen[0].surface, "οὕτως");
  assert.equal(john.onScreen[0].lang, "grc");
  assert.match(john.credit, /STEP Bible/);
  const loved = await page
    .locator(`${BLOCK} .interlinear-word`, { hasText: "ἠγάπησεν" })
    .innerText();
  console.log("ἠγάπησεν:", JSON.stringify(loved));
  assert.match(loved, /G25/);
  assert.match(loved, /V-AAI-3S/);
  assert.match(loved, /amó/);

  // 2. The note keeps the reference and nothing Greek.
  const html = await editorHtml();
  console.log("HTML de la nota:", html.match(/<div[^>]*interlinear[^>]*>.*?<\/div>/)?.[0]);
  assert.match(html, /data-interlinear-ref="JHN\.3\.16"/);
  assert.doesNotMatch(html, /[Ͱ-Ͽἀ-῿]/);

  // 3. The toggles hide rows and leave the note as it was.
  const toggle = page.locator(`${BLOCK} .interlinear-toggle[data-row="transliteration"]`).first();
  await toggle.click();
  const hidden = await page
    .locator(`${BLOCK} .interlinear-transliteration`)
    .first()
    .isVisible();
  assert.equal(hidden, false);
  assert.equal(await editorHtml(), html);
  await toggle.click();
  assert.equal(
    await page.locator(`${BLOCK} .interlinear-transliteration`).first().isVisible(),
    true
  );
  const packsAfterJohn = [...packs];
  console.log("paquetes pedidos:", JSON.stringify(packsAfterJohn));
  assert.deepEqual(packsAfterJohn, ["/original/JHN.json"]);

  // 4. More than ten verses is refused, with the reason.
  await insert("Juan 3:1-20");
  const toast = await page.locator('[data-test-id="toast"]').first().innerText();
  console.log("aviso:", toast);
  assert.match(toast, /más de 10/);
  assert.equal(await page.locator(BLOCK).count(), 1);

  // 5. Genesis 1:1 reads right to left, בְּרֵאשִׁית rightmost.
  await insert("Génesis 1:1");
  await page.locator(BLOCK).nth(1).locator(".interlinear-word").first().waitFor();
  const genesis = await columns(1);
  console.log("Génesis 1:1:", JSON.stringify({ dir: genesis.dir, onScreen: genesis.onScreen.map((w) => w.surface) }));
  assert.equal(genesis.dir, "rtl");
  assert.equal(genesis.onScreen.at(-1).surface, "בְּרֵאשִׁית".normalize("NFC"));
  assert.equal(genesis.onScreen.at(-1).lang, "he");

  await page.screenshot({ path: path.join(profile, "interlineal.png") });

  // 6. Exported, the block becomes a table with the words generated
  //    (Paso 3.3): Markdown and HTML carry ἠγάπησεν and G25.
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
  for (const format of ["md", "html"]) {
    await page.evaluate(() => (globalThis.__exported.length = 0));
    await page
      .getByText("Interlineal", { exact: true })
      .first()
      .click({ button: "right" });
    await page.locator('[data-test-id="menu-button-export"]').click();
    await page
      .locator(`[data-test-id="menu-button-${format}"]`)
      .dispatchEvent("click");
    await page.waitForFunction(() => globalThis.__exported.length > 0, undefined, {
      timeout: 60000
    });
    const text = await page.evaluate(() =>
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
    const line = text.split("\n").find((row) => row.includes("ἠγάπησεν"));
    console.log(`${format}:`, line?.slice(0, 200));
    assert.ok(text.includes("ἠγάπησεν"), `${format} sin ἠγάπησεν`);
    assert.ok(text.includes("G25"), `${format} sin G25`);
    assert.ok(text.includes("בְּרֵאשִׁית".normalize("NFC")), `${format} sin el hebreo`);
  }

  console.log("peticiones fuera:", JSON.stringify(outside));
  console.log(
    "GREEN: el interlineal se inserta desde +, guarda solo la referencia, lee en su dirección, los toggles no tocan la nota, rechaza más de 10 versículos y funciona sin red cargando solo el libro usado."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
