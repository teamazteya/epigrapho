/*
This file is part of the Epigrapho project, a fork of Notesnook
(https://notesnook.com/)

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

import { PROVENANCE } from "@notesnook/scripture-provider";
import type { ResourceProvenance } from "@notesnook/scripture-provider";
import { strings } from "@notesnook/intl";
import Config from "../utils/config";
import { setPreference } from "./synced-preferences";

/**
 * Every translation a person can pick, embedded ones first. The brand ones
 * need the network (and the key the desktop app holds); which of them is
 * available offline is what the badge in the list says.
 */
export const TRANSLATIONS = [
  ...Object.values(PROVENANCE).filter(
    (translation) => translation.deliveryMode === "embedded-offline"
  ),
  ...Object.values(PROVENANCE).filter(
    (translation) => translation.deliveryMode !== "embedded-offline"
  )
];

/** Epigrapho is written in Spanish first, so it reads Spanish first too. */
export const DEFAULT_TRANSLATION = "VBL";

/**
 * The translation new verses are read in. It is a content preference, not a
 * language one: the interface can be in English while this stays on VBL.
 */
export function getTranslation(): string {
  const stored = Config.get<string>("translation", DEFAULT_TRANSLATION);
  return TRANSLATIONS.some((translation) => translation.id === stored)
    ? stored
    : DEFAULT_TRANSLATION;
}

/**
 * ponytail: nothing to repaint and nothing to migrate. The popover and the
 * insert action read this when they run, and a scripture block already in a
 * note keeps the translation it was written with, which is the whole point of
 * storing the id on the block.
 *
 * It is stored in the account (Fase 7): the translation a person reads in is
 * theirs, not the machine's.
 */
export async function setTranslation(translationId: string) {
  await setPreference("translation", translationId);
}

/**
 * Whether a translation can be read with no network at all. The embedded
 * packs can, and so could a licensed pack a person installs. A brand
 * translation cannot: a saved copy is a courtesy that expires, not a
 * guarantee, so it is never what the badge promises.
 */
export function isAvailableOffline(translation: ResourceProvenance): boolean {
  return translation.deliveryMode !== "online-cached";
}

/**
 * The heading a translation is filed under in the picker. It is a group and
 * not a suffix on the name: whether a translation will be there on a plane is
 * the first thing being chosen, so it sorts the list rather than trailing it.
 */
export function availabilityGroup(translation: ResourceProvenance): string {
  return isAvailableOffline(translation)
    ? strings.scriptureAvailableOffline()
    : strings.scriptureOnlineOnly();
}
