// SPDX-License-Identifier: GPL-3.0-or-later
// Fase 9: the whole A1 flow, points 2 to 8, in one profile and one install.
// Point 1 is the A0 regression and is a0-final-check.mjs, which runs on its
// own. The order is the one a person would follow: write, export, find the
// other note, change language, teach the dictionary a word, read a brand
// translation, lose the network, and open the app again.
// Run while npm run start:desktop is serving the app on localhost:3000.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const A = "Epigrapho 9 A";
const B = "Epigrapho 9 B";
const IN_ENGLISH = "Epigrapho 9 EN";
const DICTIONARY = "Epigrapho 9 Dic";
const OWN_WORD = "Quimeratón";
const ATTRIBUTION = "VBL — CC BY-SA 4.0";

const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-a1-final-"));
let app;
let page;

/** Opens the app on the profile, answering the welcome screen if it is there. */
async function open() {
  app = await _electron.launch({
    args: [path.join(root, "build", "electron.js")],
    env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
    timeout: 60000
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  // Epigrapho has no accounts, so the app opens straight into the notes
  // instead of asking anyone to sign up first.
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
}

/** Waits until the embedded packs are in the browser's database. */
const packsLoaded = () =>
  page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("epigrapho-scripture", 1);
        request.onerror = () => resolve(false);
        request.onsuccess = () => {
          const database = request.result;
          if (![...database.objectStoreNames].includes("verses")) {
            database.close();
            return resolve(false);
          }
          const count = database
            .transaction("verses", "readonly")
            .objectStore("verses")
            .count();
          count.onsuccess = () => {
            database.close();
            resolve(count.result > 0);
          };
          count.onerror = () => {
            database.close();
            resolve(false);
          };
        };
      }),
    undefined,
    { timeout: 240000 }
  );

/** Writes a note and waits for its references to be marked. */
async function writeNote(title, body, marks) {
  await page.locator('[data-test-id="create-new-note"]').first().click();
  await page.locator('.active [data-test-id="editor-title"]').fill(title);
  await page.locator(".active .ProseMirror").click();
  // The editor drops the first keystrokes while it is still settling, and a
  // mangled reference stops being a reference.
  await page.waitForTimeout(1000);
  await page.keyboard.type(body, { delay: 25 });
  if (marks)
    await page
      .locator(".active .ProseMirror span[data-scripture-ref]")
      .nth(marks - 1)
      .waitFor({ timeout: 20000 });
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
}

/** Opens a note from the list and waits for it to be the one on screen. */
async function openNote(title) {
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.active [data-test-id="editor-title"]')?.value ===
      expected,
    title,
    { timeout: 20000 }
  );
}

/** Everything about a note that must survive a change of language. */
const readNote = () =>
  page.evaluate(() => {
    const editor = document.querySelector(".active .ProseMirror");
    // The editor draws controls inside the blocks — the button that copies a
    // verse, for one — and those are interface, not note: their labels are in
    // the language of the moment and they are not stored with the note.
    const withoutControls = editor?.cloneNode(true);
    withoutControls
      ?.querySelectorAll("[data-scripture-copy]")
      .forEach((control) => control.remove());
    return {
      title: document.querySelector('.active [data-test-id="editor-title"]')
        ?.value,
      text: withoutControls?.textContent,
      refs: [...(editor?.querySelectorAll("[data-scripture-ref]") ?? [])].map(
        (element) => element.getAttribute("data-scripture-ref")
      )
    };
  });

