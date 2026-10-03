/*
This file is part of the Notesnook project (https://notesnook.com/)

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

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { LRUCache } from "lru-cache";
import { ThemeDark } from "@notesnook/theme";
import path from "path";
import { fileURLToPath } from "url";
import { split } from "canvas-hypertxt";

export type OGMetadata = {
  title: string;
  description: string;
  date: string;
  tagline: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// app/utils/ while developing; output/build/server/ once built, which sits
// next to output/build/assets/. Both are ../assets.
const FONTS = path.join(__dirname, "../assets/fonts/");

// Epigrapho: Inter covers Spanish and English, the two languages a shared note
// is shown in, so the per-script Noto fonts Notesnook downloaded are gone.
GlobalFonts.registerFromPath(path.join(FONTS, "Inter-Regular.ttf"), "Inter");
GlobalFonts.registerFromPath(
  path.join(FONTS, "Inter-SemiBold.ttf"),
  "InterBold"
);

const cache = new LRUCache<string, Buffer>({
  max: 500,
  ttl: 1000 * 60 * 60 * 24,
  ttlAutopurge: true
});

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 50;
const QUALITY = 80;
const logo = loadImage(
  import.meta.env.DEV
    ? path.resolve(__dirname, "../../public/logo.png")
    : path.resolve(__dirname, "../client/logo.png")
);

export async function makeImage(metadata: OGMetadata, cacheKey: string) {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const theme = ThemeDark.scopes.base;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background, and the accent along the bottom.
  ctx.fillStyle = theme.primary.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = theme.primary.accent;
  ctx.fillRect(0, HEIGHT - 10, WIDTH, 10);

  // Logo, name and tagline.
  ctx.drawImage(await logo, PADDING, HEIGHT - PADDING - 85, 80, 80);
  ctx.fillStyle = theme.primary.heading;
  ctx.font = "600 32px InterBold";
  ctx.fillText("Epigrapho", PADDING + 100, HEIGHT - PADDING - 55);
  ctx.fillStyle = theme.secondary.paragraph;
  ctx.font = "25px Inter";
  ctx.fillText(metadata.tagline, PADDING + 100, HEIGHT - PADDING - 19);

  // Date.
  ctx.fillStyle = theme.secondary.paragraph;
  ctx.font = "25px Inter";
  ctx.fillText(metadata.date, PADDING, PADDING + 25);

  // Title.
  ctx.fillStyle = theme.primary.heading;
  ctx.font = "600 64px InterBold";
  let y = PADDING + 105;
  const titleLines = split(
    ctx as any,
    metadata.title,
    "600 64px InterBold",
    WIDTH - PADDING * 2,
    true
  ).slice(0, 3);
  for (const line of titleLines) {
    ctx.fillText(line, PADDING, y);
    y += 70;
  }

  // Opening lines.
  ctx.fillStyle = theme.primary.paragraph;
  ctx.font = "30px Inter";
  const descLines = split(
    ctx as any,
    metadata.description || "",
    "30px Inter",
    WIDTH - PADDING * 2,
    true
  ).slice(0, Math.max(0, 5 - titleLines.length));
  for (const line of descLines) {
    ctx.fillText(line, PADDING, y);
    y += 40;
  }

  const buffer = canvas.toBuffer("image/jpeg", QUALITY);
  cache.set(cacheKey, buffer);
  return buffer;
}
