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

import { strings } from "@notesnook/intl";
import { db } from "../common/database";
import { useUserStore } from "../stores/use-user-store";
import { presentSheet, ToastManager } from "./event-manager";
import SettingsService from "./settings";

/**
 * Epigrapho sells nothing, so this is what is left of upstream's purchase
 * service: the "premium" flag, always on, and the e-mail confirmation sheet
 * the sync code still refers to. There is no store connection and no
 * react-native-iap.
 */
async function setPremiumStatus() {
  const userstore = useUserStore.getState();
  try {
    const user = await db.user.getUser();
    userstore.setPremium(get());
    if (user) userstore.setUser(user);
  } catch (e) {
    /* empty */
  }
}

function get() {
  // Epigrapho is free: there is no paid tier to be outside of. See
  // getUserPlan() in @notesnook/common for the same decision on the web and
  // desktop side.
  return true;
}

const showVerifyEmailDialog = () => {
  presentSheet({
    title: strings.confirmEmail(),
    paragraph: strings.emailConfirmationLinkSent(),
    action: async () => {
      try {
        const lastVerificationEmailTime =
          SettingsService.get().lastVerificationEmailTime;
        if (
          lastVerificationEmailTime &&
          Date.now() - lastVerificationEmailTime < 60000 * 2
        ) {
          ToastManager.show({
            heading: strings.waitBeforeResendEmail(),
            type: "error",
            context: "local"
          });

          return;
        }
        await db.user.sendVerificationEmail();
        SettingsService.set({
          lastVerificationEmailTime: Date.now()
        });

        ToastManager.show({
          heading: strings.verificationEmailSent(),
          message: strings.emailConfirmationLinkSent(),
          type: "success",
          context: "local"
        });
      } catch (e) {
        ToastManager.show({
          heading: strings.failedToSendVerificationEmail(),
          message: (e as Error).message,
          type: "error",
          context: "local"
        });
      }
    },
    actionText: strings.resendEmail()
  });
};

const PremiumService = {
  setPremiumStatus,
  get,
  showVerifyEmailDialog
};

export default PremiumService;
