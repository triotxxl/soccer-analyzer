import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AnalyzerDatabase } from "../src/database.ts";
import type {
  Candidate,
  DrawScoreRow,
  FavoriteScoreRow,
  GoalLineRow
} from "../src/types.ts";
import { fixture } from "./helpers.ts";

test("migriert eine bestehende 1.3-Datenbank auf die versionierten Profile", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-migration-db-"));
  const filename = path.join(directory, "test.sqlite");
  const legacy = new DatabaseSync(filename);
  legacy.exec(`
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      model_version TEXT NOT NULL,
      dates_json TEXT NOT NULL,
      markets_json TEXT NOT NULL,
      fixture_count INTEGER NOT NULL
    );
    CREATE TABLE candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      fixture_id INTEGER NOT NULL,
      kickoff TEXT NOT NULL,
      country TEXT NOT NULL,
      league TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      market TEXT NOT NULL,
      selection TEXT NOT NULL,
      probability REAL NOT NULL,
      quality INTEGER NOT NULL,
      expected_home_goals REAL NOT NULL,
      expected_away_goals REAL NOT NULL,
      reasons_json TEXT NOT NULL,
      cautions_json TEXT NOT NULL,
      settled_at TEXT,
      actual_home_goals INTEGER,
      actual_away_goals INTEGER,
      hit INTEGER,
      brier REAL,
      UNIQUE(run_id, fixture_id, market)
    );
  `);
  legacy.close();
  const database = new AnalyzerDatabase(filename);
  assert.equal(database.profilePredictionCount(), 0);
  database.close();
  const migrated = new DatabaseSync(filename);
  const candidateColumns = migrated.prepare(
    "PRAGMA table_info(candidates)"
  ).all() as Array<{ name: string }>;
  const profileTable = migrated.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'profile_predictions'
  `).get() as { name: string } | undefined;
  const profileColumns = migrated.prepare(
    "PRAGMA table_info(profile_predictions)"
  ).all() as Array<{ name: string }>;
  const scopeTable = migrated.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'profile_prediction_scopes'
  `).get() as { name: string } | undefined;
  const goalLineTable = migrated.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'goal_line_predictions'
  `).get() as { name: string } | undefined;
  migrated.close();
  assert.ok(candidateColumns.some((column) => column.name === "tipico_odds"));
  assert.equal(profileTable?.name, "profile_predictions");
  assert.ok(profileColumns.some((column) => column.name === "odds_home"));
  assert.ok(profileColumns.some((column) => column.name === "market_draw"));
  assert.equal(scopeTable?.name, "profile_prediction_scopes");
  assert.equal(goalLineTable?.name, "goal_line_predictions");
});

test("migriert eine bestehende Torlinien-Tabelle um Halbzeitfelder", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-halftime-migration-"));
  const filename = path.join(directory, "test.sqlite");
  const legacy = new DatabaseSync(filename);
  legacy.exec(`
    CREATE TABLE goal_line_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kickoff TEXT NOT NULL,
      settled_at TEXT,
      home_probability REAL,
      draw_probability REAL,
      away_probability REAL,
      btts_probability REAL
    );
  `);
  legacy.close();
  const database = new AnalyzerDatabase(filename);
  database.close();
  const migrated = new DatabaseSync(filename);
  const columns = migrated.prepare("PRAGMA table_info(goal_line_predictions)").all() as Array<{ name: string }>;
  migrated.close();
  for (const name of [
    "first_half_expected_home_goals", "first_half_data_confidence",
    "first_half_over05", "first_half_under15",
    "actual_halftime_home_goals", "actual_halftime_away_goals"
  ]) {
    assert.ok(columns.some((column) => column.name === name), `Fehlende migrierte Spalte ${name}`);
  }
});

test("speichert, aktualisiert und rechnet Gesamtspiel- und Halbzeit-Torlinien ab", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-goal-lines-db-"));
  const filename = path.join(directory, "test.sqlite");
  const database = new AnalyzerDatabase(filename);
  const row: GoalLineRow = {
    fixtureId: 701,
    kickoff: "2026-01-01T18:00:00.000Z",
    country: "Germany",
    league: "Bundesliga",
    homeTeam: "A",
    awayTeam: "B",
    modelVersion: "2.0.0",
    expectedHomeGoals: 1.5,
    expectedAwayGoals: 1.0,
    expectedTotalGoals: 2.5,
    dataConfidence: 80,
    outcomeProbabilities: {
      home: 0.5,
      draw: 0.27,
      away: 0.23,
      btts: 0.58
    },
    probabilities: {
      over15: 0.7, under15: 0.3,
      over25: 0.5, under25: 0.5,
      over35: 0.3, under35: 0.7
    },
    firstHalf: {
      expectedHomeGoals: 0.7, expectedAwayGoals: 0.4, expectedTotalGoals: 1.1,
      dataConfidence: 78,
      probabilities: { over05: 0.67, under05: 0.33, over15: 0.3, under15: 0.7 },
      warnings: []
    },
    defense: {
      home: { concededGoals: 0.6, relativeToLeague: 0.5, matches: 18, venueMatches: 9,
        strong: true, source: "xg", badge: "verified", expectedGoalsAgainst: 0.7 },
      away: { concededGoals: 1.2, relativeToLeague: 1, matches: 18, venueMatches: 9,
        strong: false, source: "goals", badge: null }
    },
    warnings: []
  };
  const scope = {
    dates: ["2026-01-01"],
    selections: [{ country: "Deutschland", league: "Bundesliga" }],
    matches: [{ homeTeam: "A", awayTeam: "B" }]
  };
  database.saveGoalLinePredictions("2025-12-31T10:00:00.000Z", [row], scope);
  database.saveGoalLinePredictions(
    "2025-12-31T11:00:00.000Z",
    [{ ...row, expectedTotalGoals: 2.6 }],
    scope
  );
  assert.equal(database.goalLinePredictionCount(), 1);
  assert.deepEqual(database.unsettledFixtures(new Date("2026-01-02")), [701]);
  assert.equal(database.settleFixture(fixture({
    id: 701,
    timestamp: Date.parse(row.kickoff) / 1000,
    homeId: 1,
    awayId: 2,
    homeGoals: 2,
    awayGoals: 1,
    halfTimeHomeGoals: 1,
    halfTimeAwayGoals: 0
  }), { home: 1.4, away: 0.8 }), 1);
  database.saveGoalLinePredictions(
    "2025-12-31T12:00:00.000Z",
    [{ ...row, expectedTotalGoals: 9 }],
    scope
  );
  const reader = new DatabaseSync(filename);
  const stored = reader.prepare(`
    SELECT expected_total_goals, actual_home_xg, actual_away_xg FROM goal_line_predictions WHERE fixture_id = 701
  `).get() as { expected_total_goals: number; actual_home_xg: number; actual_away_xg: number };
  reader.close();
  assert.equal(stored.expected_total_goals, 2.6);
  assert.deepEqual([stored.actual_home_xg, stored.actual_away_xg], [1.4, 0.8]);
  assert.deepEqual(database.defenseBadgeReport().map((item) => item.cohort), ["verified", "unmarked"]);
  const report = database.goalLineReport();
  assert.equal(report.length, 10);
  assert.deepEqual(report.map((item) => item.hits), [1, 0, 1, 0, 0, 1, 1, 0, 0, 1]);
  assert.deepEqual(report.slice(6).map((item) => item.period), ["first-half", "first-half", "first-half", "first-half"]);
  assert.ok(report.every((item) => item.total === 1));
  assert.ok(report.every((item) => item.intervalHigh <= 1));
  database.close();
});

test("speichert vollständige Marktquoten, normalisierte Verteilung und Analyseumfang", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-odds-scope-db-"));
  const filename = path.join(directory, "test.sqlite");
  const database = new AnalyzerDatabase(filename);
  const row: FavoriteScoreRow = {
    fixtureId: 301,
    kickoff: "2026-01-01T12:00:00.000Z",
    country: "Germany",
    league: "Bundesliga",
    homeTeam: "A",
    awayTeam: "B",
    selection: "1",
    selectedTeam: "A",
    odds: 2,
    score: 70,
    confidence: 80,
    modelVersion: "1.3.0",
    marketScore: 60,
    sportsScore: 75,
    availableMaximum: 100,
    warnings: [],
    model: "league",
    rating: "stark",
    breakdown: {
      market: 10, table: 10, seasonStrength: 10, form: 10,
      goalDominance: 10, venueAdvantage: 5, headToHead: 5,
      dataQuality: 10, deductions: 0
    }
  };
  database.saveProfilePredictions(
    "2025-12-31T10:00:00.000Z",
    "1x2",
    [row],
    {
      dates: ["2026-01-01"],
      selections: [{ country: "Deutschland", league: "Bundesliga" }],
      matches: [{ homeTeam: "A", awayTeam: "B" }],
      oddsByFixture: new Map([[301, { home: 2, draw: 4, away: 4 }]])
    }
  );
  database.close();
  const reader = new DatabaseSync(filename);
  const stored = reader.prepare(`
    SELECT odds_home, odds_draw, odds_away, market_home, market_draw, market_away
    FROM profile_predictions WHERE fixture_id = 301
  `).get() as Record<string, number>;
  const scope = reader.prepare(`
    SELECT r.dates_json, r.selections_json, r.matches_json
    FROM profile_analysis_runs r
    JOIN profile_prediction_scopes s ON s.run_id = r.id
  `).get() as Record<string, string>;
  reader.close();
  assert.deepEqual(
    [stored.odds_home, stored.odds_draw, stored.odds_away],
    [2, 4, 4]
  );
  assert.deepEqual(
    [stored.market_home, stored.market_draw, stored.market_away],
    [0.5, 0.25, 0.25]
  );
  assert.deepEqual(JSON.parse(scope.matches_json), [{ homeTeam: "A", awayTeam: "B" }]);
});

test("berichtet Marktbaseline und Top-5/7/10/16 nur für ausgewählte Spiele ab Quote 1,40", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-ranking-db-"));
  const filename = path.join(directory, "test.sqlite");
  const database = new AnalyzerDatabase(filename);
  const rows: FavoriteScoreRow[] = Array.from({ length: 12 }, (_, index) => ({
    fixtureId: 500 + index,
    kickoff: `2026-01-01T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
    country: "Germany",
    league: "Bundesliga",
    homeTeam: `A${index}`,
    awayTeam: `B${index}`,
    selection: "1",
    selectedTeam: `A${index}`,
    odds: index === 11 ? 1.3 : 1.5,
    score: 100 - index,
    confidence: 80,
    modelVersion: "1.3.0",
    marketScore: 60,
    sportsScore: 75,
    availableMaximum: 100,
    warnings: [],
    model: "league",
    rating: "stark",
    breakdown: {
      market: 10, table: 10, seasonStrength: 10, form: 10,
      goalDominance: 10, venueAdvantage: 5, headToHead: 5,
      dataQuality: 10, deductions: 0
    }
  }));
  database.saveProfilePredictions(
    "2025-12-31T10:00:00.000Z",
    "1x2",
    rows,
    {
      dates: ["2026-01-01"], selections: [], matches: [],
      oddsByFixture: new Map(rows.map((row) => [
        row.fixtureId, { home: row.odds, draw: 3.5, away: 5 }
      ]))
    }
  );
  const scopeEditor = new DatabaseSync(filename);
  scopeEditor.prepare(`
    DELETE FROM profile_prediction_scopes
    WHERE prediction_id = (
      SELECT id FROM profile_predictions WHERE fixture_id = 510
    )
  `).run();
  scopeEditor.close();
  for (let index = 0; index < rows.length; index += 1) {
    database.settleFixture(fixture({
      id: 500 + index,
      timestamp: Date.parse(rows[index]!.kickoff) / 1000,
      homeId: 1,
      awayId: 2,
      homeGoals: index < 6 ? 2 : 0,
      awayGoals: index < 6 ? 0 : 1
    }));
  }
  const baseline = database.marketBaseline(1.4)[0]!;
  assert.equal(baseline.total, 10);
  assert.equal(baseline.hits, 6);
  assert.equal(baseline.coverage, 10 / 11);
  const topK = database.topKReport(1.4);
  assert.deepEqual(topK.map((row) => row.topK), [5, 7, 10, 16]);
  assert.deepEqual(topK.map((row) => row.total), [5, 7, 10, 10]);
  assert.equal(topK[0]?.hits, 5);
  assert.equal(topK[1]?.hits, 6);
  database.close();
});

