/*
 * Epigrapho W2: the four lag measurements (Epigrapho_W2_Agent_Runbook.md,
 * Fase 0 and Fase 8). Chromium with an iPhone 13 profile and the CPU slowed
 * 4x, on a fresh profile each run:
 *   1. first open: long tasks while the Bible packs are stored;
 *   2. typing 47 characters: main-thread ms per character;
 *   3. scrolling a list of 31 notes: frames over 50 ms;
 *   4. opening the concordance, the dictionary and the table of contents:
 *      ms from tap to screen, and how wide the note is left.
 *
 * Chromium is not WebKit: read the numbers against each other, not as iOS.
 *
 *   node scripts/w2-perf-check.mjs [http://localhost:4176] [--goals base.json]
 *
 * It prints one JSON line with the numbers. With --goals it compares them to
 * a baseline saved from an earlier run and fails when a goal is missed.
 */
import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const goalsAt = args.indexOf("--goals");
const baseline =
  goalsAt >= 0 ? JSON.parse(readFileSync(args[goalsAt + 1], "utf8")) : null;
const site = (
  args.find((a) => a.startsWith("http")) || "http://localhost:4176"
).replace(/\/$/, "");
const PACKS = /\/(bsb|kjv|pddpt|vbl)\.json$/;
const TEXT = "En el principio era el Verbo, Juan 1:1 y Romanos 8:28 ";

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

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 13"],
  serviceWorkers: "block"
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);
page.on("pageerror", (error) => console.error("pageerror:", error.message));
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Performance.enable");

// Long tasks and frame gaps, recorded from the first script on.
await page.addInitScript(() => {
  // No welcome on this fresh profile (common/welcome.ts).
  localStorage.setItem("welcome:hide", "true");
  window.__w2 = { tasks: [], frames: [] };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      window.__w2.tasks.push([entry.startTime, entry.duration]);
  }).observe({ type: "longtask", buffered: true });
});

const busy = async () => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return metrics.find((m) => m.name === "TaskDuration").value * 1000;
};
const tasksSince = (since) =>
  page.evaluate((t) => window.__w2.tasks.filter(([s]) => s >= t), since);
const now = () => page.evaluate(() => performance.now());

/** Whether all four packs are stored (packs.ts order: PdDpt is the last). */
const versesLoaded = () =>
  until(
    page,
    async () => {
      const found = (await indexedDB.databases()).find(
        (each) => each.name === "epigrapho-scripture"
      );
      // Opening it before the app does would create it empty.
      if (!found || found.version < 2) return false;
      return new Promise((resolve) => {
        const open = indexedDB.open("epigrapho-scripture");
        open.onsuccess = () => {
          const db = open.result;
          if (![...db.objectStoreNames].includes("headings")) {
            db.close();
            return resolve(false);
          }
          // The last pack's marker (packs.ts): stored in chunks since W2, so
          // rows alone do not mean it is finished. A build from before W2
          // has no marker and stores each pack at once: rows mean done.
          const tx = db.transaction(["headings", "verses"], "readonly");
          const marker = tx.objectStore("headings").get(["PdDpt", "", 0, 0, 0]);
          const rows = tx
            .objectStore("verses")
            .count(IDBKeyRange.bound(["PdDpt"], ["PdDpt", []]));
          tx.oncomplete = () => {
            db.close();
            resolve(
              marker.result ? marker.result.text === "done" : rows.result > 0
            );
          };
          const last = tx;
          last.onabort = () => {
            db.close();
            resolve(false);
          };
        };
        open.onerror = () => resolve(false);
      });
    },
    undefined,
    2000
  );

const result = {};

// 1. First open.
let firstPack = Infinity;
page.on("requestfinished", (request) => {
  if (PACKS.test(new URL(request.url()).pathname) && firstPack === Infinity)
    firstPack = Date.now();
});
const opened = Date.now();
await page.goto(site);
// Before W2 the Bible packs could freeze the start for minutes.
await page.locator("#app").waitFor({ timeout: 600_000 });
await versesLoaded();
// Long tasks from the first pack on: app start-up is not part of the import.
const packStart = (await now()) - (Date.now() - firstPack);
const packTasks = await tasksSince(Number.isFinite(packStart) ? packStart : 0);
result.firstOpen = {
  seconds: Math.round((Date.now() - opened) / 1000),
  tasksOver200: packTasks.filter(([, d]) => d > 200).length,
  longestTask: Math.round(Math.max(0, ...packTasks.map(([, d]) => d)))
};

await page.waitForTimeout(1000);

async function newNote(text) {
  await page.keyboard.press("Control+n");
  const editor = page.locator(".ProseMirror:visible").first();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type(text, { delay: 20 });
  await page.waitForTimeout(400);
}

