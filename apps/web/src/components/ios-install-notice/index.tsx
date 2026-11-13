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

import { useState } from "react";
import { Button, Flex, Text } from "@theme-ui/components";
import { strings } from "@notesnook/intl";
import { Dismiss } from "../icons";
import Config from "../../utils/config";
import { isIOS } from "../../utils/platform";

/**
 * Epigrapho W1 (Fase 3): until there is an iOS app, the web in Safari tells
 * iPhone and iPad users how to install it. Once closed, it does not come
 * back on this device. It sits under the welcome, which covers it while open.
 */
const HIDE_KEY = "iosInstallNotice:hide";

function shouldShow() {
  if (IS_DESKTOP_APP || !isIOS() || Config.get(HIDE_KEY, false)) return false;
  const installed =
    ("standalone" in navigator && navigator.standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !installed;
}

export default function IosInstallNotice() {
  const [visible, setVisible] = useState(shouldShow);
  if (!visible) return null;

  return (
    <Flex
      data-test-id="ios-install-notice"
      role="status"
      sx={{
        position: "fixed",
        left: 2,
        right: 2,
        bottom: "calc(env(safe-area-inset-bottom) + 12px)",
        zIndex: 999,
        alignItems: "center",
        gap: 1,
        p: 2,
        bg: "background-secondary",
        border: "1px solid var(--border)",
        borderRadius: "large",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)"
      }}
    >
      <Text variant="body" sx={{ flex: 1, textWrap: "wrap" }}>
        {strings.iosInstallNotice()}
      </Text>
      <Button
        variant="secondary"
        aria-label={strings.close()}
        title={strings.close()}
        data-test-id="ios-install-notice-close"
        onClick={() => {
          Config.set(HIDE_KEY, true);
          setVisible(false);
        }}
        sx={{ bg: "transparent", p: 2, minWidth: 44, minHeight: 44 }}
      >
        <Dismiss size={20} color="icon" />
      </Button>
    </Flex>
  );
}
