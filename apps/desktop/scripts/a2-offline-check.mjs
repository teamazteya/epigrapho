// SPDX-License-Identifier: GPL-3.0-or-later
// A2 Fase 8: with the network cut, the release bundle still has every study
// tool. The interlinear, the lexicon, the concordance, both dictionaries and
// the grammar checker are served from inside the app (and LanguageTool from
// 127.0.0.1); anything that tries the internet is refused and reported.
//
// Like a1-release-smoke it runs against the bundle that goes in the
// installer, which carries no data-test-id: it goes by the words on screen,
// the titles of the buttons and the editor's own classes.
//
// Run after: node apps/desktop/scripts/build.mjs (and, for the packaged app,
// electron-builder --dir with EPIGRAPHO_EXE set).
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-offline-"));

// EPIGRAPHO_EXE points it at a packaged app instead (output/win-unpacked/
// Epigrapho.exe), which is where LanguageTool and the packs really live.
const app = await _electron.launch({
  ...(process.env.EPIGRAPHO_EXE
    ? { executablePath: process.env.EPIGRAPHO_EXE, args: [] }
    : { args: [path.join(root, "build", "electron.js")] }),
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile, ELECTRON_IS_DEV: "0" },
  timeout: 60000
});
const page = await app.firstWindow();
page.setDefaultTimeout(90000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

// The network is cut for the page: only the app's own origin answers.
const refused = [];
await page.context().route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (!url.protocol.startsWith("http") || url.hostname === "app.epigrapho.local")
    return route.continue();
  refused.push(url.href);
  return route.abort("internetdisconnected");
});

const run = (script, arg) => page.evaluate(script, arg);

try {
  await page.getByText("Notas", { exact: true }).first().waitFor();
  await page.keyboard.press("Control+n");
  const editor = page.locator(".ProseMirror").first();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type("¿Que hora es?", { delay: 20 });

  // 1. Grammar: LanguageTool marks the missing accent.
  const mark = page.locator(".ProseMirror .grammar-error").first();
  await mark.waitFor({ timeout: 120000 });
  assert.equal(await mark.innerText(), "Que");
  console.log("1. corrector gramatical: marca «Que»");

  // 2. Interlinear, inserted with the editor's own command (the "+" menu is
  //    what a2-interlinear-check drives).
  await run(() => {
    const view = document.querySelector(".ProseMirror");
    view.editor.chain().focus("end").insertInterlinear({ ref: "JHN.3.16", label: "Juan 3:16" }).run();
  });
  const loved = page.locator(".interlinear-word", { hasText: "ἠγάπησεν" });
  await loved.waitFor();
  const column = await loved.innerText();
  assert.match(column, /G25/);
  assert.match(column, /amó/);
  console.log("2. interlineal:", column.replace(/\n/g, " · "));

  // 3. Lexicon.
  await loved.click();
  const lexicon = page.locator('[data-test-id="lexicon-popover"]');
  await lexicon.locator(".lexicon-strong").waitFor();
  const usage = await lexicon.locator(".lexicon-usage").innerText();
  assert.match(usage, /Uso en RV1909/);
  console.log("3. léxico:", usage.slice(0, 70));

  // 4. Concordance, from the lexicon.
  await lexicon.getByText("Ver todas las apariciones").click();
  const total = page.getByText(/apariciones según STEPBible TAGNT/);
  await total.waitFor();
  assert.equal(await total.innerText(), "143 apariciones según STEPBible TAGNT");
  console.log("4. concordancia:", await total.innerText());

  // 5. Both dictionaries, from the action bar.
  await page.locator('button[title="Diccionario bíblico"]').click();
  const search = page.getByPlaceholder("Busca un término");
  for (const [term, expected] of [
    ["Betel", "Diccionario de la Santa Biblia (Rand, 1890)"],
    ["Betel", "Palabras de Traducción (es-419)"],
    ["Bethel", "Easton's Bible Dictionary (1897)"]
  ]) {
    await search.fill(term);
    await search.press("Enter");
    await page.getByText(expected).first().waitFor();
    console.log(`5. diccionario: «${term}» → ${expected}`);
  }

  console.log("peticiones rechazadas:", JSON.stringify(refused));
  console.log(
    "GREEN: sin red, el bundle de la release corrige la gramática y muestra el interlineal, el léxico, la concordancia y los dos diccionarios."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app.close();
}
