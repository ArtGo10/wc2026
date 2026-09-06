import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  getCurrentUser,
  getCurrentUserIfAuthenticated,
  isAdminUser,
  requireAdmin,
} from "./authHelpers";
import { syncGameweekDeadlineReminderSchedules } from "./deadlineReminderScheduling";
import type {
  FantasyFixtureEventType,
  FantasyFixtureSide,
  FantasyPlayerPosition,
  FantasyPlayerStatus,
  FantasySquadRole,
} from "./validators";
import {
  fantasyFixtureEventTypeValidator,
  fantasyFixtureSideValidator,
  fantasyFixtureStatusValidator,
  fantasyGameweekStatusValidator,
  fantasyPlayerPositionValidator,
  fantasyPlayerStatusDetailsValidator,
  fantasyPlayerStatusValidator,
  fantasySeasonStatusValidator,
} from "./validators";

type SeasonStatus = Doc<"fantasySeasons">["status"];
type StoredFantasyPlayerPosition = Doc<"fantasyPlayers">["position"];
type ExtraLeagueClubSeed = {
  city: string;
  name: string;
  shortName?: string;
  sortOrder: number;
};
type ExtraLeaguePlayerTemplate = {
  displayName: string;
  firstName: string;
  jerseyNumber: number;
  lastName: string;
  position: FantasyPlayerPosition;
  price: number;
};
const fantasyPlayerSourceStatCorrectionValidator = v.object({
  goals: v.number(),
  assists: v.number(),
  appearances: v.number(),
  yellowCards: v.number(),
  redCards: v.number(),
  ownGoals: v.number(),
});

const STATUS_PRIORITY: Record<SeasonStatus, number> = {
  active: 0,
  setup: 1,
  draft: 2,
  completed: 3,
  archived: 4,
};

const LEGACY_EXTRA_LEAGUE_2025_26_SLUG = "ukrainian-extra-league-2025-26";
const EXTRA_LEAGUE_2026_27_SLUG = "ukrainian-extra-league-2026-27";
const POLISH_FUTSAL_EKSTRAKLASA_2026_27_SLUG =
  "polish-futsal-ekstraklasa-2026-27";
const FANTASY_ADMIN_ONLY_SEASON_SLUGS = new Set([
  POLISH_FUTSAL_EKSTRAKLASA_2026_27_SLUG,
]);
const FANTASY_SQUAD_SIZE = 12;
const FANTASY_ACTIVE_SLOTS = 9;
const FANTASY_STARTING_SLOTS = 5;
const FANTASY_GOALKEEPERS_PER_SQUAD = 2;
const FANTASY_UNIVERSALS_PER_SQUAD = 10;
const FANTASY_GOALKEEPERS_PER_STARTING_GROUP = 1;
const FANTASY_UNIVERSALS_PER_STARTING_GROUP = 4;
const FANTASY_GOALKEEPERS_PER_BENCH_GROUP = 0;
const FANTASY_UNIVERSALS_PER_BENCH_GROUP = 4;
const FANTASY_GOALKEEPERS_PER_RESERVE_GROUP = 1;
const FANTASY_UNIVERSALS_PER_RESERVE_GROUP = 2;
const FANTASY_MAX_PLAYERS_PER_CLUB = 3;
const FANTASY_FREE_TRANSFERS_PER_GAMEWEEK = 1;
const FANTASY_MAX_FREE_TRANSFERS = 5;
const FANTASY_MAX_TRANSFERS_PER_GAMEWEEK = 5;
const FANTASY_TRANSFER_PENALTY_POINTS = 4;
const FANTASY_PRICE_MIN = 5.5;
const FANTASY_PRICE_MAX = 30.0;
const FANTASY_PRICE_STEP = 0.5;
const FANTASY_PRICE_CHANGE_LIMIT = 0.5;
const FANTASY_VALUE_PRICE_DEADBAND = 0.75;
const FANTASY_VALUE_RISE_RATIO = 1.35;
const FANTASY_VALUE_FALL_RATIO = 0.65;
const FANTASY_VALUE_MIN_MARKET_PLAYERS = 5;
const FANTASY_DEFAULT_SEASON_LOGO_KEY = "extra-liga";
const FANTASY_DEFAULT_SEASON_THEME = {
  primaryColor: "#004494",
  secondaryColor: "#2171B8",
  accentColor: "#FFD500",
} as const;
const FANTASY_PRIVATE_LEAGUE_INVITE_CODE_LENGTH = 6;
const FANTASY_PRIVATE_LEAGUE_INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FANTASY_PRIVATE_LEAGUE_NAME_MAX_LENGTH = 48;
const GAMEWEEK_LIVE_PUSH_DELAY_MS = 12 * 60 * 60 * 1000;
const FIXTURE_AUTO_LIVE_LOOKBACK_MS = 12 * 60 * 60 * 1000;
const FANTASY_SUSPENSION_EVENT_TYPES = new Set<FantasyFixtureEventType>([
  "red_card",
  "second_yellow_red",
]);
const FANTASY_SUSPENSION_STATUS_DETAILS = {
  message: "Дискваліфікація",
  messageEn: "Suspended for 1 gameweek",
  messagePl: "Dyskwalifikacja na 1 kolejkę",
  messageUk: "Дискваліфікація на 1 тур",
} as const;
const FANTASY_NON_PARTICIPATION_STATUS_DETAILS = {
  message: "Не грав у минулому турі",
  messageEn: "Did not play last gameweek",
  messagePl: "Nie zagrał w poprzedniej kolejce",
  messageUk: "Не грав у минулому турі",
} as const;
const EXTRA_LEAGUE_ACCIDENTAL_DEV_CLUB_NAMES = new Set([
  "Атлетик Футзал",
  "SkyUp Futsal",
]);
const EXTRA_LEAGUE_REAL_CLUB_NAMES_TO_RESTORE = new Set([
  "Атлетік Футзал",
  "SkyUp",
]);
type PushToAllUsersResult = {
  created: number;
  sent: number;
  skippedDuplicate: boolean;
  updated: number;
};

const sendPushToAllUsersInternal = makeFunctionReference<
  "action",
  {
    body: string;
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
  },
  PushToAllUsersResult
>("notifications:sendPushToAllUsersInternal") as unknown as FunctionReference<
  "action",
  "internal",
  {
    body: string;
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
  },
  PushToAllUsersResult
>;
const FANTASY_DEFAULT_SCORING_RULES = {
  version: "futsal-fantasy-v4",
  appearance: 1,
  outfieldGoal: 4,
  goalkeeperGoal: 7,
  outfieldAssist: 3,
  goalkeeperAssist: 5,
  goalkeeperConcededZero: 0,
  goalkeeperConcededOne: 0,
  goalkeeperConcededTwo: 0,
  goalkeeperConcededThree: 0,
  goalkeeperConcededFour: 0,
  goalkeeperConcededFive: 0,
  goalkeeperConcededSixPlus: 0,
  goalkeeperConcededExtra: 0,
  outfieldTeamGoalsScoredZero: 0,
  outfieldTeamGoalsScoredOneTwo: 0,
  outfieldTeamGoalsScoredThreeFour: 0,
  outfieldTeamGoalsScoredFiveSix: 0,
  outfieldTeamGoalsScoredSevenPlus: 0,
  outfieldConcededZero: 0,
  outfieldConcededOne: 0,
  outfieldConcededTwo: 0,
  outfieldConcededThree: 0,
  outfieldConcededFour: 0,
  outfieldConcededFive: 0,
  outfieldConcededSixPlus: 0,
  yellowCard: -1,
  secondYellowRedCard: -4,
  redCard: -4,
  ownGoal: -2,
  penaltyMissed: -3,
  penaltySaved: 4,
};

async function schedulePushToAllUsers(
  ctx: MutationCtx,
  notification: {
    body: string;
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
  },
  delayMs = 0,
) {
  await ctx.scheduler.runAfter(
    delayMs,
    sendPushToAllUsersInternal,
    notification,
  );
}
type FixtureProfileDoubleClub = {
  clubId: Id<"fantasyClubs"> | null;
  matchCount: number;
  name: string;
};

type FixtureProfileBlankClub = {
  clubId: Id<"fantasyClubs"> | null;
  name: string;
};

type FixtureProfile = {
  hasBlankTeams: boolean;
  isDoubleGameweek: boolean;
  teamsWithBlank: FixtureProfileBlankClub[];
  teamsWithDouble: FixtureProfileDoubleClub[];
};

function shouldExposePlayerPriceTrend(
  history: Doc<"fantasyPlayerPriceHistory">,
) {
  return (
    history.reason === "gameweek_recalculation" ||
    history.reason === "manual_adjustment"
  );
}

const EXTRA_LEAGUE_2026_27_CLUBS: ExtraLeagueClubSeed[] = [
  { name: "ХІТ", shortName: "ХІТ", city: "Київ", sortOrder: 1 },
  {
    name: "Атлетик Футзал",
    shortName: "Атлетик",
    city: "Дніпро",
    sortOrder: 2,
  },
  {
    name: "Суха Балка",
    shortName: "Суха Балка",
    city: "Жовті Води",
    sortOrder: 3,
  },
  { name: "Сокіл", shortName: "Сокіл", city: "Хмельницький", sortOrder: 4 },
  { name: "SkyUp", shortName: "SkyUp", city: "Київ", sortOrder: 5 },
  {
    name: "Ураган",
    shortName: "Ураган",
    city: "Івано-Франківськ",
    sortOrder: 6,
  },
  { name: "Авалон", shortName: "Авалон", city: "Бровари", sortOrder: 7 },
  { name: "Фантом", shortName: "Фантом", city: "Київ", sortOrder: 8 },
  { name: "Агромат", shortName: "Агромат", city: "Київ", sortOrder: 9 },
  { name: "Альянс", shortName: "Альянс", city: "Львів", sortOrder: 10 },
];

const EXTRA_LEAGUE_2026_27_TEST_PLAYER_TEMPLATES: ExtraLeaguePlayerTemplate[] =
  [
    {
      displayName: "Воротар 1",
      firstName: "Тест",
      jerseyNumber: 1,
      lastName: "Воротар",
      position: "goalkeeper",
      price: 5.0,
    },
    {
      displayName: "Воротар 2",
      firstName: "Тест",
      jerseyNumber: 12,
      lastName: "Другий Воротар",
      position: "goalkeeper",
      price: 4.0,
    },
    {
      displayName: "Універсал 1",
      firstName: "Тест",
      jerseyNumber: 4,
      lastName: "Перший Універсал",
      position: "universal",
      price: 5.5,
    },
    {
      displayName: "Універсал 2",
      firstName: "Тест",
      jerseyNumber: 5,
      lastName: "Другий Універсал",
      position: "universal",
      price: 4.7,
    },
    {
      displayName: "Універсал 3",
      firstName: "Тест",
      jerseyNumber: 7,
      lastName: "Третій Універсал",
      position: "universal",
      price: 6.5,
    },
    {
      displayName: "Універсал 4",
      firstName: "Тест",
      jerseyNumber: 11,
      lastName: "Четвертий Універсал",
      position: "universal",
      price: 5.8,
    },
    {
      displayName: "Універсал 5",
      firstName: "Тест",
      jerseyNumber: 9,
      lastName: "П'ятий Універсал",
      position: "universal",
      price: 7.0,
    },
    {
      displayName: "Універсал 6",
      firstName: "Тест",
      jerseyNumber: 10,
      lastName: "Шостий Універсал",
      position: "universal",
      price: 5.2,
    },
  ];

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizePrivateLeagueName(value: string) {
  const name = normalizeText(value);
  if (name.length < 2) {
    throw new Error("Назва ліги занадто коротка.");
  }
  if (name.length > FANTASY_PRIVATE_LEAGUE_NAME_MAX_LENGTH) {
    throw new Error(
      `Назва ліги має бути до ${FANTASY_PRIVATE_LEAGUE_NAME_MAX_LENGTH} символів.`,
    );
  }
  return name;
}

function normalizePrivateLeagueInviteCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function generatePrivateLeagueInviteCode() {
  let code = "";
  for (let index = 0; index < FANTASY_PRIVATE_LEAGUE_INVITE_CODE_LENGTH; index += 1) {
    const randomIndex = Math.floor(
      Math.random() * FANTASY_PRIVATE_LEAGUE_INVITE_CODE_ALPHABET.length,
    );
    code += FANTASY_PRIVATE_LEAGUE_INVITE_CODE_ALPHABET[randomIndex];
  }
  return code;
}

function normalizeSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!slug) {
    throw new Error("Slug не может быть пустым.");
  }
  return slug;
}

function normalizeSeasonAccessValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isAdminOnlyFantasySeason(
  season: Pick<
    Doc<"fantasySeasons">,
    "displayName" | "leagueName" | "logoKey" | "name" | "slug"
  >,
) {
  const candidates = [
    season.slug,
    season.logoKey,
    season.displayName,
    season.leagueName,
    season.name,
  ]
    .map(normalizeSeasonAccessValue)
    .filter(Boolean);

  return candidates.some(
    (candidate) =>
      FANTASY_ADMIN_ONLY_SEASON_SLUGS.has(candidate) ||
      candidate === "polish-ekstraklasa" ||
      candidate.includes("polish-futsal-ekstraklasa") ||
      candidate.includes("polish-ekstraklasa") ||
      candidate.includes("polish ekstraklasa") ||
      candidate.includes("polska ekstraklasa"),
  );
}

async function currentUserCanAccessFantasySeason(
  ctx: QueryCtx | MutationCtx,
  season: Pick<
    Doc<"fantasySeasons">,
    "displayName" | "leagueName" | "logoKey" | "name" | "slug"
  >,
) {
  if (!isAdminOnlyFantasySeason(season)) return true;

  const currentUser = await getCurrentUserIfAuthenticated(ctx);
  return currentUser
    ? isAdminUser(currentUser.identity, currentUser.user)
    : false;
}

function toOptionalText(value: string | undefined) {
  const normalized = value ? normalizeText(value) : "";
  return normalized || undefined;
}

function toPublicFantasyPlayerPosition(
  position: StoredFantasyPlayerPosition,
): FantasyPlayerPosition {
  return position === "goalkeeper" ? "goalkeeper" : "universal";
}

type FantasyPlayerStatusDetailsInput =
  | {
      message?: string;
      messageEn?: string;
      messagePl?: string;
      messageUk?: string;
      updatedAt?: number;
    }
  | null
  | undefined;

function normalizeFantasyPlayerStatusDetails(
  details: FantasyPlayerStatusDetailsInput,
  updatedAt: number,
) {
  if (!details) return undefined;

  const message = toOptionalText(details.message);
  const messageEn = toOptionalText(details.messageEn);
  const messagePl = toOptionalText(details.messagePl);
  const messageUk = toOptionalText(details.messageUk);
  if (!message && !messageEn && !messagePl && !messageUk) return undefined;

  return {
    ...(message ? { message } : {}),
    ...(messageEn ? { messageEn } : {}),
    ...(messagePl ? { messagePl } : {}),
    ...(messageUk ? { messageUk } : {}),
    updatedAt: details.updatedAt ?? updatedAt,
  };
}

function normalizeStatusDetailsMessage(value: string | undefined) {
  return normalizeText(value ?? "").toLowerCase();
}

function isAutomaticNonParticipationStatusDetails(
  details: Doc<"fantasyPlayers">["statusDetails"],
) {
  if (!details) return false;

  return [
    details.message,
    details.messageEn,
    details.messagePl,
    details.messageUk,
  ]
    .map(normalizeStatusDetailsMessage)
    .some(
      (value) =>
        /^did not play (last gameweek|in gameweek \d+)$/.test(value) ||
        /^не грав у (минулому турі|турі \d+)$/.test(value) ||
        /^nie zagrał w (poprzedniej kolejce|\d+\. kolejce)$/.test(value),
    );
}

function hasCurrentNonParticipationStatusDetails(
  details: Doc<"fantasyPlayers">["statusDetails"],
) {
  if (!details) return false;

  return (
    details.message === FANTASY_NON_PARTICIPATION_STATUS_DETAILS.message &&
    details.messageEn === FANTASY_NON_PARTICIPATION_STATUS_DETAILS.messageEn &&
    details.messagePl === FANTASY_NON_PARTICIPATION_STATUS_DETAILS.messagePl &&
    details.messageUk === FANTASY_NON_PARTICIPATION_STATUS_DETAILS.messageUk
  );
}

type FantasyPlayerAvailabilityContext = {
  currentGameweekNumber?: number | null;
};

function getFantasyPlayerSuspensionGameweekNumbers(
  player: Pick<Doc<"fantasyPlayers">, "suspensionGameweekNumbers">,
) {
  return [...new Set(player.suspensionGameweekNumbers ?? [])]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

function isFantasyPlayerSuspendedForGameweek(
  player: Pick<Doc<"fantasyPlayers">, "suspensionGameweekNumbers">,
  context?: FantasyPlayerAvailabilityContext,
) {
  const currentGameweekNumber = context?.currentGameweekNumber;
  if (
    currentGameweekNumber === undefined ||
    currentGameweekNumber === null ||
    !Number.isInteger(currentGameweekNumber)
  ) {
    return false;
  }

  return getFantasyPlayerSuspensionGameweekNumbers(player).includes(
    currentGameweekNumber,
  );
}

function toFantasyPlayerStatusDetailsView(
  player: Pick<
    Doc<"fantasyPlayers">,
    "statusDetails" | "suspensionGameweekNumbers" | "suspensionUpdatedAt"
  >,
  context?: FantasyPlayerAvailabilityContext,
) {
  if (isFantasyPlayerSuspendedForGameweek(player, context)) {
    return {
      message: FANTASY_SUSPENSION_STATUS_DETAILS.message,
      messageEn: FANTASY_SUSPENSION_STATUS_DETAILS.messageEn,
      messagePl: FANTASY_SUSPENSION_STATUS_DETAILS.messagePl,
      messageUk: FANTASY_SUSPENSION_STATUS_DETAILS.messageUk,
      updatedAt: player.suspensionUpdatedAt ?? null,
    };
  }

  if (!player.statusDetails) return null;

  return {
    message: player.statusDetails.message ?? null,
    messageEn: player.statusDetails.messageEn ?? null,
    messagePl: player.statusDetails.messagePl ?? null,
    messageUk: player.statusDetails.messageUk ?? null,
    updatedAt: player.statusDetails.updatedAt ?? null,
  };
}

function getEffectiveFantasyPlayerStatus(
  player: Pick<
    Doc<"fantasyPlayers">,
    "clubId" | "status" | "suspensionGameweekNumbers"
  >,
  context?: FantasyPlayerAvailabilityContext,
): FantasyPlayerStatus {
  if (!player.clubId) return "unavailable";
  if (isFantasyPlayerSuspendedForGameweek(player, context)) {
    return "suspended";
  }
  return player.status;
}

function getSquadRoleForRosterSlot(rosterSlot: number): FantasySquadRole {
  if (rosterSlot <= FANTASY_STARTING_SLOTS) return "starter";
  if (rosterSlot <= FANTASY_ACTIVE_SLOTS) return "bench";
  return "reserve";
}

function getPointsMultiplierForSquadRole(squadRole: FantasySquadRole) {
  if (squadRole === "starter") return 1;
  if (squadRole === "bench") return 0.5;
  return 0;
}

function getSeasonFreeTransfersPerGameweek(season: Doc<"fantasySeasons">) {
  return season.freeTransfersPerGameweek ?? FANTASY_FREE_TRANSFERS_PER_GAMEWEEK;
}

function getSeasonMaxFreeTransfers(season: Doc<"fantasySeasons">) {
  return season.maxFreeTransfers ?? FANTASY_MAX_FREE_TRANSFERS;
}

function getSeasonMaxTransfersPerGameweek(season: Doc<"fantasySeasons">) {
  return season.maxTransfersPerGameweek ?? FANTASY_MAX_TRANSFERS_PER_GAMEWEEK;
}

function getSeasonTransferPenaltyPoints(season: Doc<"fantasySeasons">) {
  return season.transferPenaltyPoints ?? FANTASY_TRANSFER_PENALTY_POINTS;
}

function getSeasonPriceChangeLimit(season: Doc<"fantasySeasons">) {
  return Math.max(
    FANTASY_PRICE_STEP,
    season.priceChangeLimit ?? FANTASY_PRICE_CHANGE_LIMIT,
  );
}

function roundFantasyMoney(value: number) {
  return Number(value.toFixed(1));
}

function roundFantasyPrice(value: number) {
  return Number(
    (Math.round(value / FANTASY_PRICE_STEP) * FANTASY_PRICE_STEP).toFixed(1),
  );
}

function clampFantasyPrice(value: number) {
  return Math.min(FANTASY_PRICE_MAX, Math.max(FANTASY_PRICE_MIN, value));
}

function getFantasyPlayerValueScore(points: number, price: number) {
  if (price <= 0) return 0;
  return points / price;
}

function getMedianFantasyValueScore(values: number[]) {
  const sortedValues = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sortedValues.length < FANTASY_VALUE_MIN_MARKET_PLAYERS) return null;

  const middleIndex = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[middleIndex];

  return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
}

function areGameweekFixturesReadyForPriceChanges(
  fixtures: Doc<"fantasyFixtures">[],
) {
  const activeFixtures = fixtures.filter(
    (fixture) =>
      fixture.status !== "cancelled" && fixture.status !== "postponed",
  );

  return (
    activeFixtures.length > 0 &&
    activeFixtures.every((fixture) => fixture.status === "completed")
  );
}

function getValueBasedGameweekPriceDelta(args: {
  appearances: number;
  medianValueScore: number;
  points: number;
  price: number;
}) {
  if (
    args.appearances <= 0 ||
    args.medianValueScore <= 0 ||
    args.price <= 0
  )
    return 0;

  const valueScore = getFantasyPlayerValueScore(args.points, args.price);
  const fairPrice = args.points / args.medianValueScore;
  const fairPriceGap = fairPrice - args.price;
  if (
    fairPriceGap >= FANTASY_VALUE_PRICE_DEADBAND &&
    valueScore >= args.medianValueScore * FANTASY_VALUE_RISE_RATIO
  )
    return FANTASY_PRICE_STEP;
  if (
    fairPriceGap <= -FANTASY_VALUE_PRICE_DEADBAND &&
    valueScore <= args.medianValueScore * FANTASY_VALUE_FALL_RATIO
  )
    return -FANTASY_PRICE_STEP;

  return 0;
}

