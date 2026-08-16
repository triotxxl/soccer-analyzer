import { ApiFootballClient } from "./api.ts";
import { AnalyzerDatabase } from "./database.ts";
import { completedScore } from "./draw-criteria.ts";
import { strengthPool } from "./league-strength.ts";
import type { ApiFixture, ApiLeague } from "./types.ts";

const CLUB_CUP_PATTERN =
  /\b(champions league|europa league|conference league|libertadores|sudamericana|concacaf|leagues cup|afc cup|caf confederation cup|ofc champions)\b/i;
const NON_COMPETITIVE_PATTERN =
  /\b(friendl(?:y|ies)|freundschaft(?:sspiel)?|testimonial|all[- ]star)\b/i;
const INTERNATIONAL_COUNTRIES = new Set([
  "world",
  "europe",
  "asia",
  "africa",
  "oceania",
  "north-central-america",
  "south-america"
]);

export interface StrengthBuildResult {
  competitions: number;
  fixturesCollected: number;
  fixturesStored: number;
  snapshotsWritten: number;
  apiRequests: number;
  budgetReached: boolean;
}

class RequestBudgetReached extends Error {}

export function relevantCompetitions(leagues: ApiLeague[]): ApiLeague[] {
  return leagues
    .filter((league) => league.league.type.toLocaleLowerCase() !== "league")
    .filter((league) => !NON_COMPETITIVE_PATTERN.test(league.league.name))
    .filter((league) =>
      CLUB_CUP_PATTERN.test(league.league.name) ||
      !INTERNATIONAL_COUNTRIES.has(league.country.name.toLocaleLowerCase())
    )
    .sort((left, right) => {
      const leftInternational = CLUB_CUP_PATTERN.test(left.league.name) ? 0 : 1;
      const rightInternational = CLUB_CUP_PATTERN.test(right.league.name) ? 0 : 1;
      return leftInternational - rightInternational ||
        left.league.id - right.league.id;
    });
}

function seasonsFor(
  competition: ApiLeague,
  count: number,
  now: Date
): number[] {
  return competition.seasons
    .filter((season) =>
      season.year <= now.getUTCFullYear() &&
      Date.parse(season.start) <= now.getTime()
    )
    .map((season) => season.year)
    .sort((left, right) => right - left)
    .slice(0, count)
    .sort((left, right) => left - right);
}

function completedFixtures(fixtures: ApiFixture[]): ApiFixture[] {
  return fixtures
    .filter((fixture) => completedScore(fixture))
    .filter((fixture) => !/\b(friendl|freundschaft)/i.test(fixture.league.name))
    .sort((left, right) =>
      left.fixture.timestamp - right.fixture.timestamp ||
      left.fixture.id - right.fixture.id
    );
}

