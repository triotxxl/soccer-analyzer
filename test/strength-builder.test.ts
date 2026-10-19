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
import { strengthPool } from "../src/league-strength.ts";
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

test("Ligastärke-Builder lädt die neueste Saison zuerst", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-strength-order-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const season = (year: number) => ({ year, start: `${year}-07-01`, end: `${year + 1}-06-30`, current: false });
  const seasonCalls: number[] = [];
  const fake = {
    requestCount: 0,
    requestsRemaining: 1_000,
    getAllLeagues: async () => {
      fake.requestCount += 1;
      return [{
        league: { id: 347, name: "Cup", type: "Cup" },
        country: { name: "Czech-Republic" },
        seasons: [season(2023), season(2024), season(2025), season(2026)]
      }] satisfies ApiLeague[];
    },
    getSeasonFixtures: async (_leagueId: number, year: number) => {
      fake.requestCount += 1;
      seasonCalls.push(year);
      return [];
    }
  } as unknown as ApiFootballClient;
  // Budget für genau zwei Saisons: Es müssen die laufende und die davor sein, nicht die ältesten.
  await buildLeagueStrength({
    client: fake,
    database,
    seasons: 3,
    requestBudget: 3,
    competitionIds: [347],
    now: new Date("2026-09-29T00:00:00.000Z")
  });
  assert.deepEqual(seasonCalls, [2026, 2025]);
  database.close();
});

test("Eine Pokalsaison mit offener Ansetzung gilt nicht als fertig, auch wenn ihr Ende vorbei ist", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-strength-open-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const cup = (end: string): ApiLeague[] => [{
    league: { id: 46, name: "EFL Trophy", type: "Cup" },
    country: { name: "England" },
    seasons: [{ year: 2026, start: "2026-08-01", end, current: true }]
  }];
  let leagues = cup("2026-09-20");
  const played = fixture({ id: 1, timestamp: Date.parse("2026-09-01T18:00:00Z") / 1000, homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, leagueId: 46 });
  // Die nächste Runde ist schon angesetzt, das `end` der API hinkt hinterher.
  const upcoming = fixture({ id: 2, timestamp: Date.parse("2026-10-06T18:00:00Z") / 1000, homeId: 3, awayId: 4, status: "NS", leagueId: 46 });
  let seasonFixtures = [played, upcoming];
  const fake = {
    requestCount: 0,
    requestsRemaining: 1_000,
    getAllLeagues: async () => leagues,
    getSeasonFixtures: async () => seasonFixtures,
    getTeamSeasonFixtures: async () => []
  } as unknown as ApiFootballClient;
  const run = (now: string) => buildLeagueStrength({
    client: fake, database, seasons: 1, requestBudget: 50, competitionIds: [46], now: new Date(now)
  });
  await run("2026-09-25T00:00:00Z");
  assert.equal(database.isStrengthSeasonComplete(46, 2026), false, "offene Ansetzung - nicht fertig");

  // Alle Spiele gespielt und das Ende vorbei: jetzt fertig.
  seasonFixtures = [played];
  await run("2026-09-25T00:00:00Z");
  assert.equal(database.isStrengthSeasonComplete(46, 2026, "2026-09-20"), true);

  // API-Football hängt eine weitere Runde an und schiebt `end` nach hinten: Die alte Markierung
  // gilt nicht mehr, die Saison wird erneut geladen.
  leagues = cup("2026-11-24");
  assert.equal(database.isStrengthSeasonComplete(46, 2026, "2026-11-24"), false);
  let reloaded = false;
  (fake as unknown as { getSeasonFixtures: () => Promise<ApiFixture[]> }).getSeasonFixtures = async () => {
    reloaded = true;
    return [played];
  };
  await run("2026-10-05T00:00:00Z");
  assert.ok(reloaded, "verlängerte Saison wird neu geladen");
  database.close();
});

