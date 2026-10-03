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

import { LoaderFunctionArgs } from "@remix-run/node";
import { strings } from "@notesnook/intl";
import { makeImage } from "../utils/generate-og-image.server";
import { API_HOST } from "../utils/env";
import { getMonographMetadata } from "../utils/meta";
import { activate, localeOf } from "../utils/locale";

const PATH = /^\/(?:s\/([\w-]+)|([a-f0-9]{24}))$/;

/** The link preview of a shared note: its title and opening lines. */
export async function loader({ request }: LoaderFunctionArgs) {
  const match = PATH.exec(new URL(request.url).searchParams.get("path") || "");
  if (!match) return new Response(null, { status: 404 });
  const [, slug, id] = match;

  const response = await fetch(
    slug ? `${API_HOST}/monographs/v2/${slug}` : `${API_HOST}/monographs/${id}`
  );
  if (!response.ok) return new Response(null, { status: 404 });
  const monograph = await response.json();
  if (!monograph?.title) return new Response(null, { status: 404 });
  if (monograph.content) monograph.content = JSON.parse(monograph.content);
  const metadata = getMonographMetadata(monograph);

  // No await between choosing the language and reading the texts.
  const locale = localeOf(request.headers.get("accept-language"));
  activate(locale);
  const texts = {
    tagline: strings.shareTagline(),
    description: metadata.encrypted
      ? strings.shareLockedDescription()
      : metadata.fullDescription
  };

  return new Response(
    await makeImage(
      { title: metadata.title, date: metadata.datePublished, ...texts },
      [match[0], monograph.datePublished, locale].join(":")
    ),
    {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400"
      }
    }
  );
}
