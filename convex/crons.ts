import { cronJobs, makeFunctionReference, type FunctionReference } from "convex/server";

const crons = cronJobs();

const processPassedGameweekDeadlinesInternal = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { createdSnapshots: number; grantedTeams: number; processedGameweeks: number }
>(
  "fantasy:processPassedGameweekDeadlines",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  Record<string, never>,
  { createdSnapshots: number; grantedTeams: number; processedGameweeks: number }
>;
const processStartedFixturesInternal = makeFunctionReference<
  "mutation",
  Record<string, never>,
  {
    checkedFixtures: number;
    processedSeasons: number;
    updatedFixtures: number;
    updatedGameweeks: number;
  }
>("fantasy:processStartedFixtures") as unknown as FunctionReference<
  "mutation",
  "internal",
  Record<string, never>,
  {
    checkedFixtures: number;
    processedSeasons: number;
    updatedFixtures: number;
    updatedGameweeks: number;
  }
>;
const processAccountDeletionCleanupJobsInternal = makeFunctionReference<
  "action",
  Record<string, never>,
  { cleaned: number; failed: number; processed: number; rescheduled: number }
>("users:processAccountDeletionCleanupJobsInternal") as unknown as FunctionReference<
  "action",
  "internal",
  Record<string, never>,
  { cleaned: number; failed: number; processed: number; rescheduled: number }
>;

crons.interval(
  "process fantasy gameweek deadlines",
  { minutes: 1 },
  processPassedGameweekDeadlinesInternal,
);
crons.interval(
  "process started fantasy fixtures",
  { minutes: 1 },
  processStartedFixturesInternal,
);
crons.interval(
  "cleanup deleted account data",
  { minutes: 15 },
  processAccountDeletionCleanupJobsInternal,
);

export default crons;
