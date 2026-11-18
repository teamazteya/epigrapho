/*
 * Epigrapho W2: the note list by touch, from the iPhone walkthrough (Fase 8).
 * Chromium with an iPhone 13 profile, twice: once taken for iOS (the page is
 * told it runs on an iPhone) and once as any other phone (Android).
 *   - a short tap opens the note; the arrow goes back to the list;
 *   - a long press opens the note menu, with "Modo sermón", not the note
 *     (Safari on iOS fires no contextmenu);
 *   - a finger drag scrolls the list and opens nothing;
 *   - ☰ opens the navigation, a tap outside it goes back to the list;
 *   - a sideways swipe moves the panes on Android, never on iOS (there it
 *     took the list's own swipes: the list stuck near its top).
 * Then a computer: right-click opens the menu, notes are still draggable.
 *
 *   node scripts/w2-touch-check.mjs [http://localhost:4176]
 */
import { chromium, devices } from "playwright";

const site = (process.argv[2] || "http://localhost:4176").replace(/\/$/, "");
const PACKS = /\/(bsb|kjv|pddpt|vbl)\.json$/;
let failed = 0;
const expect = (ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
  if (!ok) failed++;
};

const browser = await chromium.launch();

for (const ios of [true, false]) {
  const name = ios ? "iOS" : "Android";
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    serviceWorkers: "block"
  });
  await context.addInitScript((ios) => {
    localStorage.setItem("welcome:hide", "true");
    // utils/platform.ts reads navigator.platform.
    if (ios)
      Object.defineProperty(Navigator.prototype, "platform", {
        get: () => "iPhone"
      });
  }, ios);
  await context.route(PACKS, (route) => route.abort());
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }]
    });
  const drag = async (from, to) => {
    const steps = 20;
    await touch("touchStart", ...from);
    for (let i = 1; i <= steps; i++) {
      await touch(
        "touchMove",
        from[0] + ((to[0] - from[0]) * i) / steps,
        from[1] + ((to[1] - from[1]) * i) / steps
      );
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await page.waitForTimeout(1200);
  };
  const pane = () =>
    page.evaluate(() =>
      Math.round(document.getElementById("slider").scrollLeft)
    );
  const back = () => page.locator(".editor-action-bar button").first().click();

  await page.goto(site);
  await page.locator("#app").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2500);
  // The iOS install notice lies over the + button.
  if (ios) await page.mouse.click(347, 619);
  await page.waitForTimeout(600);

  // 15 notes: + (a production build has no data-test-id), type, back.
  for (let i = 1; i <= 15; i++) {
    await page.mouse.click(367, 641);
    await page.waitForTimeout(900);
    await page.mouse.click(150, 137);
    await page.keyboard.type(`Nota ${i}`, { delay: 1 });
    await page.waitForTimeout(500);
    await back();
    await page.waitForTimeout(700);
  }
  expect((await pane()) === 300, `${name}: la flecha vuelve a la lista`);

  await touch("touchStart", 150, 330);
  await page.waitForTimeout(80);
  await touch("touchEnd");
  await page.waitForTimeout(1200);
  expect((await pane()) === 690, `${name}: un toque corto abre la nota`);
  await back();
  await page.waitForTimeout(1200);

  await touch("touchStart", 150, 330);
  await page.waitForTimeout(800);
  await touch("touchEnd");
  await page.waitForTimeout(800);
  const sermon = page.getByText("Modo sermón", { exact: true });
  expect(await sermon.isVisible(), `${name}: dejar el dedo abre el menú`);
  expect((await pane()) === 300, `${name}: y no abre la nota`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  const list = page.locator("[data-virtuoso-scroller]:visible").first();
  await drag([195, 500], [195, 200]);
  const top = await list.evaluate((el) => Math.round(el.scrollTop));
  expect(top > 150, `${name}: arrastrar desplaza la lista (${top}px)`);
  expect(
    !(await sermon.isVisible()) && (await pane()) === 300,
    `${name}: y no abre menú ni nota`
  );

  await page.mouse.click(22, 24);
  await page.waitForTimeout(1200);
  expect((await pane()) === 0, `${name}: ☰ abre la navegación`);
  await page.mouse.click(350, 400);
  await page.waitForTimeout(1200);
  expect((await pane()) === 300, `${name}: tocar fuera vuelve a la lista`);

  await drag([300, 400], [60, 400]);
  const after = await pane();
  expect(
    ios ? after === 300 : after !== 300,
    `${name}: deslizar de lado ${ios ? "no mueve" : "mueve"} los paneles`
  );
  await context.close();
}

const desk = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  serviceWorkers: "block"
});
await desk.addInitScript(() => localStorage.setItem("welcome:hide", "true"));
await desk.route(PACKS, (route) => route.abort());
const page = await desk.newPage();
await page.goto(site);
await page.locator("#app").waitFor({ timeout: 120_000 });
await page.waitForTimeout(3000);
await page.keyboard.press("Control+n");
const editor = page.locator(".ProseMirror:visible").first();
await editor.waitFor();
await editor.click();
await page.keyboard.type("Nota escritorio");
await page.waitForTimeout(1500);
const item = page.locator("[data-virtuoso-scroller] [id^=id_]").first();
expect(
  (await item.getAttribute("draggable")) === "true",
  "escritorio: la nota sigue arrastrable"
);
await item.click({ button: "right" });
await page.waitForTimeout(600);
expect(
  await page.getByText("Modo sermón", { exact: true }).isVisible(),
  "escritorio: el clic derecho abre el menú"
);

await browser.close();
console.log(failed ? `NO-GREEN: ${failed} en rojo` : "GREEN");
process.exit(failed ? 1 : 0);
