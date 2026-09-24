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
import "./app.css";
import { AppEventManager, AppEvents } from "./common/app-events";
import { register } from "./service-worker-registration";
import { getServiceWorkerVersion } from "./utils/version";
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
    import("@notesnook/scripture-provider").then(({ loadPacks }) =>
      loadPacks("/").catch((error) =>
        console.error("could not load the scripture packs", error)
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
    onSuccess() {
      registerStreamSaver();
    }
  });

  // window.addEventListener("beforeinstallprompt", () => showInstallNotice());
}
