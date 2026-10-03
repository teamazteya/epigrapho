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
import "./root.css";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData
} from "@remix-run/react";
import { BaseThemeProvider } from "./components/theme-provider";
import { Buffer } from "buffer";
import { ThemeDark, ThemeLight, themeToCSS } from "@notesnook/theme";
import { LoaderFunction } from "@remix-run/node";
import { useEffect, useState } from "react";

// Epigrapho Light, or Epigrapho Dark when the reader's system is dark. The
// colors are CSS, so the first paint is already right.
const THEME_CSS = `${themeToCSS(ThemeLight)}
@media (prefers-color-scheme: dark) {
${themeToCSS(ThemeDark)}
}`;

globalThis.Buffer = Buffer;

type RootLoaderData = { cspScriptNonce: string };
export const loader: LoaderFunction = async () => {
  const crypto = await import("node:crypto");
  return { cspScriptNonce: crypto.randomBytes(16).toString("hex") };
};

export function Head() {
  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="icon" type="image/png" href="/favicon.png" />
      <Meta />
      <Links />
      <style
        id="theme-colors"
        dangerouslySetInnerHTML={{ __html: THEME_CSS }}
      />
    </>
  );
}

export default function App() {
  const data = useLoaderData<RootLoaderData>();
  const cspScriptNonce =
    typeof document === "undefined" ? data.cspScriptNonce : "";
  // The server cannot know the reader's scheme; the browser decides it before
  // anything that reads colors in JavaScript (the editor) is drawn.
  const [colorScheme, setColorScheme] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
  );
  useEffect(() => {
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setColorScheme(dark.matches ? "dark" : "light");
    update();
    dark.addEventListener("change", update);
    return () => dark.removeEventListener("change", update);
  }, []);

  return (
    <>
      <BaseThemeProvider
        injectCssVars
        colorScheme={colorScheme}
        sx={{ bg: "background" }}
      >
        <Outlet />
      </BaseThemeProvider>
      <ScrollRestoration nonce={cspScriptNonce} />
      <Scripts nonce={cspScriptNonce} />
    </>
  );
}