test("Absagen als „Canc“ und monatealte verschobene Spiele halten eine Saison nicht offen", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-strength-stale-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const leagues: ApiLeague[] = [{
    league: { id: 73, name: "Copa Do Brasil", type: "Cup" },
    country: { name: "Brazil" },
    seasons: [{ year: 2025, start: "2025-02-01", end: "2025-12-15", current: false }]
  }];
  const played = fixture({ id: 1, timestamp: Date.parse("2025-12-10T22:00:00Z") / 1000, homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 1, leagueId: 73, season: 2025 });
  const cancelled = fixture({ id: 2, timestamp: Date.parse("2025-11-01T22:00:00Z") / 1000, homeId: 3, awayId: 4, status: "Canc", leagueId: 73, season: 2025 });
  const postponedLongAgo = fixture({ id: 3, timestamp: Date.parse("2025-02-19T22:00:00Z") / 1000, homeId: 5, awayId: 6, status: "PST", leagueId: 73, season: 2025 });
  const fake = {
    requestCount: 0,
    requestsRemaining: 1_000,
    getAllLeagues: async () => leagues,
    getSeasonFixtures: async () => [played, cancelled, postponedLongAgo],
    getTeamSeasonFixtures: async () => []
  } as unknown as ApiFootballClient;
  await buildLeagueStrength({
    client: fake, database, seasons: 1, requestBudget: 50, competitionIds: [73], now: new Date("2026-01-10T00:00:00Z")
  });
  assert.equal(database.isStrengthSeasonComplete(73, 2025, "2025-12-15"), true);
  database.close();
});

