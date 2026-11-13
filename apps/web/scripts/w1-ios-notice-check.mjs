/*
 * Epigrapho W1: the "install on iPhone or iPad" notice
 * (Epigrapho_W1_Agent_Runbook.md, Fase 3). It shows on iPhone and iPad in
 * the browser, not once closed, not on a computer, not in the installed app.
 *
 * Playwright's WebKit does not install on this computer, so Chromium is told
 * it runs on iOS through navigator.platform (an iPad says "MacIntel" and has
 * touch points), which is what the app reads.
 *
 *   node scripts/w1-ios-notice-check.mjs [http://localhost:4176]
 */
import { chromium, devices } from "playwright";

const site = (process.argv[2] || "http://localhost:4176").replace(/\/$/, "");
// A production build drops data-test-id, so the notice is found by role and text.
const NOTICE = '[role="status"]:has-text("iPad")';
const problems = [];
const expect = (ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
  if (!ok) problems.push(what);
};

const browser = await chromium.launch();

async function open(device, platform, { standalone = false } = {}) {
  const context = await browser.newContext({
    ...devices[device],
    serviceWorkers: "block"
  });
  await context.addInitScript(
    ([platform, standalone]) => {
      if (platform) {
        Object.defineProperty(Navigator.prototype, "platform", {
          get: () => platform
        });
        Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
          get: () => 5
        });
      }
      if (standalone)
        Object.defineProperty(Navigator.prototype, "standalone", {
          get: () => true
        });
    },
    [platform, standalone]
  );
  const page = await context.newPage();
  await page.goto(site);
  await page.locator("#app").waitFor({ timeout: 120_000 });
  // The notice mounts with the app; give the first render a moment.
  await page.waitForTimeout(1500);
  return { context, page };
}

const shown = (page) => page.locator(NOTICE).isVisible();

{
  const { context, page } = await open("iPhone 13", "iPhone");
  expect(await shown(page), "iPhone en Safari: sale el aviso");
  const text = await page.locator(NOTICE).innerText();
  expect(/Compartir|Share/.test(text), `texto: ${text.slice(0, 60)}…`);
  // The welcome dialog covers the app on a new profile; close it first.
  await page.keyboard.press("Escape");
  await page.locator(`${NOTICE} button`).click();
  expect(!(await shown(page)), "se cierra");
  await page.reload();
  await page.locator("#app").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  expect(!(await shown(page)), "cerrado, no vuelve al recargar");
  await context.close();
}
{
  const { context, page } = await open("iPad (gen 7)", "MacIntel");
  expect(await shown(page), "iPad (se presenta como Mac táctil): sale");
  await context.close();
}
{
  const { context, page } = await open("Desktop Chrome", null);
  expect(!(await shown(page)), "computadora: no sale");
  await context.close();
}
{
  const { context, page } = await open("iPhone 13", "iPhone", {
    standalone: true
  });
  expect(!(await shown(page)), "app instalada (standalone): no sale");
  await context.close();
}

await browser.close();
console.log(
  problems.length ? "NO-GREEN" : "GREEN: el aviso de instalar sale solo donde va."
);
process.exit(problems.length ? 1 : 0);
