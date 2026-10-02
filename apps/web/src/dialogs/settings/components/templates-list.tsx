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

import { Button, Flex, Text } from "@theme-ui/components";
import { useEffect, useState } from "react";
import { strings } from "@notesnook/intl";
import {
  builtInTemplates,
  deleteTemplate,
  renameTemplate,
  Template,
  userTemplates
} from "../../../common/templates";
import { PromptDialog } from "../../prompt";
import { db } from "../../../common/db";
import { EVENTS } from "@notesnook/core";

/** Epigrapho (A3): the built-in templates, and the person's to rename or delete. */
export function TemplatesList() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const reload = () => userTemplates().then(setTemplates);
  useEffect(() => {
    reload();
    // Templates also arrive by sync, or change from another dialog.
    const event = db.eventManager.subscribe(
      EVENTS.databaseUpdated,
      (event: { collection?: string }) => {
        // The settings cache is updated after this event goes out, so the
        // list is read on the next turn, not inside it.
        if (event.collection === "settings") setTimeout(reload);
      }
    );
    return () => {
      event.unsubscribe();
    };
  }, []);

  return (
    <Flex sx={{ flexDirection: "column", gap: 1, mt: 1 }}>
      <Text variant="subtitle">{strings.templates.builtIn()}</Text>
      {builtInTemplates().map((template) => (
        <Text key={template.id} variant="body">
          {template.title}
        </Text>
      ))}
      <Text variant="subtitle" sx={{ mt: 2 }}>
        {strings.templates.yours()}
      </Text>
      {templates.length === 0 ? (
        <Text variant="body" sx={{ color: "paragraph-secondary" }}>
          {strings.templates.none()}
        </Text>
      ) : (
        templates.map((template) => (
          <Flex
            key={template.id}
            data-test-id="user-template"
            sx={{ alignItems: "center", gap: 1 }}
          >
            <Text variant="body" sx={{ flex: 1 }}>
              {template.title}
            </Text>
            <Button
              variant="secondary"
              onClick={async () => {
                const title = await PromptDialog.show({
                  title: strings.rename(),
                  description: strings.templates.templateName()
                });
                if (!title) return;
                await renameTemplate(template.id, title);
                await reload();
              }}
            >
              {strings.rename()}
            </Button>
            <Button
              variant="errorSecondary"
              onClick={async () => {
                await deleteTemplate(template.id);
                await reload();
              }}
            >
              {strings.delete()}
            </Button>
          </Flex>
        ))
      )}
    </Flex>
  );
}
