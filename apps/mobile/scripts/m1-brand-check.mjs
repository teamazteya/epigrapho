// SPDX-License-Identifier: GPL-3.0-or-later
// The phone app's counterpart of apps/desktop/scripts/a1-brand-check.mjs:
// nothing a person sees names Notesnook, its company or its community, and no
// link or identifier points at them.
//
// It reads the sources rather than driving the app, because most of what it
// guards (the Android manifest, native strings, the iOS plist, links opened
// from a menu) is never on screen at once. What it skips is what the project
// keeps on purpose: GPL headers, the internal @notesnook/* package names and
// identifiers such as NotesnookModule, the nn:// links stored in notes, and
// comments that explain upstream.
//
//   node scripts/m1-brand-check.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobile = fileURLToPath(new URL("../", import.meta.url));
const UPSTREAM = /notesnook|streetwriters|discord|telegram|mastodon/i;

/** What may stay, matched against the whole line. */
const KEPT = [
  /This file is part of the (Notesnook|Epigrapho) project/, // GPL header
  /\(https:\/\/notesnook\.com\/\)/, // the header's second line
  /Streetwriters \(Private\) Limited/, // copyright line
  /@notesnook\//, // internal package names
  /@streetwriters\//, // their npm forks (kysely, showdown)
  /^\s*(\/\/|\*|\/\*)/, // comments
  /\bNotesnook(Module\w*|TileService|Share)\b/, // internal identifiers
  /\bnotesnook-module\b/,
  /"Notesnook"\s*[,);]?\s*$/, // the React component name native code registers
  /\be2e\/test\.ids\b|testID=|\bnotesnook\.(ids|buttons|list|listitem|toast|editor)\b/, // test ids
  // Names no one reads: keychain entries and salts (changing a salt would
  // lock the database), the vault's check string, the core database's own
  // name in migrations, the editor session and the note-input notification.
  /NOTESNOOK_(APPLOCK|DB)_KEY_SALT|"notesnook:db"|Credentials\("notesnook"\)|^\s*"notesnook",?$/,
  /plainText === "notesnook"|name !== "notesnook"|"notesnook-editor"|"notesnookvault"/,
  /"notesnook_note_input"|mainComponent: "notesnook"/,
  // The core's sync hosts, kept as on the desktop: without an account they
  // are never reached (a269d505d, "Sync and monographs stay in the tree").
  /^\s*(API|AUTH|SSE|SUBSCRIPTIONS|ISSUES|NOTESNOOK)_HOST: "https:\/\//
];

const SOURCES = [
  { dir: "app", ext: /\.(ts|tsx|js|jsx)$/ },
  {
    dir: "android/app/src/main",
    ext: /\.(xml|java|kt)$/,
    skip: /[\\/]assets[\\/]/
  },
  {
    dir: "ios",
    ext: /\.(plist|entitlements|xcconfig|swift|m|strings)$/,
    skip: /[\\/](Pods|build)[\\/]/
  },
  { file: "app.json" },
  { file: "index.js" }
];

// The Spanish catalog is shared with the desktop, so it holds strings the
// phone never shows (the Discord and Telegram links among them); those are
// caught above, where the app would use them (strings.joinDiscord…). Here a
// message only fails if it names Notesnook itself, except the importer's,
// which is the one place the desktop names it too.
const CATALOG = "../../packages/intl/locales/$es-MX.json";
const IMPORTER = /^En Notesnook abre Ajustes/;

function* walk(dir, ext, skip) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (skip?.test(full) || name === "node_modules") continue;
    if (statSync(full).isDirectory()) yield* walk(full, ext, skip);
    else if (ext.test(name)) yield full;
  }
}

const files = SOURCES.flatMap((source) =>
  source.file
    ? [path.join(mobile, source.file)]
    : [...walk(path.join(mobile, source.dir), source.ext, source.skip)]
);

const found = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (UPSTREAM.test(line) && !KEPT.some((kept) => kept.test(line)))
      found.push(
        `${path.relative(mobile, file)}:${index + 1}: ${line
          .trim()
          .slice(0, 140)}`
      );
  });
}

const { messages } = JSON.parse(
  readFileSync(path.join(mobile, CATALOG), "utf8")
);
for (const [id, message] of Object.entries(messages)) {
  const text = JSON.stringify(message);
  if (/notesnook|streetwriters/i.test(text) && !IMPORTER.test(message[0]))
    found.push(`${CATALOG} ${id}: ${text.slice(0, 140)}`);
}

console.log(`${files.length} archivos leídos y el catálogo es-MX`);
if (found.length) {
  console.log(found.join("\n"));
  console.log(
    `NO-GREEN: ${found.length} líneas nombran a Notesnook o a su comunidad`
  );
  process.exit(1);
}
console.log("GREEN: nada visible nombra a Notesnook");
