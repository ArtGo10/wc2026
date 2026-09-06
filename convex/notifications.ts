import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { action, internalAction, mutation, query } from "./_generated/server";
import {
  getCurrentUser,
  getCurrentUserIfAuthenticated,
} from "./authHelpers";

declare const process: {
  env: Record<string, string | undefined>;
};

type ExpoPushMessage = {
  body: string;
  data: { kind: string };
  sound: string;
  title: string;
  to: string;
};

type NotificationLanguage = "en" | "uk" | "pl";

type ExpoPushRecipient = {
  preferredLanguage: NotificationLanguage;
  tokens: string[];
  userId: Id<"users">;
};

type PushMessage = {
  body: string;
  kind: string;
  title: string;
};

type UserNotificationInput = {
  body: string;
  data?: { kind: string };
  pushEventKey?: string;
  sentAt?: number;
  title: string;
  type: string;
  userId: Id<"users">;
};

type GameweekPushState = {
  deadlineAt?: number | null;
  leagueName?: string | null;
  name: string;
  number: number;
  seasonDisplayName?: string | null;
  seasonName?: string | null;
  seasonShortName?: string | null;
  seasonSlug?: string | null;
  status: string;
} | null;

function normalizeToken(token: string) {
  return token.trim();
}

function normalizeLimit(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return 50;
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function normalizeNotificationLanguage(
  language: string | undefined,
): NotificationLanguage {
  return language === "uk" || language === "pl" ? language : "en";
}

function automatedPushNotificationsAreDisabled() {
  return process.env.AUTOMATED_PUSH_NOTIFICATIONS_DISABLED === "true";
}

function getNotificationGameweekName(
  language: NotificationLanguage,
  gameweekName?: string | null,
  gameweekNumber?: number | null,
) {
  const number =
    typeof gameweekNumber === "number" && Number.isFinite(gameweekNumber)
      ? Math.trunc(gameweekNumber)
      : Number(gameweekName?.match(/\d+/)?.[0] ?? NaN);

  if (Number.isFinite(number) && number > 0) {
    if (language === "uk") return `Тур ${number}`;
    if (language === "pl") return `Kolejka ${number}`;
    return `Gameweek ${number}`;
  }

  return (
    gameweekName?.trim() ||
    (language === "uk" ? "Тур" : language === "pl" ? "Kolejka" : "Gameweek")
  );
}

function getNotificationLeagueName(
  language: NotificationLanguage,
  season: {
    leagueName?: string | null;
    seasonDisplayName?: string | null;
    seasonName?: string | null;
    seasonShortName?: string | null;
    seasonSlug?: string | null;
  },
) {
  if (season.seasonSlug === "polish-futsal-ekstraklasa-2026-27") {
    return language === "uk" ? "Екстракласа" : "Ekstraklasa";
  }

  if (
    season.seasonSlug === "ukrainian-extra-league-2026-27" ||
    season.seasonSlug === "ukrainian-extra-league-2025-26"
  ) {
    return language === "uk" ? "Екстра-ліга" : "Extra-liga";
  }

  return (
    season.seasonShortName?.trim() ||
    season.seasonDisplayName?.trim() ||
    season.leagueName?.trim() ||
    season.seasonName?.trim() ||
    null
  );
}

function getNotificationContextName(
  language: NotificationLanguage,
  context: {
    gameweekName?: string | null;
    gameweekNumber?: number | null;
    leagueName?: string | null;
    seasonDisplayName?: string | null;
    seasonName?: string | null;
    seasonShortName?: string | null;
    seasonSlug?: string | null;
  },
) {
  const gameweekName = getNotificationGameweekName(
    language,
    context.gameweekName,
    context.gameweekNumber,
  );
  const leagueName = getNotificationLeagueName(language, context);

  return {
    label: leagueName ? `${leagueName} · ${gameweekName}` : gameweekName,
    leagueName,
  };
}

const PUSH_NOTIFICATION_COPY: Record<
  string,
  Record<
    NotificationLanguage,
    { body: (gameweekName: string) => string; title: string }
  >
> = {
  deadline_reminder_day: {
    en: {
      title: "Deadline tomorrow",
      body: (gameweekName: string) =>
        `${gameweekName}: the deadline is tomorrow. Remember to save your squad.`,
    },
    uk: {
      title: "Дедлайн завтра",
      body: (gameweekName: string) =>
        `${gameweekName}: дедлайн уже завтра. Не забудьте зберегти склад.`,
    },
    pl: {
      title: "Deadline jutro",
      body: (gameweekName: string) =>
        `${gameweekName}: deadline już jutro. Pamiętaj, aby zapisać skład.`,
    },
  },
  deadline_reminder_hour: {
    en: {
      title: "Deadline in one hour",
      body: (gameweekName: string) =>
        `${gameweekName}: about one hour left to save your squad.`,
    },
    uk: {
      title: "Дедлайн за годину",
      body: (gameweekName: string) =>
        `${gameweekName}: лишилася приблизно година, щоб зберегти склад.`,
    },
    pl: {
      title: "Deadline za godzinę",
      body: (gameweekName: string) =>
        `${gameweekName}: została około godzina, aby zapisać skład.`,
    },
  },
  deadline_passed: {
    en: {
      title: "Gameweek is live",
      body: (gameweekName: string) =>
        `${gameweekName} is live. Follow result updates in the app.`,
    },
    uk: {
      title: "Тур live",
      body: (gameweekName: string) =>
        `${gameweekName} live. Стежте за оновленнями результатів у застосунку.`,
    },
    pl: {
      title: "Kolejka live",
      body: (gameweekName: string) =>
        `${gameweekName} jest live. Śledź aktualizacje wyników w aplikacji.`,
    },
  },
  gameweek_results_ready: {
    en: {
      title: "Gameweek results are ready",
      body: (gameweekName: string) =>
        `${gameweekName} is over. Points are calculated, so you can check the results.`,
    },
    uk: {
      title: "Підсумки туру готові",
      body: (gameweekName: string) =>
        `${gameweekName} завершено. Очки вже підраховані, можна перевірити результати.`,
    },
    pl: {
      title: "Wyniki kolejki są gotowe",
      body: (gameweekName: string) =>
        `${gameweekName} zakończona. Punkty są już policzone, możesz sprawdzić wyniki.`,
    },
  },
  test: {
    en: {
      title: "Fantasy Futsal",
      body: () => "Test push notification works.",
    },
    uk: {
      title: "Fantasy Futsal",
      body: () => "Тестове push-сповіщення працює.",
    },
    pl: {
      title: "Fantasy Futsal",
      body: () => "Testowe powiadomienie push działa.",
    },
  },
};

function getLocalizedPushMessage(
  recipient: Pick<ExpoPushRecipient, "preferredLanguage">,
  fallback: PushMessage & {
    gameweekName?: string | null;
    gameweekNumber?: number | null;
    leagueName?: string | null;
    seasonDisplayName?: string | null;
    seasonName?: string | null;
    seasonShortName?: string | null;
    seasonSlug?: string | null;
    type: string;
  },
): PushMessage {
  const language = normalizeNotificationLanguage(recipient.preferredLanguage);
  const copy =
    PUSH_NOTIFICATION_COPY[fallback.type]?.[language] ??
    PUSH_NOTIFICATION_COPY[fallback.type]?.en;

  if (!copy) {
    return {
      body: fallback.body,
      kind: fallback.kind,
      title: fallback.title,
    };
  }

  const { label, leagueName } = getNotificationContextName(language, fallback);

  return {
    body: copy.body(label),
    kind: fallback.kind,
    title: leagueName ? `${leagueName}: ${copy.title}` : copy.title,
  };
}

const enabledExpoPushRecipientForClerkUser = makeFunctionReference<
  "query",
  { clerkId: string },
  ExpoPushRecipient | null
>("notificationInternals:enabledExpoPushRecipientForClerkUser") as unknown as FunctionReference<
  "query",
  "internal",
  { clerkId: string },
  ExpoPushRecipient | null
>;

const enabledExpoPushRecipientsForAllUsers = makeFunctionReference<
  "query",
  Record<string, never>,
  ExpoPushRecipient[]
>("notificationInternals:enabledExpoPushRecipientsForAllUsers") as unknown as FunctionReference<
  "query",
  "internal",
  Record<string, never>,
  ExpoPushRecipient[]
>;
const pushNotificationRecipientsWithoutUserNotification = makeFunctionReference<
  "query",
  { legacyPushEventKeys?: string[]; pushEventKey: string },
  ExpoPushRecipient[]
>(
  "notificationInternals:pushNotificationRecipientsWithoutUserNotification",
) as unknown as FunctionReference<
  "query",
  "internal",
  { legacyPushEventKeys?: string[]; pushEventKey: string },
  ExpoPushRecipient[]
>;

const pushNotificationEventExists = makeFunctionReference<
  "query",
  { key: string },
  boolean
>("notificationInternals:pushNotificationEventExists") as unknown as FunctionReference<
  "query",
  "internal",
  { key: string },
  boolean
>;

const isAdminClerkUser = makeFunctionReference<"query", { clerkId: string; email?: string }, boolean>(
  "notificationInternals:isAdminClerkUser",
) as unknown as FunctionReference<"query", "internal", { clerkId: string; email?: string }, boolean>;

const gameweekPushState = makeFunctionReference<
  "query",
  { gameweekId: Id<"fantasyGameweeks"> },
  GameweekPushState
>("notificationInternals:gameweekPushState") as unknown as FunctionReference<
  "query",
  "internal",
  { gameweekId: Id<"fantasyGameweeks"> },
  GameweekPushState
>;

const claimPushNotificationEvent = makeFunctionReference<
  "mutation",
  { key: string; type: string },
  { claimed: boolean; id: string }
>("notificationInternals:claimPushNotificationEvent") as unknown as FunctionReference<
  "mutation",
  "internal",
  { key: string; type: string },
  { claimed: boolean; id: string }
>;

const completePushNotificationEvent = makeFunctionReference<
  "mutation",
  { key: string; tokensCount: number; type: string },
  { created: boolean; id: string }
>("notificationInternals:completePushNotificationEvent") as unknown as FunctionReference<
  "mutation",
  "internal",
  { key: string; tokensCount: number; type: string },
  { created: boolean; id: string }
>;

const createUserNotifications = makeFunctionReference<
  "mutation",
  { notifications: UserNotificationInput[] },
  { created: number; updated: number }
>("notificationInternals:createUserNotifications") as unknown as FunctionReference<
  "mutation",
  "internal",
  { notifications: UserNotificationInput[] },
  { created: number; updated: number }
>;

async function sendExpoPushMessages(messages: ExpoPushMessage[]) {
  const chunks: ExpoPushMessage[][] = [];
  for (let index = 0; index < messages.length; index += 100) {
    chunks.push(messages.slice(index, index + 100));
  }

  let sent = 0;
  for (const chunk of chunks) {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    });

    if (!response.ok) {
      throw new Error(`Expo Push API вернул ${response.status}.`);
    }

    const result = (await response.json()) as {
      data?: Array<{ status?: string; message?: string }>;
    };
    const statuses = Array.isArray(result.data) ? result.data : [];
    if (statuses.length === 0) {
      sent += chunk.length;
      continue;
    }

    sent += statuses.filter((item) => item.status === "ok").length;
  }

  return sent;
}

