/*
 * Epigrapho W2, Fases 1–5: the layout on iPhone, iPad and desktop.
 * Chromium with device profiles (not WebKit: the device test is Fase 8).
 * For each screen it checks:
 *   - the mode: phone (iPhone, also on its side), tablet (iPad upright),
 *     desktop (iPad on its side, a computer);
 *   - nothing wider than the screen;
 *   - fields of 16px or more on a phone (iOS zooms into smaller ones);
 *   - the formatting toolbar at the bottom on a phone, at the top otherwise;
 *   - the action bar: no hidden scroll, on a phone back, undo, redo, search
 *     and "⋮" only;
 *   - a study panel leaves the note 400px or covers it;
 *   - Ajustes fits the screen, and on a phone goes section → back → close;
 *   - the sermon bar fits the screen width on a phone.
 * Screenshots go next to the log, in the folder given with --shots.
 *
 *   node scripts/w2-ui-check.mjs [http://localhost:4176] [--shots dir] [--webkit]
 *
 * --webkit runs it in Safari's engine instead of Chrome's.
 */
import { chromium, webkit, devices } from "playwright";
import { join } from "node:path";

const args = process.argv.slice(2);
const site = (
  args.find((a) => a.startsWith("http")) || "http://localhost:4176"
).replace(/\/$/, "");
const shots = args.includes("--shots")
  ? args[args.indexOf("--shots") + 1]
  : null;

const SCREENS = [
  ["iPhone", devices["iPhone 13"], "phone"],
  ["iPhone de lado", devices["iPhone 13 landscape"], "phone"],
  ["iPad vertical", devices["iPad (gen 7)"], "tablet"],
  ["iPad horizontal", devices["iPad (gen 7) landscape"], "desktop"],
  ["Escritorio", { viewport: { width: 1280, height: 800 } }, "desktop"]
];
// use-tablet.ts
const TABLET =
  "(min-width: 481px) and (max-width: 1000px) and (min-height: 481px), (min-width: 481px) and (max-width: 1000px) and (pointer: fine)";

const browser = await (args.includes("--webkit") ? webkit : chromium).launch();
const problems = [];
const expect = (screen, ok, what) => {
  console.log(`${ok ? "GREEN" : "RED  "}  ${screen}: ${what}`);
  if (!ok) problems.push(`${screen}: ${what}`);
};

