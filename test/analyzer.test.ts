import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ApiFootballClient } from "../src/api.ts";
import {
  runAnalysis,
  runDrawCriteriaAnalysis,
  runFavoriteAnalysis,
  runGoalLineAnalysis
} from "../src/analyzer.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import { formatGoalLineAnalysis } from "../src/output.ts";
import type { ApiFixture, ApiLeague } from "../src/types.ts";
import { readTeamAliases, teamAliasKey } from "../src/team-resolver.ts";
import { fixture, history } from "./helpers.ts";

test("End-to-End-Analyse nutzt Auswahl, Datum, Historie und Datenbank ohne Netzwerk", async () => {
  const target = new Date("2026-07-29T10:00:00.000Z");
  const timestamp = Date.parse("2026-07-29T18:00:00.000Z") / 1000;
  const upcoming = fixture({ id: 999, timestamp, homeId: 1, awayId: 2 });
  const leagues: ApiLeague[] = [{
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{ year: 2026, start: "2026-01-01", end: "2026-12-31", current: true }]
  }];
  const fake = {
    requestCount: 0,
    requestsRemaining: 7_500,
    getLeagues: async () => leagues,
    getFixturesForDate: async (date: string): Promise<ApiFixture[]> =>
      date === "2026-07-29" ? [upcoming] : [],
    getSeasonFixtures: async () => history(timestamp)
  } as unknown as ApiFootballClient;
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-e2e-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const result = await runAnalysis({
    selections: [{ country: "Deutschland", league: "Bundesliga" }],
    markets: ["draw", "btts", "over25", "1x2"],
    dates: "both"
  }, { client: fake, database, now: target });
  assert.equal(result.fixtureCount, 1);
  assert.equal(result.resolvedLeagues[0]?.leagueId, 78);
  assert.equal(result.dates.length, 2);
  assert.ok(result.runId > 0);
  database.close();
});

test("Analyse speichert eine eindeutig erkannte Team-Kurzform und verwendet sie", async () => {
  const target = new Date("2026-07-29T10:00:00.000Z");
  const timestamp = Date.parse("2026-07-29T18:00:00.000Z") / 1000;
  const upcoming = fixture({ id: 998, timestamp, homeId: 1, awayId: 2 });
  upcoming.teams.home.name = "Paris Saint Germain";
  upcoming.teams.away.name = "Aston Villa";
  const leagues: ApiLeague[] = [{
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{ year: 2026, start: "2026-01-01", end: "2026-12-31", current: true }]
  }];
  const fake = {
    requestCount: 0,
    requestsRemaining: 7_500,
    getLeagues: async () => leagues,
    getFixturesForDate: async (date: string): Promise<ApiFixture[]> =>
      date === "2026-07-29" ? [upcoming] : [],
    getSeasonFixtures: async () => history(timestamp)
  } as unknown as ApiFootballClient;
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-team-alias-e2e-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const aliasFile = path.join(directory, "team-aliases.json");
  const result = await runAnalysis({
    selections: [{ country: "Deutschland", league: "Bundesliga" }],
    markets: ["draw"],
    dates: "both",
    matches: [{ homeTeam: "Paris Saint G.", awayTeam: "Aston Villa" }]
  }, { client: fake, database, now: target, teamAliasFile: aliasFile });
  const aliases = await readTeamAliases(aliasFile);

  assert.equal(result.fixtureCount, 1);
  assert.equal(aliases[teamAliasKey("Paris Saint G.")]?.apiTeamId, 1);
  database.close();
});

test("Torlinien-End-to-End analysiert und speichert nur konkret ausgewählte Partien", async () => {
  const target = new Date("2026-07-29T10:00:00.000Z");
  const timestamp = Date.parse("2026-07-29T18:00:00.000Z") / 1000;
  const selected = fixture({ id: 901, timestamp, homeId: 1, awayId: 2 });
  const extra = fixture({ id: 902, timestamp: timestamp + 3600, homeId: 3, awayId: 4 });
  const past = history(timestamp);
  const leagues: ApiLeague[] = [{
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{ year: 2026, start: "2026-01-01", end: "2026-12-31", current: true }]
  }];
  const fake = {
    requestCount: 0,
    requestsRemaining: 7_500,
    getLeagues: async () => leagues,
    getFixturesForDate: async (date: string): Promise<ApiFixture[]> =>
      date === "2026-07-29" ? [extra, selected] : [],
    getSeasonFixtures: async () => past
  } as unknown as ApiFootballClient;
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-goals-e2e-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const result = await runGoalLineAnalysis({
    selections: [{ country: "Deutschland", league: "Bundesliga" }],
    markets: [],
    dates: "both",
    matches: [{ homeTeam: selected.teams.home.name, awayTeam: selected.teams.away.name }]
  }, { client: fake, database, now: target });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.fixtureId, 901);
  assert.equal(result.rows[0]?.modelVersion, "3.0.0");
  assert.ok(Math.abs(
    result.rows[0]!.probabilities.over25 + result.rows[0]!.probabilities.under25 - 1
  ) < 1e-12);
  assert.ok(Math.abs(
    result.rows[0]!.firstHalf.probabilities.over05 + result.rows[0]!.firstHalf.probabilities.under05 - 1
  ) < 1e-12);
  assert.equal(database.goalLinePredictionCount(), 1);
  const output = formatGoalLineAnalysis(result);
  assert.match(output, /Ü 1,5.*U 1,5.*Ü 2,5.*U 2,5.*Ü 3,5.*U 3,5/);
  assert.match(output, /1\. Halbzeit[\s\S]*Ü 0,5.*U 0,5.*Ü 1,5.*U 1,5/);
  assert.match(output, /Datenvertrauen/);
  assert.doesNotMatch(output, /Gewinnwahrscheinlichkeit[^.]*Datenvertrauen/);
  database.close();
});

