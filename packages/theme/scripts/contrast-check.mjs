// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the two default themes against WCAG 2.1 AA: 4.5:1 for text on the
// surface it sits on, 3:1 for the borders and icons that carry meaning.
//
// Run with: node packages/theme/scripts/contrast-check.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../src/theme-engine/themes/", import.meta.url);

/** sRGB channel to its linear value, per WCAG's relative luminance. */
const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((at) =>
    channel(parseInt(hex.slice(at, at + 2), 16))
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort(
    (x, y) => y - x
  );
  return (a + 0.05) / (b + 0.05);
}

/**
 * What has to be legible, and against what. A colour is only ever read on the
 * surface it is painted on, so each pair names both.
 */
const pairs = (scopes) => {
  const { primary, secondary, selected, error, success } = scopes.base;
  const nav = scopes.navigationMenu?.primary ?? secondary;
  const status = scopes.statusBar?.primary ?? secondary;
  return [
    ["base body", primary.paragraph, primary.background, 4.5],
    ["base heading", primary.heading, primary.background, 4.5],
    ["base accent", primary.accent, primary.background, 4.5],
    ["accent label", primary.accentForeground, primary.accent, 4.5],
    ["base placeholder", primary.placeholder, primary.background, 4.5],
    ["base icon", primary.icon, primary.background, 3],
    ["panel body", secondary.paragraph, secondary.background, 4.5],
    ["panel heading", secondary.heading, secondary.background, 4.5],
    ["panel accent", secondary.accent, secondary.background, 4.5],
    ["selection body", selected.paragraph, selected.background, 4.5],
    ["selection border", selected.border, selected.background, 3],
    ["error", error.paragraph, error.background, 4.5],
    ["success", success.paragraph, success.background, 4.5],
    ["navigation body", nav.paragraph, nav.background, 4.5],
    ["navigation icon", nav.icon, nav.background, 3],
    ["status bar", status.paragraph, status.background, 4.5]
  ];
};

let checked = 0;
for (const file of ["default-light", "default-dark"]) {
  const theme = JSON.parse(await readFile(new URL(`${file}.json`, root)));
  for (const [what, foreground, background, minimum] of pairs(theme.scopes)) {
    const measured = ratio(foreground, background);
    console.log(
      `${theme.name} · ${what}: ${measured.toFixed(2)}:1 (min ${minimum})`
    );
    assert.ok(
      measured >= minimum,
      `${theme.name}: ${what} is ${measured.toFixed(
        2
      )}:1 on ${background}, below the ${minimum}:1 WCAG 2.1 AA floor`
    );
    checked++;
  }
}
console.log(`\n${checked} pairs pass WCAG 2.1 AA.`);
