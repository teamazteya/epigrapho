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

const path = require("path");
const pkg = require("./package.json");

const buildRoot = process.env.NN_BUILD_ROOT || ".";
const buildFiles = [
  `${buildRoot}/build/`,
  `!${buildRoot}/build/screenshots\${/*}`,
  `!${buildRoot}/build/banner.jpg`,
  `!${buildRoot}/build/*.ico`,
  `!${buildRoot}/build/*.png`
];

const productName = process.env.NN_PRODUCT_NAME || "Epigrapho";
const appId = process.env.NN_APP_ID || "org.epigrapho.app";
const outputDir = process.env.NN_OUTPUT_DIR || "output";
const linuxExecutableName = process.env.NN_PRODUCT_NAME
  ? process.env.NN_PRODUCT_NAME.toLowerCase().replace(/\s+/g, "-")
  : "epigrapho";
const year = new Date().getFullYear();
const isBeta = pkg.version.includes("-beta");

/**
 * @type {import("app-builder-lib").Configuration}
 */
module.exports = {
  appId: appId,
  productName: productName,
  // Epigrapho is a fork: the years of work it is built on are Streetwriters',
  // and everything added on top is the fork's own. Both belong in the line
  // Windows shows in the file properties.
  copyright: `Copyright © ${year} Streetwriters (Private) Limited and the Epigrapho contributors`,
  artifactName: "epigrapho_${os}_${arch}.${ext}",
  generateUpdatesFilesForAllChannels: true,
  asar: true,
  asarUnpack: [
    "node_modules/sqlite-better-trigram-@(linux|darwin|windows)-${arch}/**/*",
    "node_modules/sqlite3-fts5-html-@(linux|darwin|windows)-${arch}/**/*"
  ],
  files: [
    "!*.chunk.js.map",
    "!*.chunk.js.LICENSE.txt",
    ...buildFiles,
    "!node_modules${/*}",
    "node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node",
    "node_modules/better-sqlite3-multiple-ciphers/lib",
    "node_modules/better-sqlite3-multiple-ciphers/package.json",
    "node_modules/file-uri-to-path",
    "node_modules/bindings",
    "node_modules/node-gyp-build",
    "node_modules/sqlite-better-trigram",
    "node_modules/sqlite3-fts5-html",
    "node_modules/sodium-native/prebuilds/${platform}-${arch}",
    {
      from: "node_modules/sqlite-better-trigram-linux-${arch}",
      to: "node_modules/sqlite-better-trigram-linux-${arch}"
    },
    {
      from: "node_modules/sqlite-better-trigram-darwin-${arch}",
      to: "node_modules/sqlite-better-trigram-darwin-${arch}"
    },
    {
      from: "node_modules/sqlite-better-trigram-windows-${arch}",
      to: "node_modules/sqlite-better-trigram-windows-${arch}"
    },

    {
      from: "node_modules/sqlite3-fts5-html-linux-${arch}",
      to: "node_modules/sqlite3-fts5-html-linux-${arch}"
    },
    {
      from: "node_modules/sqlite3-fts5-html-darwin-${arch}",
      to: "node_modules/sqlite3-fts5-html-darwin-${arch}"
    },
    {
      from: "node_modules/sqlite3-fts5-html-windows-${arch}",
      to: "node_modules/sqlite3-fts5-html-windows-${arch}"
    },

    "node_modules/sodium-native/index.js",
    "node_modules/sodium-native/package.json"
  ],
  afterPack: "./scripts/removeLocales.js",
  protocols: [{ name: "Epigrapho", schemes: ["epigrapho"] }],
  mac: {
    bundleVersion: "240",
    // Electron 37 runs on macOS 11 and later.
    minimumSystemVersion: "11.0",
    target: [
      {
        target: "dmg",
        arch: ["arm64", "x64"]
      },
      {
        target: "zip",
        arch: ["arm64", "x64"]
      }
    ],
    category: "public.app-category.productivity",
    darkModeSupport: true,
    type: "distribution",
    // Without an Apple certificate (CSC_LINK) the app is signed ad hoc. An
    // unsigned Apple Silicon app that arrives quarantined is reported as
    // "damaged", with no way to open it; an ad-hoc one gets the usual
    // "Open Anyway". The hardened runtime only matters for notarisation, and
    // ad hoc it would refuse the SQLite extensions the app loads.
    identity: process.env.CSC_LINK ? undefined : "-",
    hardenedRuntime: !!process.env.CSC_LINK,
    entitlements: "assets/entitlements.mac.plist",
    entitlementsInherit: "assets/entitlements.mac.plist",
    gatekeeperAssess: false,
    icon: "assets/icons/app.icns",
    // Notarisation needs an Apple Developer account; without one the build
    // fails instead of simply shipping unnotarised.
    notarize: false
  },
  dmg: {
    contents: [
      {
        x: 130,
        y: 220
      },
      {
        x: 410,
        y: 220,
        type: "link",
        path: "/Applications"
      }
    ],
    icon: "assets/icons/app.icns",
    title: "Instalar Epigrapho"
  },
  mas: {
    entitlements: "assets/entitlements.mas.plist",
    entitlementsInherit: "assets/entitlements.mas.inherit.plist",
    entitlementsLoginHelper: "assets/entitlements.mas.loginhelper.plist",
    hardenedRuntime: true
  },
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64", "arm64"]
      },
      {
        target: "portable",
        arch: ["x64", "arm64"]
      }
    ],
    // Signing needs a certificate Epigrapho does not have yet. With one,
    // put back: signtoolOptions: { signingHashAlgorithms: ["sha256"],
    // sign: "./scripts/sign.js" }.
    icon: "assets/icons/app.ico"
  },
  portable: {
    artifactName: "epigrapho_${os}_${arch}_portable.${ext}"
  },
  nsis: {
    oneClick: true,
    createDesktopShortcut: "always",
    deleteAppDataOnUninstall: true
  },
  linux: {
    // Epigrapho: AppImage runs on any distribution; deb is Debian and Ubuntu,
    // rpm is Fedora, pacman is Arch and CachyOS. They need Linux to be
    // built: .github/workflows/epigrapho.installers.yml does it on Ubuntu.
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
      { target: "rpm", arch: ["x64"] },
      { target: "pacman", arch: ["x64"] }
    ],
    maintainer: "Azteya <support@azteya.tech>",
    vendor: "Azteya",
    synopsis: "Notas privadas que entienden referencias bíblicas",
    category: "Office",
    icon: "assets/icons/app.icns",
    description: "Tus notas y la Escritura, en privado",
    executableName: linuxExecutableName,
    mimeTypes: ["x-scheme-handler/epigrapho"],
    desktop: {
      desktopActions: {
        "new-note": {
          Name: "Nueva nota",
          Exec: `${linuxExecutableName} new note`
        },
        "new-notebook": {
          Name: "Nueva libreta",
          Exec: `${linuxExecutableName} new notebook`
        },
        "new-reminder": {
          Name: "Nuevo recordatorio",
          Exec: `${linuxExecutableName} new reminder`
        }
      }
    }
  },
  // Epigrapho: electron-builder's default list for Arch names libraries a
  // bundled Electron never loads (http-parser, re2, minizip...), and any that
  // leaves the Arch repositories makes pacman -U refuse the package.
  // electron-builder's default list for Debian leaves out ALSA, which
  // Electron links against; Ubuntu 24.04 renamed it libasound2t64.
  deb: {
    depends: [
      "libgtk-3-0",
      "libnotify4",
      "libnss3",
      "libxss1",
      "libxtst6",
      "xdg-utils",
      "libatspi2.0-0",
      "libuuid1",
      "libsecret-1-0",
      "libasound2t64 | libasound2"
    ]
  },
  pacman: {
    depends: ["gtk3", "nss", "alsa-lib", "libxss", "libnotify", "xdg-utils"]
  },
  toolsets: {
    appimage: "1.0.2"
  },
  extraResources: ["app-update.yml", "./assets/**"],
  extraMetadata: {
    main: path.join(buildRoot, "build", "electron.js"),
    // Epigrapho: the packaged name, which also names the updater's cache
    // folder on disk. The workspace keeps its internal @notesnook/* names.
    name: "epigrapho-desktop",
    // Lets Linux desktops match the running window to its launcher and icon.
    desktopName: "epigrapho.desktop"
  },
  directories: {
    buildResources: "assets",
    output: outputDir
  },
  // Epigrapho: the updater reads its releases from here. Pointing it at
  // upstream would offer every Notesnook release as an update to this app.
  publish: [
    {
      provider: "github",
      repo: "epigrapho",
      owner: "teamazteya",
      channel: isBeta ? "beta" : "latest"
    }
  ]
};
