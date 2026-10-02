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

// Epigrapho (A3 Fase 3): the reading plans screen, in the list column.
import { EpigraphoReadingPlan, EVENTS } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { parseRef } from "@notesnook/scripture-parser";
import { readingRef } from "@notesnook/scripture-provider";
import { Box, Button, Flex, Input, Switch, Text } from "@theme-ui/components";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { db } from "../common/db";
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
} from "../common/reading-plans";
import { resolveVerse } from "../common/scripture";
import { getTranslation } from "../common/translation";
import { ScrollContainer } from "@notesnook/ui";
import { ConfirmDialog } from "../dialogs/confirm";

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

function ChoosePlan() {
  const [start, setStart] = useState(dayjs().format("YYYY-MM-DD"));
  return (
    <Flex sx={{ flexDirection: "column", gap: 3, p: 2 }}>
      <Text variant="body" sx={{ color: "paragraph-secondary" }}>
        {strings.readingPlans.choose()}
      </Text>
      <Flex as="label" sx={{ flexDirection: "column", gap: 1 }}>
        <Text variant="subtitle">{strings.readingPlans.startDate()}</Text>
        <Input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          data-test-id="reading-plan-start"
        />
      </Flex>
      {READING_PLAN_IDS.map((id) => (
        <Flex
          key={id}
          data-test-id={`reading-plan-${id}`}
          sx={{
            flexDirection: "column",
            gap: 1,
            p: 2,
            border: "1px solid var(--border)",
            borderRadius: "default"
          }}
        >
          <Text variant="title">{planName(id)}</Text>
          <Text variant="body" sx={{ color: "paragraph-secondary" }}>
            {planDescription(id)}
          </Text>
          <Button
            variant="accent"
            sx={{ alignSelf: "flex-start", mt: 1 }}
            onClick={() => startPlan(id as ReadingPlanId, start)}
          >
            {strings.readingPlans.start()}
          </Button>
        </Flex>
      ))}
    </Flex>
  );
}

/** One reading, with its text on request, in the preferred translation. */
function Reading({ reading }: { reading: string }) {
  const [text, setText] = useState<string>();
  const [open, setOpen] = useState(false);
  return (
    <Flex sx={{ flexDirection: "column" }} data-test-id="reading">
      <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="body" sx={{ fontWeight: "bold" }}>
          {readingLabel(reading)}
        </Text>
        <Button
          variant="secondary"
          sx={{ py: 1, px: 2, fontSize: "body" }}
          onClick={async () => {
            if (!open && text === undefined) {
              const range = parseRef(readingRef(reading));
              const verse =
                range && (await resolveVerse(range, getTranslation()));
              setText(verse ? verse.text : "");
            }
            setOpen(!open);
          }}
        >
          {open
            ? strings.readingPlans.hideText()
            : strings.readingPlans.showText()}
        </Button>
      </Flex>
      {open && (
        <Text
          as="p"
          data-test-id="reading-text"
          sx={{
            mt: 1,
            fontFamily:
              "'Cormorant Garamond', 'Source Serif 4', Georgia, serif",
            fontSize: "1.0625rem",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap"
          }}
        >
          {text}
        </Text>
      )}
    </Flex>
  );
}

function Day({ plan, day }: { plan: EpigraphoReadingPlan; day: number }) {
  const readings = planDays(plan.planId)[day] ?? [];
  const read = plan.done.includes(day);
  return (
    <Flex sx={{ flexDirection: "column", gap: 2 }} data-test-id="reading-day">
      <Text variant="subtitle">
        {strings.readingPlans.dayOf(day + 1, planDays(plan.planId).length)} ·{" "}
        {formatDate(dayjs(plan.start).add(day, "day"))}
      </Text>
      {readings.map((reading) => (
        <Reading key={reading} reading={reading} />
      ))}
      <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
        <Button
          variant={read ? "secondary" : "accent"}
          data-test-id="reading-day-read"
          onClick={() => setDayRead(day, !read)}
        >
          {read
            ? `✓ ${strings.readingPlans.read()}`
            : strings.readingPlans.markRead()}
        </Button>
        <Button variant="secondary" onClick={() => writeAbout(day)}>
          {strings.readingPlans.writeAbout()}
        </Button>
      </Flex>
    </Flex>
  );
}

