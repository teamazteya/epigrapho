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

import { SubscriptionPlan } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { Platform } from "react-native";
import { getVersion } from "react-native-device-info";

export const IOS_APPGROUPID = "group.tech.azteya.epigrapho";
export const FILE_SIZE_LIMIT = 500 * 1024 * 1024;
export const IMAGE_SIZE_LIMIT = 50 * 1024 * 1024;

export const BETA = getVersion().includes("beta");

// ponytail: iOS points at the repository until the App Store listing exists
// (M1 Fase 6.2); then it becomes that listing's link.
export const STORE_LINK =
  Platform.OS === "ios"
    ? "https://github.com/teamazteya/epigrapho"
    : "https://play.google.com/store/apps/details?id=tech.azteya.epigrapho";

export const GROUP = {
  default: "default",
  none: "none",
  abc: "abc",
  year: "year",
  week: "week",
  month: "month"
};

export const SORT = {
  dateModified: "Date modified",
  dateEdited: "Date edited",
  dateCreated: "Date created",
  title: "Title",
  dueDate: "Due date",
  relevance: "Relevance",
  dateDeleted: "Date deleted"
};

export function planToDisplayName(plan: SubscriptionPlan): string {
  switch (plan) {
    case SubscriptionPlan.FREE:
      return strings.freePlan();
    case SubscriptionPlan.ESSENTIAL:
      return strings.essentialPlan();
    case SubscriptionPlan.LEGACY_PRO:
    case SubscriptionPlan.PRO:
      return strings.proPlan();
    case SubscriptionPlan.BELIEVER:
      return strings.believerPlan();
    case SubscriptionPlan.EDUCATION:
      return strings.educationPlan();
    default:
      return strings.freePlan();
  }
}

export const SUBSCRIPTION_STATUS = {
  BASIC: 0,
  TRIAL: 1,
  BETA: 2,
  PREMIUM: 5,
  PREMIUM_EXPIRED: 6,
  PREMIUM_CANCELLED: 7
};

export const EDITOR_LINE_HEIGHT = {
  DEFAULT: 1.2,
  MAX: 10,
  MIN: 1
};
