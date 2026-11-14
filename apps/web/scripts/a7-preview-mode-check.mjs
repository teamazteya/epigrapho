/*
 * Epigrapho A7, Fase 7: the "Vista previa de versículos" setting
 * (Epigrapho_A7_Agent_Runbook.md). With a mouse, it walks the three modes,
 * changed in Settings with the note open:
 *   hover:  pointing opens the box; a click opens no panel.
 *   inline: a click opens and closes the panel; pointing and the caret open
 *           nothing.
 *   both:   pointing opens the box; a click opens the panel and leaves the box
 *           closed; the caret moved with the keyboard opens the box.
 * On a touch screen the setting is not there and a tap opens the panel.
 *
 * Runs against a production build (no data-test-id), so it goes by class.
 *
 *   node scripts/a7-preview-mode-check.mjs [http://localhost:4176]
 */
import { chromium, devices } from "playwright";

const site = (process.argv[2] || "http://localhost:4176").replace(/\/$/, "");
const REF = 'span[data-scripture-ref="JHN.3.16"]';
const PANEL = ".scripture-inline-preview";
const POPOVER = ".scripture-popover";
const SETTING = 'select:has(option[value="both"])';
const problems = [];
const expect = (ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
  if (!ok) problems.push(what);
};

/** Waits until the last embedded pack (PdDpt) is in the browser's store. */
const versesLoaded = (page) =>
  page.waitForFunction(
    async () => {
      const names = (await indexedDB.databases()).map((each) => each.name);
      if (!names.includes("epigrapho-scripture")) return false;
      return new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture");
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("verses")) {
            db.close();
            return resolve(false);
          }
          const last = db
            .transaction("verses", "readonly")
            .objectStore("verses")
            .count(IDBKeyRange.bound(["PdDpt"], ["PdDpt", []]));
          last.onsuccess = () => {
            db.close();
            resolve(last.result > 0);
          };
          last.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        open.onerror = () => resolve(false);
      });
    },
    undefined,
    { timeout: 240_000, polling: 2000 }
  );

const visible = (page, selector) =>
  page
    .locator(selector)
    .first()
    .isVisible()
    .catch(() => false);
const appears = (page, selector, timeout = 15_000) =>
  page
    .locator(selector)
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => false
    );
const goes = (page, selector, timeout = 10_000) =>
  page
    .locator(selector)
    .first()
    .waitFor({ state: "detached", timeout })
    .then(
      () => true,
      () => false
    );

const browser = await chromium.launch();

async function openNote(device) {
  const context = await browser.newContext({
    ...devices[device],
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.goto(site);
  await page.locator("#app").waitFor();
  await versesLoaded(page);
  await page.keyboard.press("Escape");
  const editor = page.locator(".ProseMirror:visible").first();
  if (!(await editor.isVisible().catch(() => false)))
    await page.keyboard.press("Control+n");
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type("Lee Juan 3:16 hoy", { delay: 25 });
  await page.locator(REF).first().waitFor();
  // Let the first save swap the document in before anything opens.
  await page.waitForTimeout(3000);
  return { context, page };
}

/** Opens Settings on its Editor section. */
async function openSettings(page) {
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.getByText("Editor", { exact: true }).first().click();
}

async function pickMode(page, mode) {
  await openSettings(page);
  await page.locator(SETTING).selectOption(mode);
  // Escape on a focused <select> only closes the list, not the dialog.
  await page.locator(".ReactModal__Content").first().focus();
  await page.keyboard.press("Escape");
  if (!(await goes(page, ".ReactModal__Content")))
    throw new Error("Settings did not close");
  // The editor is rebuilt with the new mode.
  await page.locator(`.ProseMirror:visible ${REF}`).first().waitFor();
  await page.waitForTimeout(1000);
}

/** Moves the pointer off the note, so nothing is hovered. */
const away = (page) => page.mouse.move(2, 2);

/** Puts the caret inside "Juan" with the keyboard alone. */
async function caretIntoReference(page) {
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
}

{
  const { context, page } = await openNote("Desktop Chrome");

  // ---- hover, the default ----
  await page.locator(REF).first().hover();
  expect(await appears(page, POPOVER), "hover: al pasar el puntero sale el recuadro");
  await page.locator(REF).first().click();
  await page.waitForTimeout(1000);
  expect((await page.locator(PANEL).count()) === 0, "hover: el clic no abre panel");

  // ---- inline ----
  await away(page);
  await pickMode(page, "inline");
  await page.locator(REF).first().hover();
  await page.waitForTimeout(1500);
  expect(!(await visible(page, POPOVER)), "inline: el puntero no abre nada");
  await page.locator(REF).first().click();
  expect(await appears(page, PANEL), "inline: el clic abre el panel");
  await page.waitForTimeout(1000);
  await page.locator(REF).first().click();
  expect(await goes(page, PANEL), "inline: otro clic lo cierra");
  await away(page);
  await caretIntoReference(page);
  await page.waitForTimeout(1500);
  expect(
    !(await visible(page, POPOVER)) && (await page.locator(PANEL).count()) === 0,
    "inline: el cursor dentro de la referencia no abre nada"
  );

  // ---- both ----
  await pickMode(page, "both");
  await page.locator(REF).first().hover();
  expect(await appears(page, POPOVER), "both: al pasar el puntero sale el recuadro");
  await page.locator(REF).first().click();
  expect(await appears(page, PANEL), "both: el clic abre el panel");
  await page.waitForTimeout(1500);
  expect(!(await visible(page, POPOVER)), "both: y deja el recuadro cerrado");
  await away(page);
  await caretIntoReference(page);
  expect(
    await appears(page, POPOVER, 5000),
    "both: el cursor movido con el teclado abre el recuadro"
  );

  // ---- stays on this device ----
  const stored = await page.evaluate(() =>
    localStorage.getItem("scripture-preview-mode")
  );
  expect(stored === '"both"', `se guarda en este equipo (${stored})`);
  await context.close();
}

{
  const { context, page } = await openNote("iPad (gen 7)");
  await openSettings(page);
  const translation = page.locator('select:has(option[value="VBL"])').first();
  await translation.waitFor({ timeout: 15_000 }).catch(() => undefined);
  expect(
    (await translation.isVisible().catch(() => false)) &&
      (await page.locator(SETTING).count()) === 0,
    "táctil: el ajuste no aparece"
  );
  await page.keyboard.press("Escape");
  await goes(page, ".ReactModal__Content");
  await page.locator(REF).first().tap();
  expect(await appears(page, PANEL), "táctil: el toque abre el panel");
  await context.close();
}

await browser.close();
console.log(
  problems.length
    ? "NO-GREEN"
    : "GREEN: los tres modos se comportan como se eligió, y en táctil no hay ajuste."
);
process.exit(problems.length ? 1 : 0);