test("speichert, rechnet ab und berichtet Kandidaten", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-db-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  const candidate: Candidate = {
    fixtureId: 99,
    kickoff: "2026-01-01T12:00:00.000Z",
    country: "Germany",
    league: "Bundesliga",
    homeTeam: "A",
    awayTeam: "B",
    market: "btts",
    selection: "Beide Teams treffen: Ja",
    probability: 0.65,
    quality: 80,
    expectedHomeGoals: 1.5,
    expectedAwayGoals: 1.2,
    reasons: ["Test"],
    cautions: []
  };
  database.saveRun({
    createdAt: "2025-12-31T10:00:00.000Z",
    dates: ["2026-01-01"],
    markets: ["btts"],
    resolvedLeagues: [],
    fixtureCount: 1,
    candidates: [candidate],
    apiRequests: 0,
    apiRequestsRemaining: null
  }, [candidate]);
  assert.deepEqual(database.unsettledFixtures(new Date("2026-01-02")), [99]);
  const result = fixture({
    id: 99,
    timestamp: Date.parse("2026-01-01T12:00:00.000Z") / 1000,
    homeId: 1,
    awayId: 2,
    homeGoals: 2,
    awayGoals: 1
  });
  assert.equal(database.settleFixture(result), 1);
  const report = database.report();
  assert.equal(report[0]?.hits, 1);
  assert.equal(report[0]?.brierScore, (0.65 - 1) ** 2);
  database.close();
});

