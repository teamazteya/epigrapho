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

import {
  allTemplates,
  deleteTemplate,
  newNoteFromTemplate,
  NoteTemplate,
  renameTemplate
} from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { useThemeColors } from "@notesnook/theme";
import React, { useState } from "react";
import { View } from "react-native";
import { FlatList } from "react-native-actions-sheet";
import { db } from "../../../common/database";
import { getUiLocale } from "../../../common/ui-locale";
import { presentSheet } from "../../../services/event-manager";
import Navigation from "../../../services/navigation";
import { AppFontSize } from "../../../utils/size";
import { DefaultAppStyles } from "../../../utils/styles";
import { sleep } from "../../../utils/time";
import { presentDialog } from "../../dialog/functions";
import { openNote } from "../../list-items/note/wrapper";
import { IconButton } from "../../ui/icon-button";
import { Pressable } from "../../ui/pressable";
import Heading from "../../ui/typography/heading";
import Paragraph from "../../ui/typography/paragraph";

/**
 * Epigrapho (A3 Fase 1, M1 Fase 5c): every template, built in and the
 * person's. A tap starts a note with it; the person's own can be renamed or
 * deleted here, as in the desktop's Settings → Editor → Templates.
 */
const Templates = ({ close }: { close?: () => void }) => {
  const { colors } = useThemeColors();
  const [templates, setTemplates] = useState(() => allTemplates(db));
  const reload = () => setTemplates(allTemplates(db));

  const create = async (template: NoteTemplate) => {
    close?.();
    const id = await newNoteFromTemplate(db, template, getUiLocale());
    const note = id && (await db.notes.note(id));
    if (!note) return;
    Navigation.queueRoutesForUpdate();
    await sleep(300);
    openNote(note);
  };

  const rename = async (template: NoteTemplate) => {
    close?.();
    await sleep(300);
    presentDialog({
      title: strings.rename(),
      input: true,
      inputPlaceholder: strings.templates.templateName(),
      defaultValue: template.title,
      positiveText: strings.save(),
      positivePress: async (title: string) => {
        await renameTemplate(db, template.id, title);
        return true;
      }
    });
  };

  return (
    <View
      style={{
        paddingHorizontal: DefaultAppStyles.GAP,
        gap: 12,
        paddingTop: DefaultAppStyles.GAP_VERTICAL
      }}
    >
      <Heading size={AppFontSize.lg}>
        {strings.templates.newFromTemplate()}
      </Heading>
      <FlatList
        data={templates}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <>
            {!item.builtIn && templates[index - 1]?.builtIn ? (
              <Paragraph
                size={AppFontSize.sm}
                color={colors.secondary.paragraph}
                style={{ marginTop: 12 }}
              >
                {strings.templates.yours()}
              </Paragraph>
            ) : null}
            <Pressable
              testID={`template-${item.id}`}
              type="transparent"
              onPress={() => create(item)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: 45
              }}
            >
              <Paragraph size={AppFontSize.md} style={{ flexShrink: 1 }}>
                {item.title}
              </Paragraph>
              {item.builtIn ? null : (
                <View style={{ flexDirection: "row" }}>
                  <IconButton
                    name="pencil-outline"
                    accessibilityLabel={strings.rename()}
                    onPress={() => rename(item)}
                    size={AppFontSize.lg}
                  />
                  <IconButton
                    name="delete-outline"
                    accessibilityLabel={strings.delete()}
                    color={colors.error.icon}
                    onPress={async () => {
                      await deleteTemplate(db, item.id);
                      reload();
                    }}
                    size={AppFontSize.lg}
                  />
                </View>
              )}
            </Pressable>
          </>
        )}
        ListFooterComponent={
          <>
            {templates.every((t) => t.builtIn) ? (
              <Paragraph
                size={AppFontSize.sm}
                color={colors.secondary.paragraph}
                style={{ marginTop: 12 }}
              >
                {strings.templates.none()}
              </Paragraph>
            ) : null}
            <View style={{ height: 50 }} />
          </>
        }
      />
    </View>
  );
};

Templates.present = () => {
  presentSheet({
    component: (ref, close) => <Templates close={close} />
  });
};

export default Templates;
