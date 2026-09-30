// SPDX-License-Identifier: GPL-3.0-or-later
// Builds what the grammar checker ships with (ADR-0010): LanguageTool's jars,
// shared by every installer, and one Java runtime per platform the installers
// on this machine target, cut down with jlink to the modules LanguageTool uses.
//
// Nothing has to be installed first. A JDK and Maven are downloaded once into
// languagetool/target/cache, at pinned versions, and the runtimes for other
// platforms are linked from their JDK's jmods by this machine's jlink, which
// is why every JDK here is the same release.
//
//   node scripts/build-languagetool.mjs            the targets of this OS
//   node scripts/build-languagetool.mjs win-x64    only the ones named
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../languagetool/", import.meta.url));
const target = path.join(root, "target");
const cache = path.join(target, "cache");

const JDK = "jdk-21.0.12.1+1";
const MAVEN = "3.9.9";
// What jdeps reports for the server and the es/en modules, plus what their
// dependencies load by reflection (logging, XML, JMX, TLS).
const MODULES = [
  "java.base",
  "java.compiler",
  "java.desktop",
  "java.instrument",
  "java.logging",
  "java.management",
  "java.naming",
  "java.net.http",
  "java.scripting",
  "java.sql",
  "java.xml",
  "jdk.crypto.ec",
  "jdk.httpserver",
  "jdk.management",
  "jdk.unsupported",
  "jdk.zipfs"
];

/** electron-builder's names for a platform, and Adoptium's. */
const PLATFORMS = {
  "win-x64": { os: "windows", arch: "x64" },
  "win-arm64": { os: "windows", arch: "aarch64" },
  "mac-x64": { os: "mac", arch: "x64" },
  "mac-arm64": { os: "mac", arch: "aarch64" },
  "linux-x64": { os: "linux", arch: "x64" }
};
/** What each OS's installers are built for (electron-builder.config.js). */
const DEFAULT_TARGETS = {
  win32: ["win-x64", "win-arm64"],
  darwin: ["mac-arm64", "mac-x64"],
  linux: ["linux-x64"]
};
const HOST = `${
  { win32: "win", darwin: "mac", linux: "linux" }[process.platform]
}-${process.arch}`;
const EXE = process.platform === "win32" ? ".exe" : "";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    ...options
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}`
    );
}

async function download(url, file) {
  if (existsSync(file)) return file;
  console.log(`descargando ${url}`);
  // A server that stumbles once should not fail the installers: four
  // tries, 5, 10 and 20 seconds apart.
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(`${file}.part`)
      );
      await rename(`${file}.part`, file);
      return file;
    } catch (error) {
      if (attempt === 4) throw error;
      const wait = 5000 * 2 ** (attempt - 1);
      console.log(`  falló (${error.message}); reintento en ${wait / 1000} s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/** Unpacks an archive into its own folder, once. */
async function unpack(archive) {
  const folder = archive.replace(/\.(zip|tar\.gz)$/, "");
  if (existsSync(folder)) return folder;
  await mkdir(folder, { recursive: true });
  // Windows' own tar (bsdtar) reads zip as well as tar.gz; Git's does not.
  const tar =
    process.platform === "win32"
      ? path.join(process.env.SystemRoot, "System32", "tar.exe")
      : "tar";
  try {
    if (archive.endsWith(".zip") && process.platform !== "win32")
      run("unzip", ["-q", archive, "-d", folder]);
    // A Linux or macOS JDK unpacked on Windows: its legal/ folder is all
    // symlinks, which Windows will not create. jlink takes the licences from
    // the jmods, so that folder is not needed to build a runtime.
    else if (process.platform === "win32" && archive.endsWith(".tar.gz"))
      run(tar, ["-xf", archive, "-C", folder, "--exclude", "*/legal/*"]);
    else run(tar, ["-xf", archive, "-C", folder]);
  } catch (error) {
    // Half an archive would pass for a whole one on the next run.
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
  return folder;
}

/** The JDK of a platform, unpacked; its home differs on macOS. */
async function jdk(platform) {
  const { os, arch } = PLATFORMS[platform];
  const ext = os === "windows" ? "zip" : "tar.gz";
  const archive = await download(
    `https://api.adoptium.net/v3/binary/version/${encodeURIComponent(
      JDK
    )}/${os}/${arch}/jdk/hotspot/normal/eclipse`,
    path.join(cache, `${JDK}-${platform}.${ext}`)
  );
  const folder = await unpack(archive);
  const [top] = await readdir(folder);
  const home = path.join(folder, top);
  return existsSync(path.join(home, "Contents", "Home"))
    ? path.join(home, "Contents", "Home")
    : home;
}

async function maven() {
  const folder = await unpack(
    await download(
      // Maven Central's copy: a CDN, where archive.apache.org is one host.
      `https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/${MAVEN}/apache-maven-${MAVEN}-bin.zip`,
      path.join(cache, `apache-maven-${MAVEN}.zip`)
    )
  );
  const bin = path.join(folder, `apache-maven-${MAVEN}`, "bin");
  return path.join(bin, process.platform === "win32" ? "mvn.cmd" : "mvn");
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_TARGETS[process.platform];
for (const each of targets)
  if (!PLATFORMS[each]) throw new Error(`unknown target ${each}`);

await mkdir(cache, { recursive: true });
const host = await jdk(HOST);
const env = { ...process.env, JAVA_HOME: host };

// The jars are the same on every platform. Emptied first, so a dependency
// the pom no longer has does not linger in the installer.
await rm(path.join(target, "lib"), { recursive: true, force: true });
run(
  await maven(),
  [
    "-B",
    "-q",
    "dependency:copy-dependencies",
    "-DoutputDirectory=target/lib",
    "-DincludeScope=runtime"
  ],
  { cwd: root, env }
);

for (const platform of targets) {
  const jmods = path.join(
    platform === HOST ? host : await jdk(platform),
    "jmods"
  );
  const output = path.join(target, `jre-${platform}`);
  await rm(output, { recursive: true, force: true });
  run(path.join(host, "bin", `jlink${EXE}`), [
    "--module-path",
    jmods,
    "--add-modules",
    MODULES.join(","),
    "--strip-debug",
    "--no-man-pages",
    "--no-header-files",
    "--compress=zip-6",
    "--output",
    output
  ]);
  console.log(`runtime: ${output}`);
}
