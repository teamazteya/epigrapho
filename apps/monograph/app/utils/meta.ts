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
import { ServerRuntimeMetaDescriptor } from "@remix-run/server-runtime";
import { Monograph } from "../components/monographpost/types";
import { format } from "date-fns/format";
import { PUBLIC_URL } from "./env";
import { strings } from "@notesnook/intl";

type MetaProps = {
  titleFull: string;
  titleShort?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  imageAlt?: string;
  publishedAt?: string;
  type: "website" | "article";
};

export function generateMetaDescriptors(
  props: MetaProps
): ServerRuntimeMetaDescriptor[] {
  const descriptors: ServerRuntimeMetaDescriptor[] = [];

  descriptors.push({ title: props.titleFull });

  if (props.description)
    descriptors.push({ name: "description", content: props.description });

  if (props.imageUrl)
    descriptors.push({ name: "og:image", content: props.imageUrl });
  descriptors.push({
    name: "og:title",
    content: props.titleShort || props.titleFull
  });
  if (props.imageAlt || props.description)
    descriptors.push({
      name: "og:image:alt",
      content: props.imageAlt || props.description
    });
  if (props.url) descriptors.push({ name: "og:url", content: props.url });
  descriptors.push({ name: "og:type", content: props.type });
  descriptors.push({ name: "og:site_name", content: "Epigrapho" });
  if (props.publishedAt)
    descriptors.push({
      name: "article:published_time",
      content: props.publishedAt
    });

  descriptors.push({ name: "twitter:card", content: "summary_large_image" });

  descriptors.push({ name: "twitter:title", content: props.titleShort });
  descriptors.push({ name: "twitter:description", content: props.description });
  if (props.imageUrl)
    descriptors.push({ name: "twitter:image", content: props.imageUrl });

  return descriptors;
}

type Metadata = {
  title: string;
  fullDescription: string;
  shortDescription: string;
  datePublished: string;
  encrypted: boolean;
};

function extractFirstWords(html: string, numWords = 30): string {
  // Strip HTML tags and normalize whitespace
  const plainText = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Split into words and take first N
  const words = plainText.split(" ").slice(0, numWords);

  // Add ellipsis if text was truncated
  const excerpt = words.join(" ");
  return words.length < plainText.split(" ").length ? excerpt + "..." : excerpt;
}

function trimDescription(
  str: string,
  length: number,
  collapse = false
): string {
  if (collapse) str = str.replace(/\n/gm, " ").replace(/\s+/gm, " ");
  const index = str.indexOf(".", length) - 1;
  return addPeriod(
    str.substring(
      0,
      index < 0 ? Math.min(str.length, length) : Math.min(index, length)
    )
  );
}

const NOT_ALPHA_REGEX = /[^\w\s']|_/g;
function addPeriod(str: string) {
  str = str.trim();
  const lastChar = str[str.length - 1];
  if (lastChar === ".") return str;
  if (NOT_ALPHA_REGEX.test(lastChar)) str = str.slice(0, str.length - 1);
  return str + "...";
}

/**
 * Runs in the loader, before the request's language is set: no `strings`
 * here. The texts that depend on the language are filled in by
 * buildMonographMeta, which runs while the page renders.
 */
export function getMonographMetadata(monograph: Monograph): Metadata {
  const title = monograph?.title || "";
  const text = monograph?.encryptedContent
    ? ""
    : monograph?.content
    ? extractFirstWords(monograph?.content.data, 100)
    : "";
  const shortDescription = trimDescription(text, 150, true);
  const fullDescription = trimDescription(text, 300, true);
  const datePublished = monograph
    ? format(monograph.datePublished, "yyyy-MM-dd HH:mm")
    : "";
  return {
    title,
    fullDescription,
    shortDescription,
    datePublished,
    encrypted: !!monograph?.encryptedContent
  };
}

export type MonographLoaderData = {
  monograph: Monograph | null;
  metadata: Metadata;
  pixel: string | null;
  url: string;
};

export const NOT_FOUND_LOADER_DATA: MonographLoaderData = {
  monograph: null,
  metadata: {
    title: "",
    fullDescription: "",
    shortDescription: "",
    datePublished: "",
    encrypted: false
  },
  pixel: null,
  url: ""
};

export function buildMonographMeta(
  data: MonographLoaderData | undefined,
  url: string | undefined
): ServerRuntimeMetaDescriptor[] {
  if (!data || !data.metadata || !data.monograph)
    return [{ title: `${strings.shareNotFound()} · Epigrapho` }];

  const description = data.metadata.encrypted
    ? strings.shareLockedDescription()
    : data.metadata.shortDescription;
  // The preview image is drawn from the note itself, looked up by its
  // address, so nobody can have the page draw arbitrary text.
  const imageUrl = `${PUBLIC_URL}/api/og.jpg?${new URLSearchParams({
    path: new URL(data.url).pathname
  })}`;

  return generateMetaDescriptors({
    titleFull: `${data.metadata.title} · Epigrapho`,
    titleShort: data.metadata.title,
    description,
    imageAlt: data.metadata.title,
    imageUrl,
    url,
    publishedAt: data.metadata.datePublished,
    type: "article"
  });
}
