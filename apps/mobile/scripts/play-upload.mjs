// SPDX-License-Identifier: GPL-3.0-or-later
// Uploads an App Bundle to a Play Console track through the Android Publisher
// API, with only what Node ships with:
//   PLAY_SERVICE_ACCOUNT_JSON='{…}' node scripts/play-upload.mjs app.aab notes.txt
// The release goes to the internal track, out to its testers at once.
// Production stays a click in the console. PLAY_TRACK picks another track.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const PACKAGE = "tech.azteya.epigrapho";
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;
const track = process.env.PLAY_TRACK || "internal";
const [bundle, notesFile] = process.argv.slice(2);
if (!bundle || !process.env.PLAY_SERVICE_ACCOUNT_JSON) {
  console.error("Uso: PLAY_SERVICE_ACCOUNT_JSON=… node scripts/play-upload.mjs app.aab [notas.txt]");
  process.exit(1);
}
const account = JSON.parse(process.env.PLAY_SERVICE_ACCOUNT_JSON);

// A service account trades a signed JWT for an access token.
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
  iss: account.client_email,
  scope: "https://www.googleapis.com/auth/androidpublisher",
  aud: account.token_uri,
  iat: now,
  exp: now + 3600
})}`;
const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
let token;
token = await call(account.token_uri, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${signature}`
  })
}).then((r) => r.access_token);

async function call(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...init.headers }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${url.split("?")[0]}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}
const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body && JSON.stringify(body)
});

// One edit: upload the bundle, put it on the track, commit.
const edit = (await call(`${API}/edits`, json("POST", {}))).id;
let versionCode;
try {
  ({ versionCode } = await call(`${UPLOAD}/edits/${edit}/bundles?uploadType=media`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: readFileSync(bundle)
  }));
} catch (e) {
  // A tag run again after another job failed: Play already has this version.
  if (!/already been used/i.test(e.message)) throw e;
  console.log("Play ya tiene esta versión; no se sube de nuevo.");
  process.exit(0);
}
// Play allows 500 characters of notes per language.
const notes = notesFile ? readFileSync(notesFile, "utf8").trim().slice(0, 500) : "";
await call(
  `${API}/edits/${edit}/tracks/${track}`,
  json("PUT", {
    track,
    releases: [
      {
        name: process.env.PLAY_RELEASE_NAME,
        versionCodes: [String(versionCode)],
        status: "completed",
        releaseNotes: notes ? [{ language: "es-419", text: notes }] : undefined
      }
    ]
  })
);
await call(`${API}/edits/${edit}:commit`, json("POST"));
console.log(`versionCode ${versionCode} en la pista ${track} de Play`);
