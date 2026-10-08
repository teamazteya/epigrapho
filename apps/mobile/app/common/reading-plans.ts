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

// Epigrapho (A3 Fase 3, M1 Fase 5c): the reading plan being followed. Its
// progress lives in the account's settings and its daily reminder is an
// ordinary reminder, so both travel with the account.
//
// ponytail: a copy of apps/web/src/common/reading-plans.ts with the phone's
// database, reminders and editor. The logic needs the scripture packages,
// which @notesnook/core does not depend on; move it there the day a third
// app follows plans.
import { EpigraphoReadingPlan } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { BOOK_NAMES } from "@notesnook/scripture-parser";
import {
  READING_PLAN_IDS,
  ReadingPlanId,
  readingPlanDays,
  readingRef
} from "@notesnook/scripture-provider";
import dayjs from "dayjs";
import { openNote } from "../components/list-items/note/wrapper";
import Navigation from "../services/navigation";
import Notifications from "../services/notifications";
import { db } from "./database";
import { getBookNameLocale, getUiLocale } from "./ui-locale";

const SETTING = "epigrapho:readingPlan";
/** The reminder's default time (A3, 2026-10-01). */
export const DEFAULT_REMINDER = "08:00";

export { READING_PLAN_IDS };
export type { ReadingPlanId };

export function planName(id: string) {
  const plans = strings.readingPlans;
  if (id === "mcheyne") return plans.mcheyne();
  if (id === "chronological") return plans.chronological();
  if (id === "nt90") return plans.nt90();
  return plans.psalmsProverbs();
}

export function planDescription(id: string) {
  const plans = strings.readingPlans;
  if (id === "mcheyne") return plans.mcheyneDesc();
  if (id === "chronological") return plans.chronologicalDesc();
  if (id === "nt90") return plans.nt90Desc();
  return plans.psalmsProverbsDesc();
}

export const planDays = (id: string) => readingPlanDays(id as ReadingPlanId);

export function activePlan(): EpigraphoReadingPlan | undefined {
  return db.settings.getEpigrapho(SETTING);
}

/** 0-based day of the plan that falls on `date`; negative before it starts. */
export function dayOf(plan: EpigraphoReadingPlan, date = dayjs()) {
  return date.startOf("day").diff(dayjs(plan.start).startOf("day"), "day");
}

/** "Génesis 9-10", "Salmos 119:1-24": a reading as a person names it. */
export function readingLabel(reading: string) {
  const names = BOOK_NAMES[getBookNameLocale()] as Record<string, string>;
  const [book, rest] = [reading.slice(0, 3), reading.slice(4)];
  const verses = /^(\d+)\.(\d+)-(\d+)$/.exec(rest);
  return `${names[book] ?? book} ${
    verses ? `${verses[1]}:${verses[2]}-${verses[3]}` : rest
  }`;
}

export const formatDate = (date: string | number | dayjs.Dayjs) =>
  dayjs(date).toDate().toLocaleDateString(getUiLocale(), { dateStyle: "long" });

async function save(plan: EpigraphoReadingPlan | undefined) {
  await db.settings.setEpigrapho(SETTING, plan);
}

/** Reschedules the phone's reminders and refreshes their list. */
function remindersChanged() {
  Notifications.setupReminders(true);
  Navigation.queueRoutesForUpdate();
}

export async function startPlan(planId: ReadingPlanId, start: string) {
  await stopPlan();
  const plan: EpigraphoReadingPlan = { planId, start, done: [] };
  plan.reminderId = await saveReminder(plan, DEFAULT_REMINDER);
  await save(plan);
}

export async function stopPlan() {
  const plan = activePlan();
  if (plan?.reminderId) {
    await db.reminders.remove(plan.reminderId);
    remindersChanged();
  }
  await save(undefined);
}

export async function setDayRead(day: number, read: boolean) {
  const plan = activePlan();
  if (!plan) return;
  const done = new Set(plan.done);
  if (read) done.add(day);
  else done.delete(day);
  await save({ ...plan, done: [...done].sort((a, b) => a - b) });
}

/** The days before today that are not marked as read. */
export function pendingDays(plan: EpigraphoReadingPlan) {
  const today = Math.min(dayOf(plan), planDays(plan.planId).length);
  return Array.from({ length: Math.max(0, today) }, (_, day) => day).filter(
    (day) => !plan.done.includes(day)
  );
}

/** The reminder's time as "HH:mm", or undefined when it is off. */
export async function reminderTime(plan: EpigraphoReadingPlan) {
  const reminder =
    plan.reminderId && (await db.reminders.reminder(plan.reminderId));
  return reminder ? dayjs(reminder.date).format("HH:mm") : undefined;
}

async function saveReminder(plan: EpigraphoReadingPlan, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  let date = dayjs().hour(hour).minute(minute).second(0).millisecond(0);
  if (date.isBefore(dayjs())) date = date.add(1, "day");
  const id = await db.reminders.add({
    id: plan.reminderId,
    title: strings.readingPlans.reminderTitle(planName(plan.planId)),
    mode: "repeat",
    recurringMode: "day",
    selectedDays: [],
    priority: "vibrate",
    date: date.valueOf(),
    disabled: false,
    snoozeUntil: 0
  });
  remindersChanged();
  return id;
}

/** Turns the daily reminder on at `time` ("HH:mm"), or off with undefined. */
export async function setReminder(time: string | undefined) {
  const plan = activePlan();
  if (!plan) return;
  if (!time) {
    if (plan.reminderId) await db.reminders.remove(plan.reminderId);
    remindersChanged();
    await save({ ...plan, reminderId: undefined });
    return;
  }
  // A phone asks before it shows notifications; the plan starts without
  // asking, so it is asked here, when the person turns the reminder on.
  await Notifications.checkAndRequestPermissions(true);
  await save({ ...plan, reminderId: await saveReminder(plan, time) });
}

/**
 * "Escribir sobre esto": the only way a plan makes a note (A3). It carries the
 * day's readings already marked as references.
 */
export async function writeAbout(day: number) {
  const plan = activePlan();
  if (!plan) return;
  const readings = planDays(plan.planId)[day] ?? [];
  const date = formatDate(dayjs(plan.start).add(day, "day"));
  const references = readings
    .map(
      (reading) =>
        `<span data-scripture-ref="${readingRef(
          reading
        )}" data-versification="eng" class="scripture-reference">${readingLabel(
          reading
        )}</span>`
    )
    .join("; ");
  const id = await db.notes.add({
    title: strings.readingPlans.noteTitle(planName(plan.planId), day + 1, date),
    content: { type: "tiptap", data: `<p>${references}</p><p></p>` }
  });
  const note = id && (await db.notes.note(id));
  if (!note) return;
  Navigation.queueRoutesForUpdate();
  openNote(note);
}