function getFiniteFantasyNumber(
  value: number | null | undefined,
  fallback = 0,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function roundFantasyPoints(value: number | null | undefined) {
  return Number(getFiniteFantasyNumber(value).toFixed(2));
}

function toNullableFantasyPoints(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? roundFantasyPoints(value)
    : null;
}

async function getSeasonScoringRules(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"fantasySeasons">,
) {
  return await ctx.db
    .query("fantasyScoringRules")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .first();
}

function toScoringRulesView(
  rule: Doc<"fantasyScoringRules"> | null,
  seasonId: Id<"fantasySeasons">,
) {
  const source = getScoringRuleValues(rule);
  return {
    id: rule?._id ?? null,
    seasonId,
    ...source,
    createdAt: rule?.createdAt ?? null,
    updatedAt: rule?.updatedAt ?? null,
  };
}

async function upsertDefaultScoringRules(
  ctx: MutationCtx,
  seasonId: Id<"fantasySeasons">,
  now: number,
) {
  const existing = await getSeasonScoringRules(ctx, seasonId);
  const payload = {
    seasonId,
    ...FANTASY_DEFAULT_SCORING_RULES,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return { created: false, id: existing._id };
  }

  const id = await ctx.db.insert("fantasyScoringRules", {
    ...payload,
    createdAt: now,
  });
  return { created: true, id };
}

function toSeasonView(
  season: Doc<"fantasySeasons">,
  options: { isLocked?: boolean } = {},
) {
  const isVisible = season.isVisible ?? season.status !== "archived";
  const isAdminOnly = isAdminOnlyFantasySeason(season);

  return {
    id: season._id,
    slug: season.slug,
    name: season.name,
    leagueName: season.leagueName,
    country: season.country,
    displayName: season.displayName ?? season.leagueName,
    shortName: season.shortName ?? season.leagueName,
    description: season.description ?? null,
    logoKey: season.logoKey ?? FANTASY_DEFAULT_SEASON_LOGO_KEY,
    theme: {
      primaryColor:
        season.primaryColor ?? FANTASY_DEFAULT_SEASON_THEME.primaryColor,
      secondaryColor:
        season.secondaryColor ?? FANTASY_DEFAULT_SEASON_THEME.secondaryColor,
      accentColor: season.accentColor ?? FANTASY_DEFAULT_SEASON_THEME.accentColor,
    },
    accessLevel: isAdminOnly ? "admin" : "public",
    isLocked: options.isLocked ?? false,
    lockedReason: options.isLocked && isAdminOnly ? "coming_soon" : null,
    isVisible,
    sortOrder: season.sortOrder ?? 1000,
    status: season.status,
    budget: season.budget,
    squadSize: season.squadSize,
    startingSlots: season.startingSlots,
    activeSlots: season.activeSlots ?? FANTASY_ACTIVE_SLOTS,
    freeTransfersPerGameweek: getSeasonFreeTransfersPerGameweek(season),
    maxFreeTransfers: getSeasonMaxFreeTransfers(season),
    maxTransfersPerGameweek: getSeasonMaxTransfersPerGameweek(season),
    transferPenaltyPoints: getSeasonTransferPenaltyPoints(season),
    priceChangeLimit: getSeasonPriceChangeLimit(season),
    maxTeams: season.maxTeams ?? null,
    startAt: season.startAt ?? null,
    endAt: season.endAt ?? null,
    currentGameweekId: season.currentGameweekId ?? null,
    createdAt: season.createdAt,
    updatedAt: season.updatedAt,
  };
}

function toClubView(club: Doc<"fantasyClubs">) {
  return {
    id: club._id,
    seasonId: club.seasonId,
    externalId: club.externalId ?? null,
    sourceSlug: club.sourceSlug ?? null,
    sourceUrl: club.sourceUrl ?? null,
    name: club.name,
    shortName: club.shortName ?? null,
    city: club.city ?? null,
    logoUrl: club.logoUrl ?? null,
    logoThumbnailUrl: club.logoThumbnailUrl ?? null,
    primaryColor: club.primaryColor ?? null,
    secondaryColor: club.secondaryColor ?? null,
    sortOrder: club.sortOrder,
    isActive: club.isActive,
  };
}

function toGameweekView(
  gameweek: Doc<"fantasyGameweeks">,
  fixtureProfile: FixtureProfile | null = null,
) {
  return {
    id: gameweek._id,
    seasonId: gameweek.seasonId,
    number: gameweek.number,
    name: gameweek.name,
    status: gameweek.status,
    deadlineAt: gameweek.deadlineAt ?? null,
    startsAt: gameweek.startsAt ?? null,
    endsAt: gameweek.endsAt ?? null,
    completedAt: gameweek.completedAt ?? null,
    freeTransfersGrantedAt: gameweek.freeTransfersGrantedAt ?? null,
    fixtureProfile,
  };
}

function computeFixtureProfile(
  gameweekId: Id<"fantasyGameweeks">,
  fixtures: Doc<"fantasyFixtures">[],
  clubs: Doc<"fantasyClubs">[],
): FixtureProfile {
  const clubsById = new Map(clubs.map((club) => [club._id, club]));
  const countsByClubKey = new Map<string, FixtureProfileDoubleClub>();

  for (const club of clubs.filter((item) => item.isActive)) {
    countsByClubKey.set(`id:${club._id}`, {
      clubId: club._id,
      matchCount: 0,
      name: club.name,
    });
  }

  const addFixtureClub = (
    clubId: Id<"fantasyClubs"> | undefined,
    clubName: string | undefined,
  ) => {
    const name = clubId ? (clubsById.get(clubId)?.name ?? clubName) : clubName;
    const normalizedName = name ? normalizeText(name) : "";
    if (!normalizedName) return;

    const key = clubId
      ? `id:${clubId}`
      : `name:${normalizedName.toLowerCase()}`;
    const current = countsByClubKey.get(key) ?? {
      clubId: clubId ?? null,
      matchCount: 0,
      name: normalizedName,
    };
    countsByClubKey.set(key, {
      ...current,
      matchCount: current.matchCount + 1,
    });
  };

  for (const fixture of fixtures) {
    if (fixture.gameweekId !== gameweekId) continue;
    if (fixture.status === "cancelled" || fixture.status === "postponed")
      continue;

    addFixtureClub(fixture.homeClubId, fixture.homeClubName);
    addFixtureClub(fixture.awayClubId, fixture.awayClubName);
  }

  const entries = Array.from(countsByClubKey.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const teamsWithDouble = entries.filter((entry) => entry.matchCount > 1);
  const teamsWithBlank = entries
    .filter((entry) => entry.matchCount === 0)
    .map(({ clubId, name }) => ({ clubId, name }));

  return {
    hasBlankTeams: teamsWithBlank.length > 0,
    isDoubleGameweek: teamsWithDouble.length > 0,
    teamsWithBlank,
    teamsWithDouble,
  };
}

async function getPrimarySeason(ctx: QueryCtx | MutationCtx) {
  const preferredSeason = await ctx.db
    .query("fantasySeasons")
    .withIndex("by_slug", (q) => q.eq("slug", EXTRA_LEAGUE_2026_27_SLUG))
    .first();

  if (preferredSeason && preferredSeason.status !== "archived") {
    return preferredSeason;
  }

  const seasons = await ctx.db.query("fantasySeasons").collect();
  return (
    seasons.sort(
      (a, b) =>
        STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
        (b.startAt ?? b.createdAt) - (a.startAt ?? a.createdAt),
    )[0] ?? null
  );
}

async function getSeasonWithoutAccessCheck(
  ctx: QueryCtx | MutationCtx,
  seasonSlug?: string,
) {
  return seasonSlug
    ? await ctx.db
        .query("fantasySeasons")
        .withIndex("by_slug", (q) => q.eq("slug", normalizeSlug(seasonSlug)))
        .first()
    : await getPrimarySeason(ctx);
}

async function getSeason(ctx: QueryCtx | MutationCtx, seasonSlug?: string) {
  const season = await getSeasonWithoutAccessCheck(ctx, seasonSlug);

  if (!season) return null;
  if (await currentUserCanAccessFantasySeason(ctx, season)) return season;

  if (seasonSlug) return null;

  const fallbackSeason = await getPrimarySeason(ctx);
  if (!fallbackSeason || isAdminOnlyFantasySeason(fallbackSeason)) return null;

  return fallbackSeason;
}

async function requireSeason(ctx: QueryCtx | MutationCtx, seasonSlug: string) {
  const season = await getSeasonWithoutAccessCheck(ctx, seasonSlug);
  if (!season) {
    throw new Error(`Сезон ${normalizeSlug(seasonSlug)} не найден.`);
  }
  if (!(await currentUserCanAccessFantasySeason(ctx, season))) {
    throw new Error("Ця ліга скоро буде доступна.");
  }
  return season;
}

async function requireExistingSeason(
  ctx: QueryCtx | MutationCtx,
  seasonSlug?: string,
) {
  const season = await getSeasonWithoutAccessCheck(ctx, seasonSlug);
  if (!season) {
    throw new Error("Сезон не найден.");
  }
  if (!(await currentUserCanAccessFantasySeason(ctx, season))) {
    throw new Error("Ця ліга скоро буде доступна.");
  }
  return season;
}

async function getFantasyTeamForUser(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"fantasySeasons">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("fantasyTeams")
    .withIndex("by_user_season", (q) =>
      q.eq("userId", userId).eq("seasonId", seasonId),
    )
    .first();
}

async function requireFantasyTeamForUser(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"fantasySeasons">,
  userId: Id<"users">,
) {
  const fantasyTeam = await getFantasyTeamForUser(ctx, seasonId, userId);
  if (!fantasyTeam) {
    throw new Error("Спочатку створіть fantasy-команду.");
  }
  return fantasyTeam;
}

async function attachFantasyTeamToPrivateLeagueMemberships(
  ctx: MutationCtx,
  seasonId: Id<"fantasySeasons">,
  userId: Id<"users">,
  fantasyTeamId: Id<"fantasyTeams">,
) {
  const memberships = await ctx.db
    .query("fantasyPrivateLeagueMembers")
    .withIndex("by_user_season", (q) =>
      q.eq("userId", userId).eq("seasonId", seasonId),
    )
    .collect();

  for (const membership of memberships) {
    if (membership.fantasyTeamId === fantasyTeamId) continue;

    await ctx.db.patch(membership._id, {
      fantasyTeamId,
      updatedAt: Date.now(),
    });
  }
}

async function getSeasonGameweeks(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"fantasySeasons">,
) {
  const gameweeks = await ctx.db
    .query("fantasyGameweeks")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .collect();

  return gameweeks.sort((a, b) => a.number - b.number);
}

function isGameweekEditableForFantasy(
  gameweek: Doc<"fantasyGameweeks">,
  now: number,
) {
  if (
    gameweek.status === "completed" ||
    gameweek.status === "locked" ||
    gameweek.status === "live"
  ) {
    return false;
  }

  return !gameweek.deadlineAt || now < gameweek.deadlineAt;
}

function isFixtureScoredForFantasy(fixture: Doc<"fantasyFixtures">) {
  return fixture.status === "completed" || fixture.status === "live";
}

function isGameweekScoredForFantasy(gameweek: Doc<"fantasyGameweeks">) {
  return gameweek.status === "completed" || gameweek.status === "live";
}

function getFantasyGameweekParticipationCutoffAt(
  gameweek: Doc<"fantasyGameweeks">,
) {
  return gameweek.deadlineAt ?? gameweek.startsAt;
}

function canFantasyTeamParticipateInGameweek(
  fantasyTeam: Pick<Doc<"fantasyTeams">, "createdAt">,
  gameweek: Doc<"fantasyGameweeks">,
) {
  const cutoffAt = getFantasyGameweekParticipationCutoffAt(gameweek);
  return (
    cutoffAt === undefined ||
    getFiniteFantasyNumber(fantasyTeam.createdAt) <= cutoffAt
  );
}

function findLatestScoredGameweekFromList(
  gameweeks: Doc<"fantasyGameweeks">[],
) {
  return (
    [...gameweeks]
      .filter(isGameweekScoredForFantasy)
      .sort((a, b) => b.number - a.number)[0] ?? null
  );
}

function findEditableGameweekFromList(
  gameweeks: Doc<"fantasyGameweeks">[],
  now: number,
  afterNumber = -Infinity,
) {
  return (
    gameweeks.find(
      (gameweek) =>
        gameweek.number > afterNumber &&
        isGameweekEditableForFantasy(gameweek, now),
    ) ?? null
  );
}

function findCurrentGameweekFromList(
  season: Doc<"fantasySeasons">,
  gameweeks: Doc<"fantasyGameweeks">[],
  now = Date.now(),
) {
  const sortedGameweeks = [...gameweeks].sort((a, b) => a.number - b.number);
  const gameweeksById = new Map(
    sortedGameweeks.map((gameweek) => [gameweek._id, gameweek]),
  );
  const configuredGameweek = season.currentGameweekId
    ? (gameweeksById.get(season.currentGameweekId) ?? null)
    : null;

  if (
    configuredGameweek &&
    isGameweekEditableForFantasy(configuredGameweek, now)
  ) {
    return configuredGameweek;
  }

  const nextAfterConfigured = configuredGameweek
    ? findEditableGameweekFromList(
        sortedGameweeks,
        now,
        configuredGameweek.number,
      )
    : null;
  if (nextAfterConfigured) return nextAfterConfigured;

  return (
    findEditableGameweekFromList(sortedGameweeks, now) ??
    sortedGameweeks.find((gameweek) => gameweek.status !== "completed") ??
    sortedGameweeks[sortedGameweeks.length - 1] ??
    null
  );
}

async function findCurrentGameweek(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"fantasySeasons">,
  now = Date.now(),
) {
  return findCurrentGameweekFromList(
    season,
    await getSeasonGameweeks(ctx, season._id),
    now,
  );
}

async function findClubByName(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"fantasySeasons">,
  name: string,
) {
  return await ctx.db
    .query("fantasyClubs")
    .withIndex("by_season_name", (q) =>
      q.eq("seasonId", seasonId).eq("name", normalizeText(name)),
    )
    .first();
}

async function resolveClubId(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"fantasySeasons">,
  clubId: Id<"fantasyClubs"> | undefined,
  clubName: string | undefined,
) {
  if (clubId) return clubId;
  if (!clubName) return undefined;

  return (await findClubByName(ctx, seasonId, clubName))?._id;
}

async function upsertExtraLeague2026_27Season(ctx: MutationCtx, now: number) {
  const existing = await ctx.db
    .query("fantasySeasons")
    .withIndex("by_slug", (q) => q.eq("slug", EXTRA_LEAGUE_2026_27_SLUG))
    .first();
  const payload = {
    slug: EXTRA_LEAGUE_2026_27_SLUG,
    name: "betking Екстра-ліга 2026/27",
    leagueName: "betking Екстра-ліга",
    country: "Україна",
    displayName: "Fantasy Extra-liga",
    shortName: "Extra-liga",
    description: "Українська futsal fantasy-ліга.",
    logoKey: FANTASY_DEFAULT_SEASON_LOGO_KEY,
    ...FANTASY_DEFAULT_SEASON_THEME,
    isVisible: true,
    sortOrder: 10,
    status: "setup" as const,
    budget: 100,
    squadSize: FANTASY_SQUAD_SIZE,
    startingSlots: FANTASY_STARTING_SLOTS,
    activeSlots: FANTASY_ACTIVE_SLOTS,
    freeTransfersPerGameweek: FANTASY_FREE_TRANSFERS_PER_GAMEWEEK,
    maxFreeTransfers: FANTASY_MAX_FREE_TRANSFERS,
    maxTransfersPerGameweek: FANTASY_MAX_TRANSFERS_PER_GAMEWEEK,
    transferPenaltyPoints: FANTASY_TRANSFER_PENALTY_POINTS,
    priceChangeLimit: FANTASY_PRICE_CHANGE_LIMIT,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return {
      created: false,
      id: existing._id,
    };
  }

  const id = await ctx.db.insert("fantasySeasons", {
    ...payload,
    createdAt: now,
  });

  return {
    created: true,
    id,
  };
}

async function upsertExtraLeagueClub(
  ctx: MutationCtx,
  seasonId: Id<"fantasySeasons">,
  club: ExtraLeagueClubSeed,
  now: number,
) {
  const existing = await findClubByName(ctx, seasonId, club.name);
  const payload = {
    seasonId,
    name: club.name,
    shortName: club.shortName,
    city: club.city,
    sortOrder: club.sortOrder,
    isActive: true,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return {
      created: false,
      id: existing._id,
    };
  }

  const id = await ctx.db.insert("fantasyClubs", {
    ...payload,
    createdAt: now,
  });

  return {
    created: true,
    id,
  };
}

async function upsertExtraLeagueTestPlayer(
  ctx: MutationCtx,
  seasonId: Id<"fantasySeasons">,
  clubId: Id<"fantasyClubs">,
  club: ExtraLeagueClubSeed,
  template: ExtraLeaguePlayerTemplate,
  templateIndex: number,
  now: number,
) {
  const externalId = `extra-league-2026-27-test-${club.sortOrder.toString().padStart(2, "0")}-${(
    templateIndex + 1
  )
    .toString()
    .padStart(2, "0")}`;
  const clubName = club.shortName ?? club.name;
  const priceModifier = ((club.sortOrder - 1) % 4) * 0.2;
  const payload = {
    seasonId,
    clubId,
    externalId,
    firstName: template.firstName,
    lastName: `${clubName} ${template.lastName}`,
    displayName: `${clubName} ${template.displayName}`,
    position: template.position,
    price: Number((template.price + priceModifier).toFixed(1)),
    status: "active" as const,
    jerseyNumber: template.jerseyNumber,
    updatedAt: now,
  };
  const existing = await ctx.db
    .query("fantasyPlayers")
    .withIndex("by_season_external_id", (q) =>
      q.eq("seasonId", seasonId).eq("externalId", externalId),
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return { id: existing._id, created: false };
  }

  const id = await ctx.db.insert("fantasyPlayers", {
    ...payload,
    createdAt: now,
  });

  return { id, created: true };
}

async function seedExtraLeague2026_27Data(
  ctx: MutationCtx,
  now: number,
  {
    deactivateMissingClubs = false,
    includeTestPlayers,
  }: { deactivateMissingClubs?: boolean; includeTestPlayers: boolean },
) {
  const season = await upsertExtraLeague2026_27Season(ctx, now);
  const scoringRules = await upsertDefaultScoringRules(ctx, season.id, now);
  const seededClubNames = new Set(
    EXTRA_LEAGUE_2026_27_CLUBS.map((club) => club.name),
  );
  const clubResults = [];
  const playerResults = [];

  for (const club of EXTRA_LEAGUE_2026_27_CLUBS) {
    const result = await upsertExtraLeagueClub(ctx, season.id, club, now);
    clubResults.push({ club, ...result });

    if (includeTestPlayers) {
      for (const [
        templateIndex,
        template,
      ] of EXTRA_LEAGUE_2026_27_TEST_PLAYER_TEMPLATES.entries()) {
        playerResults.push(
          await upsertExtraLeagueTestPlayer(
            ctx,
            season.id,
            result.id,
            club,
            template,
            templateIndex,
            now,
          ),
        );
      }
    }
  }

  const seasonClubs = await ctx.db
    .query("fantasyClubs")
    .withIndex("by_season", (q) => q.eq("seasonId", season.id))
    .collect();
  const inactiveClubIds = [];

  if (deactivateMissingClubs) {
    for (const club of seasonClubs) {
      if (!seededClubNames.has(club.name) && club.isActive) {
        await ctx.db.patch(club._id, {
          isActive: false,
          updatedAt: now,
        });
        inactiveClubIds.push(club._id);
      }
    }
  }

  return {
    seasonId: season.id,
    seasonCreated: season.created,
    insertedClubs: clubResults.filter((club) => club.created).length,
    updatedClubs: clubResults.filter((club) => !club.created).length,
    inactiveClubs: inactiveClubIds.length,
    scoringRulesCreated: scoringRules.created,
    insertedPlayers: playerResults.filter((player) => player.created).length,
    updatedPlayers: playerResults.filter((player) => !player.created).length,
    totalClubs: clubResults.length,
    totalPlayers: playerResults.length,
  };
}

async function deleteFantasySeasonCascade(
  ctx: MutationCtx,
  season: Doc<"fantasySeasons">,
) {
  const [
    clubs,
    players,
    gameweeks,
    fixtures,
    fixtureLineups,
    fixtureEvents,
    fantasyTeams,
    stats,
    teamGameweekScores,
    gameweekSquadPicks,
    playerFavorites,
    scoringRules,
    transfers,
  ] = await Promise.all([
    ctx.db
      .query("fantasyClubs")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyGameweeks")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyFixtures")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyFixtureLineups")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyFixtureEvents")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyPlayerGameweekStats")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyTeamGameweekScores")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyGameweekSquadPicks")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyPlayerFavorites")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyScoringRules")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyTransfers")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
  ]);

  let deletedSquadPicks = 0;

  for (const fantasyTeam of fantasyTeams) {
    const picks = await ctx.db
      .query("fantasySquadPicks")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
      .collect();

    for (const pick of picks) {
      await ctx.db.delete(pick._id);
      deletedSquadPicks += 1;
    }
  }

  const seasonStats = stats;

  for (const transfer of transfers) await ctx.db.delete(transfer._id);
  for (const scoringRule of scoringRules) await ctx.db.delete(scoringRule._id);
  for (const favorite of playerFavorites) await ctx.db.delete(favorite._id);
  for (const teamScore of teamGameweekScores)
    await ctx.db.delete(teamScore._id);
  for (const snapshot of gameweekSquadPicks) await ctx.db.delete(snapshot._id);
  for (const stat of seasonStats) await ctx.db.delete(stat._id);
  for (const fixtureEvent of fixtureEvents)
    await ctx.db.delete(fixtureEvent._id);
  for (const fixtureLineup of fixtureLineups)
    await ctx.db.delete(fixtureLineup._id);
  for (const fixture of fixtures) await ctx.db.delete(fixture._id);
  for (const gameweek of gameweeks) await ctx.db.delete(gameweek._id);
  for (const fantasyTeam of fantasyTeams) await ctx.db.delete(fantasyTeam._id);
  for (const player of players) await ctx.db.delete(player._id);
  for (const club of clubs) await ctx.db.delete(club._id);
  await ctx.db.delete(season._id);

  return {
    clubs: clubs.length,
    fixtureEvents: fixtureEvents.length,
    fixtureLineups: fixtureLineups.length,
    fixtures: fixtures.length,
    gameweekSquadPicks: gameweekSquadPicks.length,
    gameweeks: gameweeks.length,
    playerFavorites: playerFavorites.length,
    players: players.length,
    scoringRules: scoringRules.length,
    season: 1,
    squadPicks: deletedSquadPicks,
    stats: seasonStats.length,
    teamGameweekScores: teamGameweekScores.length,
    teams: fantasyTeams.length,
    transfers: transfers.length,
  };
}

export const listSeasons = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUserIfAuthenticated(ctx);
    const viewerIsAdmin = currentUser
      ? isAdminUser(currentUser.identity, currentUser.user)
      : false;
    const seasons = await ctx.db.query("fantasySeasons").collect();
    return seasons
      .map((season) =>
        toSeasonView(season, {
          isLocked: isAdminOnlyFantasySeason(season) && !viewerIsAdmin,
        }),
      )
      .filter((season) => season.isVisible)
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
          (b.startAt ?? b.createdAt) - (a.startAt ?? a.createdAt),
      );
  },
});

export const overview = query({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const season = await getSeason(ctx, args.seasonSlug);

    if (!season) {
      return {
        season: null,
        currentGameweek: null,
        clubCount: 0,
        playerCount: 0,
        fixtureCount: 0,
        fantasyTeamCount: 0,
        nextDeadlineAt: null,
        scoringRules: null,
      };
    }

    const [clubs, players, fixtures, fantasyTeams, gameweeks, scoringRules] =
      await Promise.all([
        ctx.db
          .query("fantasyClubs")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyPlayers")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyFixtures")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyTeams")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyGameweeks")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        getSeasonScoringRules(ctx, season._id),
      ]);
    const now = Date.now();
    const currentGameweek = await findCurrentGameweek(ctx, season, now);
    const nextDeadlineAt =
      gameweeks
        .map((gameweek) => gameweek.deadlineAt)
        .filter(
          (deadlineAt): deadlineAt is number =>
            typeof deadlineAt === "number" && deadlineAt > now,
        )
        .sort((a, b) => a - b)[0] ?? null;

    const currentFixtureProfile = currentGameweek
      ? computeFixtureProfile(currentGameweek._id, fixtures, clubs)
      : null;

    return {
      season: toSeasonView(season),
      currentGameweek: currentGameweek
        ? toGameweekView(currentGameweek, currentFixtureProfile)
        : null,
      clubCount: clubs.length,
      playerCount: players.length,
      fixtureCount: fixtures.length,
      fantasyTeamCount: fantasyTeams.length,
      nextDeadlineAt,
      scoringRules: toScoringRulesView(scoringRules, season._id),
    };
  },
});

export const scoringRules = query({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const season = await getSeason(ctx, args.seasonSlug);
    if (!season) return null;

    return toScoringRulesView(
      await getSeasonScoringRules(ctx, season._id),
      season._id,
    );
  },
});

export const listClubs = query({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const season = await getSeason(ctx, args.seasonSlug);
    if (!season) return [];

    const clubs = await ctx.db
      .query("fantasyClubs")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();

    return clubs
      .map(toClubView)
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
  },
});

export const listPlayers = query({
  args: {
    seasonSlug: v.optional(v.string()),
    clubId: v.optional(v.id("fantasyClubs")),
    position: v.optional(fantasyPlayerPositionValidator),
    status: v.optional(fantasyPlayerStatusValidator),
  },
  handler: async (ctx, args) => {
    const season = await getSeason(ctx, args.seasonSlug);
    if (!season) return [];

    const players = args.clubId
      ? await ctx.db
          .query("fantasyPlayers")
          .withIndex("by_club", (q) => q.eq("clubId", args.clubId))
          .collect()
      : await ctx.db
          .query("fantasyPlayers")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect();
    const [
      clubs,
      playerGameweekStats,
      fantasyTeams,
      playerPriceHistory,
      gameweeks,
    ] = await Promise.all([
      ctx.db
        .query("fantasyClubs")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerGameweekStats")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyTeams")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerPriceHistory")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyGameweeks")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
    ]);
    const clubsById = new Map(clubs.map((club) => [club._id, club]));
    const now = Date.now();
    const currentGameweek = findCurrentGameweekFromList(
      season,
      gameweeks,
      now,
    );
    const availabilityContext = {
      currentGameweekNumber: currentGameweek?.number ?? null,
    };
    const latestPriceHistoryByPlayerId = new Map<
      Id<"fantasyPlayers">,
      Doc<"fantasyPlayerPriceHistory">
    >();
    for (const history of playerPriceHistory) {
      if (!shouldExposePlayerPriceTrend(history)) continue;

      const current = latestPriceHistoryByPlayerId.get(history.playerId);
      if (!current || history.createdAt > current.createdAt) {
        latestPriceHistoryByPlayerId.set(history.playerId, history);
      }
    }
    const statsByPlayerId = new Map<
      Id<"fantasyPlayers">,
      PlayerStatsAccumulator
    >();
    const statsByGameweekAndPlayerId = new Map<
      string,
      Doc<"fantasyPlayerGameweekStats">
    >();
    for (const stat of playerGameweekStats) {
      if (stat.seasonId !== season._id) continue;

      const current =
        statsByPlayerId.get(stat.playerId) ?? getEmptyPlayerStats();
      current.appearances +=
        stat.appearances ??
        (stat.minutes !== undefined && stat.minutes > 0 ? 1 : 0);
      current.assists += stat.assists ?? 0;
      current.cleanSheets += stat.cleanSheets ?? (stat.cleanSheet ? 1 : 0);
      current.goals += stat.goals ?? 0;
      current.goalsConceded += stat.goalsConceded ?? 0;
      current.ownGoals += stat.ownGoals ?? 0;
      current.penaltiesMissed += stat.penaltiesMissed ?? 0;
      current.penaltiesSaved += stat.penaltiesSaved ?? 0;
      current.points += stat.points;
      current.redCards += stat.redCards ?? 0;
      current.saves += stat.saves ?? 0;
      current.yellowCards += stat.yellowCards ?? 0;
      statsByPlayerId.set(stat.playerId, current);
      statsByGameweekAndPlayerId.set(
        getPlayerGameweekStatsKey(stat.gameweekId, stat.playerId),
        stat,
      );
    }
    const latestScoredGameweek = findLatestScoredGameweekFromList(gameweeks);
    const squadPickLists = await Promise.all(
      fantasyTeams.map((fantasyTeam) =>
        ctx.db
          .query("fantasySquadPicks")
          .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
          .collect(),
      ),
    );
    const pickedByPlayerId = new Map<Id<"fantasyPlayers">, number>();
    for (const picks of squadPickLists) {
      const uniquePlayerIds = new Set(picks.map((pick) => pick.playerId));
      for (const playerId of uniquePlayerIds) {
        pickedByPlayerId.set(
          playerId,
          (pickedByPlayerId.get(playerId) ?? 0) + 1,
        );
      }
    }

    return players
      .filter((player) => player.seasonId === season._id)
      .filter(
        (player) =>
          !args.position ||
          toPublicFantasyPlayerPosition(player.position) === args.position,
      )
      .filter((player) =>
        args.status
          ? getEffectiveFantasyPlayerStatus(player, availabilityContext) ===
            args.status
          : true,
      )
      .map((player) => {
        const club = player.clubId ? clubsById.get(player.clubId) : null;
        const stats = statsByPlayerId.get(player._id) ?? getEmptyPlayerStats();
        const selectedByTeams = pickedByPlayerId.get(player._id) ?? 0;
        const selectedPercent =
          fantasyTeams.length > 0
            ? Number(((selectedByTeams / fantasyTeams.length) * 100).toFixed(1))
            : 0;
        const latestPriceHistory = latestPriceHistoryByPlayerId.get(player._id);
        const priceDelta = latestPriceHistory
          ? Number(latestPriceHistory.delta.toFixed(1))
          : 0;
        const averagePointsPerMatch =
          stats.appearances > 0
            ? Number((stats.points / stats.appearances).toFixed(1))
            : 0;
        const latestGameweekStat = latestScoredGameweek
          ? statsByGameweekAndPlayerId.get(
              getPlayerGameweekStatsKey(
                latestScoredGameweek._id,
                player._id,
              ),
            )
          : undefined;
        return {
          id: player._id,
          seasonId: player.seasonId,
          clubId: player.clubId ?? null,
          clubName: club?.name ?? null,
          externalId: player.externalId ?? null,
          sourceSlug: player.sourceSlug ?? null,
          sourceUrl: player.sourceUrl ?? null,
          firstName: player.firstName ?? null,
          lastName: player.lastName,
          displayName: player.displayName,
          position: toPublicFantasyPlayerPosition(player.position),
          price: player.price,
          previousPrice:
            latestPriceHistory && Math.abs(priceDelta) >= 0.1
              ? latestPriceHistory.oldPrice
              : null,
          priceChangedAt: latestPriceHistory?.createdAt ?? null,
          priceDelta,
          status: getEffectiveFantasyPlayerStatus(player, availabilityContext),
          statusDetails: toFantasyPlayerStatusDetailsView(
            player,
            availabilityContext,
          ),
          jerseyNumber: player.jerseyNumber ?? null,
          photoUrl: player.photoUrl ?? null,
          photoThumbnailUrl: player.photoThumbnailUrl ?? null,
          photoProvider: player.photoProvider ?? null,
          photoCloudflareId: player.photoCloudflareId ?? null,
          photoStorageKey: player.photoStorageKey ?? null,
          photoSourceUrl: player.photoSourceUrl ?? null,
          photoSourceThumbnailUrl: player.photoSourceThumbnailUrl ?? null,
          currentTeamExternalIds: player.currentTeamExternalIds ?? [],
          listedTeamExternalIds: player.listedTeamExternalIds ?? [],
          appearances: stats.appearances,
          assists: stats.assists,
          averagePointsPerGameweek: averagePointsPerMatch,
          averagePointsPerMatch,
          cleanSheets: stats.cleanSheets,
          goals: stats.goals,
          goalsConceded: stats.goalsConceded,
          lastGameweekPoints: latestGameweekStat
            ? Number(latestGameweekStat.points.toFixed(1))
            : 0,
          ownGoals: stats.ownGoals,
          penaltiesMissed: stats.penaltiesMissed,
          penaltiesSaved: stats.penaltiesSaved,
          redCards: stats.redCards,
          saves: stats.saves,
          seasonPoints: Number(stats.points.toFixed(1)),
          selectedByTeams,
          selectedPercent,
          yellowCards: stats.yellowCards,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const listGameweeks = query({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const season = await getSeason(ctx, args.seasonSlug);
    if (!season) return [];

    const [gameweeks, fixtures, clubs] = await Promise.all([
      ctx.db
        .query("fantasyGameweeks")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyFixtures")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyClubs")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
    ]);

    return gameweeks
      .map((gameweek) =>
        toGameweekView(
          gameweek,
          computeFixtureProfile(gameweek._id, fixtures, clubs),
        ),
      )
      .sort((a, b) => a.number - b.number);
  },
});

export const listFixtures = query({
  args: {
    seasonSlug: v.optional(v.string()),
    gameweekId: v.optional(v.id("fantasyGameweeks")),
  },
  handler: async (ctx, args) => {
    const season = await getSeason(ctx, args.seasonSlug);
    if (!season) return [];

    const fixtures = args.gameweekId
      ? await ctx.db
          .query("fantasyFixtures")
          .withIndex("by_gameweek", (q) => q.eq("gameweekId", args.gameweekId))
          .collect()
      : await ctx.db
          .query("fantasyFixtures")
          .withIndex("by_season_scheduled_at", (q) =>
            q.eq("seasonId", season._id),
          )
          .collect();

    return fixtures
      .filter((fixture) => fixture.seasonId === season._id)
      .map((fixture) => ({
        id: fixture._id,
        seasonId: fixture.seasonId,
        gameweekId: fixture.gameweekId ?? null,
        externalId: fixture.externalId ?? null,
        sourceSlug: fixture.sourceSlug ?? null,
        sourceUrl: fixture.sourceUrl ?? null,
        homeClubId: fixture.homeClubId ?? null,
        awayClubId: fixture.awayClubId ?? null,
        homeClubName: fixture.homeClubName,
        awayClubName: fixture.awayClubName,
        scheduledAt: fixture.scheduledAt,
        status: fixture.status,
        homeScore: fixture.homeScore ?? null,
        awayScore: fixture.awayScore ?? null,
        venue: fixture.venue ?? null,
      }))
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  },
});

type ManagerPlayerPointsAccumulator = {
  activeGameweeks: number;
  managerLastGameweekPoints: number;
  managerSeasonPoints: number;
};

type PlayerStatsAccumulator = {
  appearances: number;
  assists: number;
  cleanSheets: number;
  goals: number;
  goalsConceded: number;
  ownGoals: number;
  penaltiesMissed: number;
  penaltiesSaved: number;
  points: number;
  redCards: number;
  saves: number;
  secondYellowRedCards: number;
  teamGoalsConcededPoints: number;
  teamGoalsScored: number;
  teamGoalsScoredPoints: number;
  yellowCards: number;
};

function getEmptyManagerPlayerPoints(): ManagerPlayerPointsAccumulator {
  return {
    activeGameweeks: 0,
    managerLastGameweekPoints: 0,
    managerSeasonPoints: 0,
  };
}

function getEmptyPlayerStats(): PlayerStatsAccumulator {
  return {
    appearances: 0,
    assists: 0,
    cleanSheets: 0,
    goals: 0,
    goalsConceded: 0,
    ownGoals: 0,
    penaltiesMissed: 0,
    penaltiesSaved: 0,
    points: 0,
    redCards: 0,
    saves: 0,
    secondYellowRedCards: 0,
    teamGoalsConcededPoints: 0,
    teamGoalsScored: 0,
    teamGoalsScoredPoints: 0,
    yellowCards: 0,
  };
}

function compareSeasonPlayerStats(
  a: {
    assists: number;
    displayName: string;
    goals: number;
    id: Id<"fantasyPlayers">;
    points: number;
  },
  b: {
    assists: number;
    displayName: string;
    goals: number;
    id: Id<"fantasyPlayers">;
    points: number;
  },
) {
  return (
    b.points - a.points ||
    b.goals - a.goals ||
    b.assists - a.assists ||
    a.displayName.localeCompare(b.displayName)
  );
}

type ScoringRuleValues = typeof FANTASY_DEFAULT_SCORING_RULES;

type MutablePlayerGameweekStats = PlayerStatsAccumulator & {
  appearanceFixtureKeys: Set<string>;
};

function getScoringRuleValues(
  rule: Doc<"fantasyScoringRules"> | null,
): ScoringRuleValues {
  const source =
    rule?.version === FANTASY_DEFAULT_SCORING_RULES.version
      ? rule
      : FANTASY_DEFAULT_SCORING_RULES;
  return {
    version: FANTASY_DEFAULT_SCORING_RULES.version,
    appearance: source.appearance ?? FANTASY_DEFAULT_SCORING_RULES.appearance,
    outfieldGoal:
      source.outfieldGoal ?? FANTASY_DEFAULT_SCORING_RULES.outfieldGoal,
    goalkeeperGoal:
      source.goalkeeperGoal ?? FANTASY_DEFAULT_SCORING_RULES.goalkeeperGoal,
    outfieldAssist:
      source.outfieldAssist ?? FANTASY_DEFAULT_SCORING_RULES.outfieldAssist,
    goalkeeperAssist:
      source.goalkeeperAssist ?? FANTASY_DEFAULT_SCORING_RULES.goalkeeperAssist,
    goalkeeperConcededZero:
      source.goalkeeperConcededZero ??
      FANTASY_DEFAULT_SCORING_RULES.goalkeeperConcededZero,
    goalkeeperConcededOne:
      source.goalkeeperConcededOne ??
      FANTASY_DEFAULT_SCORING_RULES.goalkeeperConcededOne,
    goalkeeperConcededTwo:
      source.goalkeeperConcededTwo ??
      FANTASY_DEFAULT_SCORING_RULES.goalkeeperConcededTwo,
    goalkeeperConcededThree:
      source.goalkeeperConcededThree ??
      FANTASY_DEFAULT_SCORING_RULES.goalkeeperConcededThree,
    goalkeeperConcededFour:
      source.goalkeeperConcededFour ??
      FANTASY_DEFAULT_SCORING_RULES.goalkeeperConcededFour,
    goalkeeperConcededFive:
      source.goalkeeperConcededFive ??
      FANTASY_DEFAULT_SCORING_RULES.goalkeeperConcededFive,
    goalkeeperConcededSixPlus:
      source.goalkeeperConcededSixPlus ??
      FANTASY_DEFAULT_SCORING_RULES.goalkeeperConcededSixPlus,
    goalkeeperConcededExtra:
      source.goalkeeperConcededExtra ??
      FANTASY_DEFAULT_SCORING_RULES.goalkeeperConcededExtra,
    outfieldTeamGoalsScoredZero:
      source.outfieldTeamGoalsScoredZero ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldTeamGoalsScoredZero,
    outfieldTeamGoalsScoredOneTwo:
      source.outfieldTeamGoalsScoredOneTwo ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldTeamGoalsScoredOneTwo,
    outfieldTeamGoalsScoredThreeFour:
      source.outfieldTeamGoalsScoredThreeFour ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldTeamGoalsScoredThreeFour,
    outfieldTeamGoalsScoredFiveSix:
      source.outfieldTeamGoalsScoredFiveSix ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldTeamGoalsScoredFiveSix,
    outfieldTeamGoalsScoredSevenPlus:
      source.outfieldTeamGoalsScoredSevenPlus ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldTeamGoalsScoredSevenPlus,
    outfieldConcededZero:
      source.outfieldConcededZero ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldConcededZero,
    outfieldConcededOne:
      source.outfieldConcededOne ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldConcededOne,
    outfieldConcededTwo:
      source.outfieldConcededTwo ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldConcededTwo,
    outfieldConcededThree:
      source.outfieldConcededThree ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldConcededThree,
    outfieldConcededFour:
      source.outfieldConcededFour ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldConcededFour,
    outfieldConcededFive:
      source.outfieldConcededFive ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldConcededFive,
    outfieldConcededSixPlus:
      source.outfieldConcededSixPlus ??
      FANTASY_DEFAULT_SCORING_RULES.outfieldConcededSixPlus,
    yellowCard: source.yellowCard ?? FANTASY_DEFAULT_SCORING_RULES.yellowCard,
    secondYellowRedCard:
      source.secondYellowRedCard ??
      FANTASY_DEFAULT_SCORING_RULES.secondYellowRedCard,
    redCard: source.redCard ?? FANTASY_DEFAULT_SCORING_RULES.redCard,
    ownGoal: source.ownGoal ?? FANTASY_DEFAULT_SCORING_RULES.ownGoal,
    penaltyMissed:
      source.penaltyMissed ?? FANTASY_DEFAULT_SCORING_RULES.penaltyMissed,
    penaltySaved:
      source.penaltySaved ?? FANTASY_DEFAULT_SCORING_RULES.penaltySaved,
  };
}

function getFixtureEventPoints(
  type: FantasyFixtureEventType,
  player: Doc<"fantasyPlayers"> | null,
  rules: ScoringRuleValues,
) {
  const position = player
    ? toPublicFantasyPlayerPosition(player.position)
    : null;

  if (type === "goal")
    return position === "goalkeeper"
      ? rules.goalkeeperGoal
      : rules.outfieldGoal;
  if (type === "assist")
    return position === "goalkeeper"
      ? rules.goalkeeperAssist
      : rules.outfieldAssist;
  if (type === "yellow_card") return rules.yellowCard;
  if (type === "second_yellow_red") return rules.secondYellowRedCard;
  if (type === "red_card") return rules.redCard;
  if (type === "own_goal") return rules.ownGoal;
  if (type === "penalty_missed") return rules.penaltyMissed;
  if (type === "penalty_saved") return rules.penaltySaved;

  return 0;
}

function getMutablePlayerGameweekStats(
  statsByPlayerId: Map<Id<"fantasyPlayers">, MutablePlayerGameweekStats>,
  playerId: Id<"fantasyPlayers">,
) {
  const existing = statsByPlayerId.get(playerId);
  if (existing) return existing;

  const next = {
    ...getEmptyPlayerStats(),
    appearanceFixtureKeys: new Set<string>(),
  };
  statsByPlayerId.set(playerId, next);
  return next;
}

function addPlayerAppearance(
  stats: MutablePlayerGameweekStats,
  fixtureId: Id<"fantasyFixtures">,
  rules: ScoringRuleValues,
) {
  const fixtureKey = String(fixtureId);
  if (stats.appearanceFixtureKeys.has(fixtureKey)) return;

  stats.appearanceFixtureKeys.add(fixtureKey);
  stats.appearances += 1;
  stats.points += rules.appearance;
}

async function findGameweekByNumber(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"fantasySeasons">,
  gameweekNumber: number,
) {
  return await ctx.db
    .query("fantasyGameweeks")
    .withIndex("by_season_number", (q) =>
      q.eq("seasonId", seasonId).eq("number", gameweekNumber),
    )
    .first();
}

async function ensureGameweekSquadSnapshots(
  ctx: MutationCtx,
  season: Doc<"fantasySeasons">,
  gameweek: Doc<"fantasyGameweeks">,
  now: number,
  cutoffAt?: number,
) {
  const [existingSnapshots, fantasyTeams] = await Promise.all([
    ctx.db
      .query("fantasyGameweekSquadPicks")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect(),
    ctx.db
      .query("fantasyTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
  ]);

  const fantasyTeamsById = new Map(
    fantasyTeams.map((fantasyTeam) => [fantasyTeam._id, fantasyTeam]),
  );
  const snapshotCutoffAt =
    cutoffAt ?? getFantasyGameweekParticipationCutoffAt(gameweek);
  const snapshottedTeamIds = new Set(
    existingSnapshots.map((snapshot) => snapshot.fantasyTeamId),
  );
  let createdSnapshots = 0;
  let deletedIneligibleSnapshots = 0;
  let skippedTeamsCreatedAfterCutoff = 0;
  let skippedTeamsWithoutFullSquad = 0;
  let skippedTeamsWithLateChanges = 0;
  let updatedSnapshotMultipliers = 0;

  for (const snapshot of existingSnapshots) {
    const fantasyTeam = fantasyTeamsById.get(snapshot.fantasyTeamId);
    if (
      !fantasyTeam ||
      !canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
    ) {
      await ctx.db.delete(snapshot._id);
      snapshottedTeamIds.delete(snapshot.fantasyTeamId);
      deletedIneligibleSnapshots += 1;
      continue;
    }

    const expectedMultiplier = getPointsMultiplierForSquadRole(
      snapshot.squadRole,
    );
    if (Math.abs(snapshot.pointsMultiplier - expectedMultiplier) < 0.001) {
      continue;
    }

    await ctx.db.patch(snapshot._id, {
      pointsMultiplier: expectedMultiplier,
      updatedAt: now,
    });
    updatedSnapshotMultipliers += 1;
  }

  for (const fantasyTeam of fantasyTeams) {
    if (snapshottedTeamIds.has(fantasyTeam._id)) continue;
    if (!canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)) {
      skippedTeamsCreatedAfterCutoff += 1;
      continue;
    }

    const picks = await ctx.db
      .query("fantasySquadPicks")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
      .collect();

    if (picks.length !== season.squadSize) {
      skippedTeamsWithoutFullSquad += 1;
      continue;
    }
    if (
      snapshotCutoffAt !== undefined &&
      picks.some((pick) => pick.updatedAt > snapshotCutoffAt)
    ) {
      skippedTeamsWithLateChanges += 1;
      continue;
    }

    for (const pick of picks) {
      const squadRole =
        pick.squadRole ?? getSquadRoleForRosterSlot(pick.rosterSlot);
      await ctx.db.insert("fantasyGameweekSquadPicks", {
        seasonId: season._id,
        gameweekId: gameweek._id,
        fantasyTeamId: fantasyTeam._id,
        playerId: pick.playerId,
        rosterSlot: pick.rosterSlot,
        isStarter: pick.isStarter,
        squadRole,
        pointsMultiplier: getPointsMultiplierForSquadRole(squadRole),
        isCaptain: pick.isCaptain,
        isViceCaptain: pick.isViceCaptain,
        createdAt: now,
        updatedAt: now,
      });
      createdSnapshots += 1;
    }
  }

  return {
    createdSnapshots,
    deletedIneligibleSnapshots,
    existingSnapshots: existingSnapshots.length,
    skippedTeamsCreatedAfterCutoff,
    skippedTeamsWithoutFullSquad,
    skippedTeamsWithLateChanges,
    totalSnapshots:
      existingSnapshots.length - deletedIneligibleSnapshots + createdSnapshots,
    updatedSnapshotMultipliers,
  };
}

async function getFantasyTeamIdsWithFullGameweekSnapshot(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"fantasySeasons">,
  gameweek: Doc<"fantasyGameweeks">,
) {
  const [snapshots, fantasyTeams] = await Promise.all([
    ctx.db
      .query("fantasyGameweekSquadPicks")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect(),
    ctx.db
      .query("fantasyTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
  ]);
  const fantasyTeamsById = new Map(
    fantasyTeams.map((fantasyTeam) => [fantasyTeam._id, fantasyTeam]),
  );
  const snapshotCountsByTeamId = new Map<Id<"fantasyTeams">, number>();

  for (const snapshot of snapshots) {
    if (snapshot.seasonId !== season._id) continue;

    const fantasyTeam = fantasyTeamsById.get(snapshot.fantasyTeamId);
    if (
      !fantasyTeam ||
      !canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
    ) {
      continue;
    }

    snapshotCountsByTeamId.set(
      snapshot.fantasyTeamId,
      (snapshotCountsByTeamId.get(snapshot.fantasyTeamId) ?? 0) + 1,
    );
  }

  return new Set(
    Array.from(snapshotCountsByTeamId.entries())
      .filter(([, count]) => count === season.squadSize)
      .map(([fantasyTeamId]) => fantasyTeamId),
  );
}

async function grantDeadlineFreeTransfers(
  ctx: MutationCtx,
  season: Doc<"fantasySeasons">,
  gameweek: Doc<"fantasyGameweeks">,
  now: number,
) {
  if (gameweek.freeTransfersGrantedAt) return 0;

  const fantasyTeamIds = await getFantasyTeamIdsWithFullGameweekSnapshot(
    ctx,
    season,
    gameweek,
  );
  const freeTransfersToGrant = getSeasonFreeTransfersPerGameweek(season);
  const maxFreeTransfers = getSeasonMaxFreeTransfers(season);
  let grantedTeams = 0;

  for (const fantasyTeamId of fantasyTeamIds) {
    const fantasyTeam = await ctx.db.get(fantasyTeamId);
    if (!fantasyTeam || fantasyTeam.seasonId !== season._id) continue;

    await ctx.db.patch(fantasyTeam._id, {
      freeTransfers: Math.min(
        maxFreeTransfers,
        (fantasyTeam.freeTransfers ?? 0) + freeTransfersToGrant,
      ),
      updatedAt: now,
    });
    grantedTeams += 1;
  }

  await ctx.db.patch(gameweek._id, {
    freeTransfersGrantedAt: now,
    updatedAt: now,
  });

  return grantedTeams;
}

async function processSeasonDeadlineRollovers(
  ctx: MutationCtx,
  season: Doc<"fantasySeasons">,
  now: number,
) {
  const gameweeks = await getSeasonGameweeks(ctx, season._id);
  let createdSnapshots = 0;
  let grantedTeams = 0;
  let processedGameweeks = 0;
  let latestProcessedGameweek: Doc<"fantasyGameweeks"> | null = null;

  for (const gameweek of gameweeks) {
    if (!gameweek.deadlineAt || gameweek.deadlineAt > now) continue;
    if (gameweek.status === "completed") continue;

    const needsRollover =
      gameweek.status === "upcoming" ||
      gameweek.status === "open" ||
      !gameweek.freeTransfersGrantedAt;
    if (!needsRollover) continue;

    const snapshotState = await ensureGameweekSquadSnapshots(
      ctx,
      season,
      gameweek,
      now,
      gameweek.deadlineAt,
    );
    const freshGameweek = (await ctx.db.get(gameweek._id)) ?? gameweek;
    const nextGrantedTeams = await grantDeadlineFreeTransfers(
      ctx,
      season,
      freshGameweek,
      now,
    );

    if (freshGameweek.status !== "live") {
      await ctx.db.patch(freshGameweek._id, {
        status: "live",
        updatedAt: now,
      });
      await schedulePushToAllUsers(
        ctx,
        {
          gameweekId: freshGameweek._id,
          gameweekName: freshGameweek.name,
          gameweekNumber: freshGameweek.number,
          key: `deadline-passed:${freshGameweek._id}`,
          skipIfGameweekCompleted: true,
          type: "deadline_passed",
          title: "Тур live",
          body: `${freshGameweek.name} live. Стежте за оновленнями результатів у застосунку.`,
        },
        GAMEWEEK_LIVE_PUSH_DELAY_MS,
      );
    }

    createdSnapshots += snapshotState.createdSnapshots;
    grantedTeams += nextGrantedTeams;
    processedGameweeks += 1;
    latestProcessedGameweek = gameweek;
  }

  const nextGameweek = latestProcessedGameweek
    ? findEditableGameweekFromList(
        gameweeks,
        now,
        latestProcessedGameweek.number,
      )
    : findEditableGameweekFromList(gameweeks, now);

  if (nextGameweek) {
    if (season.currentGameweekId !== nextGameweek._id) {
      await ctx.db.patch(season._id, {
        currentGameweekId: nextGameweek._id,
        updatedAt: now,
      });
    }
    if (nextGameweek.status === "upcoming") {
      await ctx.db.patch(nextGameweek._id, {
        status: "open",
        updatedAt: now,
      });
    }
  }

  return {
    createdSnapshots,
    currentGameweekId: nextGameweek?._id ?? season.currentGameweekId ?? null,
    grantedTeams,
    processedGameweeks,
  };
}

function getSnapshotContribution(
  snapshot: Doc<"fantasyGameweekSquadPicks"> | undefined,
  statsByPlayerId: Map<Id<"fantasyPlayers">, MutablePlayerGameweekStats>,
) {
  if (!snapshot) return 0;
  return (
    (statsByPlayerId.get(snapshot.playerId)?.points ?? 0) *
    snapshot.pointsMultiplier
  );
}

function didSnapshotPlayerAppear(
  snapshot: Doc<"fantasyGameweekSquadPicks"> | undefined,
  statsByPlayerId: Map<Id<"fantasyPlayers">, MutablePlayerGameweekStats>,
) {
  if (!snapshot) return false;
  return (statsByPlayerId.get(snapshot.playerId)?.appearances ?? 0) > 0;
}

async function calculateFantasyTeamTotalPoints(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"fantasySeasons">,
  fantasyTeamId: Id<"fantasyTeams">,
) {
  const [scores, deductions, fantasyTeam, gameweeks] = await Promise.all([
    ctx.db
      .query("fantasyTeamGameweekScores")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeamId))
      .collect(),
    ctx.db
      .query("fantasyPointDeductions")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeamId))
      .collect(),
    ctx.db.get(fantasyTeamId),
    getSeasonGameweeks(ctx, seasonId),
  ]);
  const gameweeksById = new Map(
    gameweeks.map((gameweek) => [gameweek._id, gameweek]),
  );
  const scoredPoints = scores.reduce((sum, score) => {
    if (score.seasonId !== seasonId || !score.participated) return sum;
    const gameweek = gameweeksById.get(score.gameweekId);
    if (
      fantasyTeam &&
      gameweek &&
      !canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
    ) {
      return sum;
    }
    return sum + getFiniteFantasyNumber(score.points);
  }, 0);
  const deductedPoints = deductions.reduce((sum, deduction) => {
    if (deduction.seasonId !== seasonId) return sum;
    return sum + getFiniteFantasyNumber(deduction.points);
  }, 0);

  return roundFantasyPoints(scoredPoints - deductedPoints);
}