function createExpoMessages(
  tokens: string[],
  message: PushMessage,
) {
  return tokens.map((token) => ({
    to: token,
    sound: "default",
    title: message.title,
    body: message.body,
    data: { kind: message.kind },
  }));
}

function createExpoMessagesForRecipients(
  recipients: ExpoPushRecipient[],
  messageOrFactory: PushMessage | ((recipient: ExpoPushRecipient) => PushMessage),
) {
  return recipients.flatMap((recipient) => {
    const message =
      typeof messageOrFactory === "function"
        ? messageOrFactory(recipient)
        : messageOrFactory;
    return createExpoMessages(recipient.tokens, message);
  });
}

function countRecipientTokens(recipients: ExpoPushRecipient[]) {
  return recipients.reduce(
    (total, recipient) => total + recipient.tokens.length,
    0,
  );
}

function createNotificationRecordsForRecipients(
  recipients: ExpoPushRecipient[],
  messageOrFactory: PushMessage | ((recipient: ExpoPushRecipient) => PushMessage),
  sentAt: number,
  pushEventKey?: string,
): UserNotificationInput[] {
  return recipients.map((recipient) => {
    const message =
      typeof messageOrFactory === "function"
        ? messageOrFactory(recipient)
        : messageOrFactory;
    return {
      userId: recipient.userId,
      type: message.kind,
      title: message.title,
      body: message.body,
      data: { kind: message.kind },
      ...(pushEventKey ? { pushEventKey } : {}),
      sentAt,
    };
  });
}