test("Torlinien ordnen dieselbe Paarung an zwei Terminen über die Anstoßzeit zu", async () => {
  const target = new Date("2026-07-29T10:00:00.000Z");
  const firstTimestamp = Date.parse("2026-07-29T18:00:00.000Z") / 1000;
  const secondTimestamp = Date.parse("2026-07-30T18:00:00.000Z") / 1000;
  const first = fixture({ id: 911, timestamp: firstTimestamp, homeId: 1, awayId: 2 });
  const second = fixture({ id: 912, timestamp: secondTimestamp, homeId: 1, awayId: 2 });
  const leagues: ApiLeague[] = [{
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{ year: 2026, start: "2026-01-01", end: "2026-12-31", current: true }]
  }];
  const fake = {
    requestCount: 0,
    requestsRemaining: 7_500,
    getLeagues: async () => leagues,
    getFixturesForDate: async (date: string): Promise<ApiFixture[]> =>
      date === "2026-07-29" ? [first] : date === "2026-07-30" ? [second] : [],
    getSeasonFixtures: async () => history(firstTimestamp)
  } as unknown as ApiFootballClient;
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-repeat-fixture-e2e-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const result = await runGoalLineAnalysis({
    selections: [{ country: "Deutschland", league: "Bundesliga" }],
    markets: [],
    dates: "both",
    matches: [
      {
        homeTeam: first.teams.home.name,
        awayTeam: first.teams.away.name,
        kickoff: new Date(firstTimestamp * 1000).toISOString()
      },
      {
        homeTeam: second.teams.home.name,
        awayTeam: second.teams.away.name,
        kickoff: new Date(secondTimestamp * 1000).toISOString()
      }
    ]
  }, { client: fake, database, now: target });
  assert.deepEqual(result.rows.map((row) => row.fixtureId), [911, 912]);
  database.close();
});

test("Torlinien laden bei Cross-League-Spielen die letzten Pflichtspiele beider Teams", async () => {
  const target = new Date("2026-07-29T10:00:00.000Z");
  const timestamp = Date.parse("2026-07-29T18:00:00.000Z") / 1000;
  const upcoming = fixture({
    id: 903,
    timestamp,
    homeId: 1,
    awayId: 2,
    leagueId: 3,
    leagueName: "UEFA Europa League",
    country: "World"
  });
  const past = history(timestamp);
  const leagues: ApiLeague[] = [{
    league: { id: 3, name: "UEFA Europa League", type: "Cup" },
    country: { name: "World" },
    seasons: [{ year: 2026, start: "2026-07-01", end: "2027-05-31", current: true }]
  }];
  const recentCalls: number[] = [];
  const fake = {
    requestCount: 0,
    requestsRemaining: 7_500,
    getLeagues: async () => leagues,
    getFixturesForDate: async (date: string): Promise<ApiFixture[]> =>
      date === "2026-07-29" ? [upcoming] : [],
    getSeasonFixtures: async () => [],
    getTeamRecentFixtures: async (teamId: number) => {
      recentCalls.push(teamId);
      return past.filter((match) =>
        match.teams.home.id === teamId || match.teams.away.id === teamId
      );
    }
  } as unknown as ApiFootballClient;
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-goals-cross-e2e-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const result = await runGoalLineAnalysis({
    selections: [{ country: "World", league: "UEFA Europa League" }],
    markets: [],
    dates: "both"
  }, { client: fake, database, now: target });
  assert.deepEqual(recentCalls.sort(), [1, 2]);
  assert.match(result.rows[0]?.warnings.join(" ") ?? "", /Cross-League/);
  assert.ok((result.rows[0]?.dataConfidence ?? 0) > 10);
  database.close();
});

