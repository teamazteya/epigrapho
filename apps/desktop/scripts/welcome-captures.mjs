// SPDX-License-Identifier: GPL-3.0-or-later
// The real captures of the welcome center (A6 Fase 9): the app itself, on a
// new profile with sample notes, in Spanish and in English, saved as WebP in
// apps/web/public/welcome/<es|en>/ for the dialog to show offline. After
// work/mockups/capture-real-app.cjs. Nothing is published and no account is
// used. Run while npm run start:desktop is serving the app on localhost:3000:
// node scripts/welcome-captures.mjs [es|en]
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../web/public/welcome/", import.meta.url));

/** What the app says in each language, where a step looks for it. */
const COPY = {
  es: {
    locale: "es-MX",
    translation: "VBL",
    notes: "Notas",
    backlinks: "Notas sobre el mismo pasaje",
    dictionary: "Diccionario bíblico",
    share: "Compartir",
    plans: "Planes de lectura",
    startPlan: "Empezar el plan",
    appearance: "Apariencia",
    createAccount: "Crear una cuenta",
    template: "Sermón expositivo",
    reference: "Juan 3:16",
    verse: "Porque",
    word: "gracia",
    section: "biblical",
    title: "El amor que permanece",
    body: "<h2>Una lectura sobre el amor</h2><p>Hoy quiero detenerme en lo que este pasaje revela sobre el amor de Dios y nuestra respuesta.</p><h3>Observaciones</h3><ul><li>Dios toma la iniciativa.</li><li>El amor se expresa en lo que da.</li><li>La lectura cobra sentido en su contexto.</li></ul><h3>Para conversar</h3><p>¿Cómo conecta esta lectura con nuestra vida diaria?</p><p>Pasaje principal:</p>",
    other: "Preguntas para el grupo",
    otherBody: "<h2>Preguntas para nuestra conversación</h2><p>¿Qué llama tu atención al leer el pasaje completo?</p><p>¿Cómo explica Juan la relación entre el amor y la vida?</p><p>Vamos a leer juntos:</p>"
  },
  en: {
    locale: "en-US",
    translation: "BSB",
    notes: "Notes",
    backlinks: "Notes on the same passage",
    dictionary: "Bible dictionary",
    share: "Share",
    plans: "Reading plans",
    startPlan: "Start plan",
    appearance: "Appearance",
    createAccount: "Create account",
    template: "Expository sermon",
    reference: "John 3:16",
    verse: "For God",
    word: "grace",
    section: "english",
    title: "Love that remains",
    body: "<h2>A reading on love</h2><p>Today I want to stop at what this passage shows about God's love and our response.</p><h3>Observations</h3><ul><li>God takes the first step.</li><li>Love shows in what it gives.</li><li>The reading makes sense in its context.</li></ul><h3>To talk about</h3><p>How does this reading connect with our daily life?</p><p>Main passage:</p>",
    other: "Questions for the group",
    otherBody: "<h2>Questions for our conversation</h2><p>What stands out to you when you read the whole passage?</p><p>How does John relate love and life?</p><p>Let's read together:</p>"
  }
};

const languages = process.argv[2] ? [process.argv[2]] : ["es", "en"];

