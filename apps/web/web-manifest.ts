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

import { ManifestOptions } from "vite-plugin-pwa";

export const WEB_MANIFEST: Partial<ManifestOptions> = {
  name: "Epigrapho",
  // Epigrapho (W1): the installed app on iPhone and iPad, in Spanish first.
  description:
    "Notas privadas que entienden las referencias bíblicas, cifradas de extremo a extremo.",
  lang: "es-MX",
  short_name: "Epigrapho",
  shortcuts: [
    {
      name: "Nueva nota",
      url: "/#/notes/create",
      description: "Crea una nota nueva",
      icons: [
        {
          src: "/android-chrome-192x192.png",
          sizes: "192x192",
          type: "image/png"
        }
      ]
    },
    {
      name: "Nuevo cuaderno",
      url: "/#/notebooks/create",
      description: "Crea un cuaderno nuevo",
      icons: [
        {
          src: "/android-chrome-192x192.png",
          sizes: "192x192",
          type: "image/png"
        }
      ]
    }
  ],
  icons: [
    {
      src: "/android-chrome-192x192.png",
      sizes: "192x192",
      type: "image/png"
    },
    {
      src: "/android-chrome-512x512.png",
      sizes: "512x512",
      type: "image/png"
    },
    {
      src: "/android-chrome-maskable-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable"
    },
    {
      src: "/android-chrome-maskable-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable"
    }
  ],
  related_applications: [],
  prefer_related_applications: false,
  orientation: "any",
  start_url: ".",
  theme_color: "#17223B",
  background_color: "#ffffff",
  display: "standalone",
  categories: ["productivity", "lifestyle", "education", "books"]
};
