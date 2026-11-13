/*
 * Epigrapho W1: on a touch screen the verse opens in the note
 * (Epigrapho_W1_Agent_Runbook.md, Fase 4). With an iPhone and an iPad
 * profile, a tap on "Juan 3:16" opens the panel under it with the verse, and
 * another tap closes it. With a mouse, resting on it shows the floating box.
 *
 * Runs against a production build (no data-test-id), so it goes by class.
 *
 *   node scripts/w1-touch-panel-check.mjs [http://localhost:4176]
 */
import { chromium, devices } from "playwright";

const site = (process.argv[2] || "http://localhost:4176").replace(/\/$/, "");
const REF = 'span[data-scripture-ref="JHN.3.16"]';
const PANEL = ".scripture-inline-preview";
const POPOVER = ".scripture-popover";
const problems = [];
const expect = (ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
  if (!ok) problems.push(what);
};

/** Whether the embedded verse packs are all in the browser's store. */
const versesLoaded = (page) =>
  page.waitForFunction(
    async () => {
      // Opening a store that is not there yet would create it empty, under
      // the app's feet.
      const names = (await indexedDB.databases()).map((each) => each.name);
      if (!names.includes("epigrapho-scripture")) return false;
      return new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("verses")) {
            db.close();
            return resolve(false);
          }
          // A read waits behind the packs still being written, so wait for
          // the last one (packs.ts loads them in this order).
          const store = db
            .transaction("verses", "readonly")
            .objectStore("verses");
          const last = store.count(IDBKeyRange.bound(["PdDpt"], ["PdDpt", []]));
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

/**
 * Whether the browser's store answers a read at once. On a first run it stays
 * busy for a while after the packs (a read there took over 10 s), and a new
 * note's first save swaps its document, which closes an open panel.
 */
const settled = (page) =>
  page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const started = performance.now();
        const open = indexedDB.open("epigrapho-scripture", 1);
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const read = open.result
            .transaction("verses")
            .objectStore("verses")
            .get(["VBL", "JHN", 3, 16]);
          read.onsuccess = () => {
            open.result.close();
            resolve(Boolean(read.result) && performance.now() - started < 500);
          };
        };
      }),
    undefined,
    { timeout: 240_000, polling: 2000 }
  );

const browser = await chromium.launch();

async function writeReference(device) {
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
  // The welcome opens on a new profile; Escape closes it.
  await page.keyboard.press("Escape");
  const editor = page.locator(".ProseMirror:visible").first();
  if (!(await editor.isVisible().catch(() => false))) {
    // A wider layout starts on the list: open a new note.
    await page.keyboard.press("Control+n");
  }
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type("Juan 3:16 ", { delay: 25 });
  await page.locator(REF).first().waitFor();
  await settled(page);
  return { context, page };
}

for (const device of ["iPhone 13", "iPad (gen 7)"]) {
  const { context, page } = await writeReference(device);
  await page.locator(REF).first().tap();
  const panel = page.locator(PANEL).first();
  const opened = await panel.waitFor({ timeout: 15_000 }).then(
    () => true,
    () => false
  );
  expect(opened, `${device}: el toque abre el panel en la nota`);
  if (opened) {
    // The verse is read from the browser's store a moment after the tap.
    const text = await page
      .waitForFunction(
        (sel) => {
          const found = document.querySelector(sel)?.textContent || "";
          return /amó|amo/.test(found) && found.replace(/\s+/g, " ");
        },
        PANEL,
        { timeout: 30_000 }
      )
      .then(
        (handle) => handle.jsonValue(),
        () => ""
      )
      .then(String);
    expect(
      /amó|amo/.test(text),
      `${device}: el versículo: ${text.slice(0, 70)}…`
    );
    expect(
      !(await page
        .locator(POPOVER)
        .first()
        .isVisible()
        .catch(() => false)),
      `${device}: no sale el recuadro flotante`
    );
    // Two taps close together on one spot are a double tap, not two taps.
    await page.waitForTimeout(1000);
    await page.locator(REF).first().tap();
    const closed = await panel
      .waitFor({ state: "detached", timeout: 10_000 })
      .then(
        () => true,
        () => false
      );
    expect(closed, `${device}: otro toque lo cierra`);
  }
  await context.close();
}

{
  const { context, page } = await writeReference("Desktop Chrome");
  await page.locator(REF).first().hover();
  const shown = await page
    .locator(POPOVER)
    .first()
    .waitFor({ timeout: 15_000 })
    .then(
      () => true,
      () => false
    );
  expect(shown, "computadora: al pasar el mouse sale el recuadro");
  expect(
    (await page.locator(PANEL).count()) === 0,
    "computadora: no hay panel en la nota"
  );
  await context.close();
}

await browser.close();
console.log(
  problems.length
    ? "NO-GREEN"
    : "GREEN: el pasaje se abre en la nota con el dedo."
);
process.exit(problems.length ? 1 : 0);