async function capture(language) {
  const copy = COPY[language];
  const folder = path.join(output, language);
  await mkdir(folder, { recursive: true });
  const profile = await mkdtemp(path.join(profilesRoot(), `epigrapho-welcome-${language}-`));
  // The spell checker takes the interface language on the first start only,
  // which here is still Spanish: an English profile starts with its own.
  await mkdir(path.join(profile, "UserData"));
  await writeFile(
    path.join(profile, "UserData", "config.json"),
    JSON.stringify({ spellCheckerLanguages: [language] })
  );
  const app = await _electron.launch({
    args: [path.join(root, "build", "electron.js")],
    env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
    timeout: 60000
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => console.error("pageerror:", error.message));

  /** Saves the window, or one part of it, as WebP. */
  async function shot(name, clip) {
    await page.waitForTimeout(400);
    const png = await page.screenshot(clip ? { clip } : {});
    const webp = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      return canvas.toDataURL("image/webp", 0.82).split(",")[1];
    }, png.toString("base64"));
    const file = path.join(folder, `${name}.webp`);
    await writeFile(file, Buffer.from(webp, "base64"));
    console.log(`${language}/${name}.webp`);
  }

  /** The note and the panes beside it, without the lists on the left. */
  async function editorArea() {
    const title = await page.locator('.active [data-test-id="editor-title"]').boundingBox();
    const size = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    const x = Math.max(0, Math.round(title.x - 36));
    return { x, y: 0, width: size.width - x, height: size.height };
  }

  async function element(name, locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await shot(name, {
      x: Math.max(0, box.x - 12),
      y: Math.max(0, box.y - 12),
      width: box.width + 24,
      height: box.height + 24
    });
  }

  const editor = page.locator(".active .ProseMirror");
  const reference = editor.locator('span[data-scripture-ref="JHN.3.16"]').first();

  async function note(title, html) {
    await page.locator('[data-test-id="create-new-note"]').first().click();
    await page.locator('.active [data-test-id="editor-title"]').fill(title);
    await editor.evaluate((element, content) => element.editor.commands.setContent(content), html);
    await editor.click();
    await page.keyboard.press("Control+End");
    // Typed key by key, a busy editor sometimes drops one ("Jon 3:16").
    await page.keyboard.insertText(` ${copy.reference}`);
    await page.keyboard.type(" ");
    await reference.waitFor();
    await page.locator('[data-test-id="editor-save-state-saved"]').waitFor();
  }

  async function openNote(title) {
    await page.locator('[data-test-id="list-item"]').filter({ hasText: title }).first().click();
    await page.locator('.active [data-test-id="editor-title"]').waitFor();
  }

  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1440, 900);
      window.show();
    });
    await page.locator('[data-test-id="create-new-note"]').first().waitFor();
    if (language !== "es") {
      await page.evaluate(({ locale, translation }) => {
        localStorage.setItem("uiLocale", JSON.stringify(locale));
        localStorage.setItem("translation", JSON.stringify(translation));
      }, copy);
      await page.reload();
      await page.getByText(copy.notes, { exact: true }).first().waitFor();
    }

    await note(copy.title, copy.body);
    await note(copy.other, copy.otherBody);
    await openNote(copy.title);
    await shot("01-editor");

    await reference.hover();
    await page.locator('[data-test-id="scripture-popover"]').waitFor();
    await page.waitForFunction(
      (verse) => document.querySelector('[data-test-id="scripture-popover"]')?.textContent?.includes(verse),
      copy.verse
    );
    await shot("02-preview", await editorArea());
    await page.keyboard.press("Escape");
    await page.mouse.move(5, 5);

    // A Scripture block at the end of the note, then two more translations.
    await editor.locator("> p").last().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.locator('[data-test-id="insert-block"]').first().click();
    await page.locator('[data-test-id="menu-button-scripture"]').click();
    await page.locator('[data-test-id="dialog-title"]').waitFor();
    await page.keyboard.type(copy.reference);
    await page.locator('[data-test-id="dialog-yes"]').click();
    const block = editor.locator(".scripture-block").last();
    await block.waitFor();
    await block.scrollIntoViewIfNeeded();
    await shot("02-block", await editorArea());
    for (const translation of ["VBL", "BSB", "KJV"].filter((id) => id !== copy.translation)) {
      await block.locator('[data-scripture-compare="true"]').click();
      await page.locator(`[data-test-id="menu-button-${translation}"]`).click();
    }
    await page.waitForFunction(
      () => document.querySelectorAll(".active .ProseMirror .scripture-block-parallel").length === 2
    );
    await element("03-parallel", block);

    await editor.click();
    await page.keyboard.press("Control+Home");
    await page.getByTitle(copy.backlinks).first().click();
    await page.locator('[data-test-id="backlinks-pane"]').getByText(copy.other, { exact: true }).waitFor();
    await shot("03-related", await editorArea());
    await page.getByTitle(copy.backlinks).first().click();

    await page.locator(`[data-test-id="${copy.dictionary}"]`).click();
    await page.locator('[data-test-id="dictionary-input"]').fill(copy.word);
    await page.locator('[data-test-id="dictionary-input"]').press("Enter");
    await page.waitForTimeout(300);
    await page.waitForFunction(
      () => document.querySelector('[data-test-id="dictionary-pane"]')?.getAttribute("aria-busy") === "false"
    );
    const hit = page
      .locator(`[data-test-id="dictionary-section-${copy.section}"] [data-test-id="dictionary-hit"]`)
      .first();
    await hit.locator("button").first().click();
    await hit.locator('[data-test-id="dictionary-article"]').waitFor();
    await hit.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shot("04-dictionary", await editorArea());
    await page.locator(`[data-test-id="${copy.dictionary}"]`).click();

    await editor.locator("> p").last().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.locator('[data-test-id="insert-block"]').first().click();
    await page.locator('[data-test-id="menu-button-interlinear"]').click();
    await page.locator('[data-test-id="dialog-title"]').waitFor();
    await page.keyboard.type(copy.reference);
    await page.locator('[data-test-id="dialog-yes"]').click();
    const interlinear = editor.locator(".interlinear").last();
    await interlinear.locator(".interlinear-word").first().waitFor();
    await element("05-interlinear", interlinear);
    await interlinear.locator(".interlinear-word").filter({ hasText: "ἠγάπησεν" }).first().click();
    await page.locator('[data-test-id="lexicon-popover"]').waitFor();
    await shot("05-lexicon", await editorArea());
    await page.keyboard.press("Escape");

    await page.locator('[data-test-id="navigation-menu"]').getByText(copy.plans, { exact: true }).click();
    await page.locator('[data-test-id="reading-plan-mcheyne"]').getByText(copy.startPlan).click();
    await page.locator('[data-test-id="reading-day"]').waitFor();
    // The plan and the lists, without the note beside them.
    const plan = await editorArea();
    await shot("06-plan", { x: 0, y: 0, width: plan.x, height: plan.height });

    await page.locator('[data-test-id="navigation-menu"]').getByText(copy.notes, { exact: true }).click();
    await openNote(copy.title);
    await page.locator('[data-test-id="new-note-from-template"]').first().click();
    await page.getByText(copy.template, { exact: true }).first().waitFor();
    await shot("07-templates");
    await page.keyboard.press("Escape");
    await page.locator('[data-test-id="list-item"]').filter({ hasText: copy.title }).first().click({ button: "right" });
    await page.locator('[data-test-id="menu-button-sermon-mode"]').click();
    await page.locator('[data-test-id="sermon-mode"]').waitFor();
    await shot("07-sermon");
    await page.keyboard.press("Escape");
    await page.locator('[data-test-id="sermon-mode"]').waitFor({ state: "detached" });

    await page.evaluate(() => (window.location.hash = "/settings"));
    await page.locator('[data-test-id="settings-navigation-menu"]').getByText(copy.appearance, { exact: true }).click();
    const themes = page.locator('[data-test-id="setting-themes"]');
    await themes.waitFor();
    await themes.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(1500);
    await element("08-themes", page.locator(".ReactModal__Content > *").first());
    await page.keyboard.press("Escape");
    await page.locator(".ReactModal__Content").waitFor({ state: "detached" });
    await page.locator('[data-test-id="list-item"]').filter({ hasText: copy.title }).first().click({ button: "right" });
    await page.locator('[data-test-id="menu-button-export"]').click();
    await page.locator('[data-test-id="menu-button-docx"]').waitFor();
    await shot("08-export");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.locator(`[data-test-id="${copy.share}"]`).click();
    await page.getByText(copy.createAccount, { exact: true }).first().waitFor();
    await shot("09-share", await editorArea());
    await page.keyboard.press("Escape");
  } catch (error) {
    await page.screenshot({ path: path.join(profile, "failure.png") });
    console.error(`Evidencia: ${profile}`);
    throw error;
  } finally {
    await app.close();
  }
}

for (const language of languages) await capture(language);
console.log("Capturas completas, sin cuenta y sin publicar nada.");