/** Hovers the reference at `index` and waits for its own verse to arrive. */
async function hover(index) {
  await page.locator('.active [data-test-id="editor-title"]').hover();
  await page
    .locator('[data-test-id="scripture-popover"]')
    .waitFor({ state: "detached", timeout: 10000 })
    .catch(() => undefined);
  const mark = page
    .locator(".active .ProseMirror span[data-scripture-ref]")
    .nth(index);
  const ref = await mark.getAttribute("data-scripture-ref");
  await mark.hover();
  // The pointer crosses the other marks on its way, so a popover that is
  // merely filled may still be theirs.
  await page.waitForFunction(
    (expected) => {
      const popover = document.querySelector(
        '[data-test-id="scripture-popover"]'
      );
      const text = popover?.querySelector(
        '[data-test-id="scripture-popover-text"]'
      )?.textContent;
      return (
        popover?.dataset.scriptureRef === expected && !!text && text !== "…"
      );
    },
    ref,
    { timeout: 20000 }
  );
  return page.evaluate(() => {
    const notice = document.querySelector(
      '[data-test-id="scripture-popover-notice"]'
    );
    return {
      text: document.querySelector('[data-test-id="scripture-popover-text"]')
        ?.textContent,
      attribution: document.querySelector(
        '[data-test-id="scripture-popover-attribution"]'
      )?.textContent,
      // The attribution credits whoever served the words; the notice, in its
      // own line, says why those are not the ones that were asked for.
      notice: notice?.hidden ? "" : notice?.textContent
    };
  });
}

/** Leaves Settings the only way that does not leave the dialog on top. */
async function closeSettings() {
  // The hash is what keeps the dialog open, so moving off it is enough most
  // of the time. Reloading is the fallback, and it is worth avoiding: a
  // second reload on the heels of the one a language change already does
  // catches the database mid-transaction and the app comes up on its error
  // screen ("Safety level may not be changed inside a transaction").
  const modal = page.locator(".ReactModal__Content");
  await page
    .evaluate(() => (window.location.hash = "/"))
    .catch(() => undefined);
  let closed = await modal
    .waitFor({ state: "detached", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    // Nothing in the app listens for the hash to leave, so the dialog can sit
    // there; it does close on Escape, which is what a person would press.
    await modal.press("Escape").catch(() => undefined);
    closed = await modal
      .waitFor({ state: "detached", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!closed) {
    await page.evaluate(() => window.location.reload()).catch(() => undefined);
    await page.waitForLoadState("load");
    await modal.waitFor({ state: "detached" });
  }
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
}

/** Picks the interface language in Settings > Appearance; the app reloads. */
async function chooseLanguage(locale) {
  // Settings is a hash route, so this opens it whatever the sidebar is called,
  // and the section ids are the same in every language.
  await page.evaluate(() => (window.location.hash = "/settings"));
  // The dialog mounts on the hash change; filling the search before it
  // is there types into the box that is on its way out.
  await page.locator(".ReactModal__Content").waitFor();
  await page.locator('[data-test-id="settings-search"]').fill("appearance");
  const select = page.locator('[data-test-id="setting-ui-language"] select');
  await select.waitFor();
  await select.selectOption(locale);
  await page.waitForLoadState("load");
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  await closeSettings();
}

/** Picks the main translation in Settings > Editor. */
async function chooseTranslation(translationId) {
  await page.evaluate(() => (window.location.hash = "/settings"));
  // The dialog mounts on the hash change; filling the search before it
  // is there types into the box that is on its way out.
  await page.locator(".ReactModal__Content").waitFor();
  await page.locator('[data-test-id="settings-search"]').fill("editor");
  const select = page.locator(
    '[data-test-id="setting-scripture-translation"] select'
  );
  await select.waitFor();
  await select.selectOption(translationId);
  await closeSettings();
}

/**
 * What the app says about the word on a line, and — if a label is given — the
 * menu item that is clicked there. The native menu is caught on its way to
 * the screen, because opening one would stop the test.
 */
async function menuAt(line, label) {
  const box = await page
    .locator(`.active .ProseMirror p:nth-of-type(${line})`)
    .boundingBox();
  const capture = app.evaluate(({ BrowserWindow, Menu }, label) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return new Promise((resolve) => {
      let word;
      contents.once("context-menu", (_event, params) => {
        word = params.misspelledWord;
      });
      const popup = Menu.prototype.popup;
      Menu.prototype.popup = function () {
        Menu.prototype.popup = popup;
        const item = label
          ? this.items.find((item) => item.label === label)
          : undefined;
        if (item) item.click();
        resolve({
          word,
          labels: this.items.map((item) => item.label),
          clicked: !!item
        });
      };
    });
  }, label);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right"
  });
  const menu = await capture;
  if (label) assert.ok(menu.clicked, `no está "${label}" en el menú`);
  // Chromium is asked about the word again right after the click.
  await page.waitForTimeout(1500);
  return menu;
}

