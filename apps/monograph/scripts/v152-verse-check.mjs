// SPDX-License-Identifier: GPL-3.0-or-later
// The same cached passage must work for old installers and numbered readers.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(path.join(tmpdir(), "epigrapho-verse-api-"));
const output = path.join(temporary, "route.mjs");
const originalFetch = globalThis.fetch;
const originalKey = process.env.API_BIBLE_KEY;
try {
  await build({
    entryPoints: ["app/routes/api.verse.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm"
  });
  let upstream = 0;
  process.env.API_BIBLE_KEY = "test-fixture";
  globalThis.fetch = async (url) => {
    assert.equal(
      new URL(url).searchParams.get("include-verse-numbers"),
      "true"
    );
    upstream++;
    return Response.json({ data: { content: "[16] Primero. [17] Segundo." } });
  };
  const { loader } = await import(pathToFileURL(output).href);
  async function passage(translation, numbered) {
    const response = await loader({
      request: new Request(
        `https://example.test/api/verse?ref=JHN.3.16-JHN.3.17&t=${translation}${
          numbered ? "&numbers=1" : ""
        }`
      )
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.translationId, translation);
    assert.ok(result.attribution);
    return result.text;
  }
  for (const translation of ["VBL", "BSB", "NTV"]) {
    const legacy = await passage(translation, false);
    const numbered = await passage(translation, true);
    assert.ok(!legacy.includes("[16]"));
    assert.match(numbered, /^\[16\] .+\n\[17\] /);
    assert.equal(numbered.replace(/(^|\n)\[\d+\] /g, " ").trim(), legacy);
    assert.equal(await passage(translation, false), legacy);
  }
  assert.equal(upstream, 1, "both formats share one numbered upstream cache");
  console.log(
    "GREEN: API compatible con lectores antiguos y nuevos, con una sola caché."
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.API_BIBLE_KEY;
  else process.env.API_BIBLE_KEY = originalKey;
  await rm(temporary, { recursive: true, force: true });
}