function toNotificationView(notification: {
  _id: Id<"userNotifications">;
  body: string;
  data?: unknown;
  readAt: number | null;
  sentAt: number;
  title: string;
  type: string;
}) {
  return {
    id: notification._id,
    body: notification.body,
    data: notification.data ?? null,
    readAt: notification.readAt,
    sentAt: notification.sentAt,
    title: notification.title,
    type: notification.type,
  };
}

export const listCurrentUserNotifications = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserIfAuthenticated(ctx);
    if (!currentUser?.user) {
      return { items: [], unreadCount: 0 };
    }
    const { user } = currentUser;

    const limit = normalizeLimit(args.limit);
    const [items, unreadItems] = await Promise.all([
      ctx.db
        .query("userNotifications")
        .withIndex("by_user_sent_at", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(limit),
      ctx.db
        .query("userNotifications")
        .withIndex("by_user_read_at", (q) =>
          q.eq("userId", user._id).eq("readAt", null),
        )
        .collect(),
    ]);

    return {
      items: items.map(toNotificationView),
      unreadCount: unreadItems.length,
    };
  },
});

export const currentUserNotificationSummary = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUserIfAuthenticated(ctx);
    if (!currentUser?.user) return { unreadCount: 0 };
    const { user } = currentUser;

    const unreadItems = await ctx.db
      .query("userNotifications")
      .withIndex("by_user_read_at", (q) =>
        q.eq("userId", user._id).eq("readAt", null),
      )
      .collect();

    return { unreadCount: unreadItems.length };
  },
});

