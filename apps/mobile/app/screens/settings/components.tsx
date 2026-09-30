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

import React, { ReactElement } from "react";
import DebugLogs from "./debug";
import { ConfigureToolbar } from "./editor/configure-toolbar";
import { Licenses } from "./licenses";
import {
  ApplockTimerPicker,
  BackupReminderPicker,
  BackupWithAttachmentsReminderPicker,
  DateFormatPicker,
  UiLocalePicker,
  TranslationPicker,
  DayFormatPicker,
  WeekFormatPicker,
  FontPicker,
  HomePicker,
  ImageCompressionPicker,
  SidebarTabPicker,
  TimeFormatPicker,
  TrashIntervalPicker,
  VaultLockTimerPicker
} from "./picker/pickers";
import { RestoreBackup } from "./restore-backup";
import SoundPicker from "./sound-picker";
import ThemeSelector from "./theme-selector";
import { TitleFormat } from "./title-format";

export const components: { [name: string]: ReactElement } = {
  homeselector: <HomePicker />,
  autobackups: <BackupReminderPicker />,
  configuretoolbar: <ConfigureToolbar />,
  "debug-logs": <DebugLogs />,
  "sound-picker": <SoundPicker />,
  licenses: <Licenses />,
  "trash-interval-selector": <TrashIntervalPicker />,
  "font-selector": <FontPicker />,
  "title-format": <TitleFormat />,
  "ui-locale-selector": <UiLocalePicker />,
  "translation-selector": <TranslationPicker />,
  "date-format-selector": <DateFormatPicker />,
  "time-format-selector": <TimeFormatPicker />,
  "day-format-selector": <DayFormatPicker />,
  "week-format-selector": <WeekFormatPicker />,
  "image-compression-picker": <ImageCompressionPicker />,
  "theme-selector": <ThemeSelector />,
  "applock-timer": <ApplockTimerPicker />,
  "vault-lock-timer": <VaultLockTimerPicker />,
  autobackupsattachments: <BackupWithAttachmentsReminderPicker />,
  backuprestore: <RestoreBackup />,
  "sidebar-tab-selector": <SidebarTabPicker />
};
