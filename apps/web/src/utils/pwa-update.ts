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

/**
 * Epigrapho (1.7.1): the web and the PWA install a new version by themselves.
 * The new service worker otherwise waits for "Install update", which lives in
 * the status bar, and the phone has no status bar; on iPhone it kept waiting
 * across every relaunch. It is installed when the app opens, before anything
 * is typed, or when it comes back to the screen with every note saved.
 */
let watching = false;
export function autoUpdate(registration: ServiceWorkerRegistration) {
  install(registration, false);
  // onSuccess can run more than once per page.
  if (watching) return;
  watching = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!install(registration, true))
      registration.update().catch(() => undefined);
  });
}

let installing = false;
function install(registration: ServiceWorkerRegistration, checkNotes: boolean) {
  const waiting = registration.waiting;
  // No controller means a first visit: there is nothing old to replace.
  if (!waiting || !navigator.serviceWorker.controller || installing)
    return false;
  installing = true;
  (checkNotes ? unsavedNotes() : Promise.resolve(false))
    .then((unsaved) => {
      if (unsaved) return (installing = false);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => window.location.reload(),
        { once: true }
      );
      waiting.postMessage({ type: "SKIP_WAITING" });
    })
    .catch(() => (installing = false));
  return true;
}

async function unsavedNotes() {
  const { useEditorStore, SaveState } = await import("../stores/editor-store");
  return useEditorStore
    .getState()
    .sessions.some(
      (session) =>
        "saveState" in session && session.saveState !== SaveState.Saved
    );
}
