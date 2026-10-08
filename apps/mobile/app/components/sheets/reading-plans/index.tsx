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

import { EpigraphoReadingPlan, EVENTS } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { readingRef } from "@notesnook/scripture-provider";
import { useThemeColors } from "@notesnook/theme";
import dayjs from "dayjs";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { ScrollView } from "react-native-actions-sheet";
import DatePicker from "react-native-date-picker";
//@ts-ignore
import ToggleSwitch from "toggle-switch-react-native";
import { db } from "../../../common/database";
import {
  activePlan,
  dayOf,
  DEFAULT_REMINDER,
  formatDate,
  pendingDays,
  planDays,
  planDescription,
  planName,
  READING_PLAN_IDS,
  readingLabel,
  ReadingPlanId,
  reminderTime,
  setDayRead,
  setReminder,
  startPlan,
  stopPlan,
  writeAbout
} from "../../../common/reading-plans";
import { getTranslation, resolveVerse } from "../../../common/scripture";
import { getUiLocale } from "../../../common/ui-locale";
import { presentSheet } from "../../../services/event-manager";
import { AppFontSize } from "../../../utils/size";
import { DefaultAppStyles } from "../../../utils/styles";
import { sleep } from "../../../utils/time";
import { presentDialog } from "../../dialog/functions";
import { Button } from "../../ui/button";
import Heading from "../../ui/typography/heading";
import Paragraph from "../../ui/typography/paragraph";

/**
 * Epigrapho (A3 Fase 3, M1 Fase 5c): the reading plans, as on the desktop
 * (apps/web/src/views/reading-plans.tsx): choose one, then follow it day by
 * day. A sheet from the side menu, since a plan is checked and closed.
 */

/** The plan as the account has it, kept current when it changes or syncs. */
function usePlan() {
  const [plan, setPlan] = useState(activePlan);
  useEffect(() => {
    const event = db.eventManager.subscribe(
      EVENTS.databaseUpdated,
      (event: { collection?: string }) => {
        // The settings cache is updated after this event goes out, so the
        // plan is read on the next turn, not inside it.
        if (event.collection === "settings")
          setTimeout(() => setPlan(activePlan()));
      }
    );
    return () => {
      event.unsubscribe();
    };
  }, []);
  return plan;
}

const pickerLocale = () => (getUiLocale() === "en-US" ? "en" : "es");

function ChoosePlan() {
  const { colors, isDark } = useThemeColors();
  const [start, setStart] = useState(() => new Date());
  const [picking, setPicking] = useState(false);
  return (
    <View style={{ gap: 12 }}>
      <Paragraph color={colors.secondary.paragraph}>
        {strings.readingPlans.choose()}
      </Paragraph>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <Paragraph>{strings.readingPlans.startDate()}</Paragraph>
        <Button
          testID="reading-plan-start"
          type="secondary"
          style={{ paddingHorizontal: 12 }}
          title={formatDate(start.getTime())}
          onPress={() => setPicking(true)}
        />
      </View>
      <DatePicker
        modal
        open={picking}
        date={start}
        mode="date"
        theme={isDark ? "dark" : "light"}
        locale={pickerLocale()}
        title={strings.readingPlans.startDate()}
        confirmText={strings.done()}
        cancelText={strings.cancel()}
        onConfirm={(date) => {
          setPicking(false);
          setStart(date);
        }}
        onCancel={() => setPicking(false)}
      />
      {READING_PLAN_IDS.map((id) => (
        <View
          key={id}
          testID={`reading-plan-${id}`}
          style={{
            gap: 6,
            padding: 12,
            borderWidth: 1,
            borderColor: colors.primary.border,
            borderRadius: 10
          }}
        >
          <Heading size={AppFontSize.md}>{planName(id)}</Heading>
          <Paragraph color={colors.secondary.paragraph}>
            {planDescription(id)}
          </Paragraph>
          <Button
            testID={`reading-plan-start-${id}`}
            type="accent"
            title={strings.readingPlans.start()}
            style={{ alignSelf: "flex-start", paddingHorizontal: 16 }}
            onPress={() =>
              startPlan(id as ReadingPlanId, dayjs(start).format("YYYY-MM-DD"))
            }
          />
        </View>
      ))}
    </View>
  );
}

/** One reading, with its text on request, in the preferred translation. */
function Reading({ reading }: { reading: string }) {
  const [text, setText] = useState<string>();
  const [open, setOpen] = useState(false);
  return (
    <View testID="reading">
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8
        }}
      >
        <Paragraph style={{ fontWeight: "bold", flexShrink: 1 }}>
          {readingLabel(reading)}
        </Paragraph>
        <Button
          testID="reading-show-text"
          type="secondary"
          height={36}
          style={{ paddingHorizontal: 12 }}
          title={
            open
              ? strings.readingPlans.hideText()
              : strings.readingPlans.showText()
          }
          onPress={async () => {
            if (!open && text === undefined) {
              const verse = await resolveVerse(
                readingRef(reading),
                getTranslation()
              ).catch(() => undefined);
              setText(verse?.text || "");
            }
            setOpen(!open);
          }}
        />
      </View>
      {open ? (
        <Paragraph
          testID="reading-text"
          size={AppFontSize.md}
          style={{ marginTop: 6, fontFamily: "serif", lineHeight: 26 }}
        >
          {text}
        </Paragraph>
      ) : null}
    </View>
  );
}