async function syncFantasyTeamTotalPoints(
  ctx: MutationCtx,
  fantasyTeam: Doc<"fantasyTeams">,
  now: number,
) {
  const totalPoints = await calculateFantasyTeamTotalPoints(
    ctx,
    fantasyTeam.seasonId,
    fantasyTeam._id,
  );
  await ctx.db.patch(fantasyTeam._id, {
    totalPoints,
    updatedAt: now,
  });

  return totalPoints;
}

function getPlayerGameweekStatsKey(
  gameweekId: Id<"fantasyGameweeks">,
  playerId: Id<"fantasyPlayers">,
) {
  return `${gameweekId}:${playerId}`;
}

function getStoredPlayerStatAppearances(
  stat: Doc<"fantasyPlayerGameweekStats"> | undefined,
) {
  if (!stat) return 0;
  return (
    stat.appearances ?? (stat.minutes !== undefined && stat.minutes > 0 ? 1 : 0)
  );
}

function didStoredSnapshotPlayerAppear(
  snapshot:
    | Pick<Doc<"fantasyGameweekSquadPicks">, "gameweekId" | "playerId">
    | undefined,
  statsByGameweekAndPlayerId: Map<string, Doc<"fantasyPlayerGameweekStats">>,
) {
  if (!snapshot) return false;
  const stat = statsByGameweekAndPlayerId.get(
    getPlayerGameweekStatsKey(snapshot.gameweekId, snapshot.playerId),
  );
  return getStoredPlayerStatAppearances(stat) > 0;
}

async function recalculateGameweekScoresInternal(
  ctx: MutationCtx,
  season: Doc<"fantasySeasons">,
  gameweek: Doc<"fantasyGameweeks">,
  now: number,
) {
  const scoringRules = getScoringRuleValues(
    await getSeasonScoringRules(ctx, season._id),
  );
  const [fixtures, players, fantasyTeams] = await Promise.all([
    ctx.db
      .query("fantasyFixtures")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect(),
    ctx.db
      .query("fantasyPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
  ]);
  const playerById = new Map(players.map((player) => [player._id, player]));
  const scoringFixtures = fixtures.filter(isFixtureScoredForFantasy);
  const statsByPlayerId = new Map<
    Id<"fantasyPlayers">,
    MutablePlayerGameweekStats
  >();
  let skippedEventsWithoutPlayer = 0;
  let updatedEventPoints = 0;

  const [lineupLists, eventLists] = await Promise.all([
    Promise.all(
      scoringFixtures.map((fixture) =>
        ctx.db
          .query("fantasyFixtureLineups")
          .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
          .collect(),
      ),
    ),
    Promise.all(
      scoringFixtures.map((fixture) =>
        ctx.db
          .query("fantasyFixtureEvents")
          .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
          .collect(),
      ),
    ),
  ]);

  for (const [fixtureIndex, fixture] of scoringFixtures.entries()) {
    for (const lineup of lineupLists[fixtureIndex] ?? []) {
      if (!lineup.playerId) continue;
      const player = playerById.get(lineup.playerId);
      if (!player) continue;

      addPlayerAppearance(
        getMutablePlayerGameweekStats(statsByPlayerId, player._id),
        fixture._id,
        scoringRules,
      );
    }

    for (const event of eventLists[fixtureIndex] ?? []) {
      if (!event.playerId) {
        skippedEventsWithoutPlayer += 1;
        continue;
      }
      const player = playerById.get(event.playerId);
      if (!player) {
        skippedEventsWithoutPlayer += 1;
        continue;
      }

      const playerStats = getMutablePlayerGameweekStats(
        statsByPlayerId,
        player._id,
      );
      addPlayerAppearance(playerStats, fixture._id, scoringRules);

      if (event.type === "goal") playerStats.goals += 1;
      if (event.type === "assist") playerStats.assists += 1;
      if (event.type === "yellow_card") playerStats.yellowCards += 1;
      if (event.type === "second_yellow_red") {
        playerStats.redCards += 1;
        playerStats.secondYellowRedCards += 1;
      }
      if (event.type === "red_card") playerStats.redCards += 1;
      if (event.type === "own_goal") playerStats.ownGoals += 1;
      if (event.type === "penalty_missed") playerStats.penaltiesMissed += 1;
      if (event.type === "penalty_saved") playerStats.penaltiesSaved += 1;

      const eventPoints = getFixtureEventPoints(
        event.type,
        player,
        scoringRules,
      );
      playerStats.points += eventPoints;
      if (
        event.points !== eventPoints ||
        event.gameweekId !== gameweek._id ||
        event.seasonId !== season._id
      ) {
        await ctx.db.patch(event._id, {
          gameweekId: gameweek._id,
          points: eventPoints,
          seasonId: season._id,
          updatedAt: now,
        });
        updatedEventPoints += 1;
      }
    }

    if (
      fixture.status !== "completed" ||
      fixture.homeScore === undefined ||
      fixture.awayScore === undefined
    )
      continue;

    for (const player of players) {
      if (!player.clubId) continue;

      const isHomePlayer = fixture.homeClubId === player.clubId;
      const isAwayPlayer = fixture.awayClubId === player.clubId;
      if (!isHomePlayer && !isAwayPlayer) continue;

      const playerStats = statsByPlayerId.get(player._id);
      if (!playerStats?.appearanceFixtureKeys.has(String(fixture._id)))
        continue;

      const teamGoalsScored = isHomePlayer
        ? fixture.homeScore
        : fixture.awayScore;
      const goalsConceded = isHomePlayer
        ? fixture.awayScore
        : fixture.homeScore;
      playerStats.goalsConceded += goalsConceded;
      playerStats.teamGoalsScored += teamGoalsScored;
      if (goalsConceded === 0) playerStats.cleanSheets += 1;
    }
  }

  const [existingPlayerStats, existingTeamScores] = await Promise.all([
    ctx.db
      .query("fantasyPlayerGameweekStats")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect(),
    ctx.db
      .query("fantasyTeamGameweekScores")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect(),
  ]);

  for (const stat of existingPlayerStats) await ctx.db.delete(stat._id);
  for (const score of existingTeamScores) await ctx.db.delete(score._id);

  for (const [playerId, stats] of statsByPlayerId) {
    const player = playerById.get(playerId);
    await ctx.db.insert("fantasyPlayerGameweekStats", {
      seasonId: season._id,
      gameweekId: gameweek._id,
      playerId,
      clubId: player?.clubId,
      appearances: stats.appearances,
      assists: stats.assists,
      cleanSheet: stats.cleanSheets > 0,
      cleanSheets: stats.cleanSheets,
      goals: stats.goals,
      goalsConceded: stats.goalsConceded,
      ownGoals: stats.ownGoals,
      penaltiesMissed: stats.penaltiesMissed,
      penaltiesSaved: stats.penaltiesSaved,
      points: Number(stats.points.toFixed(2)),
      redCards: stats.redCards,
      saves: stats.saves,
      secondYellowRedCards: stats.secondYellowRedCards,
      teamGoalsConcededPoints: Number(stats.teamGoalsConcededPoints.toFixed(2)),
      teamGoalsScored: stats.teamGoalsScored,
      teamGoalsScoredPoints: Number(stats.teamGoalsScoredPoints.toFixed(2)),
      yellowCards: stats.yellowCards,
      createdAt: now,
      updatedAt: now,
    });
  }

  const snapshotState = await ensureGameweekSquadSnapshots(
    ctx,
    season,
    gameweek,
    now,
  );
  const [snapshots, otherTeamGameweekScores, gameweeks] = await Promise.all([
    ctx.db
      .query("fantasyGameweekSquadPicks")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect(),
    ctx.db
      .query("fantasyTeamGameweekScores")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    getSeasonGameweeks(ctx, season._id),
  ]);
  const fantasyTeamsById = new Map(
    fantasyTeams.map((fantasyTeam) => [fantasyTeam._id, fantasyTeam]),
  );
  const gameweeksById = new Map(
    gameweeks.map((seasonGameweek) => [seasonGameweek._id, seasonGameweek]),
  );
  const snapshotsByTeamId = new Map<
    Id<"fantasyTeams">,
    Doc<"fantasyGameweekSquadPicks">[]
  >();
  for (const snapshot of snapshots) {
    if (snapshot.seasonId !== season._id) continue;
    const current = snapshotsByTeamId.get(snapshot.fantasyTeamId) ?? [];
    current.push(snapshot);
    snapshotsByTeamId.set(snapshot.fantasyTeamId, current);
  }
  const previousPointsByTeamId = new Map<Id<"fantasyTeams">, number>();
  for (const score of otherTeamGameweekScores) {
    if (!score.participated || score.gameweekId === gameweek._id) continue;
    const scoringTeam = fantasyTeamsById.get(score.fantasyTeamId);
    const scoringGameweek = gameweeksById.get(score.gameweekId);
    if (
      !scoringTeam ||
      !scoringGameweek ||
      !canFantasyTeamParticipateInGameweek(scoringTeam, scoringGameweek)
    ) {
      continue;
    }
    previousPointsByTeamId.set(
      score.fantasyTeamId,
      (previousPointsByTeamId.get(score.fantasyTeamId) ?? 0) +
        getFiniteFantasyNumber(score.points),
    );
  }

  let participatedTeams = 0;
  for (const fantasyTeam of fantasyTeams) {
    const teamSnapshots = (snapshotsByTeamId.get(fantasyTeam._id) ?? []).sort(
      (a, b) => a.rosterSlot - b.rosterSlot,
    );
    const canParticipate = canFantasyTeamParticipateInGameweek(
      fantasyTeam,
      gameweek,
    );
    const participated =
      canParticipate && teamSnapshots.length === season.squadSize;
    const rawBasePoints = participated
      ? teamSnapshots.reduce(
          (sum, snapshot) =>
            sum + getSnapshotContribution(snapshot, statsByPlayerId),
          0,
        )
      : 0;
    const captain = teamSnapshots.find((snapshot) => snapshot.isCaptain);
    const viceCaptain = teamSnapshots.find(
      (snapshot) => snapshot.isViceCaptain,
    );
    const rawCaptainBonusPoints = participated
      ? didSnapshotPlayerAppear(captain, statsByPlayerId)
        ? getSnapshotContribution(captain, statsByPlayerId)
        : didSnapshotPlayerAppear(viceCaptain, statsByPlayerId)
          ? getSnapshotContribution(viceCaptain, statsByPlayerId)
          : 0
      : 0;
    const basePoints = Number(rawBasePoints.toFixed(2));
    const captainBonusPoints = Number(rawCaptainBonusPoints.toFixed(2));
    const points = participated
      ? Number((basePoints + captainBonusPoints).toFixed(2))
      : 0;
    const totalPointsAfterGameweek = Number(
      ((previousPointsByTeamId.get(fantasyTeam._id) ?? 0) + points).toFixed(2),
    );

    if (participated) participatedTeams += 1;
    await ctx.db.insert("fantasyTeamGameweekScores", {
      seasonId: season._id,
      gameweekId: gameweek._id,
      fantasyTeamId: fantasyTeam._id,
      points,
      basePoints,
      captainBonusPoints,
      transferPenaltyPoints: 0,
      totalPointsAfterGameweek,
      participated,
      createdAt: now,
      updatedAt: now,
    });
    await syncFantasyTeamTotalPoints(ctx, fantasyTeam, now);
  }

  return {
    completedFixtures: scoringFixtures.filter(
      (fixture) => fixture.status === "completed",
    ).length,
    fantasyTeams: fantasyTeams.length,
    liveFixtures: scoringFixtures.filter((fixture) => fixture.status === "live")
      .length,
    participatedTeams,
    playerStats: statsByPlayerId.size,
    scoringFixtures: scoringFixtures.length,
    skippedEventsWithoutPlayer,
    snapshotState,
    teamScores: fantasyTeams.length,
    updatedEventPoints,
  };
}

async function applyGameweekPriceChanges(
  ctx: MutationCtx,
  season: Doc<"fantasySeasons">,
  gameweek: Doc<"fantasyGameweeks">,
  now: number,
) {
  const [
    players,
    currentGameweekStats,
    seasonPlayerStats,
    gameweeks,
    fixtures,
    existingPriceHistories,
  ] =
    await Promise.all([
      ctx.db
        .query("fantasyPlayers")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerGameweekStats")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerGameweekStats")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyGameweeks")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyFixtures")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerPriceHistory")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
    ]);

  if (!areGameweekFixturesReadyForPriceChanges(fixtures)) {
    return {
      changedPlayers: 0,
      decreasedPlayers: 0,
      increasedPlayers: 0,
      skippedAlreadyApplied: 0,
      skippedBlankPlayers: 0,
      skippedGameweekIncomplete: true,
      skippedValueMarketPlayers: 0,
      unchangedPlayers: players.length,
    };
  }

  const alreadyAppliedPlayerIds = new Set(
    existingPriceHistories
      .filter((history) => history.reason === "gameweek_recalculation")
      .map((history) => history.playerId),
  );
  const currentStatsByPlayerId = new Map(
    currentGameweekStats.map((stat) => [stat.playerId, stat]),
  );
  const gameweekIdsForValue = new Set(
    gameweeks
      .filter((item) => item.number <= gameweek.number)
      .map((item) => item._id),
  );
  const seasonStatsByPlayerId = new Map<
    Id<"fantasyPlayers">,
    { appearances: number; points: number }
  >();
  for (const stat of seasonPlayerStats) {
    if (!gameweekIdsForValue.has(stat.gameweekId)) continue;

    const current = seasonStatsByPlayerId.get(stat.playerId) ?? {
      appearances: 0,
      points: 0,
    };
    current.appearances += getStoredPlayerStatAppearances(stat);
    current.points += stat.points;
    seasonStatsByPlayerId.set(stat.playerId, current);
  }

  const valueScores = players
    .map((player) => {
      if (player.status === "left") return 0;
      const stats = seasonStatsByPlayerId.get(player._id);
      if (!stats || stats.appearances <= 0 || stats.points <= 0) return 0;
      return getFantasyPlayerValueScore(stats.points, player.price);
    })
    .filter((value) => value > 0);
  const medianValueScore = getMedianFantasyValueScore(valueScores);
  const priceChangeLimit = getSeasonPriceChangeLimit(season);
  let changedPlayers = 0;
  let decreasedPlayers = 0;
  let increasedPlayers = 0;
  let skippedBlankPlayers = 0;
  let skippedValueMarketPlayers = 0;
  let unchangedPlayers = 0;

  for (const player of players) {
    if (player.status === "left") {
      unchangedPlayers += 1;
      continue;
    }
    if (alreadyAppliedPlayerIds.has(player._id)) {
      unchangedPlayers += 1;
      continue;
    }

    const currentStat = currentStatsByPlayerId.get(player._id);
    if (!currentStat || getStoredPlayerStatAppearances(currentStat) <= 0) {
      skippedBlankPlayers += 1;
      continue;
    }

    const seasonStats = seasonStatsByPlayerId.get(player._id);
    if (
      !seasonStats ||
      seasonStats.appearances <= 0 ||
      medianValueScore === null
    ) {
      skippedValueMarketPlayers += 1;
      unchangedPlayers += 1;
      continue;
    }

    const rawDelta = getValueBasedGameweekPriceDelta({
      appearances: seasonStats.appearances,
      medianValueScore,
      points: seasonStats.points,
      price: player.price,
    });
    const limitedDelta = Math.max(
      -priceChangeLimit,
      Math.min(priceChangeLimit, rawDelta),
    );
    const oldPrice = roundFantasyMoney(player.price);
    const newPrice = clampFantasyPrice(
      roundFantasyPrice(oldPrice + limitedDelta),
    );
    const delta = roundFantasyMoney(newPrice - oldPrice);

    if (Math.abs(delta) < 0.001) {
      unchangedPlayers += 1;
      continue;
    }

    await ctx.db.patch(player._id, {
      price: newPrice,
      updatedAt: now,
    });
    await ctx.db.insert("fantasyPlayerPriceHistory", {
      seasonId: season._id,
      playerId: player._id,
      gameweekId: gameweek._id,
      oldPrice,
      newPrice,
      delta,
      reason: "gameweek_recalculation",
      createdAt: now,
    });

    changedPlayers += 1;
    if (delta > 0) increasedPlayers += 1;
    if (delta < 0) decreasedPlayers += 1;
  }

  return {
    changedPlayers,
    decreasedPlayers,
    increasedPlayers,
    skippedAlreadyApplied: alreadyAppliedPlayerIds.size,
    skippedBlankPlayers,
    skippedGameweekIncomplete: false,
    skippedValueMarketPlayers,
    unchangedPlayers,
  };
}

async function markGameweekNonParticipantsDoubtfulInternal(
  ctx: MutationCtx,
  season: Doc<"fantasySeasons">,
  gameweek: Doc<"fantasyGameweeks">,
  now: number,
  options: { dryRun?: boolean } = {},
) {
  const [fixtures, players, clubs] = await Promise.all([
    ctx.db
      .query("fantasyFixtures")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect(),
    ctx.db
      .query("fantasyPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyClubs")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
  ]);
  const completedFixtures = fixtures.filter(
    (fixture) => fixture.status === "completed",
  );
  const [lineupLists, eventLists] = await Promise.all([
    Promise.all(
      completedFixtures.map((fixture) =>
        ctx.db
          .query("fantasyFixtureLineups")
          .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
          .collect(),
      ),
    ),
    Promise.all(
      completedFixtures.map((fixture) =>
        ctx.db
          .query("fantasyFixtureEvents")
          .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
          .collect(),
      ),
    ),
  ]);

  const eligibleClubIds = new Set<Id<"fantasyClubs">>();
  const appearedPlayerIds = new Set<Id<"fantasyPlayers">>();
  const skippedFixturesWithoutLineups: Array<{
    awayClubName: string;
    fixtureId: Id<"fantasyFixtures">;
    homeClubName: string;
  }> = [];

  completedFixtures.forEach((fixture, index) => {
    const lineups = lineupLists[index] ?? [];
    const events = eventLists[index] ?? [];
    const hasHomeLineups = lineups.some((lineup) => lineup.side === "home");
    const hasAwayLineups = lineups.some((lineup) => lineup.side === "away");

    if (!hasHomeLineups && !hasAwayLineups) {
      skippedFixturesWithoutLineups.push({
        fixtureId: fixture._id,
        homeClubName: fixture.homeClubName,
        awayClubName: fixture.awayClubName,
      });
      return;
    }

    if (fixture.homeClubId && hasHomeLineups) {
      eligibleClubIds.add(fixture.homeClubId);
    }
    if (fixture.awayClubId && hasAwayLineups) {
      eligibleClubIds.add(fixture.awayClubId);
    }

    for (const lineup of lineups) {
      if (lineup.playerId) appearedPlayerIds.add(lineup.playerId);
    }
    for (const event of events) {
      if (event.playerId) appearedPlayerIds.add(event.playerId);
    }
  });

  const clubsById = new Map(clubs.map((club) => [club._id, club]));
  const statusDetails = normalizeFantasyPlayerStatusDetails(
    FANTASY_NON_PARTICIPATION_STATUS_DETAILS,
    now,
  );
  const statusContext = { currentGameweekNumber: gameweek.number };
  const targets: Doc<"fantasyPlayers">[] = [];
  const clearedPlayers: Doc<"fantasyPlayers">[] = [];
  const skippedSuspendedPlayers: Doc<"fantasyPlayers">[] = [];

  for (const player of players) {
    if (!player.clubId || !eligibleClubIds.has(player.clubId)) continue;

    const appeared = appearedPlayerIds.has(player._id);
    const suspendedForGameweek = isFantasyPlayerSuspendedForGameweek(
      player,
      statusContext,
    );
    const hasAutoNonParticipationStatus =
      player.status === "doubtful" &&
      isAutomaticNonParticipationStatusDetails(player.statusDetails);

    if (appeared || suspendedForGameweek) {
      if (hasAutoNonParticipationStatus) {
        clearedPlayers.push(player);
      }
      if (!appeared && suspendedForGameweek) {
        skippedSuspendedPlayers.push(player);
      }
      continue;
    }

    if (player.status !== "active" && player.status !== "doubtful") {
      continue;
    }
    if (
      player.status === "doubtful" &&
      hasCurrentNonParticipationStatusDetails(player.statusDetails)
    ) {
      continue;
    }

    targets.push(player);
  }

  const sortedTargets = targets.sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  const sortedClearedPlayers = clearedPlayers.sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  const sortedSkippedSuspendedPlayers = skippedSuspendedPlayers.sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  if (!options.dryRun) {
    for (const player of sortedTargets) {
      await ctx.db.patch(player._id, {
        status: "doubtful",
        statusDetails,
        updatedAt: now,
      });
    }
    for (const player of sortedClearedPlayers) {
      await ctx.db.patch(player._id, {
        status: "active",
        statusDetails: undefined,
        updatedAt: now,
      });
    }
  }

  const toPlayerResult = (player: Doc<"fantasyPlayers">) => ({
    playerId: player._id,
    displayName: player.displayName,
    clubName: player.clubId
      ? (clubsById.get(player.clubId)?.name ?? null)
      : null,
  });

  return {
    dryRun: options.dryRun ?? false,
    clearedAutomaticDoubtful: options.dryRun ? 0 : sortedClearedPlayers.length,
    clearedAutomaticDoubtfulPlayers: sortedClearedPlayers.map(toPlayerResult),
    eligibleClubs: [...eligibleClubIds]
      .map((clubId) => clubsById.get(clubId)?.name ?? String(clubId))
      .sort((a, b) => a.localeCompare(b)),
    gameweekId: gameweek._id,
    gameweekNumber: gameweek.number,
    skippedFixturesWithoutLineups,
    skippedSuspended: sortedSkippedSuspendedPlayers.length,
    skippedSuspendedPlayers: sortedSkippedSuspendedPlayers.map(toPlayerResult),
    targetCount: sortedTargets.length,
    targets: sortedTargets.map(toPlayerResult),
    updated: options.dryRun ? 0 : sortedTargets.length,
  };
}

async function finalizeGameweekPlayerStatuses(
  ctx: MutationCtx,
  season: Doc<"fantasySeasons">,
  gameweek: Doc<"fantasyGameweeks">,
  now: number,
) {
  const suspensionSync = await syncFantasyPlayerSuspensionsForSeason(
    ctx,
    season._id,
    now,
  );
  const nonParticipantStatusSync =
    await markGameweekNonParticipantsDoubtfulInternal(
      ctx,
      season,
      gameweek,
      now,
    );

  return { nonParticipantStatusSync, suspensionSync };
}

async function completeGameweekIfAllFixturesResolved(
  ctx: MutationCtx,
  gameweek: Doc<"fantasyGameweeks">,
  now: number,
) {
  const fixtures = await ctx.db
    .query("fantasyFixtures")
    .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
    .collect();
  const activeFixtures = fixtures.filter(
    (fixture) =>
      fixture.status !== "cancelled" && fixture.status !== "postponed",
  );
  const allFixturesCompleted =
    activeFixtures.length > 0 &&
    activeFixtures.every((fixture) => fixture.status === "completed");

  if (!allFixturesCompleted) {
    return { activeFixtures: activeFixtures.length, completed: false };
  }

  const season = await ctx.db.get(gameweek.seasonId);
  if (!season) {
    return { activeFixtures: activeFixtures.length, completed: false };
  }

  const wasCompleted = gameweek.status === "completed";
  if (!wasCompleted) {
    await ctx.db.patch(gameweek._id, {
      completedAt: gameweek.completedAt ?? now,
      status: "completed",
      updatedAt: now,
    });
    await schedulePushToAllUsers(ctx, {
      gameweekId: gameweek._id,
      gameweekName: gameweek.name,
      gameweekNumber: gameweek.number,
      key: `gameweek-results-ready:${gameweek._id}`,
      type: "gameweek_results_ready",
      title: "Підсумки туру готові",
      body: `${gameweek.name} завершено. Очки вже підраховані, можна перевірити результати.`,
    });
  }

  const playerStatusSync = await finalizeGameweekPlayerStatuses(
    ctx,
    season,
    gameweek,
    now,
  );

  return {
    activeFixtures: activeFixtures.length,
    completed: !wasCompleted,
    playerStatusSync,
  };
}