function domesticLeagueFromFixtures(
  fixtures: ApiFixture[],
  teamId: number,
  leagueTypes: Map<number, string>
): number | null {
  const counts = new Map<number, number>();
  for (const fixture of fixtures) {
    if (
      fixture.teams.home.id !== teamId &&
      fixture.teams.away.id !== teamId
    ) continue;
    if (leagueTypes.get(fixture.league.id)?.toLocaleLowerCase() !== "league") continue;
    counts.set(fixture.league.id, (counts.get(fixture.league.id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? null;
}

async function teamLeague(
  client: ApiFootballClient,
  database: AnalyzerDatabase,
  leagueTypes: Map<number, string>,
  teamId: number,
  season: number,
  requestBudget: number,
  requestStart: number
): Promise<number | null> {
  const stored = database.getStrengthTeamLeague(teamId, season);
  if (stored !== null) return stored === 0 ? null : stored;
  if (client.requestCount - requestStart >= requestBudget) {
    throw new RequestBudgetReached();
  }
  const fixtures = await client.getTeamSeasonFixtures(teamId, season);
  const selected = domesticLeagueFromFixtures(fixtures, teamId, leagueTypes);
  database.saveStrengthTeamLeague(teamId, season, selected ?? 0);
  return selected;
}

export async function buildLeagueStrength(options: {
  client?: ApiFootballClient;
  database?: AnalyzerDatabase;
  seasons?: number;
  requestBudget?: number;
  now?: Date;
  competitionIds?: number[];
} = {}): Promise<StrengthBuildResult> {
  const client = options.client ?? new ApiFootballClient();
  const ownsDatabase = !options.database;
  const database = options.database ?? new AnalyzerDatabase();
  const seasonCount = Math.max(1, Math.min(10, options.seasons ?? 3));
  const requestBudget = Math.max(1, options.requestBudget ?? 100);
  const now = options.now ?? new Date();
  const requestStart = client.requestCount;
  let competitionsProcessed = 0;
  let fixturesCollected = 0;
  let fixturesStored = 0;
  let budgetReached = false;
  try {
    const leagues = await client.getAllLeagues();
    const selectedCompetitionIds = options.competitionIds?.length
      ? new Set(options.competitionIds)
      : null;
    const competitions = selectedCompetitionIds
      ? leagues
          .filter((league) => selectedCompetitionIds.has(league.league.id))
          .filter((league) => league.league.type.toLocaleLowerCase() !== "league")
          .filter((league) => !NON_COMPETITIVE_PATTERN.test(league.league.name))
      : relevantCompetitions(leagues);
    const leagueTypes = new Map(
      leagues.map((league) => [league.league.id, league.league.type])
    );
    outer:
    for (const competition of competitions) {
      for (const season of seasonsFor(
        competition,
        seasonCount,
        now
      )) {
        if (database.isStrengthSeasonComplete(competition.league.id, season)) {
          competitionsProcessed += 1;
          continue;
        }
        if (client.requestCount - requestStart >= requestBudget) {
          budgetReached = true;
          break outer;
        }
        const fixtures = completedFixtures(
          await client.getSeasonFixtures(competition.league.id, season)
        );
        fixturesCollected += fixtures.length;
        for (const fixture of fixtures) {
          try {
            const homeLeagueId = await teamLeague(
              client,
              database,
              leagueTypes,
              fixture.teams.home.id,
              season,
              requestBudget,
              requestStart
            );
            const awayLeagueId = await teamLeague(
              client,
              database,
              leagueTypes,
              fixture.teams.away.id,
              season,
              requestBudget,
              requestStart
            );
            if (
              homeLeagueId === null ||
              awayLeagueId === null ||
              homeLeagueId === awayLeagueId
            ) continue;
            const score = completedScore(fixture)!;
            const stored = database.saveStrengthMatch({
              fixtureId: fixture.fixture.id,
              pool: strengthPool(fixture),
              season,
              kickoff: fixture.fixture.date,
              homeLeagueId,
              awayLeagueId,
              homeClubId: fixture.teams.home.id,
              awayClubId: fixture.teams.away.id,
              homeGoals: score[0],
              awayGoals: score[1]
            });
            if (stored) fixturesStored += 1;
          } catch (error) {
            if (error instanceof RequestBudgetReached) {
              budgetReached = true;
              break outer;
            }
            throw error;
          }
        }
        const seasonDetails = competition.seasons.find(
          (item) => item.year === season
        );
        const seasonEnded =
          seasonDetails !== undefined &&
          Date.parse(seasonDetails.end) < now.getTime();
        if (seasonEnded) {
          database.markStrengthSeasonComplete(
            competition.league.id,
            season,
            now.toISOString()
          );
        }
        competitionsProcessed += 1;
      }
    }
    const snapshotsWritten = rebuildStrengthSnapshots(database);
    return {
      competitions: competitionsProcessed,
      fixturesCollected,
      fixturesStored,
      snapshotsWritten,
      apiRequests: client.requestCount - requestStart,
      budgetReached
    };
  } finally {
    if (ownsDatabase) database.close();
  }
}

export function rebuildStrengthSnapshots(database: AnalyzerDatabase): number {
  const matches = database.strengthMatches();
  const ratings = new Map<string, number>();
  const matchCounts = new Map<string, number>();
  const clubs = new Map<string, Set<number>>();
  const currentSeason = new Map<string, number>();
  let written = 0;
  const ratingKey = (pool: string, leagueId: number) => `${pool}|${leagueId}`;
  for (const match of matches) {
    const priorSeason = currentSeason.get(match.pool);
    if (priorSeason !== undefined && priorSeason !== match.season) {
      for (const [key, rating] of ratings) {
        if (key.startsWith(`${match.pool}|`)) {
          ratings.set(key, 1500 + (rating - 1500) * 0.8);
        }
      }
    }
    currentSeason.set(match.pool, match.season);
    const homeKey = ratingKey(match.pool, match.homeLeagueId);
    const awayKey = ratingKey(match.pool, match.awayLeagueId);
    const homeRating = ratings.get(homeKey) ?? 1500;
    const awayRating = ratings.get(awayKey) ?? 1500;
    const expectedHome =
      1 / (1 + 10 ** ((awayRating - (homeRating + 50)) / 400));
    const actualHome =
      match.homeGoals > match.awayGoals
        ? 1
        : match.homeGoals === match.awayGoals
          ? 0.5
          : 0;
    const goalDifference = Math.abs(match.homeGoals - match.awayGoals);
    const margin = Math.min(1.5, 1 + Math.max(0, goalDifference - 1) * 0.25);
    const change = 20 * margin * (actualHome - expectedHome);
    ratings.set(homeKey, homeRating + change);
    ratings.set(awayKey, awayRating - change);
    matchCounts.set(homeKey, (matchCounts.get(homeKey) ?? 0) + 1);
    matchCounts.set(awayKey, (matchCounts.get(awayKey) ?? 0) + 1);
    const homeClubs = clubs.get(homeKey) ?? new Set<number>();
    homeClubs.add(match.homeClubId);
    clubs.set(homeKey, homeClubs);
    const awayClubs = clubs.get(awayKey) ?? new Set<number>();
    awayClubs.add(match.awayClubId);
    clubs.set(awayKey, awayClubs);
    for (const [key, leagueId] of [
      [homeKey, match.homeLeagueId],
      [awayKey, match.awayLeagueId]
    ] as const) {
      const count = matchCounts.get(key) ?? 0;
      const clubCount = clubs.get(key)?.size ?? 0;
      database.saveLeagueStrength({
        pool: match.pool,
        leagueId,
        season: match.season,
        asOf: match.kickoff,
        rating: ratings.get(key) ?? 1500,
        matches: count,
        clubs: clubCount,
        reliable: count >= 30 && clubCount >= 5
      });
      written += 1;
    }
  }
  return written;
}
