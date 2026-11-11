// A6 Fase 6: the weekly Wiktionary copy unzips, and a bad hash or a bad file
// leaves the copy in use as it was.
// node --experimental-strip-types --test scripts/a6-wiktionary-copy.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  currentWiktionary,
  installWiktionary,
  unzip
} from "../src/utils/wiktionary-copy.ts";

/** A zip of `files`, the first stored and the rest deflated. */
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  Object.entries(files).forEach(([name, text], i) => {
    const raw = Buffer.from(text);
    const data = i === 0 ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(i === 0 ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(i === 0 ? 0 : 8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  });
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

const manifestOf = (bytes, date) => ({
  format: 1,
  date,
  source: date,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size: bytes.length
});

test("a copy installs, replaces the old one and survives bad downloads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wikt-"));
  const first = zip({ "wikt-index.json": '{"date":"1"}', "wikt-am.json": "{}" });
  assert.deepEqual([...unzip(first).keys()], ["wikt-index.json", "wikt-am.json"]);
  const one = await installWiktionary(root, manifestOf(first, "2026-11-02"), first);
  assert.equal((await currentWiktionary(root)).folder, one.folder);

  const second = zip({ "wikt-index.json": '{"date":"2"}', "wikt-am.json": "{}" });
  const two = await installWiktionary(root, manifestOf(second, "2026-11-09"), second);
  assert.deepEqual(await readdir(root), ["current.json", two.folder].sort());
  assert.equal(
    await readFile(path.join(root, two.folder, "wikt-index.json"), "utf8"),
    '{"date":"2"}'
  );

  // A wrong hash, and a file that would land outside the folder.
  const third = zip({ "wikt-index.json": '{"date":"3"}' });
  await assert.rejects(
    installWiktionary(root, { ...manifestOf(third, "2026-11-16"), sha256: "0" }, third),
    /SHA-256/
  );
  const evil = zip({ "wikt-index.json": "{}", "../wikt-x.json": "{}" });
  await assert.rejects(
    installWiktionary(root, manifestOf(evil, "2026-11-16"), evil),
    /unexpected file/
  );
  assert.equal((await currentWiktionary(root)).folder, two.folder);
  assert.deepEqual(await readdir(root), ["current.json", two.folder].sort());
});

test("the real copy from publish.sh unzips", { skip: !process.env.WIKT_ZIP }, async () => {
  const files = unzip(await readFile(process.env.WIKT_ZIP));
  assert.equal(JSON.parse(files.get("wikt-index.json")).date.length, 10);
  assert.ok(files.size > 700, `${files.size} files`);
});
