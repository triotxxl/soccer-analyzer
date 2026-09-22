import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AnalyzerDatabase } from "../src/database.ts";
import { toFixtureResult, type FixtureResult } from "../src/fixture-result.ts";
import { event, fixture, teamStatistics } from "./helpers.ts";

const HOME = 1;
const AWAY = 2;
const KICKOFF = 1_767_222_000;

async function emptyDatabase(): Promise<AnalyzerDatabase> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-results-"));
  return new AnalyzerDatabase(path.join(directory, "test.sqlite"));
}

function richResult(): FixtureResult {
  const result = toFixtureResult(fixture({
    id: 500, timestamp: KICKOFF, homeId: HOME, awayId: AWAY,
    homeGoals: 2, awayGoals: 1, halfTimeHomeGoals: 1, halfTimeAwayGoals: 1,
    events: [
      event({ type: "Goal", minute: 20, teamId: HOME }),
      event({ type: "Goal", minute: 40, teamId: AWAY }),
      event({ type: "Goal", minute: 70, teamId: HOME }),
      event({ type: "Card", minute: 30, teamId: AWAY, detail: "Yellow Card" })
    ],
    statistics: [teamStatistics({ teamId: HOME, full: { "Ball Possession": "60%", "Total Shots": 12 } })],
    lineups: [{ team: { id: HOME, name: "Team 1" }, formation: "4-4-2" }],
    players: [{ team: { id: HOME, name: "Team 1" }, players: [] }]
  }), { source: "cache", fetchedAt: "2026-09-22T10:00:00.000Z" });
  assert.ok(result);
  return result;
}

function poorResult(): FixtureResult {
  const result = toFixtureResult(fixture({
    id: 500, timestamp: KICKOFF, homeId: HOME, awayId: AWAY,
    homeGoals: 2, awayGoals: 1, halfTimeHomeGoals: 1, halfTimeAwayGoals: 1
  }), { source: "cache", fetchedAt: "2026-09-22T11:00:00.000Z" });
  assert.ok(result);
  return result;
}

test("eine Ergebniszeile wird geschrieben und unverändert zurückgelesen", async () => {
  const database = await emptyDatabase();
  try {
    database.saveFixtureResults([richResult()]);
    const row = database.fixtureResult(500);
    assert.ok(row);
    assert.equal(row.final_home_goals, 2);
    assert.equal(row.ht_home_goals, 1);
    assert.equal(row.sh_home_goals, 1);
    assert.equal(row.goals_ht1_home, 1);
    assert.equal(row.goals_ht2_home, 1);
    assert.equal(row.yellow_ht1_away, 1);
    assert.equal(row.goals_complete, 1);
    assert.equal(row.home_possession, 60);
    assert.equal(row.home_formation, "4-4-2");
    assert.equal(row.source, "cache");
    assert.equal(JSON.parse(String(row.goal_events_json)).length, 3);
  } finally {
    database.close();
  }
});

test("dieselbe Partie ergibt keine zweite Zeile", async () => {
  const database = await emptyDatabase();
  try {
    database.saveFixtureResults([richResult()]);
    database.saveFixtureResults([richResult()]);
    const rows = database.settledFixtureIds();
    assert.equal(rows.length, 0, "ohne Prognosen gibt es keine abgerechneten Partien");
    const row = database.fixtureResult(500);
    assert.ok(row);
  } finally {
    database.close();
  }
});

test("eine ärmere Kopie verdrängt die reichere nicht", async () => {
  // Der Nachtrag darf mehrfach laufen. Ohne diesen Schutz würde ein späterer Durchgang, der
  // nur die dünne Antwort findet, die vollständigere Zeile überschreiben.
  const database = await emptyDatabase();
  try {
    database.saveFixtureResults([richResult()]);
    database.saveFixtureResults([poorResult()]);
    const row = database.fixtureResult(500);
    assert.ok(row);
    assert.equal(row.events_available, 1);
    assert.equal(row.goals_ht1_home, 1);
    assert.equal(row.home_formation, "4-4-2");
    assert.equal(row.fetched_at, "2026-09-22T10:00:00.000Z");
  } finally {
    database.close();
  }
});

test("die Halbzeit-Statistik überlebt einen späteren Lauf aus dem Cache", async () => {
  // Der teuer erkaufte Nachtrag darf nicht verloren gehen, nur weil jemand den kostenlosen
  // Cache-Lauf wiederholt. Deshalb fasst saveFixtureResults diese Spalten gar nicht an.
  const database = await emptyDatabase();
  try {
    database.saveFixtureResults([richResult()]);
    database.saveHalfStatistics([{
      fixtureId: 500,
      status: "available",
      fetchedAt: "2026-09-22T12:00:00.000Z",
      home: {
        firstHalf: { possession: 71, shots: 8, shotsOnGoal: 4, shotsOffGoal: null,
          blockedShots: null, shotsInsideBox: null, shotsOutsideBox: null, corners: 1,
          fouls: null, offsides: null, yellowCards: null, redCards: null,
          goalkeeperSaves: null, totalPasses: null, passesAccurate: null },
        secondHalf: null
      }
    }]);

    database.saveFixtureResults([richResult()]);
    const row = database.fixtureResult(500);
    assert.ok(row);
    assert.equal(row.home_possession_ht1, 71);
    assert.equal(row.home_shots_on_goal_ht1, 4);
    assert.equal(row.half_stats_status, "available");
  } finally {
    database.close();
  }
});

test("offene Halbzeit-Statistik meldet nur Partien mit Statistik", async () => {
  const database = await emptyDatabase();
  try {
    database.saveFixtureResults([richResult()]);
    // Eine Partie ohne jede Statistik: Dort gibt es auch keine Halbzeitwerte zu holen.
    const ohne = toFixtureResult(fixture({
      id: 501, timestamp: KICKOFF, homeId: 3, awayId: 4, homeGoals: 0, awayGoals: 0
    }));
    assert.ok(ohne);
    database.saveFixtureResults([ohne]);

    assert.equal(database.countFixturesMissingHalfStatistics(), 1);
    const offen = database.fixturesMissingHalfStatistics(10);
    assert.deepEqual(offen, [{ fixtureId: 500, homeTeamId: HOME, awayTeamId: AWAY }]);

    database.saveHalfStatistics([{
      fixtureId: 500, status: "unavailable", fetchedAt: "2026-09-22T12:00:00.000Z"
    }]);
    // Auch ein "gibt es nicht" gilt als erledigt, sonst fragt der nächste Lauf erneut.
    assert.equal(database.countFixturesMissingHalfStatistics(), 0);
  } finally {
    database.close();
  }
});
