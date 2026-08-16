import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config, DB_FILE } from "./config.ts";
import type {
  AnalysisResult,
  ApiFixture,
  Candidate,
  DrawScoreRow,
  FavoriteScoreRow,
  GoalLineRow,
  LeagueStrengthSnapshot,
  LeagueSelection,
  LiveMatchSelection,
  Market
} from "./types.ts";
import type { MatchWinnerOdds } from "./draw-criteria.ts";

export interface PerformanceRow {
  market: Market;
  total: number;
  hits: number;
  hitRate: number;
  averageProbability: number;
  brierScore: number;
}

export interface ProfilePerformanceRow {
  modelVersion: string;
  profile: string;
  band: "<50" | "50–59" | "60–69" | "70–79" | "80–100";
  total: number;
  hits: number;
  hitRate: number;
  coverage: number;
  intervalLow: number;
  intervalHigh: number;
}

export interface MarketBaselineRow {
  modelVersion: string;
  minimumOdds: number;
  total: number;
  hits: number;
  hitRate: number;
  coverage: number;
  intervalLow: number;
  intervalHigh: number;
}

export interface TopKPerformanceRow {
  modelVersion: string;
  minimumOdds: number;
  topK: 5 | 7 | 10 | 16;
  total: number;
  hits: number;
  hitRate: number;
  coverage: number;
  intervalLow: number;
  intervalHigh: number;
}

export interface GoalLinePerformanceRow {
  modelVersion: string;
  line: "1.5" | "2.5" | "3.5";
  direction: "over" | "under";
  total: number;
  hits: number;
  hitRate: number;
  averageProbability: number;
  brierScore: number;
  intervalLow: number;
  intervalHigh: number;
}

export interface OutcomeProbabilityPerformanceRow {
  market: "1x2" | "draw" | "btts";
  total: number;
  hits: number;
  hitRate: number;
  averageProbability: number;
  brierScore: number;
  intervalLow: number;
  intervalHigh: number;
}

interface ProfileSaveScope {
  dates: string[];
  selections: LeagueSelection[];
  matches: LiveMatchSelection[];
  oddsByFixture: Map<number, MatchWinnerOdds>;
}

interface GoalLineSaveScope {
  dates: string[];
  selections: LeagueSelection[];
  matches: LiveMatchSelection[];
}

export interface StoredProfileSnapshot {
  createdAt: string;
  dates: string[];
  rows: Array<{
    fixtureId: number;
    kickoff: string;
    homeTeam: string;
    awayTeam: string;
    oddsHome: number | null;
    oddsAway: number | null;
  }>;
}

export class AnalyzerDatabase {
  private readonly db: DatabaseSync;

