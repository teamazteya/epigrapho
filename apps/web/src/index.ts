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

import "./polyfills";
// Epigrapho A6: first, so it sees the profile before anything writes to it.
import "./common/welcome";
import "./app.css";
import { AppEventManager, AppEvents } from "./common/app-events";
import { register } from "./service-worker-registration";
import { getServiceWorkerVersion } from "./utils/version";
import { autoUpdate } from "./utils/pwa-update";
import { register as registerStreamSaver } from "./utils/stream-saver/mitm";
import { ThemeDark, ThemeLight, themeToCSS } from "@notesnook/theme";
import Config from "./utils/config";
import { setI18nGlobal } from "@notesnook/intl";
import { i18n } from "@lingui/core";
import { activateUiLocale, getUiLocale } from "./common/ui-locale";

const colorScheme = JSON.parse(
  window.localStorage.getItem("colorScheme") || '"light"'
);
const root = document.querySelector("html");
if (root) root.setAttribute("data-theme", colorScheme);

const theme =
  colorScheme === "dark"
    ? Config.get("theme:dark", ThemeDark)
    : Config.get("theme:light", ThemeLight);
const stylesheet = document.getElementById("theme-colors");
if (theme) {
  const css = themeToCSS(theme);
  if (stylesheet) stylesheet.innerHTML = css;
} else stylesheet?.remove();

/**
 * Epigrapho (W2): resolves once the app has rendered (root.tsx marks
 * "render:app" after the database loads) and the main thread has been free
 * for a second since, ten 100 ms timers in a row that fire on time; or after
 * 60 s whatever the load. Timers, because Safari has no requestIdleCallback.
 * The database load alone is a quiet pause of seconds, so it is not enough.
 */
function whenQuiet() {
  return new Promise<void>((resolve) => {
    const gaveUp = performance.now() + 60_000;
    let calm = 0;
    const tick = () => {
      const set = performance.now();
      setTimeout(() => {
        const rendered = performance.getEntriesByName("render:app").length > 0;
        calm = rendered && performance.now() - set < 150 ? calm + 1 : 0;
        if (calm >= 10 || performance.now() > gaveUp) resolve();
        else tick();
      }, 100);
    };
    tick();
  });
}

/**
 * Epigrapho (W2): the first reference parsed in each language builds that
 * language's parser, ~100 ms (~400 ms on a phone), and it used to land on the
 * person's first keystrokes in a note. Each language is built in its own turn
 * once the app is quiet, so typing finds them ready.
 */
async function warmUpParser() {
  const { parseReferences } = await import("@notesnook/scripture-parser");
  for (const locale of ["es", "en"] as const) {
    await whenQuiet();
    parseReferences("Juan 3:16", [locale]);
  }
}

// Epigrapho: the interface language is a preference, so the catalog is chosen
// before anything renders.
activateUiLocale(getUiLocale()).then(() => {
  performance.mark("import:root");
  import("./root").then(({ startApp }) => {
    performance.mark("start:app");
    startApp();
    // Epigrapho A0: fill the offline scripture store once, after the app is up
    // so the packs never delay the first paint. They are served from the root
    // of this app; the mobile editor reads the same packs from beside itself.
    // W2: and only once the start-up work is over, which on a phone is
    // ~20 s of long tasks the packs would otherwise compete with.
    Promise.all([import("@notesnook/scripture-provider"), whenQuiet()]).then(
      ([{ loadPacks }]) =>
        loadPacks("/")
          .catch((error) =>
            console.error("could not load the scripture packs", error)
          )
          .then(warmUpParser)
    );
    // On the first start the spell checker takes the interface language,
    // which only this side knows; after that the two settings are separate.
    if (IS_DESKTOP_APP)
      import("./common/desktop-bridge").then(({ desktop }) =>
        desktop?.spellChecker.followLocale
          .mutate({ language: getUiLocale() === "en-US" ? "en" : "es" })
          .catch((error) =>
            console.error("could not set the spell check language", error)
          )
      );
  });
});
setI18nGlobal(i18n);

if (!IS_DESKTOP_APP) {
  //   logger.info("Initializing service worker...");

  // If you want your app to work offline and load faster, you can change
  // unregister() to register() below. Note this comes with some pitfalls.
  // Learn more about service workers: https://bit.ly/CRA-PWA
  register({
    onUpdate: async (registration: ServiceWorkerRegistration) => {
      if (!registration.waiting) return;
      const { formatted } = await getServiceWorkerVersion(registration.waiting);
      AppEventManager.publish(AppEvents.updateDownloadCompleted, {
        version: formatted
      });
    },
    onSuccess(registration) {
      registerStreamSaver();
      autoUpdate(registration);
    }
  });

  // window.addEventListener("beforeinstallprompt", () => showInstallNotice());
}