test("speichert und berichtet aktive Profilprognosen ohne Duplikate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-profile-db-"));
  const filename = path.join(directory, "test.sqlite");
  const database = new AnalyzerDatabase(filename);
  const row = (modelVersion: string, score: number): DrawScoreRow => ({
    fixtureId: 199,
    kickoff: "2026-01-01T12:00:00.000Z",
    country: "Germany",
    league: "Bundesliga",
    homeTeam: "A",
    awayTeam: "B",
    odds: 3.2,
    score,
    confidence: 80,
    modelVersion,
    marketScore: 70,
    sportsScore: 75,
    availableMaximum: 100,
    warnings: [],
    model: "league",
    rating: score >= 60 ? "interessant" : "nicht empfehlen",
    breakdown: {
      table: 10,
      stability: 10,
      form: 10,
      goalLevel: 10,
      headToHead: 0,
      market: 10,
      venueBalance: 5,
      deductions: 0
    }
  });
  const active = row("1.3.0", 61);
  database.saveProfilePredictions(
    "2025-12-31T10:00:00.000Z",
    "draw",
    [active]
  );
  database.saveProfilePredictions(
    "2025-12-31T09:00:00.000Z",
    "draw",
    [{ ...active, score: 99 }]
  );
  database.saveProfilePredictions(
    "2025-12-31T11:00:00.000Z",
    "draw",
    [{ ...active, score: 66 }]
  );
  assert.equal(database.profilePredictionCount(), 1);
  const reader = new DatabaseSync(filename);
  const stored = reader.prepare(`
    SELECT snapshot_at, score
    FROM profile_predictions
    WHERE model_version = '1.3.0'
  `).get() as { snapshot_at: string; score: number };
  reader.close();
  assert.equal(stored.snapshot_at, "2025-12-31T11:00:00.000Z");
  assert.equal(stored.score, 66);
  assert.deepEqual(database.unsettledFixtures(new Date("2026-01-02")), [199]);
  const result = fixture({
    id: 199,
    timestamp: Date.parse(active.kickoff) / 1000,
    homeId: 1,
    awayId: 2,
    homeGoals: 1,
    awayGoals: 1
  });
  assert.equal(database.settleFixture(result), 1);
  const report = database.profileReport();
  assert.equal(report.length, 1);
  assert.ok(report.every((item) => item.hitRate === 1));
  assert.ok(report.every((item) => item.intervalHigh <= 1));
  assert.deepEqual(
    report.map((item) => item.band).sort(),
    ["60–69"]
  );
  database.close();
});