function ReminderSetting({ plan }: { plan: EpigraphoReadingPlan }) {
  const [time, setTime] = useState<string>();
  useEffect(() => {
    reminderTime(plan).then(setTime);
  }, [plan.reminderId]);
  return (
    <Flex sx={{ alignItems: "center", gap: 2 }}>
      <Flex as="label" sx={{ alignItems: "center", gap: 1, flex: 1 }}>
        <Switch
          checked={!!time}
          data-test-id="reading-plan-reminder"
          onChange={(e) =>
            setReminder(e.target.checked ? DEFAULT_REMINDER : undefined)
          }
        />
        <Text variant="body">{strings.readingPlans.reminder()}</Text>
      </Flex>
      {time && (
        <Input
          type="time"
          value={time}
          data-test-id="reading-plan-reminder-time"
          sx={{ width: "auto" }}
          onChange={(e) => e.target.value && setReminder(e.target.value)}
        />
      )}
    </Flex>
  );
}

function FollowPlan({ plan }: { plan: EpigraphoReadingPlan }) {
  const total = planDays(plan.planId).length;
  const today = dayOf(plan);
  const pending = pendingDays(plan);
  const [shown, setShown] = useState(() =>
    Math.min(Math.max(today, 0), total - 1)
  );
  return (
    <Flex sx={{ flexDirection: "column", gap: 3, p: 2 }}>
      <Flex sx={{ flexDirection: "column", gap: 1 }}>
        <Text variant="title" data-test-id="reading-plan-name">
          {planName(plan.planId)}
        </Text>
        <Text variant="body" sx={{ color: "paragraph-secondary" }}>
          {today < 0
            ? strings.readingPlans.notStarted(formatDate(plan.start))
            : today >= total
            ? strings.readingPlans.finished()
            : strings.readingPlans.progress(plan.done.length, total)}
        </Text>
        <Box
          sx={{ height: 4, bg: "border", borderRadius: 2, overflow: "hidden" }}
        >
          <Box
            sx={{
              height: "100%",
              width: `${(plan.done.length / total) * 100}%`,
              bg: "accent"
            }}
          />
        </Box>
      </Flex>

      {pending.length > 0 && (
        <Flex sx={{ flexDirection: "column", gap: 1 }}>
          <Text variant="body" data-test-id="reading-plan-pending">
            {strings.readingPlans.pending(pending.length)}
          </Text>
          <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
            {pending.slice(0, 14).map((day) => (
              <Button
                key={day}
                variant={day === shown ? "accent" : "secondary"}
                sx={{ py: 1, px: 2 }}
                onClick={() => setShown(day)}
              >
                {day + 1}
              </Button>
            ))}
          </Flex>
        </Flex>
      )}

      {today >= 0 && <Day plan={plan} day={shown} />}
      {shown !== Math.min(today, total - 1) && today >= 0 && today < total && (
        <Button
          variant="secondary"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => setShown(today)}
        >
          {strings.readingPlans.today()}
        </Button>
      )}

      <ReminderSetting plan={plan} />

      <Button
        variant="errorSecondary"
        sx={{ alignSelf: "flex-start" }}
        onClick={async () => {
          const ok = await ConfirmDialog.show({
            title: strings.readingPlans.stop(),
            message: strings.readingPlans.stopConfirm(),
            positiveButtonText: strings.readingPlans.stop(),
            negativeButtonText: strings.cancel()
          });
          if (ok) await stopPlan();
        }}
      >
        {strings.readingPlans.stop()}
      </Button>
    </Flex>
  );
}

export default function ReadingPlans() {
  const plan = usePlan();
  return (
    <ScrollContainer>
      {plan ? (
        <FollowPlan key={plan.planId + plan.start} plan={plan} />
      ) : (
        <ChoosePlan />
      )}
    </ScrollContainer>
  );
}
