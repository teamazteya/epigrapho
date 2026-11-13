/*
 * Epigrapho W1: the web reads NTV, NBLA and NASB through Epigrapho's server
 * (Epigrapho_W1_Agent_Runbook.md, Fase 5). Runs after Fase 6, once
 * publica.epigrapho.app answers with CORS.
 *
 * With NTV picked, Juan 3:16 shows NTV's words credited to NTV, not VBL's.
 * Playwright's WebKit does not install on this computer, so it is Chromium:
 * what is checked is the request and CORS, the same on both.
 *
 *   node scripts/w1-verse-check.mjs [http://localhost:4176]
 */
import { chromium, devices } from "playwright";

const site = (process.argv[2] || "http://localhost:4176").replace(/\/$/, "");
const REF = 'span[data-scripture-ref="JHN.3.16"]';
const POPOVER = ".scripture-popover";
const problems = [];
const expect = (ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
  if (!ok) problems.push(what);
};

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["Desktop Chrome"],
  serviceWorkers: "block"
});
// The picked translation lives in localStorage (utils/config.ts).
await context.addInitScript(() =>
  localStorage.setItem("translation", JSON.stringify("NTV"))
);
const page = await context.newPage();
page.setDefaultTimeout(120_000);
const asked = [];
page.on("response", (response) => {
  if (response.url().includes("/api/verse")) asked.push(response);
});
await page.goto(site);
await page.locator("#app").waitFor();
await page.keyboard.press("Escape");
const editor = page.locator(".ProseMirror:visible").first();
if (!(await editor.isVisible().catch(() => false)))
  await page.keyboard.press("Control+n");
await editor.waitFor();
await editor.click();
await page.keyboard.type("Juan 3:16 ", { delay: 25 });
await page.locator(REF).first().waitFor();
await page.waitForTimeout(1000);
await page.locator(REF).first().hover();

const text = await page
  .waitForFunction(
    (sel) => {
      const found = document.querySelector(sel)?.textContent || "";
      return /Dios/.test(found) && found.replace(/\s+/g, " ");
    },
    POPOVER,
    // A first run keeps the browser's store busy loading the packs, and the
    // cache sits in it too.
    { timeout: 120_000 }
  )
  .then(
    (handle) => handle.jsonValue(),
    () => ""
  )
  .then(String);
expect(
  /tanto al mundo/.test(text),
  `el texto es de NTV: ${text.slice(0, 80)}…`
);
expect(
  /Nueva Traducción Viviente/.test(text) && !/VBL/.test(text),
  "el crédito es NTV"
);

const response = asked[0];
expect(
  response?.url().startsWith("https://publica.epigrapho.app/api/verse"),
  `lo pidió a publica: ${response?.url() ?? "nada"}`
);
expect(
  response?.status() === 200 &&
    (await response.headerValue("access-control-allow-origin")) === site,
  "el servidor responde con CORS para este origen"
);

await browser.close();
console.log(
  problems.length ? "NO-GREEN" : "GREEN: la web lee NTV del servidor."
);
process.exit(problems.length ? 1 : 0);