/**
 * Catches the exported file instead of letting it become a download: the app
 * hands it to file-saver, which dispatches a click on an anchor holding a
 * blob. A real click would open the native save dialog and stop here.
 */
const captureDownloads = () =>
  page.evaluate(() => {
    globalThis.__exported = [];
    const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
    HTMLAnchorElement.prototype.dispatchEvent = function (event) {
      if (event.type === "click" && this.download) {
        globalThis.__exported.push({ name: this.download, href: this.href });
        return true;
      }
      return dispatch.call(this, event);
    };
  });

/** Exports the note titled `title` in one format and returns the file. */
async function exportAs(title, format) {
  await page.evaluate(() => (globalThis.__exported.length = 0));
  await page
    .getByText(title, { exact: true })
    .first()
    .click({ button: "right" });
  await page.locator('[data-test-id="menu-button-export"]').click();
  // The submenu opens past the edge of the window, where a real click cannot
  // reach it; the menu answers a dispatched one just the same.
  await page
    .locator(`[data-test-id="menu-button-${format}"]`)
    .dispatchEvent("click");
  await page.waitForFunction(
    () => globalThis.__exported.length > 0,
    undefined,
    {
      timeout: 60000
    }
  );
  const file = await page.evaluate(async () => {
    const { name, href } = globalThis.__exported[0];
    return {
      name,
      text: await fetch(href).then((response) => response.text())
    };
  });
  // The report dialog stays up over the app and swallows the next click.
  await page
    .locator('[data-test-id="dialog-yes"]')
    .click({ timeout: 10000 })
    .catch(() => undefined);
  await page
    .locator(".ReactModal__Content")
    .waitFor({ state: "detached", timeout: 20000 })
    .catch(() => undefined);
  return file;
}

/** What the backlinks pane shows for the note on screen. */
const paneContents = () =>
  page.evaluate(() => {
    const pane = document.querySelector('[data-test-id="backlinks-pane"]');
    if (!pane) return undefined;
    const empty = pane.querySelector('[data-test-id="backlinks-empty"]');
    if (empty) return { empty: empty.textContent };
    return {
      groups: [...pane.querySelectorAll('[data-test-id="backlink-group"]')].map(
        (group) => ({
          ref: group.getAttribute("data-backlink-ref"),
          label: group.querySelector('[data-test-id="backlink-reference"]')
            ?.textContent,
          notes: [
            ...group.querySelectorAll('[data-test-id="backlink-note"]')
          ].map((note) => note.textContent)
        })
      )
    };
  });

/** Polls the pane until it has something to say, or gives up. */
async function paneSettles(predicate) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const pane = await paneContents();
    if (pane && predicate(pane)) return pane;
    if (Date.now() > deadline) return pane;
    await page.waitForTimeout(250);
  }
}

/**
 * Takes the network from both processes. The renderer is cut with Chromium's
 * emulation; the main process needs more, because net.fetch keeps working
 * under it, so its requests to the API are cancelled outright.
 */
async function goOffline() {
  await app.evaluate(({ BrowserWindow, session }) => {
    session.defaultSession.enableNetworkEmulation({ offline: true });
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["https://api.scripture.api.bible/*"] },
      (_details, callback) => callback({ cancel: true })
    );
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.session.enableNetworkEmulation({ offline: true });
  });
  await page
    .context()
    .setOffline(true)
    .catch(() => undefined);
}