for (const [name, profile, mode] of SCREENS) {
  const context = await browser.newContext({
    ...profile,
    serviceWorkers: "block"
  });
  await context.addInitScript(() =>
    localStorage.setItem("welcome:hide", "true")
  );
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  const shot = (what) =>
    shots && page.screenshot({ path: join(shots, `${name} - ${what}.png`) });
  const isPhone = mode === "phone";
  /** The open dialog, the last one, lies inside the screen. */
  const fitsScreen = () =>
    page.evaluate(() => {
      const all = document.querySelectorAll(".ReactModal__Content > *");
      const box = all[all.length - 1]?.getBoundingClientRect();
      return (
        !!box &&
        box.left >= -1 &&
        box.top >= -1 &&
        box.right <= window.innerWidth + 1 &&
        box.bottom <= window.innerHeight + 1
      );
    });

  await page.goto(site);
  await page.locator("#app").waitFor();
  await page.waitForTimeout(3000);

  // Mode.
  const seen = await page.evaluate(
    (tablet) =>
      document.querySelector("#slider")
        ? "phone"
        : matchMedia(tablet).matches
        ? "tablet"
        : "desktop",
    TABLET
  );
  expect(name, seen === mode, `modo ${seen} (espera ${mode})`);

  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
  expect(name, (await overflow()) <= 1, `nada más ancho que la pantalla`);

  if (isPhone) {
    const size = await page.evaluate(() => {
      const input = [...document.querySelectorAll("input")].find(
        (each) => each.offsetParent !== null
      );
      return input ? parseFloat(getComputedStyle(input).fontSize) : 0;
    });
    expect(name, size >= 16, `el buscador mide ${size}px (16 o más)`);
  }

  // A note, its toolbar and its action bar.
  await page.keyboard.press("Control+n");
  const editor = page.locator(".ProseMirror:visible").first();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type("En el principio era el Verbo, Juan 1:1 ", {
    delay: 20
  });
  await page.waitForTimeout(800);
  const bars = await page.evaluate(() => {
    const toolbar = document
      .querySelector(".active .editor-toolbar, .editor-toolbar")
      ?.getBoundingClientRect();
    const tools = document.querySelector(".editor-action-bar > :last-child");
    const shown = [
      ...document.querySelectorAll(".editor-action-bar button")
    ].filter((each) => each.offsetParent !== null);
    return {
      toolbarTop: toolbar ? Math.round(toolbar.top) : -1,
      toolbarBottom: toolbar ? Math.round(toolbar.bottom) : -1,
      height: window.innerHeight,
      hiddenScroll: tools ? tools.scrollWidth - tools.clientWidth : 0,
      buttons: shown.length,
      more: !!document.querySelector(".editor-more")
    };
  });
  if (isPhone)
    expect(
      name,
      bars.toolbarBottom <= bars.height && bars.toolbarTop > bars.height / 2,
      `barra de formato abajo (${bars.toolbarTop}–${bars.toolbarBottom} de ${bars.height})`
    );
  else
    expect(
      name,
      bars.toolbarTop >= 0 && bars.toolbarTop < 150,
      `barra de formato arriba (${bars.toolbarTop})`
    );
  expect(
    name,
    bars.hiddenScroll <= 1,
    `barra de acciones sin scroll escondido (${bars.hiddenScroll}px)`
  );
  if (isPhone)
    expect(
      name,
      bars.more && bars.buttons <= 5,
      `barra de acciones: ${bars.buttons} botones y ⋮ (${bars.more})`
    );
  await shot("nota");
  if (isPhone) {
    // Every tool left out of the row is in "⋮".
    await page.locator(".editor-action-bar .editor-more").click();
    await page.waitForTimeout(400);
    const items = await page
      .locator("[role=menuitem]:visible")
      .evaluateAll((all) => all.map((each) => each.textContent.trim()));
    await shot("menú ⋮");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const missing = [
      "Índice",
      "Concordancia",
      "Diccionario bíblico",
      "Propiedades"
    ].filter((tool) => !items.includes(tool));
    expect(
      name,
      missing.length === 0,
      `en ⋮: ${items.join(", ")}${
        missing.length ? `; faltan ${missing.join(", ")}` : ""
      }`
    );
  }

  // A study panel.
  const panel = await page.evaluate(async () => {
    const title = "Concordancia";
    let button = document.querySelector(
      `.editor-action-bar button[title="${title}"]`
    );
    if (!button || button.offsetParent === null) {
      document.querySelector(".editor-action-bar .editor-more")?.click();
      await new Promise((r) => setTimeout(r, 400));
      button = [...document.querySelectorAll("[role=menuitem], button")].find(
        (each) => each.textContent?.trim() === title
      );
    }
    if (!button) return -1;
    button.click();
    await new Promise((r) => setTimeout(r, 800));
    // Covered: the panel lies over the note, with its arrow back.
    if (document.querySelector(".pane-back")) return 0;
    const note = document.querySelector(".ProseMirror:not([hidden])");
    return Math.round(note?.getBoundingClientRect().width || 0);
  });
  expect(
    name,
    panel === 0 || panel >= 400,
    `con la concordancia la nota mide ${panel}px (0 = la cubre)`
  );
  await shot("panel");
  await page.evaluate(() => {
    const back = document.querySelector(".pane-back");
    if (back) return back.click();
    document
      .querySelector('.editor-action-bar button[title="Concordancia"]')
      ?.click();
  });
  await page.waitForTimeout(500);

  // Ajustes.
  await page.evaluate(() => (location.hash = "#/settings"));
  const modal = page.locator(".ReactModal__Content").first();
  await modal.waitFor();
  await page.waitForTimeout(800);
  expect(name, await fitsScreen(), `Ajustes cabe en la pantalla`);
  await shot("ajustes");
  if (isPhone) {
    const close = modal.locator('button[title="Cerrar"]');
    expect(name, await close.isVisible(), `Ajustes tiene la X`);
    // Every section of the list: in, fits, back.
    const sections = await modal
      .locator("div[title]:visible")
      .evaluateAll((all) => all.map((each) => each.title));
    const stuck = [];
    for (const section of sections) {
      await modal.locator(`div[title="${section}"]:visible`).first().click();
      await page.waitForTimeout(300);
      const back = modal.locator('button[title="Atrás"]');
      if (
        !(await back.isVisible()) ||
        !(await close.isVisible()) ||
        !(await fitsScreen())
      )
        stuck.push(section);
      if (section === sections[0]) await shot("ajustes sección");
      if (await back.isVisible()) await back.click();
      await page.waitForTimeout(200);
    }
    expect(
      name,
      sections.length > 5 && stuck.length === 0,
      `${sections.length} secciones con atrás, X y caben${
        stuck.length ? `; fallan: ${stuck.join(", ")}` : ""
      }`
    );
    if (await close.isVisible()) await close.click();
  } else await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  expect(
    name,
    (await page.locator(".ReactModal__Content").count()) === 0,
    `Ajustes se cierra`
  );

  // The note's menu in the list: back to the list on a phone first.
  const noteMenu = async () => {
    if (await page.locator("#slider").count()) {
      const list = page.locator(
        "[data-virtuoso-scroller]:visible [data-index]"
      );
      if (!(await list.count()))
        await page.locator(".editor-action-bar button").first().click();
      await page.waitForTimeout(800);
    }
    await page
      .locator("[data-virtuoso-scroller]:visible [data-index]")
      .first()
      .click({ button: "right" });
    await page.waitForTimeout(300);
  };

  // Other dialogs: they fit, show the X, and the X closes them.
  if (isPhone)
    for (const [what, path] of [
      ["Compartir", ["Compartir"]],
      ["Guardar como plantilla", ["Guardar como plantilla"]]
    ]) {
      await noteMenu();
      for (const item of path)
        await page.getByText(item, { exact: true }).last().click();
      const dialog = page.locator(".ReactModal__Content").last();
      await dialog.waitFor();
      await page.waitForTimeout(1500);
      const close = dialog.locator('[title="Cerrar"]');
      const ok = (await fitsScreen()) && (await close.isVisible());
      await shot(what);
      if (await close.isVisible()) await close.click();
      await page.waitForTimeout(800);
      expect(
        name,
        ok && (await page.locator(".ReactModal__Content").count()) === 0,
        `${what}: cabe, tiene la X y la X la cierra`
      );
    }

  // Exporting one note has no dialog, it downloads the file; the submenu
  // used to open off the screen on a phone.
  if (isPhone) {
    await noteMenu();
    await page.getByText("Exportar como", { exact: true }).last().click();
    const markdown = page.getByText("Markdown", { exact: true }).last();
    await page.waitForTimeout(500);
    const inside = await markdown.evaluate((each) => {
      const box = each.getBoundingClientRect();
      return box.right <= innerWidth && box.bottom <= innerHeight;
    });
    await shot("exportar como");
    const download = inside
      ? await Promise.all([
          page.waitForEvent("download", { timeout: 30_000 }),
          markdown.click()
        ]).then(([file]) => file.suggestedFilename(), () => "")
      : "";
    expect(
      name,
      inside && download.endsWith(".md"),
      `Exportar como → Markdown: el submenú cabe y descarga ${download || "nada"}`
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // Sermon mode, from the note's menu in the list.
  if (isPhone) {
    await noteMenu();
    await page.getByText("Modo sermón", { exact: true }).click();
    const bar = await page.locator(".sermon-mode-controls").evaluate((each) => {
      const box = each.getBoundingClientRect();
      return { left: box.left, right: box.right, width: innerWidth };
    });
    expect(
      name,
      bar.left <= 1 && Math.abs(bar.right - bar.width) <= 1,
      `barra del modo sermón de lado a lado (${bar.left}–${bar.right} de ${bar.width})`
    );
    await shot("sermón");
  }

  await context.close();
}

// The welcome, on a phone's first start.
{
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(site);
  const dialog = page.locator(".ReactModal__Content").last();
  await dialog.waitFor();
  await page.waitForTimeout(1500);
  const close = dialog.locator('[title="Cerrar"]');
  const visible = await close.isVisible();
  if (shots)
    await page.screenshot({ path: join(shots, "iPhone - bienvenida.png") });
  if (visible) await close.click();
  await page.waitForTimeout(800);
  expect(
    "iPhone",
    visible && (await page.locator(".ReactModal__Content").count()) === 0,
    "bienvenida: tiene la X y la X la cierra"
  );
  await context.close();
}

await browser.close();
console.log(problems.length ? "NO-GREEN" : "GREEN: Fases 1–5.");
process.exit(problems.length ? 1 : 0);
