// SPDX-License-Identifier: GPL-3.0-or-later
// Run against the desktop dev server. Uses only an isolated, synthetic account.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import { profilesRoot } from "./profiles-root.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(profilesRoot(), "epigrapho-recovery-"));
await mkdir(path.join(profile, "UserData"));
await writeFile(path.join(profile, "UserData/config.json"), "{}");
const app = await _electron.launch({
  args: [path.join(root, "build/electron.js")],
  env: { ...process.env, CUSTOM_USER_DATA_DIR: profile },
  timeout: 60000
});

try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.closeDevTools();
      window.setSize(1280, 900);
    }
  });
  await page.setViewportSize({ width: 1100, height: 820 });
  page.setDefaultTimeout(120000);
  await page.locator('[data-test-id="create-new-note"]').first().waitFor();
  await app.evaluate(({ session }, directory) => {
    globalThis.recoveryDownloads = [];
    session.defaultSession.on("will-download", (_, item) => {
      const filename = item.getFilename();
      item.setSavePath(`${directory}/${filename}`);
      item.once("done", (_, state) => {
        globalThis.recoveryDownloads.push({ filename, state });
      });
    });
  }, profile);

  const fixture = await page.evaluate(async () => {
    const { db } = await import("/common/db.ts");
    const { useKeyStore } = await import("/interfaces/key-store.ts");
    const { RecoveryKeyDialog } = await import(
      "/dialogs/recovery-key-dialog.tsx"
    );
    const key = await db.storage().generateCryptoKey("synthetic-test-password");
    const email = "qa-recovery@example.invalid";
    await db.user.setUser({ id: "recovery-check", email, salt: key.salt });
    await useKeyStore.getState().setValue("userEncryptionKey", key.key);
    void RecoveryKeyDialog.show({});
    return { key: key.key, email };
  });

  const dialog = page.locator('[data-test-id="recovery-key-dialog"]');
  await dialog.waitFor();
  assert.equal(
    await dialog.locator('[data-test-id="recovery-key"]').textContent(),
    fixture.key
  );
  await dialog.locator("canvas").waitFor();
  // Match the center of the rendered logo against the actual Epigrapho asset.
  await page.waitForFunction(
    async () => {
      const image = new Image();
      image.src = (await import("/assets/epigrapho-logo.png?import")).default;
      await image.decode();
      const expected = document.createElement("canvas");
      expected.width = expected.height = 40;
      expected.getContext("2d").drawImage(image, 0, 0, 40, 40);
      const canvas = document.querySelector("#react-qrcode-logo");
      const actual = canvas
        .getContext("2d")
        .getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      const pixel = expected.getContext("2d").getImageData(20, 20, 1, 1).data;
      return pixel.every(
        (value, index) => Math.abs(value - actual[index]) < 15
      );
    },
    undefined,
    { timeout: 15000 }
  );
  await dialog.getByRole("button", { name: /^(Descargar|Download)$/i }).click();
  await dialog.getByRole("button", { name: /QR/i }).click();
  let downloads;
  for (let attempt = 0; attempt < 100; attempt++) {
    downloads = await app.evaluate(() => globalThis.recoveryDownloads);
    if (downloads.length === 2) break;
    await page.waitForTimeout(100);
  }
  assert.deepEqual(
    downloads.map(({ filename, state }) => [filename, state]).sort(),
    [
      [`${fixture.email}-epigrapho-recoverykey.png`, "completed"],
      [`${fixture.email}-epigrapho-recoverykey.txt`, "completed"]
    ]
  );
  assert.equal(
    await readFile(
      path.join(profile, `${fixture.email}-epigrapho-recoverykey.txt`),
      "utf8"
    ),
    fixture.key
  );
  const pngPath = path.join(
    profile,
    `${fixture.email}-epigrapho-recoverykey.png`
  );
  await dialog.screenshot({ path: path.join(profile, "recovery-dialog.png") });
  console.log(
    "PASS: active account key, Epigrapho logo, PNG and TXT filenames, TXT contents."
  );
  console.log(`Synthetic QR for decoding: ${pngPath}`);
} finally {
  await app.close();
}
