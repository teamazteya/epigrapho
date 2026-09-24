const SCOPES = [
  // for full list of scopes + details see: https://github.com/streetwriters/notesnook/blob/master/CONTRIBUTING.md#commit-guidelines

  "mobile",
  "web",
  "vericrypt",
  "monograph",
  "desktop",
  "crypto",
  "editor",
  "logger",
  "theme",
  "server",
  "core",
  "fs",
  "ui",
  "clipper",
  "config",
  "ci",
  "setup",
  "docs",
  "refactor",
  "misc",
  "common",
  "global",
  "docs",
  "themebuilder",
  "intl",
  "webclipper"
];

module.exports = {
  rules: {
    // Upstream asks contributors who are not listed in AUTHORS to sign their
    // commits off, which is how Notesnook collects a DCO on patches sent to
    // it. Epigrapho is a fork with its own repository and takes no patches
    // through that route, so the rule has nothing left to enforce here.
    "type-enum": [2, "always", SCOPES],
    "type-empty": [2, "never"]
  }
};
