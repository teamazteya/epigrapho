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

import { EVENTS } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { db } from "../common/database";
import { getUiLocale } from "../common/ui-locale";
import { presentDialog } from "../components/dialog/functions";
import { useUserStore } from "../stores/use-user-store";

/**
 * Epigrapho (A4), as on the desktop (apps/web/src/common/marketing.ts): the
 * news emails are opt-in. The account server keeps the answer and tells El
 * Dugout; whether the person was asked lives in the account, so a second
 * device does not ask again.
 */
export async function setMarketingConsent(enabled: boolean) {
  await db.settings.setEpigrapho("epigrapho:marketingAsked", true);
  await db.user.changeMarketingConsent(enabled, getUiLocale());
  useUserStore.getState().setUser(await db.user.fetchUser());
}

/** Accounts made before 1.3.0 started at no: they are asked once. */
export async function askMarketingOnce() {
  if (!(await db.user.getUser())) return;
  if (db.settings.getEpigrapho("epigrapho:marketingAsked")) return;

  // Another device may have answered already: its answer arrives with the
  // first sync. ponytail: if that sync ended before this listens, the wait
  // runs out instead and the question comes 30 s late.
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve();
    };
    const subscription = db.eventManager.subscribe(EVENTS.syncCompleted, done);
    const timer = setTimeout(done, 30_000);
  });
  if (db.settings.getEpigrapho("epigrapho:marketingAsked")) return;

  // Closing the question counts as no, and it is not asked again.
  const yes = await new Promise<boolean>((resolve) => {
    presentDialog({
      title: strings.marketingAsk(),
      paragraph: strings.marketingAskDesc(),
      positiveText: strings.marketingAskYes(),
      negativeText: strings.marketingAskNo(),
      positivePress: async () => {
        resolve(true);
        return true;
      },
      onClose: () => resolve(false)
    });
  });
  await setMarketingConsent(yes);
}
