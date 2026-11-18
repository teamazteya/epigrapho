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

import useMediaQuery, { matchMediaQuery } from "./use-media-query";

// Epigrapho (W2): a phone on its side (short and touch) stays a phone.
export const MOBILE_MEDIA_QUERY =
  "(max-width: 480px), (max-height: 480px) and (pointer: coarse)";
/** The opposite of MOBILE_MEDIA_QUERY, for the theme's first breakpoint. */
export const NOT_MOBILE_MEDIA_QUERY =
  "@media (min-width: 481px) and (min-height: 481px), (min-width: 481px) and (pointer: fine)";
export const useMobile = () => useMediaQuery(MOBILE_MEDIA_QUERY);
export const isMobile = () => matchMediaQuery(MOBILE_MEDIA_QUERY);
export default useMobile;
