/* eslint-disable @typescript-eslint/no-var-requires */
import "@azure/core-asynciterator-polyfill";
import "@formatjs/intl-locale/polyfill-force";
import "@formatjs/intl-pluralrules/polyfill-force";
import "@formatjs/intl-pluralrules/locale-data/en";
import "@formatjs/intl-pluralrules/locale-data/es";
import "react-native-url-polyfill/auto";
import "./polyfills/console-time.js";
import "./app/common/logger/index";
import { setI18nGlobal } from "@notesnook/intl";
import { i18n } from "@lingui/core";
import { activateUiLocale } from "./app/common/ui-locale";
import OpenPGP from "react-native-fast-openpgp";

OpenPGP.useJSI = false;

let domParser;
Object.defineProperty(global, "DOMParser", {
  get: () => {
    if (!domParser) domParser = require("./worker.js");
    return domParser.DOMParser;
  }
});
let buffer;
Object.defineProperty(global, "Buffer", {
  get: () => {
    if (!buffer) buffer = require("buffer");
    return buffer.Buffer;
  }
});

// Epigrapho: the chosen language (Spanish by default), in development too, so
// what is checked is what ships. Upstream showed the pseudo-locale in dev.
activateUiLocale();
setI18nGlobal(i18n);

if (__DEV__) {
  try {
    const { ScriptManager, Script } = require("@callstack/repack/client");
    ScriptManager.shared.addResolver(async (scriptId) => {
      // `scriptId` will be either 'student' or 'teacher'

      // In dev mode, resolve script location to dev server.
      if (__DEV__) {
        return {
          url: Script.getDevServerURL(scriptId),
          cache: false
        };
      }

      return {
        url: Script.getFileSystemURL(scriptId)
      };
    });
  } catch (e) {
    /** ignore error when running with metro bundler */
  }
}
