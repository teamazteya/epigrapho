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

/**
 * How the app gets the text of a translation:
 * - `embedded-offline`: it ships inside the app (VBL).
 * - `licensed-offline`: the user installs it as a Resource Pack.
 * - `online-cached`: it is fetched from a provider and cached.
 */
export type DeliveryMode =
  | "embedded-offline"
  | "licensed-offline"
  | "online-cached";

export type ResourceProvenance = {
  /** The id verses are stored under, e.g. "VBL". */
  id: string;
  /** The name a person reads in the UI. */
  name: string;
  /** BCP 47 language of the text itself, not of the UI. */
  language: string;
  licence: string;
  /** The line shown next to the verse and copied with it. */
  attribution: string;
  deliveryMode: DeliveryMode;
};

/**
 * Every translation the app knows, and the licence terms it carries. This is
 * the only place an attribution string is written: the popover, the scripture
 * block, the copy action and the pack builder all read it from here.
 */
export const PROVENANCE: Record<string, ResourceProvenance> = {
  VBL: {
    id: "VBL",
    name: "Versión Biblia Libre",
    language: "es",
    licence: "CC BY-SA 4.0",
    attribution: "VBL — CC BY-SA 4.0",
    deliveryMode: "embedded-offline"
  },
  BSB: {
    id: "BSB",
    name: "Berean Standard Bible",
    language: "en",
    licence: "Public Domain",
    attribution: "BSB — Public Domain",
    deliveryMode: "embedded-offline"
  },
  KJV: {
    id: "KJV",
    name: "King James Version",
    language: "en",
    // Public domain everywhere except the United Kingdom, where the Crown's
    // letters patent still restrict *printing* it. Shipping the text is not
    // printing it, and the restriction is on publishers, not readers.
    licence: "Public Domain",
    attribution: "KJV — Public Domain",
    deliveryMode: "embedded-offline"
  },
  PdDpt: {
    id: "PdDpt",
    name: "Palabra de Dios para ti",
    language: "es",
    licence: "CC BY 4.0",
    // CC BY asks for the licensor by name, so the line carries it. The
    // publisher's own abbreviation is mixed case; it is kept as they write it.
    attribution: "PdDpt — CC BY 4.0, © 2020 Asociación Bíblica Latinoamericana",
    deliveryMode: "embedded-offline"
  },
  // The brand translations. Their attribution is the copyright line their
  // publisher mandates, taken verbatim from what API.Bible serves for each
  // one: shortening it is not ours to do.
  NTV: {
    id: "NTV",
    name: "Nueva Traducción Viviente",
    language: "es",
    licence: "Tyndale House Foundation, licensed",
    attribution:
      "Santa Biblia, Nueva Traducción Viviente, copyright © 2010 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, a Division of Tyndale House Ministries, Carol Stream, Illinois 60188. All rights reserved.",
    deliveryMode: "online-cached"
  },
  NBLA: {
    id: "NBLA",
    name: "Nueva Biblia de las Américas",
    language: "es",
    licence: "The Lockman Foundation, licensed",
    attribution:
      "Nueva Biblia de las Américas Copyright © 2005 by The Lockman Foundation La Habra, California 90631 Sociedad no comercial Derechos Reservados (All Rights Reserved) http://www.NuevaBiblia.com (Español) http://www.lockman.org (English) Versión de texto 2019 Texto derivado de La Biblia de las Américas © Copyright 1986, 1995, 1997 by The Lockman Foundation",
    deliveryMode: "online-cached"
  },
  NASB: {
    id: "NASB",
    name: "New American Standard Bible 1995",
    language: "en",
    licence: "The Lockman Foundation, licensed",
    attribution:
      "NEW AMERICAN STANDARD BIBLE® NASB® Copyright © 1960,1962,1963,1968,1971,1972,1973,1975,1977,1995 by The Lockman Foundation A Corporation Not for Profit La Habra, CA All Rights Reserved www.lockman.org",
    deliveryMode: "online-cached"
  }
};

/**
 * The attribution line for a translation. An unknown id falls back to the id
 * itself, so a verse is never shown with no credit at all.
 */
export function attributionOf(translationId: string): string {
  return PROVENANCE[translationId]?.attribution || translationId;
}
