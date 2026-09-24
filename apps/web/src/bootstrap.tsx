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

import { getCurrentPath } from "./navigation";
import {
  initializeFeatureChecks,
  isFeatureSupported
} from "./utils/feature-check";
import { initializeLogger, logger } from "./utils/logger";
import { shouldShowWrapped } from "./utils/should-show-wrapped";

type Route<TProps = null> = {
  component: () => Promise<{
    default: TProps extends null
      ? () => JSX.Element
      : (props: TProps) => JSX.Element;
  }>;
  props: TProps | null;
};

type RouteWithPath<T = null> = {
  route: Route<T>;
  path: Routes;
};

export type Routes = keyof typeof routes;

const routes = {
  "/wrapped": {
    component: () => import("./views/wrapped"),
    props: null
  },
  default: { component: () => import("./app"), props: null }
} as const;

function getRoute(): RouteWithPath {
  const path = getCurrentPath() as Routes;
  const route = routes[path] ? { route: routes[path], path } : null;

  // Epigrapho has no accounts, so there is nowhere else a person can land:
  // anything that is not a known route is the app itself.
  if (route?.path === "/wrapped" && !shouldShowWrapped())
    return { route: routes.default, path: "default" };

  return route || { route: routes.default, path: "default" };
}

function checkPrerequisites() {
  if (!window.isSecureContext)
    throw new Error("Please run Epigrapho in a secure (https) context.");
  if (!navigator.locks)
    throw new Error("Your browser does not support the Web Locks API.");
  if (!crypto.subtle)
    throw new Error("Your browser does not support the SubtleCrypto API.");
  if (!window.indexedDB && !isFeatureSupported("opfs"))
    throw new Error("Your browser does not support IndexedDB or OPFS.");
  if (!window.WebAssembly)
    throw new Error("Your browser does not support WebAssembly.");
}

export async function init() {
  await initializeFeatureChecks();

  checkPrerequisites();

  const { path, route } = getRoute();

  const [{ default: Component }] = await Promise.all([
    route.component(),
    initializeLogger()
  ]);

  const persistence = "db" as const;

  logger.info(
    `Initializing key store with persistence: ${persistence} for path: ${path}`
  );

  return { Component, path, props: route.props, persistence };
}
