/*
This file is part of the Epigrapho project (https://github.com/teamazteya/epigrapho)

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

import { useState } from "react";
import { strings } from "@notesnook/intl";
import Dialog from "../components/dialog";
import { BaseDialogProps, DialogManager } from "../common/dialog-manager";
import { getUiLocale } from "../common/ui-locale";
import { WELCOME_KEY } from "../common/welcome";
import { useStore as useThemeStore } from "../stores/theme-store";
import { useEditorStore } from "../stores/editor-store";
import Config from "../utils/config";
import "./welcome-dialog.css";

type Shot = keyof typeof strings.welcome.shots;

/**
 * The real captures on each of the nine pages. They are files of the app,
 * /welcome/<language>/<page>-<shot>.webp, made by
 * apps/desktop/scripts/welcome-captures.mjs, so the tour works offline.
 */
const SHOTS: Shot[][] = [
  ["editor"],
  ["preview", "block"],
  ["related", "parallel"],
  ["dictionary"],
  ["interlinear", "lexicon"],
  ["plan"],
  ["templates", "sermon"],
  ["themes", "export"],
  ["share"]
];

export function welcomeCapture(page: number, shot: Shot) {
  const language = getUiLocale() === "en-US" ? "en" : "es";
  return `/welcome/${language}/${String(page + 1).padStart(2, "0")}-${shot}.webp`;
}

/** Epigrapho A6 (Fase 9): nine pages on what the app can do. */
export const WelcomeDialog = DialogManager.register(function WelcomeDialog({
  onClose
}: BaseDialogProps<boolean>) {
  const scheme = useThemeStore((store) => store.colorScheme);
  const [step, setStep] = useState(0);
  const [shotIndex, setShotIndex] = useState(0);
  const [hide, setHide] = useState(() => Config.get(WELCOME_KEY, true));
  const [zoomed, setZoomed] = useState(false);
  // In a narrow window the index folds above the page (welcome-dialog.css).
  const [wide] = useState(() => window.matchMedia("(min-width: 701px)").matches);
  const welcome = strings.welcome;
  const page = welcome.pages[step];
  const shots = SHOTS[step];
  const shot = shots[shotIndex];
  const caption = welcome.shots[shot]();
  const src = welcomeCapture(step, shot);
  const last = step === welcome.pages.length - 1;

  function close(firstNote = false) {
    Config.set(WELCOME_KEY, hide);
    onClose(firstNote);
    if (firstNote) useEditorStore.getState().newSession();
  }

  function go(to: number) {
    setStep(to);
    setShotIndex(0);
  }

  return (
    <Dialog
      isOpen={true}
      noScroll
      testId="welcome-dialog"
      onClose={() => close()}
      sx={{
        width: ["100%", "96%", "min(1120px, 96vw)"],
        height: ["100%", "92vh"],
        maxHeight: ["100%", "780px"],
        borderRadius: [0, "15px"]
      }}
    >
      <article
        className="ew-product"
        data-scheme={scheme}
        aria-label={welcome.title()}
      >
        <div className="ew-wizard">
          <aside className="ew-rail">
            <div className="ew-brand">
              <img className="ew-logo" alt="" src="/favicon.svg" />
              <div>
                <span className="ew-wordmark">Epigrapho</span>
                <small>{welcome.title()}</small>
              </div>
            </div>
            <details className="ew-index" open={wide}>
              <summary>{welcome.indexSummary()}</summary>
              <nav className="ew-nav" aria-label={welcome.indexLabel()}>
                {welcome.pages.map((item, index) => (
                  <button
                    key={index}
                    type="button"
                    data-test-id={`welcome-step-${index + 1}`}
                    aria-current={index === step ? "step" : undefined}
                    onClick={() => go(index)}
                  >
                    <span className="ew-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{item.nav()}</span>
                  </button>
                ))}
              </nav>
            </details>
            <div className="ew-rail-foot">
              <p>
                {welcome.railTitle[0]()}
                <br />
                {welcome.railTitle[1]()}
              </p>
              <small>
                {welcome.railNote[0]()}
                <br />
                {welcome.railNote[1]()}
              </small>
            </div>
          </aside>
          <div className="ew-main">
            <header className="ew-topbar">
              <span>{welcome.discover()}</span>
              <span className="ew-count" data-test-id="welcome-count">
                {welcome.count(step + 1)}
              </span>
              <button
                className="ew-quiet"
                type="button"
                data-test-id="welcome-close"
                onClick={() => close()}
              >
                {strings.close()}
              </button>
            </header>
            <section
              key={step}
              className="ew-page"
              data-page={step}
              aria-label={page.nav()}
            >
              <div className={step === 0 ? "ew-intro ew-opening" : "ew-intro"}>
                <h1 data-test-id="welcome-title">{page.title()}</h1>
                <p>{page.body()}</p>
              </div>
              <figure className="ew-real-capture">
                {shots.length > 1 && (
                  <div
                    className="ew-capture-choices"
                    role="group"
                    aria-label={welcome.captureViews()}
                  >
                    {shots.map((item, index) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={index === shotIndex}
                        onClick={() => setShotIndex(index)}
                      >
                        {welcome.shots[item]()}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="ew-capture-open"
                  type="button"
                  aria-label={welcome.zoomOf(caption)}
                  onClick={() => setZoomed(true)}
                >
                  <img
                    src={src}
                    alt={welcome.captureAlt(caption)}
                    data-test-id="welcome-capture"
                  />
                  <span>{welcome.zoom()}</span>
                </button>
                <figcaption>
                  <span>{caption}</span>
                  <small>{welcome.captureDesktop()}</small>
                </figcaption>
              </figure>
              <p className="ew-tip">{page.tip()}</p>
            </section>
            <div className="ew-preference">
              <label className="ew-check">
                <input
                  type="checkbox"
                  data-test-id="welcome-dont-show"
                  checked={hide}
                  onChange={(event) => setHide(event.target.checked)}
                />
                {welcome.dontShow()}
              </label>
              <small>{welcome.reopen()}</small>
            </div>
            <footer className="ew-footer">
              <button
                className="ew-quiet"
                type="button"
                data-test-id="welcome-enter"
                onClick={() => close()}
              >
                {welcome.enter()}
              </button>
              <div className="ew-actions">
                <button
                  className="ew-button"
                  type="button"
                  data-test-id="welcome-back"
                  disabled={step === 0}
                  onClick={() => go(step - 1)}
                >
                  {strings.back()}
                </button>
                {last ? (
                  <button
                    className="ew-button ew-primary"
                    type="button"
                    data-test-id="welcome-first-note"
                    onClick={() => close(true)}
                  >
                    {welcome.createFirstNote()}
                  </button>
                ) : (
                  <button
                    className="ew-button ew-primary"
                    type="button"
                    data-test-id="welcome-next"
                    onClick={() => go(step + 1)}
                  >
                    {strings.next()}
                  </button>
                )}
              </div>
            </footer>
          </div>
        </div>
        {zoomed && (
          <div
            className="ew-zoom"
            role="dialog"
            aria-label={caption}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              // Escape closes the enlarged capture, not the whole tour.
              event.stopPropagation();
              setZoomed(false);
            }}
          >
            <header>
              <strong>{caption}</strong>
              <button
                type="button"
                autoFocus
                data-test-id="welcome-zoom-close"
                onClick={() => setZoomed(false)}
              >
                {strings.close()}
              </button>
            </header>
            <img src={src} alt={welcome.captureAlt(caption)} />
          </div>
        )}
      </article>
    </Dialog>
  );
});
