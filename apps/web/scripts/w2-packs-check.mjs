/*
 * Epigrapho W2, Fase 6.3: a Bible pack cut halfway is finished at the next
 * start. Opens the app on a fresh profile, reloads it while the first pack is
 * still being written, waits for all four, and counts their rows against the
 * pack files. Then reads JHN 3:16 in VBL with the network off.
 *
 *   node scripts/w2-packs-check.mjs [http://localhost:4176]
 */
import { chromium, webkit } from "playwright";

const site = (
  process.argv.slice(2).find((a) => a.startsWith("http")) ||
  "http://localhost:4176"
).replace(/\/$/, "");
const PACKS = {
  VBL: "vbl.json",
  BSB: "bsb.json",
  KJV: "kjv.json",
  PdDpt: "pddpt.json"
};

/**
 * Polls an async check in the page until it returns true. Playwright's
 * waitForFunction does not await a promise: an async check passes at once.
 */
async function until(page, check, arg, every = 1000) {
  for (;;) {
    if (await page.evaluate(check, arg)) return;
    await page.waitForTimeout(every);
  }
}

// --webkit runs it in Safari's engine instead of Chrome's.
const browser = await (process.argv.includes("--webkit")
  ? webkit
  : chromium
).launch();
const context = await browser.newContext({ serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("welcome:hide", "true");
  // Opening a database that is not there yet creates it empty, at version 1,
  // and the app's own open then races it: only open it once the app has.
  window.__scriptureDb = async () => {
    const found = (await indexedDB.databases()).find(
      (each) => each.name === "epigrapho-scripture"
    );
    if (!found || found.version < 2) return null;
    return new Promise((resolve) => {
      const request = indexedDB.open("epigrapho-scripture");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  };
});
const page = await context.newPage();
page.setDefaultTimeout(600_000);

/** Rows per translation, and each pack's marker (packs.ts). */
const state = () =>
  page.evaluate(async (ids) => {
    const db = await window.__scriptureDb();
    if (!db) return null;
    const ask = (store, run) =>
      new Promise((resolve) => {
        if (![...db.objectStoreNames].includes(store))
          return resolve(undefined);
        const request = run(
          db.transaction(store, "readonly").objectStore(store)
        );
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      });
    const out = {};
    for (const id of ids)
      out[id] = {
        verses: await ask("verses", (s) =>
          s.count(IDBKeyRange.bound([id], [id, []]))
        ),
        marker: (await ask("headings", (s) => s.get([id, "", 0, 0, 0])))?.text
      };
    db.close();
    return out;
  }, Object.keys(PACKS));

const problems = [];
const expect = (ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
  if (!ok) problems.push(what);
};

// 1. Cut the first pack halfway.
await page.goto(site);
await until(
  page,
  async () => {
    const open = await window.__scriptureDb();
    if (!open) return false;
    const count = await new Promise((resolve) => {
      const request = open
        .transaction("verses", "readonly")
        .objectStore("verses")
        .count(IDBKeyRange.bound(["VBL"], ["VBL", []]));
      request.onsuccess = () => resolve(request.result);
    });
    open.close();
    return count >= 3000;
  },
  undefined,
  50
);
await page.goto("about:blank");
await page.goto(site);
const cut = await state();
console.log("cortada:", JSON.stringify(cut));
expect(
  cut?.VBL.marker === "loading" && cut.VBL.verses > 0,
  `VBL quedó a medias (${cut?.VBL.verses} versículos, marca ${cut?.VBL.marker})`
);

// 2. The next start finishes it.
await until(
  page,
  async () => {
    const db = await window.__scriptureDb();
    if (!db) return false;
    const done = await new Promise((resolve) => {
      const request = db
        .transaction("headings", "readonly")
        .objectStore("headings")
        .get(["PdDpt", "", 0, 0, 0]);
      request.onsuccess = () => resolve(request.result?.text === "done");
      request.onerror = () => resolve(false);
    });
    db.close();
    return done;
  },
  undefined,
  1000
);
const final = await state();
for (const [id, file] of Object.entries(PACKS)) {
  const pack = await (await fetch(`${site}/${file}`)).json();
  expect(
    final[id].verses === pack.verses.length && final[id].marker === "done",
    `${id}: ${final[id].verses} de ${pack.verses.length} versículos, marca ${final[id].marker}`
  );
}

// 3. A verse offline.
await context.setOffline(true);
const verse = await page.evaluate(async () => {
  const db = await window.__scriptureDb();
  const row = await new Promise((resolve) => {
    const request = db
      .transaction("verses", "readonly")
      .objectStore("verses")
      .get(["VBL", "JHN", 3, 16]);
    request.onsuccess = () => resolve(request.result);
  });
  db.close();
  return row?.text;
});
expect(!!verse, `JHN 3:16 en VBL sin red: ${verse?.slice(0, 40)}…`);

await browser.close();
console.log(problems.length ? "NO-GREEN" : "GREEN: Fase 6.3.");
process.exit(problems.length ? 1 : 0);
