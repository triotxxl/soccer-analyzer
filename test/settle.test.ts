import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ApiFootballClient } from "../src/api.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import { settleFixtures } from "../src/settle.ts";
import type { GoalLineRow } from "../src/types.ts";
import { fixture } from "./helpers.ts";

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
