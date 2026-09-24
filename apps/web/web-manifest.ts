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
  description:
    "A fully open source & end-to-end encrypted note taking alternative to Evernote.",
  short_name: "Epigrapho",
  shortcuts: [
    {
      name: "New note",
      url: "/#/notes/create",
      description: "Create a new note",
      icons: [
        {
          src: "/android-chrome-192x192.png",
          sizes: "192x192",
          type: "image/png"
        }
      ]
    },
    {
      name: "New notebook",
      url: "/#/notebooks/create",
      description: "Create a new notebook",
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
  theme_color: "#01c352",
  background_color: "#ffffff",
  display: "standalone",
  categories: ["productivity", "lifestyle", "education", "books"]
};