try {
  await open();
  await packsLoaded();

  // ---- 8: exportar una nota deja las referencias legibles ----
  await writeNote(A, "Hoy leí Romanos 8:28 otra vez.", 1);
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.locator('[data-test-id="insert-block"]').first().click();
  await page.locator('[data-test-id="menu-button-scripture"]').click();
  await page
    .locator('[data-test-id="dialog-title"]', {
      hasText: /Insertar Escritura|Insert Scripture/
    })
    .waitFor();
  await page.locator(".ReactModal__Content input").first().fill("Juan 3:16");
  await page.locator('[data-test-id="dialog-yes"]').click();
  await page
    .locator(".active .ProseMirror .scripture-block")
    .waitFor({ timeout: 20000 });
  await page
    .locator('[data-test-id="editor-save-state-saved"]')
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);

  const written = await readNote();
  console.log("nota escrita:", JSON.stringify(written));
  assert.deepEqual(written.refs, ["ROM.8.28", "JHN.3.16"]);

  await captureDownloads();
  for (const format of ["md", "txt", "html"]) {
    const file = await exportAs(A, format);
    // The HTML export carries a stylesheet of its own; the note is what this
    // is about, so the log keeps the body and leaves the rest on disk.
    const body = file.text.includes("<body>")
      ? file.text.slice(file.text.indexOf("<body>"))
      : file.text;
    console.log(`8. exportada a ${format}:`, JSON.stringify(body));
    assert.ok(file.text.includes("Romanos 8:28"), `${format}: falta la marca`);
    assert.ok(file.text.includes("Juan 3:16"), `${format}: falta el bloque`);
    assert.ok(
      file.text.includes("Porque Dios amó al mundo"),
      `${format}: falta el verso`
    );
    assert.ok(file.text.includes(ATTRIBUTION), `${format}: falta atribución`);
  }
  console.log("8. las referencias siguen legibles en los tres formatos");

  // ---- 7: dos notas sobre el mismo pasaje, por backlinks ----
  await writeNote(B, "Romans 8:28 dice lo mismo.", 1);
  await openNote(A);
  await page.getByTitle("Notas sobre el mismo pasaje").first().click();
  const fromA = await paneSettles((pane) => pane.groups?.length > 0);
  console.log("7. panel desde A:", JSON.stringify(fromA));
  assert.deepEqual(fromA.groups, [
    { ref: "ROM.8.28", label: "Romanos 8:28", notes: [B] }
  ]);
  await page.locator('[data-test-id="backlink-note"]').first().click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.active [data-test-id="editor-title"]')?.value ===
      expected,
    B,
    { timeout: 20000 }
  );
  console.log("7. seguir el backlink abre la otra nota");
  // The pane stays open over the editor and leaves it a column a few words
  // wide, where a reference wraps and cannot be hovered.
  await page.getByTitle("Notas sobre el mismo pasaje").first().click();
  await page
    .locator('[data-test-id="backlinks-pane"]')
    .waitFor({ state: "detached", timeout: 10000 });

  // ---- 2: cambiar a English y volver, sin alterar la nota ----
  await chooseLanguage("en-US");
  await page.getByText("Notes", { exact: true }).first().waitFor();
  await openNote(A);
  const inEnglish = await readNote();
  console.log("2. con la interfaz en inglés:", JSON.stringify(inEnglish));
  assert.deepEqual(inEnglish, written, "la nota cambió al pasar a inglés");

  // ---- 3: con la interfaz en inglés, Juan 3:16 se sigue reconociendo ----
  await writeNote(IN_ENGLISH, "Aquí escribo Juan 3:16 en español.", 1);
  const spanishInEnglish = await readNote();
  console.log("3. nota escrita en inglés:", JSON.stringify(spanishInEnglish));
  assert.deepEqual(spanishInEnglish.refs, ["JHN.3.16"]);
  const preview = await hover(0);
  console.log("3. preview:", JSON.stringify(preview));
  assert.match(preview.text, /^“Porque Dios amó al mundo/);
  assert.equal(preview.attribution, ATTRIBUTION);

  await chooseLanguage("es-MX");
  await page.getByText("Notas", { exact: true }).first().waitFor();
  await openNote(A);
  const backInSpanish = await readNote();
  console.log("2. de vuelta en español:", JSON.stringify(backInSpanish));
  assert.deepEqual(backInSpanish, written, "la nota cambió al volver");

  // ---- 6: el diccionario ----
  await writeNote(DICTIONARY, `Yahvé\nTesalonisenses\n${OWN_WORD}`, 0);
  // The dictionary and the pack are read once, on the first question.
  await page.waitForTimeout(4000);
  const known = await menuAt(1);
  console.log("6. Yahvé:", JSON.stringify(known.word));
  assert.equal(known.word, "", "un nombre del diccionario bíblico se marcó");
  const wrong = await menuAt(2);
  console.log("6. Tesalonisenses:", JSON.stringify(wrong.labels.slice(0, 4)));
  assert.equal(wrong.word, "Tesalonisenses");
  assert.equal(wrong.labels[0], "Tesalonicenses");
  const own = await menuAt(3);
  assert.equal(own.word, OWN_WORD, "la palabra propia no estaba marcada");
  await menuAt(3, "Agregar al diccionario");
  const added = await menuAt(3);
  console.log("6. tras agregarla:", JSON.stringify(added.word));
  assert.equal(added.word, "", "la palabra agregada sigue marcada");

  // ---- 4: NBLA en línea, con atribución ----
  await chooseTranslation("NBLA");
  await openNote(A);
  const online = await hover(0);
  console.log("4. NBLA con red:", JSON.stringify(online));
  assert.ok(online.text.length > 20, "NBLA llegó vacía");
  assert.match(online.attribution, /^Nueva Biblia de las Américas Copyright/);
  assert.equal(online.notice, "", "con red no debería haber aviso");

  // ---- 5: sin red, copia guardada o traducción embebida etiquetada ----
  await goOffline();
  const blocked = await page.evaluate(() =>
    fetch("/vbl.json", { cache: "no-store" }).then(
      () => "la red sigue arriba",
      (error) => `bloqueada: ${error.message}`
    )
  );
  console.log("5. red del renderer:", blocked);
  assert.match(blocked, /^bloqueada:/, "no se pudo cortar la red");
  const mainNet = await app.evaluate(async ({ net }) => {
    try {
      const response = await net.fetch(
        "https://api.scripture.api.bible/v1/bibles",
        { cache: "no-store" }
      );
      return `status ${response.status}`;
    } catch (error) {
      return `error ${error.message}`;
    }
  });
  console.log("5. red del proceso principal:", mainNet);
  assert.match(mainNet, /^error/);

  const cached = await hover(0);
  console.log("5. sin red, pasaje ya leído:", JSON.stringify(cached));
  assert.equal(cached.text, online.text);

  await openNote(IN_ENGLISH);
  const fallback = await hover(0);
  console.log("5. sin red, pasaje nunca pedido:", JSON.stringify(fallback));
  assert.match(fallback.text, /^“Porque Dios amó al mundo/);
  assert.match(fallback.attribution, /^VBL — CC BY-SA 4\.0/);
  assert.match(fallback.notice, /Se muestra VBL en su lugar/);
  console.log("5. el núcleo sigue entero sin internet");

  // ---- y ahora el mismo perfil, abierto de nuevo ----
  await app
    .evaluate(({ BrowserWindow, session }) => {
      session.defaultSession.disableNetworkEmulation();
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.session.disableNetworkEmulation();
    })
    .catch(() => undefined);
  await app.close();
  await open();

  // The app restores the tabs it had open, and that finishes after the window
  // is already usable: opening a note before it settles gets undone.
  await page
    .locator(".active .ProseMirror")
    .waitFor({ timeout: 30000 })
    .catch(() => undefined);
  await page.waitForTimeout(3000);
  await openNote(DICTIONARY);
  await page.waitForFunction(
    (word) =>
      document
        .querySelector(".active .ProseMirror")
        ?.textContent?.includes(word),
    OWN_WORD,
    { timeout: 30000 }
  );
  await page.waitForTimeout(5000);
  const stillAccepted = await menuAt(3);
  console.log("6. tras reiniciar:", JSON.stringify(stillAccepted.word));
  assert.equal(stillAccepted.word, "", "la palabra propia no persistió");

  await openNote(A);
  const reopened = await readNote();
  console.log("2. la nota tras reiniciar:", JSON.stringify(reopened));
  assert.deepEqual(reopened, written, "la nota cambió entre sesiones");

  console.log(
    "GREEN: los puntos 2 a 8 de la Fase 9 se cumplen en un solo perfil: el idioma va y vuelve sin tocar la nota, el parser no depende de la interfaz, NBLA llega con atribución y degrada etiquetada sin red, el diccionario aprende y recuerda, los backlinks juntan las dos notas y la exportación conserva las referencias."
  );
  console.log(`Evidencia: ${profile}`);
} catch (error) {
  await page?.screenshot({ path: path.join(profile, "failure.png") });
  console.error(`Evidencia: ${profile}`);
  throw error;
} finally {
  await app?.close();
}