export const markCurrentUserNotificationRead = mutation({
  args: {
    notificationId: v.id("userNotifications"),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) return { updated: false };

    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== user._id) {
      return { updated: false };
    }
    if (notification.readAt !== null) {
      return { updated: false };
    }

    await ctx.db.patch(notification._id, {
      readAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});

export const markAllCurrentUserNotificationsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) return { updated: 0 };

    const unreadItems = await ctx.db
      .query("userNotifications")
      .withIndex("by_user_read_at", (q) =>
        q.eq("userId", user._id).eq("readAt", null),
      )
      .collect();

    const now = Date.now();
    for (const item of unreadItems) {
      await ctx.db.patch(item._id, { readAt: now, updatedAt: now });
    }

    return { updated: unreadItems.length };
  },
});

export const upsertExpoPushToken = mutation({
  args: {
    platform: v.optional(v.string()),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Сначала нужно подготовить профиль пользователя.");
    }

    const token = normalizeToken(args.token);
    if (!token) {
      throw new Error("Push token не может быть пустым.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("pushNotificationTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: true,
        lastSeenAt: now,
        platform: args.platform,
        provider: "expo",
        updatedAt: now,
        userId: user._id,
      });

      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("pushNotificationTokens", {
      userId: user._id,
      provider: "expo",
      token,
      platform: args.platform,
      enabled: true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { id, created: true };
  },
});

export const disableExpoPushToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const token = normalizeToken(args.token);
    if (!token) return { updated: false };

    const existing = await ctx.db
      .query("pushNotificationTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!existing) return { updated: false };

    await ctx.db.patch(existing._id, {
      enabled: false,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});

export const sendTestPushToCurrentUser = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Сначала нужно войти в аккаунт.");
    }

    const recipient = await ctx.runQuery(enabledExpoPushRecipientForClerkUser, {
      clerkId: identity.subject,
    });
    if (!recipient || recipient.tokens.length === 0) {
      throw new Error("Для этого аккаунта пока нет сохранённого push token. Разрешите уведомления и перезапустите приложение.");
    }

    const sentAt = Date.now();
    const message = getLocalizedPushMessage(recipient, {
      title: "Fantasy Futsal",
      body: "Тестовое push-уведомление работает.",
      kind: "test",
      type: "test",
    });
    const sent = await sendExpoPushMessages(
      createExpoMessagesForRecipients([recipient], message),
    );

    await ctx.runMutation(createUserNotifications, {
      notifications: createNotificationRecordsForRecipients(
        [recipient],
        message,
        sentAt,
      ),
    });

    return { sent };
  },
});

export const sendGameweekResultsReadyPushToAll = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Сначала нужно войти в аккаунт.");
    }

    const isAdmin = await ctx.runQuery(isAdminClerkUser, {
      clerkId: identity.subject,
      email: identity.email,
    });
    if (!isAdmin) {
      throw new Error("Это действие доступно только администратору.");
    }

    const recipients = await ctx.runQuery(
      enabledExpoPushRecipientsForAllUsers,
      {},
    );
    if (countRecipientTokens(recipients) === 0) {
      throw new Error("Пока нет сохранённых push token для рассылки.");
    }

    const sentAt = Date.now();
    const fallbackMessage = {
      title: "Итоги тура готовы",
      body: "Очки тура уже посчитаны. Откройте приложение, чтобы посмотреть таблицу.",
      kind: "gameweek_results_ready",
      type: "gameweek_results_ready",
    };
    const messageForRecipient = (recipient: ExpoPushRecipient) =>
      getLocalizedPushMessage(recipient, fallbackMessage);
    const sent = await sendExpoPushMessages(
      createExpoMessagesForRecipients(recipients, messageForRecipient),
    );

    await ctx.runMutation(createUserNotifications, {
      notifications: createNotificationRecordsForRecipients(
        recipients,
        messageForRecipient,
        sentAt,
        `gameweek-results-ready:${sentAt}`,
      ),
    });

    return { sent };
  },
});

