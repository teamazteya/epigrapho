/*
 * Epigrapho A7, Fase 8: updating from v1.6.1 (Epigrapho_A7_Agent_Runbook.md).
 * Builds the verse database exactly as v1.6.1 left it (version 1, a "verses"
 * store holding all four packs, no "headings") with one verse marked, then
 * opens this build and checks that:
 *   1. the database moves to version 2 and gets the headings of every pack;
 *   2. the verses are not loaded again: the marked verse is still marked and
 *      the counts are the same;
 *   3. the popover shows the section title above the stored verse.
 *
 * Runs against a production build:
 *   npx serve -s build -p 4176
 *   node scripts/a7-upgrade-check.mjs [http://localhost:4176]
 */
import { chromium } from "playwright";

const site = (process.argv[2] || "http://localhost:4176").replace(/\/$/, "");
const MARK = "VERSO DE LA 1.6.1";
const problems = [];
const expect = (ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
  if (!ok) problems.push(what);
};

const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(120_000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));

// A blank page on the app's origin, to write the old database before the app
// first opens it.
await page.route(`${site}/a7-blank`, (route) =>
  route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>.</title>"
  })
);
await page.goto(`${site}/a7-blank`);
const before = await page.evaluate(async (mark) => {
  const db = await new Promise((resolve, reject) => {
    // The schema of v1.6.1 (packages/scripture-provider/src/packs.ts).
    const request = indexedDB.open("epigrapho-scripture", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("verses", {
        keyPath: ["translationId", "book", "chapter", "verse"]
      });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const counts = {};
  for (const [id, file] of Object.entries({
    VBL: "vbl.json",
    BSB: "bsb.json",
    KJV: "kjv.json",
    PdDpt: "pddpt.json"
  })) {
    const pack = await (await fetch(`/${file}`)).json();
    const transaction = db.transaction("verses", "readwrite");
    const store = transaction.objectStore("verses");
    for (const [book, chapter, verse, text] of pack.verses)
      store.put({
        translationId: pack.translationId,
        book,
        chapter,
        verse,
        text:
          id === "VBL" && book === "JHN" && chapter === 3 && verse === 16
            ? mark
            : text,
        source: "pack"
      });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    counts[id] = pack.verses.length;
  }
  db.close();
  return counts;
}, MARK);
console.log("base de la 1.6.1:", JSON.stringify(before));

await page.unroute(`${site}/a7-blank`);
await page.goto(site);
await page.locator("#app").waitFor({ state: "attached" });
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));

/** Reads the database as the new build leaves it, once every pack has headings. */
const read = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture");
        open.onsuccess = async () => {
          const db = open.result;
          const result = { version: db.version, verses: {}, headings: {} };
          if (!db.objectStoreNames.contains("headings")) {
            db.close();
            return resolve(result);
          }
          const count = (store, id) =>
            new Promise((done) => {
              const request = db
                .transaction(store, "readonly")
                .objectStore(store)
                .count(IDBKeyRange.bound([id], [id, []]));
              request.onsuccess = () => done(request.result);
            });
          for (const id of ["VBL", "BSB", "KJV", "PdDpt"]) {
            result.verses[id] = await count("verses", id);
            result.headings[id] = await count("headings", id);
          }
          result.marked = await new Promise((done) => {
            const request = db
              .transaction("verses", "readonly")
              .objectStore("verses")
              .get(["VBL", "JHN", 3, 16]);
            request.onsuccess = () => done(request.result?.text);
          });
          db.close();
          resolve(result);
        };
        open.onerror = () => resolve({});
      })
  );

let after = {};
for (let i = 0; i < 90; i++) {
  after = await read();
  if (
    Object.values(after.headings || {}).every((n) => n > 0) &&
    after.headings?.PdDpt
  )
    break;
  await page.waitForTimeout(2000);
}
console.log("después:", JSON.stringify(after));
expect(after.version === 2, `la base pasa a la versión 2 (${after.version})`);
expect(
  ["VBL", "BSB", "KJV", "PdDpt"].every((id) => after.headings?.[id] > 0),
  "cada paquete recibe sus títulos"
);
expect(
  ["VBL", "BSB", "KJV", "PdDpt"].every(
    (id) => after.verses?.[id] === before[id]
  ),
  "los versículos no se duplican ni se pierden"
);
expect(after.marked === MARK, "los versículos no se vuelven a cargar");

// The popover: the new title over the verse the old install stored.
await page.keyboard.press("Escape");
const editor = page.locator(".ProseMirror:visible").first();
if (!(await editor.isVisible().catch(() => false)))
  await page.keyboard.press("Control+n");
await editor.waitFor();
await editor.click();
await page.keyboard.type("Lee Juan 3:16 hoy", { delay: 25 });
const ref = page.locator('span[data-scripture-ref="JHN.3.16"]').first();
await ref.waitFor();
await page.waitForTimeout(3000);
await ref.hover();
const text = await page
  .waitForFunction(
    () => {
      const text = document.querySelector(
        ".scripture-popover-text"
      )?.textContent;
      return text && text !== "…" ? text : false;
    },
    undefined,
    { timeout: 15_000 }
  )
  .then((handle) => handle.jsonValue())
  .catch(() => "");
console.log("popover:", JSON.stringify(text));
expect(
  /^El amor de Dios\s*16 VERSO DE LA 1\.6\.1/.test(text),
  "el recuadro muestra el título sobre el verso guardado"
);

await browser.close();
console.log(
  problems.length
    ? "NO-GREEN"
    : "GREEN: al actualizar desde la 1.6.1 se cargan solo los títulos, una vez, y se ven."
);
process.exit(problems.length ? 1 : 0);
