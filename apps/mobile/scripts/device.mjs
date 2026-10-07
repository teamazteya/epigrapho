// SPDX-License-Identifier: GPL-3.0-or-later
// What the M1 checks share: the phone on adb, its native screens read with
// uiautomator, and the note editor's WebView over the DevTools protocol.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP = "tech.azteya.epigrapho";
const evidence = fileURLToPath(
  new URL("../../../../evidence/m1/", import.meta.url)
);
mkdirSync(evidence, { recursive: true });
const sdk =
  process.env.ANDROID_HOME ||
  path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
const ADB = path.join(
  sdk,
  "platform-tools",
  process.platform === "win32" ? "adb.exe" : "adb"
);

export function adb(...args) {
  const result = spawnSync(ADB, args, {
    encoding: "utf8",
    maxBuffer: 64 << 20
  });
  // Three words name the command; what follows may be a password typed in.
  if (result.status !== 0)
    throw new Error(`adb ${args.slice(0, 3).join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** Types into the focused field, as the keyboard would. */
export function typeText(text) {
  const quoted = text.replace(/ /g, "%s").replace(/'/g, `'\\''`);
  adb("shell", "input", "text", `'${quoted}'`);
}
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every node on screen with its text and centre. */
export function screen() {
  const xml = adb("exec-out", "uiautomator", "dump", "/dev/tty");
  return [
    ...xml.matchAll(
      /<node [^>]*?text="([^"]*)" resource-id="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g
    )
  ].map(([, text, id, desc, x1, y1, x2, y2]) => ({
    text: text.replace(/&amp;/g, "&").replace(/&quot;/g, '"'),
    id,
    desc,
    x: (Number(x1) + Number(x2)) >> 1,
    y: (Number(y1) + Number(y2)) >> 1
  }));
}

export async function waitFor(label, timeout = 60000) {
  const until = Date.now() + timeout;
  for (;;) {
    const nodes = screen();
    const found = nodes.find(
      (node) => node.text === label || node.desc === label || node.id === label
    );
    if (found) return found;
    // A cold emulator often says the system UI is not responding; a person
    // would wait.
    const wait = nodes.find((node) => node.text === "Wait");
    if (nodes.some((node) => / isn't responding$/.test(node.text)) && wait)
      adb("shell", "input", "tap", `${wait.x}`, `${wait.y}`);
    if (Date.now() > until) throw new Error(`no apareció «${label}»`);
    await sleep(1000);
  }
}

export async function tap(label, timeout) {
  const node = await waitFor(label, timeout);
  adb("shell", "input", "tap", `${node.x}`, `${node.y}`);
  await sleep(1500);
}

export const visibleText = () =>
  screen()
    .map((node) => node.text)
    .join("\n");

export function shot(name) {
  const png = spawnSync(ADB, ["exec-out", "screencap", "-p"], {
    maxBuffer: 64 << 20
  }).stdout;
  writeFileSync(path.join(evidence, `${name}.png`), png);
}

/**
 * The page of the WebView that holds the note editor, over DevTools.
 * ponytail: Playwright's connectOverCDP needs browser-level commands an
 * Android WebView does not have, so this speaks the protocol to the page
 * directly: evaluate to read it, Input.* for real touches and typing.
 */
export async function connectToEditor() {
  // A process that died (an emulator snapshot, a crash) can leave its socket
  // listed; the one that counts carries the app's pid.
  const pid = adb("shell", "pidof", APP).trim();
  const socket = `webview_devtools_remote_${pid}`;
  assert.ok(
    adb("shell", "cat", "/proc/net/unix").includes(`@${socket}`),
    "el WebView no expone DevTools (¿build de debug?)"
  );
  adb("forward", "tcp:9333", `localabstract:${socket}`);
  const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
  for (const target of targets.filter((t) => t.type === "page")) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    // A page that goes away answers nothing; say so instead of waiting.
    socket.onclose = () => {
      for (const answer of pending.values())
        answer({ error: { message: "el WebView cerró DevTools" } });
      pending.clear();
    };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        pending.set(++id, (message) =>
          message.error
            ? reject(new Error(message.error.message))
            : resolve(message.result)
        );
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (exceptionDetails)
        throw new Error(
          exceptionDetails.exception?.description || exceptionDetails.text
        );
      return result.value;
    };
    if (await evaluate(`!!document.querySelector(".ProseMirror")`))
      return {
        send,
        evaluate,
        close: () => {
          socket.close();
          adb("forward", "--remove", "tcp:9333");
        }
      };
    socket.close();
  }
  throw new Error("no encontré el editor en el WebView");
}

/**
 * What a person does in the editor's page: wait for something, tap it, type,
 * press Enter. Touches and keys go through DevTools' Input domain, as real
 * ones do.
 */
export function editorTools(cdp) {
  const $ = (expression) => cdp.evaluate(expression);
  const waitUntil = async (expression, label, timeout = 30000) => {
    const until = Date.now() + timeout;
    while (!(await $(expression))) {
      if (Date.now() > until) throw new Error(`en el editor no pasó: ${label}`);
      await sleep(500);
    }
  };
  const tapOn = async (selector) => {
    // A person scrolls to what they want to tap, and the page stops moving
    // before the finger lands; so does this. (A scroll event arriving after
    // the tap closes what the tap opened.)
    const element = `document.querySelector(${JSON.stringify(selector)})`;
    await $(`${element}?.scrollIntoView({ block: "center" })`);
    await sleep(300);
    const box = await $(
      `(() => { const e = ${element}; if (!e) return; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`
    );
    assert.ok(box, `no está ${selector}`);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x, y: box.y }]
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });
    await sleep(800);
  };
  const type = async (text) => {
    for (const char of text) {
      await cdp.send("Input.insertText", { text: char });
      await sleep(40);
    }
  };
  const enter = async () => {
    for (const type of ["rawKeyDown", "char", "keyUp"])
      await cdp.send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        ...(type === "char" ? { text: String.fromCharCode(13) } : {})
      });
  };
  // The keyboard takes a moment to open; what is typed before it is lost.
  const focusEnd = async () => {
    await $(`document.querySelector(".ProseMirror").editor.commands.focus("end")`);
    await sleep(800);
  };
  const insertFromMenu = async (item) => {
    await focusEnd();
    await enter();
    await sleep(800);
    await tapOn('[data-test-id="insert-block"]');
    await tapOn(`[data-test-id="menu-button-${item}"]`);
  };
  return { $, waitUntil, tapOn, type, enter, focusEnd, insertFromMenu };
}