async function refreshGameweekAfterFixtureChange(
  ctx: MutationCtx,
  fixture: Doc<"fantasyFixtures">,
  now: number,
) {
  if (!fixture.gameweekId) return null;

  const [season, gameweek] = await Promise.all([
    ctx.db.get(fixture.seasonId),
    ctx.db.get(fixture.gameweekId),
  ]);
  if (!season || !gameweek) return null;
  if (typeof gameweek.deadlineAt === "number" && now < gameweek.deadlineAt) {
    return { skippedBeforeDeadline: true };
  }

  await processSeasonDeadlineRollovers(ctx, season, now);
  const freshGameweek = (await ctx.db.get(gameweek._id)) ?? gameweek;
  const scoring = await recalculateGameweekScoresInternal(
    ctx,
    season,
    freshGameweek,
    now,
  );
  const priceChanges = await applyGameweekPriceChanges(
    ctx,
    season,
    freshGameweek,
    now,
  );

  const completion = await completeGameweekIfAllFixturesResolved(
    ctx,
    freshGameweek,
    now,
  );

  return { completion, priceChanges, scoring };
}

export const fixtureDetails = query({
  args: {
    fixtureId: v.id("fantasyFixtures"),
  },
  handler: async (ctx, args) => {
    const fixture = await ctx.db.get(args.fixtureId);
    if (!fixture) return null;

    const season = await ctx.db.get(fixture.seasonId);
    if (
      !season ||
      !(await currentUserCanAccessFantasySeason(ctx, season))
    ) {
      return null;
    }

    const [homeClub, awayClub, gameweek, lineups, events] = await Promise.all([
      fixture.homeClubId
        ? ctx.db.get(fixture.homeClubId)
        : Promise.resolve(null),
      fixture.awayClubId
        ? ctx.db.get(fixture.awayClubId)
        : Promise.resolve(null),
      fixture.gameweekId
        ? ctx.db.get(fixture.gameweekId)
        : Promise.resolve(null),
      ctx.db
        .query("fantasyFixtureLineups")
        .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
        .collect(),
      ctx.db
        .query("fantasyFixtureEvents")
        .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
        .collect(),
    ]);
    const playerIds = new Set([
      ...lineups.flatMap((lineup) =>
        lineup.playerId ? [lineup.playerId] : [],
      ),
      ...events.flatMap((event) => (event.playerId ? [event.playerId] : [])),
    ]);
    const players = await Promise.all(
      [...playerIds].map((playerId) => ctx.db.get(playerId)),
    );
    const playersById = new Map(
      players
        .filter((player): player is Doc<"fantasyPlayers"> => Boolean(player))
        .map((player) => [player._id, player]),
    );

    return {
      fixture: {
        id: fixture._id,
        seasonId: fixture.seasonId,
        gameweekId: fixture.gameweekId ?? null,
        externalId: fixture.externalId ?? null,
        sourceUrl: fixture.sourceUrl ?? null,
        homeClubId: fixture.homeClubId ?? null,
        awayClubId: fixture.awayClubId ?? null,
        homeClubName: fixture.homeClubName,
        awayClubName: fixture.awayClubName,
        scheduledAt: fixture.scheduledAt,
        status: fixture.status,
        homeScore: fixture.homeScore ?? null,
        awayScore: fixture.awayScore ?? null,
        venue: fixture.venue ?? null,
      },
      gameweek: gameweek ? toGameweekView(gameweek) : null,
      homeClub: homeClub ? toClubView(homeClub) : null,
      awayClub: awayClub ? toClubView(awayClub) : null,
      lineups: lineups
        .map((lineup) => {
          const player = lineup.playerId
            ? playersById.get(lineup.playerId)
            : null;

          return {
            id: lineup._id,
            clubId: lineup.clubId ?? player?.clubId ?? null,
            playerId: lineup.playerId ?? null,
            playerName: player?.displayName ?? lineup.playerName,
            side: lineup.side,
            jerseyNumber: lineup.jerseyNumber ?? player?.jerseyNumber ?? null,
            position: lineup.position ?? player?.position ?? null,
            isStarter: lineup.isStarter ?? null,
          };
        })
        .sort(
          (a, b) =>
            a.side.localeCompare(b.side) ||
            (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999) ||
            a.playerName.localeCompare(b.playerName),
        ),
      events: events
        .map((event) => {
          const player = event.playerId ? playersById.get(event.playerId) : null;

          return {
            id: event._id,
            gameweekId: event.gameweekId ?? null,
            clubId: event.clubId ?? player?.clubId ?? null,
            playerId: event.playerId ?? null,
            playerName: player?.displayName ?? event.playerName ?? null,
            side: event.side,
            type: event.type,
            minute: event.minute ?? null,
            period: event.period ?? null,
            points: event.points ?? null,
          };
        })
        .sort(
          (a, b) =>
            (a.minute ?? 999) - (b.minute ?? 999) ||
            a.type.localeCompare(b.type),
        ),
    };
  },
});

type PlayerPointLineKind =
  | "appearance"
  | "goal"
  | "assist"
  | "yellow_card"
  | "second_yellow_red"
  | "red_card"
  | "own_goal"
  | "penalty_missed"
  | "penalty_saved"
  | "team_goals_scored"
  | "team_goals_conceded";

type TeamGameweekPickForPoints = {
  gameweekId: Id<"fantasyGameweeks">;
  isCaptain: boolean;
  isStarter: boolean;
  isViceCaptain: boolean;
  pickKey: string;
  playerId: Id<"fantasyPlayers">;
  pointsMultiplier: number;
  rosterSlot: number;
  squadRole: FantasySquadRole;
};

function addPlayerPointLine(
  lines: Array<{
    count: number | null;
    kind: PlayerPointLineKind;
    points: number;
  }>,
  kind: PlayerPointLineKind,
  count: number | null,
  points: number,
) {
  const roundedPoints = roundFantasyPoints(points);
  if ((count ?? 0) <= 0 && Math.abs(roundedPoints) < 0.001) return;
  lines.push({ count, kind, points: roundedPoints });
}

function buildPlayerPointLines(
  stat: Doc<"fantasyPlayerGameweekStats"> | undefined,
  player: Doc<"fantasyPlayers"> | null,
  rules: ScoringRuleValues,
) {
  if (!stat) return [];

  const lines: Array<{
    count: number | null;
    kind: PlayerPointLineKind;
    points: number;
  }> = [];
  const position = player
    ? toPublicFantasyPlayerPosition(player.position)
    : null;
  const goalPoints =
    position === "goalkeeper" ? rules.goalkeeperGoal : rules.outfieldGoal;
  const assistPoints =
    position === "goalkeeper" ? rules.goalkeeperAssist : rules.outfieldAssist;
  const appearances =
    stat.appearances ??
    (stat.minutes !== undefined && stat.minutes > 0 ? 1 : 0);
  const goals = stat.goals ?? 0;
  const assists = stat.assists ?? 0;
  const yellowCards = stat.yellowCards ?? 0;
  const secondYellowRedCards = stat.secondYellowRedCards ?? 0;
  const redCards = Math.max(0, (stat.redCards ?? 0) - secondYellowRedCards);
  const ownGoals = stat.ownGoals ?? 0;
  const penaltiesMissed = stat.penaltiesMissed ?? 0;
  const penaltiesSaved = stat.penaltiesSaved ?? 0;

  addPlayerPointLine(
    lines,
    "appearance",
    appearances,
    appearances * rules.appearance,
  );
  addPlayerPointLine(lines, "goal", goals, goals * goalPoints);
  addPlayerPointLine(lines, "assist", assists, assists * assistPoints);
  addPlayerPointLine(
    lines,
    "yellow_card",
    yellowCards,
    yellowCards * rules.yellowCard,
  );
  addPlayerPointLine(
    lines,
    "second_yellow_red",
    secondYellowRedCards,
    secondYellowRedCards * rules.secondYellowRedCard,
  );
  addPlayerPointLine(lines, "red_card", redCards, redCards * rules.redCard);
  addPlayerPointLine(lines, "own_goal", ownGoals, ownGoals * rules.ownGoal);
  addPlayerPointLine(
    lines,
    "penalty_missed",
    penaltiesMissed,
    penaltiesMissed * rules.penaltyMissed,
  );
  addPlayerPointLine(
    lines,
    "penalty_saved",
    penaltiesSaved,
    penaltiesSaved * rules.penaltySaved,
  );

  return lines;
}

async function findLatestTeamScoreGameweek(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"fantasySeasons">,
  fantasyTeamId: Id<"fantasyTeams">,
) {
  const [scores, gameweeks, fantasyTeam] = await Promise.all([
    ctx.db
      .query("fantasyTeamGameweekScores")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeamId))
      .collect(),
    getSeasonGameweeks(ctx, season._id),
    ctx.db.get(fantasyTeamId),
  ]);
  if (!fantasyTeam) return null;

  const gameweeksById = new Map(
    gameweeks.map((gameweek) => [gameweek._id, gameweek]),
  );

  return (
    scores
      .filter((score) => score.seasonId === season._id && score.participated)
      .map((score) => gameweeksById.get(score.gameweekId) ?? null)
      .filter(
        (gameweek): gameweek is Doc<"fantasyGameweeks"> =>
          !!gameweek &&
          canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek),
      )
      .sort((a, b) => b.number - a.number)[0] ?? null
  );
}

function findCurrentScoringGameweekFromList(
  season: Doc<"fantasySeasons">,
  gameweeks: Doc<"fantasyGameweeks">[],
) {
  const sortedGameweeks = [...gameweeks].sort((a, b) => a.number - b.number);
  const configuredGameweek = season.currentGameweekId
    ? (sortedGameweeks.find(
        (gameweek) => gameweek._id === season.currentGameweekId,
      ) ?? null)
    : null;
  const liveGameweek =
    sortedGameweeks.find((gameweek) => gameweek.status === "live") ?? null;
  const nextOpenGameweek =
    sortedGameweeks.find(
      (gameweek) =>
        gameweek.status !== "completed" && gameweek.status !== "live",
    ) ?? null;
  const latestCompletedGameweek =
    [...sortedGameweeks]
      .reverse()
      .find((gameweek) => gameweek.status === "completed") ?? null;

  return (
    liveGameweek ??
    latestCompletedGameweek ??
    configuredGameweek ??
    nextOpenGameweek ??
    sortedGameweeks[0] ??
    null
  );
}

function toGameweekSnapshotPickRow(
  snapshot: Doc<"fantasyGameweekSquadPicks">,
): TeamGameweekPickForPoints {
  return {
    gameweekId: snapshot.gameweekId,
    isCaptain: snapshot.isCaptain,
    isStarter: snapshot.isStarter,
    isViceCaptain: snapshot.isViceCaptain,
    pickKey: String(snapshot._id),
    playerId: snapshot.playerId,
    pointsMultiplier: snapshot.pointsMultiplier,
    rosterSlot: snapshot.rosterSlot,
    squadRole: snapshot.squadRole,
  };
}

function toCurrentSquadPickRow(
  pick: Doc<"fantasySquadPicks">,
  gameweekId: Id<"fantasyGameweeks">,
): TeamGameweekPickForPoints {
  const squadRole =
    pick.squadRole ?? getSquadRoleForRosterSlot(pick.rosterSlot);

  return {
    gameweekId,
    isCaptain: pick.isCaptain,
    isStarter: pick.isStarter,
    isViceCaptain: pick.isViceCaptain,
    pickKey: `current:${pick._id}`,
    playerId: pick.playerId,
    pointsMultiplier: getPointsMultiplierForSquadRole(squadRole),
    rosterSlot: pick.rosterSlot,
    squadRole,
  };
}

async function buildFantasyTeamGameweekPointsBreakdown(
  ctx: QueryCtx,
  season: Doc<"fantasySeasons">,
  fantasyTeam: Doc<"fantasyTeams">,
  gameweek: Doc<"fantasyGameweeks"> | null,
  scoringRule?: Doc<"fantasyScoringRules"> | null,
  scoreOverride?: Doc<"fantasyTeamGameweekScores"> | null,
) {
  if (!gameweek || gameweek.seasonId !== season._id) {
    return {
      gameweek: null,
      players: [],
      score: null,
      team: { id: fantasyTeam._id, name: fantasyTeam.name },
      transferPenaltyPoints: 0,
    };
  }

  const [score, snapshots, stats, clubs, resolvedScoringRule] =
    await Promise.all([
      scoreOverride !== undefined
        ? Promise.resolve(scoreOverride)
        : ctx.db
            .query("fantasyTeamGameweekScores")
            .withIndex("by_team_gameweek", (q) =>
              q
                .eq("fantasyTeamId", fantasyTeam._id)
                .eq("gameweekId", gameweek._id),
            )
            .first(),
      ctx.db
        .query("fantasyGameweekSquadPicks")
        .withIndex("by_team_gameweek", (q) =>
          q.eq("fantasyTeamId", fantasyTeam._id).eq("gameweekId", gameweek._id),
        )
        .collect(),
      ctx.db
        .query("fantasyPlayerGameweekStats")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
      ctx.db
        .query("fantasyClubs")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      scoringRule !== undefined
        ? Promise.resolve(scoringRule)
        : getSeasonScoringRules(ctx, season._id),
    ]);
  const canParticipate = canFantasyTeamParticipateInGameweek(
    fantasyTeam,
    gameweek,
  );
  const currentPicks =
    !canParticipate || snapshots.length > 0
      ? []
      : await ctx.db
          .query("fantasySquadPicks")
          .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
          .collect();
  const rules = getScoringRuleValues(resolvedScoringRule);
  const clubsById = new Map(clubs.map((club) => [club._id, club]));
  const statsByPlayerId = new Map(stats.map((stat) => [stat.playerId, stat]));
  const statsByGameweekAndPlayerId = new Map(
    stats.map((stat) => [
      getPlayerGameweekStatsKey(stat.gameweekId, stat.playerId),
      stat,
    ]),
  );
  const pickRows =
    canParticipate && snapshots.length > 0
      ? snapshots.map(toGameweekSnapshotPickRow)
      : canParticipate
        ? currentPicks.map((pick) =>
            toCurrentSquadPickRow(pick, gameweek._id),
          )
        : [];
  const sortedPickRows = [...pickRows].sort(
    (a, b) => a.rosterSlot - b.rosterSlot,
  );
  const players = await Promise.all(
    sortedPickRows.map((pick) => ctx.db.get(pick.playerId)),
  );
  const captain = sortedPickRows.find((pick) => pick.isCaptain);
  const viceCaptain = sortedPickRows.find((pick) => pick.isViceCaptain);
  const bonusSnapshot = canParticipate
    ? didStoredSnapshotPlayerAppear(captain, statsByGameweekAndPlayerId)
      ? captain
      : didStoredSnapshotPlayerAppear(viceCaptain, statsByGameweekAndPlayerId)
        ? viceCaptain
        : null
    : null;

  const playerBreakdowns = sortedPickRows.map((snapshot, index) => {
    const player = players[index] ?? null;
    const stat = statsByPlayerId.get(snapshot.playerId);
    const rawPlayerPoints = canParticipate
      ? roundFantasyPoints(stat?.points ?? 0)
      : 0;
    const rolePoints = roundFantasyPoints(
      rawPlayerPoints * snapshot.pointsMultiplier,
    );
    const captainBonusPoints =
      bonusSnapshot?.pickKey === snapshot.pickKey ? rolePoints : 0;
    const managerPoints = roundFantasyPoints(rolePoints + captainBonusPoints);

    return {
      player: player
        ? {
            id: player._id,
            clubId: player.clubId ?? null,
            clubName: player.clubId
              ? (clubsById.get(player.clubId)?.name ?? null)
              : null,
            displayName: player.displayName,
            firstName: player.firstName ?? null,
            lastName: player.lastName,
            photoThumbnailUrl: player.photoThumbnailUrl ?? null,
            photoUrl: player.photoUrl ?? null,
            position: toPublicFantasyPlayerPosition(player.position),
            price: player.price,
            status: getEffectiveFantasyPlayerStatus(player),
            statusDetails: toFantasyPlayerStatusDetailsView(player),
          }
        : null,
      rosterSlot: snapshot.rosterSlot,
      squadRole: snapshot.squadRole,
      multiplier: snapshot.pointsMultiplier,
      isCaptain: snapshot.isCaptain,
      isViceCaptain: snapshot.isViceCaptain,
      appeared: getStoredPlayerStatAppearances(stat) > 0,
      rawPlayerPoints,
      rolePoints,
      captainBonusPoints,
      managerPoints,
      lines: buildPlayerPointLines(stat, player, rules),
    };
  });

  return {
    gameweek: toGameweekView(gameweek),
    players: playerBreakdowns,
    score:
      score && canParticipate
        ? {
            points: roundFantasyPoints(score.points),
            basePoints: toNullableFantasyPoints(score.basePoints),
            captainBonusPoints: toNullableFantasyPoints(
              score.captainBonusPoints,
            ),
            transferPenaltyPoints: 0,
            totalPointsAfterGameweek: toNullableFantasyPoints(
              score.totalPointsAfterGameweek,
            ),
            participated: score.participated,
          }
        : score
          ? {
              points: 0,
              basePoints: 0,
              captainBonusPoints: 0,
              transferPenaltyPoints: 0,
              totalPointsAfterGameweek: null,
              participated: false,
            }
          : null,
    team: { id: fantasyTeam._id, name: fantasyTeam.name },
    transferPenaltyPoints: 0,
  };
}

export const myGameweekPointsBreakdown = query({
  args: {
    gameweekId: v.optional(v.id("fantasyGameweeks")),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserIfAuthenticated(ctx);
    if (!currentUser?.user) return null;
    const { user } = currentUser;

    const season = await getSeason(ctx);
    if (!season) return null;

    const fantasyTeam = await ctx.db
      .query("fantasyTeams")
      .withIndex("by_user_season", (q) =>
        q.eq("userId", user._id).eq("seasonId", season._id),
      )
      .first();
    if (!fantasyTeam) return null;

    const gameweek = args.gameweekId
      ? await ctx.db.get(args.gameweekId)
      : await findLatestTeamScoreGameweek(ctx, season, fantasyTeam._id);

    return await buildFantasyTeamGameweekPointsBreakdown(
      ctx,
      season,
      fantasyTeam,
      gameweek,
    );
  },
});

export const mySeasonPointsBreakdown = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUserIfAuthenticated(ctx);
    if (!currentUser?.user) return null;
    const { user } = currentUser;

    const season = await getSeason(ctx);
    if (!season) return null;

    const fantasyTeam = await ctx.db
      .query("fantasyTeams")
      .withIndex("by_user_season", (q) =>
        q.eq("userId", user._id).eq("seasonId", season._id),
      )
      .first();
    if (!fantasyTeam) return null;

    const [scores, gameweeks, scoringRule, deductions] = await Promise.all([
      ctx.db
        .query("fantasyTeamGameweekScores")
        .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
        .collect(),
      getSeasonGameweeks(ctx, season._id),
      getSeasonScoringRules(ctx, season._id),
      ctx.db
        .query("fantasyPointDeductions")
        .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
        .collect(),
    ]);
    const gameweeksById = new Map(
      gameweeks.map((gameweek) => [gameweek._id, gameweek]),
    );
    const participatedScores = scores
      .filter((score) => {
        if (score.seasonId !== season._id || !score.participated) {
          return false;
        }
        const gameweek = gameweeksById.get(score.gameweekId);
        return (
          !!gameweek &&
          canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
        );
      })
      .sort((a, b) => {
        const gameweekA = gameweeksById.get(a.gameweekId)?.number ?? 0;
        const gameweekB = gameweeksById.get(b.gameweekId)?.number ?? 0;
        return gameweekB - gameweekA;
      });
    const gameweekBreakdowns = await Promise.all(
      participatedScores.map((score) =>
        buildFantasyTeamGameweekPointsBreakdown(
          ctx,
          season,
          fantasyTeam,
          gameweeksById.get(score.gameweekId) ?? null,
          scoringRule,
          score,
        ),
      ),
    );
    const seasonDeductions = deductions
      .filter((deduction) => deduction.seasonId === season._id)
      .sort((a, b) => b.createdAt - a.createdAt);
    const gameweekPoints = participatedScores.reduce(
      (sum, score) => sum + getFiniteFantasyNumber(score.points),
      0,
    );
    const deductionPoints = seasonDeductions.reduce(
      (sum, deduction) => sum + getFiniteFantasyNumber(deduction.points),
      0,
    );

    return {
      team: { id: fantasyTeam._id, name: fantasyTeam.name },
      gameweekPoints: roundFantasyPoints(gameweekPoints),
      deductionPoints: roundFantasyPoints(deductionPoints),
      overallPoints: roundFantasyPoints(gameweekPoints - deductionPoints),
      gameweeks: gameweekBreakdowns,
      deductions: seasonDeductions.map((deduction) => ({
        id: deduction._id,
        points: roundFantasyPoints(deduction.points),
        reason: deduction.reason ?? null,
        source: deduction.source,
        sourceId: deduction.sourceId ?? null,
        createdAt: deduction.createdAt,
      })),
    };
  },
});

async function readFantasyTeamGameweekView(
  ctx: QueryCtx,
  args: {
    fantasyTeamId: Id<"fantasyTeams">;
    gameweekId?: Id<"fantasyGameweeks">;
    seasonSlug?: string;
  },
) {
  const currentUserSession = await getCurrentUserIfAuthenticated(ctx);
  if (!currentUserSession?.user) return null;
  const { identity, user: currentUser } = currentUserSession;

  const fantasyTeam = await ctx.db.get(args.fantasyTeamId);
  if (!fantasyTeam) return null;

  const season = args.seasonSlug
    ? await getSeason(ctx, args.seasonSlug)
    : await ctx.db.get(fantasyTeam.seasonId);
  if (!season || fantasyTeam.seasonId !== season._id) return null;
  if (
    isAdminOnlyFantasySeason(season) &&
    !isAdminUser(identity, currentUser)
  ) {
    return null;
  }

  const [manager, gameweeks, fantasyTeams, teamScores] = await Promise.all([
    ctx.db.get(fantasyTeam.userId),
    getSeasonGameweeks(ctx, season._id),
    ctx.db
      .query("fantasyTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    ctx.db
      .query("fantasyTeamGameweekScores")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
  ]);
  const gameweek = args.gameweekId
    ? ((await ctx.db.get(args.gameweekId)) ?? null)
    : findCurrentScoringGameweekFromList(season, gameweeks);
  if (!gameweek || gameweek.seasonId !== season._id) {
    return {
      averagePoints: 0,
      gameweek: null,
      highestTeam: null,
      players: [],
      score: null,
      team: {
        id: fantasyTeam._id,
        managerName: manager?.name ?? null,
        name: fantasyTeam.name,
      },
      transferPenaltyPoints: 0,
    };
  }

  const fantasyTeamsById = new Map(
    fantasyTeams.map((team) => [team._id, team]),
  );
  const eligibleFantasyTeams = fantasyTeams.filter((team) =>
    canFantasyTeamParticipateInGameweek(team, gameweek),
  );
  const scoreByTeamId = new Map<Id<"fantasyTeams">, number>();
  for (const score of teamScores) {
    if (score.gameweekId !== gameweek._id || !score.participated) continue;
    const scoringTeam = fantasyTeamsById.get(score.fantasyTeamId);
    if (
      !scoringTeam ||
      !canFantasyTeamParticipateInGameweek(scoringTeam, gameweek)
    ) {
      continue;
    }
    scoreByTeamId.set(score.fantasyTeamId, roundFantasyPoints(score.points));
  }
  const averagePoints =
    eligibleFantasyTeams.length > 0
      ? roundFantasyPoints(
          eligibleFantasyTeams.reduce(
            (sum, team) => sum + (scoreByTeamId.get(team._id) ?? 0),
            0,
          ) / eligibleFantasyTeams.length,
        )
      : 0;
  const highestTeam =
    [...eligibleFantasyTeams].sort((a, b) => {
      const pointsDiff =
        (scoreByTeamId.get(b._id) ?? 0) - (scoreByTeamId.get(a._id) ?? 0);
      if (pointsDiff !== 0) return pointsDiff;
      const totalDiff =
        getFiniteFantasyNumber(b.totalPoints) -
        getFiniteFantasyNumber(a.totalPoints);
      if (totalDiff !== 0) return totalDiff;
      return a.name.localeCompare(b.name);
    })[0] ?? null;
  const highestManager = highestTeam
    ? await ctx.db.get(highestTeam.userId)
    : null;
  const overallLeaderTeam = args.gameweekId
    ? null
    : ([...fantasyTeams].sort(
        (a, b) =>
          getFiniteFantasyNumber(b.totalPoints) -
            getFiniteFantasyNumber(a.totalPoints) ||
          a.name.localeCompare(b.name),
      )[0] ?? null);
  const canViewTeam =
    fantasyTeam.userId === currentUser._id ||
    highestTeam?._id === fantasyTeam._id ||
    overallLeaderTeam?._id === fantasyTeam._id ||
    isAdminUser(identity, currentUser);
  if (!canViewTeam) return null;

  const breakdown = await buildFantasyTeamGameweekPointsBreakdown(
    ctx,
    season,
    fantasyTeam,
    gameweek,
  );

  return {
    ...breakdown,
    averagePoints,
    highestTeam: highestTeam
      ? {
          id: highestTeam._id,
          managerName: highestManager?.name ?? null,
          name: highestTeam.name,
          points: roundFantasyPoints(scoreByTeamId.get(highestTeam._id) ?? 0),
        }
      : null,
    team: {
      id: fantasyTeam._id,
      managerName: manager?.name ?? null,
      name: fantasyTeam.name,
    },
  };
}

export const fantasyTeamGameweekView = query({
  args: {
    fantasyTeamId: v.id("fantasyTeams"),
    gameweekId: v.optional(v.id("fantasyGameweeks")),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      return await readFantasyTeamGameweekView(ctx, args);
    } catch (error) {
      console.error("[fantasyTeamGameweekView] failed", {
        fantasyTeamId: args.fantasyTeamId,
        gameweekId: args.gameweekId ?? null,
        message: error instanceof Error ? error.message : String(error),
        seasonSlug: args.seasonSlug ?? null,
        stack: error instanceof Error ? error.stack : null,
      });
      return null;
    }
  },
});

type FixturePlayerPointsBreakdown = {
  appeared: boolean;
  lines: Array<{
    count: number | null;
    kind: PlayerPointLineKind;
    points: number;
  }>;
  points: number;
};

function buildFixturePlayerPointsBreakdown({
  events,
  fixture,
  lineups,
  player,
  rules,
}: {
  events: Doc<"fantasyFixtureEvents">[];
  fixture: Doc<"fantasyFixtures">;
  lineups: Doc<"fantasyFixtureLineups">[];
  player: Doc<"fantasyPlayers">;
  rules: ScoringRuleValues;
}): FixturePlayerPointsBreakdown {
  const playerEvents = events.filter((event) => event.playerId === player._id);
  const appeared =
    lineups.some((lineup) => lineup.playerId === player._id) ||
    playerEvents.length > 0;
  const lines: FixturePlayerPointsBreakdown["lines"] = [];
  if (!appeared) {
    return { appeared, lines, points: 0 };
  }

  const position = toPublicFantasyPlayerPosition(player.position);
  const goalPoints =
    position === "goalkeeper" ? rules.goalkeeperGoal : rules.outfieldGoal;
  const assistPoints =
    position === "goalkeeper" ? rules.goalkeeperAssist : rules.outfieldAssist;
  const eventCounts = new Map<FantasyFixtureEventType, number>();
  for (const event of playerEvents) {
    eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
  }
  const goals = eventCounts.get("goal") ?? 0;
  const assists = eventCounts.get("assist") ?? 0;
  const yellowCards = eventCounts.get("yellow_card") ?? 0;
  const secondYellowRedCards = eventCounts.get("second_yellow_red") ?? 0;
  const redCards = eventCounts.get("red_card") ?? 0;
  const ownGoals = eventCounts.get("own_goal") ?? 0;
  const penaltiesMissed = eventCounts.get("penalty_missed") ?? 0;
  const penaltiesSaved = eventCounts.get("penalty_saved") ?? 0;

  addPlayerPointLine(lines, "appearance", 1, rules.appearance);
  addPlayerPointLine(lines, "goal", goals, goals * goalPoints);
  addPlayerPointLine(lines, "assist", assists, assists * assistPoints);
  addPlayerPointLine(
    lines,
    "yellow_card",
    yellowCards,
    yellowCards * rules.yellowCard,
  );
  addPlayerPointLine(
    lines,
    "second_yellow_red",
    secondYellowRedCards,
    secondYellowRedCards * rules.secondYellowRedCard,
  );
  addPlayerPointLine(lines, "red_card", redCards, redCards * rules.redCard);
  addPlayerPointLine(lines, "own_goal", ownGoals, ownGoals * rules.ownGoal);
  addPlayerPointLine(
    lines,
    "penalty_missed",
    penaltiesMissed,
    penaltiesMissed * rules.penaltyMissed,
  );
  addPlayerPointLine(
    lines,
    "penalty_saved",
    penaltiesSaved,
    penaltiesSaved * rules.penaltySaved,
  );

  return {
    appeared,
    lines,
    points: roundFantasyPoints(
      lines.reduce((sum, line) => sum + line.points, 0),
    ),
  };
}

function getFixtureResultKind(
  fixture: Doc<"fantasyFixtures">,
  clubId: Id<"fantasyClubs"> | undefined,
) {
  if (
    !clubId ||
    fixture.homeScore === undefined ||
    fixture.awayScore === undefined
  ) {
    return null;
  }

  const isHomeClub = fixture.homeClubId === clubId;
  const isAwayClub = fixture.awayClubId === clubId;
  if (!isHomeClub && !isAwayClub) return null;

  const goalsFor = isHomeClub ? fixture.homeScore : fixture.awayScore;
  const goalsAgainst = isHomeClub ? fixture.awayScore : fixture.homeScore;
  if (goalsFor > goalsAgainst) return "win" as const;
  if (goalsFor < goalsAgainst) return "loss" as const;
  return "draw" as const;
}

