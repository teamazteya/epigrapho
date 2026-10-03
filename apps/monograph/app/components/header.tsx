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

import { Flex, Image, Link, Text } from "@theme-ui/components";
import { strings } from "@notesnook/intl";
import { LANDING_URL } from "../routes/_index";

/** Epigrapho's name on the left, and the way to get the app on the right. */
export function Header() {
  return (
    <Flex
      sx={{
        bg: "background-secondary",
        borderBottom: "1px solid var(--border)",
        p: 2,
        px: [3, "15%"],
        justifyContent: "space-between",
        alignItems: "center",
        gap: 2
      }}
    >
      <Link
        href={LANDING_URL}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          textDecoration: "none"
        }}
      >
        <Image
          src="/logo.png"
          alt=""
          sx={{ width: 32, height: 32, borderRadius: 6 }}
        />
        <Text
          sx={{
            fontFamily: "heading",
            fontWeight: 700,
            fontSize: 20,
            color: "heading"
          }}
        >
          Epigrapho
        </Text>
      </Link>
      <Link
        href={LANDING_URL}
        variant="text.body"
        sx={{ color: "accent", fontWeight: 600, textDecoration: "none" }}
      >
        {strings.shareDownload()}
      </Link>
    </Flex>
  );
}
