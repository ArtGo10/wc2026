import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  fantasyFixtureEventTypeValidator,
  fantasyFixtureSideValidator,
  fantasyFixtureStatusValidator,
  fantasyGameweekStatusValidator,
  fantasyPlayerStatusDetailsValidator,
  fantasyPlayerStoragePositionValidator,
  fantasyPlayerStatusValidator,
  fantasySeasonStatusValidator,
  fantasySquadRoleValidator,
} from "./validators";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.optional(v.string()),
    name: v.string(),
    role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
    participantNumber: v.optional(v.number()),
    favoriteFantasyClubId: v.optional(v.id("fantasyClubs")),
    preferredLanguage: v.optional(
      v.union(v.literal("en"), v.literal("uk"), v.literal("pl")),
    ),
    termsAcceptedAt: v.optional(v.number()),
    termsVersion: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_participant_number", ["participantNumber"]),

  accountDeletionCleanupJobs: defineTable({
    clerkId: v.string(),
    status: v.union(
      v.literal("clerk_delete_pending"),
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    nextAttemptAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_status_next_attempt", ["status", "nextAttemptAt"]),

  pushNotificationTokens: defineTable({
    userId: v.id("users"),
    provider: v.union(v.literal("expo")),
    token: v.string(),
    platform: v.optional(v.string()),
    enabled: v.boolean(),
    lastSeenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["token"]),

  pushNotificationEvents: defineTable({
    key: v.string(),
    type: v.string(),
    tokensCount: v.number(),
    sentAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_type_sent_at", ["type", "sentAt"]),

  pushNotificationSchedules: defineTable({
    logicalKey: v.string(),
    eventKey: v.string(),
    type: v.string(),
    gameweekId: v.optional(v.id("fantasyGameweeks")),
    scheduledAt: v.number(),
    deadlineAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.string()),
    status: v.union(v.literal("scheduled"), v.literal("cancelled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_logical_key", ["logicalKey"])
    .index("by_gameweek", ["gameweekId"])
    .index("by_scheduled_at", ["scheduledAt"]),

  userNotifications: defineTable({
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
    pushEventKey: v.optional(v.string()),
    readAt: v.union(v.number(), v.null()),
    sentAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_sent_at", ["userId", "sentAt"])
    .index("by_user_read_at", ["userId", "readAt"])
    .index("by_user_push_event_key", ["userId", "pushEventKey"]),

  userFeedback: defineTable({
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    message: v.string(),
    source: v.optional(v.string()),
    status: v.union(
      v.literal("new"),
      v.literal("reviewed"),
      v.literal("closed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status_created_at", ["status", "createdAt"]),

  appCrashReports: defineTable({
    reportId: v.string(),
    userId: v.optional(v.id("users")),
    clerkId: v.optional(v.string()),
    source: v.union(
      v.literal("errorBoundary"),
      v.literal("globalError"),
      v.literal("queryError"),
      v.literal("unhandledRejection"),
    ),
    fatal: v.union(v.boolean(), v.null()),
    message: v.string(),
    name: v.union(v.string(), v.null()),
    stack: v.union(v.string(), v.null()),
    componentStack: v.union(v.string(), v.null()),
    platform: v.string(),
    platformVersion: v.union(v.string(), v.number(), v.null()),
    appVersion: v.union(v.string(), v.null()),
    buildVersion: v.union(v.string(), v.null()),
    runtimeVersion: v.union(v.string(), v.null()),
    occurredAt: v.number(),
    submittedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_report_id", ["reportId"])
    .index("by_user", ["userId"])
    .index("by_source_submitted_at", ["source", "submittedAt"])
    .index("by_submitted_at", ["submittedAt"]),

  fantasySeasons: defineTable({
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
    status: fantasySeasonStatusValidator,
    budget: v.number(),
    squadSize: v.number(),
    startingSlots: v.number(),
    activeSlots: v.optional(v.number()),
    freeTransfersPerGameweek: v.optional(v.number()),
    maxFreeTransfers: v.optional(v.number()),
    maxTransfersPerGameweek: v.optional(v.number()),
    transferPenaltyPoints: v.optional(v.number()),
    priceChangeLimit: v.optional(v.number()),
    maxTeams: v.optional(v.number()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    currentGameweekId: v.optional(v.id("fantasyGameweeks")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  fantasyScoringRules: defineTable({
    seasonId: v.id("fantasySeasons"),
    version: v.string(),
    appearance: v.number(),
    outfieldGoal: v.number(),
    goalkeeperGoal: v.number(),
    outfieldAssist: v.number(),
    goalkeeperAssist: v.number(),
    goalkeeperConcededZero: v.number(),
    goalkeeperConcededOne: v.number(),
    goalkeeperConcededTwo: v.number(),
    goalkeeperConcededThree: v.optional(v.number()),
    goalkeeperConcededFour: v.optional(v.number()),
    goalkeeperConcededFive: v.optional(v.number()),
    goalkeeperConcededSixPlus: v.optional(v.number()),
    goalkeeperConcededExtra: v.number(),
    outfieldTeamGoalsScoredZero: v.optional(v.number()),
    outfieldTeamGoalsScoredOneTwo: v.optional(v.number()),
    outfieldTeamGoalsScoredThreeFour: v.optional(v.number()),
    outfieldTeamGoalsScoredFiveSix: v.optional(v.number()),
    outfieldTeamGoalsScoredSevenPlus: v.optional(v.number()),
    outfieldConcededZero: v.optional(v.number()),
    outfieldConcededOne: v.optional(v.number()),
    outfieldConcededTwo: v.optional(v.number()),
    outfieldConcededThree: v.optional(v.number()),
    outfieldConcededFour: v.optional(v.number()),
    outfieldConcededFive: v.optional(v.number()),
    outfieldConcededSixPlus: v.optional(v.number()),
    yellowCard: v.number(),
    secondYellowRedCard: v.optional(v.number()),
    redCard: v.number(),
    ownGoal: v.number(),
    penaltyMissed: v.number(),
    penaltySaved: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_season", ["seasonId"]),

  fantasyClubs: defineTable({
    seasonId: v.id("fantasySeasons"),
    externalId: v.optional(v.string()),
    sourceSlug: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    name: v.string(),
    shortName: v.optional(v.string()),
    city: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    logoThumbnailUrl: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    sortOrder: v.number(),
    isActive: v.boolean(),
    sourceUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_season_name", ["seasonId", "name"])
    .index("by_season_external_id", ["seasonId", "externalId"]),

  fantasyPlayers: defineTable({
    seasonId: v.id("fantasySeasons"),
    clubId: v.optional(v.id("fantasyClubs")),
    externalId: v.optional(v.string()),
    sourceSlug: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.string(),
    displayName: v.string(),
    position: fantasyPlayerStoragePositionValidator,
    price: v.number(),
    status: fantasyPlayerStatusValidator,
    statusDetails: v.optional(fantasyPlayerStatusDetailsValidator),
    suspensionGameweekNumbers: v.optional(v.array(v.number())),
    suspensionSourceEventIds: v.optional(
      v.array(v.id("fantasyFixtureEvents")),
    ),
    suspensionUpdatedAt: v.optional(v.number()),
    jerseyNumber: v.optional(v.number()),
    photoUrl: v.optional(v.string()),
    photoThumbnailUrl: v.optional(v.string()),
    photoProvider: v.optional(v.string()),
    photoCloudflareId: v.optional(v.string()),
    photoStorageKey: v.optional(v.string()),
    photoSourceUrl: v.optional(v.string()),
    photoSourceThumbnailUrl: v.optional(v.string()),
    currentTeamExternalIds: v.optional(v.array(v.string())),
    listedTeamExternalIds: v.optional(v.array(v.string())),
    sourceStats: v.optional(
      v.object({
        extraLeague2025_26: v.optional(
          v.object({
            goals: v.number(),
            assists: v.number(),
            appearances: v.number(),
            yellowCards: v.number(),
            redCards: v.number(),
            ownGoals: v.number(),
          }),
        ),
        firstLeague2025_26: v.optional(
          v.object({
            goals: v.number(),
            assists: v.number(),
            appearances: v.number(),
            yellowCards: v.number(),
            redCards: v.number(),
            ownGoals: v.number(),
          }),
        ),
      }),
    ),
    sourceUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_club", ["clubId"])
    .index("by_season_position", ["seasonId", "position"])
    .index("by_season_status", ["seasonId", "status"])
    .index("by_season_external_id", ["seasonId", "externalId"]),

  fantasyPlayerPriceHistory: defineTable({
    seasonId: v.id("fantasySeasons"),
    playerId: v.id("fantasyPlayers"),
    gameweekId: v.optional(v.id("fantasyGameweeks")),
    oldPrice: v.number(),
    newPrice: v.number(),
    delta: v.number(),
    reason: v.union(
      v.literal("initial_import"),
      v.literal("source_import"),
      v.literal("gameweek_recalculation"),
      v.literal("manual_adjustment"),
    ),
    createdAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_player", ["playerId"])
    .index("by_season_player", ["seasonId", "playerId"])
    .index("by_gameweek", ["gameweekId"]),

  fantasyGameweeks: defineTable({
    seasonId: v.id("fantasySeasons"),
    number: v.number(),
    name: v.string(),
    status: fantasyGameweekStatusValidator,
    deadlineAt: v.optional(v.number()),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    freeTransfersGrantedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_season_number", ["seasonId", "number"])
    .index("by_season_status", ["seasonId", "status"]),

  fantasyFixtures: defineTable({
    seasonId: v.id("fantasySeasons"),
    gameweekId: v.optional(v.id("fantasyGameweeks")),
    externalId: v.optional(v.string()),
    sourceSlug: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    homeClubId: v.optional(v.id("fantasyClubs")),
    awayClubId: v.optional(v.id("fantasyClubs")),
    homeClubName: v.string(),
    awayClubName: v.string(),
    scheduledAt: v.number(),
    status: fantasyFixtureStatusValidator,
    homeScore: v.optional(v.number()),
    awayScore: v.optional(v.number()),
    venue: v.optional(v.string()),
    sourceUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_gameweek", ["gameweekId"])
    .index("by_season_scheduled_at", ["seasonId", "scheduledAt"])
    .index("by_season_status", ["seasonId", "status"])
    .index("by_season_external_id", ["seasonId", "externalId"]),

  fantasyFixtureLineups: defineTable({
    seasonId: v.id("fantasySeasons"),
    fixtureId: v.id("fantasyFixtures"),
    clubId: v.optional(v.id("fantasyClubs")),
    playerId: v.optional(v.id("fantasyPlayers")),
    playerName: v.string(),
    side: fantasyFixtureSideValidator,
    jerseyNumber: v.optional(v.number()),
    position: v.optional(fantasyPlayerStoragePositionValidator),
    isStarter: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_fixture", ["fixtureId"])
    .index("by_player", ["playerId"])
    .index("by_club", ["clubId"]),

  fantasyFixtureEvents: defineTable({
    seasonId: v.id("fantasySeasons"),
    fixtureId: v.id("fantasyFixtures"),
    gameweekId: v.optional(v.id("fantasyGameweeks")),
    clubId: v.optional(v.id("fantasyClubs")),
    playerId: v.optional(v.id("fantasyPlayers")),
    playerName: v.optional(v.string()),
    side: fantasyFixtureSideValidator,
    type: fantasyFixtureEventTypeValidator,
    minute: v.optional(v.number()),
    period: v.optional(
      v.union(
        v.literal("first_half"),
        v.literal("second_half"),
        v.literal("extra_time"),
        v.literal("penalty_shootout"),
      ),
    ),
    points: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_fixture", ["fixtureId"])
    .index("by_gameweek", ["gameweekId"])
    .index("by_player", ["playerId"])
    .index("by_season_type", ["seasonId", "type"]),

  fantasyPlayerFavorites: defineTable({
    seasonId: v.id("fantasySeasons"),
    userId: v.id("users"),
    playerId: v.id("fantasyPlayers"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_user_season", ["userId", "seasonId"])
    .index("by_user_season_player", ["userId", "seasonId", "playerId"])
    .index("by_player", ["playerId"]),

  fantasyTeams: defineTable({
    seasonId: v.id("fantasySeasons"),
    userId: v.id("users"),
    name: v.string(),
    budgetRemaining: v.number(),
    freeTransfers: v.number(),
    totalPoints: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_user", ["userId"])
    .index("by_user_season", ["userId", "seasonId"]),

  fantasyPrivateLeagues: defineTable({
    seasonId: v.id("fantasySeasons"),
    ownerUserId: v.id("users"),
    name: v.string(),
    inviteCode: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_season_invite_code", ["seasonId", "inviteCode"]),

  fantasyPrivateLeagueMembers: defineTable({
    seasonId: v.id("fantasySeasons"),
    privateLeagueId: v.id("fantasyPrivateLeagues"),
    userId: v.id("users"),
    fantasyTeamId: v.optional(v.id("fantasyTeams")),
    role: v.union(v.literal("owner"), v.literal("member")),
    joinedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_league", ["privateLeagueId"])
    .index("by_team", ["fantasyTeamId"])
    .index("by_user_season", ["userId", "seasonId"])
    .index("by_user_league", ["userId", "privateLeagueId"]),

  fantasySquadPicks: defineTable({
    fantasyTeamId: v.id("fantasyTeams"),
    playerId: v.id("fantasyPlayers"),
    rosterSlot: v.number(),
    isStarter: v.boolean(),
    squadRole: v.optional(fantasySquadRoleValidator),
    isCaptain: v.boolean(),
    isViceCaptain: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team", ["fantasyTeamId"])
    .index("by_player", ["playerId"])
    .index("by_team_slot", ["fantasyTeamId", "rosterSlot"]),

  fantasyGameweekSquadPicks: defineTable({
    seasonId: v.id("fantasySeasons"),
    gameweekId: v.id("fantasyGameweeks"),
    fantasyTeamId: v.id("fantasyTeams"),
    playerId: v.id("fantasyPlayers"),
    rosterSlot: v.number(),
    isStarter: v.boolean(),
    squadRole: fantasySquadRoleValidator,
    pointsMultiplier: v.number(),
    isCaptain: v.boolean(),
    isViceCaptain: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_gameweek", ["gameweekId"])
    .index("by_team", ["fantasyTeamId"])
    .index("by_team_gameweek", ["fantasyTeamId", "gameweekId"]),

  fantasyTransfers: defineTable({
    seasonId: v.id("fantasySeasons"),
    gameweekId: v.optional(v.id("fantasyGameweeks")),
    fantasyTeamId: v.id("fantasyTeams"),
    userId: v.id("users"),
    fromPlayerId: v.optional(v.id("fantasyPlayers")),
    toPlayerId: v.id("fantasyPlayers"),
    penaltyPoints: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_team", ["fantasyTeamId"])
    .index("by_gameweek", ["gameweekId"])
    .index("by_team_gameweek", ["fantasyTeamId", "gameweekId"]),

  fantasyPointDeductions: defineTable({
    seasonId: v.id("fantasySeasons"),
    fantasyTeamId: v.id("fantasyTeams"),
    userId: v.id("users"),
    source: v.union(v.literal("transfer")),
    sourceId: v.optional(v.id("fantasyTransfers")),
    points: v.number(),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_team", ["fantasyTeamId"])
    .index("by_user", ["userId"])
    .index("by_source", ["source", "sourceId"]),

  fantasyTeamGameweekScores: defineTable({
    seasonId: v.id("fantasySeasons"),
    gameweekId: v.id("fantasyGameweeks"),
    fantasyTeamId: v.id("fantasyTeams"),
    points: v.number(),
    basePoints: v.optional(v.number()),
    captainBonusPoints: v.optional(v.number()),
    transferPenaltyPoints: v.optional(v.number()),
    totalPointsAfterGameweek: v.optional(v.number()),
    participated: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_team", ["fantasyTeamId"])
    .index("by_gameweek", ["gameweekId"])
    .index("by_team_gameweek", ["fantasyTeamId", "gameweekId"]),

  fantasyPlayerGameweekStats: defineTable({
    seasonId: v.id("fantasySeasons"),
    gameweekId: v.id("fantasyGameweeks"),
    playerId: v.id("fantasyPlayers"),
    clubId: v.optional(v.id("fantasyClubs")),
    appearances: v.optional(v.number()),
    minutes: v.optional(v.number()),
    goals: v.optional(v.number()),
    assists: v.optional(v.number()),
    yellowCards: v.optional(v.number()),
    redCards: v.optional(v.number()),
    secondYellowRedCards: v.optional(v.number()),
    ownGoals: v.optional(v.number()),
    penaltiesMissed: v.optional(v.number()),
    penaltiesSaved: v.optional(v.number()),
    saves: v.optional(v.number()),
    goalsConceded: v.optional(v.number()),
    teamGoalsScored: v.optional(v.number()),
    teamGoalsScoredPoints: v.optional(v.number()),
    teamGoalsConcededPoints: v.optional(v.number()),
    cleanSheet: v.optional(v.boolean()),
    cleanSheets: v.optional(v.number()),
    points: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_season_player", ["seasonId", "playerId"])
    .index("by_gameweek", ["gameweekId"])
    .index("by_player", ["playerId"])
    .index("by_gameweek_player", ["gameweekId", "playerId"]),
});