function areNumberArraysEqual(a: number[], b: number[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function areFixtureEventIdArraysEqual(
  a: Id<"fantasyFixtureEvents">[],
  b: Id<"fantasyFixtureEvents">[],
) {
  return (
    a.length === b.length &&
    a.every((value, index) => String(value) === String(b[index]))
  );
}

async function syncFantasyPlayerSuspensionsForSeason(
  ctx: MutationCtx,
  seasonId: Id<"fantasySeasons">,
  now = Date.now(),
) {
  const [players, gameweeks, events] = await Promise.all([
    ctx.db
      .query("fantasyPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
      .collect(),
    getSeasonGameweeks(ctx, seasonId),
    ctx.db
      .query("fantasyFixtureEvents")
      .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
      .collect(),
  ]);
  const gameweeksById = new Map(
    gameweeks.map((gameweek) => [gameweek._id, gameweek]),
  );
  const gameweekNumbers = new Set(gameweeks.map((gameweek) => gameweek.number));
  const suspensionGameweeksByPlayerId = new Map<
    Id<"fantasyPlayers">,
    Set<number>
  >();
  const suspensionEventIdsByPlayerId = new Map<
    Id<"fantasyPlayers">,
    Id<"fantasyFixtureEvents">[]
  >();

  for (const event of events) {
    if (
      !event.playerId ||
      !event.gameweekId ||
      !FANTASY_SUSPENSION_EVENT_TYPES.has(event.type)
    ) {
      continue;
    }

    const gameweek = gameweeksById.get(event.gameweekId);
    if (!gameweek) continue;

    const suspensionGameweekNumber = gameweek.number + 1;
    if (!gameweekNumbers.has(suspensionGameweekNumber)) continue;

    const currentGameweeks =
      suspensionGameweeksByPlayerId.get(event.playerId) ?? new Set<number>();
    currentGameweeks.add(suspensionGameweekNumber);
    suspensionGameweeksByPlayerId.set(event.playerId, currentGameweeks);

    const currentEventIds =
      suspensionEventIdsByPlayerId.get(event.playerId) ?? [];
    currentEventIds.push(event._id);
    suspensionEventIdsByPlayerId.set(event.playerId, currentEventIds);
  }

  const changedPlayers = [];
  for (const player of players) {
    const nextGameweekNumbers = [
      ...(suspensionGameweeksByPlayerId.get(player._id) ?? new Set<number>()),
    ].sort((a, b) => a - b);
    const nextSourceEventIds = [
      ...(suspensionEventIdsByPlayerId.get(player._id) ?? []),
    ].sort((a, b) => String(a).localeCompare(String(b)));
    const previousGameweekNumbers =
      getFantasyPlayerSuspensionGameweekNumbers(player);
    const previousSourceEventIds = [
      ...(player.suspensionSourceEventIds ?? []),
    ].sort((a, b) => String(a).localeCompare(String(b)));

    if (
      areNumberArraysEqual(previousGameweekNumbers, nextGameweekNumbers) &&
      areFixtureEventIdArraysEqual(previousSourceEventIds, nextSourceEventIds)
    ) {
      continue;
    }

    await ctx.db.patch(player._id, {
      suspensionGameweekNumbers:
        nextGameweekNumbers.length > 0 ? nextGameweekNumbers : undefined,
      suspensionSourceEventIds:
        nextSourceEventIds.length > 0 ? nextSourceEventIds : undefined,
      suspensionUpdatedAt:
        nextGameweekNumbers.length > 0 ? now : undefined,
      updatedAt: now,
    });
    changedPlayers.push({
      playerId: player._id,
      displayName: player.displayName,
      gameweekNumbers: nextGameweekNumbers,
      suspended: nextGameweekNumbers.length > 0,
    });
  }

  return {
    changed: changedPlayers.length,
    players: changedPlayers,
  };
}

export const playerProfile = query({
  args: {
    playerId: v.id("fantasyPlayers"),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) return null;

    const season = args.seasonSlug
      ? await getSeason(ctx, args.seasonSlug)
      : await ctx.db.get(player.seasonId);
    if (!season || player.seasonId !== season._id) return null;
    if (!(await currentUserCanAccessFantasySeason(ctx, season))) return null;

    const [
      club,
      clubs,
      gameweeks,
      gameweekStats,
      fantasyTeams,
      playerPriceHistory,
      fixtures,
      scoringRule,
    ] = await Promise.all([
      player.clubId ? ctx.db.get(player.clubId) : Promise.resolve(null),
      ctx.db
        .query("fantasyClubs")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      getSeasonGameweeks(ctx, season._id),
      ctx.db
        .query("fantasyPlayerGameweekStats")
        .withIndex("by_season_player", (q) =>
          q.eq("seasonId", season._id).eq("playerId", player._id),
        )
        .collect(),
      ctx.db
        .query("fantasyTeams")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerPriceHistory")
        .withIndex("by_season_player", (q) =>
          q.eq("seasonId", season._id).eq("playerId", player._id),
        )
        .collect(),
      player.clubId
        ? ctx.db
            .query("fantasyFixtures")
            .withIndex("by_season", (q) => q.eq("seasonId", season._id))
            .collect()
        : Promise.resolve([]),
      getSeasonScoringRules(ctx, season._id),
    ]);
    const rules = getScoringRuleValues(scoringRule);
    const clubsById = new Map(clubs.map((item) => [item._id, item]));
    const stats = gameweekStats.reduce((current, stat) => {
      current.appearances += getStoredPlayerStatAppearances(stat);
      current.assists += stat.assists ?? 0;
      current.cleanSheets += stat.cleanSheets ?? (stat.cleanSheet ? 1 : 0);
      current.goals += stat.goals ?? 0;
      current.goalsConceded += stat.goalsConceded ?? 0;
      current.ownGoals += stat.ownGoals ?? 0;
      current.penaltiesMissed += stat.penaltiesMissed ?? 0;
      current.penaltiesSaved += stat.penaltiesSaved ?? 0;
      current.points += stat.points;
      current.redCards += stat.redCards ?? 0;
      current.saves += stat.saves ?? 0;
      current.secondYellowRedCards += stat.secondYellowRedCards ?? 0;
      current.teamGoalsConcededPoints += stat.teamGoalsConcededPoints ?? 0;
      current.teamGoalsScored += stat.teamGoalsScored ?? 0;
      current.teamGoalsScoredPoints += stat.teamGoalsScoredPoints ?? 0;
      current.yellowCards += stat.yellowCards ?? 0;
      return current;
    }, getEmptyPlayerStats());
    const pickedByTeamCount = await Promise.all(
      fantasyTeams.map(async (team) => {
        const picks = await ctx.db
          .query("fantasySquadPicks")
          .withIndex("by_team", (q) => q.eq("fantasyTeamId", team._id))
          .collect();
        return picks.some((pick) => pick.playerId === player._id) ? 1 : 0;
      }),
    );
    const selectedByTeams = pickedByTeamCount.reduce<number>(
      (sum, count) => sum + count,
      0,
    );
    const selectedPercent =
      fantasyTeams.length > 0
        ? Number(((selectedByTeams / fantasyTeams.length) * 100).toFixed(1))
        : 0;
    const latestPriceHistory =
      playerPriceHistory
        .filter(shouldExposePlayerPriceTrend)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    const priceDelta = latestPriceHistory
      ? Number(latestPriceHistory.delta.toFixed(1))
      : 0;
    const teamFixtures = fixtures
      .filter(
        (fixture) =>
          player.clubId &&
          (fixture.homeClubId === player.clubId ||
            fixture.awayClubId === player.clubId) &&
          isFixtureScoredForFantasy(fixture) &&
          fixture.homeScore !== undefined &&
          fixture.awayScore !== undefined,
      )
      .sort((a, b) => b.scheduledAt - a.scheduledAt);
    const fixtureLineupLists = await Promise.all(
      teamFixtures.map((fixture) =>
        ctx.db
          .query("fantasyFixtureLineups")
          .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
          .collect(),
      ),
    );
    const fixtureEventLists = await Promise.all(
      teamFixtures.map((fixture) =>
        ctx.db
          .query("fantasyFixtureEvents")
          .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
          .collect(),
      ),
    );
    const gameweeksById = new Map(
      gameweeks.map((gameweek) => [gameweek._id, gameweek]),
    );
    const currentGameweek = findCurrentGameweekFromList(
      season,
      gameweeks,
      Date.now(),
    );
    const availabilityContext = {
      currentGameweekNumber: currentGameweek?.number ?? null,
    };
    const matches = teamFixtures
      .map((fixture, index) => {
        const isHome = player.clubId
          ? fixture.homeClubId === player.clubId
          : false;
        const opponentClubId = isHome ? fixture.awayClubId : fixture.homeClubId;
        const opponentClub = opponentClubId
          ? (clubsById.get(opponentClubId) ?? null)
          : null;
        const pointsBreakdown = buildFixturePlayerPointsBreakdown({
          events: fixtureEventLists[index] ?? [],
          fixture,
          lineups: fixtureLineupLists[index] ?? [],
          player,
          rules,
        });
        if (!pointsBreakdown.appeared) return null;

        const gameweek = fixture.gameweekId
          ? (gameweeksById.get(fixture.gameweekId) ?? null)
          : null;

        return {
          id: fixture._id,
          gameweek: gameweek ? toGameweekView(gameweek) : null,
          fixture: {
            id: fixture._id,
            seasonId: fixture.seasonId,
            gameweekId: fixture.gameweekId ?? null,
            externalId: fixture.externalId ?? null,
            sourceUrl: fixture.sourceUrl ?? null,
            homeClubId: fixture.homeClubId ?? null,
            awayClubId: fixture.awayClubId ?? null,
            homeClubName: fixture.homeClubName,
            awayClubName: fixture.awayClubName,
            scheduledAt: fixture.scheduledAt,
            status: fixture.status,
            homeScore: fixture.homeScore ?? null,
            awayScore: fixture.awayScore ?? null,
            venue: fixture.venue ?? null,
          },
          isHome,
          lines: pointsBreakdown.lines,
          opponent: opponentClub
            ? toClubView(opponentClub)
            : {
                id: opponentClubId,
                name: isHome ? fixture.awayClubName : fixture.homeClubName,
                shortName: null,
                logoUrl: null,
                logoThumbnailUrl: null,
              },
          points: pointsBreakdown.points,
          resultKind: getFixtureResultKind(fixture, player.clubId),
        };
      })
      .filter((match) => match !== null);
    const averagePointsPerMatch =
      stats.appearances > 0
        ? Number((stats.points / stats.appearances).toFixed(1))
        : 0;

    return {
      player: {
        id: player._id,
        seasonId: player.seasonId,
        clubId: player.clubId ?? null,
        clubName: club?.name ?? null,
        displayName: player.displayName,
        firstName: player.firstName ?? null,
        lastName: player.lastName,
        photoThumbnailUrl: player.photoThumbnailUrl ?? null,
        photoUrl: player.photoUrl ?? null,
        position: toPublicFantasyPlayerPosition(player.position),
        price: player.price,
        previousPrice:
          latestPriceHistory && Math.abs(priceDelta) >= 0.1
            ? latestPriceHistory.oldPrice
            : null,
        priceChangedAt: latestPriceHistory?.createdAt ?? null,
        priceDelta,
        status: getEffectiveFantasyPlayerStatus(player, availabilityContext),
        statusDetails: toFantasyPlayerStatusDetailsView(
          player,
          availabilityContext,
        ),
        appearances: stats.appearances,
        assists: stats.assists,
        averagePointsPerGameweek: averagePointsPerMatch,
        cleanSheets: stats.cleanSheets,
        goals: stats.goals,
        goalsConceded: stats.goalsConceded,
        ownGoals: stats.ownGoals,
        penaltiesMissed: stats.penaltiesMissed,
        penaltiesSaved: stats.penaltiesSaved,
        redCards: stats.redCards,
        saves: stats.saves,
        seasonPoints: Number(stats.points.toFixed(1)),
        selectedByTeams,
        selectedPercent,
        yellowCards: stats.yellowCards,
      },
      matches,
    };
  },
});

export const seasonPlayerStatistics = query({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const season = await getSeason(ctx, args.seasonSlug);
    if (!season) {
      return {
        leaderboard: [],
        leaders: {
          bestValue: null,
          mostAssists: null,
          mostPicked: null,
          topScorer: null,
        },
        topPerformers: [],
        totals: {
          fantasyTeams: 0,
          hasGameweekStats: false,
          players: 0,
        },
      };
    }

    const [
      players,
      clubs,
      gameweekStats,
      fantasyTeams,
      playerPriceHistory,
      gameweeks,
    ] = await Promise.all([
      ctx.db
        .query("fantasyPlayers")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyClubs")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerGameweekStats")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyTeams")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerPriceHistory")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyGameweeks")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
    ]);

    const clubsById = new Map(clubs.map((club) => [club._id, club]));
    const latestPriceHistoryByPlayerId = new Map<
      Id<"fantasyPlayers">,
      Doc<"fantasyPlayerPriceHistory">
    >();
    for (const history of playerPriceHistory) {
      if (!shouldExposePlayerPriceTrend(history)) continue;

      const current = latestPriceHistoryByPlayerId.get(history.playerId);
      if (!current || history.createdAt > current.createdAt) {
        latestPriceHistoryByPlayerId.set(history.playerId, history);
      }
    }
    const statsByPlayerId = new Map<
      Id<"fantasyPlayers">,
      PlayerStatsAccumulator
    >();
    const statsByGameweekAndPlayerId = new Map<
      string,
      Doc<"fantasyPlayerGameweekStats">
    >();
    for (const stat of gameweekStats) {
      const current =
        statsByPlayerId.get(stat.playerId) ?? getEmptyPlayerStats();
      current.appearances +=
        stat.appearances ??
        (stat.minutes !== undefined && stat.minutes > 0 ? 1 : 0);
      current.assists += stat.assists ?? 0;
      current.cleanSheets += stat.cleanSheets ?? (stat.cleanSheet ? 1 : 0);
      current.goals += stat.goals ?? 0;
      current.goalsConceded += stat.goalsConceded ?? 0;
      current.ownGoals += stat.ownGoals ?? 0;
      current.penaltiesMissed += stat.penaltiesMissed ?? 0;
      current.penaltiesSaved += stat.penaltiesSaved ?? 0;
      current.points += stat.points;
      current.redCards += stat.redCards ?? 0;
      current.saves += stat.saves ?? 0;
      current.yellowCards += stat.yellowCards ?? 0;
      statsByPlayerId.set(stat.playerId, current);
      statsByGameweekAndPlayerId.set(
        getPlayerGameweekStatsKey(stat.gameweekId, stat.playerId),
        stat,
      );
    }
    const latestScoredGameweek = findLatestScoredGameweekFromList(gameweeks);
    const currentGameweek = findCurrentGameweekFromList(
      season,
      gameweeks,
      Date.now(),
    );
    const availabilityContext = {
      currentGameweekNumber: currentGameweek?.number ?? null,
    };

    const squadPickLists = await Promise.all(
      fantasyTeams.map((fantasyTeam) =>
        ctx.db
          .query("fantasySquadPicks")
          .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
          .collect(),
      ),
    );
    const pickedByPlayerId = new Map<Id<"fantasyPlayers">, number>();
    for (const picks of squadPickLists) {
      const uniquePlayerIds = new Set(picks.map((pick) => pick.playerId));
      for (const playerId of uniquePlayerIds) {
        pickedByPlayerId.set(
          playerId,
          (pickedByPlayerId.get(playerId) ?? 0) + 1,
        );
      }
    }

    const leaderboard = players.map((player) => {
      const club = player.clubId
        ? (clubsById.get(player.clubId) ?? null)
        : null;
      const stats = statsByPlayerId.get(player._id) ?? getEmptyPlayerStats();
      const selectedByTeams = pickedByPlayerId.get(player._id) ?? 0;
      const selectedPercent =
        fantasyTeams.length > 0
          ? Number(((selectedByTeams / fantasyTeams.length) * 100).toFixed(1))
          : 0;
      const latestPriceHistory = latestPriceHistoryByPlayerId.get(player._id);
      const priceDelta = latestPriceHistory
        ? Number(latestPriceHistory.delta.toFixed(1))
        : 0;
      const averagePointsPerMatch =
        stats.appearances > 0
          ? Number((stats.points / stats.appearances).toFixed(1))
          : 0;
      const latestGameweekStat = latestScoredGameweek
        ? statsByGameweekAndPlayerId.get(
            getPlayerGameweekStatsKey(latestScoredGameweek._id, player._id),
          )
        : undefined;
      const valueScore =
        player.price > 0 ? Number((stats.points / player.price).toFixed(1)) : 0;

      return {
        id: player._id,
        clubId: player.clubId ?? null,
        clubName: club?.name ?? null,
        clubLogoUrl: club?.logoUrl ?? null,
        clubLogoThumbnailUrl: club?.logoThumbnailUrl ?? null,
        displayName: player.displayName,
        firstName: player.firstName ?? null,
        lastName: player.lastName,
        photoUrl: player.photoUrl ?? null,
        photoThumbnailUrl: player.photoThumbnailUrl ?? null,
        position: toPublicFantasyPlayerPosition(player.position),
        price: player.price,
        previousPrice:
          latestPriceHistory && Math.abs(priceDelta) >= 0.1
            ? latestPriceHistory.oldPrice
            : null,
        priceChangedAt: latestPriceHistory?.createdAt ?? null,
        priceDelta,
        status: getEffectiveFantasyPlayerStatus(player, availabilityContext),
        statusDetails: toFantasyPlayerStatusDetailsView(
          player,
          availabilityContext,
        ),
        appearances: stats.appearances,
        assists: stats.assists,
        averagePointsPerGameweek: averagePointsPerMatch,
        averagePointsPerMatch,
        cleanSheets: stats.cleanSheets,
        goals: stats.goals,
        goalsConceded: stats.goalsConceded,
        lastGameweekPoints: latestGameweekStat
          ? Number(latestGameweekStat.points.toFixed(1))
          : 0,
        ownGoals: stats.ownGoals,
        penaltiesMissed: stats.penaltiesMissed,
        penaltiesSaved: stats.penaltiesSaved,
        points: Number(stats.points.toFixed(1)),
        redCards: stats.redCards,
        saves: stats.saves,
        selectedByTeams,
        selectedPercent,
        valueScore,
        yellowCards: stats.yellowCards,
      };
    });

    const pickPositiveLeader = (
      getValue: (player: (typeof leaderboard)[number]) => number,
      compare: (
        a: (typeof leaderboard)[number],
        b: (typeof leaderboard)[number],
      ) => number,
    ) => {
      const leader = [...leaderboard].sort(compare)[0] ?? null;
      return leader && getValue(leader) > 0 ? leader : null;
    };

    const topScorer = pickPositiveLeader(
      (player) => player.goals,
      (a, b) => b.goals - a.goals || compareSeasonPlayerStats(a, b),
    );
    const mostAssists = pickPositiveLeader(
      (player) => player.assists,
      (a, b) => b.assists - a.assists || compareSeasonPlayerStats(a, b),
    );
    const bestValue = pickPositiveLeader(
      (player) => player.valueScore,
      (a, b) => b.valueScore - a.valueScore || compareSeasonPlayerStats(a, b),
    );
    const mostPicked = pickPositiveLeader(
      (player) => player.selectedByTeams,
      (a, b) =>
        b.selectedPercent - a.selectedPercent ||
        b.selectedByTeams - a.selectedByTeams ||
        compareSeasonPlayerStats(a, b),
    );
    const sortedByPoints = [...leaderboard].sort(compareSeasonPlayerStats);

    return {
      leaderboard: sortedByPoints,
      leaders: {
        bestValue,
        mostAssists,
        mostPicked,
        topScorer,
      },
      topPerformers: sortedByPoints.slice(0, 5),
      totals: {
        fantasyTeams: fantasyTeams.length,
        hasGameweekStats: gameweekStats.length > 0,
        players: leaderboard.length,
      },
    };
  },
});

export const myFavoritePlayerIds = query({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserIfAuthenticated(ctx);
    if (!currentUser?.user) return [];
    const { user } = currentUser;

    const season = await getSeason(ctx, args.seasonSlug);
    if (!season) return [];

    const favorites = await ctx.db
      .query("fantasyPlayerFavorites")
      .withIndex("by_user_season", (q) =>
        q.eq("userId", user._id).eq("seasonId", season._id),
      )
      .collect();

    return favorites.map((favorite) => favorite.playerId);
  },
});

export const toggleFavoritePlayer = mutation({
  args: {
    isFavorite: v.boolean(),
    playerId: v.id("fantasyPlayers"),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Сначала нужно подготовить профиль пользователя.");
    }

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const player = await ctx.db.get(args.playerId);
    if (!player || player.seasonId !== season._id) {
      throw new Error("Player was not found in the current season.");
    }

    const existing = await ctx.db
      .query("fantasyPlayerFavorites")
      .withIndex("by_user_season_player", (q) =>
        q
          .eq("userId", user._id)
          .eq("seasonId", season._id)
          .eq("playerId", args.playerId),
      )
      .first();
    const now = Date.now();

    if (args.isFavorite) {
      if (existing) {
        await ctx.db.patch(existing._id, { updatedAt: now });
      } else {
        await ctx.db.insert("fantasyPlayerFavorites", {
          seasonId: season._id,
          userId: user._id,
          playerId: args.playerId,
          createdAt: now,
          updatedAt: now,
        });
      }
    } else if (existing) {
      await ctx.db.delete(existing._id);
    }

    return {
      isFavorite: args.isFavorite,
      playerId: args.playerId,
    };
  },
});

export const myTeam = query({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const [season, user] = await Promise.all([
      getSeason(ctx, args.seasonSlug),
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
        .first(),
    ]);
    if (!season || !user) return null;

    const fantasyTeam = await ctx.db
      .query("fantasyTeams")
      .withIndex("by_user_season", (q) =>
        q.eq("userId", user._id).eq("seasonId", season._id),
      )
      .first();
    if (!fantasyTeam) return null;

    const picks = await ctx.db
      .query("fantasySquadPicks")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
      .collect();
    const players = await Promise.all(
      picks.map((pick) => ctx.db.get(pick.playerId)),
    );
    const [
      clubs,
      playerGameweekStats,
      fantasyTeams,
      teamGameweekScores,
      playerPriceHistory,
      gameweekSquadPicks,
      gameweeks,
    ] = await Promise.all([
      ctx.db
        .query("fantasyClubs")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerGameweekStats")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyTeams")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyTeamGameweekScores")
        .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerPriceHistory")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyGameweekSquadPicks")
        .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
        .collect(),
      ctx.db
        .query("fantasyGameweeks")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
    ]);
    const clubsById = new Map(clubs.map((club) => [club._id, club]));
    const latestPriceHistoryByPlayerId = new Map<
      Id<"fantasyPlayers">,
      Doc<"fantasyPlayerPriceHistory">
    >();
    for (const history of playerPriceHistory) {
      if (!shouldExposePlayerPriceTrend(history)) continue;

      const current = latestPriceHistoryByPlayerId.get(history.playerId);
      if (!current || history.createdAt > current.createdAt) {
        latestPriceHistoryByPlayerId.set(history.playerId, history);
      }
    }
    const statsByPlayerId = new Map<
      Id<"fantasyPlayers">,
      PlayerStatsAccumulator
    >();
    const statsByGameweekAndPlayerId = new Map<
      string,
      Doc<"fantasyPlayerGameweekStats">
    >();
    for (const stat of playerGameweekStats) {
      const current =
        statsByPlayerId.get(stat.playerId) ?? getEmptyPlayerStats();
      current.appearances += getStoredPlayerStatAppearances(stat);
      current.assists += stat.assists ?? 0;
      current.cleanSheets += stat.cleanSheets ?? (stat.cleanSheet ? 1 : 0);
      current.goals += stat.goals ?? 0;
      current.goalsConceded += stat.goalsConceded ?? 0;
      current.ownGoals += stat.ownGoals ?? 0;
      current.penaltiesMissed += stat.penaltiesMissed ?? 0;
      current.penaltiesSaved += stat.penaltiesSaved ?? 0;
      current.points += stat.points;
      current.redCards += stat.redCards ?? 0;
      current.saves += stat.saves ?? 0;
      current.yellowCards += stat.yellowCards ?? 0;
      statsByPlayerId.set(stat.playerId, current);
      statsByGameweekAndPlayerId.set(
        getPlayerGameweekStatsKey(stat.gameweekId, stat.playerId),
        stat,
      );
    }
    const gameweeksById = new Map(
      gameweeks.map((gameweek) => [gameweek._id, gameweek]),
    );
    const latestScoredGameweek = findLatestScoredGameweekFromList(gameweeks);
    const currentGameweek = findCurrentGameweekFromList(
      season,
      gameweeks,
      Date.now(),
    );
    const availabilityContext = {
      currentGameweekNumber: currentGameweek?.number ?? null,
    };
    const snapshotsByGameweekId = new Map<
      Id<"fantasyGameweeks">,
      Doc<"fantasyGameweekSquadPicks">[]
    >();
    const eligibleGameweekSquadPicks = gameweekSquadPicks.filter(
      (snapshot) => {
        if (snapshot.seasonId !== season._id) return false;
        const gameweek = gameweeksById.get(snapshot.gameweekId);
        return (
          !!gameweek &&
          canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
        );
      },
    );
    for (const snapshot of eligibleGameweekSquadPicks) {
      if (snapshot.seasonId !== season._id) continue;
      const current = snapshotsByGameweekId.get(snapshot.gameweekId) ?? [];
      current.push(snapshot);
      snapshotsByGameweekId.set(snapshot.gameweekId, current);
    }
    const managerPointsByPlayerId = new Map<
      Id<"fantasyPlayers">,
      ManagerPlayerPointsAccumulator
    >();
    for (const [gameweekId, snapshots] of snapshotsByGameweekId) {
      const gameweek = gameweeksById.get(gameweekId);
      if (!gameweek || !isGameweekScoredForFantasy(gameweek)) continue;

      const captain = snapshots.find((snapshot) => snapshot.isCaptain);
      const viceCaptain = snapshots.find((snapshot) => snapshot.isViceCaptain);
      const bonusSnapshot = didStoredSnapshotPlayerAppear(
        captain,
        statsByGameweekAndPlayerId,
      )
        ? captain
        : didStoredSnapshotPlayerAppear(viceCaptain, statsByGameweekAndPlayerId)
          ? viceCaptain
          : null;

      for (const snapshot of snapshots) {
        const stat = statsByGameweekAndPlayerId.get(
          getPlayerGameweekStatsKey(snapshot.gameweekId, snapshot.playerId),
        );
        const rolePoints = (stat?.points ?? 0) * snapshot.pointsMultiplier;
        const captainBonusPoints =
          bonusSnapshot?._id === snapshot._id ? rolePoints : 0;
        const managerPoints = roundFantasyPoints(
          rolePoints + captainBonusPoints,
        );
        const current =
          managerPointsByPlayerId.get(snapshot.playerId) ??
          getEmptyManagerPlayerPoints();

        if (snapshot.pointsMultiplier > 0) {
          current.activeGameweeks += 1;
        }
        current.managerSeasonPoints = roundFantasyPoints(
          current.managerSeasonPoints + managerPoints,
        );
        if (latestScoredGameweek?._id === snapshot.gameweekId) {
          current.managerLastGameweekPoints = managerPoints;
        }
        managerPointsByPlayerId.set(snapshot.playerId, current);
      }
    }
    const squadPickLists = await Promise.all(
      fantasyTeams.map((team) =>
        ctx.db
          .query("fantasySquadPicks")
          .withIndex("by_team", (q) => q.eq("fantasyTeamId", team._id))
          .collect(),
      ),
    );
    const pickedByPlayerId = new Map<Id<"fantasyPlayers">, number>();
    for (const teamPicks of squadPickLists) {
      const uniquePlayerIds = new Set(teamPicks.map((pick) => pick.playerId));
      for (const playerId of uniquePlayerIds) {
        pickedByPlayerId.set(
          playerId,
          (pickedByPlayerId.get(playerId) ?? 0) + 1,
        );
      }
    }

    const teamValue = roundFantasyMoney(
      players.reduce((sum, player) => sum + (player?.price ?? 0), 0),
    );
    const participatedTeamScores = teamGameweekScores.filter((score) => {
      if (!score.participated) return false;
      const gameweek = gameweeksById.get(score.gameweekId);
      return (
        !!gameweek && canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
      );
    });
    const hasGameweekSnapshot = eligibleGameweekSquadPicks.some(
      (snapshot) => snapshot.seasonId === season._id,
    );
    const hasParticipated =
      participatedTeamScores.length > 0 || hasGameweekSnapshot;
    const teamScoresByGameweekNumber = participatedTeamScores
      .map((score) => ({
        gameweekNumber: gameweeksById.get(score.gameweekId)?.number ?? 0,
        points: Number.isFinite(score.points) ? score.points : 0,
      }))
      .sort((a, b) => b.gameweekNumber - a.gameweekNumber);
    const lastGameweekPoints = teamScoresByGameweekNumber[0]?.points ?? 0;
    const bestGameweekPoints =
      participatedTeamScores.length > 0
        ? Math.max(
            ...participatedTeamScores.map((score) =>
              getFiniteFantasyNumber(score.points),
            ),
          )
        : 0;

    return {
      id: fantasyTeam._id,
      seasonId: fantasyTeam.seasonId,
      userId: fantasyTeam.userId,
      name: fantasyTeam.name,
      budgetRemaining: fantasyTeam.budgetRemaining,
      freeTransfers: fantasyTeam.freeTransfers,
      bestGameweekPoints,
      hasParticipated,
      lastGameweekPoints,
      teamValue,
      totalPoints: roundFantasyPoints(fantasyTeam.totalPoints),
      picks: picks
        .map((pick, index) => {
          const player = players[index];
          const squadRole =
            pick.squadRole ?? getSquadRoleForRosterSlot(pick.rosterSlot);
          const stats = player
            ? (statsByPlayerId.get(player._id) ?? getEmptyPlayerStats())
            : getEmptyPlayerStats();
          const selectedByTeams = player
            ? (pickedByPlayerId.get(player._id) ?? 0)
            : 0;
          const selectedPercent =
            fantasyTeams.length > 0
              ? Number(
                  ((selectedByTeams / fantasyTeams.length) * 100).toFixed(1),
                )
              : 0;
          const latestPriceHistory = player
            ? latestPriceHistoryByPlayerId.get(player._id)
            : null;
          const priceDelta = latestPriceHistory
            ? Number(latestPriceHistory.delta.toFixed(1))
            : 0;
          const averagePointsPerMatch =
            stats.appearances > 0
              ? Number((stats.points / stats.appearances).toFixed(1))
              : 0;
          const latestGameweekStat =
            player && latestScoredGameweek
              ? statsByGameweekAndPlayerId.get(
                  getPlayerGameweekStatsKey(
                    latestScoredGameweek._id,
                    player._id,
                  ),
                )
              : undefined;
          const managerStats = player
            ? (managerPointsByPlayerId.get(player._id) ??
              getEmptyManagerPlayerPoints())
            : getEmptyManagerPlayerPoints();
          const managerAveragePointsPerGameweek =
            managerStats.activeGameweeks > 0
              ? roundFantasyPoints(
                  managerStats.managerSeasonPoints /
                    managerStats.activeGameweeks,
                )
              : 0;

          return {
            id: pick._id,
            playerId: pick.playerId,
            rosterSlot: pick.rosterSlot,
            isStarter: pick.isStarter,
            squadRole,
            pointsMultiplier: getPointsMultiplierForSquadRole(squadRole),
            isCaptain: pick.isCaptain,
            isViceCaptain: pick.isViceCaptain,
            player: player
              ? {
                  id: player._id,
                  clubId: player.clubId ?? null,
                  clubName: player.clubId
                    ? (clubsById.get(player.clubId)?.name ?? null)
                    : null,
                  displayName: player.displayName,
                  position: toPublicFantasyPlayerPosition(player.position),
                  price: player.price,
                  previousPrice:
                    latestPriceHistory && Math.abs(priceDelta) >= 0.1
                      ? latestPriceHistory.oldPrice
                      : null,
                  priceChangedAt: latestPriceHistory?.createdAt ?? null,
                  priceDelta,
                  appearances: stats.appearances,
                  assists: stats.assists,
                  activeGameweeks: managerStats.activeGameweeks,
                  averagePointsPerGameweek: averagePointsPerMatch,
                  averagePointsPerMatch,
                  cleanSheets: stats.cleanSheets,
                  goals: stats.goals,
                  goalsConceded: stats.goalsConceded,
                  lastGameweekPoints: latestGameweekStat
                    ? Number(latestGameweekStat.points.toFixed(1))
                    : 0,
                  managerAveragePointsPerGameweek,
                  managerLastGameweekPoints:
                    managerStats.managerLastGameweekPoints,
                  managerSeasonPoints: managerStats.managerSeasonPoints,
                  ownGoals: stats.ownGoals,
                  penaltiesMissed: stats.penaltiesMissed,
                  penaltiesSaved: stats.penaltiesSaved,
                  redCards: stats.redCards,
                  saves: stats.saves,
                  seasonPoints: Number(stats.points.toFixed(1)),
                  selectedByTeams,
                  selectedPercent,
                  yellowCards: stats.yellowCards,
                  photoUrl: player.photoUrl ?? null,
                  photoThumbnailUrl: player.photoThumbnailUrl ?? null,
                  photoProvider: player.photoProvider ?? null,
                  photoCloudflareId: player.photoCloudflareId ?? null,
                  photoStorageKey: player.photoStorageKey ?? null,
                  photoSourceUrl: player.photoSourceUrl ?? null,
                  photoSourceThumbnailUrl:
                    player.photoSourceThumbnailUrl ?? null,
                  status: getEffectiveFantasyPlayerStatus(
                    player,
                    availabilityContext,
                  ),
                  statusDetails: toFantasyPlayerStatusDetailsView(
                    player,
                    availabilityContext,
                  ),
                }
              : null,
          };
        })
        .sort((a, b) => a.rosterSlot - b.rosterSlot),
    };
  },
});

