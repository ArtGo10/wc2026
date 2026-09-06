import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  getCurrentUser,
  getCurrentUserIfAuthenticated,
  isAdminUser,
  requireAdmin,
  requireIdentity,
} from "./authHelpers";

const MAX_FEEDBACK_MESSAGE_LENGTH = 4000;
const SUPPORT_EMAIL = "support@fantasyfutsal.app";
const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const CLERK_API_USERS_ENDPOINT = "https://api.clerk.com/v1/users";
const DEFAULT_FEEDBACK_EMAIL_FROM = "Fantasy Futsal <" + SUPPORT_EMAIL + ">";
const DELETE_ACCOUNT_AUTH_REQUIRED = "DELETE_ACCOUNT_AUTH_REQUIRED";
const DELETE_ACCOUNT_NOT_CONFIGURED = "DELETE_ACCOUNT_NOT_CONFIGURED";
const DELETE_ACCOUNT_CLERK_FAILED = "DELETE_ACCOUNT_CLERK_FAILED";
const DELETE_ACCOUNT_CLEANUP_QUEUE_FAILED =
  "DELETE_ACCOUNT_CLEANUP_QUEUE_FAILED";
const ACCOUNT_DELETION_CLEANUP_BATCH_SIZE = 10;
const ACCOUNT_DELETION_CLEANUP_MAX_ATTEMPTS = 12;
const ACCOUNT_DELETION_CLEANUP_RETRY_BASE_MS = 60 * 1000;
const ACCOUNT_DELETION_CLEANUP_RETRY_MAX_MS = 60 * 60 * 1000;
const CURRENT_TERMS_VERSION = "2026-09-05";

type SendFeedbackEmailArgs = {
  createdAt: number;
  email?: string;
  feedbackId: Id<"userFeedback">;
  message: string;
  name?: string;
  source?: string;
};

type SendFeedbackEmailResult = {
  sent: boolean;
  skipped: boolean;
};

const sendFeedbackEmailInternalRef = makeFunctionReference<
  "action",
  SendFeedbackEmailArgs,
  SendFeedbackEmailResult
>("users:sendFeedbackEmailInternal") as unknown as FunctionReference<
  "action",
  "internal",
  SendFeedbackEmailArgs,
  SendFeedbackEmailResult
>;

type DeleteCurrentUserDataResult = {
  crashReports: number;
  deleted: boolean;
  favorites: number;
  feedback: number;
  gameweekSquadPicks: number;
  notifications: number;
  pointDeductions: number;
  privateLeagueMemberships: number;
  privateLeagues: number;
  pushTokens: number;
  squadPicks: number;
  teamScores: number;
  teams: number;
  transfers: number;
};

type DeleteCurrentUserDataByClerkIdArgs = {
  clerkId: string;
};

const deleteCurrentUserDataByClerkIdInternalRef = makeFunctionReference<
  "mutation",
  DeleteCurrentUserDataByClerkIdArgs,
  DeleteCurrentUserDataResult
>("users:deleteCurrentUserDataByClerkIdInternal") as unknown as FunctionReference<
  "mutation",
  "internal",
  DeleteCurrentUserDataByClerkIdArgs,
  DeleteCurrentUserDataResult
>;

type AccountDeletionCleanupJobStatus = "clerk_delete_pending" | "pending";

type AccountDeletionCleanupJobArgs = {
  clerkId: string;
  lastError?: string;
  nextAttemptAt?: number;
  status?: AccountDeletionCleanupJobStatus;
};

type AccountDeletionCleanupJobResult = {
  jobId: Id<"accountDeletionCleanupJobs">;
};

type AccountDeletionCleanupJobView = {
  attempts: number;
  clerkId: string;
  jobId: Id<"accountDeletionCleanupJobs">;
  status: AccountDeletionCleanupJobStatus;
};

type AccountDeletionCleanupJobsResult = {
  jobs: AccountDeletionCleanupJobView[];
};

type AccountDeletionCleanupJobStatusArgs = {
  clerkId: string;
  jobId: Id<"accountDeletionCleanupJobs">;
};

type AccountDeletionCleanupJobFailedArgs = AccountDeletionCleanupJobStatusArgs & {
  attempts: number;
  lastError: string;
  nextAttemptAt: number;
  status: "clerk_delete_pending" | "failed" | "pending";
};

