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

import { useEffect, useState } from "react";
import { Opts, TDate, format, register } from "timeago.js";
const shortLocale: [string, string][] = [
  ["now", "now"],
  ["%ss", "in %ss"],
  ["1m", "in 1m"],
  ["%sm", "in %sm"],
  ["1h", "in 1h"],
  ["%sh", "in %sh"],
  ["1d", "in 1d"],
  ["%sd", "in %sd"],
  ["1w", "in 1w"],
  ["%sw", "in %sw"],
  ["1mo", "in 1mo"],
  ["%smo", "in %smo"],
  ["1yr", "in 1yr"],
  ["%syr", "in %syr"]
];

const enShortLocale: [string, string][] = [
  ["now", "now"],
  ["%ss ago", "in %ss"],
  ["1m ago", "in 1m"],
  ["%sm ago", "in %sm"],
  ["1h ago", "in 1h"],
  ["%sh ago", "in %sh"],
  ["1d ago", "in 1d"],
  ["%sd ago", "in %sd"],
  ["1w ago", "in 1w"],
  ["%sw ago", "in %sw"],
  ["1mo ago", "in 1mo"],
  ["%smo ago", "in %smo"],
  ["1yr ago", "in 1yr"],
  ["%syr ago", "in %syr"]
];
// Epigrapho: the short form in Spanish, for the es-MX interface.
const esShortLocale: [string, string][] = [
  ["ahora", "ahora"],
  ["%s s", "en %s s"],
  ["1 min", "en 1 min"],
  ["%s min", "en %s min"],
  ["1 h", "en 1 h"],
  ["%s h", "en %s h"],
  ["1 d", "en 1 d"],
  ["%s d", "en %s d"],
  ["1 sem", "en 1 sem"],
  ["%s sem", "en %s sem"],
  ["1 mes", "en 1 mes"],
  ["%s meses", "en %s meses"],
  ["1 año", "en 1 año"],
  ["%s años", "en %s años"]
];
register("short", (_n, index) => shortLocale[index]);
const esAgoLocale: [string, string][] = esShortLocale.map(([ago, ahead], i) =>
  i < 2 ? [ago, ahead] : [`hace ${ago}`, ahead]
);
register("es_short", (_n, index) => esShortLocale[index]);
register("es_ago", (_n, index) => esAgoLocale[index]);
register("en_short", (_n, index) => enShortLocale[index]);

export function getTimeAgo(datetime: TDate, locale = "short", opts?: Opts) {
  return format(datetime, locale, opts);
}

type TimeAgoOptions = {
  locale?: "short" | "en_short" | "es_short" | "es_ago";
  live?: boolean;
  interval?: number;
  onUpdate?: (timeAgo: string) => void;
};

export function useTimeAgo(
  datetime: TDate,
  { locale = "short", live = true, interval = 60000, onUpdate }: TimeAgoOptions
) {
  const [timeAgo, setTimeAgo] = useState(getTimeAgo(datetime, locale));

  useEffect(() => {
    if (!live) return;
    const value = getTimeAgo(datetime, locale);
    onUpdate?.(value);
    setTimeAgo(value);

    const reset = setInterval(() => {
      const value = getTimeAgo(datetime, locale);
      onUpdate?.(value);
      setTimeAgo(value);
    }, interval);
    return () => {
      clearInterval(reset);
    };
  }, [datetime, interval, locale, live, onUpdate]);

  return timeAgo;
}