test("Remis-End-to-End-Analyse lädt Zusatzdaten und bewertet jedes Spiel", async () => {
  const target = new Date("2026-07-29T10:00:00.000Z");
  const timestamp = Date.parse("2026-07-29T18:00:00.000Z") / 1000;
  const upcoming = fixture({ id: 999, timestamp, homeId: 1, awayId: 2 });
  const notRequested = fixture({ id: 1000, timestamp, homeId: 3, awayId: 4 });
  const past = history(timestamp);
  const leagues: ApiLeague[] = [{
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{
      year: 2026,
      start: "2026-01-01",
      end: "2026-12-31",
      current: true,
      coverage: { standings: true }
    }]
  }];
  const fake = {
    requestCount: 0,
    requestsRemaining: 7_500,
    getLeagues: async () => leagues,
    getFixturesForDate: async (date: string): Promise<ApiFixture[]> =>
      date === "2026-07-29" ? [upcoming, notRequested] : [],
    getSeasonFixtures: async () => past,
    getTeamRecentFixtures: async (teamId: number) =>
      past.filter((match) =>
        match.teams.home.id === teamId || match.teams.away.id === teamId
      ).slice(0, 5),
    getHeadToHead: async () => [],
    getFixtureOdds: async () => []
  } as unknown as ApiFootballClient;
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-draw-profile-e2e-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const result = await runDrawCriteriaAnalysis({
    selections: [{ country: "Deutschland", league: "Bundesliga" }],
    markets: ["draw"],
    dates: "both",
    matches: [{ homeTeam: upcoming.teams.home.name, awayTeam: upcoming.teams.away.name }]
  }, { client: fake, database, now: target });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.fixtureId, 999);
  assert.equal(result.rows[0]?.model, "league");
  assert.ok(Number.isInteger(result.rows[0]?.score));
  assert.equal(database.profilePredictionCount(), 1);
  database.close();
});

test("Remis-End-to-End-Analyse schaltet Pokalspiele auf Cross-League um", async () => {
  const target = new Date("2026-07-29T10:00:00.000Z");
  const timestamp = Date.parse("2026-07-29T18:00:00.000Z") / 1000;
  const upcoming = fixture({
    id: 999,
    timestamp,
    homeId: 1,
    awayId: 2,
    leagueId: 3,
    leagueName: "UEFA Europa League",
    country: "World"
  });
  const homeDomestic = history(timestamp)
    .filter((match) => match.teams.home.id === 1 || match.teams.away.id === 1)
    .map((match) => ({
      ...match,
      league: { ...match.league, id: 78, name: "Bundesliga", country: "Germany" }
    }));
  const awayDomestic = history(timestamp)
    .filter((match) => match.teams.home.id === 2 || match.teams.away.id === 2)
    .map((match) => ({
      ...match,
      league: { ...match.league, id: 207, name: "Super League", country: "Switzerland" }
    }));
  const leagues: ApiLeague[] = [{
    league: { id: 3, name: "UEFA Europa League", type: "Cup" },
    country: { name: "World" },
    seasons: [{ year: 2026, start: "2026-07-01", end: "2027-05-31", current: true }]
  }, {
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{ year: 2026, start: "2026-01-01", end: "2026-12-31", current: true }]
  }, {
    league: { id: 207, name: "Super League", type: "League" },
    country: { name: "Switzerland" },
    seasons: [{ year: 2026, start: "2026-01-01", end: "2026-12-31", current: true }]
  }];
  let strengthCatalogCalls = 0;
  let selectedCompetitionCalls = 0;
  const fake = {
    requestCount: 0,
    requestsRemaining: 7_500,
    getLeagues: async () => leagues,
    getAllLeagues: async () => {
      strengthCatalogCalls += 1;
      return leagues;
    },
    getFixturesForDate: async (date: string): Promise<ApiFixture[]> =>
      date === "2026-07-29" ? [upcoming] : [],
    getSeasonFixtures: async (leagueId: number) => {
      if (leagueId === 3) selectedCompetitionCalls += 1;
      return leagueId === 78
        ? homeDomestic
        : leagueId === 207
          ? awayDomestic
          : [];
    },
    getTeamRecentFixtures: async (teamId: number) =>
      teamId === 1 ? homeDomestic : awayDomestic,
    getHeadToHead: async () => [],
    getFixtureOdds: async () => []
  } as unknown as ApiFootballClient;
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-on-demand-strength-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const result = await runDrawCriteriaAnalysis({
    selections: [{ country: "World", league: "UEFA Europa League" }],
    markets: ["draw"],
    dates: "both"
  }, { client: fake, database, now: target });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.model, "cross-league");
  assert.equal(strengthCatalogCalls, 1);
  assert.equal(selectedCompetitionCalls, 1);
  database.close();
});

