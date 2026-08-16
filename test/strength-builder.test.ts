import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ApiFootballClient } from "../src/api.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import {
  buildLeagueStrength,
  rebuildStrengthSnapshots,
  relevantCompetitions
} from "../src/strength-builder.ts";
import type { ApiFixture, ApiLeague } from "../src/types.ts";
import { fixture } from "./helpers.ts";

test("Ligastärke berücksichtigt internationale Club- und nationale Divisionsduelle", () => {
  const league = (
    id: number,
    name: string,
    country: string
  ): ApiLeague => ({
    league: { id, name, type: "Cup" },
    country: { name: country },
    seasons: []
  });
  const selected = relevantCompetitions([
    league(81, "DFB Pokal", "Germany"),
    league(3, "UEFA Europa League", "World"),
    league(6, "Africa Cup of Nations", "World"),
    league(900, "Club Friendly", "Germany")
  ]);
  assert.deepEqual(selected.map((item) => item.league.id), [3, 81]);
});

test("Ligastärke-Builder lädt bei Bedarf nur ausgewählte Wettbewerbe", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-target-strength-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const cup = (id: number, name: string): ApiLeague => ({
    league: { id, name, type: "Cup" },
    country: { name: id === 3 ? "World" : "Germany" },
    seasons: [{
      year: 2025,
      start: "2025-01-01",
      end: "2025-12-31",
      current: false
    }]
  });
  const seasonCalls: number[] = [];
  const fake = {
    requestCount: 7,
    requestsRemaining: 1_000,
    getAllLeagues: async () => {
      fake.requestCount += 1;
      return [cup(3, "UEFA Europa League"), cup(81, "DFB Pokal")];
    },
    getSeasonFixtures: async (leagueId: number) => {
      fake.requestCount += 1;
      seasonCalls.push(leagueId);
      return [];
    }
  } as unknown as ApiFootballClient;
  const result = await buildLeagueStrength({
    client: fake,
    database,
    seasons: 3,
    requestBudget: 10,
    competitionIds: [81],
    now: new Date("2026-01-02T00:00:00.000Z")
  });
  assert.deepEqual(seasonCalls, [81]);
  assert.equal(result.apiRequests, 2);
  assert.equal(result.competitions, 1);
  database.close();
});

test("Ligastärke wird zeitlich korrekt aufgebaut und erst belastbar aktiviert", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-strength-db-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  for (let index = 0; index < 30; index += 1) {
    database.saveStrengthMatch({
      fixtureId: 10_000 + index,
      pool: "uefa",
      season: 2025,
      kickoff: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
      homeLeagueId: 78,
      awayLeagueId: 207,
      homeClubId: 1 + index % 5,
      awayClubId: 101 + index % 5,
      homeGoals: 2,
      awayGoals: 0
    });
  }
  assert.equal(rebuildStrengthSnapshots(database), 60);
  const before = database.getLeagueStrength(
    "uefa",
    78,
    2025,
    "2025-01-01T00:00:00.000Z"
  );
  const after = database.getLeagueStrength(
    "uefa",
    78,
    2025,
    "2025-02-15T00:00:00.000Z"
  );
  assert.equal(before, null);
  assert.equal(after?.reliable, true);
  assert.equal(after?.matches, 30);
  assert.ok((after?.rating ?? 0) > 1500);
  const nextSeason = database.getLeagueStrength(
    "uefa",
    78,
    2026,
    "2026-01-01T00:00:00.000Z"
  );
  assert.ok(
    Math.abs(
      (nextSeason?.rating ?? 0) -
      (1500 + ((after?.rating ?? 1500) - 1500) * 0.8)
    ) < 1e-9
  );
  database.close();
});

test("Ligastärke-Builder nutzt nur das konfigurierte API-Budget und speichert Fortschritt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-strength-build-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const kickoff = Date.parse("2025-07-01T18:00:00.000Z") / 1000;
  const cross = fixture({
    id: 20_001,
    timestamp: kickoff,
    homeId: 1,
    awayId: 2,
    homeGoals: 2,
    awayGoals: 1,
    leagueId: 3,
    leagueName: "UEFA Europa League",
    country: "World",
    season: 2025
  });
  const leagues: ApiLeague[] = [{
    league: { id: 3, name: "UEFA Europa League", type: "Cup" },
    country: { name: "World" },
    seasons: [{ year: 2025, start: "2025-01-01", end: "2025-12-31", current: false }]
  }, {
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{ year: 2025, start: "2025-01-01", end: "2025-12-31", current: false }]
  }, {
    league: { id: 207, name: "Super League", type: "League" },
    country: { name: "Switzerland" },
    seasons: [{ year: 2025, start: "2025-01-01", end: "2025-12-31", current: false }]
  }];
  const domestic = (teamId: number, leagueId: number): ApiFixture[] => [fixture({
    id: 30_000 + teamId,
    timestamp: kickoff - 7 * 86_400,
    homeId: teamId,
    awayId: 100 + teamId,
    homeGoals: 1,
    awayGoals: 0,
    leagueId,
    leagueName: `Liga ${leagueId}`,
    season: 2025
  })];
  const fake = {
    requestCount: 0,
    requestsRemaining: 1_000,
    getAllLeagues: async () => {
      fake.requestCount += 1;
      return leagues;
    },
    getSeasonFixtures: async () => {
      fake.requestCount += 1;
      return [cross];
    },
    getTeamSeasonFixtures: async (teamId: number) => {
      fake.requestCount += 1;
      return teamId === 1 ? domestic(1, 78) : domestic(2, 207);
    }
  } as unknown as ApiFootballClient;
  const result = await buildLeagueStrength({
    client: fake,
    database,
    seasons: 3,
    requestBudget: 4,
    now: new Date("2026-01-01T00:00:00.000Z")
  });
  assert.equal(result.apiRequests, 4);
  assert.equal(result.fixturesStored, 1);
  assert.equal(database.strengthMatches().length, 1);
  const resumed = {
    requestCount: 0,
    requestsRemaining: 1_000,
    getAllLeagues: async () => {
      resumed.requestCount += 1;
      return leagues;
    },
    getSeasonFixtures: async (): Promise<ApiFixture[]> => {
      throw new Error("bereits abgeschlossene Saison wurde erneut geladen");
    },
    getTeamSeasonFixtures: async (): Promise<ApiFixture[]> => {
      throw new Error("bereits aufgelöste Teams wurden erneut geladen");
    }
  } as unknown as ApiFootballClient;
  const resumedResult = await buildLeagueStrength({
    client: resumed,
    database,
    seasons: 3,
    requestBudget: 4,
    now: new Date("2026-01-02T00:00:00.000Z")
  });
  assert.equal(resumedResult.apiRequests, 1);
  assert.equal(resumedResult.fixturesStored, 0);
  database.close();
});
