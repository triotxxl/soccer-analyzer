import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ApiFootballClient } from "../src/api.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import type { ApiTeamStatistics } from "../src/types.ts";
import { enrichFixtureExpectedGoals, parseExpectedGoals } from "../src/xg.ts";
import { fixture } from "./helpers.ts";

function statistics(home: number | null, away: number | null): ApiTeamStatistics[] {
  return [
    { team: { id: 1, name: "Home" }, statistics: [{ type: "Expected Goals", value: home }] },
    { team: { id: 2, name: "Away" }, statistics: [{ type: "expected_goals", value: away }] }
  ];
}

test("liest Expected Goals unabhängig von der API-Schreibweise und bewahrt Nullwerte", () => {
  assert.deepEqual(parseExpectedGoals(statistics(1.25, 0.7), 1, 2), { home: 1.25, away: 0.7 });
  assert.deepEqual(parseExpectedGoals(statistics(null, 0), 1, 2), { home: null, away: 0 });
});

test("xG-Erstaufbau nutzt 20er-Batches, Fallback und Requestbudget", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-xg-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const now = new Date("2026-08-17T12:00:00Z");
  const games = Array.from({ length: 21 }, (_, index) => fixture({
    id: 1000 + index, timestamp: Math.floor(now.getTime() / 1000) - (index + 1) * 3600,
    homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0
  }));
  const batches: number[][] = [];
  let fallback = 0;
  const client = {
    getFixturesWithStatistics: async (ids: number[]) => {
      batches.push(ids);
      return ids.map((id) => ({ ...games.find((game) => game.fixture.id === id)!, statistics: statistics(1.1, 0.6) }));
    },
    getFixtureStatistics: async () => { fallback += 1; return []; }
  } as unknown as ApiFootballClient;
  const result = await enrichFixtureExpectedGoals(games, client, database, { maxRequests: 2, now });
  assert.deepEqual(batches.map((batch) => batch.length), [20, 1]);
  assert.equal(fallback, 0);
  assert.equal(result.values.size, 21);
  assert.equal(result.requests, 2);
  const second = await enrichFixtureExpectedGoals(games, client, database, { maxRequests: 2, now });
  assert.equal(second.requests, 0);
  assert.equal(batches.length, 2);
  database.close();
});

test("fehlende eingebettete xG werden gezielt abgefragt und negativ gecacht", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-xg-null-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const now = new Date("2026-08-17T12:00:00Z");
  const game = fixture({ id: 77, timestamp: Math.floor(now.getTime() / 1000) - 3600, homeId: 1, awayId: 2, homeGoals: 0, awayGoals: 0 });
  let detailCalls = 0;
  const client = {
    getFixturesWithStatistics: async () => [game],
    getFixtureStatistics: async () => { detailCalls += 1; return statistics(null, null); }
  } as unknown as ApiFootballClient;
  const first = await enrichFixtureExpectedGoals([game], client, database, { maxRequests: 2, now });
  assert.equal(first.values.get(77)?.status, "unavailable");
  assert.equal(detailCalls, 1);
  await enrichFixtureExpectedGoals([game], client, database, { maxRequests: 2, now: new Date(now.getTime() + 3600_000) });
  assert.equal(detailCalls, 1);
  database.close();
});