  constructor(filename = DB_FILE) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        model_version TEXT NOT NULL,
        dates_json TEXT NOT NULL,
        markets_json TEXT NOT NULL,
        fixture_count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candidates (
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
        tipico_odds REAL,
        settled_at TEXT,
        actual_home_goals INTEGER,
        actual_away_goals INTEGER,
        hit INTEGER,
        brier REAL,
        UNIQUE(run_id, fixture_id, market)
      );
      CREATE INDEX IF NOT EXISTS idx_candidates_unsettled
        ON candidates(settled_at, kickoff);
      CREATE INDEX IF NOT EXISTS idx_candidates_market
        ON candidates(market, settled_at);
      CREATE TABLE IF NOT EXISTS profile_predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_at TEXT NOT NULL,
        fixture_id INTEGER NOT NULL,
        kickoff TEXT NOT NULL,
        country TEXT NOT NULL,
        league TEXT NOT NULL,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        market TEXT NOT NULL,
        profile TEXT NOT NULL,
        model_version TEXT NOT NULL,
        selection TEXT NOT NULL,
        market_score INTEGER,
        sports_score INTEGER NOT NULL,
        score INTEGER NOT NULL,
        confidence INTEGER NOT NULL,
        rating TEXT NOT NULL,
        available_maximum INTEGER NOT NULL,
        api_odds REAL,
        odds_home REAL,
        odds_draw REAL,
        odds_away REAL,
        market_home REAL,
        market_draw REAL,
        market_away REAL,
        breakdown_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        settled_at TEXT,
        actual_home_goals INTEGER,
        actual_away_goals INTEGER,
        hit INTEGER,
        UNIQUE(fixture_id, market, profile, model_version)
      );
      CREATE INDEX IF NOT EXISTS idx_profile_predictions_unsettled
        ON profile_predictions(settled_at, kickoff);
      CREATE INDEX IF NOT EXISTS idx_profile_predictions_report
        ON profile_predictions(profile, model_version, settled_at, score);
      CREATE TABLE IF NOT EXISTS profile_analysis_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        market TEXT NOT NULL,
        dates_json TEXT NOT NULL,
        selections_json TEXT NOT NULL,
        matches_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profile_prediction_scopes (
        run_id INTEGER NOT NULL REFERENCES profile_analysis_runs(id) ON DELETE CASCADE,
        prediction_id INTEGER NOT NULL REFERENCES profile_predictions(id) ON DELETE CASCADE,
        PRIMARY KEY(run_id, prediction_id)
      );
      CREATE INDEX IF NOT EXISTS idx_profile_prediction_scopes_prediction
        ON profile_prediction_scopes(prediction_id);
      CREATE TABLE IF NOT EXISTS goal_line_analysis_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        model_version TEXT NOT NULL,
        dates_json TEXT NOT NULL,
        selections_json TEXT NOT NULL,
        matches_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS goal_line_predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_at TEXT NOT NULL,
        fixture_id INTEGER NOT NULL,
        kickoff TEXT NOT NULL,
        country TEXT NOT NULL,
        league TEXT NOT NULL,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        model_version TEXT NOT NULL,
        expected_home_goals REAL NOT NULL,
        expected_away_goals REAL NOT NULL,
        expected_total_goals REAL NOT NULL,
        data_confidence INTEGER NOT NULL,
        home_probability REAL,
        draw_probability REAL,
        away_probability REAL,
        btts_probability REAL,
        over15 REAL NOT NULL,
        under15 REAL NOT NULL,
        over25 REAL NOT NULL,
        under25 REAL NOT NULL,
        over35 REAL NOT NULL,
        under35 REAL NOT NULL,
        warnings_json TEXT NOT NULL,
        settled_at TEXT,
        actual_home_goals INTEGER,
        actual_away_goals INTEGER,
        UNIQUE(fixture_id, model_version)
      );
      CREATE INDEX IF NOT EXISTS idx_goal_line_predictions_unsettled
        ON goal_line_predictions(settled_at, kickoff);
      CREATE TABLE IF NOT EXISTS goal_line_prediction_scopes (
        run_id INTEGER NOT NULL REFERENCES goal_line_analysis_runs(id) ON DELETE CASCADE,
        prediction_id INTEGER NOT NULL REFERENCES goal_line_predictions(id) ON DELETE CASCADE,
        PRIMARY KEY(run_id, prediction_id)
      );
      CREATE INDEX IF NOT EXISTS idx_goal_line_scopes_prediction
        ON goal_line_prediction_scopes(prediction_id);
      CREATE TABLE IF NOT EXISTS league_strength_snapshots (
        pool TEXT NOT NULL,
        league_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        as_of TEXT NOT NULL,
        rating REAL NOT NULL,
        matches INTEGER NOT NULL,
        clubs INTEGER NOT NULL,
        reliable INTEGER NOT NULL,
        PRIMARY KEY(pool, league_id, season, as_of)
      );
      CREATE INDEX IF NOT EXISTS idx_league_strength_lookup
        ON league_strength_snapshots(pool, league_id, season, as_of);
      CREATE TABLE IF NOT EXISTS strength_team_leagues (
        team_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        league_id INTEGER NOT NULL,
        PRIMARY KEY(team_id, season)
      );
      CREATE TABLE IF NOT EXISTS strength_matches (
        fixture_id INTEGER PRIMARY KEY,
        pool TEXT NOT NULL,
        season INTEGER NOT NULL,
        kickoff TEXT NOT NULL,
        home_league_id INTEGER NOT NULL,
        away_league_id INTEGER NOT NULL,
        home_club_id INTEGER NOT NULL,
        away_club_id INTEGER NOT NULL,
        home_goals INTEGER NOT NULL,
        away_goals INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_strength_matches_order
        ON strength_matches(pool, season, kickoff);
      CREATE TABLE IF NOT EXISTS strength_build_progress (
        competition_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY(competition_id, season)
      );
      CREATE TABLE IF NOT EXISTS tipico_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        imported_at TEXT NOT NULL,
        source_file TEXT NOT NULL,
        date_range TEXT NOT NULL,
        total_events INTEGER NOT NULL,
        selected_events INTEGER NOT NULL,
        selected_competitions INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tipico_competitions (
        tipico_competition_id INTEGER PRIMARY KEY,
        country_name TEXT NOT NULL,
        competition_name TEXT NOT NULL,
        api_league_id INTEGER,
        api_country_name TEXT,
        api_league_name TEXT,
        mapping_source TEXT,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tipico_teams (
        tipico_team_id INTEGER PRIMARY KEY,
        tipico_name TEXT NOT NULL,
        api_team_id INTEGER,
        api_team_name TEXT,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tipico_fixtures (
        tipico_event_id TEXT PRIMARY KEY,
        tipico_competition_id INTEGER NOT NULL,
        kickoff TEXT NOT NULL,
        tipico_home_team_id INTEGER NOT NULL,
        tipico_away_team_id INTEGER NOT NULL,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        sport_radar_match_id INTEGER,
        api_fixture_id INTEGER,
        odds_json TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tipico_fixtures_api
        ON tipico_fixtures(api_fixture_id, kickoff);
    `);
    const columns = this.db.prepare("PRAGMA table_info(candidates)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "tipico_odds")) {
      this.db.exec("ALTER TABLE candidates ADD COLUMN tipico_odds REAL");
    }
    const profileColumns = this.db.prepare("PRAGMA table_info(profile_predictions)").all() as Array<{ name: string }>;
    for (const column of [
      "odds_home", "odds_draw", "odds_away",
      "market_home", "market_draw", "market_away"
    ]) {
      if (!profileColumns.some((item) => item.name === column)) {
        this.db.exec(`ALTER TABLE profile_predictions ADD COLUMN ${column} REAL`);
      }
    }
    const goalColumns = this.db.prepare("PRAGMA table_info(goal_line_predictions)").all() as Array<{ name: string }>;
    for (const column of [
      "home_probability", "draw_probability", "away_probability", "btts_probability"
    ]) {
      if (!goalColumns.some((item) => item.name === column)) {
        this.db.exec(`ALTER TABLE goal_line_predictions ADD COLUMN ${column} REAL`);
      }
    }
  }

  saveProfilePredictions(
    snapshotAt: string,
    market: "draw" | "1x2",
    rows: Array<DrawScoreRow | FavoriteScoreRow>,
    scope: ProfileSaveScope = {
      dates: [], selections: [], matches: [], oddsByFixture: new Map()
    }
  ): number {
    const insert = this.db.prepare(`
      INSERT INTO profile_predictions(
        snapshot_at, fixture_id, kickoff, country, league, home_team, away_team,
        market, profile, model_version, selection, market_score, sports_score,
        score, confidence, rating, available_maximum, api_odds,
        odds_home, odds_draw, odds_away, market_home, market_draw, market_away,
        breakdown_json, warnings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fixture_id, market, profile, model_version) DO UPDATE SET
        snapshot_at = excluded.snapshot_at,
        kickoff = excluded.kickoff,
        selection = excluded.selection,
        market_score = excluded.market_score,
        sports_score = excluded.sports_score,
        score = excluded.score,
        confidence = excluded.confidence,
        rating = excluded.rating,
        available_maximum = excluded.available_maximum,
        api_odds = excluded.api_odds,
        odds_home = excluded.odds_home,
        odds_draw = excluded.odds_draw,
        odds_away = excluded.odds_away,
        market_home = excluded.market_home,
        market_draw = excluded.market_draw,
        market_away = excluded.market_away,
        breakdown_json = excluded.breakdown_json,
        warnings_json = excluded.warnings_json
      WHERE profile_predictions.settled_at IS NULL
        AND excluded.snapshot_at < excluded.kickoff
        AND excluded.snapshot_at > profile_predictions.snapshot_at
    `);
    let saved = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.db.prepare(`
        INSERT INTO profile_analysis_runs(
          created_at, market, dates_json, selections_json, matches_json
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        snapshotAt,
        market,
        JSON.stringify(scope.dates),
        JSON.stringify(scope.selections),
        JSON.stringify(scope.matches)
      );
      const runId = Number(run.lastInsertRowid);
      const linkScope = this.db.prepare(`
        INSERT OR IGNORE INTO profile_prediction_scopes(run_id, prediction_id)
        VALUES (?, ?)
      `);
      const findPrediction = this.db.prepare(`
        SELECT id FROM profile_predictions
        WHERE fixture_id = ? AND market = ? AND profile = ? AND model_version = ?
      `);
      for (const row of rows) {
        if (snapshotAt >= row.kickoff) continue;
        const selection = market === "draw"
          ? "X"
          : (row as FavoriteScoreRow).selection;
        const odds = scope.oddsByFixture.get(row.fixtureId) ?? {
          home: null, draw: null, away: null
        };
        const inverse = [odds.home, odds.draw, odds.away].map((value) =>
          value !== null && value > 0 ? 1 / value : null
        );
        const inverseTotal = inverse.every((value) => value !== null)
          ? (inverse[0]! + inverse[1]! + inverse[2]!)
          : null;
        const profile = `${market}-${row.model}`;
        const result = insert.run(
          snapshotAt,
          row.fixtureId,
          row.kickoff,
          row.country,
          row.league,
          row.homeTeam,
          row.awayTeam,
          market,
          profile,
          row.modelVersion,
          selection,
          row.marketScore,
          row.sportsScore,
          row.score,
          row.confidence,
          row.rating,
          row.availableMaximum,
          row.odds,
          odds.home,
          odds.draw,
          odds.away,
          inverseTotal === null ? null : inverse[0]! / inverseTotal,
          inverseTotal === null ? null : inverse[1]! / inverseTotal,
          inverseTotal === null ? null : inverse[2]! / inverseTotal,
          JSON.stringify(row.breakdown),
          JSON.stringify(row.warnings)
        );
        saved += Number(result.changes);
        const prediction = findPrediction.get(
          row.fixtureId, market, profile, row.modelVersion
        ) as { id: number } | undefined;
        if (prediction) linkScope.run(runId, prediction.id);
      }
      this.db.exec("COMMIT");
      return saved;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  latestProfileSnapshot(market: "draw" | "1x2"): StoredProfileSnapshot | null {
    const run = this.db.prepare(`
      SELECT id, created_at, dates_json
      FROM profile_analysis_runs
      WHERE market = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(market) as {
      id: number;
      created_at: string;
      dates_json: string;
    } | undefined;
    if (!run) return null;
    const rows = this.db.prepare(`
      SELECT
        p.fixture_id, p.kickoff, p.home_team, p.away_team,
        p.odds_home, p.odds_away
      FROM profile_predictions p
      JOIN profile_prediction_scopes scope ON scope.prediction_id = p.id
      WHERE scope.run_id = ?
      ORDER BY p.kickoff, p.home_team
    `).all(run.id) as Array<{
      fixture_id: number;
      kickoff: string;
      home_team: string;
      away_team: string;
      odds_home: number | null;
      odds_away: number | null;
    }>;
    return {
      createdAt: run.created_at,
      dates: JSON.parse(run.dates_json) as string[],
      rows: rows.map((row) => ({
        fixtureId: row.fixture_id,
        kickoff: row.kickoff,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        oddsHome: row.odds_home,
        oddsAway: row.odds_away
      }))
    };
  }

  saveGoalLinePredictions(
    snapshotAt: string,
    rows: GoalLineRow[],
    scope: GoalLineSaveScope
  ): number {
    const insert = this.db.prepare(`
      INSERT INTO goal_line_predictions(
        snapshot_at, fixture_id, kickoff, country, league, home_team, away_team,
        model_version, expected_home_goals, expected_away_goals,
        expected_total_goals, data_confidence, home_probability,
        draw_probability, away_probability, btts_probability,
        over15, under15, over25, under25, over35, under35, warnings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fixture_id, model_version) DO UPDATE SET
        snapshot_at = excluded.snapshot_at,
        kickoff = excluded.kickoff,
        expected_home_goals = excluded.expected_home_goals,
        expected_away_goals = excluded.expected_away_goals,
        expected_total_goals = excluded.expected_total_goals,
        data_confidence = excluded.data_confidence,
        home_probability = excluded.home_probability,
        draw_probability = excluded.draw_probability,
        away_probability = excluded.away_probability,
        btts_probability = excluded.btts_probability,
        over15 = excluded.over15,
        under15 = excluded.under15,
        over25 = excluded.over25,
        under25 = excluded.under25,
        over35 = excluded.over35,
        under35 = excluded.under35,
        warnings_json = excluded.warnings_json
      WHERE goal_line_predictions.settled_at IS NULL
        AND excluded.snapshot_at < excluded.kickoff
        AND excluded.snapshot_at > goal_line_predictions.snapshot_at
    `);
    const findPrediction = this.db.prepare(`
      SELECT id FROM goal_line_predictions
      WHERE fixture_id = ? AND model_version = ?
    `);
    const linkScope = this.db.prepare(`
      INSERT OR IGNORE INTO goal_line_prediction_scopes(run_id, prediction_id)
      VALUES (?, ?)
    `);
    let saved = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.db.prepare(`
        INSERT INTO goal_line_analysis_runs(
          created_at, model_version, dates_json, selections_json, matches_json
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        snapshotAt,
        config.goalLineModelVersion,
        JSON.stringify(scope.dates),
        JSON.stringify(scope.selections),
        JSON.stringify(scope.matches)
      );
      const runId = Number(run.lastInsertRowid);
      for (const row of rows) {
        if (snapshotAt >= row.kickoff) continue;
        const result = insert.run(
          snapshotAt,
          row.fixtureId,
          row.kickoff,
          row.country,
          row.league,
          row.homeTeam,
          row.awayTeam,
          row.modelVersion,
          row.expectedHomeGoals,
          row.expectedAwayGoals,
          row.expectedTotalGoals,
          row.dataConfidence,
          row.outcomeProbabilities.home,
          row.outcomeProbabilities.draw,
          row.outcomeProbabilities.away,
          row.outcomeProbabilities.btts,
          row.probabilities.over15,
          row.probabilities.under15,
          row.probabilities.over25,
          row.probabilities.under25,
          row.probabilities.over35,
          row.probabilities.under35,
          JSON.stringify(row.warnings)
        );
        saved += Number(result.changes);
        const prediction = findPrediction.get(
          row.fixtureId,
          row.modelVersion
        ) as { id: number } | undefined;
        if (prediction) linkScope.run(runId, prediction.id);
      }
      this.db.exec("COMMIT");
      return saved;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveRun(
    base: Omit<AnalysisResult, "runId">,
    candidates: Candidate[]
  ): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.db.prepare(`
        INSERT INTO runs(created_at, model_version, dates_json, markets_json, fixture_count)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        base.createdAt,
        config.modelVersion,
        JSON.stringify(base.dates),
        JSON.stringify(base.markets),
        base.fixtureCount
      );
      const runId = Number(run.lastInsertRowid);
      const insert = this.db.prepare(`
        INSERT INTO candidates(
          run_id, fixture_id, kickoff, country, league, home_team, away_team,
          market, selection, probability, quality, expected_home_goals,
          expected_away_goals, reasons_json, cautions_json
          , tipico_odds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const candidate of candidates) {
        insert.run(
          runId,
          candidate.fixtureId,
          candidate.kickoff,
          candidate.country,
          candidate.league,
          candidate.homeTeam,
          candidate.awayTeam,
          candidate.market,
          candidate.selection,
          candidate.probability,
          candidate.quality,
          candidate.expectedHomeGoals,
          candidate.expectedAwayGoals,
          JSON.stringify(candidate.reasons),
          JSON.stringify(candidate.cautions),
          candidate.tipicoOdds ?? null
        );
      }
      this.db.exec("COMMIT");
      return runId;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  unsettledFixtures(now = new Date()): number[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT fixture_id FROM (
        SELECT fixture_id
        FROM candidates
        WHERE settled_at IS NULL AND kickoff < ?
        UNION
        SELECT fixture_id
        FROM profile_predictions
        WHERE settled_at IS NULL AND kickoff < ?
        UNION
        SELECT fixture_id
        FROM goal_line_predictions
        WHERE settled_at IS NULL AND kickoff < ?
      )
      ORDER BY fixture_id
    `).all(
      now.toISOString(),
      now.toISOString(),
      now.toISOString()
    ) as Array<{ fixture_id: number }>;
    return rows.map((row) => row.fixture_id);
  }

  settleFixture(fixture: ApiFixture): number {
    const status = fixture.fixture.status.short;
    if (!["FT", "AET", "PEN"].includes(status)) return 0;
    const home = fixture.score.fulltime?.home ?? fixture.goals.home;
    const away = fixture.score.fulltime?.away ?? fixture.goals.away;
    if (home === null || away === null) return 0;
    const rows = this.db.prepare(`
      SELECT id, market, selection, probability
      FROM candidates
      WHERE fixture_id = ? AND settled_at IS NULL
    `).all(fixture.fixture.id) as Array<{
      id: number;
      market: Market;
      selection: string;
      probability: number;
    }>;
    const update = this.db.prepare(`
      UPDATE candidates
      SET settled_at = ?, actual_home_goals = ?, actual_away_goals = ?, hit = ?, brier = ?
      WHERE id = ?
    `);
    for (const row of rows) {
      let hit = false;
      if (row.market === "draw") hit = home === away;
      else if (row.market === "btts") hit = home > 0 && away > 0;
      else if (row.market === "over25") hit = home + away >= 3;
      else if (row.selection.startsWith("Heimsieg")) hit = home > away;
      else if (row.selection.startsWith("Auswärtssieg")) hit = away > home;
      else hit = home === away;
      const outcome = hit ? 1 : 0;
      update.run(
        new Date().toISOString(),
        home,
        away,
        outcome,
        (row.probability - outcome) ** 2,
        row.id
      );
    }
    const profileRows = this.db.prepare(`
      SELECT id, market, selection
      FROM profile_predictions
      WHERE fixture_id = ? AND settled_at IS NULL
    `).all(fixture.fixture.id) as Array<{
      id: number;
      market: "draw" | "1x2";
      selection: "X" | "1" | "2";
    }>;
    const updateProfile = this.db.prepare(`
      UPDATE profile_predictions
      SET settled_at = ?, actual_home_goals = ?, actual_away_goals = ?, hit = ?
      WHERE id = ?
    `);
    for (const row of profileRows) {
      const hit =
        row.selection === "X"
          ? home === away
          : row.selection === "1"
            ? home > away
            : away > home;
      updateProfile.run(
        new Date().toISOString(),
        home,
        away,
        hit ? 1 : 0,
        row.id
      );
    }
    const goalLineResult = this.db.prepare(`
      UPDATE goal_line_predictions
      SET settled_at = ?, actual_home_goals = ?, actual_away_goals = ?
      WHERE fixture_id = ? AND settled_at IS NULL
    `).run(
      new Date().toISOString(),
      home,
      away,
      fixture.fixture.id
    );
    return rows.length + profileRows.length + Number(goalLineResult.changes);
  }

  report(): PerformanceRow[] {
    const rows = this.db.prepare(`
      SELECT
        market,
        COUNT(*) AS total,
        SUM(hit) AS hits,
        AVG(probability) AS average_probability,
        AVG(brier) AS brier_score
      FROM candidates
      WHERE settled_at IS NOT NULL
      GROUP BY market
      ORDER BY market
    `).all() as Array<{
      market: Market;
      total: number;
      hits: number;
      average_probability: number;
      brier_score: number;
    }>;
    return rows.map((row) => ({
      market: row.market,
      total: row.total,
      hits: row.hits,
      hitRate: row.total ? row.hits / row.total : 0,
      averageProbability: row.average_probability,
      brierScore: row.brier_score
    }));
  }

  profileReport(): ProfilePerformanceRow[] {
    const raw = this.db.prepare(`
      SELECT
        model_version,
        profile,
        CASE
          WHEN score < 50 THEN '<50'
          WHEN score < 60 THEN '50–59'
          WHEN score < 70 THEN '60–69'
          WHEN score < 80 THEN '70–79'
          ELSE '80–100'
        END AS band,
        COUNT(*) AS total,
        SUM(hit) AS hits
      FROM profile_predictions
      WHERE settled_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM profile_prediction_scopes scope
          WHERE scope.prediction_id = profile_predictions.id
        )
      GROUP BY model_version, profile, band
      ORDER BY profile, model_version,
        CASE band
          WHEN '<50' THEN 1
          WHEN '50–59' THEN 2
          WHEN '60–69' THEN 3
          WHEN '70–79' THEN 4
          ELSE 5
        END
    `).all() as Array<{
      model_version: string;
      profile: string;
      band: ProfilePerformanceRow["band"];
      total: number;
      hits: number;
    }>;
    const totals = new Map<string, number>();
    for (const row of raw) {
      const key = `${row.model_version}|${row.profile}`;
      totals.set(key, (totals.get(key) ?? 0) + row.total);
    }
    return raw.map((row) => {
      const hitRate = row.total === 0 ? 0 : row.hits / row.total;
      const [intervalLow, intervalHigh] = wilsonInterval(row.hits, row.total);
      return {
        modelVersion: row.model_version,
        profile: row.profile,
        band: row.band,
        total: row.total,
        hits: row.hits,
        hitRate,
        coverage: row.total / Math.max(
          1,
          totals.get(`${row.model_version}|${row.profile}`) ?? 0
        ),
        intervalLow,
        intervalHigh
      };
    });
  }

  profilePredictionCount(): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total FROM profile_predictions
    `).get() as { total: number };
    return row.total;
  }

  goalLinePredictionCount(): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total FROM goal_line_predictions
    `).get() as { total: number };
    return row.total;
  }

  goalLineReport(): GoalLinePerformanceRow[] {
    const rows = this.db.prepare(`
      SELECT model_version, over15, under15, over25, under25, over35, under35,
             actual_home_goals, actual_away_goals
      FROM goal_line_predictions
      WHERE settled_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM goal_line_prediction_scopes scope
          WHERE scope.prediction_id = goal_line_predictions.id
        )
    `).all() as Array<{
      model_version: string;
      over15: number;
      under15: number;
      over25: number;
      under25: number;
      over35: number;
      under35: number;
      actual_home_goals: number;
      actual_away_goals: number;
    }>;
    if (rows.length === 0) return [];
    const definitions = [
      { line: "1.5" as const, direction: "over" as const, probability: "over15" as const, threshold: 2 },
      { line: "1.5" as const, direction: "under" as const, probability: "under15" as const, threshold: 2 },
      { line: "2.5" as const, direction: "over" as const, probability: "over25" as const, threshold: 3 },
      { line: "2.5" as const, direction: "under" as const, probability: "under25" as const, threshold: 3 },
      { line: "3.5" as const, direction: "over" as const, probability: "over35" as const, threshold: 4 },
      { line: "3.5" as const, direction: "under" as const, probability: "under35" as const, threshold: 4 }
    ];
    const versions = [...new Set(rows.map((row) => row.model_version))].sort();
    return versions.flatMap((modelVersion) => {
      const versionRows = rows.filter((row) => row.model_version === modelVersion);
      return definitions.map((definition) => {
        let hits = 0;
        let probabilityTotal = 0;
        let brierTotal = 0;
        for (const row of versionRows) {
          const totalGoals = row.actual_home_goals + row.actual_away_goals;
          const over = totalGoals >= definition.threshold;
          const hit = definition.direction === "over" ? over : !over;
          const probability = row[definition.probability];
          const outcome = hit ? 1 : 0;
          hits += outcome;
          probabilityTotal += probability;
          brierTotal += (probability - outcome) ** 2;
        }
        const [intervalLow, intervalHigh] = wilsonInterval(hits, versionRows.length);
        return {
          modelVersion,
          line: definition.line,
          direction: definition.direction,
          total: versionRows.length,
          hits,
          hitRate: versionRows.length ? hits / versionRows.length : 0,
          averageProbability: versionRows.length
            ? probabilityTotal / versionRows.length
            : 0,
          brierScore: versionRows.length ? brierTotal / versionRows.length : 0,
          intervalLow,
          intervalHigh
        };
      });
    });
  }

  outcomeProbabilityReport(): OutcomeProbabilityPerformanceRow[] {
    const rows = this.db.prepare(`
      SELECT home_probability, draw_probability, away_probability,
             btts_probability, actual_home_goals, actual_away_goals
      FROM goal_line_predictions
      WHERE settled_at IS NOT NULL
        AND actual_home_goals IS NOT NULL
        AND actual_away_goals IS NOT NULL
        AND home_probability IS NOT NULL
        AND draw_probability IS NOT NULL
        AND away_probability IS NOT NULL
        AND btts_probability IS NOT NULL
    `).all() as Array<{
      home_probability: number;
      draw_probability: number;
      away_probability: number;
      btts_probability: number;
      actual_home_goals: number;
      actual_away_goals: number;
    }>;
    if (rows.length === 0) return [];
    const summarize = (
      market: OutcomeProbabilityPerformanceRow["market"],
      samples: Array<{ hit: boolean; probability: number; brier: number }>
    ): OutcomeProbabilityPerformanceRow => {
      const hits = samples.filter((sample) => sample.hit).length;
      const [intervalLow, intervalHigh] = wilsonInterval(hits, samples.length);
      return {
        market,
        total: samples.length,
        hits,
        hitRate: hits / samples.length,
        averageProbability: samples.reduce((sum, sample) => sum + sample.probability, 0) / samples.length,
        brierScore: samples.reduce((sum, sample) => sum + sample.brier, 0) / samples.length,
        intervalLow,
        intervalHigh
      };
    };
    const oneXTwo = rows.map((row) => {
      const probabilities = [row.home_probability, row.draw_probability, row.away_probability];
      const actual = row.actual_home_goals > row.actual_away_goals
        ? 0
        : row.actual_home_goals === row.actual_away_goals ? 1 : 2;
      const predicted = probabilities.indexOf(Math.max(...probabilities));
      const brier = probabilities.reduce(
        (sum, probability, index) => sum + (probability - (index === actual ? 1 : 0)) ** 2,
        0
      );
      return { hit: predicted === actual, probability: probabilities[predicted]!, brier };
    });
    const draw = rows.map((row) => {
      const actual = row.actual_home_goals === row.actual_away_goals;
      return {
        hit: (row.draw_probability >= 0.5) === actual,
        probability: row.draw_probability,
        brier: (row.draw_probability - (actual ? 1 : 0)) ** 2
      };
    });
    const btts = rows.map((row) => {
      const actual = row.actual_home_goals > 0 && row.actual_away_goals > 0;
      return {
        hit: (row.btts_probability >= 0.5) === actual,
        probability: row.btts_probability,
        brier: (row.btts_probability - (actual ? 1 : 0)) ** 2
      };
    });
    return [summarize("1x2", oneXTwo), summarize("draw", draw), summarize("btts", btts)];
  }

  drawValidationStatus(minimum = 50): {
    settledRecommendations: number;
    minimum: number;
    validated: boolean;
  } {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM profile_predictions
      WHERE market = 'draw'
        AND model_version = ?
        AND settled_at IS NOT NULL
        AND rating IN ('interessant', 'stark', 'sehr stark')
        AND EXISTS (
          SELECT 1 FROM profile_prediction_scopes scope
          WHERE scope.prediction_id = profile_predictions.id
        )
    `).get(config.activeProfileVersion) as { total: number };
    return {
      settledRecommendations: row.total,
      minimum,
      validated: row.total >= minimum
    };
  }

  marketBaseline(minimumOdds = 1.4): MarketBaselineRow[] {
    const raw = this.db.prepare(`
      SELECT
        model_version,
        COUNT(*) AS eligible,
        SUM(CASE WHEN api_odds >= ? THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN api_odds >= ? THEN hit ELSE 0 END) AS hits
      FROM profile_predictions
      WHERE market = '1x2'
        AND model_version = ?
        AND settled_at IS NOT NULL
        AND odds_home IS NOT NULL AND odds_draw IS NOT NULL AND odds_away IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM profile_prediction_scopes scope
          WHERE scope.prediction_id = profile_predictions.id
        )
      GROUP BY model_version
    `).all(minimumOdds, minimumOdds, config.activeProfileVersion) as Array<{
      model_version: string;
      eligible: number;
      total: number;
      hits: number;
    }>;
    return raw.map((row) => {
      const hitRate = row.total ? row.hits / row.total : 0;
      const [intervalLow, intervalHigh] = wilsonInterval(row.hits, row.total);
      return {
        modelVersion: row.model_version,
        minimumOdds,
        total: row.total,
        hits: row.hits,
        hitRate,
        coverage: row.eligible ? row.total / row.eligible : 0,
        intervalLow,
        intervalHigh
      };
    });
  }

  topKReport(minimumOdds = 1.4): TopKPerformanceRow[] {
    const versions = this.db.prepare(`
      SELECT DISTINCT model_version
      FROM profile_predictions
      WHERE market = '1x2' AND settled_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM profile_prediction_scopes scope
          WHERE scope.prediction_id = profile_predictions.id
        )
      ORDER BY model_version
    `).all() as Array<{ model_version: string }>;
    const ranked = this.db.prepare(`
      SELECT hit, rank_in_day
      FROM (
        SELECT hit,
          ROW_NUMBER() OVER (
            PARTITION BY substr(kickoff, 1, 10)
            ORDER BY score DESC, kickoff, fixture_id
          ) AS rank_in_day
        FROM profile_predictions
        WHERE market = '1x2'
          AND model_version = ?
          AND settled_at IS NOT NULL
          AND api_odds >= ?
          AND odds_home IS NOT NULL AND odds_draw IS NOT NULL AND odds_away IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM profile_prediction_scopes scope
            WHERE scope.prediction_id = profile_predictions.id
          )
      )
    `);
    const result: TopKPerformanceRow[] = [];
    for (const version of versions) {
      const rows = ranked.all(version.model_version, minimumOdds) as Array<{
        hit: number;
        rank_in_day: number;
      }>;
      for (const topK of [5, 7, 10, 16] as const) {
        const selected = rows.filter((row) => row.rank_in_day <= topK);
        const hits = selected.reduce((sum, row) => sum + row.hit, 0);
        const [intervalLow, intervalHigh] = wilsonInterval(hits, selected.length);
        result.push({
          modelVersion: version.model_version,
          minimumOdds,
          topK,
          total: selected.length,
          hits,
          hitRate: selected.length ? hits / selected.length : 0,
          coverage: rows.length ? selected.length / rows.length : 0,
          intervalLow,
          intervalHigh
        });
      }
    }
    return result;
  }

  saveLeagueStrength(snapshot: LeagueStrengthSnapshot): void {
    this.db.prepare(`
      INSERT INTO league_strength_snapshots(
        pool, league_id, season, as_of, rating, matches, clubs, reliable
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pool, league_id, season, as_of) DO UPDATE SET
        rating = excluded.rating,
        matches = excluded.matches,
        clubs = excluded.clubs,
        reliable = excluded.reliable
    `).run(
      snapshot.pool,
      snapshot.leagueId,
      snapshot.season,
      snapshot.asOf,
      snapshot.rating,
      snapshot.matches,
      snapshot.clubs,
      snapshot.reliable ? 1 : 0
    );
  }

  getStrengthTeamLeague(teamId: number, season: number): number | null {
    const row = this.db.prepare(`
      SELECT league_id
      FROM strength_team_leagues
      WHERE team_id = ? AND season = ?
    `).get(teamId, season) as { league_id: number } | undefined;
    return row?.league_id ?? null;
  }

  saveStrengthTeamLeague(teamId: number, season: number, leagueId: number): void {
    this.db.prepare(`
      INSERT INTO strength_team_leagues(team_id, season, league_id)
      VALUES (?, ?, ?)
      ON CONFLICT(team_id, season) DO UPDATE SET league_id = excluded.league_id
    `).run(teamId, season, leagueId);
  }

  saveStrengthMatch(input: {
    fixtureId: number;
    pool: string;
    season: number;
    kickoff: string;
    homeLeagueId: number;
    awayLeagueId: number;
    homeClubId: number;
    awayClubId: number;
    homeGoals: number;
    awayGoals: number;
  }): boolean {
    const result = this.db.prepare(`
      INSERT INTO strength_matches(
        fixture_id, pool, season, kickoff, home_league_id, away_league_id,
        home_club_id, away_club_id, home_goals, away_goals
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fixture_id) DO NOTHING
    `).run(
      input.fixtureId,
      input.pool,
      input.season,
      input.kickoff,
      input.homeLeagueId,
      input.awayLeagueId,
      input.homeClubId,
      input.awayClubId,
      input.homeGoals,
      input.awayGoals
    );
    return Number(result.changes) > 0;
  }

  isStrengthSeasonComplete(competitionId: number, season: number): boolean {
    const row = this.db.prepare(`
      SELECT 1 AS present
      FROM strength_build_progress
      WHERE competition_id = ? AND season = ?
    `).get(competitionId, season) as { present: number } | undefined;
    return row !== undefined;
  }

  markStrengthSeasonComplete(
    competitionId: number,
    season: number,
    completedAt = new Date().toISOString()
  ): void {
    this.db.prepare(`
      INSERT INTO strength_build_progress(competition_id, season, completed_at)
      VALUES (?, ?, ?)
      ON CONFLICT(competition_id, season) DO UPDATE SET
        completed_at = excluded.completed_at
    `).run(competitionId, season, completedAt);
  }

  strengthMatches(): Array<{
    fixtureId: number;
    pool: string;
    season: number;
    kickoff: string;
    homeLeagueId: number;
    awayLeagueId: number;
    homeClubId: number;
    awayClubId: number;
    homeGoals: number;
    awayGoals: number;
  }> {
    const rows = this.db.prepare(`
      SELECT fixture_id, pool, season, kickoff, home_league_id, away_league_id,
             home_club_id, away_club_id, home_goals, away_goals
      FROM strength_matches
      ORDER BY pool, season, kickoff, fixture_id
    `).all() as Array<{
      fixture_id: number;
      pool: string;
      season: number;
      kickoff: string;
      home_league_id: number;
      away_league_id: number;
      home_club_id: number;
      away_club_id: number;
      home_goals: number;
      away_goals: number;
    }>;
    return rows.map((row) => ({
      fixtureId: row.fixture_id,
      pool: row.pool,
      season: row.season,
      kickoff: row.kickoff,
      homeLeagueId: row.home_league_id,
      awayLeagueId: row.away_league_id,
      homeClubId: row.home_club_id,
      awayClubId: row.away_club_id,
      homeGoals: row.home_goals,
      awayGoals: row.away_goals
    }));
  }

  getLeagueStrength(
    pool: string,
    leagueId: number,
    season: number,
    cutoff: string
  ): LeagueStrengthSnapshot | null {
    const row = this.db.prepare(`
      SELECT pool, league_id, season, as_of, rating, matches, clubs, reliable
      FROM league_strength_snapshots
      WHERE pool = ? AND league_id = ? AND season <= ? AND as_of < ?
      ORDER BY season DESC, as_of DESC
      LIMIT 1
    `).get(pool, leagueId, season, cutoff) as {
      pool: string;
      league_id: number;
      season: number;
      as_of: string;
      rating: number;
      matches: number;
      clubs: number;
      reliable: number;
    } | undefined;
    if (!row) return null;
    const seasonsElapsed = Math.max(0, season - row.season);
    return {
          pool: row.pool,
          leagueId: row.league_id,
          season: row.season,
          asOf: row.as_of,
          rating:
            1500 +
            (row.rating - 1500) * 0.8 ** seasonsElapsed,
          matches: row.matches,
          clubs: row.clubs,
          reliable: row.reliable === 1
        };
  }

  saveTipicoImport(input: {
    sourceFile: string;
    dateRange: string;
    totalEvents: number;
    selectedEvents: number;
    selectedCompetitions: number;
    events: Array<{
      tipicoEventId: string;
      tipicoCompetitionId: number;
      tipicoHomeTeamId: number;
      tipicoAwayTeamId: number;
      sportRadarMatchId: number | null;
      kickoff: string;
      homeTeam: string;
      awayTeam: string;
      competition: LeagueSelection;
      odds: unknown;
    }>;
  }): number {
    const importedAt = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.db.prepare(`
        INSERT INTO tipico_imports(
          imported_at, source_file, date_range, total_events,
          selected_events, selected_competitions
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        importedAt,
        input.sourceFile,
        input.dateRange,
        input.totalEvents,
        input.selectedEvents,
        input.selectedCompetitions
      );
      const saveCompetition = this.db.prepare(`
        INSERT INTO tipico_competitions(
          tipico_competition_id, country_name, competition_name, last_seen_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(tipico_competition_id) DO UPDATE SET
          country_name = excluded.country_name,
          competition_name = excluded.competition_name,
          last_seen_at = excluded.last_seen_at
      `);
      const saveTeam = this.db.prepare(`
        INSERT INTO tipico_teams(tipico_team_id, tipico_name, last_seen_at)
        VALUES (?, ?, ?)
        ON CONFLICT(tipico_team_id) DO UPDATE SET
          tipico_name = excluded.tipico_name,
          last_seen_at = excluded.last_seen_at
      `);
      const saveFixture = this.db.prepare(`
        INSERT INTO tipico_fixtures(
          tipico_event_id, tipico_competition_id, kickoff,
          tipico_home_team_id, tipico_away_team_id, home_team, away_team,
          sport_radar_match_id, odds_json, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tipico_event_id) DO UPDATE SET
          kickoff = excluded.kickoff,
          home_team = excluded.home_team,
          away_team = excluded.away_team,
          sport_radar_match_id = excluded.sport_radar_match_id,
          odds_json = excluded.odds_json,
          last_seen_at = excluded.last_seen_at
      `);
      for (const event of input.events) {
        saveCompetition.run(
          event.tipicoCompetitionId,
          event.competition.country,
          event.competition.league,
          importedAt
        );
        saveTeam.run(event.tipicoHomeTeamId, event.homeTeam, importedAt);
        saveTeam.run(event.tipicoAwayTeamId, event.awayTeam, importedAt);
        saveFixture.run(
          event.tipicoEventId,
          event.tipicoCompetitionId,
          event.kickoff,
          event.tipicoHomeTeamId,
          event.tipicoAwayTeamId,
          event.homeTeam,
          event.awayTeam,
          event.sportRadarMatchId,
          JSON.stringify(event.odds),
          importedAt
        );
      }
      this.db.exec("COMMIT");
      return Number(run.lastInsertRowid);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveTipicoCompetitionMapping(
    tipicoCompetitionId: number,
    value: { leagueId: number; country: string; league: string; source: string }
  ): void {
    this.db.prepare(`
      UPDATE tipico_competitions SET
        api_league_id = ?, api_country_name = ?, api_league_name = ?, mapping_source = ?
      WHERE tipico_competition_id = ?
    `).run(value.leagueId, value.country, value.league, value.source, tipicoCompetitionId);
  }

  saveTipicoFixtureMapping(
    match: LiveMatchSelection,
    fixture: ApiFixture
  ): void {
    if (match.tipicoEventId) {
      this.db.prepare(`
        UPDATE tipico_fixtures SET api_fixture_id = ? WHERE tipico_event_id = ?
      `).run(fixture.fixture.id, match.tipicoEventId);
    }
    for (const [tipicoId, apiTeam] of [
      [match.tipicoHomeTeamId, fixture.teams.home],
      [match.tipicoAwayTeamId, fixture.teams.away]
    ] as const) {
      if (!tipicoId) continue;
      this.db.prepare(`
        UPDATE tipico_teams SET api_team_id = ?, api_team_name = ?
        WHERE tipico_team_id = ?
      `).run(apiTeam.id, apiTeam.name, tipicoId);
    }
  }

  close(): void {
    this.db.close();
  }
}

function wilsonInterval(hits: number, total: number): [number, number] {
  if (total === 0) return [0, 0];
  const z = 1.959963984540054;
  const probability = hits / total;
  const denominator = 1 + z * z / total;
  const center = (probability + z * z / (2 * total)) / denominator;
  const margin =
    z / denominator *
    Math.sqrt(
      probability * (1 - probability) / total +
      z * z / (4 * total * total)
    );
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
