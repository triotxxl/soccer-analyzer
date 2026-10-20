import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ApiFootballClient } from "../src/api.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import { settleFixtures, settlementDeferral } from "../src/settle.ts";
import type { GoalLineRow } from "../src/types.ts";
import { event, fixture, teamStatistics } from "./helpers.ts";

function goalLineRow(fixtureId: number, kickoff: string): GoalLineRow {
  return {
    fixtureId, kickoff, country: "Deutschland", league: "Bundesliga",
    homeTeam: `Heim ${fixtureId}`, awayTeam: `Gast ${fixtureId}`, modelVersion: "goals-test",
    expectedHomeGoals: 1.4, expectedAwayGoals: 1.1, expectedTotalGoals: 2.5, dataConfidence: 80,
    outcomeProbabilities: { home: 0.45, draw: 0.27, away: 0.28, btts: 0.6 },
    probabilities: { over15: 0.8, under15: 0.2, over25: 0.6, under25: 0.4, over35: 0.35, under35: 0.65 },
    firstHalf: {
      expectedHomeGoals: 0.6, expectedAwayGoals: 0.5, expectedTotalGoals: 1.1, dataConfidence: 80,
      probabilities: { over05: 0.7, under05: 0.3, over15: 0.4, under15: 0.6 }, warnings: []
    },
    warnings: []
  };
}

async function databaseWithDueFixtures(kickoffs: Array<[number, string]>): Promise<AnalyzerDatabase> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-settle-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const scope = {
    dates: ["2026-01-01"],
    selections: [{ country: "Deutschland", league: "Bundesliga" }],
    matches: kickoffs.map(([id]) => ({ homeTeam: `Heim ${id}`, awayTeam: `Gast ${id}` }))
  };
  database.saveGoalLinePredictions(
    "2025-12-31T10:00:00.000Z",
    kickoffs.map(([id, kickoff]) => goalLineRow(id, kickoff)),
    scope
  );
  return database;
}

function clientFor(seen: number[], finished = true): ApiFootballClient {
  return {
    requestCount: 0,
    getFixture: async function (this: { requestCount: number }, id: number) {
      this.requestCount += 1;
      seen.push(id);
      return [fixture({
        id, timestamp: 1_767_222_000, homeId: 1, awayId: 2,
        ...(finished ? { homeGoals: 2, awayGoals: 1 } : { status: "NS" })
      })];
    },
    getFixtureStatistics: async function (this: { requestCount: number }) {
      this.requestCount += 1;
      return [];
    }
  } as unknown as ApiFootballClient;
}

test("Abrechnung nimmt die neuesten fälligen Partien zuerst", async () => {
  const database = await databaseWithDueFixtures([
    [801, "2026-01-01T12:00:00.000Z"],
    [802, "2026-01-01T18:00:00.000Z"],
    [803, "2026-01-01T15:00:00.000Z"]
  ]);
  const seen: number[] = [];
  const result = await settleFixtures({
    client: clientFor(seen), database, now: new Date("2026-01-02T00:00:00.000Z")
  });
  assert.deepEqual(seen, [802, 803, 801]);
  assert.equal(result.due, 3);
  assert.equal(result.checked, 3);
  assert.equal(result.settled, 3);
  assert.equal(result.apiRequests, 6);
  assert.equal(result.budgetReached, false);
  database.close();
});

test("Das Requestbudget bricht ab und lässt den Rest offen", async () => {
  const database = await databaseWithDueFixtures([
    [901, "2026-01-01T12:00:00.000Z"],
    [902, "2026-01-01T18:00:00.000Z"],
    [903, "2026-01-01T15:00:00.000Z"]
  ]);
  const seen: number[] = [];
  const result = await settleFixtures({
    client: clientFor(seen), database, requestBudget: 5, now: new Date("2026-01-02T00:00:00.000Z")
  });
  // Zwei Partien passen in fünf Aufrufe, die dritte würde das Budget sprengen und wird
  // gar nicht erst angefangen.
  assert.deepEqual(seen, [902, 903]);
  assert.equal(result.checked, 2);
  assert.equal(result.apiRequests, 4);
  assert.equal(result.budgetReached, true);
  assert.equal(result.due - result.checked, 1);
  database.close();
});

test("Noch nicht beendete Partien kosten nur einen Aufruf und bleiben offen", async () => {
  const database = await databaseWithDueFixtures([[1001, "2026-01-01T12:00:00.000Z"]]);
  const seen: number[] = [];
  const result = await settleFixtures({
    client: clientFor(seen, false), database, now: new Date("2026-01-02T00:00:00.000Z")
  });
  assert.equal(result.checked, 1);
  assert.equal(result.settled, 0);
  assert.equal(result.apiRequests, 1);
  assert.deepEqual(database.unsettledFixtures(new Date("2026-01-02T00:00:00.000Z")), [1001]);
  database.close();
});

