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

import { Flex, Link, Text } from "@theme-ui/components";
import { strings } from "@notesnook/intl";
import { LANDING_URL } from "../routes/_index";

export const RULES_URL =
  "https://github.com/teamazteya/epigrapho/blob/main/PRIVACY.md#notas-compartidas";

/**
 * "Escrito con Epigrapho · Descárgala gratis · Reportar · Reglas". Reporting
 * opens the reader's own mail with the note's address already written: no
 * form, so nothing here to keep spam out of.
 */
export function Footer(props: { report?: { title: string; url: string } }) {
  const { report } = props;
  const links: { text: string; href: string }[] = [
    { text: strings.shareDownload(), href: LANDING_URL }
  ];
  if (report)
    links.push({ text: strings.shareReport(), href: reportMailto(report) });
  links.push({ text: strings.shareRules(), href: RULES_URL });

  return (
    <Flex
      as="footer"
      sx={{
        borderTop: "1px solid var(--border)",
        bg: "background-secondary",
        px: [3, "15%"],
        py: 4,
        gap: 2,
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <Text variant="body" sx={{ color: "paragraph-secondary" }}>
        {strings.shareWrittenWith()}
      </Text>
      {links.map((link) => (
        <Flex key={link.href} sx={{ gap: 2, alignItems: "center" }}>
          <Text aria-hidden sx={{ color: "paragraph-secondary" }}>
            ·
          </Text>
          <Link href={link.href} variant="text.body" sx={{ color: "accent" }}>
            {link.text}
          </Link>
        </Flex>
      ))}
    </Flex>
  );
}

export function reportMailto(report: { title: string; url: string }) {
  const body = [
    strings.shareReportIntro(),
    strings.shareReportLink(report.url),
    "",
    `${strings.shareReportReason()} `
  ].join("\n");
  return `mailto:support@azteya.tech?${new URLSearchParams({
    subject: strings.shareReportSubject(report.title),
    body
  })
    .toString()
    .replace(/\+/g, "%20")}`;
}