test("Ein kürzlich verschobenes Spiel hält die Saison offen", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-strength-recent-pst-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const leagues: ApiLeague[] = [{
    league: { id: 73, name: "Copa Do Brasil", type: "Cup" },
    country: { name: "Brazil" },
    seasons: [{ year: 2025, start: "2025-02-01", end: "2025-12-15", current: true }]
  }];
  const postponed = fixture({ id: 4, timestamp: Date.parse("2025-12-14T22:00:00Z") / 1000, homeId: 7, awayId: 8, status: "PST", leagueId: 73, season: 2025 });
  const fake = {
    requestCount: 0,
    requestsRemaining: 1_000,
    getAllLeagues: async () => leagues,
    getSeasonFixtures: async () => [postponed],
    getTeamSeasonFixtures: async () => []
  } as unknown as ApiFootballClient;
  await buildLeagueStrength({
    client: fake, database, seasons: 1, requestBudget: 50, competitionIds: [73], now: new Date("2025-12-20T00:00:00Z")
  });
  assert.equal(database.isStrengthSeasonComplete(73, 2025), false);
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

test("Ligastärke-Builder nennt, wo das Budget mitten in einer Saison griff", async () => {
  // Der Fall vom 19.10.2026: Das Budget endet zwischen Heim- und Gastverein eines Duells; die
  // Ausgabe der Analyse soll zeigen, welche Saison unvollständig blieb.
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-strength-stop-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const cross = fixture({
    id: 21_001, timestamp: Date.parse("2025-07-01T18:00:00.000Z") / 1000, homeId: 1, awayId: 2,
    homeGoals: 2, awayGoals: 1, leagueId: 172, leagueName: "Cup", country: "Bulgaria", season: 2025
  });
  const leagues: ApiLeague[] = [{
    league: { id: 172, name: "Cup", type: "Cup" },
    country: { name: "Bulgaria" },
    seasons: [{ year: 2025, start: "2025-01-01", end: "2025-12-31", current: false }]
  }];
  const fake = {
    requestCount: 0,
    requestsRemaining: 1_000,
    getAllLeagues: async () => { fake.requestCount += 1; return leagues; },
    getSeasonFixtures: async () => { fake.requestCount += 1; return [cross]; },
    getTeamSeasonFixtures: async () => { fake.requestCount += 1; return []; }
  } as unknown as ApiFootballClient;
  const result = await buildLeagueStrength({
    client: fake, database, seasons: 1, requestBudget: 3, competitionIds: [172],
    now: new Date("2026-01-01T00:00:00.000Z")
  });
  assert.equal(result.budgetReached, true);
  assert.deepEqual(result.stoppedAt, { leagueId: 172, competition: "Cup", season: 2025, done: 0, total: 1 });
  database.close();
});

test("Frauenwettbewerbe bekommen einen eigenen Pool", () => {
  const women = fixture({ id: 1, timestamp: 1_700_000_000, homeId: 1, awayId: 2, leagueName: "UEFA Champions League Women", country: "World" });
  const men = fixture({ id: 2, timestamp: 1_700_000_000, homeId: 1, awayId: 2, leagueName: "UEFA Europa League", country: "World" });
  // "SWPL Cup" sagt am Namen nichts - die Teams tragen das " W".
  const scottish = fixture({ id: 3, timestamp: 1_700_000_000, homeId: 1, awayId: 2, leagueName: "SWPL Cup", country: "Scotland" });
  scottish.teams.home.name = "Rangers W";
  scottish.teams.away.name = "Hearts W";
  const national = fixture({ id: 4, timestamp: 1_700_000_000, homeId: 1, awayId: 2, leagueName: "DFB Pokal Frauen", country: "Germany" });
  assert.equal(strengthPool(women), "uefa:women");
  assert.equal(strengthPool(men), "uefa");
  assert.equal(strengthPool(scottish), "country:scotland:women");
  assert.equal(strengthPool(national), "country:germany:women");
});

test("Frauenligen sind ab 3 Vereinen belastbar, Männerligen erst ab 5", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-strength-women-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  // Je Pool 30 Duelle zweier Ligen mit genau 4 Vereinen auf jeder Seite.
  for (const [offset, pool] of [[0, "uefa:women"], [1000, "uefa"]] as const) {
    for (let index = 0; index < 30; index += 1) {
      database.saveStrengthMatch({
        fixtureId: 40_000 + offset + index,
        pool,
        season: 2026,
        kickoff: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        homeLeagueId: 82,
        awayLeagueId: 44,
        homeClubId: 1 + index % 4,
        awayClubId: 101 + index % 4,
        homeGoals: 1,
        awayGoals: 1
      });
    }
  }
  rebuildStrengthSnapshots(database);
  const cutoff = "2026-03-01T00:00:00.000Z";
  assert.equal(database.getLeagueStrength("uefa:women", 82, 2026, cutoff)?.reliable, true);
  assert.equal(database.getLeagueStrength("uefa", 82, 2026, cutoff)?.reliable, false);
  // Der Boden kommt nur aus dem eigenen Pool.
  assert.equal(database.getPoolRatingFloor("uefa", 2026, cutoff), null);
  assert.ok(database.getPoolRatingFloor("uefa:women", 2026, cutoff) !== null);
  database.close();
});

test("Der Neuaufbau ersetzt alle Ratings - verschobene Duelle hinterlassen keine alten Zeilen", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-strength-replace-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  for (let index = 0; index < 30; index += 1) {
    database.saveStrengthMatch({
      fixtureId: 50_000 + index,
      pool: "uefa",
      season: 2026,
      kickoff: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      homeLeagueId: 82,
      awayLeagueId: 44,
      homeClubId: 1 + index % 5,
      awayClubId: 101 + index % 5,
      homeGoals: 2,
      awayGoals: 0
    });
  }
  rebuildStrengthSnapshots(database);
  const cutoff = "2026-03-01T00:00:00.000Z";
  assert.ok(database.getLeagueStrength("uefa", 82, 2026, cutoff));
  database.moveStrengthMatches(Array.from({ length: 30 }, (_unused, index) => 50_000 + index), "uefa:women");
  rebuildStrengthSnapshots(database);
  assert.equal(database.getLeagueStrength("uefa", 82, 2026, cutoff), null);
  assert.equal(database.getLeagueStrength("uefa:women", 82, 2026, cutoff)?.reliable, true);
  database.close();
});
