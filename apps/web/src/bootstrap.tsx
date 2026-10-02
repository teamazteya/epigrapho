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

import { getCurrentHash, getCurrentPath, makeURL } from "./navigation";
import Config from "./utils/config";
import type { AuthProps } from "./views/auth";
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

// Epigrapho: accounts are optional (S1). The sign-in screens are reached only
// from Settings > Account, so unlike upstream nothing redirects a person to
// them; the one exception is an account whose session expired.
const routes = {
  "/wrapped": {
    component: () => import("./views/wrapped"),
    props: null
  },
  "/account/recovery": {
    component: () => import("./views/recovery"),
    props: { route: "methods" }
  },
  "/signup": {
    component: () => import("./views/auth"),
    props: { route: "signup" }
  },
  "/sessionexpired": {
    component: () => import("./views/auth"),
    props: { route: "sessionExpiry" }
  },
  "/login": {
    component: () => import("./views/auth"),
    props: { route: "login:email" }
  },
  "/login/password": {
    component: () => import("./views/auth"),
    props: { route: "login:email" }
  },
  "/recover": {
    component: () => import("./views/auth"),
    props: { route: "recover" }
  },
  "/login/mfa/code": {
    component: () => import("./views/auth"),
    props: { route: "login:email" }
  },
  "/login/mfa/select": {
    component: () => import("./views/auth"),
    props: { route: "login:email" }
  },
  default: { component: () => import("./app"), props: null }
} as const;

const sessionExpiryExceptions: Routes[] = [
  "/recover",
  "/account/recovery",
  "/sessionexpired",
  "/login/mfa/code",
  "/login/mfa/select",
  "/login/password"
];

function getRoute(): RouteWithPath<AuthProps> | RouteWithPath {
  let path = getCurrentPath() as Routes;
  if (isAccountRecoveryRoute(path)) path = "/account/recovery";

  const route = (
    routes[path] ? { route: routes[path], path } : null
  ) as RouteWithPath<AuthProps> | null;

  if (route?.path === "/wrapped" && !shouldShowWrapped())
    return { route: routes.default, path: "default" };

  return (
    isSessionExpired(path) ||
    route || { route: routes.default, path: "default" }
  );
}

function isAccountRecoveryRoute(path: Routes): boolean {
  return path.startsWith("/account/recovery");
}

function isSessionExpired(path: Routes): RouteWithPath<AuthProps> | null {
  if (!Config.get("sessionExpired", false)) return null;
  if (sessionExpiryExceptions.includes(path)) return null;
  window.history.replaceState(
    {},
    "",
    makeURL("/sessionexpired", getCurrentHash())
  );
  return { route: routes["/sessionexpired"], path: "/sessionexpired" };
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

  // A recovery signs in from scratch and re-encrypts everything in memory, so
  // it never touches this computer's database.
  const persistence = isAccountRecoveryRoute(path)
    ? ("memory" as const)
    : ("db" as const);

  logger.info(
    `Initializing key store with persistence: ${persistence} for path: ${path}`
  );

  return { Component, path, props: route.props, persistence };
}