const upsertAccountDeletionCleanupJobInternalRef = makeFunctionReference<
  "mutation",
  AccountDeletionCleanupJobArgs,
  AccountDeletionCleanupJobResult
>("users:upsertAccountDeletionCleanupJobInternal") as unknown as FunctionReference<
  "mutation",
  "internal",
  AccountDeletionCleanupJobArgs,
  AccountDeletionCleanupJobResult
>;

const listDueAccountDeletionCleanupJobsInternalRef = makeFunctionReference<
  "query",
  { limit?: number; now: number },
  AccountDeletionCleanupJobsResult
>("users:listDueAccountDeletionCleanupJobsInternal") as unknown as FunctionReference<
  "query",
  "internal",
  { limit?: number; now: number },
  AccountDeletionCleanupJobsResult
>;

const markAccountDeletionCleanupJobCompleteInternalRef = makeFunctionReference<
  "mutation",
  AccountDeletionCleanupJobStatusArgs,
  { completed: boolean }
>("users:markAccountDeletionCleanupJobCompleteInternal") as unknown as FunctionReference<
  "mutation",
  "internal",
  AccountDeletionCleanupJobStatusArgs,
  { completed: boolean }
>;

const markAccountDeletionCleanupJobFailedInternalRef = makeFunctionReference<
  "mutation",
  AccountDeletionCleanupJobFailedArgs,
  { failed: boolean }
>("users:markAccountDeletionCleanupJobFailedInternal") as unknown as FunctionReference<
  "mutation",
  "internal",
  AccountDeletionCleanupJobFailedArgs,
  { failed: boolean }
>;

function emptyDeleteCurrentUserDataResult(): DeleteCurrentUserDataResult {
  return {
    crashReports: 0,
    deleted: false,
    favorites: 0,
    feedback: 0,
    gameweekSquadPicks: 0,
    notifications: 0,
    pointDeductions: 0,
    privateLeagueMemberships: 0,
    privateLeagues: 0,
    pushTokens: 0,
    squadPicks: 0,
    teamScores: 0,
    teams: 0,
    transfers: 0,
  };
}

function normalizeOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function getAccountDeletionCleanupRetryDelayMs(attempts: number) {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(
    ACCOUNT_DELETION_CLEANUP_RETRY_MAX_MS,
    ACCOUNT_DELETION_CLEANUP_RETRY_BASE_MS * 2 ** exponent,
  );
}

