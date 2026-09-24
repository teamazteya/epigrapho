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

import { test, expect } from "vitest";
import { isFeatureAvailable } from "../src/utils/is-feature-available";

// Epigrapho is free and nobody is signed in while these run, which is exactly
// the state that used to leave every one of these behind a paywall. The list is
// limited to the features the app delivers on its own: the ones that need a
// server (storage, attachment size, monographs, SMS two-factor) are a separate
// question and are still gated where they reach for that server.
const OFFLINE_FEATURES = [
  "blockLinking",
  "taskList",
  "outlineList",
  "callout",
  "defaultNotebookAndTag",
  "recurringReminders",
  "pinNoteInNotification",
  "createNoteFromNotificationDrawer",
  "defaultSidebarTab",
  "customHomepage",
  "markdownShortcuts",
  "fontLigatures",
  "customToolbarPreset",
  "customizableSidebar",
  "disableTrashCleanup",
  "appLock",
  "androidLauncherShortcuts",
  "expiringNotes",
  "exportTableAsCsv",
  "importCsvToTable"
] as const;

test.each(OFFLINE_FEATURES)(
  "%s is available without a subscription",
  async (id) => {
    const result = await isFeatureAvailable(id);
    expect(result.isAllowed).toBe(true);
  }
);
