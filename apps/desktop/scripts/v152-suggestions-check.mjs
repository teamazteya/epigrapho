// SPDX-License-Identifier: GPL-3.0-or-later
// Exercises Electron's real context-menu handler for known misspellings,
// independently of Chromium's asynchronous underline/hit-testing. The worker
// check verifies word classification; this check verifies the menu and HTTP.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import { profilesRoot } from "./profiles-root.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(
  path.join(profilesRoot(), "epigrapho-suggestions-")
);
const words = {
  qe: "que",
  oy: "hoy",
  korazon: "corazón",
  ponia: "ponía",
  jente: "gente",
  ermano: "hermano",
  sielo: "cielo",
  Neftali: "Neftalí",
  aser: "hacer",
  ise: "hice"
};
const app = await _electron.launch({
  args: [path.join(root, "build/electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator(".active .ProseMirror").click();
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    const { desktop } = await import("/common/desktop-bridge/index.desktop.ts");
    await desktop.spellChecker.setLanguages.mutate({ languages: ["es", "en"] });
  });
  for (const [i, word] of Object.keys(words).entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(word, { delay: 20 });
  }
  await page.waitForTimeout(4000);
  assert.equal(
    (await page.locator(".active .ProseMirror").innerText()).replace(
      /\n+/g,
      "\n"
    ),
    Object.keys(words).join("\n")
  );
  let status;
  const deadline = Date.now() + 60000;
  do {
    status = await page.evaluate(async () => {
      const { desktop } = await import(
        "/common/desktop-bridge/index.desktop.ts"
      );
      return (await desktop.grammarChecker.settings.query()).status;
    });
    if (status === "ready" || status === "failed") break;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  assert.equal(
    status,
    "ready",
    "LanguageTool debe estar listo, sin confundir una promesa con un estado"
  );
  await app.evaluate(() => {
    globalThis.__spellingResponses = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const isSpelling =
        String(args[0]).startsWith("http://127.0.0.1:") &&
        String(args[0]).endsWith("/v2/check") &&
        args[1]?.body?.get("enabledOnly") === "true";
      let response;
      try {
        response = await original(...args);
      } catch (error) {
        if (isSpelling)
          globalThis.__spellingResponses.push({
            word: args[1].body.get("text"),
            error: error.message
          });
        throw error;
      }
      if (
        String(args[0]).startsWith("http://127.0.0.1:") &&
        String(args[0]).endsWith("/v2/check") &&
        args[1]?.body?.get("enabledOnly") === "true"
      ) {
        const result = await response.clone().json();
        globalThis.__spellingResponses.push({
          word: args[1].body.get("text"),
          status: response.status,
          matches: result.matches?.map((match) => ({
            id: match.rule.id,
            offset: match.offset,
            length: match.length,
            values: match.replacements.map((item) => item.value)
          }))
        });
      }
      return response;
    };
  });
  async function menuFor(word) {
    return app.evaluate(
      ({ Menu, BrowserWindow }, word) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("No se construyó el menú")),
            10000
          );
          const popup = Menu.prototype.popup;
          Menu.prototype.popup = function () {
            clearTimeout(timer);
            Menu.prototype.popup = popup;
            resolve(
              this.items.map((item) => ({
                label: item.label,
                type: item.type,
                checked: item.checked
              }))
            );
          };
          BrowserWindow.getAllWindows()[0].webContents.emit(
            "context-menu",
            {},
            {
              misspelledWord: word,
              dictionarySuggestions: [],
              isEditable: true,
              linkURL: "",
              linkText: "",
              selectionText: "",
              mediaType: "none",
              x: 0,
              y: 0
            }
          );
        }),
      word
    );
  }
  for (const enabled of [true, false]) {
    if (!enabled)
      await page.evaluate(async () => {
        const { desktop } = await import(
          "/common/desktop-bridge/index.desktop.ts"
        );
        await desktop.grammarChecker.toggle.mutate({ enabled: false });
      });
    for (const [word, expected] of Object.entries(words)) {
      const items = await menuFor(word);
      // The first group ends with Add, Ignore once and Ignore in this note.
      const end = items.findIndex((item) => item.type === "separator") - 3;
      assert.ok(
        end > 0,
        `${word}: no se marcó como errata; ${JSON.stringify(items)}`
      );
      const suggestions = items.slice(0, end).map((item) => item.label);
      console.log(
        `${enabled ? "LanguageTool" : "respaldo"} ${word}: ${suggestions.join(
          ", "
        )}`
      );
      assert.ok(suggestions.length <= 5);
      assert.equal(suggestions[0], expected);
    }
    if (enabled) {
      const responses = await app.evaluate(
        () => globalThis.__spellingResponses
      );
      console.log(
        "LanguageTool HTTP: verificada respuesta real para korazon → corazón."
      );
      assert.ok(
        responses.some(
          (response) =>
            response.word === "korazon" &&
            response.matches?.some((match) => match.values.includes("corazón"))
        ),
        "El menú no recibió corazón desde LanguageTool"
      );
    }
  }
  assert.equal(
    (await page.locator(".active .ProseMirror").innerText()).replace(
      /\n+/g,
      "\n"
    ),
    Object.keys(words).join("\n")
  );
  console.log(
    "GREEN: menú real, LanguageTool local y respaldo nspell; máximo cinco sin autocorrección."
  );
} finally {
  await app.close();
}