async function getClerkUserExists(secretKey: string, clerkId: string) {
  const response = await fetch(
    `${CLERK_API_USERS_ENDPOINT}/${encodeURIComponent(clerkId)}`,
    { headers: { Authorization: "Bearer " + secretKey } },
  );

  if (response.status === 404) return false;
  if (response.ok) return true;

  const errorText = await response.text().catch(() => "");
  throw new Error(
    `Clerk user lookup failed: ${response.status} ${errorText}`.trim(),
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatFeedbackEmailText(args: {
  createdAt: number;
  email?: string;
  feedbackId: string;
  message: string;
  name?: string;
  source?: string;
}) {
  const submittedAt = new Date(args.createdAt).toISOString();

  return [
    "New Fantasy Futsal feedback",
    "",
    "Feedback ID: " + args.feedbackId,
    "Submitted at: " + submittedAt,
    "Name: " + (args.name ?? "Unknown"),
    "Email: " + (args.email ?? "Not provided"),
    "Source: " + (args.source ?? "Not provided"),
    "",
    "Message:",
    args.message,
  ].join("\n");
}

function formatFeedbackEmailHtml(args: {
  createdAt: number;
  email?: string;
  feedbackId: string;
  message: string;
  name?: string;
  source?: string;
}) {
  const submittedAt = new Date(args.createdAt).toISOString();
  const rows = [
    ["Feedback ID", args.feedbackId],
    ["Submitted at", submittedAt],
    ["Name", args.name ?? "Unknown"],
    ["Email", args.email ?? "Not provided"],
    ["Source", args.source ?? "Not provided"],
  ];
  const tableRows = rows
    .map(
      ([label, value]) =>
        '<tr>' +
        '<td style="padding: 4px 16px 4px 0; color: #6B7280; font-weight: 700;">' +
        escapeHtml(label) +
        '</td>' +
        '<td style="padding: 4px 0;">' +
        escapeHtml(value) +
        '</td>' +
        '</tr>',
    )
    .join("");

  return (
    '<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">' +
    '<h1 style="font-size: 20px; margin: 0 0 16px;">New Fantasy Futsal feedback</h1>' +
    '<table style="border-collapse: collapse; margin-bottom: 18px;">' +
    tableRows +
    '</table>' +
    '<div style="font-weight: 700; margin-bottom: 8px;">Message</div>' +
    '<div style="white-space: pre-wrap; border: 1px solid #D7DFEA; border-radius: 8px; padding: 12px; background: #F8FAFC;">' +
    escapeHtml(args.message) +
    '</div>' +
    '</div>'
  );
}

function capitalizeNamePart(value: string) {
  if (!value) return value;

  const [firstLetter, ...restLetters] = Array.from(value);
  return `${firstLetter.toLocaleUpperCase("uk-UA")}${restLetters.join("").toLocaleLowerCase("uk-UA")}`;
}

function formatPersonName(name: string) {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) =>
      word
        .split(/([-’'])/)
        .map(capitalizeNamePart)
        .join(""),
    )
    .join(" ");
}

function resolveName(
  identity: Awaited<ReturnType<typeof requireIdentity>>,
  name?: string,
  email?: string,
) {
  const normalizedName = normalizeOptional(name);
  if (normalizedName) return formatPersonName(normalizedName);

  if (identity.name?.trim()) return formatPersonName(identity.name);
  if (identity.nickname?.trim()) return formatPersonName(identity.nickname);

  const resolvedEmail =
    normalizeOptional(email) ?? normalizeOptional(identity.email);
  if (resolvedEmail)
    return formatPersonName(resolvedEmail.split("@")[0] || "Manager");

  return `Manager ${identity.subject.slice(-6)}`;
}

function toUserView(user: {
  _id: string;
  clerkId: string;
  email?: string;
  role?: "user" | "admin";
  name: string;
  participantNumber?: number;
  favoriteFantasyClubId?: string;
  preferredLanguage?: "en" | "uk" | "pl";
  termsAcceptedAt?: number;
  termsVersion?: string;
  createdAt: number;
}) {
  return {
    id: user._id,
    clerkId: user.clerkId,
    email: user.email ?? null,
    name: user.name,
    role: user.role ?? "user",
    participantNumber: user.participantNumber ?? null,
    favoriteFantasyClubId: user.favoriteFantasyClubId ?? null,
    preferredLanguage: user.preferredLanguage ?? null,
    termsAcceptedAt: user.termsAcceptedAt ?? null,
    termsVersion: user.termsVersion ?? null,
    createdAt: user.createdAt,
  };
}

export const upsertCurrentUser = mutation({
  args: {
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    preferredLanguage: v.optional(
      v.union(v.literal("en"), v.literal("uk"), v.literal("pl")),
    ),
    termsAcceptedAt: v.optional(v.number()),
    termsVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();

    const email =
      normalizeOptional(args.email) ?? normalizeOptional(identity.email);
    const name = resolveName(identity, args.name, email);
    const now = Date.now();

    const termsVersion = CURRENT_TERMS_VERSION;
    const termsAcceptedAt = args.termsAcceptedAt ?? now;
    const preferredLanguagePatch = args.preferredLanguage
      ? { preferredLanguage: args.preferredLanguage }
      : {};

    if (existing) {
      const legalAcceptancePatch =
        existing.termsAcceptedAt && existing.termsVersion === termsVersion
          ? {}
          : {
              termsAcceptedAt,
              termsVersion,
            };

      await ctx.db.patch(existing._id, {
        email,
        name,
        role: existing.role ?? "user",
        ...legalAcceptancePatch,
        ...preferredLanguagePatch,
        updatedAt: now,
      });

      return {
        user: toUserView({
          ...existing,
          email,
          name,
          ...legalAcceptancePatch,
          ...preferredLanguagePatch,
        }),
      };
    }

    const userId = await ctx.db.insert("users", {
      clerkId: identity.subject,
      email,
      name,
      role: "user",
      termsAcceptedAt,
      termsVersion,
      ...preferredLanguagePatch,
      createdAt: now,
      updatedAt: now,
    });

    return {
      user: {
        id: userId,
        clerkId: identity.subject,
        email: email ?? null,
        name,
        role: "user",
        participantNumber: null,
        favoriteFantasyClubId: null,
        preferredLanguage: preferredLanguagePatch.preferredLanguage ?? null,
        termsAcceptedAt,
        termsVersion,
        createdAt: now,
      },
    };
  },
});

export const acceptCurrentUserTerms = mutation({
  args: {
    termsAcceptedAt: v.number(),
    termsVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User profile is not ready yet.");
    }

    await ctx.db.patch(user._id, {
      termsAcceptedAt: args.termsAcceptedAt,
      termsVersion: args.termsVersion,
      updatedAt: Date.now(),
    });

    return {
      user: toUserView({
        ...user,
        termsAcceptedAt: args.termsAcceptedAt,
        termsVersion: args.termsVersion,
      }),
    };
  },
});

export const updateFavoriteFantasyClub = mutation({
  args: {
    favoriteClubId: v.union(v.id("fantasyClubs"), v.null()),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User profile is not ready yet.");
    }

    const patch = args.favoriteClubId
      ? { favoriteFantasyClubId: args.favoriteClubId, updatedAt: Date.now() }
      : { favoriteFantasyClubId: undefined, updatedAt: Date.now() };

    await ctx.db.patch(user._id, patch);
    return { favoriteFantasyClubId: args.favoriteClubId };
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUserIfAuthenticated(ctx);
    if (!currentUser) {
      return {
        isAdmin: false,
        user: null,
      };
    }
    const { identity, user } = currentUser;

    return {
      isAdmin: isAdminUser(identity, user),
      user: user ? toUserView(user) : null,
    };
  },
});

export const setUserRole = mutation({
  args: {
    clerkId: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("admin")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const normalizedEmail = normalizeOptional(args.email)?.toLowerCase();
    const target =
      (args.userId ? await ctx.db.get(args.userId) : null) ??
      (args.clerkId
        ? await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId!))
            .first()
        : null) ??
      (normalizedEmail
        ? (await ctx.db.query("users").collect()).find(
            (user) => user.email?.trim().toLowerCase() === normalizedEmail,
          )
        : null);

    if (!target) {
      throw new Error("Пользователь не найден.");
    }

    await ctx.db.patch(target._id, {
      role: args.role,
      updatedAt: Date.now(),
    });

    return { user: toUserView({ ...target, role: args.role }) };
  },
});