export const listFantasyTeams = query({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const season = await getSeason(ctx, args.seasonSlug);
    if (!season) return [];

    const fantasyTeams = await ctx.db
      .query("fantasyTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    const [users, gameweeks, teamGameweekScores, squadPickLists] =
      await Promise.all([
        Promise.all(
          fantasyTeams.map((fantasyTeam) => ctx.db.get(fantasyTeam.userId)),
        ),
        ctx.db
          .query("fantasyGameweeks")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyTeamGameweekScores")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        Promise.all(
          fantasyTeams.map((fantasyTeam) =>
            ctx.db
              .query("fantasySquadPicks")
              .withIndex("by_team", (q) =>
                q.eq("fantasyTeamId", fantasyTeam._id),
              )
              .collect(),
          ),
        ),
      ]);

    const squadPlayerIds = Array.from(
      new Set(
        squadPickLists.flatMap((picks) => picks.map((pick) => pick.playerId)),
      ),
    );
    const squadPlayers = await Promise.all(
      squadPlayerIds.map((playerId) => ctx.db.get(playerId)),
    );
    const playerPriceById = new Map<Id<"fantasyPlayers">, number>();
    for (const player of squadPlayers) {
      if (player) {
        playerPriceById.set(player._id, player.price);
      }
    }
    const teamValueById = new Map<Id<"fantasyTeams">, number>();
    for (const [index, picks] of squadPickLists.entries()) {
      const uniquePlayerIds = Array.from(
        new Set(picks.map((pick) => pick.playerId)),
      );
      teamValueById.set(
        fantasyTeams[index]._id,
        roundFantasyMoney(
          uniquePlayerIds.reduce(
            (sum, playerId) => sum + (playerPriceById.get(playerId) ?? 0),
            0,
          ),
        ),
      );
    }

    const gameweekNumberById = new Map(
      gameweeks.map((gameweek) => [gameweek._id, gameweek.number]),
    );
    const gameweeksById = new Map(
      gameweeks.map((gameweek) => [gameweek._id, gameweek]),
    );
    const fantasyTeamsById = new Map(
      fantasyTeams.map((fantasyTeam) => [fantasyTeam._id, fantasyTeam]),
    );
    const isEligibleParticipatedScore = (score: {
      fantasyTeamId: Id<"fantasyTeams">;
      gameweekId: Id<"fantasyGameweeks">;
      participated: boolean;
    }) => {
      if (!score.participated) return false;
      const fantasyTeam = fantasyTeamsById.get(score.fantasyTeamId);
      const gameweek = gameweeksById.get(score.gameweekId);
      return (
        !!fantasyTeam &&
        !!gameweek &&
        canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
      );
    };
    const latestScoredGameweekNumber = teamGameweekScores.reduce(
      (latest, score) =>
        isEligibleParticipatedScore(score)
          ? Math.max(latest, gameweekNumberById.get(score.gameweekId) ?? 0)
          : latest,
      0,
    );
    const currentScoringGameweek = findCurrentScoringGameweekFromList(
      season,
      gameweeks,
    );

    const scoresByTeamId = new Map<
      string,
      Array<{
        gameweekId: Id<"fantasyGameweeks">;
        gameweekNumber: number;
        participated: boolean;
        points: number;
        totalPointsAfterGameweek: number | null;
      }>
    >();
    for (const score of teamGameweekScores) {
      const current = scoresByTeamId.get(score.fantasyTeamId) ?? [];
      const participated = isEligibleParticipatedScore(score);
      current.push({
        gameweekId: score.gameweekId,
        gameweekNumber: gameweekNumberById.get(score.gameweekId) ?? 0,
        participated,
        points:
          participated && Number.isFinite(score.points) ? score.points : 0,
        totalPointsAfterGameweek: participated
          ? (score.totalPointsAfterGameweek ?? null)
          : null,
      });
      scoresByTeamId.set(score.fantasyTeamId, current);
    }

    const getTeamGameweekMetrics = (fantasyTeam: Doc<"fantasyTeams">) => {
      const teamScores = scoresByTeamId.get(fantasyTeam._id) ?? [];
      const participatedScores = teamScores.filter((score) => {
        if (!score.participated) return false;
        const gameweek = gameweeksById.get(score.gameweekId);
        return (
          !!gameweek &&
          canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
        );
      });
      const totalFromGameweeks = participatedScores.reduce(
        (sum, score) => sum + score.points,
        0,
      );
      const averagePoints =
        participatedScores.length > 0
          ? Number((totalFromGameweeks / participatedScores.length).toFixed(1))
          : 0;
      const bestGameweekPoints =
        participatedScores.length > 0
          ? Math.max(
              ...participatedScores.map((score) =>
                getFiniteFantasyNumber(score.points),
              ),
            )
          : 0;
      const lastGameweekPoints =
        latestScoredGameweekNumber > 0
          ? (participatedScores.find(
              (score) => score.gameweekNumber === latestScoredGameweekNumber,
            )?.points ?? 0)
          : 0;
      const currentGameweekScore = currentScoringGameweek
        ? teamScores.find(
            (score) => score.gameweekId === currentScoringGameweek._id,
          )
        : null;
      const currentGameweekPoints =
        currentGameweekScore?.participated === true
          ? currentGameweekScore.points
          : 0;

      return {
        averagePoints,
        bestGameweekPoints,
        currentGameweekParticipated:
          currentGameweekScore?.participated ?? false,
        currentGameweekPoints,
        lastGameweekPoints,
      };
    };

    return fantasyTeams
      .map((fantasyTeam, index) => {
        const gameweekMetrics = getTeamGameweekMetrics(fantasyTeam);
        const teamGameweekScores = [
          ...(scoresByTeamId.get(fantasyTeam._id) ?? []),
        ].sort((a, b) => a.gameweekNumber - b.gameweekNumber);

        return {
          id: fantasyTeam._id,
          name: fantasyTeam.name,
          managerName: users[index]?.name ?? null,
          totalPoints: roundFantasyPoints(fantasyTeam.totalPoints),
          averagePoints: gameweekMetrics.averagePoints,
          bestGameweekPoints: gameweekMetrics.bestGameweekPoints,
          currentGameweekId: currentScoringGameweek?._id ?? null,
          currentGameweekNumber: currentScoringGameweek?.number ?? null,
          currentGameweekParticipated:
            gameweekMetrics.currentGameweekParticipated,
          currentGameweekPoints: gameweekMetrics.currentGameweekPoints,
          currentGameweekStatus: currentScoringGameweek?.status ?? null,
          gameweekScores: teamGameweekScores.map((score) => ({
            gameweekId: score.gameweekId,
            gameweekNumber: score.gameweekNumber,
            participated: score.participated,
            points: score.participated ? roundFantasyPoints(score.points) : 0,
            totalPointsAfterGameweek: score.totalPointsAfterGameweek,
          })),
          lastGameweekPoints: gameweekMetrics.lastGameweekPoints,
          budgetRemaining: fantasyTeam.budgetRemaining,
          teamValue: teamValueById.get(fantasyTeam._id) ?? 0,
        };
      })
      .sort(
        (a, b) =>
          getFiniteFantasyNumber(b.totalPoints) -
            getFiniteFantasyNumber(a.totalPoints) ||
          a.name.localeCompare(b.name),
      );
  },
});

export const listMyPrivateLeagues = query({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserIfAuthenticated(ctx);
    if (!currentUser?.user) return [];
    const { user } = currentUser;

    const season = await getSeason(ctx, args.seasonSlug);
    if (!season) return [];

    const memberships = (
      await ctx.db
        .query("fantasyPrivateLeagueMembers")
        .withIndex("by_user_season", (q) =>
          q.eq("userId", user._id).eq("seasonId", season._id),
        )
        .collect()
    ).filter((membership) => Boolean(membership.fantasyTeamId));
    const leagues = await Promise.all(
      memberships.map((membership) => ctx.db.get(membership.privateLeagueId)),
    );
    const leagueMembers = await Promise.all(
      memberships.map((membership) =>
        ctx.db
          .query("fantasyPrivateLeagueMembers")
          .withIndex("by_league", (q) =>
            q.eq("privateLeagueId", membership.privateLeagueId),
          )
          .collect(),
      ),
    );

    return leagues
      .map((league, index) => {
        if (!league || league.seasonId !== season._id) return null;

        const members = leagueMembers[index].filter(
          (member) =>
            member.seasonId === season._id && Boolean(member.fantasyTeamId),
        );

        return {
          id: league._id,
          inviteCode: league.inviteCode,
          isOwner: league.ownerUserId === user._id,
          memberCount: members.length,
          memberTeamIds: members.flatMap((member) =>
            member.fantasyTeamId ? [member.fantasyTeamId] : [],
          ),
          name: league.name,
          ownerUserId: league.ownerUserId,
        };
      })
      .filter(
        (league): league is NonNullable<typeof league> => league !== null,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createPrivateLeague = mutation({
  args: {
    name: v.string(),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User profile is not ready yet.");
    }

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const name = normalizePrivateLeagueName(args.name);
    const fantasyTeam = await requireFantasyTeamForUser(
      ctx,
      season._id,
      user._id,
    );
    const now = Date.now();
    let inviteCode: string | null = null;

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = generatePrivateLeagueInviteCode();
      const existing = await ctx.db
        .query("fantasyPrivateLeagues")
        .withIndex("by_season_invite_code", (q) =>
          q.eq("seasonId", season._id).eq("inviteCode", candidate),
        )
        .first();
      if (!existing) {
        inviteCode = candidate;
        break;
      }
    }

    if (!inviteCode) {
      throw new Error("Не удалось создать код приглашения. Попробуйте ещё раз.");
    }

    const privateLeagueId = await ctx.db.insert("fantasyPrivateLeagues", {
      seasonId: season._id,
      ownerUserId: user._id,
      name,
      inviteCode,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("fantasyPrivateLeagueMembers", {
      seasonId: season._id,
      privateLeagueId,
      userId: user._id,
      fantasyTeamId: fantasyTeam._id,
      role: "owner",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: privateLeagueId,
      inviteCode,
      isOwner: true,
      memberCount: 1,
      memberTeamIds: [fantasyTeam._id],
      name,
      ownerUserId: user._id,
    };
  },
});

export const joinPrivateLeague = mutation({
  args: {
    inviteCode: v.string(),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User profile is not ready yet.");
    }

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const inviteCode = normalizePrivateLeagueInviteCode(args.inviteCode);
    if (!inviteCode) {
      throw new Error("Введіть код запрошення.");
    }

    const privateLeague = await ctx.db
      .query("fantasyPrivateLeagues")
      .withIndex("by_season_invite_code", (q) =>
        q.eq("seasonId", season._id).eq("inviteCode", inviteCode),
      )
      .first();
    if (!privateLeague) {
      throw new Error("Лігу з таким кодом не знайдено.");
    }

    const fantasyTeam = await requireFantasyTeamForUser(
      ctx,
      season._id,
      user._id,
    );
    const now = Date.now();
    const existingMembership = await ctx.db
      .query("fantasyPrivateLeagueMembers")
      .withIndex("by_user_league", (q) =>
        q.eq("userId", user._id).eq("privateLeagueId", privateLeague._id),
      )
      .first();
    if (existingMembership) {
      if (existingMembership.fantasyTeamId !== fantasyTeam._id) {
        await ctx.db.patch(existingMembership._id, {
          fantasyTeamId: fantasyTeam._id,
          updatedAt: now,
        });
      }
    } else {
      await ctx.db.insert("fantasyPrivateLeagueMembers", {
        seasonId: season._id,
        privateLeagueId: privateLeague._id,
        userId: user._id,
        fantasyTeamId: fantasyTeam._id,
        role: privateLeague.ownerUserId === user._id ? "owner" : "member",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    const members = await ctx.db
      .query("fantasyPrivateLeagueMembers")
      .withIndex("by_league", (q) =>
        q.eq("privateLeagueId", privateLeague._id),
      )
      .collect();

    return {
      id: privateLeague._id,
      inviteCode: privateLeague.inviteCode,
      isOwner: privateLeague.ownerUserId === user._id,
      memberCount: members.length,
      memberTeamIds: members.flatMap((member) =>
        member.fantasyTeamId ? [member.fantasyTeamId] : [],
      ),
      name: privateLeague.name,
      ownerUserId: privateLeague.ownerUserId,
    };
  },
});

export const updatePrivateLeague = mutation({
  args: {
    name: v.string(),
    privateLeagueId: v.id("fantasyPrivateLeagues"),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User profile is not ready yet.");
    }

    const privateLeague = await ctx.db.get(args.privateLeagueId);
    if (!privateLeague) {
      throw new Error("Лігу не знайдено.");
    }
    if (privateLeague.ownerUserId !== user._id) {
      throw new Error("Редагувати лігу може тільки її власник.");
    }

    const name = normalizePrivateLeagueName(args.name);
    await ctx.db.patch(privateLeague._id, {
      name,
      updatedAt: Date.now(),
    });

    return {
      id: privateLeague._id,
      name,
    };
  },
});

export const deletePrivateLeague = mutation({
  args: {
    privateLeagueId: v.id("fantasyPrivateLeagues"),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User profile is not ready yet.");
    }

    const privateLeague = await ctx.db.get(args.privateLeagueId);
    if (!privateLeague) {
      return {
        deleted: false,
        id: args.privateLeagueId,
      };
    }
    if (privateLeague.ownerUserId !== user._id) {
      throw new Error("Видалити лігу може тільки її власник.");
    }

    const memberships = await ctx.db
      .query("fantasyPrivateLeagueMembers")
      .withIndex("by_league", (q) =>
        q.eq("privateLeagueId", privateLeague._id),
      )
      .collect();
    for (const membership of memberships) {
      await ctx.db.delete(membership._id);
    }
    await ctx.db.delete(privateLeague._id);

    return {
      deleted: true,
      id: privateLeague._id,
    };
  },
});

export const clearFantasyTeamsForSeason = mutation({
  args: {
    confirmation: v.string(),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.confirmation !== "DELETE_FANTASY_TEAMS") {
      throw new Error(
        "Передайте confirmation=DELETE_FANTASY_TEAMS для удаления fantasy-команд.",
      );
    }

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const fantasyTeams = await ctx.db
      .query("fantasyTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    const fantasyTeamIds = new Set(
      fantasyTeams.map((fantasyTeam) => fantasyTeam._id),
    );
    let deletedPicks = 0;
    let deletedGameweekScores = 0;
    let deletedGameweekSquadPicks = 0;
    let deletedTransfers = 0;
    let deletedPointDeductions = 0;

    for (const fantasyTeam of fantasyTeams) {
      const picks = await ctx.db
        .query("fantasySquadPicks")
        .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeam._id))
        .collect();

      for (const pick of picks) {
        await ctx.db.delete(pick._id);
        deletedPicks += 1;
      }
    }

    const [teamGameweekScores, gameweekSquadPicks, transfers, deductions] =
      await Promise.all([
        ctx.db
          .query("fantasyTeamGameweekScores")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyGameweekSquadPicks")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyTransfers")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyPointDeductions")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
      ]);

    for (const deduction of deductions) {
      if (!fantasyTeamIds.has(deduction.fantasyTeamId)) continue;

      await ctx.db.delete(deduction._id);
      deletedPointDeductions += 1;
    }

    for (const transfer of transfers) {
      if (!fantasyTeamIds.has(transfer.fantasyTeamId)) continue;

      await ctx.db.delete(transfer._id);
      deletedTransfers += 1;
    }

    for (const score of teamGameweekScores) {
      if (!fantasyTeamIds.has(score.fantasyTeamId)) continue;

      await ctx.db.delete(score._id);
      deletedGameweekScores += 1;
    }

    for (const snapshot of gameweekSquadPicks) {
      if (!fantasyTeamIds.has(snapshot.fantasyTeamId)) continue;

      await ctx.db.delete(snapshot._id);
      deletedGameweekSquadPicks += 1;
    }

    for (const fantasyTeam of fantasyTeams) {
      await ctx.db.delete(fantasyTeam._id);
    }

    return {
      deletedGameweekScores,
      deletedGameweekSquadPicks,
      deletedPicks,
      deletedPointDeductions,
      deletedTeams: fantasyTeams.length,
      deletedTransfers,
      seasonId: season._id,
    };
  },
});

export const upsertSeason = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    leagueName: v.string(),
    country: v.string(),
    displayName: v.optional(v.string()),
    shortName: v.optional(v.string()),
    description: v.optional(v.string()),
    logoKey: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    isVisible: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    status: v.optional(fantasySeasonStatusValidator),
    budget: v.optional(v.number()),
    squadSize: v.optional(v.number()),
    startingSlots: v.optional(v.number()),
    activeSlots: v.optional(v.number()),
    freeTransfersPerGameweek: v.optional(v.number()),
    maxFreeTransfers: v.optional(v.number()),
    maxTransfersPerGameweek: v.optional(v.number()),
    transferPenaltyPoints: v.optional(v.number()),
    priceChangeLimit: v.optional(v.number()),
    maxTeams: v.optional(v.number()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const slug = normalizeSlug(args.slug);
    const existing = await ctx.db
      .query("fantasySeasons")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    const payload = {
      slug,
      name: normalizeText(args.name),
      leagueName: normalizeText(args.leagueName),
      country: normalizeText(args.country),
      displayName: toOptionalText(args.displayName) ?? existing?.displayName,
      shortName: toOptionalText(args.shortName) ?? existing?.shortName,
      description: toOptionalText(args.description) ?? existing?.description,
      logoKey: toOptionalText(args.logoKey) ?? existing?.logoKey,
      primaryColor: toOptionalText(args.primaryColor) ?? existing?.primaryColor,
      secondaryColor:
        toOptionalText(args.secondaryColor) ?? existing?.secondaryColor,
      accentColor: toOptionalText(args.accentColor) ?? existing?.accentColor,
      isVisible: args.isVisible ?? existing?.isVisible ?? true,
      sortOrder: args.sortOrder ?? existing?.sortOrder ?? 1000,
      status: args.status ?? "draft",
      budget: args.budget ?? 100,
      squadSize: args.squadSize ?? FANTASY_SQUAD_SIZE,
      startingSlots: args.startingSlots ?? FANTASY_STARTING_SLOTS,
      activeSlots: args.activeSlots ?? FANTASY_ACTIVE_SLOTS,
      freeTransfersPerGameweek:
        args.freeTransfersPerGameweek ??
        existing?.freeTransfersPerGameweek ??
        FANTASY_FREE_TRANSFERS_PER_GAMEWEEK,
      maxFreeTransfers:
        args.maxFreeTransfers ??
        existing?.maxFreeTransfers ??
        FANTASY_MAX_FREE_TRANSFERS,
      maxTransfersPerGameweek:
        args.maxTransfersPerGameweek ??
        existing?.maxTransfersPerGameweek ??
        FANTASY_MAX_TRANSFERS_PER_GAMEWEEK,
      transferPenaltyPoints:
        args.transferPenaltyPoints ??
        existing?.transferPenaltyPoints ??
        FANTASY_TRANSFER_PENALTY_POINTS,
      priceChangeLimit:
        args.priceChangeLimit ??
        existing?.priceChangeLimit ??
        FANTASY_PRICE_CHANGE_LIMIT,
      maxTeams: args.maxTeams,
      startAt: args.startAt,
      endAt: args.endAt,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("fantasySeasons", {
      ...payload,
      createdAt: now,
    });
    await upsertDefaultScoringRules(ctx, id, now);
    return { id, created: true };
  },
});

export const syncDefaultScoringRules = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const result = await upsertDefaultScoringRules(ctx, season._id, Date.now());

    return {
      ...result,
      seasonId: season._id,
      scoringRules: toScoringRulesView(
        await getSeasonScoringRules(ctx, season._id),
        season._id,
      ),
    };
  },
});

export const seedExtraLeague2026_27 = mutation({
  args: {
    includeTestPlayers: v.optional(v.boolean()),
  },
  handler: async (ctx) => {
    await requireAdmin(ctx);
    throw new Error(
      "Dev season seed is disabled after live Extra-liga data import. Use targeted import/admin tools instead.",
    );
  },
});

export const deleteLegacyExtraLeague2025_26 = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const season = await ctx.db
      .query("fantasySeasons")
      .withIndex("by_slug", (q) =>
        q.eq("slug", LEGACY_EXTRA_LEAGUE_2025_26_SLUG),
      )
      .first();

    if (!season) {
      return {
        deleted: false,
        deletedRecords: {
          clubs: 0,
          fixtures: 0,
          gameweeks: 0,
          players: 0,
          season: 0,
          squadPicks: 0,
          stats: 0,
          teams: 0,
        },
      };
    }

    return {
      deleted: true,
      deletedRecords: await deleteFantasySeasonCascade(ctx, season),
    };
  },
});

export const cleanupAccidentalDevSeasonSeed = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(
      ctx,
      args.seasonSlug ?? EXTRA_LEAGUE_2026_27_SLUG,
    );
    const now = Date.now();
    const [players, clubs, fixtures, transfers, gameweekSquadPicks] =
      await Promise.all([
        ctx.db
          .query("fantasyPlayers")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyClubs")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyFixtures")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyTransfers")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        ctx.db
          .query("fantasyGameweekSquadPicks")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
      ]);

    const testPlayerIds = new Set(
      players
        .filter((player) => (player.externalId ?? "").includes("-test-"))
        .map((player) => player._id),
    );
    let deletedFavorites = 0;
    let deletedPlayerStats = 0;
    let deletedSquadPicks = 0;
    let deletedGameweekSquadPicks = 0;
    let deletedTestPlayers = 0;
    let deletedTransfers = 0;
    let deletedDuplicateClubs = 0;
    let restoredClubs = 0;

    for (const transfer of transfers) {
      const fromPlayerId = transfer.fromPlayerId ?? null;
      if (
        testPlayerIds.has(transfer.toPlayerId) ||
        (fromPlayerId && testPlayerIds.has(fromPlayerId))
      ) {
        await ctx.db.delete(transfer._id);
        deletedTransfers += 1;
      }
    }

    for (const snapshot of gameweekSquadPicks) {
      if (testPlayerIds.has(snapshot.playerId) === false) continue;

      await ctx.db.delete(snapshot._id);
      deletedGameweekSquadPicks += 1;
    }

    for (const playerId of testPlayerIds) {
      const [favorites, stats, squadPicks] = await Promise.all([
        ctx.db
          .query("fantasyPlayerFavorites")
          .withIndex("by_player", (q) => q.eq("playerId", playerId))
          .collect(),
        ctx.db
          .query("fantasyPlayerGameweekStats")
          .withIndex("by_season_player", (q) =>
            q.eq("seasonId", season._id).eq("playerId", playerId),
          )
          .collect(),
        ctx.db
          .query("fantasySquadPicks")
          .withIndex("by_player", (q) => q.eq("playerId", playerId))
          .collect(),
      ]);

      for (const favorite of favorites) {
        await ctx.db.delete(favorite._id);
        deletedFavorites += 1;
      }
      for (const stat of stats) {
        await ctx.db.delete(stat._id);
        deletedPlayerStats += 1;
      }
      for (const pick of squadPicks) {
        await ctx.db.delete(pick._id);
        deletedSquadPicks += 1;
      }
      await ctx.db.delete(playerId);
      deletedTestPlayers += 1;
    }

    const remainingPlayers = players.filter(
      (player) => !testPlayerIds.has(player._id),
    );
    for (const club of clubs) {
      if (
        EXTRA_LEAGUE_REAL_CLUB_NAMES_TO_RESTORE.has(club.name) &&
        !club.isActive
      ) {
        await ctx.db.patch(club._id, { isActive: true, updatedAt: now });
        restoredClubs += 1;
      }

      const hasRealPlayers = remainingPlayers.some(
        (player) => player.clubId === club._id,
      );
      const hasFixtures = fixtures.some(
        (fixture) =>
          fixture.homeClubId === club._id || fixture.awayClubId === club._id,
      );
      if (
        EXTRA_LEAGUE_ACCIDENTAL_DEV_CLUB_NAMES.has(club.name) &&
        !hasRealPlayers &&
        !hasFixtures
      ) {
        await ctx.db.delete(club._id);
        deletedDuplicateClubs += 1;
      }
    }

    return {
      deletedDuplicateClubs,
      deletedFavorites,
      deletedGameweekSquadPicks,
      deletedPlayerStats,
      deletedSquadPicks,
      deletedTestPlayers,
      deletedTransfers,
      restoredClubs,
      seasonId: season._id,
    };
  },
});

export const prepareExtraLeague2026_27Dev = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    throw new Error(
      "Dev season preparation is disabled after live Extra-liga data import. Use targeted import/admin tools instead.",
    );
  },
});

function getFixtureClubIdBySide(
  fixture: Doc<"fantasyFixtures">,
  side: FantasyFixtureSide,
) {
  return side === "home" ? fixture.homeClubId : fixture.awayClubId;
}

export const lockGameweek = mutation({
  args: {
    gameweekNumber: v.number(),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const gameweek = await findGameweekByNumber(
      ctx,
      season._id,
      args.gameweekNumber,
    );
    if (!gameweek) {
      throw new Error(`Тур ${args.gameweekNumber} не найден.`);
    }
    if (gameweek.status === "completed") {
      throw new Error("Завершенный тур нельзя заново заблокировать.");
    }

    const now = Date.now();
    const snapshotState = await ensureGameweekSquadSnapshots(
      ctx,
      season,
      gameweek,
      now,
    );
    await ctx.db.patch(gameweek._id, {
      status: "locked",
      updatedAt: now,
    });
    await ctx.db.patch(season._id, {
      currentGameweekId: gameweek._id,
      updatedAt: now,
    });

    return {
      gameweekId: gameweek._id,
      snapshotState,
      status: "locked" as const,
    };
  },
});

export const processPassedGameweekDeadlines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const seasons = await ctx.db.query("fantasySeasons").collect();
    let createdSnapshots = 0;
    let grantedTeams = 0;
    let processedGameweeks = 0;

    for (const season of seasons) {
      if (season.status === "completed" || season.status === "archived") {
        continue;
      }
      const result = await processSeasonDeadlineRollovers(ctx, season, now);
      createdSnapshots += result.createdSnapshots;
      grantedTeams += result.grantedTeams;
      processedGameweeks += result.processedGameweeks;
    }

    return { createdSnapshots, grantedTeams, processedGameweeks };
  },
});

export const syncUpcomingDeadlineReminderSchedules = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const seasons = await ctx.db.query("fantasySeasons").collect();
    let cancelled = 0;
    let checkedGameweeks = 0;
    let processedSeasons = 0;
    let scheduled = 0;
    let skippedPast = 0;
    let unchanged = 0;

    for (const season of seasons) {
      if (season.status === "completed" || season.status === "archived") {
        continue;
      }

      const gameweeks = await getSeasonGameweeks(ctx, season._id);
      processedSeasons += 1;
      for (const gameweek of gameweeks) {
        const result = await syncGameweekDeadlineReminderSchedules(
          ctx,
          gameweek,
          now,
        );
        checkedGameweeks += 1;
        cancelled += result.cancelled;
        scheduled += result.scheduled;
        skippedPast += result.skippedPast;
        unchanged += result.unchanged;
      }
    }

    return {
      cancelled,
      checkedGameweeks,
      processedSeasons,
      scheduled,
      skippedPast,
      unchanged,
    };
  },
});

async function processStartedFixturesForSeason(
  ctx: MutationCtx,
  season: Doc<"fantasySeasons">,
  now: number,
) {
  const startedAfter = now - FIXTURE_AUTO_LIVE_LOOKBACK_MS;
  const fixtures = await ctx.db
    .query("fantasyFixtures")
    .withIndex("by_season_scheduled_at", (q) =>
      q
        .eq("seasonId", season._id)
        .gte("scheduledAt", startedAfter)
        .lte("scheduledAt", now),
    )
    .collect();
  const liveGameweekIds = new Set<Id<"fantasyGameweeks">>();
  let updatedFixtures = 0;
  let updatedGameweeks = 0;

  for (const fixture of fixtures) {
    if (fixture.status !== "scheduled") continue;

    await ctx.db.patch(fixture._id, {
      status: "live",
      homeScore: fixture.homeScore ?? 0,
      awayScore: fixture.awayScore ?? 0,
      updatedAt: now,
    });
    updatedFixtures += 1;
    if (fixture.gameweekId) {
      liveGameweekIds.add(fixture.gameweekId);
    }
  }

  for (const gameweekId of liveGameweekIds) {
    const gameweek = await ctx.db.get(gameweekId);
    if (
      !gameweek ||
      gameweek.seasonId !== season._id ||
      gameweek.status === "completed" ||
      gameweek.status === "live"
    ) {
      continue;
    }

    await ctx.db.patch(gameweek._id, {
      status: "live",
      updatedAt: now,
    });
    updatedGameweeks += 1;
  }

  return {
    checkedFixtures: fixtures.length,
    updatedFixtures,
    updatedGameweeks,
  };
}

export const processStartedFixtures = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const seasons = await ctx.db.query("fantasySeasons").collect();
    let checkedFixtures = 0;
    let processedSeasons = 0;
    let updatedFixtures = 0;
    let updatedGameweeks = 0;

    for (const season of seasons) {
      if (season.status === "completed" || season.status === "archived") {
        continue;
      }
      const result = await processStartedFixturesForSeason(ctx, season, now);
      checkedFixtures += result.checkedFixtures;
      updatedFixtures += result.updatedFixtures;
      updatedGameweeks += result.updatedGameweeks;
      processedSeasons += 1;
    }

    return {
      checkedFixtures,
      processedSeasons,
      updatedFixtures,
      updatedGameweeks,
    };
  },
});

export const processStartedFixturesNow = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const now = Date.now();
    if (args.seasonSlug) {
      const season = await requireExistingSeason(ctx, args.seasonSlug);
      return {
        processedSeasons: 1,
        ...(await processStartedFixturesForSeason(ctx, season, now)),
      };
    }

    const seasons = await ctx.db.query("fantasySeasons").collect();
    let checkedFixtures = 0;
    let processedSeasons = 0;
    let updatedFixtures = 0;
    let updatedGameweeks = 0;

    for (const season of seasons) {
      if (season.status === "completed" || season.status === "archived") {
        continue;
      }
      const result = await processStartedFixturesForSeason(ctx, season, now);
      checkedFixtures += result.checkedFixtures;
      updatedFixtures += result.updatedFixtures;
      updatedGameweeks += result.updatedGameweeks;
      processedSeasons += 1;
    }

    return {
      checkedFixtures,
      processedSeasons,
      updatedFixtures,
      updatedGameweeks,
    };
  },
});

export const processPassedGameweekDeadlinesNow = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const now = Date.now();
    if (args.seasonSlug) {
      const season = await requireExistingSeason(ctx, args.seasonSlug);
      return await processSeasonDeadlineRollovers(ctx, season, now);
    }

    const seasons = await ctx.db.query("fantasySeasons").collect();
    let createdSnapshots = 0;
    let grantedTeams = 0;
    let processedGameweeks = 0;

    for (const season of seasons) {
      if (season.status === "completed" || season.status === "archived") {
        continue;
      }
      const result = await processSeasonDeadlineRollovers(ctx, season, now);
      createdSnapshots += result.createdSnapshots;
      grantedTeams += result.grantedTeams;
      processedGameweeks += result.processedGameweeks;
    }

    return { createdSnapshots, grantedTeams, processedGameweeks };
  },
});

export const setFixtureResult = mutation({
  args: {
    fixtureId: v.id("fantasyFixtures"),
    homeScore: v.number(),
    awayScore: v.number(),
    status: v.optional(fantasyFixtureStatusValidator),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const fixture = await ctx.db.get(args.fixtureId);
    if (!fixture) {
      throw new Error("Матч не найден.");
    }
    if (
      !Number.isInteger(args.homeScore) ||
      args.homeScore < 0 ||
      !Number.isInteger(args.awayScore) ||
      args.awayScore < 0
    ) {
      throw new Error("Счет матча должен быть неотрицательным целым числом.");
    }

    const now = Date.now();
    await ctx.db.patch(fixture._id, {
      awayScore: args.awayScore,
      homeScore: args.homeScore,
      status: args.status ?? "completed",
      updatedAt: now,
    });
    const updatedFixture = (await ctx.db.get(fixture._id)) ?? fixture;
    const refresh = await refreshGameweekAfterFixtureChange(
      ctx,
      updatedFixture,
      now,
    );

    return {
      fixtureId: fixture._id,
      refresh,
      status: args.status ?? "completed",
    };
  },
});

