/*
This file is part of the Epigrapho project, a fork of Notesnook
(https://notesnook.com/)

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

import { Label } from "@theme-ui/components";
import { useSpellChecker } from "../../../hooks/use-spell-checker";

/**
 * The dictionaries the app ships, each under its own name: a language is
 * written in itself, whatever the interface is set to.
 */
const LANGUAGES = { es: "Español", en: "English" } as const;
type Language = keyof typeof LANGUAGES;

export function SpellCheckerLanguages() {
  const enabled = useSpellChecker((store) => store.languages);
  const setLanguages = useSpellChecker((store) => store.setLanguages);

  return (
    <>
      {(Object.keys(LANGUAGES) as Language[]).map((code) => (
        <Label key={code} variant="text.body" sx={{ mb: 1 }}>
          <input
            type="checkbox"
            data-test-id={`spell-checker-language-${code}`}
            style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
            checked={enabled.includes(code)}
            // The last one stays: checking in no language is the switch
            // above, not an empty list here.
            disabled={enabled.length === 1 && enabled.includes(code)}
            onChange={(e) =>
              setLanguages(
                e.currentTarget.checked
                  ? [...(enabled as Language[]), code]
                  : (enabled as Language[]).filter((each) => each !== code)
              )
            }
          />
          <span style={{ marginLeft: 5 }}>{LANGUAGES[code]}</span>
        </Label>
      ))}
    </>
  );
}
