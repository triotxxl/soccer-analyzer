import { config } from "./config.ts";
import type { ApiFootballClient } from "./api.ts";
import type { AnalyzerDatabase } from "./database.ts";
import type { ApiFixture, ApiTeamStatistics, FixtureExpectedGoals } from "./types.ts";

const completeStatuses = new Set(["FT", "AET", "PEN"]);

function normalizedType(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z]/g, "");
}

function numericXg(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseExpectedGoals(
  statistics: ApiTeamStatistics[] | undefined,
  homeTeamId: number,
  awayTeamId: number
): { home: number | null; away: number | null } {
  const valueFor = (teamId: number) => numericXg(statistics
    ?.find((entry) => entry.team.id === teamId)
    ?.statistics.find((entry) => normalizedType(entry.type) === "expectedgoals")?.value);
  return { home: valueFor(homeTeamId), away: valueFor(awayTeamId) };
}

function record(fixture: ApiFixture, values: { home: number | null; away: number | null }, fetchedAt: string): FixtureExpectedGoals {
  const available = values.home !== null && values.away !== null;
  return {
    fixtureId: fixture.fixture.id, kickoff: fixture.fixture.date, leagueId: fixture.league.id,
    season: fixture.league.season, homeTeamId: fixture.teams.home.id, awayTeamId: fixture.teams.away.id,
    homeXg: values.home, awayXg: values.away, status: available ? "available" : "unavailable", fetchedAt
  };
}

function shouldRetry(row: FixtureExpectedGoals, fixture: ApiFixture, now: Date): boolean {
  if (row.status === "available") return false;
  const matchAge = now.getTime() - fixture.fixture.timestamp * 1000;
  const retryAfter = matchAge <= 7 * 86_400_000 ? 86_400_000 : 30 * 86_400_000;
  return now.getTime() - Date.parse(row.fetchedAt) >= retryAfter;
}

export async function enrichFixtureExpectedGoals(
  fixtures: ApiFixture[],
  client: ApiFootballClient,
  database: AnalyzerDatabase,
  options: { maxRequests?: number; now?: Date } = {}
): Promise<{ values: Map<number, FixtureExpectedGoals>; requests: number }> {
  const now = options.now ?? new Date();
  const budget = Math.max(0, options.maxRequests ?? config.xgEnrichmentRequestBudget);
  const eligible = [...new Map(fixtures
    .filter((fixture) => completeStatuses.has(fixture.fixture.status.short))
    .filter((fixture) => !/\b(friendl|freundschaft)/i.test(fixture.league.name))
    .filter((fixture) => fixture.fixture.timestamp * 1000 < now.getTime())
    .map((fixture) => [fixture.fixture.id, fixture])).values()]
    .sort((left, right) => right.fixture.timestamp - left.fixture.timestamp);
  const existing = database.expectedGoalsForFixtures(eligible.map((fixture) => fixture.fixture.id));
  if (typeof client.getFixturesWithStatistics !== "function") {
    return { values: existing, requests: 0 };
  }
  const pending = eligible.filter((fixture) => {
    const cached = existing.get(fixture.fixture.id);
    return !cached || shouldRetry(cached, fixture, now);
  });
  let requests = 0;
  const fetchedAt = now.toISOString();
  for (let offset = 0; offset < pending.length && requests < budget; offset += 20) {
    const batch = pending.slice(offset, offset + 20);
    const returned = await client.getFixturesWithStatistics(batch.map((fixture) => fixture.fixture.id));
    requests += 1;
    const returnedById = new Map(returned.map((fixture) => [fixture.fixture.id, fixture]));
    const updates: FixtureExpectedGoals[] = [];
    for (const fixture of batch) {
      const embedded = returnedById.get(fixture.fixture.id);
      let values = parseExpectedGoals(embedded?.statistics, fixture.teams.home.id, fixture.teams.away.id);
      if ((values.home === null || values.away === null) && requests < budget) {
        const stats = await client.getFixtureStatistics(fixture.fixture.id, false);
        requests += 1;
        values = parseExpectedGoals(stats, fixture.teams.home.id, fixture.teams.away.id);
      }
      const next = record(fixture, values, fetchedAt);
      existing.set(fixture.fixture.id, next);
      updates.push(next);
      if (requests >= budget) break;
    }
    database.saveFixtureExpectedGoals(updates);
  }
  return { values: existing, requests };
}