export const upsertFixtureEvent = mutation({
  args: {
    eventId: v.optional(v.id("fantasyFixtureEvents")),
    fixtureId: v.id("fantasyFixtures"),
    type: fantasyFixtureEventTypeValidator,
    side: fantasyFixtureSideValidator,
    playerId: v.optional(v.id("fantasyPlayers")),
    playerName: v.optional(v.string()),
    clubId: v.optional(v.id("fantasyClubs")),
    minute: v.optional(v.number()),
    period: v.optional(
      v.union(
        v.literal("first_half"),
        v.literal("second_half"),
        v.literal("extra_time"),
        v.literal("penalty_shootout"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const fixture = await ctx.db.get(args.fixtureId);
    if (!fixture) {
      throw new Error("Матч не найден.");
    }
    if (
      args.minute !== undefined &&
      (!Number.isFinite(args.minute) || args.minute < 0)
    ) {
      throw new Error("Минута события должна быть неотрицательным числом.");
    }

    const [player, explicitClub, existingEvent, scoringRule] =
      await Promise.all([
        args.playerId ? ctx.db.get(args.playerId) : Promise.resolve(null),
        args.clubId ? ctx.db.get(args.clubId) : Promise.resolve(null),
        args.eventId ? ctx.db.get(args.eventId) : Promise.resolve(null),
        getSeasonScoringRules(ctx, fixture.seasonId),
      ]);
    if (args.playerId && (!player || player.seasonId !== fixture.seasonId)) {
      throw new Error("Игрок не найден в сезоне этого матча.");
    }
    if (
      args.clubId &&
      (!explicitClub || explicitClub.seasonId !== fixture.seasonId)
    ) {
      throw new Error("Клуб не найден в сезоне этого матча.");
    }
    if (
      args.eventId &&
      (!existingEvent || existingEvent.fixtureId !== fixture._id)
    ) {
      throw new Error("Событие не найдено в этом матче.");
    }

    const now = Date.now();
    const eventClubId =
      args.clubId ??
      player?.clubId ??
      getFixtureClubIdBySide(fixture, args.side);
    const eventPoints = player
      ? getFixtureEventPoints(
          args.type,
          player,
          getScoringRuleValues(scoringRule),
        )
      : undefined;
    const payload = {
      seasonId: fixture.seasonId,
      fixtureId: fixture._id,
      gameweekId: fixture.gameweekId,
      clubId: eventClubId,
      playerId: player?._id,
      playerName: player?.displayName ?? toOptionalText(args.playerName),
      side: args.side,
      type: args.type,
      minute: args.minute,
      period: args.period,
      points: eventPoints,
      updatedAt: now,
    };

    if (existingEvent) {
      await ctx.db.patch(existingEvent._id, payload);
      const refresh = await refreshGameweekAfterFixtureChange(
        ctx,
        fixture,
        now,
      );
      const suspensionSync = await syncFantasyPlayerSuspensionsForSeason(
        ctx,
        fixture.seasonId,
        now,
      );
      return {
        created: false,
        eventId: existingEvent._id,
        points: eventPoints ?? null,
        refresh,
        suspensionSync,
      };
    }

    const eventId = await ctx.db.insert("fantasyFixtureEvents", {
      ...payload,
      createdAt: now,
    });
    const refresh = await refreshGameweekAfterFixtureChange(ctx, fixture, now);
    const suspensionSync = await syncFantasyPlayerSuspensionsForSeason(
      ctx,
      fixture.seasonId,
      now,
    );
    return {
      created: true,
      eventId,
      points: eventPoints ?? null,
      refresh,
      suspensionSync,
    };
  },
});

function normalizeFixtureEventPlayerLookup(value: string) {
  return foldLatinDiacriticsToAscii(normalizeText(value))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[´`'’ʼ]/g, "")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
    .trim();
}

const LATIN_ASCII_CHAR_REPLACEMENTS: Record<string, string> = {
  Æ: "AE",
  æ: "ae",
  Ð: "D",
  ð: "d",
  Đ: "D",
  đ: "d",
  Ħ: "H",
  ħ: "h",
  Ĳ: "IJ",
  ĳ: "ij",
  Ł: "L",
  ł: "l",
  Ŋ: "N",
  ŋ: "n",
  Œ: "OE",
  œ: "oe",
  Ø: "O",
  ø: "o",
  ẞ: "SS",
  ß: "ss",
  Þ: "Th",
  þ: "th",
  Ŧ: "T",
  ŧ: "t",
  İ: "I",
  ı: "i",
};

function foldLatinDiacriticsToAscii(value: string) {
  return Array.from(value)
    .map((character) => LATIN_ASCII_CHAR_REPLACEMENTS[character] ?? character)
    .join("");
}

function getFixtureEventPlayerNameCandidates(player: Doc<"fantasyPlayers">) {
  return [
    player.displayName,
    player.lastName,
    [player.firstName, player.lastName].filter(Boolean).join(" "),
  ].filter(Boolean);
}

function matchesFixtureEventPlayerName(
  player: Doc<"fantasyPlayers">,
  lookupName: string,
) {
  const normalizedLookup = normalizeFixtureEventPlayerLookup(lookupName);
  if (!normalizedLookup) return false;

  return getFixtureEventPlayerNameCandidates(player).some((candidate) => {
    const normalizedCandidate = normalizeFixtureEventPlayerLookup(candidate);
    return (
      normalizedCandidate === normalizedLookup ||
      normalizedCandidate.split(" ").includes(normalizedLookup)
    );
  });
}

export const replaceFixtureEvents = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
    fixtureId: v.optional(v.id("fantasyFixtures")),
    fixtureExternalId: v.optional(v.string()),
    homeScore: v.optional(v.number()),
    awayScore: v.optional(v.number()),
    status: v.optional(fantasyFixtureStatusValidator),
    events: v.array(
      v.object({
        type: fantasyFixtureEventTypeValidator,
        side: fantasyFixtureSideValidator,
        playerId: v.optional(v.id("fantasyPlayers")),
        playerName: v.optional(v.string()),
        clubId: v.optional(v.id("fantasyClubs")),
        minute: v.optional(v.number()),
        period: v.optional(
          v.union(
            v.literal("first_half"),
            v.literal("second_half"),
            v.literal("extra_time"),
            v.literal("penalty_shootout"),
          ),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const externalId = toOptionalText(args.fixtureExternalId);
    const fixture = args.fixtureId
      ? await ctx.db.get(args.fixtureId)
      : externalId
        ? await ctx.db
            .query("fantasyFixtures")
            .withIndex("by_season_external_id", (q) =>
              q.eq("seasonId", season._id).eq("externalId", externalId),
            )
            .first()
        : null;
    if (!fixture || fixture.seasonId !== season._id) {
      throw new Error("Матч не найден.");
    }
    if (
      args.homeScore !== undefined &&
      (!Number.isInteger(args.homeScore) || args.homeScore < 0)
    ) {
      throw new Error("Счет хозяев должен быть неотрицательным целым числом.");
    }
    if (
      args.awayScore !== undefined &&
      (!Number.isInteger(args.awayScore) || args.awayScore < 0)
    ) {
      throw new Error("Счет гостей должен быть неотрицательным целым числом.");
    }
    for (const event of args.events) {
      if (
        event.minute !== undefined &&
        (!Number.isFinite(event.minute) || event.minute < 0)
      ) {
        throw new Error("Минута события должна быть неотрицательным числом.");
      }
    }

    const [players, lineups, existingEvents, scoringRule] = await Promise.all([
      ctx.db
        .query("fantasyPlayers")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyFixtureLineups")
        .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
        .collect(),
      ctx.db
        .query("fantasyFixtureEvents")
        .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
        .collect(),
      getSeasonScoringRules(ctx, fixture.seasonId),
    ]);
    const playersById = new Map(players.map((player) => [player._id, player]));
    const lineupPlayerIdsBySide = new Map<
      FantasyFixtureSide,
      Set<Id<"fantasyPlayers">>
    >([
      ["home", new Set()],
      ["away", new Set()],
    ]);
    for (const lineup of lineups) {
      if (!lineup.playerId) continue;
      lineupPlayerIdsBySide.get(lineup.side)?.add(lineup.playerId);
    }

    const resolveEventPlayer = async (event: {
      clubId?: Id<"fantasyClubs">;
      playerId?: Id<"fantasyPlayers">;
      playerName?: string;
      side: FantasyFixtureSide;
    }) => {
      const sideClubId = getFixtureClubIdBySide(fixture, event.side);
      if (event.clubId) {
        const club = await ctx.db.get(event.clubId);
        if (!club || club.seasonId !== season._id) {
          throw new Error("Клуб события не найден в сезоне этого матча.");
        }
      }
      if (event.playerId) {
        const player = playersById.get(event.playerId);
        if (!player) {
          throw new Error("Игрок не найден в сезоне этого матча.");
        }
        if (sideClubId && player.clubId && player.clubId !== sideClubId) {
          throw new Error(
            `Игрок ${player.displayName} не относится к стороне ${event.side}.`,
          );
        }
        return player;
      }

      const playerName = toOptionalText(event.playerName);
      if (!playerName) return null;

      const lineupPlayerIds = lineupPlayerIdsBySide.get(event.side);
      let matchingPlayers = players.filter((player) => {
        if (sideClubId && player.clubId !== sideClubId) return false;
        if (lineupPlayerIds?.size && !lineupPlayerIds.has(player._id)) {
          return false;
        }
        return matchesFixtureEventPlayerName(player, playerName);
      });

      if (matchingPlayers.length === 0 && lineupPlayerIds?.size) {
        matchingPlayers = players.filter((player) => {
          if (sideClubId && player.clubId !== sideClubId) return false;
          return matchesFixtureEventPlayerName(player, playerName);
        });
      }

      if (matchingPlayers.length === 0) {
        throw new Error(`Игрок ${playerName} не найден.`);
      }
      if (matchingPlayers.length > 1) {
        throw new Error(
          `Найдено несколько игроков для ${playerName}: ${matchingPlayers
            .map((player) => player.displayName)
            .join(", ")}.`,
        );
      }

      return matchingPlayers[0];
    };

    const scoringRuleValues = getScoringRuleValues(scoringRule);
    const resolvedEvents = [];
    for (const event of args.events) {
      const player = await resolveEventPlayer(event);
      const eventClubId =
        event.clubId ??
        player?.clubId ??
        getFixtureClubIdBySide(fixture, event.side);
      const points = player
        ? getFixtureEventPoints(event.type, player, scoringRuleValues)
        : undefined;

      resolvedEvents.push({
        clubId: eventClubId,
        player,
        points,
        source: event,
      });
    }

    const now = Date.now();
    for (const event of existingEvents) {
      await ctx.db.delete(event._id);
    }

    const fixturePatch: Partial<Doc<"fantasyFixtures">> = { updatedAt: now };
    if (args.homeScore !== undefined) fixturePatch.homeScore = args.homeScore;
    if (args.awayScore !== undefined) fixturePatch.awayScore = args.awayScore;
    if (args.status !== undefined) fixturePatch.status = args.status;
    await ctx.db.patch(fixture._id, fixturePatch);

    const created = [];
    for (const event of resolvedEvents) {
      const eventId = await ctx.db.insert("fantasyFixtureEvents", {
        seasonId: fixture.seasonId,
        fixtureId: fixture._id,
        gameweekId: fixture.gameweekId,
        clubId: event.clubId,
        playerId: event.player?._id,
        playerName:
          event.player?.displayName ?? toOptionalText(event.source.playerName),
        side: event.source.side,
        type: event.source.type,
        minute: event.source.minute,
        period: event.source.period,
        points: event.points,
        createdAt: now,
        updatedAt: now,
      });
      created.push({
        id: eventId,
        playerId: event.player?._id ?? null,
        playerName:
          event.player?.displayName ?? toOptionalText(event.source.playerName),
        points: event.points ?? null,
        side: event.source.side,
        type: event.source.type,
      });
    }

    const updatedFixture = (await ctx.db.get(fixture._id)) ?? fixture;
    const refresh = await refreshGameweekAfterFixtureChange(
      ctx,
      updatedFixture,
      now,
    );
    const suspensionSync = await syncFantasyPlayerSuspensionsForSeason(
      ctx,
      fixture.seasonId,
      now,
    );

    return {
      deleted: existingEvents.length,
      created: created.length,
      events: created,
      fixtureId: fixture._id,
      refresh,
      suspensionSync,
    };
  },
});

export const upsertFixtureLineup = mutation({
  args: {
    fixtureId: v.id("fantasyFixtures"),
    side: fantasyFixtureSideValidator,
    playerId: v.id("fantasyPlayers"),
    isStarter: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const [fixture, player] = await Promise.all([
      ctx.db.get(args.fixtureId),
      ctx.db.get(args.playerId),
    ]);
    if (!fixture) {
      throw new Error("Матч не найден.");
    }
    if (!player || player.seasonId !== fixture.seasonId) {
      throw new Error("Игрок не найден в сезоне этого матча.");
    }

    const existingLineups = await ctx.db
      .query("fantasyFixtureLineups")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();
    const existingLineup =
      existingLineups.find((lineup) => lineup.fixtureId === fixture._id) ??
      null;
    const now = Date.now();
    const payload = {
      seasonId: fixture.seasonId,
      fixtureId: fixture._id,
      clubId: player.clubId ?? getFixtureClubIdBySide(fixture, args.side),
      playerId: player._id,
      playerName: player.displayName,
      side: args.side,
      jerseyNumber: player.jerseyNumber,
      position: player.position,
      isStarter: args.isStarter ?? true,
      updatedAt: now,
    };

    if (existingLineup) {
      await ctx.db.patch(existingLineup._id, payload);
      const refresh = await refreshGameweekAfterFixtureChange(
        ctx,
        fixture,
        now,
      );
      return { created: false, lineupId: existingLineup._id, refresh };
    }

    const lineupId = await ctx.db.insert("fantasyFixtureLineups", {
      ...payload,
      createdAt: now,
    });
    const refresh = await refreshGameweekAfterFixtureChange(ctx, fixture, now);
    return { created: true, lineupId, refresh };
  },
});

export const replaceFixtureLineups = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
    fixtureId: v.optional(v.id("fantasyFixtures")),
    fixtureExternalId: v.optional(v.string()),
    lineups: v.array(
      v.object({
        side: fantasyFixtureSideValidator,
        playerExternalId: v.optional(v.string()),
        playerName: v.optional(v.string()),
        jerseyNumber: v.optional(v.union(v.number(), v.null())),
        position: v.optional(fantasyPlayerPositionValidator),
        isStarter: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const externalId = toOptionalText(args.fixtureExternalId);
    const fixture = args.fixtureId
      ? await ctx.db.get(args.fixtureId)
      : externalId
        ? await ctx.db
            .query("fantasyFixtures")
            .withIndex("by_season_external_id", (q) =>
              q.eq("seasonId", season._id).eq("externalId", externalId),
            )
            .first()
        : null;
    if (!fixture || fixture.seasonId !== season._id) {
      throw new Error("Матч не найден.");
    }

    const [players, existingLineups] = await Promise.all([
      ctx.db
        .query("fantasyPlayers")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyFixtureLineups")
        .withIndex("by_fixture", (q) => q.eq("fixtureId", fixture._id))
        .collect(),
    ]);
    const playersByExternalId = new Map(
      players
        .filter((player) => player.externalId)
        .map((player) => [player.externalId as string, player]),
    );
    const now = Date.now();

    for (const lineup of existingLineups) {
      await ctx.db.delete(lineup._id);
    }

    const created = [];
    for (const lineup of args.lineups) {
      const playerExternalId = toOptionalText(lineup.playerExternalId);
      const sideClubId = getFixtureClubIdBySide(fixture, lineup.side);
      const playerByExternalId = playerExternalId
        ? playersByExternalId.get(playerExternalId)
        : undefined;
      const normalizedPlayerName = normalizeText(
        lineup.playerName ?? "",
      ).toLowerCase();
      const matchingPlayers = playerByExternalId
        ? [playerByExternalId]
        : players.filter((player) => {
            if (sideClubId && player.clubId !== sideClubId) return false;
            const names = [
              player.displayName,
              player.lastName,
              [player.firstName, player.lastName].filter(Boolean).join(" "),
            ]
              .filter(Boolean)
              .map((value) => normalizeText(value).toLowerCase());
            return normalizedPlayerName
              ? names.includes(normalizedPlayerName)
              : false;
          });

      if (matchingPlayers.length === 0) {
        throw new Error(
          `Игрок ${lineup.playerName ?? playerExternalId ?? "без имени"} не найден.`,
        );
      }
      if (matchingPlayers.length > 1) {
        throw new Error(
          `Найдено несколько игроков для ${lineup.playerName}: ${matchingPlayers
            .map((player) => player.displayName)
            .join(", ")}.`,
        );
      }

      const player = matchingPlayers[0];
      const payload = {
        seasonId: fixture.seasonId,
        fixtureId: fixture._id,
        clubId: player.clubId ?? sideClubId,
        playerId: player._id,
        playerName: player.displayName,
        side: lineup.side,
        jerseyNumber:
          lineup.jerseyNumber === undefined
            ? player.jerseyNumber
            : (lineup.jerseyNumber ?? undefined),
        position: lineup.position ?? player.position,
        isStarter: lineup.isStarter ?? true,
        createdAt: now,
        updatedAt: now,
      };
      const lineupId = await ctx.db.insert("fantasyFixtureLineups", payload);
      created.push({
        id: lineupId,
        playerId: player._id,
        playerName: payload.playerName,
        side: payload.side,
        jerseyNumber: payload.jerseyNumber ?? null,
        isStarter: payload.isStarter,
      });
    }

    const refresh = await refreshGameweekAfterFixtureChange(ctx, fixture, now);
    return {
      deleted: existingLineups.length,
      created: created.length,
      lineups: created,
      refresh,
    };
  },
});

export const deleteFixtureLineup = mutation({
  args: {
    lineupId: v.id("fantasyFixtureLineups"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const lineup = await ctx.db.get(args.lineupId);
    if (!lineup) {
      return { deleted: false };
    }

    const fixture = await ctx.db.get(lineup.fixtureId);
    await ctx.db.delete(lineup._id);
    const refresh = fixture
      ? await refreshGameweekAfterFixtureChange(ctx, fixture, Date.now())
      : null;
    return { deleted: true, refresh };
  },
});

export const deleteFixtureEvent = mutation({
  args: {
    eventId: v.id("fantasyFixtureEvents"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      return { deleted: false };
    }

    const fixture = await ctx.db.get(event.fixtureId);
    const now = Date.now();
    await ctx.db.delete(event._id);
    const refresh = fixture
      ? await refreshGameweekAfterFixtureChange(ctx, fixture, now)
      : null;
    const suspensionSync = await syncFantasyPlayerSuspensionsForSeason(
      ctx,
      event.seasonId,
      now,
    );
    return { deleted: true, refresh, suspensionSync };
  },
});

export const resetGameweekSimulation = mutation({
  args: {
    gameweekNumber: v.number(),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const gameweek = await findGameweekByNumber(
      ctx,
      season._id,
      args.gameweekNumber,
    );
    if (!gameweek) {
      throw new Error(`Тур ${args.gameweekNumber} не найден.`);
    }

    const now = Date.now();
    const [
      fixtures,
      events,
      playerStats,
      teamScores,
      snapshots,
      transfers,
      pointDeductions,
      priceHistories,
    ] = await Promise.all([
      ctx.db
        .query("fantasyFixtures")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
      ctx.db
        .query("fantasyFixtureEvents")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerGameweekStats")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
      ctx.db
        .query("fantasyTeamGameweekScores")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
      ctx.db
        .query("fantasyGameweekSquadPicks")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
      ctx.db
        .query("fantasyTransfers")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
      ctx.db
        .query("fantasyPointDeductions")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyPlayerPriceHistory")
        .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
        .collect(),
    ]);

    const participatingTeamIds = new Set(
      teamScores
        .filter((score) => score.participated)
        .map((score) => score.fantasyTeamId),
    );
    const shouldRevokeFreeTransfers = !!gameweek.freeTransfersGrantedAt;
    const freeTransfersToRevoke = shouldRevokeFreeTransfers
      ? getSeasonFreeTransfersPerGameweek(season)
      : 0;
    let deletedPointDeductions = 0;
    let deletedPriceHistories = 0;
    let revertedPriceChanges = 0;

    for (const priceHistory of priceHistories) {
      if (priceHistory.reason !== "gameweek_recalculation") continue;
      const player = await ctx.db.get(priceHistory.playerId);
      if (player) {
        await ctx.db.patch(player._id, {
          price: priceHistory.oldPrice,
          updatedAt: now,
        });
        revertedPriceChanges += 1;
      }
      await ctx.db.delete(priceHistory._id);
      deletedPriceHistories += 1;
    }

    const transferIdsToDelete = new Set(
      transfers.map((transfer) => transfer._id),
    );
    for (const event of events) await ctx.db.delete(event._id);
    for (const stat of playerStats) await ctx.db.delete(stat._id);
    for (const score of teamScores) await ctx.db.delete(score._id);
    for (const snapshot of snapshots) await ctx.db.delete(snapshot._id);
    for (const deduction of pointDeductions) {
      if (!deduction.sourceId || !transferIdsToDelete.has(deduction.sourceId)) {
        continue;
      }
      await ctx.db.delete(deduction._id);
      deletedPointDeductions += 1;
    }
    for (const transfer of transfers) await ctx.db.delete(transfer._id);

    for (const fixture of fixtures) {
      await ctx.db.patch(fixture._id, {
        awayScore: undefined,
        homeScore: undefined,
        status: "scheduled",
        updatedAt: now,
      });
    }

    const fantasyTeams = await ctx.db
      .query("fantasyTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    for (const fantasyTeam of fantasyTeams) {
      const totalPoints = await calculateFantasyTeamTotalPoints(
        ctx,
        season._id,
        fantasyTeam._id,
      );
      await ctx.db.patch(fantasyTeam._id, {
        totalPoints,
        ...(shouldRevokeFreeTransfers &&
        participatingTeamIds.has(fantasyTeam._id)
          ? {
              freeTransfers: Math.max(
                0,
                fantasyTeam.freeTransfers - freeTransfersToRevoke,
              ),
            }
          : {}),
        updatedAt: now,
      });
    }

    await ctx.db.patch(gameweek._id, {
      completedAt: undefined,
      freeTransfersGrantedAt: undefined,
      status: "open",
      updatedAt: now,
    });
    await ctx.db.patch(season._id, {
      currentGameweekId: gameweek._id,
      updatedAt: now,
    });
    const suspensionSync = await syncFantasyPlayerSuspensionsForSeason(
      ctx,
      season._id,
      now,
    );

    return {
      deletedEvents: events.length,
      deletedPlayerStats: playerStats.length,
      deletedSnapshots: snapshots.length,
      deletedPointDeductions,
      deletedPriceHistories,
      deletedTeamScores: teamScores.length,
      deletedTransfers: transfers.length,
      gameweekId: gameweek._id,
      revertedPriceChanges,
      revokedFreeTransfersFromTeams: shouldRevokeFreeTransfers
        ? participatingTeamIds.size
        : 0,
      resetFixtures: fixtures.length,
      suspensionSync,
    };
  },
});

export const syncPlayerSuspensions = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    return await syncFantasyPlayerSuspensionsForSeason(
      ctx,
      season._id,
      Date.now(),
    );
  },
});

export const markGameweekNonParticipantsDoubtful = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
    gameweekNumber: v.optional(v.number()),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const gameweekNumber = args.gameweekNumber ?? 1;
    const gameweek = await findGameweekByNumber(
      ctx,
      season._id,
      gameweekNumber,
    );
    if (!gameweek) {
      throw new Error(`Тур ${gameweekNumber} не найден.`);
    }

    const now = Date.now();
    if (!args.dryRun) {
      await syncFantasyPlayerSuspensionsForSeason(ctx, season._id, now);
    }

    return await markGameweekNonParticipantsDoubtfulInternal(
      ctx,
      season,
      gameweek,
      now,
      { dryRun: args.dryRun },
    );
  },
});

export const clearGameweekDeadline = mutation({
  args: {
    gameweekNumber: v.number(),
    makeCurrent: v.optional(v.boolean()),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const gameweek = await findGameweekByNumber(
      ctx,
      season._id,
      args.gameweekNumber,
    );
    if (!gameweek) {
      throw new Error(`Тур ${args.gameweekNumber} не найден.`);
    }

    const now = Date.now();
    await ctx.db.patch(gameweek._id, {
      deadlineAt: undefined,
      status: "open",
      updatedAt: now,
    });
    const deadlineReminderSchedules =
      await syncGameweekDeadlineReminderSchedules(
        ctx,
        {
          _id: gameweek._id,
          deadlineAt: undefined,
          name: gameweek.name,
          number: gameweek.number,
          status: "open",
        },
        now,
      );

    if (args.makeCurrent ?? true) {
      await ctx.db.patch(season._id, {
        currentGameweekId: gameweek._id,
        updatedAt: now,
      });
    }

    return {
      gameweekId: gameweek._id,
      deadlineReminderSchedules,
      previousDeadlineAt: gameweek.deadlineAt ?? null,
      status: "open",
    };
  },
});

export const backfillTransferPointDeductions = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const [transfers, existingDeductions] = await Promise.all([
      ctx.db
        .query("fantasyTransfers")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyPointDeductions")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
    ]);

    const existingTransferDeductionSourceIds = new Set(
      existingDeductions
        .filter(
          (deduction) =>
            deduction.source === "transfer" && deduction.sourceId !== undefined,
        )
        .map((deduction) => String(deduction.sourceId)),
    );
    const affectedFantasyTeamIds = new Set<Id<"fantasyTeams">>();
    let createdDeductions = 0;
    let skippedFreeTransfers = 0;
    let skippedExistingDeductions = 0;

    for (const transfer of transfers) {
      if (transfer.penaltyPoints <= 0) {
        skippedFreeTransfers += 1;
        continue;
      }
      if (existingTransferDeductionSourceIds.has(String(transfer._id))) {
        skippedExistingDeductions += 1;
        continue;
      }

      await ctx.db.insert("fantasyPointDeductions", {
        seasonId: transfer.seasonId,
        fantasyTeamId: transfer.fantasyTeamId,
        userId: transfer.userId,
        source: "transfer",
        sourceId: transfer._id,
        points: transfer.penaltyPoints,
        reason: "Paid transfer",
        createdAt: transfer.createdAt,
        updatedAt: now,
      });
      existingTransferDeductionSourceIds.add(String(transfer._id));
      affectedFantasyTeamIds.add(transfer.fantasyTeamId);
      createdDeductions += 1;
    }

    let syncedTeams = 0;
    for (const fantasyTeamId of affectedFantasyTeamIds) {
      const fantasyTeam = await ctx.db.get(fantasyTeamId);
      if (!fantasyTeam) continue;
      await syncFantasyTeamTotalPoints(ctx, fantasyTeam, now);
      syncedTeams += 1;
    }

    return {
      createdDeductions,
      seasonId: season._id,
      skippedExistingDeductions,
      skippedFreeTransfers,
      syncedTeams,
    };
  },
});

export const recalculateGameweekScores = mutation({
  args: {
    gameweekNumber: v.number(),
    requireCompletedFixtures: v.optional(v.boolean()),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const gameweek = await findGameweekByNumber(
      ctx,
      season._id,
      args.gameweekNumber,
    );
    if (!gameweek) {
      throw new Error(`Тур ${args.gameweekNumber} не найден.`);
    }

    const fixtures = await ctx.db
      .query("fantasyFixtures")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect();
    const unresolvedFixtures = fixtures.filter(
      (fixture) =>
        fixture.status !== "cancelled" &&
        fixture.status !== "postponed" &&
        fixture.status !== "completed",
    );
    if (
      (args.requireCompletedFixtures ?? true) &&
      unresolvedFixtures.length > 0
    ) {
      throw new Error("Нельзя пересчитать тур: не все матчи завершены.");
    }

    return await recalculateGameweekScoresInternal(
      ctx,
      season,
      gameweek,
      Date.now(),
    );
  },
});

export const repairLateFantasyTeamGameweekParticipation = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const [gameweeks, fantasyTeams, scores, snapshots] = await Promise.all([
      getSeasonGameweeks(ctx, season._id),
      ctx.db
        .query("fantasyTeams")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyTeamGameweekScores")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyGameweekSquadPicks")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
    ]);
    const gameweeksById = new Map(
      gameweeks.map((gameweek) => [gameweek._id, gameweek]),
    );
    const fantasyTeamsById = new Map(
      fantasyTeams.map((fantasyTeam) => [fantasyTeam._id, fantasyTeam]),
    );
    const affectedTeamIds = new Set<Id<"fantasyTeams">>();
    const isLateTeamGameweek = (
      fantasyTeamId: Id<"fantasyTeams">,
      gameweekId: Id<"fantasyGameweeks">,
    ) => {
      const fantasyTeam = fantasyTeamsById.get(fantasyTeamId);
      const gameweek = gameweeksById.get(gameweekId);
      return (
        !fantasyTeam ||
        !gameweek ||
        !canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
      );
    };

    let deletedSnapshots = 0;
    for (const snapshot of snapshots) {
      if (snapshot.seasonId !== season._id) continue;
      if (!isLateTeamGameweek(snapshot.fantasyTeamId, snapshot.gameweekId)) {
        continue;
      }

      affectedTeamIds.add(snapshot.fantasyTeamId);
      await ctx.db.delete(snapshot._id);
      deletedSnapshots += 1;
    }

    let correctedScores = 0;
    for (const score of scores) {
      if (score.seasonId !== season._id) continue;
      if (!isLateTeamGameweek(score.fantasyTeamId, score.gameweekId)) {
        continue;
      }

      affectedTeamIds.add(score.fantasyTeamId);
      if (
        !score.participated &&
        score.points === 0 &&
        (score.basePoints ?? 0) === 0 &&
        (score.captainBonusPoints ?? 0) === 0 &&
        (score.transferPenaltyPoints ?? 0) === 0 &&
        (score.totalPointsAfterGameweek ?? 0) === 0
      ) {
        continue;
      }

      await ctx.db.patch(score._id, {
        basePoints: 0,
        captainBonusPoints: 0,
        points: 0,
        participated: false,
        totalPointsAfterGameweek: 0,
        transferPenaltyPoints: 0,
        updatedAt: now,
      });
      correctedScores += 1;
    }

    let syncedTeams = 0;
    for (const fantasyTeamId of affectedTeamIds) {
      const fantasyTeam =
        fantasyTeamsById.get(fantasyTeamId) ??
        (await ctx.db.get(fantasyTeamId));
      if (!fantasyTeam || fantasyTeam.seasonId !== season._id) continue;

      await syncFantasyTeamTotalPoints(ctx, fantasyTeam, now);
      syncedTeams += 1;
    }

    return {
      checkedScores: scores.length,
      checkedSnapshots: snapshots.length,
      correctedScores,
      deletedSnapshots,
      seasonId: season._id,
      syncedTeams,
    };
  },
});

export const reapplyGameweekPriceChanges = mutation({
  args: {
    gameweekNumber: v.number(),
    requireCompletedFixtures: v.optional(v.boolean()),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const gameweek = await findGameweekByNumber(
      ctx,
      season._id,
      args.gameweekNumber,
    );
    if (!gameweek) {
      throw new Error(`Тур ${args.gameweekNumber} не найден.`);
    }

    const fixtures = await ctx.db
      .query("fantasyFixtures")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect();
    const unresolvedFixtures = fixtures.filter(
      (fixture) =>
        fixture.status !== "cancelled" &&
        fixture.status !== "postponed" &&
        fixture.status !== "completed",
    );
    if (
      (args.requireCompletedFixtures ?? true) &&
      unresolvedFixtures.length > 0
    ) {
      throw new Error("Нельзя пересчитать цены: не все матчи завершены.");
    }

    const now = Date.now();
    const priceHistories = await ctx.db
      .query("fantasyPlayerPriceHistory")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect();
    const gameweekPriceHistories = priceHistories.filter(
      (history) => history.reason === "gameweek_recalculation",
    );

    let revertedPriceChanges = 0;
    for (const history of gameweekPriceHistories) {
      const player = await ctx.db.get(history.playerId);
      if (player) {
        await ctx.db.patch(player._id, {
          price: history.oldPrice,
          updatedAt: now,
        });
        revertedPriceChanges += 1;
      }
      await ctx.db.delete(history._id);
    }

    const scoring = await recalculateGameweekScoresInternal(
      ctx,
      season,
      gameweek,
      now,
    );
    const priceChanges = await applyGameweekPriceChanges(
      ctx,
      season,
      gameweek,
      now,
    );

    return {
      priceChanges,
      revertedPriceChanges,
      scoring,
    };
  },
});

export const completeGameweekAndGrantTransfers = mutation({
  args: {
    gameweekNumber: v.number(),
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const now = Date.now();
    await processSeasonDeadlineRollovers(ctx, season, now);
    const gameweek = await ctx.db
      .query("fantasyGameweeks")
      .withIndex("by_season_number", (q) =>
        q.eq("seasonId", season._id).eq("number", args.gameweekNumber),
      )
      .first();
    if (!gameweek) {
      throw new Error(`Тур ${args.gameweekNumber} не найден.`);
    }
    const fixtures = await ctx.db
      .query("fantasyFixtures")
      .withIndex("by_gameweek", (q) => q.eq("gameweekId", gameweek._id))
      .collect();
    const unresolvedFixtures = fixtures.filter(
      (fixture) =>
        fixture.status !== "cancelled" &&
        fixture.status !== "postponed" &&
        fixture.status !== "completed",
    );
    if (unresolvedFixtures.length > 0) {
      throw new Error("Нельзя завершить тур: не все матчи завершены.");
    }

    const scoring = await recalculateGameweekScoresInternal(
      ctx,
      season,
      gameweek,
      now,
    );

    const priceChanges = await applyGameweekPriceChanges(
      ctx,
      season,
      gameweek,
      now,
    );

    const freshGameweek = (await ctx.db.get(gameweek._id)) ?? gameweek;
    const alreadyGranted = !!freshGameweek.freeTransfersGrantedAt;
    const grantedTeams = await grantDeadlineFreeTransfers(
      ctx,
      season,
      freshGameweek,
      now,
    );

    await ctx.db.patch(gameweek._id, {
      completedAt: now,
      freeTransfersGrantedAt: freshGameweek.freeTransfersGrantedAt ?? now,
      status: "completed",
      updatedAt: now,
    });
    await schedulePushToAllUsers(ctx, {
      gameweekId: gameweek._id,
      gameweekName: gameweek.name,
      gameweekNumber: gameweek.number,
      key: `gameweek-results-ready:${gameweek._id}`,
      type: "gameweek_results_ready",
      title: "Підсумки туру готові",
      body: `${gameweek.name} завершено. Очки вже підраховані, можна перевірити результати.`,
    });

    const gameweeks = await ctx.db
      .query("fantasyGameweeks")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    const nextGameweek =
      gameweeks
        .filter(
          (item) =>
            item.number > gameweek.number && item.status !== "completed",
        )
        .sort((a, b) => a.number - b.number)[0] ?? null;

    if (nextGameweek && season.currentGameweekId === gameweek._id) {
      await ctx.db.patch(season._id, {
        currentGameweekId: nextGameweek._id,
        updatedAt: now,
      });
      if (nextGameweek.status === "upcoming") {
        await ctx.db.patch(nextGameweek._id, {
          status: "open",
          updatedAt: now,
        });
      }
    }
    const playerStatusSync = await finalizeGameweekPlayerStatuses(
      ctx,
      season,
      gameweek,
      now,
    );

    return {
      alreadyGranted,
      gameweekId: gameweek._id,
      grantedTeams,
      nextGameweekId: nextGameweek?._id ?? null,
      priceChanges,
      scoring,
      playerStatusSync,
    };
  },
});

export const canonicalizeSkyUpClub = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireSeason(
      ctx,
      args.seasonSlug ?? EXTRA_LEAGUE_2026_27_SLUG,
    );
    const now = Date.now();
    const legacyNames = new Set(["СкайАп", "SkyUp Futsal", "Sky Up"]);
    const canonicalName = "SkyUp";
    const canonicalShortName = "SkyUp";
    const skyUpExternalId = "21695";

    const clubs = await ctx.db
      .query("fantasyClubs")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    const club =
      clubs.find((item) => item.externalId === skyUpExternalId) ??
      clubs.find(
        (item) => legacyNames.has(item.name) || item.name === canonicalName,
      );

    if (!club) {
      throw new Error("SkyUp club was not found in this season.");
    }

    const clubNeedsPatch =
      club.name !== canonicalName || club.shortName !== canonicalShortName;
    if (clubNeedsPatch) {
      await ctx.db.patch(club._id, {
        name: canonicalName,
        shortName: canonicalShortName,
        updatedAt: now,
      });
    }

    const fixtures = await ctx.db
      .query("fantasyFixtures")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    let updatedFixtures = 0;
    for (const fixture of fixtures) {
      const patch: Partial<Doc<"fantasyFixtures">> = {};
      if (
        fixture.homeClubId === club._id ||
        legacyNames.has(fixture.homeClubName)
      ) {
        patch.homeClubName = canonicalName;
      }
      if (
        fixture.awayClubId === club._id ||
        legacyNames.has(fixture.awayClubName)
      ) {
        patch.awayClubName = canonicalName;
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(fixture._id, { ...patch, updatedAt: now });
        updatedFixtures += 1;
      }
    }

    return {
      clubId: club._id,
      clubUpdated: clubNeedsPatch,
      updatedFixtures,
    };
  },
});

export const upsertClub = mutation({
  args: {
    seasonSlug: v.string(),
    name: v.string(),
    shortName: v.optional(v.string()),
    city: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const name = normalizeText(args.name);
    const existing = await findClubByName(ctx, season._id, name);
    const payload = {
      seasonId: season._id,
      name,
      shortName: toOptionalText(args.shortName),
      city: toOptionalText(args.city),
      logoUrl: toOptionalText(args.logoUrl),
      primaryColor: toOptionalText(args.primaryColor),
      secondaryColor: toOptionalText(args.secondaryColor),
      sortOrder: args.sortOrder ?? existing?.sortOrder ?? 1000,
      isActive: args.isActive ?? existing?.isActive ?? true,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("fantasyClubs", {
      ...payload,
      createdAt: now,
    });
    return { id, created: true };
  },
});

export const upsertGameweek = mutation({
  args: {
    seasonSlug: v.string(),
    number: v.number(),
    name: v.optional(v.string()),
    status: fantasyGameweekStatusValidator,
    deadlineAt: v.optional(v.number()),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    makeCurrent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const existing = await ctx.db
      .query("fantasyGameweeks")
      .withIndex("by_season_number", (q) =>
        q.eq("seasonId", season._id).eq("number", args.number),
      )
      .first();
    const payload = {
      seasonId: season._id,
      number: args.number,
      name: toOptionalText(args.name) ?? `GW ${args.number}`,
      status: args.status,
      deadlineAt: args.deadlineAt,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      updatedAt: now,
    };
    const id =
      existing?._id ??
      (await ctx.db.insert("fantasyGameweeks", { ...payload, createdAt: now }));

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    }
    if (args.makeCurrent) {
      await ctx.db.patch(season._id, { currentGameweekId: id, updatedAt: now });
    }
    const gameweekForScheduling = await ctx.db.get(id);
    const deadlineReminderSchedules = gameweekForScheduling
      ? await syncGameweekDeadlineReminderSchedules(
          ctx,
          gameweekForScheduling,
          now,
        )
      : null;

    return { id, created: !existing, deadlineReminderSchedules };
  },
});

export const updatePlayerStatus = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
    playerName: v.string(),
    status: fantasyPlayerStatusValidator,
    statusDetails: v.optional(
      v.union(fantasyPlayerStatusDetailsValidator, v.null()),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const normalizedName = normalizeText(args.playerName).toLowerCase();
    const players = await ctx.db
      .query("fantasyPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    const matches = players.filter((player) => {
      const candidates = [
        player.displayName,
        player.lastName,
        [player.firstName, player.lastName].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .map((value) => normalizeText(value).toLowerCase());

      return candidates.includes(normalizedName);
    });

    if (matches.length === 0) {
      throw new Error(`Игрок ${args.playerName} не найден.`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Найдено несколько игроков для ${args.playerName}: ${matches
          .map((player) => player.displayName)
          .join(", ")}.`,
      );
    }

    const player = matches[0];
    const statusDetails =
      args.statusDetails === undefined
        ? player.statusDetails
        : args.statusDetails === null
          ? undefined
          : normalizeFantasyPlayerStatusDetails(args.statusDetails, now);

    await ctx.db.patch(player._id, {
      status: args.status,
      statusDetails,
      updatedAt: now,
    });

    return {
      id: player._id,
      displayName: player.displayName,
      status: args.status,
      statusDetails: statusDetails
        ? toFantasyPlayerStatusDetailsView({ statusDetails })
        : null,
    };
  },
});

