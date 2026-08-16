import assert from "node:assert/strict";
import test from "node:test";
import type { ApiFootballClient } from "../src/api.ts";
import type { AnalyzerDatabase } from "../src/database.ts";
import { runVenueFormFilter, venueFormStats } from "../src/venue-form.ts";
import { fixture } from "./helpers.ts";

const kickoff = Date.parse("2026-01-02T12:00:00.000Z") / 1000;

function homeHistory(): ReturnType<typeof fixture>[] {
  return Array.from({ length: 10 }, (_, index) => fixture({
    id: 100 + index,
    timestamp: kickoff - (index + 1) * 86_400,
    homeId: 1,
    awayId: 20 + index,
    homeGoals: index < 7 ? 2 : index < 9 ? 1 : 0,
    awayGoals: index < 7 ? 0 : index < 9 ? 1 : 2
  }));
}

function awayHistory(): ReturnType<typeof fixture>[] {
  return Array.from({ length: 10 }, (_, index) => fixture({
    id: 200 + index,
    timestamp: kickoff - (index + 1) * 86_400,
    homeId: 30 + index,
    awayId: 2,
    homeGoals: index < 6 ? 2 : index < 9 ? 1 : 0,
    awayGoals: index < 6 ? 0 : index < 9 ? 1 : 2
  }));
}

test("berechnet die venue-spezifische Zehnerform als Punktausbeute", () => {
  assert.deepEqual(venueFormStats(homeHistory(), 1, "home", kickoff), {
    matches: 10,
    points: 23,
    percentage: 23 / 30 * 100,
    wins: 7,
    draws: 2,
    losses: 1
  });
});

test("filtert den letzten 1X2-Snapshot lokal mit 70/50 und Mindestquote", async () => {
  const upcoming = fixture({
    id: 1,
    timestamp: kickoff,
    homeId: 1,
    awayId: 2
  });
  const database = {
    latestProfileSnapshot: () => ({
      createdAt: "2026-01-01T10:00:00.000Z",
      dates: ["2026-01-02"],
      rows: [{
        fixtureId: 1,
        kickoff: upcoming.fixture.date,
        homeTeam: "Heim",
        awayTeam: "Auswärts",
        oddsHome: 1.5,
        oddsAway: 6
      }]
    })
  } as unknown as AnalyzerDatabase;
  const client = {
    requestCount: 0,
    requestsRemaining: null,
    getFixturesForDate: async () => [upcoming],
    getTeamRecentFixtures: async (teamId: number) =>
      teamId === 1 ? homeHistory() : awayHistory()
  } as unknown as ApiFootballClient;

  const result = await runVenueFormFilter({}, { client, database });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.selection, "1");
  assert.equal(result.rows[0]!.odds, 1.5);
});
