/*
This file is part of the Epigrapho project, a fork of Notesnook
(https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import { app } from "electron";
import { ChildProcess, spawn } from "child_process";
import { createServer } from "net";
import path from "path";
import { config } from "./config";
import { spellCheckerLanguages } from "./spell-check";

/**
 * The grammar checker (ADR-0010): LanguageTool, on this machine, as a Java
 * process of its own that only listens on 127.0.0.1.
 *
 * It is started once the window is up and only while the checker is on, and
 * it is stopped with the app or with the switch. A crash restarts it after a
 * growing wait; three in a row and it stays down, because a checker that
 * keeps dying would otherwise keep eating the machine.
 *
 * What crosses to it is the paragraph being checked and nothing else, and it
 * never leaves the machine.
 */
const MAX_FAILURES = 3;
const STARTUP_TIMEOUT = 60_000;
// Measured in ADR-0010: a larger heap made no check faster.
const JAVA_OPTIONS = ["-Xmx256m", "-XX:+UseSerialGC"];

/** How LanguageTool names the languages the spell checker offers. */
const LANGUAGES: Record<string, string> = { es: "es", en: "en-US" };
/** Spelling is nspell's job (utils/spell-check); two squiggles for one typo is noise. */
const SPELLING_RULES = ["MORFOLOGIK_RULE_ES", "MORFOLOGIK_RULE_EN_US"];
/**
 * Style, off unless the person turns it on (ADR-0010). The Spanish and
 * English modules name their style categories differently.
 */
const STYLE_CATEGORIES = [
  "STYLE",
  "REDUNDANCY",
  "REDUNDANCIES",
  "REPETITIONS_STYLE",
  "PREFERABLE_EXPRESSIONS",
  "PLAIN_ENGLISH"
];

export type GrammarMatch = {
  offset: number;
  length: number;
  message: string;
  ruleId: string;
  replacements: string[];
};

export type GrammarStatus = "off" | "starting" | "ready" | "failed";

let child: ChildProcess | undefined;
let ready: Promise<number> | undefined;
let status: GrammarStatus = "off";
let failures = 0;
let stopping = false;
let restartTimer: ReturnType<typeof setTimeout> | undefined;

/** The unpacked runtime and jars: beside the app once installed, in target/ while developing. */
function runtime() {
  const os = { win32: "win", darwin: "mac", linux: "linux" }[
    process.platform as "win32" | "darwin" | "linux"
  ];
  const home = app.isPackaged
    ? path.join(process.resourcesPath, "languagetool")
    : path.join(__dirname, "..", "languagetool", "target");
  const jre = app.isPackaged
    ? path.join(home, "jre")
    : path.join(home, `jre-${os}-${process.arch}`);
  return {
    java: path.join(
      jre,
      "bin",
      process.platform === "win32" ? "java.exe" : "java"
    ),
    // Java expands the trailing * itself; no shell is involved.
    classpath: path.join(home, "lib", "*")
  };
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port"))
      );
    });
  });
}

async function waitUntilUp(port: number, server: ChildProcess) {
  const deadline = Date.now() + STARTUP_TIMEOUT;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("LanguageTool exited");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v2/languages`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("LanguageTool did not start in time");
}

async function launch(): Promise<number> {
  const port = await freePort();
  const { java, classpath } = runtime();
  const server = spawn(
    java,
    [
      ...JAVA_OPTIONS,
      "-cp",
      classpath,
      "org.languagetool.server.HTTPServer",
      "--port",
      String(port)
    ],
    { stdio: "ignore", windowsHide: true }
  );
  child = server;
  server.once("exit", () => {
    if (child === server) onExit();
  });
  server.once("error", (error) => {
    console.error("could not start LanguageTool", error);
    if (child === server) onExit();
  });
  await waitUntilUp(port, server);
  failures = 0;
  status = "ready";
  return port;
}

function onExit() {
  child = undefined;
  ready = undefined;
  if (stopping) return;
  failures++;
  if (failures >= MAX_FAILURES) {
    status = "failed";
    console.error(`LanguageTool stopped ${failures} times; giving up`);
    return;
  }
  restartTimer = setTimeout(startGrammarChecker, 1000 * 2 ** (failures - 1));
}

/** Starts LanguageTool if it is on and not already up; resolves to its port. */
export function startGrammarChecker(): Promise<number> | undefined {
  if (!config.isGrammarCheckerEnabled || status === "failed") return;
  if (ready) return ready;
  stopping = false;
  status = "starting";
  ready = launch();
  ready.catch((error) => {
    console.error("LanguageTool is not available", error);
    child?.kill();
  });
  return ready;
}

export function stopGrammarChecker() {
  stopping = true;
  clearTimeout(restartTimer);
  child?.kill();
  child = undefined;
  ready = undefined;
  failures = 0;
  status = "off";
}

export function grammarCheckerStatus(): GrammarStatus {
  return status;
}

/** The process id, for tests that watch it come and go. */
export function grammarCheckerPid() {
  return child?.pid;
}

const SPANISH =
  /\b(el|la|los|las|de|que|y|en|un|una|es|por|con|para|no|se|su|del|al|como|pero|más)\b/gi;
const ENGLISH =
  /\b(the|of|and|to|in|is|that|it|for|was|with|as|on|be|at|by|this|but|not|are|his)\b/gi;

/**
 * Which of the person's languages a paragraph is in. LanguageTool's own
 * guesser would also answer Catalan or Portuguese, whose dictionaries are not
 * shipped, so the choice is made here among the ones that are.
 * ponytail: common-word count, a real detector if mixed paragraphs misfire.
 */
export function languageOf(text: string, enabled: string[]) {
  if (enabled.length === 1) return enabled[0];
  const spanish = text.match(SPANISH)?.length ?? 0;
  const english = text.match(ENGLISH)?.length ?? 0;
  if (enabled.includes("en") && english > spanish) return "en";
  return enabled.includes("es") ? "es" : enabled[0];
}

/** Grammar matches for one paragraph, or none when the checker is off or down. */
export async function checkGrammar(text: string): Promise<GrammarMatch[]> {
  const port = await startGrammarChecker()?.catch(() => undefined);
  if (!port || !text.trim()) return [];
  const language = LANGUAGES[languageOf(text, spellCheckerLanguages())];
  const body = new URLSearchParams({
    text,
    language,
    disabledRules: SPELLING_RULES.join(",")
  });
  // With style on, "picky" also runs the rules LanguageTool keeps for
  // careful writing, such as sentences that all start with the same word.
  if (config.grammarStyleRules) body.set("level", "picky");
  else body.set("disabledCategories", STYLE_CATEGORIES.join(","));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v2/check`, {
      method: "POST",
      body
    });
    if (!response.ok) return [];
    const result = (await response.json()) as {
      matches: {
        offset: number;
        length: number;
        message: string;
        rule: { id: string };
        replacements: { value: string }[];
      }[];
    };
    return result.matches.map((match) => ({
      offset: match.offset,
      length: match.length,
      message: match.message,
      ruleId: match.rule.id,
      replacements: match.replacements.slice(0, 5).map((each) => each.value)
    }));
  } catch (error) {
    // A restart in progress: this paragraph is checked again on its next edit.
    console.error("grammar check failed", error);
    return [];
  }
}
