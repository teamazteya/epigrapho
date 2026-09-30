// SPDX-License-Identifier: GPL-3.0-or-later
// The grammar checker's process (ADR-0010, A2 Paso 1.3): LanguageTool starts
// with the app when it is on, never starts when it is off, only talks to
// 127.0.0.1 while checking, comes back after a crash, and is gone once the
// app closes.
// Run while npm run start:desktop is serving the app on localhost:3000.
// ponytail: reads processes and sockets with PowerShell, so Windows only;
// the same questions on macOS and Linux are `pgrep -f` and `lsof -p`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function powershell(command) {
  const output = execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `${command} | ConvertTo-Json -Compress`],
    { encoding: "utf8" }
  ).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * The LanguageTool servers a given app started. The dev server's own window
 * runs one too, so only those of the app under test count.
 */
const languageTools = (launched) =>
  // Playwright's pid is a wrapper; Electron's main process is its child.
  powershell(
    `$main = Get-CimInstance Win32_Process -Filter "ParentProcessId=${launched}" | Select-Object -ExpandProperty ProcessId; Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { $_.CommandLine -like '*org.languagetool.server.HTTPServer*' -and ($main -contains $_.ParentProcessId) } | Select-Object ProcessId, ParentProcessId`
  );

const sockets = (pid) =>
  powershell(
    `Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, RemoteAddress, State`
  );

async function launch(profile) {
  const app = await _electron.launch({
    args: [path.join(root, "build", "electron.js")],
    env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
    timeout: 60000
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(120000);
  await page.getByText("Notas", { exact: true }).first().waitFor();
  return app;
}

async function until(condition, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}

// 1. On by default: it starts once the window is up.
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-grammar-"));
let app = await launch(profile);
try {
  const [server] =
    (await until(() => {
      const found = languageTools(app.process().pid);
      return found.length ? found : undefined;
    })) ?? [];
  assert.ok(server, "LanguageTool no arrancó con la app");
  console.log("proceso:", JSON.stringify(server));

  // 2. It listens on 127.0.0.1 only, and a check reaches nothing else.
  const listening = await until(() =>
    sockets(server.ProcessId).find(
      (each) => each.State === 2 || each.State === "Listen"
    )
  );
  assert.ok(listening, "LanguageTool no abrió su puerto");
  assert.equal(listening.LocalAddress, "127.0.0.1");
  const response = await fetch(
    `http://127.0.0.1:${listening.LocalPort}/v2/check`,
    {
      method: "POST",
      body: new URLSearchParams({ language: "es", text: "¿Cual prefieres?" })
    }
  );
  const { matches } = await response.json();
  console.log(
    "reglas:",
    matches.map((each) => each.rule.id)
  );
  assert.ok(matches.some((each) => each.rule.id === "CUAL_CON_TILDE"));
  const remote = sockets(server.ProcessId).filter(
    (each) =>
      !["127.0.0.1", "0.0.0.0", "::", "::1"].includes(each.RemoteAddress)
  );
  console.log("conexiones fuera de la máquina:", JSON.stringify(remote));
  assert.deepEqual(remote, []);

  // 3. A crash is followed by a new server.
  process.kill(server.ProcessId);
  const [restarted] =
    (await until(() => {
      const found = languageTools(app.process().pid).filter(
        (each) => each.ProcessId !== server.ProcessId
      );
      return found.length ? found : undefined;
    })) ?? [];
  console.log("tras la caída:", JSON.stringify(restarted));
  assert.ok(restarted, "LanguageTool no volvió después de caerse");

  // 4. Closing the app ends it.
  await app.close();
  app = undefined;
  const gone = await until(
    () =>
      powershell(
        `Get-CimInstance Win32_Process -Filter "ProcessId=${restarted.ProcessId}" | Select-Object ProcessId`
      ).length === 0,
    15000
  );
  assert.ok(gone, "LanguageTool siguió vivo después de cerrar la app");

  // 5. Off: it never starts.
  const off = await mkdtemp(
    path.join(profilesRoot(), "epigrapho-grammar-off-")
  );
  // electron's userData, which CUSTOM_USER_DATA_DIR puts in UserData/.
  await mkdir(path.join(off, "UserData"), { recursive: true });
  await writeFile(
    path.join(off, "UserData", "config.json"),
    JSON.stringify({ isGrammarCheckerEnabled: false })
  );
  app = await launch(off);
  await new Promise((resolve) => setTimeout(resolve, 10000));
  assert.deepEqual(
    languageTools(app.process().pid),
    [],
    "arrancó estando apagado"
  );

  console.log(
    "GREEN: LanguageTool arranca con la app, solo escucha en 127.0.0.1, vuelve tras caerse, muere al cerrarla y no arranca si está apagado."
  );
  console.log(`Evidencia: ${profile}`);
} finally {
  await app?.close();
}
