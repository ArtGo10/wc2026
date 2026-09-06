import { makeFunctionReference, type FunctionReference } from "convex/server";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type PushToAllUsersResult = {
  created: number;
  sent: number;
  skippedDuplicate: boolean;
  updated: number;
};

type PushToAllUsersArgs = {
  body: string;
  data?: { kind: string };
  expectedGameweekDeadlineAt?: number;
  gameweekId?: Id<"fantasyGameweeks">;
  gameweekName?: string;
  gameweekNumber?: number;
  key: string;
  legacyPushEventKeys?: string[];
  skipIfGameweekCompleted?: boolean;
  skipUnlessGameweekPending?: boolean;
  title: string;
  type: string;
};

const sendPushToAllUsersInternal = makeFunctionReference<
  "action",
  PushToAllUsersArgs,
  PushToAllUsersResult
>("notifications:sendPushToAllUsersInternal") as unknown as FunctionReference<
  "action",
  "internal",
  PushToAllUsersArgs,
  PushToAllUsersResult
>;

const DEADLINE_REMINDER_SCHEDULES = [
  {
    body: (gameweekName: string) =>
      `${gameweekName}: дедлайн уже завтра. Не забудьте зберегти склад.`,
    keySuffix: "day-before",
    offsetMs: DAY_MS,
    title: "Дедлайн завтра",
    type: "deadline_reminder_day",
  },
  {
    body: (gameweekName: string) =>
      `${gameweekName}: лишилася приблизно година, щоб зберегти склад.`,
    keySuffix: "hour-before",
    offsetMs: HOUR_MS,
    title: "Дедлайн за годину",
    type: "deadline_reminder_hour",
  },
] as const;

const DEADLINE_REMINDER_TYPES = new Set<string>(
  DEADLINE_REMINDER_SCHEDULES.map((schedule) => schedule.type),
);

type GameweekDeadlineScheduleState = Pick<
  Doc<"fantasyGameweeks">,
  "_id" | "deadlineAt" | "name" | "number" | "status"
>;

type SyncDeadlineReminderScheduleResult = {
  cancelled: number;
  scheduled: number;
  skippedPast: number;
  unchanged: number;
};

function isSchedulableGameweek(gameweek: GameweekDeadlineScheduleState) {
  return (
    (gameweek.status === "open" || gameweek.status === "upcoming") &&
    typeof gameweek.deadlineAt === "number" &&
    Number.isFinite(gameweek.deadlineAt)
  );
}

function getDeadlineReminderLogicalKey(
  keySuffix: string,
  gameweekId: Id<"fantasyGameweeks">,
) {
  return `deadline-reminder:${keySuffix}:${gameweekId}`;
}

function getDeadlineReminderEventKey(
  keySuffix: string,
  gameweekId: Id<"fantasyGameweeks">,
  deadlineAt: number,
) {
  return `${getDeadlineReminderLogicalKey(keySuffix, gameweekId)}:${deadlineAt}`;
}

async function cancelDeadlineReminderSchedule(
  ctx: MutationCtx,
  schedule: Doc<"pushNotificationSchedules">,
  now: number,
) {
  if (schedule.status !== "scheduled") return false;

  if (schedule.scheduledFunctionId) {
    try {
      await ctx.scheduler.cancel(
        schedule.scheduledFunctionId as Id<"_scheduled_functions">,
      );
    } catch {
      // The scheduled function may already be running or completed.
    }
  }

  await ctx.db.patch(schedule._id, {
    status: "cancelled",
    updatedAt: now,
  });
  return true;
}