test("1X2-End-to-End-Analyse gibt Tipp und Favoritenquote zurück", async () => {
  const target = new Date("2026-07-29T10:00:00.000Z");
  const timestamp = Date.parse("2026-07-29T18:00:00.000Z") / 1000;
  const upcoming = fixture({ id: 999, timestamp, homeId: 1, awayId: 2 });
  const past = history(timestamp);
  const leagues: ApiLeague[] = [{
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{
      year: 2026,
      start: "2026-01-01",
      end: "2026-12-31",
      current: true,
      coverage: { standings: true }
    }]
  }];
  const fake = {
    requestCount: 0,
    requestsRemaining: 7_500,
    getLeagues: async () => leagues,
    getFixturesForDate: async (date: string): Promise<ApiFixture[]> =>
      date === "2026-07-29" ? [upcoming] : [],
    getSeasonFixtures: async () => past,
    getTeamRecentFixtures: async (teamId: number) =>
      past.filter((match) =>
        match.teams.home.id === teamId || match.teams.away.id === teamId
      ).slice(0, 5),
    getHeadToHead: async () => [],
    getFixtureOdds: async () => [{
      fixture: { id: 999 },
      bookmakers: [{
        id: 1,
        name: "Test",
        bets: [{
          id: 1,
          name: "Match Winner",
          values: [
            { value: "Home", odd: "1.80" },
            { value: "Draw", odd: "3.40" },
            { value: "Away", odd: "4.50" }
          ]
        }]
      }]
    }]
  } as unknown as ApiFootballClient;
  const result = await runFavoriteAnalysis({
    selections: [{ country: "Deutschland", league: "Bundesliga" }],
    markets: ["1x2"],
    dates: "both"
  }, { client: fake, now: target });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.selection, "1");
  assert.equal(result.rows[0]?.odds, 1.8);
  assert.equal(result.rows[0]?.model, "league");
});

test("1X2-End-to-End-Analyse schaltet Pokalspiele auf Cross-League um", async () => {
  const target = new Date("2026-07-29T10:00:00.000Z");
  const timestamp = Date.parse("2026-07-29T18:00:00.000Z") / 1000;
  const upcoming = fixture({
    id: 999,
    timestamp,
    homeId: 1,
    awayId: 2,
    leagueId: 3,
    leagueName: "UEFA Europa League",
    country: "World"
  });
  const homeDomestic = history(timestamp)
    .filter((match) => match.teams.home.id === 1 || match.teams.away.id === 1)
    .map((match) => ({
      ...match,
      league: { ...match.league, id: 78, name: "Bundesliga", country: "Germany" }
    }));
  const awayDomestic = history(timestamp)
    .filter((match) => match.teams.home.id === 2 || match.teams.away.id === 2)
    .map((match) => ({
      ...match,
      league: { ...match.league, id: 207, name: "Super League", country: "Switzerland" }
    }));
  const leagues: ApiLeague[] = [{
    league: { id: 3, name: "UEFA Europa League", type: "Cup" },
    country: { name: "World" },
    seasons: [{
      year: 2026,
      start: "2026-07-01",
      end: "2027-05-31",
      current: true,
      coverage: { standings: false }
    }]
  }, {
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{ year: 2026, start: "2026-01-01", end: "2026-12-31", current: true }]
  }, {
    league: { id: 207, name: "Super League", type: "League" },
    country: { name: "Switzerland" },
    seasons: [{ year: 2026, start: "2026-01-01", end: "2026-12-31", current: true }]
  }];
  const seasonCalls: number[] = [];
  let headToHeadCalls = 0;
  const fake = {
    requestCount: 0,
    requestsRemaining: 7_500,
    getLeagues: async () => leagues,
    getFixturesForDate: async (date: string): Promise<ApiFixture[]> =>
      date === "2026-07-29" ? [upcoming] : [],
    getSeasonFixtures: async (leagueId: number) => {
      seasonCalls.push(leagueId);
      if (leagueId === 78) return homeDomestic;
      if (leagueId === 207) return awayDomestic;
      return [];
    },
    getTeamRecentFixtures: async (teamId: number) =>
      teamId === 1 ? homeDomestic : awayDomestic,
    getHeadToHead: async () => {
      headToHeadCalls += 1;
      return [];
    },
    getFixtureOdds: async () => []
  } as unknown as ApiFootballClient;
  const result = await runFavoriteAnalysis({
    selections: [{ country: "World", league: "UEFA Europa League" }],
    markets: ["1x2"],
    dates: "both"
  }, { client: fake, now: target });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.model, "cross-league");
  assert.ok(seasonCalls.includes(78));
  assert.ok(seasonCalls.includes(207));
  assert.ok(!seasonCalls.includes(3));
  assert.equal(headToHeadCalls, 1);
});