export const sendFeedbackEmailInternal = internalAction({
  args: {
    createdAt: v.number(),
    email: v.optional(v.string()),
    feedbackId: v.id("userFeedback"),
    message: v.string(),
    name: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const apiKey = normalizeOptional(process.env.RESEND_API_KEY);
    if (!apiKey) {
      console.warn("RESEND_API_KEY is not set. Feedback email was not sent.");
      return { sent: false, skipped: true };
    }

    const to = normalizeOptional(process.env.FEEDBACK_EMAIL_TO) ?? SUPPORT_EMAIL;
    const from =
      normalizeOptional(process.env.FEEDBACK_EMAIL_FROM) ??
      DEFAULT_FEEDBACK_EMAIL_FROM;
    const author = args.name ?? args.email ?? "user";
    const payload = {
      from,
      to: [to],
      subject: "New Fantasy Futsal feedback from " + author,
      text: formatFeedbackEmailText(args),
      html: formatFeedbackEmailHtml(args),
      ...(args.email ? { reply_to: args.email } : {}),
    };

    const response = await fetch(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        ("Could not send feedback email: " + response.status + " " + errorText).trim(),
      );
    }

    return { sent: true, skipped: false };
  },
});

export const submitFeedback = mutation({
  args: {
    message: v.string(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User profile is not ready yet.");
    }

    const message = args.message.trim();
    if (message.length < 3) {
      throw new Error("Feedback message is too short.");
    }
    if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
      throw new Error("Feedback message is too long.");
    }

    const now = Date.now();
    const source = normalizeOptional(args.source);
    const feedbackId = await ctx.db.insert("userFeedback", {
      userId: user._id,
      email: user.email,
      name: user.name,
      message,
      source,
      status: "new",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, sendFeedbackEmailInternalRef, {
      feedbackId,
      email: user.email,
      name: user.name,
      message,
      source,
      createdAt: now,
    });

    return { feedbackId };
  },
});