export async function syncGameweekDeadlineReminderSchedules(
  ctx: MutationCtx,
  gameweek: GameweekDeadlineScheduleState,
  now = Date.now(),
): Promise<SyncDeadlineReminderScheduleResult> {
  const existingSchedules = await ctx.db
    .query("pushNotificationSchedules")
    .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
    .collect();
  const deadlineSchedules = existingSchedules.filter((schedule) =>
    DEADLINE_REMINDER_TYPES.has(schedule.type),
  );
  const desiredLogicalKeys = new Set<string>();
  let cancelled = 0;
  let scheduled = 0;
  let skippedPast = 0;
  let unchanged = 0;

  if (
    isSchedulableGameweek(gameweek) &&
    typeof gameweek.deadlineAt === "number"
  ) {
    const deadlineAt = gameweek.deadlineAt;

    for (const reminder of DEADLINE_REMINDER_SCHEDULES) {
      const scheduledAt = deadlineAt - reminder.offsetMs;
      const logicalKey = getDeadlineReminderLogicalKey(
        reminder.keySuffix,
        gameweek._id,
      );
      const eventKey = getDeadlineReminderEventKey(
        reminder.keySuffix,
        gameweek._id,
        deadlineAt,
      );
      const matchingSchedules = deadlineSchedules.filter(
        (schedule) => schedule.logicalKey === logicalKey,
      );

      if (scheduledAt <= now) {
        const alreadyScheduledForCurrentDeadline = matchingSchedules.some(
          (schedule) =>
            schedule.status === "scheduled" &&
            schedule.deadlineAt === deadlineAt &&
            schedule.eventKey === eventKey,
        );
        if (alreadyScheduledForCurrentDeadline) {
          desiredLogicalKeys.add(logicalKey);
        }
        skippedPast += 1;
        continue;
      }

      desiredLogicalKeys.add(logicalKey);
      const currentSchedule =
        matchingSchedules.find(
          (schedule) => schedule.status === "scheduled",
        ) ??
        matchingSchedules[0] ??
        null;

      if (
        currentSchedule?.status === "scheduled" &&
        currentSchedule.scheduledAt === scheduledAt &&
        currentSchedule.deadlineAt === deadlineAt &&
        currentSchedule.eventKey === eventKey
      ) {
        const duplicateSchedules = matchingSchedules.filter(
          (schedule) =>
            schedule._id !== currentSchedule._id &&
            schedule.status === "scheduled",
        );
        for (const duplicateSchedule of duplicateSchedules) {
          if (
            await cancelDeadlineReminderSchedule(
              ctx,
              duplicateSchedule,
              now,
            )
          ) {
            cancelled += 1;
          }
        }
        unchanged += 1;
        continue;
      }

      for (const matchingSchedule of matchingSchedules) {
        if (
          await cancelDeadlineReminderSchedule(ctx, matchingSchedule, now)
        ) {
          cancelled += 1;
        }
      }

      const legacyPushEventKeys =
        reminder.keySuffix === "day-before"
          ? [logicalKey, `deadline-reminder:${gameweek._id}`]
          : [logicalKey];
      const scheduledFunctionId = await ctx.scheduler.runAt(
        scheduledAt,
        sendPushToAllUsersInternal,
        {
          body: reminder.body(gameweek.name),
          data: { kind: reminder.type },
          expectedGameweekDeadlineAt: deadlineAt,
          gameweekId: gameweek._id,
          gameweekName: gameweek.name,
          gameweekNumber: gameweek.number,
          key: eventKey,
          legacyPushEventKeys,
          skipIfGameweekCompleted: true,
          skipUnlessGameweekPending: true,
          title: reminder.title,
          type: reminder.type,
        },
      );
      const payload = {
        deadlineAt,
        eventKey,
        gameweekId: gameweek._id,
        logicalKey,
        scheduledAt,
        scheduledFunctionId,
        status: "scheduled" as const,
        type: reminder.type,
        updatedAt: now,
      };

      if (currentSchedule) {
        await ctx.db.patch(currentSchedule._id, payload);
      } else {
        await ctx.db.insert("pushNotificationSchedules", {
          ...payload,
          createdAt: now,
        });
      }
      scheduled += 1;
    }
  }

  for (const schedule of deadlineSchedules) {
    if (schedule.status !== "scheduled") continue;
    if (desiredLogicalKeys.has(schedule.logicalKey)) continue;

    if (await cancelDeadlineReminderSchedule(ctx, schedule, now)) {
      cancelled += 1;
    }
  }

  return { cancelled, scheduled, skippedPast, unchanged };
}
