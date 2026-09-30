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
import type { FeatureId, FeatureResult } from "@notesnook/common";

/**
 * Epigrapho: every feature is available (getUserPlan in @notesnook/common), so
 * the paywall upstream opened when a feature was locked is never reached. The
 * callers stay as they are; there is simply nothing to sell them.
 */
export default function PaywallSheet() {
  return null;
}

// ponytail: kept as a no-op so the forty call sites behind `!isAllowed` need
// no edits; delete them all if the feature table itself ever goes.
PaywallSheet.present = <Tid extends FeatureId>(
  _feature?: FeatureResult<Tid>
) => {};
