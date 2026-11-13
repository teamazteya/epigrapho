/*
 * Epigrapho W1: the web login on a phone (Epigrapho_W1_Agent_Runbook.md, 1.4).
 *
 * The login and signup buttons do a full page load of /login (hardNavigate).
 * On a first visit no service worker controls the page yet, so the server
 * itself must answer /login with the app. This opens the site in a fresh
 * context (no service worker, no cache) with an iPhone and an iPad profile,
 * navigates the way the button does, and waits for the email field.
 *
 *   node scripts/w1-login-check.mjs [https://notas.epigrapho.app] [webkit|chromium]
 */
import { chromium, webkit, devices } from "playwright";

const site = process.argv[2] || "https://notas.epigrapho.app";
const engines = process.argv[3] ? [process.argv[3]] : ["webkit", "chromium"];
const profiles = ["iPhone 13", "iPad (gen 7)"];
let failed = false;

for (const engine of engines) {
  const browser = await (engine === "webkit" ? webkit : chromium).launch();
  for (const profile of profiles) {
    for (const route of ["/login#/", "/signup#/"]) {
      const context = await browser.newContext({
        ...devices[profile],
        serviceWorkers: "block"
      });
      const page = await context.newPage();
      const label = `${engine} · ${profile} · ${route}`;
      try {
        await page.goto(site, { waitUntil: "domcontentloaded" });
        // What hardNavigate does: location.replace(url).
        const response = await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          page.evaluate((r) => window.location.replace(r), route)
        ]).then(([r]) => r);
        if (response?.status() !== 200)
          throw new Error(`${route} answered ${response?.status()}`);
        await page.locator("input#email").waitFor({ timeout: 60_000 });
        console.log(`GREEN  ${label}`);
      } catch (error) {
        failed = true;
        console.log(`RED    ${label}: ${error.message.split("\n")[0]}`);
      }
      await context.close();
    }
  }
  await browser.close();
}

console.log(failed ? "NO-GREEN" : "GREEN: /login y /signup abren en iPhone y iPad.");
process.exit(failed ? 1 : 0);