export const applyPlayerRosterCorrections = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
    updates: v.array(
      v.object({
        playerId: v.optional(v.id("fantasyPlayers")),
        playerName: v.optional(v.string()),
        expectedClubName: v.optional(v.string()),
        clubName: v.optional(v.union(v.string(), v.null())),
        currentTeamExternalIds: v.optional(v.array(v.string())),
        listedTeamExternalIds: v.optional(v.array(v.string())),
        status: v.optional(fantasyPlayerStatusValidator),
        statusDetails: v.optional(
          v.union(fantasyPlayerStatusDetailsValidator, v.null()),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const [players, clubs] = await Promise.all([
      ctx.db
        .query("fantasyPlayers")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
      ctx.db
        .query("fantasyClubs")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
    ]);
    const clubsById = new Map(clubs.map((club) => [club._id, club]));
    const clubsByName = new Map(
      clubs.map((club) => [normalizeText(club.name).toLowerCase(), club]),
    );

    const findPlayerForUpdate = async (update: {
      expectedClubName?: string;
      playerId?: Id<"fantasyPlayers">;
      playerName?: string;
    }) => {
      if (update.playerId) {
        const player = await ctx.db.get(update.playerId);
        if (!player || player.seasonId !== season._id) {
          throw new Error(`Игрок ${update.playerId} не найден.`);
        }
        return player;
      }

      const normalizedName = normalizeText(
        update.playerName ?? "",
      ).toLowerCase();
      if (!normalizedName) {
        throw new Error("Нужно передать playerId или playerName.");
      }

      let matches = players.filter((player) => {
        const candidates = [
          player.displayName,
          player.lastName,
          [player.firstName, player.lastName].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .map((value) => normalizeText(value).toLowerCase());

        return candidates.includes(normalizedName);
      });

      if (update.expectedClubName) {
        const normalizedExpectedClubName = normalizeText(
          update.expectedClubName,
        ).toLowerCase();
        const matchesInClub = matches.filter((player) => {
          const club = player.clubId ? clubsById.get(player.clubId) : null;
          return (
            normalizeText(club?.name ?? "").toLowerCase() ===
            normalizedExpectedClubName
          );
        });
        if (matchesInClub.length > 0) matches = matchesInClub;
      }

      if (matches.length === 0) {
        throw new Error(`Игрок ${update.playerName} не найден.`);
      }
      if (matches.length > 1) {
        throw new Error(
          `Найдено несколько игроков для ${update.playerName}: ${matches
            .map((player) => player.displayName)
            .join(", ")}.`,
        );
      }

      return matches[0];
    };

    const results = [];
    for (const update of args.updates) {
      const player = await findPlayerForUpdate(update);
      const previousClub = player.clubId ? clubsById.get(player.clubId) : null;
      const patch: Partial<Doc<"fantasyPlayers">> = { updatedAt: now };

      const targetClubName = update.clubName;
      const shouldUpdateClub = targetClubName !== undefined;
      if (shouldUpdateClub) {
        if (targetClubName === null) {
          patch.clubId = undefined;
        } else {
          const targetClub = clubsByName.get(
            normalizeText(targetClubName).toLowerCase(),
          );
          if (!targetClub) {
            throw new Error(`Клуб ${targetClubName} не найден.`);
          }
          patch.clubId = targetClub._id;
        }
      }

      if (update.status !== undefined) {
        patch.status = update.status;
      }
      if (update.currentTeamExternalIds !== undefined) {
        patch.currentTeamExternalIds = update.currentTeamExternalIds;
      }
      if (update.listedTeamExternalIds !== undefined) {
        patch.listedTeamExternalIds = update.listedTeamExternalIds;
      }
      if (update.statusDetails !== undefined) {
        patch.statusDetails =
          update.statusDetails === null
            ? undefined
            : normalizeFantasyPlayerStatusDetails(update.statusDetails, now);
      }

      await ctx.db.patch(player._id, patch);
      const targetClub = shouldUpdateClub
        ? patch.clubId
          ? clubsById.get(patch.clubId)
          : null
        : previousClub;
      results.push({
        id: player._id,
        displayName: player.displayName,
        previousClubName: previousClub?.name ?? null,
        clubName: targetClub?.name ?? null,
        status: update.status ?? player.status,
        statusDetails:
          update.statusDetails === undefined
            ? toFantasyPlayerStatusDetailsView(player)
            : patch.statusDetails
              ? toFantasyPlayerStatusDetailsView({
                  statusDetails: patch.statusDetails,
                })
              : null,
      });
    }

    return { updated: results.length, results };
  },
});

export const applyPlayerSourceCorrections = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
    updates: v.array(
      v.object({
        currentExternalId: v.string(),
        externalId: v.optional(v.string()),
        sourceSlug: v.optional(v.union(v.string(), v.null())),
        sourceUrl: v.optional(v.union(v.string(), v.null())),
        firstName: v.optional(v.union(v.string(), v.null())),
        lastName: v.optional(v.string()),
        displayName: v.optional(v.string()),
        position: v.optional(fantasyPlayerPositionValidator),
        jerseyNumber: v.optional(v.union(v.number(), v.null())),
        photoUrl: v.optional(v.union(v.string(), v.null())),
        photoThumbnailUrl: v.optional(v.union(v.string(), v.null())),
        photoProvider: v.optional(v.union(v.string(), v.null())),
        photoCloudflareId: v.optional(v.union(v.string(), v.null())),
        photoStorageKey: v.optional(v.union(v.string(), v.null())),
        photoSourceUrl: v.optional(v.union(v.string(), v.null())),
        photoSourceThumbnailUrl: v.optional(v.union(v.string(), v.null())),
        currentTeamExternalIds: v.optional(v.array(v.string())),
        listedTeamExternalIds: v.optional(v.array(v.string())),
        sourceStats: v.optional(
          v.object({
            extraLeague2025_26: v.optional(
              v.union(fantasyPlayerSourceStatCorrectionValidator, v.null()),
            ),
            firstLeague2025_26: v.optional(
              v.union(fantasyPlayerSourceStatCorrectionValidator, v.null()),
            ),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireExistingSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const players = await ctx.db
      .query("fantasyPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    const playersByExternalId = new Map(
      players
        .filter((player) => player.externalId)
        .map((player) => [player.externalId as string, player]),
    );
    const results = [];

    const setOptionalText = (
      patch: Partial<Doc<"fantasyPlayers">>,
      field:
        | "sourceSlug"
        | "sourceUrl"
        | "firstName"
        | "photoUrl"
        | "photoThumbnailUrl"
        | "photoProvider"
        | "photoCloudflareId"
        | "photoStorageKey"
        | "photoSourceUrl"
        | "photoSourceThumbnailUrl",
      value: string | null | undefined,
    ) => {
      if (value === undefined) return;
      patch[field] = value === null ? undefined : toOptionalText(value);
    };

    for (const update of args.updates) {
      const nextExternalId = toOptionalText(update.externalId);
      const player =
        playersByExternalId.get(update.currentExternalId) ??
        (nextExternalId ? playersByExternalId.get(nextExternalId) : undefined);
      if (!player) {
        throw new Error(
          `Игрок с externalId ${update.currentExternalId} не найден.`,
        );
      }

      if (nextExternalId && nextExternalId !== player.externalId) {
        const conflict = playersByExternalId.get(nextExternalId);
        if (conflict && conflict._id !== player._id) {
          throw new Error(
            `externalId ${nextExternalId} уже используется игроком ${conflict.displayName}.`,
          );
        }
      }

      const patch: Partial<Doc<"fantasyPlayers">> = {
        updatedAt: now,
        sourceUpdatedAt: now,
      };

      if (nextExternalId) {
        patch.externalId = nextExternalId;
      }
      if (update.displayName !== undefined) {
        patch.displayName = normalizeText(update.displayName);
      }
      if (update.lastName !== undefined) {
        patch.lastName = normalizeText(update.lastName);
      }
      if (update.position !== undefined) {
        patch.position = update.position;
      }
      if (update.jerseyNumber !== undefined) {
        patch.jerseyNumber = update.jerseyNumber ?? undefined;
      }
      if (update.currentTeamExternalIds !== undefined) {
        patch.currentTeamExternalIds = update.currentTeamExternalIds;
      }
      if (update.listedTeamExternalIds !== undefined) {
        patch.listedTeamExternalIds = update.listedTeamExternalIds;
      }
      if (update.sourceStats !== undefined) {
        patch.sourceStats = {
          extraLeague2025_26:
            update.sourceStats.extraLeague2025_26 ?? undefined,
          firstLeague2025_26:
            update.sourceStats.firstLeague2025_26 ?? undefined,
        };
      }

      setOptionalText(patch, "sourceSlug", update.sourceSlug);
      setOptionalText(patch, "sourceUrl", update.sourceUrl);
      setOptionalText(patch, "firstName", update.firstName);
      setOptionalText(patch, "photoUrl", update.photoUrl);
      setOptionalText(patch, "photoThumbnailUrl", update.photoThumbnailUrl);
      setOptionalText(patch, "photoProvider", update.photoProvider);
      setOptionalText(patch, "photoCloudflareId", update.photoCloudflareId);
      setOptionalText(patch, "photoStorageKey", update.photoStorageKey);
      setOptionalText(patch, "photoSourceUrl", update.photoSourceUrl);
      setOptionalText(
        patch,
        "photoSourceThumbnailUrl",
        update.photoSourceThumbnailUrl,
      );

      await ctx.db.patch(player._id, patch);

      if (player.externalId) {
        playersByExternalId.delete(player.externalId);
      }
      if (nextExternalId) {
        playersByExternalId.set(nextExternalId, { ...player, ...patch });
      }

      results.push({
        id: player._id,
        previousExternalId: player.externalId ?? null,
        externalId: nextExternalId ?? player.externalId ?? null,
        previousDisplayName: player.displayName,
        displayName: patch.displayName ?? player.displayName,
        photoUrl:
          update.photoUrl === undefined
            ? (player.photoUrl ?? null)
            : (patch.photoUrl ?? null),
      });
    }

    return { updated: results.length, results };
  },
});

export const upsertPlayer = mutation({
  args: {
    seasonSlug: v.string(),
    clubId: v.optional(v.id("fantasyClubs")),
    clubName: v.optional(v.string()),
    externalId: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.string(),
    displayName: v.optional(v.string()),
    position: fantasyPlayerPositionValidator,
    price: v.number(),
    status: v.optional(fantasyPlayerStatusValidator),
    statusDetails: v.optional(
      v.union(fantasyPlayerStatusDetailsValidator, v.null()),
    ),
    jerseyNumber: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const externalId = toOptionalText(args.externalId);
    const displayName =
      toOptionalText(args.displayName) ??
      normalizeText([args.firstName, args.lastName].filter(Boolean).join(" "));
    const existingByExternalId = externalId
      ? await ctx.db
          .query("fantasyPlayers")
          .withIndex("by_season_external_id", (q) =>
            q.eq("seasonId", season._id).eq("externalId", externalId),
          )
          .first()
      : null;
    const existing =
      existingByExternalId ??
      (
        await ctx.db
          .query("fantasyPlayers")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect()
      ).find(
        (player) =>
          player.displayName.toLowerCase() === displayName.toLowerCase(),
      );
    const clubId = await resolveClubId(
      ctx,
      season._id,
      args.clubId,
      args.clubName,
    );
    const statusDetails =
      args.statusDetails === undefined
        ? existing?.statusDetails
        : args.statusDetails === null
          ? undefined
          : normalizeFantasyPlayerStatusDetails(args.statusDetails, now);
    const payload = {
      seasonId: season._id,
      clubId,
      externalId,
      firstName: toOptionalText(args.firstName),
      lastName: normalizeText(args.lastName),
      displayName,
      position: args.position,
      price: args.price,
      status: args.status ?? existing?.status ?? "active",
      statusDetails,
      jerseyNumber: args.jerseyNumber,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("fantasyPlayers", {
      ...payload,
      createdAt: now,
    });
    return { id, created: true };
  },
});

export const upsertFixture = mutation({
  args: {
    seasonSlug: v.string(),
    gameweekNumber: v.optional(v.number()),
    externalId: v.optional(v.string()),
    homeClubId: v.optional(v.id("fantasyClubs")),
    awayClubId: v.optional(v.id("fantasyClubs")),
    homeClubName: v.string(),
    awayClubName: v.string(),
    scheduledAt: v.number(),
    status: fantasyFixtureStatusValidator,
    homeScore: v.optional(v.number()),
    awayScore: v.optional(v.number()),
    venue: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const season = await requireSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const externalId = toOptionalText(args.externalId);
    const gameweekNumber = args.gameweekNumber;
    const gameweek =
      gameweekNumber !== undefined
        ? await ctx.db
            .query("fantasyGameweeks")
            .withIndex("by_season_number", (q) =>
              q.eq("seasonId", season._id).eq("number", gameweekNumber),
            )
            .first()
        : null;
    const existing = externalId
      ? await ctx.db
          .query("fantasyFixtures")
          .withIndex("by_season_external_id", (q) =>
            q.eq("seasonId", season._id).eq("externalId", externalId),
          )
          .first()
      : null;
    const homeClubName = normalizeText(args.homeClubName);
    const awayClubName = normalizeText(args.awayClubName);
    const homeClubId = await resolveClubId(
      ctx,
      season._id,
      args.homeClubId,
      homeClubName,
    );
    const awayClubId = await resolveClubId(
      ctx,
      season._id,
      args.awayClubId,
      awayClubName,
    );
    const payload = {
      seasonId: season._id,
      gameweekId: gameweek?._id,
      externalId,
      homeClubId,
      awayClubId,
      homeClubName,
      awayClubName,
      scheduledAt: args.scheduledAt,
      status: args.status,
      homeScore: args.homeScore,
      awayScore: args.awayScore,
      venue: toOptionalText(args.venue),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("fantasyFixtures", {
      ...payload,
      createdAt: now,
    });
    return { id, created: true };
  },
});

async function hasFantasyTeamParticipated(
  ctx: QueryCtx | MutationCtx,
  fantasyTeamId: Id<"fantasyTeams">,
) {
  const fantasyTeam = await ctx.db.get(fantasyTeamId);
  if (!fantasyTeam) return false;

  const [scores, snapshots, gameweeks] = await Promise.all([
    ctx.db
      .query("fantasyTeamGameweekScores")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeamId))
      .collect(),
    ctx.db
      .query("fantasyGameweekSquadPicks")
      .withIndex("by_team", (q) => q.eq("fantasyTeamId", fantasyTeamId))
      .collect(),
    getSeasonGameweeks(ctx, fantasyTeam.seasonId),
  ]);
  const gameweeksById = new Map(
    gameweeks.map((gameweek) => [gameweek._id, gameweek]),
  );
  const hasParticipatedScore = scores.some((score) => {
    if (score.seasonId !== fantasyTeam.seasonId || !score.participated) {
      return false;
    }
    const gameweek = gameweeksById.get(score.gameweekId);
    return (
      !!gameweek && canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
    );
  });
  const hasEligibleSnapshot = snapshots.some((snapshot) => {
    if (snapshot.seasonId !== fantasyTeam.seasonId) return false;
    const gameweek = gameweeksById.get(snapshot.gameweekId);
    return (
      !!gameweek && canFantasyTeamParticipateInGameweek(fantasyTeam, gameweek)
    );
  });

  return hasParticipatedScore || hasEligibleSnapshot;
}

async function getTeamEditState(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"fantasySeasons">,
  now: number,
) {
  const gameweeks = await ctx.db
    .query("fantasyGameweeks")
    .withIndex("by_season", (q) => q.eq("seasonId", season._id))
    .collect();
  const sortedGameweeks = gameweeks.sort((a, b) => a.number - b.number);
  const firstGameweek = sortedGameweeks[0] ?? null;
  const currentGameweek = await findCurrentGameweek(ctx, season, now);
  const currentFixtures = currentGameweek
    ? await ctx.db
        .query("fantasyFixtures")
        .withIndex("by_gameweek", (q) =>
          q.eq("gameweekId", currentGameweek._id),
        )
        .collect()
    : [];
  const completedGameweeksCount = sortedGameweeks.filter(
    (gameweek) => gameweek.status === "completed",
  ).length;
  const isBeforeFirstDeadline =
    !firstGameweek?.deadlineAt || now < firstGameweek.deadlineAt;
  const isInitialSelectionPeriod =
    completedGameweeksCount === 0 && isBeforeFirstDeadline;
  const activeCurrentFixtures = currentFixtures.filter(
    (fixture) =>
      fixture.status !== "cancelled" && fixture.status !== "postponed",
  );
  const currentFixturesCompleted =
    activeCurrentFixtures.length > 0 &&
    activeCurrentFixtures.every((fixture) => fixture.status === "completed");
  return {
    currentGameweek,
    currentFixturesCompleted,
    isInitialSelectionPeriod,
    isLocked:
      !currentGameweek || !isGameweekEditableForFantasy(currentGameweek, now),
  };
}

function countIncomingTransfers(
  currentPicks: Doc<"fantasySquadPicks">[],
  nextPicks: Array<{ playerId: Id<"fantasyPlayers"> }>,
) {
  const currentPlayerIds = new Set(currentPicks.map((pick) => pick.playerId));
  return nextPicks.filter((pick) => !currentPlayerIds.has(pick.playerId))
    .length;
}

function getTransferPairs(
  currentPicks: Doc<"fantasySquadPicks">[],
  nextPicks: Array<{ playerId: Id<"fantasyPlayers"> }>,
) {
  const nextPlayerIds = new Set(nextPicks.map((pick) => pick.playerId));
  const currentPlayerIds = new Set(currentPicks.map((pick) => pick.playerId));
  const outgoingPlayerIds = currentPicks
    .map((pick) => pick.playerId)
    .filter((playerId) => !nextPlayerIds.has(playerId));
  const incomingPlayerIds = nextPicks
    .map((pick) => pick.playerId)
    .filter((playerId) => !currentPlayerIds.has(playerId));

  return incomingPlayerIds.map((toPlayerId, index) => ({
    fromPlayerId: outgoingPlayerIds[index],
    toPlayerId,
  }));
}

export const createMyTeam = mutation({
  args: {
    seasonSlug: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Сначала нужно подготовить профиль пользователя.");
    }

    const season = await requireSeason(ctx, args.seasonSlug);
    const existing = await ctx.db
      .query("fantasyTeams")
      .withIndex("by_user_season", (q) =>
        q.eq("userId", user._id).eq("seasonId", season._id),
      )
      .first();
    const now = Date.now();
    const name = normalizeText(args.name);

    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        updatedAt: now,
      });
      await attachFantasyTeamToPrivateLeagueMemberships(
        ctx,
        season._id,
        user._id,
        existing._id,
      );
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("fantasyTeams", {
      seasonId: season._id,
      userId: user._id,
      name,
      budgetRemaining: season.budget,
      freeTransfers: 0,
      totalPoints: 0,
      createdAt: now,
      updatedAt: now,
    });

    await attachFantasyTeamToPrivateLeagueMemberships(
      ctx,
      season._id,
      user._id,
      id,
    );

    return { id, created: true };
  },
});

export const saveMyTeam = mutation({
  args: {
    seasonSlug: v.optional(v.string()),
    name: v.string(),
    picks: v.array(
      v.object({
        playerId: v.id("fantasyPlayers"),
        rosterSlot: v.number(),
        isStarter: v.boolean(),
        isCaptain: v.boolean(),
        isViceCaptain: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Сначала нужно подготовить профиль пользователя.");
    }

    let season = await requireExistingSeason(ctx, args.seasonSlug);
    const now = Date.now();
    const rolloverState = await processSeasonDeadlineRollovers(
      ctx,
      season,
      now,
    );
    if (
      rolloverState.currentGameweekId !== (season.currentGameweekId ?? null)
    ) {
      season = (await ctx.db.get(season._id)) ?? season;
    }
    const name = normalizeText(args.name);
    if (!name) {
      throw new Error("Введите название команды.");
    }

    if (args.picks.length !== season.squadSize) {
      throw new Error(`Squad must contain ${season.squadSize} players.`);
    }

    const expectedSlots = new Set(
      Array.from({ length: season.squadSize }, (_, index) => index + 1),
    );
    const slotSet = new Set<number>();
    const playerIdSet = new Set<string>();

    for (const pick of args.picks) {
      if (
        !Number.isInteger(pick.rosterSlot) ||
        !expectedSlots.has(pick.rosterSlot)
      ) {
        throw new Error("Некорректный слот состава.");
      }
      if (slotSet.has(pick.rosterSlot)) {
        throw new Error("Один слот состава заполнен дважды.");
      }
      if (playerIdSet.has(pick.playerId)) {
        throw new Error("A player cannot be selected twice.");
      }
      slotSet.add(pick.rosterSlot);
      playerIdSet.add(pick.playerId);
    }

    const players = await Promise.all(
      args.picks.map((pick) => ctx.db.get(pick.playerId)),
    );
    const detailedPicks = args.picks.map((pick, index) => {
      const player = players[index];
      const squadRole = getSquadRoleForRosterSlot(pick.rosterSlot);
      if (!player || player.seasonId !== season._id) {
        throw new Error("The squad contains a player from another season.");
      }
      return {
        ...pick,
        isStarter: squadRole === "starter",
        isCaptain: pick.isCaptain,
        isViceCaptain: pick.isViceCaptain,
        player,
        position: toPublicFantasyPlayerPosition(player.position),
        squadRole,
      };
    });

    const starters = detailedPicks.filter(
      (pick) => pick.squadRole === "starter",
    );
    const bench = detailedPicks.filter((pick) => pick.squadRole === "bench");
    const reserve = detailedPicks.filter(
      (pick) => pick.squadRole === "reserve",
    );
    const totalGoalkeepers = detailedPicks.filter(
      (pick) => pick.position === "goalkeeper",
    ).length;
    const totalUniversals = detailedPicks.filter(
      (pick) => pick.position === "universal",
    ).length;
    const starterGoalkeepers = starters.filter(
      (pick) => pick.position === "goalkeeper",
    ).length;
    const starterUniversals = starters.filter(
      (pick) => pick.position === "universal",
    ).length;
    const benchGoalkeepers = bench.filter(
      (pick) => pick.position === "goalkeeper",
    ).length;
    const benchUniversals = bench.filter(
      (pick) => pick.position === "universal",
    ).length;
    const reserveGoalkeepers = reserve.filter(
      (pick) => pick.position === "goalkeeper",
    ).length;
    const reserveUniversals = reserve.filter(
      (pick) => pick.position === "universal",
    ).length;

    if (
      starters.length !== season.startingSlots ||
      starterGoalkeepers !== FANTASY_GOALKEEPERS_PER_STARTING_GROUP ||
      starterUniversals !== FANTASY_UNIVERSALS_PER_STARTING_GROUP
    ) {
      throw new Error("В основе должны быть 1 вратарь и 4 универсала.");
    }
    if (
      bench.length !== FANTASY_ACTIVE_SLOTS - FANTASY_STARTING_SLOTS ||
      benchGoalkeepers !== FANTASY_GOALKEEPERS_PER_BENCH_GROUP ||
      benchUniversals !== FANTASY_UNIVERSALS_PER_BENCH_GROUP
    ) {
      throw new Error("Во второй четверке должны быть 4 универсала.");
    }
    if (
      reserve.length !== season.squadSize - FANTASY_ACTIVE_SLOTS ||
      reserveGoalkeepers !== FANTASY_GOALKEEPERS_PER_RESERVE_GROUP ||
      reserveUniversals !== FANTASY_UNIVERSALS_PER_RESERVE_GROUP
    ) {
      throw new Error("В резерве должны быть 1 вратарь и 2 универсала.");
    }
    if (
      totalGoalkeepers !== FANTASY_GOALKEEPERS_PER_SQUAD ||
      totalUniversals !== FANTASY_UNIVERSALS_PER_SQUAD
    ) {
      throw new Error("В составе должны быть 2 вратаря и 10 универсалов.");
    }

    const captainPicks = detailedPicks.filter((pick) => pick.isCaptain);
    const viceCaptainPicks = detailedPicks.filter((pick) => pick.isViceCaptain);
    if (captainPicks.length !== 1) {
      throw new Error("Выберите одного капитана.");
    }
    if (viceCaptainPicks.length !== 1) {
      throw new Error("Выберите одного вице-капитана.");
    }
    if (captainPicks[0].rosterSlot === viceCaptainPicks[0].rosterSlot) {
      throw new Error("Captain and vice captain must be different players.");
    }
    if (
      captainPicks[0].squadRole === "reserve" ||
      viceCaptainPicks[0].squadRole === "reserve"
    ) {
      throw new Error(
        "Капитана и вице-капитана можно выбрать только из основы или второй четверки.",
      );
    }

    const clubCounts = new Map<
      Id<"fantasyClubs">,
      { clubId: Id<"fantasyClubs">; count: number }
    >();
    for (const pick of detailedPicks) {
      if (!pick.player.clubId) continue;

      const current = clubCounts.get(pick.player.clubId) ?? {
        clubId: pick.player.clubId,
        count: 0,
      };
      clubCounts.set(pick.player.clubId, {
        clubId: pick.player.clubId,
        count: current.count + 1,
      });
    }

    const clubLimitViolation = Array.from(clubCounts.values()).find(
      (club) => club.count > FANTASY_MAX_PLAYERS_PER_CLUB,
    );
    if (clubLimitViolation) {
      const club = await ctx.db.get(clubLimitViolation.clubId);
      throw new Error(
        `Maximum ${FANTASY_MAX_PLAYERS_PER_CLUB} players from ${club?.name ?? "one club"}.`,
      );
    }

    const totalPrice = roundFantasyMoney(
      detailedPicks.reduce((sum, pick) => sum + pick.player.price, 0),
    );

    const existing = await ctx.db
      .query("fantasyTeams")
      .withIndex("by_user_season", (q) =>
        q.eq("userId", user._id).eq("seasonId", season._id),
      )
      .first();
    const currentPicks = existing
      ? await ctx.db
          .query("fantasySquadPicks")
          .withIndex("by_team", (q) => q.eq("fantasyTeamId", existing._id))
          .collect()
      : [];
    const [currentPickPlayers, hasParticipated] = await Promise.all([
      currentPicks.length > 0
        ? Promise.all(currentPicks.map((pick) => ctx.db.get(pick.playerId)))
        : Promise.resolve([]),
      existing ? hasFantasyTeamParticipated(ctx, existing._id) : false,
    ]);
    const editState = await getTeamEditState(ctx, season, now);
    if (editState.isLocked) {
      throw new Error("Зараз немає відкритого туру для змін складу.");
    }

    const isUnlimitedSelectionPeriod = !existing || !hasParticipated;
    const currentTeamValue = roundFantasyMoney(
      currentPickPlayers.reduce((sum, player) => sum + (player?.price ?? 0), 0),
    );
    const budgetRemaining = existing
      ? roundFantasyMoney(
          existing.budgetRemaining + currentTeamValue - totalPrice,
        )
      : roundFantasyMoney(season.budget - totalPrice);

    if (budgetRemaining < -0.0001) {
      throw new Error("Превышен бюджет команды.");
    }
    const normalizedBudgetRemaining = Math.max(0, budgetRemaining);

    const transfersUsed = existing
      ? countIncomingTransfers(currentPicks, detailedPicks)
      : 0;
    if (
      !isUnlimitedSelectionPeriod &&
      transfersUsed > getSeasonMaxTransfersPerGameweek(season)
    ) {
      throw new Error(
        `За один тур можно сделать максимум ${getSeasonMaxTransfersPerGameweek(season)} трансферов.`,
      );
    }

    const freeTransfersBefore = isUnlimitedSelectionPeriod
      ? 0
      : (existing?.freeTransfers ?? 0);
    let freeTransfersAfter = freeTransfersBefore;
    let transferPenaltyPoints = 0;
    if (existing && !isUnlimitedSelectionPeriod && transfersUsed > 0) {
      const freeTransfersUsed = Math.min(freeTransfersAfter, transfersUsed);
      const paidTransfers = transfersUsed - freeTransfersUsed;
      freeTransfersAfter -= freeTransfersUsed;
      transferPenaltyPoints =
        paidTransfers * getSeasonTransferPenaltyPoints(season);
    }

    const fantasyTeamId =
      existing?._id ??
      (await ctx.db.insert("fantasyTeams", {
        seasonId: season._id,
        userId: user._id,
        name,
        budgetRemaining: normalizedBudgetRemaining,
        freeTransfers: 0,
        totalPoints: 0,
        createdAt: now,
        updatedAt: now,
      }));

    await attachFantasyTeamToPrivateLeagueMemberships(
      ctx,
      season._id,
      user._id,
      fantasyTeamId,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        budgetRemaining: normalizedBudgetRemaining,
        freeTransfers: freeTransfersAfter,
        name,
        updatedAt: now,
      });
    }

    if (existing && !isUnlimitedSelectionPeriod && transfersUsed > 0) {
      const transferPairs = getTransferPairs(currentPicks, detailedPicks);
      let remainingFreeTransfers = freeTransfersBefore;
      for (const pair of transferPairs) {
        const penaltyPoints =
          remainingFreeTransfers > 0
            ? 0
            : getSeasonTransferPenaltyPoints(season);
        remainingFreeTransfers = Math.max(0, remainingFreeTransfers - 1);
        const transferId = await ctx.db.insert("fantasyTransfers", {
          seasonId: season._id,
          gameweekId: editState.currentGameweek?._id,
          fantasyTeamId,
          userId: user._id,
          fromPlayerId: pair.fromPlayerId,
          toPlayerId: pair.toPlayerId,
          penaltyPoints,
          createdAt: now,
          updatedAt: now,
        });
        if (penaltyPoints > 0) {
          await ctx.db.insert("fantasyPointDeductions", {
            seasonId: season._id,
            fantasyTeamId,
            userId: user._id,
            source: "transfer",
            sourceId: transferId,
            points: penaltyPoints,
            reason: "Paid transfer",
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    for (const pick of currentPicks) {
      await ctx.db.delete(pick._id);
    }

    for (const pick of detailedPicks) {
      await ctx.db.insert("fantasySquadPicks", {
        fantasyTeamId,
        playerId: pick.playerId,
        rosterSlot: pick.rosterSlot,
        isStarter: pick.isStarter,
        squadRole: pick.squadRole,
        isCaptain: pick.isCaptain,
        isViceCaptain: pick.isViceCaptain,
        createdAt: now,
        updatedAt: now,
      });
    }

    const savedFantasyTeam = await ctx.db.get(fantasyTeamId);
    const totalPoints = savedFantasyTeam
      ? await syncFantasyTeamTotalPoints(ctx, savedFantasyTeam, now)
      : 0;

    return {
      id: fantasyTeamId,
      budgetRemaining: normalizedBudgetRemaining,
      freeTransfers: freeTransfersAfter,
      isUnlimitedSelectionPeriod,
      savedPicks: detailedPicks.length,
      teamValue: totalPrice,
      totalPoints,
      transferPenaltyPoints,
      transfersUsed,
    };
  },
});