// 2. Typing.
await newNote("");
await page.waitForTimeout(2000);
const typeFrom = await now();
const before = await busy();
await page.keyboard.type(TEXT, { delay: 60 });
await page.waitForTimeout(1500); // the save and its debounces
const typed = (await busy()) - before;
result.typing = {
  msPerChar: Math.round(typed / TEXT.length),
  tasksOver50: (await tasksSince(typeFrom)).filter(([, d]) => d > 50).length
};

// 3. List scroll, with 31 notes.
for (let i = 1; i < 31; i++)
  await newNote(`Nota ${i} Salmos 23:${(i % 6) + 1}`);
await page.waitForTimeout(2000);
// Back to the list: the arrow on phones, nothing to do on wider screens.
const back = page.locator(".editor-action-bar button").first();
if (await page.locator("#slider").count()) await back.click();
await page.waitForTimeout(1500);
// A production build has no data-test-id: Virtuoso's own attributes.
const list = page.locator("[data-virtuoso-scroller]:visible").first();
const box = await list.boundingBox();
await page.evaluate(() => {
  window.__w2.frames = [];
  window.__w2.recording = true;
  let last = performance.now();
  const tick = (t) => {
    window.__w2.frames.push(t - last);
    last = t;
    if (window.__w2.recording) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
for (const y of [-1500, 1500, -1500, 1500]) {
  await cdp.send("Input.synthesizeScrollGesture", {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    yDistance: y,
    speed: 1200,
    gestureSourceType: "touch"
  });
}
const frames = await page.evaluate(() => {
  window.__w2.recording = false;
  return window.__w2.frames.slice(1);
});
frames.sort((a, b) => a - b);
result.scroll = {
  frames: frames.length,
  over50: frames.filter((f) => f > 50).length,
  p95: Math.round(frames[Math.floor(frames.length * 0.95)] || 0)
};

// 4. Panels, on the last note.
await page
  .locator("[data-virtuoso-scroller]:visible [data-index]")
  .first()
  .click();
await page.locator(".ProseMirror:visible").first().waitFor();
await page.waitForTimeout(1500);
result.panels = {};
for (const [name, title] of [
  ["concordance", "Concordancia"],
  ["dictionary", "Diccionario bíblico"],
  ["toc", "Índice"]
]) {
  const ms = await page.evaluate(async (title) => {
    // On phones W2 moves the tools that do not fit into the "⋮" menu.
    let button = document.querySelector(
      `.editor-action-bar button[title="${title}"]`
    );
    if (!button || button.offsetParent === null) {
      document.querySelector(".editor-action-bar .editor-more")?.click();
      await new Promise((r) => setTimeout(r, 300));
      button = [...document.querySelectorAll("[role=menuitem], button")].find(
        (each) => each.textContent?.trim() === title
      );
    }
    if (!button) return -1;
    const started = performance.now();
    button.click();
    const pane = () =>
      document.querySelector(
        "#concordance-pane, #dictionary-pane, #table-of-contents-pane"
      );
    while (!pane()) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
    return performance.now() - started;
  }, title);
  await page.waitForTimeout(800);
  const layout = await page.evaluate(() => {
    // Covered: the panel lies over the note, with its arrow back.
    if (document.querySelector(".pane-back")) return { noteWidth: 0 };
    const note = document.querySelector(".ProseMirror");
    const rect = note?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? Math.round(rect.width) : 0;
    return { noteWidth: width };
  });
  result.panels[name] = { ms: Math.round(ms), ...layout };
  // Close it the same way it opened.
  await page.evaluate((title) => {
    const button = document.querySelector(
      `.editor-action-bar button[title="${title}"]`
    );
    if (button && button.offsetParent !== null) return button.click();
    document.querySelector(".pane-back")?.click();
  }, title);
  await page.waitForTimeout(800);
}

await browser.close();
console.log(JSON.stringify(result));

if (baseline) {
  const problems = [];
  const expect = (ok, what) => {
    console.log(`${ok ? "GREEN" : "RED  "}  ${what}`);
    if (!ok) problems.push(what);
  };
  expect(
    result.firstOpen.tasksOver200 === 0,
    `primera apertura: ${result.firstOpen.tasksOver200} tareas de más de 200 ms (la más larga ${result.firstOpen.longestTask} ms)`
  );
  expect(
    result.typing.msPerChar * 2 <= baseline.typing.msPerChar,
    `escribir: ${result.typing.msPerChar} ms por carácter (antes ${baseline.typing.msPerChar})`
  );
  expect(
    result.scroll.over50 * 2 <= baseline.scroll.over50,
    `scroll: ${result.scroll.over50} cuadros de más de 50 ms (antes ${baseline.scroll.over50})`
  );
  for (const [name, panel] of Object.entries(result.panels))
    expect(
      panel.ms >= 0 && (panel.noteWidth >= 400 || panel.noteWidth === 0),
      `${name}: ${panel.ms} ms, la nota mide ${panel.noteWidth}px (0 = el panel la cubre)`
    );
  console.log(problems.length ? "NO-GREEN" : "GREEN: metas de W2 cumplidas.");
  process.exit(problems.length ? 1 : 0);
}
