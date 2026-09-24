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

/** @type {import('@lingui/conf').LinguiConfig} */
module.exports = {
  locales: ["en", "es-MX", "en-US", "pseudo-LOCALE"],
  sourceLocale: "en",
  pseudoLocale: "pseudo-LOCALE",
  fallbackLocales: {
    "pseudo-LOCALE": "en",
    // Untranslated es-MX messages fall back to English instead of rendering
    // as empty strings.
    "es-MX": "en",
    // Epigrapho: en-US is the UI locale a person picks; "en" is the source the
    // messages are written in. Everything en-US does not restate is taken from
    // it at compile time, so an English UI never shows a Spanish string.
    "en-US": "en"
  },
  catalogs: [
    {
      path: "<rootDir>/locale/{locale}",
      include: ["src", "generated"]
    }
  ],
  format: "po",
  catalogsMergePath: "<rootDir>/locales/${locale}",
  compileNamespace: "json"
};