export const listFeedback = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserIfAuthenticated(ctx);
    if (!currentUser) return [];
    const { identity, user } = currentUser;
    if (!isAdminUser(identity, user)) return [];

    const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 50);
    const items = await ctx.db
      .query("userFeedback")
      .withIndex("by_status_created_at", (q) => q.eq("status", "new"))
      .order("desc")
      .take(limit);

    return items.map((item) => ({
      id: item._id,
      userId: item.userId ?? null,
      email: item.email ?? null,
      name: item.name ?? null,
      message: item.message,
      source: item.source ?? null,
      status: item.status,
      createdAt: item.createdAt,
    }));
  },
});

type CurrentUserDocument = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>["user"]>;

async function deleteUserDataForUser(
  ctx: MutationCtx,
  user: CurrentUserDocument,
): Promise<DeleteCurrentUserDataResult> {
  let deletedGameweekSquadPicks = 0;
  let deletedSquadPicks = 0;
  let deletedTeamScores = 0;
  let deletedTransfers = 0;
  let deletedPointDeductions = 0;
  let deletedPrivateLeagueMemberships = 0;
  let deletedPrivateLeagues = 0;
  let deletedCrashReports = 0;
  const fantasyTeams = await ctx.db
    .query("fantasyTeams")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();

  for (const fantasyTeam of fantasyTeams) {
    const picks = await ctx.db
      .query("fantasySquadPicks")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
      .collect();
    for (const pick of picks) {
      await ctx.db.delete(pick._id);
      deletedSquadPicks += 1;
    }

    const gameweekPicks = await ctx.db
      .query("fantasyGameweekSquadPicks")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
      .collect();
    for (const gameweekPick of gameweekPicks) {
      await ctx.db.delete(gameweekPick._id);
      deletedGameweekSquadPicks += 1;
    }

    const deductions = await ctx.db
      .query("fantasyPointDeductions")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
      .collect();
    for (const deduction of deductions) {
      await ctx.db.delete(deduction._id);
      deletedPointDeductions += 1;
    }

    const transfers = await ctx.db
      .query("fantasyTransfers")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
      .collect();
    for (const transfer of transfers) {
      await ctx.db.delete(transfer._id);
      deletedTransfers += 1;
    }

    const scores = await ctx.db
      .query("fantasyTeamGameweekScores")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
      .collect();
    for (const score of scores) {
      await ctx.db.delete(score._id);
      deletedTeamScores += 1;
    }
  }

  const privateLeagueMemberships = await ctx.db
    .query("fantasyPrivateLeagueMembers")
    .filter((q) => q.eq(q.field("userId"), user._id))
    .collect();
  for (const membership of privateLeagueMemberships) {
    await ctx.db.delete(membership._id);
    deletedPrivateLeagueMemberships += 1;
  }

  const ownedPrivateLeagues = await ctx.db
    .query("fantasyPrivateLeagues")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
    .collect();
  for (const privateLeague of ownedPrivateLeagues) {
    const members = await ctx.db
      .query("fantasyPrivateLeagueMembers")
      .withIndex("by_league", (q) => q.eq("privateLeagueId", privateLeague._id))
      .collect();
    for (const member of members) {
      await ctx.db.delete(member._id);
      deletedPrivateLeagueMemberships += 1;
    }

    await ctx.db.delete(privateLeague._id);
    deletedPrivateLeagues += 1;
  }

  const favorites = await ctx.db
    .query("fantasyPlayerFavorites")
    .filter((q) => q.eq(q.field("userId"), user._id))
    .collect();
  for (const favorite of favorites) {
    await ctx.db.delete(favorite._id);
  }

  const pushTokens = await ctx.db
    .query("pushNotificationTokens")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  for (const pushToken of pushTokens) {
    await ctx.db.delete(pushToken._id);
  }

  const notifications = await ctx.db
    .query("userNotifications")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  for (const notification of notifications) {
    await ctx.db.delete(notification._id);
  }

  const feedbackItems = await ctx.db
    .query("userFeedback")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  for (const feedbackItem of feedbackItems) {
    await ctx.db.delete(feedbackItem._id);
  }

  const crashReports = await ctx.db
    .query("appCrashReports")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  for (const crashReport of crashReports) {
    await ctx.db.delete(crashReport._id);
    deletedCrashReports += 1;
  }

  const remainingDeductions = await ctx.db
    .query("fantasyPointDeductions")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  for (const deduction of remainingDeductions) {
    await ctx.db.delete(deduction._id);
    deletedPointDeductions += 1;
  }

  const remainingTransfers = await ctx.db
    .query("fantasyTransfers")
    .filter((q) => q.eq(q.field("userId"), user._id))
    .collect();
  for (const transfer of remainingTransfers) {
    await ctx.db.delete(transfer._id);
    deletedTransfers += 1;
  }

  for (const fantasyTeam of fantasyTeams) {
    await ctx.db.delete(fantasyTeam._id);
  }

  await ctx.db.delete(user._id);

  return {
    crashReports: deletedCrashReports,
    deleted: true,
    favorites: favorites.length,
    feedback: feedbackItems.length,
    gameweekSquadPicks: deletedGameweekSquadPicks,
    notifications: notifications.length,
    pointDeductions: deletedPointDeductions,
    privateLeagueMemberships: deletedPrivateLeagueMemberships,
    privateLeagues: deletedPrivateLeagues,
    pushTokens: pushTokens.length,
    squadPicks: deletedSquadPicks,
    teamScores: deletedTeamScores,
    teams: fantasyTeams.length,
    transfers: deletedTransfers,
  };
}