function Day({
  plan,
  day,
  close
}: {
  plan: EpigraphoReadingPlan;
  day: number;
  close?: () => void;
}) {
  const readings = planDays(plan.planId)[day] ?? [];
  const read = plan.done.includes(day);
  return (
    <View style={{ gap: 10 }} testID="reading-day">
      <Heading size={AppFontSize.sm}>
        {strings.readingPlans.dayOf(day + 1, planDays(plan.planId).length)} ·{" "}
        {formatDate(dayjs(plan.start).add(day, "day"))}
      </Heading>
      {readings.map((reading) => (
        <Reading key={reading} reading={reading} />
      ))}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button
          testID="reading-day-read"
          type={read ? "secondary" : "accent"}
          style={{ paddingHorizontal: 16 }}
          title={
            read
              ? `✓ ${strings.readingPlans.read()}`
              : strings.readingPlans.markRead()
          }
          onPress={() => setDayRead(day, !read)}
        />
        <Button
          testID="reading-day-write"
          type="secondary"
          style={{ paddingHorizontal: 16 }}
          title={strings.readingPlans.writeAbout()}
          onPress={async () => {
            close?.();
            await sleep(300);
            writeAbout(day);
          }}
        />
      </View>
    </View>
  );
}

function ReminderSetting({ plan }: { plan: EpigraphoReadingPlan }) {
  const { colors, isDark } = useThemeColors();
  const [time, setTime] = useState<string>();
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    reminderTime(plan).then(setTime);
  }, [plan.reminderId]);
  const [hour, minute] = (time || DEFAULT_REMINDER).split(":").map(Number);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <ToggleSwitch
        isOn={!!time}
        onColor={colors.primary.accent}
        offColor={colors.primary.icon}
        size="small"
        animationSpeed={150}
        onToggle={(on: boolean) => setReminder(on ? DEFAULT_REMINDER : undefined)}
      />
      <Paragraph style={{ flex: 1 }}>
        {strings.readingPlans.reminder()}
      </Paragraph>
      {time ? (
        <Button
          testID="reading-plan-reminder-time"
          type="secondary"
          style={{ paddingHorizontal: 12 }}
          title={time}
          onPress={() => setPicking(true)}
        />
      ) : null}
      <DatePicker
        modal
        open={picking}
        date={dayjs().hour(hour).minute(minute).toDate()}
        mode="time"
        theme={isDark ? "dark" : "light"}
        locale={pickerLocale()}
        title={strings.readingPlans.reminder()}
        confirmText={strings.done()}
        cancelText={strings.cancel()}
        onConfirm={(date) => {
          setPicking(false);
          setReminder(dayjs(date).format("HH:mm"));
        }}
        onCancel={() => setPicking(false)}
      />
    </View>
  );
}

function FollowPlan({
  plan,
  close
}: {
  plan: EpigraphoReadingPlan;
  close?: () => void;
}) {
  const { colors } = useThemeColors();
  const total = planDays(plan.planId).length;
  const today = dayOf(plan);
  const pending = pendingDays(plan);
  const [shown, setShown] = useState(() =>
    Math.min(Math.max(today, 0), total - 1)
  );
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Heading size={AppFontSize.lg} testID="reading-plan-name">
          {planName(plan.planId)}
        </Heading>
        <Paragraph color={colors.secondary.paragraph}>
          {today < 0
            ? strings.readingPlans.notStarted(formatDate(plan.start))
            : today >= total
            ? strings.readingPlans.finished()
            : strings.readingPlans.progress(plan.done.length, total)}
        </Paragraph>
        <View
          style={{
            height: 4,
            borderRadius: 2,
            overflow: "hidden",
            backgroundColor: colors.primary.border
          }}
        >
          <View
            style={{
              height: "100%",
              width: `${(plan.done.length / total) * 100}%`,
              backgroundColor: colors.primary.accent
            }}
          />
        </View>
      </View>

      {pending.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Paragraph testID="reading-plan-pending">
            {strings.readingPlans.pending(pending.length)}
          </Paragraph>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {pending.slice(0, 14).map((day) => (
              <Button
                key={day}
                type={day === shown ? "accent" : "secondary"}
                height={36}
                style={{ paddingHorizontal: 12 }}
                title={`${day + 1}`}
                onPress={() => setShown(day)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {today >= 0 ? <Day plan={plan} day={shown} close={close} /> : null}
      {shown !== Math.min(today, total - 1) && today >= 0 && today < total ? (
        <Button
          type="secondary"
          style={{ alignSelf: "flex-start", paddingHorizontal: 16 }}
          title={strings.readingPlans.today()}
          onPress={() => setShown(today)}
        />
      ) : null}

      <ReminderSetting plan={plan} />

      <Button
        testID="reading-plan-stop"
        type="errorShade"
        style={{ alignSelf: "flex-start", paddingHorizontal: 16 }}
        title={strings.readingPlans.stop()}
        onPress={() =>
          presentDialog({
            title: strings.readingPlans.stop(),
            paragraph: strings.readingPlans.stopConfirm(),
            positiveText: strings.readingPlans.stop(),
            negativeText: strings.cancel(),
            positiveType: "errorShade",
            positivePress: async () => {
              await stopPlan();
              return true;
            }
          })
        }
      />
    </View>
  );
}

const ReadingPlans = ({ close }: { close?: () => void }) => {
  const plan = usePlan();
  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: DefaultAppStyles.GAP,
        paddingTop: DefaultAppStyles.GAP_VERTICAL,
        paddingBottom: 50,
        gap: 12
      }}
    >
      <Heading size={AppFontSize.lg}>{strings.readingPlans.title()}</Heading>
      {plan ? (
        <FollowPlan key={plan.planId + plan.start} plan={plan} close={close} />
      ) : (
        <ChoosePlan />
      )}
    </ScrollView>
  );
};

ReadingPlans.present = () => {
  presentSheet({
    component: (ref, close) => <ReadingPlans close={close} />
  });
};

export default ReadingPlans;
