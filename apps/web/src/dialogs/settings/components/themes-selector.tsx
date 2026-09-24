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
import { useCallback } from "react";
import { Box, Button, Flex, Text } from "@theme-ui/components";
import { CheckCircleOutline, Loading } from "../../../components/icons";
import {
  ThemeDark,
  ThemeDefinition,
  ThemeLight,
  ThemeMetadata,
  getPreviewColors,
  validateTheme
} from "@notesnook/theme";
import { useStore as useThemeStore } from "../../../stores/theme-store";
import { ThemePreview } from "../../../components/theme-preview";
import { showToast } from "../../../utils/toast";
import { showFilePicker, readFile } from "../../../utils/file-picker";
import { VirtualizedGrid } from "../../../components/virtualized-grid";
import { ThemeDetailsDialog } from "../../theme-details-dialog";
import { strings } from "@notesnook/intl";

/**
 * Epigrapho: the themes on offer are the ones that ship with the app, plus any
 * the person loads from a file. Upstream listed its online theme store here,
 * which asked a Notesnook server on every visit to Appearance.
 */
export function ThemesSelector() {
  const setCurrentTheme = useThemeStore((store) => store.setTheme);
  const darkTheme = useThemeStore((store) => store.darkTheme);
  const lightTheme = useThemeStore((store) => store.lightTheme);
  const isThemeCurrentlyApplied = useThemeStore(
    (store) => store.isThemeCurrentlyApplied
  );

  const items = [darkTheme, lightTheme, ThemeDark, ThemeLight]
    .filter(
      (theme, index, all) =>
        all.findIndex((other) => other.id === theme.id) === index
    )
    .map((theme) => ({
      ...theme,
      totalInstalls: 0,
      previewColors: getPreviewColors(theme)
    }));

  const setTheme = useCallback(
    async (theme: ThemeMetadata) => {
      if (isThemeCurrentlyApplied(theme.id)) return;
      setCurrentTheme(theme as unknown as ThemeDefinition);
    },
    [isThemeCurrentlyApplied, setCurrentTheme]
  );

  return (
    <>
      <Flex sx={{ justifyContent: "flex-end", mt: 2 }}>
        <Button
          variant="secondary"
          onClick={async () => {
            const [file] = await showFilePicker({
              acceptedFileTypes: "application/json"
            });
            if (!file) return;
            const theme = JSON.parse(await readFile(file));
            const { error } = validateTheme(theme);
            if (error) return showToast("error", error);

            if (
              await ThemeDetailsDialog.show({
                theme: {
                  ...theme,
                  totalInstalls: 0,
                  previewColors: getPreviewColors(theme)
                }
              })
            ) {
              setCurrentTheme(theme);
            }
          }}
          sx={{ px: 3, flexShrink: 0 }}
        >
          {strings.loadFromFile()}
        </Button>
      </Flex>

      <Box sx={{ mt: 2 }}>
        <VirtualizedGrid
          columns={2}
          items={items}
          getItemKey={(index) => items[index].id}
          estimatedSize={285}
          mode="dynamic"
          renderItem={({ item: theme }) => (
            <ThemeItem
              key={theme.id}
              theme={theme}
              isApplied={isThemeCurrentlyApplied(theme.id)}
              isApplying={false}
              setTheme={setTheme}
            />
          )}
        />
      </Box>
    </>
  );
}

type ThemeItemProps = {
  theme: ThemeMetadata;
  isApplied: boolean;
  isApplying: boolean;
  setTheme: (theme: ThemeMetadata) => Promise<void>;
};
function ThemeItem(props: ThemeItemProps) {
  const { theme, isApplied, isApplying, setTheme } = props;

  return (
    <Flex
      sx={{
        flexDirection: "column",
        flex: 1,
        cursor: "pointer",
        p: 2,
        border: "1px solid transparent",
        borderRadius: "default",
        ":hover": {
          bg: "background-secondary",
          border: "1px solid var(--border)",
          ".set-as-button": { visibility: "visible" }
        }
      }}
      onClick={async () => {
        if (await ThemeDetailsDialog.show({ theme })) {
          await setTheme(theme);
        }
      }}
    >
      <ThemePreview theme={theme} />
      <Text variant="title" sx={{ mt: 1 }}>
        {theme.name}
      </Text>
      <Text variant="body">{theme.authors[0].name}</Text>
      <Flex sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="subBody">
          {theme.colorScheme === "dark" ? "Dark" : "Light"}
          &nbsp;&nbsp;
          {theme.totalInstalls ? `${theme.totalInstalls} installs` : ""}
        </Text>
        {isApplied ? (
          <CheckCircleOutline color="accent" size={20} />
        ) : (
          <Button
            className="set-as-button"
            variant="secondary"
            sx={{ visibility: "hidden", bg: "background" }}
            onClick={(e) => {
              e.stopPropagation();
              setTheme(theme);
            }}
            disabled={isApplying}
          >
            {isApplying ? (
              <Loading color="accent" size={18} />
            ) : theme.colorScheme === "dark" ? (
              strings.setAsDarkTheme()
            ) : (
              strings.setAsLightTheme()
            )}
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
