// SPDX-License-Identifier: GPL-3.0-or-later
// Runs a command with the Android toolchain this app builds with, so no
// session has to rediscover it:
//   JAVA_HOME     Temurin 17, downloaded once into node_modules/.cache. React
//                 Native's Gradle plugin asks for a Java 17 toolchain, and
//                 with any other JDK Gradle 9 falls into the foojay resolver
//                 the plugin pins (0.5.0), which it can no longer load.
//   ANDROID_HOME  the SDK in its default place, or the one already set
//
//   node scripts/android-env.mjs                        prints both
//   node scripts/android-env.mjs .\gradlew.bat assembleDebug   (cwd: android/)
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const JDK = "jdk-17.0.16+8";
const cache = fileURLToPath(
  new URL("../../../node_modules/.cache/android-jdk/", import.meta.url)
);
const OS = { win32: "windows", darwin: "mac", linux: "linux" }[
  process.platform
];
const ARCH = { x64: "x64", arm64: "aarch64" }[process.arch];

async function jdk17() {
  const folder = path.join(cache, JDK);
  if (!existsSync(folder)) {
    await mkdir(cache, { recursive: true });
    const ext = OS === "windows" ? "zip" : "tar.gz";
    const archive = path.join(cache, `${JDK}.${ext}`);
    if (!existsSync(archive)) {
      const url = `https://api.adoptium.net/v3/binary/version/${encodeURIComponent(
        JDK
      )}/${OS}/${ARCH}/jdk/hotspot/normal/eclipse`;
      console.log(`descargando ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(`${archive}.part`)
      );
      await rename(`${archive}.part`, archive);
    }
    await mkdir(`${folder}.part`, { recursive: true });
    // Windows' own tar (bsdtar) reads zip as well; Git's does not.
    const tar =
      OS === "windows"
        ? path.join(process.env.SystemRoot, "System32", "tar.exe")
        : "tar";
    const result = spawnSync(tar, ["-xf", archive, "-C", `${folder}.part`], {
      stdio: "inherit"
    });
    if (result.status !== 0)
      throw new Error(`no se pudo desempacar ${archive}`);
    await rename(`${folder}.part`, folder);
  }
  const [top] = readdirSync(folder);
  const home = path.join(folder, top);
  return existsSync(path.join(home, "Contents", "Home"))
    ? path.join(home, "Contents", "Home")
    : home;
}

const env = { ...process.env, JAVA_HOME: await jdk17() };
env.ANDROID_HOME ??= path.join(
  process.platform === "win32" ? env.LOCALAPPDATA : os.homedir(),
  process.platform === "win32"
    ? "Android/Sdk"
    : process.platform === "darwin"
    ? "Library/Android/sdk"
    : "Android/Sdk"
);
// Windows spells it Path; two spellings in one environment confuse cmd.
const inherited = env.PATH ?? env.Path;
delete env.Path;
env.PATH = [
  path.join(env.JAVA_HOME, "bin"),
  path.join(env.ANDROID_HOME, "platform-tools"),
  path.join(env.ANDROID_HOME, "emulator"),
  path.join(env.ANDROID_HOME, "cmdline-tools", "latest", "bin"),
  inherited
].join(path.delimiter);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.log(`JAVA_HOME=${env.JAVA_HOME}\nANDROID_HOME=${env.ANDROID_HOME}`);
  process.exit(0);
}
const result = spawnSync(command, args, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32"
});
process.exit(result.status ?? 1);
