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

import { Checkbox, Flex, Label, Text } from "@theme-ui/components";
import { useRef } from "react";
import { mdToHtml } from "../utils/md";
import Dialog from "../components/dialog";
import { BaseDialogProps, DialogManager } from "../common/dialog-manager";
import { db } from "../common/db";
import { getChangelog } from "../utils/version";
import { downloadUpdate, installUpdate } from "../utils/updater";
import Config from "../utils/config";
import { isMac } from "../utils/platform";
import { ErrorText } from "../components/error-text";
import { strings } from "@notesnook/intl";
import Field from "../components/field";

type Check = { text: string; default?: boolean };
type Input = {
  title: string;
  defaultValue?: string;
  multiline?: boolean;
  helpText?: string;
  required?: boolean;
};
export type ConfirmDialogProps = BaseDialogProps<
  | false
  | {
      checks?: Record<string, boolean>;
      inputs?: Record<string, string>;
    }
> & {
  title: string;
  subtitle?: string;
  width?: number;
  positiveButtonText?: string;
  negativeButtonText?: string;
  message?: string;
  warnings?: string[];
  checks?: Record<string, Check>;
  inputs?: Record<string, Input>;
};

export const ConfirmDialog = DialogManager.register(function ConfirmDialog(
  props: ConfirmDialogProps
) {
  const {
    onClose,
    title,
    subtitle,
    width,
    negativeButtonText,
    positiveButtonText,
    message,
    warnings,
    checks,
    inputs
  } = props;
  const checkedItems = useRef<Record<string, boolean>>({} as any);
  const inputItems = useRef<Record<string, string>>({} as any);

  return (
    <Dialog
      testId="confirm-dialog"
      isOpen={true}
      title={title}
      width={width}
      description={subtitle}
      onClose={() => onClose(false)}
      onOpen={() => {
        for (const checkId in checks) {
          checkedItems.current[checkId] = checks[checkId]?.default || false;
        }
        for (const inputId in inputs) {
          inputItems.current[inputId] = inputs[inputId]?.defaultValue || "";
        }
      }}
      positiveButton={
        positiveButtonText
          ? {
              text: positiveButtonText,
              onClick: () =>
                onClose({
                  checks: checkedItems.current,
                  inputs: inputItems.current
                }),
              autoFocus: !!positiveButtonText
            }
          : undefined
      }
      negativeButton={
        negativeButtonText
          ? {
              text: negativeButtonText,
              onClick: () => onClose(false)
            }
          : undefined
      }
    >
      <Flex
        sx={{
          flexDirection: "column",
          gap: 1,
          pb: !negativeButtonText && !positiveButtonText ? 2 : 0,
          p: { m: 0 }
        }}
      >
        {message ? (
          <Text
            as="div"
            variant="body"
            sx={{ overflowWrap: "break-word" }}
            dangerouslySetInnerHTML={{ __html: mdToHtml(message) }}
          />
        ) : null}
        {warnings?.map((text) => (
          <ErrorText key={text} error={text} sx={{ mt: 0 }} />
        ))}
        {inputs
          ? Object.entries(inputs).map(([id, input]) => (
              <Field
                as={input.multiline ? "textarea" : "input"}
                key={id}
                label={input.title}
                helpText={input.helpText}
                defaultValue={input.defaultValue}
                required={input.required}
                onChange={(e) => {
                  inputItems.current[id] = e.target.value;
                }}
              />
            ))
          : null}
        {checks
          ? Object.entries<Check>(checks).map(([id, check]) => (
              <Label
                key={id}
                id={id}
                variant="text.body"
                sx={{ fontWeight: "bold" }}
              >
                <Checkbox
                  name={id}
                  defaultChecked={check.default}
                  sx={{
                    mr: "small",
                    width: 18,
                    height: 18,
                    color: "accent"
                  }}
                  onChange={(e) =>
                    (checkedItems.current[id] = e.currentTarget.checked)
                  }
                />
                {check.text}
              </Label>
            ))
          : null}
      </Flex>
    </Dialog>
  );
});

export function showMultiDeleteConfirmation(length: number) {
  return ConfirmDialog.show({
    title: strings.doActions.delete.item(length),
    message: strings.moveToTrashDesc(
      db.settings.getTrashCleanupInterval() || 7
    ),
    positiveButtonText: strings.yes(),
    negativeButtonText: strings.no()
  });
}

export function showMultiPermanentDeleteConfirmation(length: number) {
  return ConfirmDialog.show({
    title: strings.doActions.permanentlyDelete.item(length),
    message: strings.irreverisibleAction(),
    positiveButtonText: strings.yes(),
    negativeButtonText: strings.no()
  });
}

export async function showLogoutConfirmation() {
  return await ConfirmDialog.show({
    title: strings.logout(),
    message: strings.logoutConfirmation(),
    positiveButtonText: strings.yes(),
    negativeButtonText: strings.no(),
    warnings: (await db.hasUnsyncedChanges())
      ? [strings.unsyncedChangesWarning()]
      : [],
    checks: {
      backup: {
        text: strings.backupDataBeforeLogout(),
        default: true
      }
    }
  });
}

export function showClearSessionsConfirmation() {
  return ConfirmDialog.show({
    title: strings.logoutAllOtherDevices(),
    message: strings.logoutAllOtherDevicesDescription(),
    positiveButtonText: strings.yes(),
    negativeButtonText: strings.no()
  });
}

// Epigrapho: a new version offers itself with its notes (the tag's message,
// as the release shows them). "Recordarme más tarde" quiets that version for
// a day; the status bar keeps showing it.
const SNOOZE = "updateSnooze";
const DAY = 24 * 60 * 60 * 1000;
let offering: string | undefined;
let installWhenReady = false;

export async function offerUpdate(
  status: { type: "available" | "completed"; version: string },
  asked = false
) {
  if (status.type === "completed" && installWhenReady)
    return installUpdate({ confirmed: true });
  const snooze = Config.get<{ version: string; until: number } | undefined>(
    SNOOZE
  );
  const snoozed =
    snooze?.version === status.version && snooze.until > Date.now();
  if (offering || (snoozed && !asked)) return;

  offering = status.version;
  const notes = await getChangelog(status.version);
  const install = await ConfirmDialog.show({
    title: strings.updateReady(status.version),
    subtitle: strings.updateWhatsNew(),
    // On macOS the install is a .dmg to drag, so the steps go here too.
    message: isMac() ? `${notes}\n\n${strings.macUpdateSteps()}` : notes,
    width: 500,
    positiveButtonText: strings.installNow(),
    negativeButtonText: strings.remindMeLater()
  });
  offering = undefined;
  if (!install) {
    Config.set(SNOOZE, { version: status.version, until: Date.now() + DAY });
    return;
  }
  Config.remove(SNOOZE);
  if (status.type === "completed") return installUpdate({ confirmed: true });
  installWhenReady = true;
  await downloadUpdate();
}