export const sendPushToAllUsersInternal = internalAction({
  args: {
    body: v.string(),
    data: v.optional(v.object({ kind: v.string() })),
    expectedGameweekDeadlineAt: v.optional(v.number()),
    gameweekId: v.optional(v.id("fantasyGameweeks")),
    gameweekName: v.optional(v.string()),
    gameweekNumber: v.optional(v.number()),
    key: v.string(),
    legacyPushEventKeys: v.optional(v.array(v.string())),
    leagueName: v.optional(v.string()),
    seasonDisplayName: v.optional(v.string()),
    seasonName: v.optional(v.string()),
    seasonShortName: v.optional(v.string()),
    seasonSlug: v.optional(v.string()),
    skipIfGameweekCompleted: v.optional(v.boolean()),
    skipUnlessGameweekPending: v.optional(v.boolean()),
    title: v.string(),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    if (automatedPushNotificationsAreDisabled()) {
      return { created: 0, sent: 0, skippedDuplicate: true, updated: 0 };
    }

    let gameweek: GameweekPushState = null;

    if (args.gameweekId) {
      gameweek = await ctx.runQuery(gameweekPushState, {
        gameweekId: args.gameweekId,
      });
    }

    if (args.skipIfGameweekCompleted) {
      if (!gameweek || gameweek.status === "completed") {
        return { created: 0, sent: 0, skippedDuplicate: false, updated: 0 };
      }
    }

    if (args.skipUnlessGameweekPending) {
      if (
        !gameweek ||
        (gameweek.status !== "open" && gameweek.status !== "upcoming")
      ) {
        return { created: 0, sent: 0, skippedDuplicate: false, updated: 0 };
      }
    }

    if (typeof args.expectedGameweekDeadlineAt === "number") {
      if (!gameweek || gameweek.deadlineAt !== args.expectedGameweekDeadlineAt) {
        return { created: 0, sent: 0, skippedDuplicate: false, updated: 0 };
      }
    }

    for (const legacyKey of args.legacyPushEventKeys ?? []) {
      const exists = await ctx.runQuery(pushNotificationEventExists, {
        key: legacyKey,
      });
      if (exists) {
        return { created: 0, sent: 0, skippedDuplicate: true, updated: 0 };
      }
    }

    const eventClaim = await ctx.runMutation(claimPushNotificationEvent, {
      key: args.key,
      type: args.type,
    });
    if (!eventClaim.claimed) {
      return { created: 0, sent: 0, skippedDuplicate: true, updated: 0 };
    }

    const recipients = await ctx.runQuery(
      pushNotificationRecipientsWithoutUserNotification,
      {
        legacyPushEventKeys: args.legacyPushEventKeys,
        pushEventKey: args.key,
      },
    );
    const fallbackMessage = {
      title: args.title,
      body: args.body,
      kind: args.data?.kind ?? args.type,
      type: args.type,
      gameweekName: args.gameweekName ?? gameweek?.name ?? null,
      gameweekNumber: args.gameweekNumber ?? gameweek?.number ?? null,
      leagueName: args.leagueName ?? gameweek?.leagueName ?? null,
      seasonDisplayName:
        args.seasonDisplayName ?? gameweek?.seasonDisplayName ?? null,
      seasonName: args.seasonName ?? gameweek?.seasonName ?? null,
      seasonShortName: args.seasonShortName ?? gameweek?.seasonShortName ?? null,
      seasonSlug: args.seasonSlug ?? gameweek?.seasonSlug ?? null,
    };
    const messageForRecipient = (recipient: ExpoPushRecipient) =>
      getLocalizedPushMessage(recipient, fallbackMessage);
    const tokenCount = countRecipientTokens(recipients);
    const sent =
      tokenCount > 0
        ? await sendExpoPushMessages(
            createExpoMessagesForRecipients(recipients, messageForRecipient),
          )
        : 0;
    const sentAt = Date.now();

    await ctx.runMutation(completePushNotificationEvent, {
      key: args.key,
      tokensCount: sent,
      type: args.type,
    });

    const notificationResult =
      recipients.length > 0
        ? await ctx.runMutation(createUserNotifications, {
            notifications: createNotificationRecordsForRecipients(
              recipients,
              messageForRecipient,
              sentAt,
              args.key,
            ),
          })
        : { created: 0, updated: 0 };

    return {
      created: notificationResult.created,
      sent,
      skippedDuplicate: false,
      updated: notificationResult.updated,
    };
  },
});