export const deleteCurrentUserDataByClerkIdInternal = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .first();

    if (!user) return emptyDeleteCurrentUserDataResult();

    return deleteUserDataForUser(ctx, user);
  },
});

export const upsertAccountDeletionCleanupJobInternal = internalMutation({
  args: {
    clerkId: v.string(),
    lastError: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("clerk_delete_pending"), v.literal("pending")),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingJob = await ctx.db
      .query("accountDeletionCleanupJobs")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .first();
    const nextAttemptAt = args.nextAttemptAt ?? now;
    const status = args.status ?? "pending";

    if (existingJob) {
      await ctx.db.patch(existingJob._id, {
        lastError: args.lastError,
        nextAttemptAt,
        status,
        updatedAt: now,
      });
      return { jobId: existingJob._id };
    }

    const jobId = await ctx.db.insert("accountDeletionCleanupJobs", {
      clerkId: args.clerkId,
      status,
      attempts: 0,
      lastError: args.lastError,
      nextAttemptAt,
      createdAt: now,
      updatedAt: now,
    });

    return { jobId };
  },
});

export const listDueAccountDeletionCleanupJobsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(
      1,
      Math.min(args.limit ?? ACCOUNT_DELETION_CLEANUP_BATCH_SIZE, 50),
    );
    const pendingJobs = await ctx.db
      .query("accountDeletionCleanupJobs")
      .withIndex("by_status_next_attempt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", args.now),
      )
      .take(limit);
    const clerkDeletePendingJobs = await ctx.db
      .query("accountDeletionCleanupJobs")
      .withIndex("by_status_next_attempt", (q) =>
        q.eq("status", "clerk_delete_pending").lte("nextAttemptAt", args.now),
      )
      .take(Math.max(0, limit - pendingJobs.length));
    const jobs = [...pendingJobs, ...clerkDeletePendingJobs];

    return {
      jobs: jobs.map((job) => ({
        attempts: job.attempts,
        clerkId: job.clerkId,
        jobId: job._id,
        status: job.status === "clerk_delete_pending" ? job.status : "pending",
      })),
    };
  },
});

export const markAccountDeletionCleanupJobCompleteInternal = internalMutation({
  args: {
    clerkId: v.string(),
    jobId: v.id("accountDeletionCleanupJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.clerkId !== args.clerkId) return { completed: false };

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      completedAt: now,
      lastError: undefined,
      nextAttemptAt: now,
      status: "completed",
      updatedAt: now,
    });

    return { completed: true };
  },
});

export const markAccountDeletionCleanupJobFailedInternal = internalMutation({
  args: {
    attempts: v.number(),
    clerkId: v.string(),
    jobId: v.id("accountDeletionCleanupJobs"),
    lastError: v.string(),
    nextAttemptAt: v.number(),
    status: v.union(
      v.literal("clerk_delete_pending"),
      v.literal("pending"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.clerkId !== args.clerkId) return { failed: false };

    await ctx.db.patch(args.jobId, {
      attempts: args.attempts,
      lastError: args.lastError.slice(0, 1000),
      nextAttemptAt: args.nextAttemptAt,
      status: args.status,
      updatedAt: Date.now(),
    });

    return { failed: true };
  },
});

export const deleteCurrentUserData = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) return emptyDeleteCurrentUserDataResult();

    return deleteUserDataForUser(ctx, user);
  },
});

export const processAccountDeletionCleanupJobsInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const { jobs } = await ctx.runQuery(
      listDueAccountDeletionCleanupJobsInternalRef,
      { now, limit: ACCOUNT_DELETION_CLEANUP_BATCH_SIZE },
    );

    let cleaned = 0;
    let failed = 0;
    let rescheduled = 0;

    for (const job of jobs) {
      try {
        if (job.status === "clerk_delete_pending") {
          const secretKey = normalizeOptional(process.env.CLERK_SECRET_KEY);
          if (!secretKey) throw new Error(DELETE_ACCOUNT_NOT_CONFIGURED);

          const clerkUserExists = await getClerkUserExists(
            secretKey,
            job.clerkId,
          );
          if (clerkUserExists) {
            throw new Error("Clerk user still exists; app data cleanup skipped.");
          }

          await ctx.runMutation(upsertAccountDeletionCleanupJobInternalRef, {
            clerkId: job.clerkId,
            status: "pending",
          });
        }

        await ctx.runMutation(deleteCurrentUserDataByClerkIdInternalRef, {
          clerkId: job.clerkId,
        });
        await ctx.runMutation(markAccountDeletionCleanupJobCompleteInternalRef, {
          clerkId: job.clerkId,
          jobId: job.jobId,
        });
        cleaned += 1;
      } catch (error) {
        const attempts = job.attempts + 1;
        const reachedLimit = attempts >= ACCOUNT_DELETION_CLEANUP_MAX_ATTEMPTS;
        const nextAttemptAt = reachedLimit
          ? now
          : now + getAccountDeletionCleanupRetryDelayMs(attempts);
        const retryStatus = reachedLimit ? "failed" : job.status;

        await ctx.runMutation(markAccountDeletionCleanupJobFailedInternalRef, {
          attempts,
          clerkId: job.clerkId,
          jobId: job.jobId,
          lastError: formatUnknownError(error),
          nextAttemptAt,
          status: retryStatus,
        });

        if (reachedLimit) {
          failed += 1;
        } else {
          rescheduled += 1;
        }
      }
    }

    return { cleaned, failed, processed: jobs.length, rescheduled };
  },
});

export const deleteCurrentUserAccount = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error(DELETE_ACCOUNT_AUTH_REQUIRED);

    const secretKey = normalizeOptional(process.env.CLERK_SECRET_KEY);
    if (!secretKey) throw new Error(DELETE_ACCOUNT_NOT_CONFIGURED);

    const clerkId = identity.subject;
    let cleanupJobId: Id<"accountDeletionCleanupJobs"> | null = null;

    try {
      const cleanupJob = await ctx.runMutation(
        upsertAccountDeletionCleanupJobInternalRef,
        { clerkId, status: "clerk_delete_pending" },
      );
      cleanupJobId = cleanupJob.jobId;
    } catch (error) {
      console.warn("Could not enqueue account deletion cleanup job", error);
      throw new Error(DELETE_ACCOUNT_CLEANUP_QUEUE_FAILED);
    }

    const response = await fetch(
      `${CLERK_API_USERS_ENDPOINT}/${encodeURIComponent(clerkId)}`,
      {
        method: "DELETE",
        headers: { Authorization: "Bearer " + secretKey },
      },
    );

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text().catch(() => "");
      console.warn(
        "Clerk user deletion failed",
        response.status,
        errorText.slice(0, 1000),
      );

      if (cleanupJobId) {
        await ctx.runMutation(markAccountDeletionCleanupJobFailedInternalRef, {
          attempts: 1,
          clerkId,
          jobId: cleanupJobId,
          lastError: DELETE_ACCOUNT_CLERK_FAILED,
          nextAttemptAt: Date.now(),
          status: "failed",
        });
      }

      throw new Error(DELETE_ACCOUNT_CLERK_FAILED);
    }

    try {
      await ctx.runMutation(upsertAccountDeletionCleanupJobInternalRef, {
        clerkId,
        status: "pending",
      });
    } catch (error) {
      console.warn("Could not enqueue account deletion cleanup job", error);
    }

    return {
      cleanupQueued: true,
      deleted: true,
      appData: emptyDeleteCurrentUserDataResult(),
    };
  },
});
