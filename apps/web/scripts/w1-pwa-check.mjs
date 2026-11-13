/*
 * Epigrapho W1: the web as an installable app (Epigrapho_W1_Agent_Runbook.md,
 * Fase 2). Reads the manifest and the iOS meta tags from a running build and
 * asks Chromium whether the page is installable.
 *
 *   node scripts/w1-pwa-check.mjs [http://localhost:4173]
 */
import { chromium, devices } from "playwright";

const site = (process.argv[2] || "http://localhost:4173").replace(/\/$/, "");
const problems = [];
const expect = (ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
  if (!ok) problems.push(what);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 13"] });
const page = await context.newPage();
await page.goto(site, { waitUntil: "load" });

const href = await page.getAttribute('link[rel="manifest"]', "href");
expect(href === "/manifest.webmanifest", `manifest enlazado (${href})`);
const response = await page.request.get(`${site}/manifest.webmanifest`);
const manifest = await response.json();
// Only a server with the .htaccess rules sends the right type.
if (!site.includes("localhost"))
  expect(
    response.headers()["content-type"]?.startsWith("application/manifest+json"),
    `Content-Type ${response.headers()["content-type"]}`
  );
expect(manifest.name === "Epigrapho", "nombre Epigrapho");
expect(manifest.lang === "es-MX", "idioma es-MX");
expect(manifest.theme_color === "#17223B", "color #17223B");
expect(manifest.display === "standalone", "display standalone");
expect(!/notesnook|evernote/i.test(JSON.stringify(manifest)), "sin Notesnook");
expect(
  manifest.shortcuts?.some((s) => s.name === "Nueva nota"),
  "atajo Nueva nota"
);
expect(
  manifest.icons?.some((i) => i.sizes === "512x512"),
  "icono de 512 px"
);

const meta = (name) =>
  page.getAttribute(`meta[name="${name}"]`, "content").catch(() => null);
expect((await meta("apple-mobile-web-app-capable")) === "yes", "meta iOS capable");
expect((await meta("apple-mobile-web-app-title")) === "Epigrapho", "meta iOS título");
expect(
  Boolean(await meta("apple-mobile-web-app-status-bar-style")),
  "meta iOS barra de estado"
);
expect(
  Boolean(await page.getAttribute('link[rel="apple-touch-icon"]', "href")),
  "apple-touch-icon"
);
const description = await page.getAttribute(
  'meta[property="og:description"]',
  "content"
);
expect(!/notesnook|evernote/i.test(description || ""), "og:description propia");

const cdp = await context.newCDPSession(page);
const { errors } = await cdp.send("Page.getAppManifest");
expect(errors.length === 0, `manifest sin errores (${JSON.stringify(errors)})`);
await page
  .waitForFunction(() => navigator.serviceWorker.controller, null, {
    timeout: 60_000
  })
  .catch(() => {});
await page.reload({ waitUntil: "load" });
const { installabilityErrors } = await cdp.send(
  "Page.getInstallabilityErrors"
);
expect(
  installabilityErrors.length === 0,
  `instalable (${installabilityErrors.map((e) => e.errorId).join(", ")})`
);

await browser.close();
console.log(problems.length ? "NO-GREEN" : "GREEN: la web se instala como app.");
process.exit(problems.length ? 1 : 0);
