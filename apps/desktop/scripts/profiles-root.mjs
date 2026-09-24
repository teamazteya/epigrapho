// SPDX-License-Identifier: GPL-3.0-or-later
// Where the oracles put the throwaway app profiles they run against.
//
// Not the system temp folder: every run loads the four embedded packs into a
// fresh profile, which costs around 90 MB, and nothing cleans them up
// afterwards. On this machine that filled the system drive. They go next to
// the project instead, on the drive that has room, and `EPIGRAPHO_PROFILES`
// overrides it.
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function profilesRoot() {
  const root =
    process.env.EPIGRAPHO_PROFILES ||
    path.join(
      fileURLToPath(new URL("../../../../", import.meta.url)),
      "oracle-profiles"
    );
  try {
    mkdirSync(root, { recursive: true });
    return root;
  } catch (error) {
    console.error(`no se pudo usar ${root}: ${error.message}`);
    return os.tmpdir();
  }
}
