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

import Config from "../utils/config";

/**
 * Epigrapho A6 (Fase 9): the welcome center opens by itself on a new profile
 * only. Its answer is a preference of this computer, kept across a logout.
 */
export const WELCOME_KEY = "welcome:hide";
const PENDING_KEY = "welcome:pending";

// Read when index.ts imports this, before anything else writes: a profile
// that has stored nothing yet is new.
const newProfile = window.localStorage.length === 0;

/** `notes` is how many notes the profile has. */
export function shouldShowWelcome(notes: number) {
  const hide = Config.get<boolean | undefined>(WELCOME_KEY);
  if (hide !== undefined) return !hide;
  // Shown but never answered (the app was quit): it opens again.
  if ((newProfile && notes === 0) || Config.get(PENDING_KEY, false)) {
    Config.set(PENDING_KEY, true);
    return true;
  }
  // A profile from before 1.6.0, or one that already has notes, is not new.
  Config.set(WELCOME_KEY, true);
  return false;
}