test("die Abrechnung speichert die Ergebnisdaten, ohne mehr Aufrufe zu brauchen", async () => {
  const database = await databaseWithDueFixtures([[1101, "2026-01-01T12:00:00.000Z"]]);
  const seen: number[] = [];
  let halfRequested = false;
  const client = {
    requestCount: 0,
    getFixture: async function (this: { requestCount: number }, id: number) {
      this.requestCount += 1;
      seen.push(id);
      return [fixture({
        id, timestamp: 1_767_222_000, homeId: 1, awayId: 2,
        homeGoals: 2, awayGoals: 1, halfTimeHomeGoals: 1, halfTimeAwayGoals: 1,
        events: [
          event({ type: "Goal", minute: 20, teamId: 1 }),
          event({ type: "Goal", minute: 44, teamId: 2 }),
          event({ type: "Goal", minute: 75, teamId: 1 }),
          event({ type: "Card", minute: 80, teamId: 2, detail: "Yellow Card" })
        ],
        lineups: [{ team: { id: 1, name: "Team 1" }, formation: "4-2-3-1" }]
      })];
    },
    getFixtureStatistics: async function (
      this: { requestCount: number }, _id: number, _fresh: boolean, half = false
    ) {
      this.requestCount += 1;
      halfRequested = half;
      return [teamStatistics({
        teamId: 1,
        full: { "Ball Possession": "55%", "Shots on Goal": 6 },
        firstHalf: { "Ball Possession": "60%", "Shots on Goal": 4 },
        secondHalf: { "Ball Possession": "50%", "Shots on Goal": 2 }
      })];
    }
  } as unknown as ApiFootballClient;

  const result = await settleFixtures({
    client, database, now: new Date("2026-01-02T00:00:00.000Z")
  });

  // Der Kern: Halbzeitzahlen kosten nichts extra, es bleibt bei zwei Aufrufen je Partie.
  assert.equal(result.apiRequests, 2);
  assert.equal(halfRequested, true, "die Statistik wird mit Halbzeiten geholt");
  assert.equal(result.results, 1);
  assert.equal(result.halfStatistics, 1);

  const row = database.fixtureResult(1101);
  assert.ok(row);
  assert.equal(row.goals_ht1_home, 1);
  assert.equal(row.goals_ht2_home, 1);
  assert.equal(row.goals_ht1_away, 1);
  assert.equal(row.yellow_ht2_away, 1);
  assert.equal(row.goals_complete, 1);
  assert.equal(row.home_formation, "4-2-3-1");
  assert.equal(row.home_possession_ht1, 60);
  assert.equal(row.home_possession_ht2, 50);
  assert.equal(row.half_stats_status, "available");
  assert.equal(row.source, "api");
  database.close();
});

test("Wiedervorlage: verlegt bis nach dem neuen Termin, verschoben drei Tage, gewertet nie wieder", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const at = (iso: string, status: string) => fixture({ id: 1, timestamp: Date.parse(iso) / 1000, homeId: 1, awayId: 2, status });
  // Levante - Athletic: vom 16.09. auf den 21.10. verlegt, steht wieder auf NS.
  assert.deepEqual(settlementDeferral(at("2026-10-21T18:00:00.000Z", "NS"), now), { status: "NS", nextCheck: "2026-10-21T19:50:00.000Z" });
  assert.deepEqual(settlementDeferral(at("2026-10-15T18:00:00.000Z", "PST"), now), { status: "PST", nextCheck: "2026-10-23T12:00:00.000Z" });
  assert.deepEqual(settlementDeferral(at("2026-10-10T10:00:00.000Z", "ABD"), now), { status: "ABD", nextCheck: "2026-10-23T12:00:00.000Z" });
  // Persiku - PSIS am grünen Tisch gewertet: Es gibt kein gespieltes Ergebnis.
  assert.deepEqual(settlementDeferral(at("2026-09-27T08:30:00.000Z", "AWD"), now), { status: "AWD", nextCheck: null });
  assert.deepEqual(settlementDeferral(undefined, now), { status: "MISSING", nextCheck: "2026-10-27T12:00:00.000Z" });
  // NS mit vorbeigegangenem Termin: Der Status der API hängt nur hinterher - beim nächsten Mal wieder.
  assert.equal(settlementDeferral(at("2026-10-19T18:00:00.000Z", "NS"), now), null);
  assert.equal(settlementDeferral(at("2026-10-20T10:30:00.000Z", "2H"), now), null);
});

test("Zurückgestellte Spiele fragt die Abrechnung erst zur Wiedervorlage wieder ab", async () => {
  const database = await databaseWithDueFixtures([[1101, "2026-01-01T12:00:00.000Z"], [1102, "2026-01-01T15:00:00.000Z"]]);
  const seen: number[] = [];
  const client = {
    requestCount: 0,
    getFixture: async function (this: { requestCount: number }, id: number) {
      this.requestCount += 1;
      seen.push(id);
      return [fixture({ id, timestamp: Date.parse(id === 1101 ? "2026-01-20T18:00:00.000Z" : "2026-01-01T15:00:00.000Z") / 1000, homeId: 1, awayId: 2, status: id === 1101 ? "NS" : "AWD" })];
    },
    getFixtureStatistics: async () => []
  } as unknown as ApiFootballClient;
  const first = await settleFixtures({ client, database, now: new Date("2026-01-02T00:00:00.000Z") });
  assert.equal(first.deferred, 2);
  assert.deepEqual(database.unsettledFixtures(new Date("2026-01-10T00:00:00.000Z")), []);
  // Nach dem neuen Termin ist das verlegte Spiel wieder fällig, das gewertete nie.
  assert.deepEqual(database.unsettledFixtures(new Date("2026-01-21T00:00:00.000Z")), [1101]);
  database.close();
});
