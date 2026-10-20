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
  Market,
  FixtureExpectedGoals
} from "./types.ts";
import type { MatchWinnerOdds } from "./draw-criteria.ts";
import type { FixtureResult, FixtureResultStats } from "./fixture-result.ts";
import type { StoredRecentStats } from "./recent-stats.ts";
import type { InsightTeamStats } from "./fixture-insights.ts";
import type { EloMatch } from "./elo-competitions.ts";
import type { EloHistoryRow, EloRankingRow } from "./elo.ts";

/** Der Statistikkatalog einer Mannschaft für einen Abschnitt. */
type TeamHalfStats = InsightTeamStats;

/** true/false als 1/0, wie SQLite es speichert. */
function flag(value: boolean): number {
  return value ? 1 : 0;
}

/** Ein Objekt nur dann als JSON, wenn es etwas trägt - sonst bleibt die Spalte null. */
function jsonOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return JSON.stringify(value);
}

/**
 * Der volle Katalog einer Seite als JSON, zusammen mit den Kennzahlen außerhalb des
 * Katalogs. Fehlt die Statistik ganz, bleibt die Spalte null statt eines leeren Objekts.
 */
function statsJson(stats: FixtureResultStats): string | null {
  if (!stats.full) return null;
  return JSON.stringify({ ...stats.full, ...stats.extra });
}

/**
 * Die Werte einer Ergebniszeile in der Reihenfolge von `RESULT_COLUMNS`. Bewusst als eigene
 * Funktion neben der Spaltenliste, damit eine Änderung an einer der beiden Stellen sofort
 * beim Zählen der Platzhalter auffällt.
 */
function resultValues(row: FixtureResult): Array<string | number | null> {
  return [
    row.fixtureId, row.kickoff, row.status, row.leagueId, row.country, row.league,
    row.season, row.round,
    row.homeTeamId, row.awayTeamId, row.homeTeam, row.awayTeam,
    row.finalHomeGoals, row.finalAwayGoals,
    row.htHomeGoals, row.htAwayGoals, row.ftHomeGoals, row.ftAwayGoals,
    row.shHomeGoals, row.shAwayGoals, row.etHomeGoals, row.etAwayGoals,
    row.penHomeGoals, row.penAwayGoals,
    row.goalsHt1Home, row.goalsHt1Away, row.goalsHt2Home, row.goalsHt2Away,
    row.goalsEtHome, row.goalsEtAway, flag(row.goalsComplete),
    row.yellow.ht1Home, row.yellow.ht1Away, row.yellow.ht2Home, row.yellow.ht2Away,
    row.red.ht1Home, row.red.ht1Away, row.red.ht2Home, row.red.ht2Away,
    row.subs.ht1Home, row.subs.ht1Away, row.subs.ht2Home, row.subs.ht2Away,
    row.homeStats.full?.possession ?? null, row.awayStats.full?.possession ?? null,
    row.homeStats.full?.shots ?? null, row.awayStats.full?.shots ?? null,
    row.homeStats.full?.shotsOnGoal ?? null, row.awayStats.full?.shotsOnGoal ?? null,
    row.homeStats.full?.corners ?? null, row.awayStats.full?.corners ?? null,
    row.homeXg, row.awayXg,
    row.homeLineup?.formation ?? null, row.awayLineup?.formation ?? null,
    row.homeLineup?.coach?.name ?? null, row.awayLineup?.coach?.name ?? null,
    jsonOrNull(row.goals), jsonOrNull(row.cards), jsonOrNull(row.substitutions),
    statsJson(row.homeStats), statsJson(row.awayStats),
    jsonOrNull(row.homeLineup), jsonOrNull(row.awayLineup),
    jsonOrNull(row.homePlayers), jsonOrNull(row.awayPlayers),
    flag(row.eventsAvailable), flag(row.statsAvailable),
    flag(row.lineupsAvailable), flag(row.playersAvailable),
    row.source, row.fetchedAt
  ];
}

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
  period: "fulltime" | "first-half";
  line: "0.5" | "1.5" | "2.5" | "3.5";
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

export interface LeagueStrengthPerformanceRow {
  cohort: "Ligapartie" | "gemessen" | "geschätzt" | "Team-Elo" | "Team-Elo U21" | "gleiche Liga"
    | "ohne Rating" | "vor Ligastärke";
  /** Spiele, nicht Zeilen: je Spiel zählt nur die neueste Modellversion. */
  total: number;
  hits: number;
  hitRate: number;
  averageProbability: number;
  bias: number;
  brierScore: number;
  intervalLow: number;
  intervalHigh: number;
  /**
   * Die Seite aus der stärkeren Liga (Faktor > 1 Heim, < 1 Gast) gegen ihre eigene Prognose -
   * nur Spiele mit gespeichertem Faktor ungleich 1. Bei Spielen zwischen Ligen ist das die
   * Größe, an der der Teiler hängt; der Modellfavorit ist dort oft die schwächere Liga.
   */
  strongerTotal: number;
  strongerWinRate: number;
  strongerPredicted: number;
  /** Standardfehler der Abweichung unter der Prognose, √(Σ p(1−p)) / n; 0 ohne Spiele. */
  strongerStandardError: number;
}

export interface StrongerSideVersionRow {
  cohort: LeagueStrengthPerformanceRow["cohort"];
  modelVersion: string;
  total: number;
  winRate: number;
  predicted: number;
  standardError: number;
}

function strongerSummary(samples: Array<{ won: boolean; probability: number }>): Pick<
  LeagueStrengthPerformanceRow,
  "strongerTotal" | "strongerWinRate" | "strongerPredicted" | "strongerStandardError"
> {
  const total = samples.length;
  if (total === 0) {
    return { strongerTotal: 0, strongerWinRate: 0, strongerPredicted: 0, strongerStandardError: 0 };
  }
  const winRate = samples.filter((sample) => sample.won).length / total;
  return {
    strongerTotal: total,
    strongerWinRate: winRate,
    strongerPredicted: samples.reduce((sum, sample) => sum + sample.probability, 0) / total,
    // Standardfehler der Abweichung Siegquote minus Prognose unter der Prognose:
    // √(Σ p(1−p)) / n. Anders als √(p̂(1−p̂)/n) wird er bei 0 % oder 100 % Siegen nicht 0.
    strongerStandardError: Math.sqrt(
      samples.reduce((sum, sample) => sum + sample.probability * (1 - sample.probability), 0)
    ) / total
  };
}

/** So lange nach Anpfiff ist ein Spiel frühestens beendet (90 Minuten plus Pause und Nachspielzeit). */
const UNSETTLED_MIN_AGE_MS = 110 * 60 * 1000;

/** Ab dieser Fassung rechnet das Modell mit der Ligastärke (Commit 03df6d2, 22.08.2026). */
const FIRST_STRENGTH_MODEL_VERSION = [3, 1, 0] as const;

/** Semver als Zahlen; `null` für alles andere (Testkennungen gelten als aktuell). */
function parseModelVersion(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

export function compareModelVersions(left: string, right: string): number {
  const a = parseModelVersion(left);
  const b = parseModelVersion(right);
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

function predatesLeagueStrength(version: string): boolean {
  const parsed = parseModelVersion(version);
  if (!parsed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (parsed[index] !== FIRST_STRENGTH_MODEL_VERSION[index]) {
      return parsed[index]! < FIRST_STRENGTH_MODEL_VERSION[index];
    }
  }
  return false;
}

export interface DefenseBadgePerformanceRow {
  cohort: "verified" | "fallback" | "unmarked";
  teams: number;
  averageGoalsAgainst: number;
  cleanSheetRate: number;
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
        first_half_expected_home_goals REAL,
        first_half_expected_away_goals REAL,
        first_half_expected_total_goals REAL,
        first_half_data_confidence INTEGER,
        first_half_over05 REAL,
        first_half_under05 REAL,
        first_half_over15 REAL,
        first_half_under15 REAL,
        first_half_warnings_json TEXT,
        warnings_json TEXT NOT NULL,
        settled_at TEXT,
        actual_home_goals INTEGER,
        actual_away_goals INTEGER,
        actual_halftime_home_goals INTEGER,
        actual_halftime_away_goals INTEGER,
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
      -- Wiedervorlage der Abrechnung (seit 20.10.2026): verlegte, verschobene, abgebrochene und
      -- gewertete Spiele. next_check NULL = erledigt ohne Ergebnis (gewertet, abgesagt).
      CREATE TABLE IF NOT EXISTS settle_deferrals (
        fixture_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        next_check TEXT,
        checked_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fixture_expected_goals (
        fixture_id INTEGER PRIMARY KEY,
        kickoff TEXT NOT NULL,
        league_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        home_team_id INTEGER NOT NULL,
        away_team_id INTEGER NOT NULL,
        home_xg REAL,
        away_xg REAL,
        status TEXT NOT NULL CHECK(status IN ('available', 'unavailable')),
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fixture_expected_goals_league
        ON fixture_expected_goals(league_id, season, kickoff);
      CREATE TABLE IF NOT EXISTS fixture_results (
        fixture_id INTEGER PRIMARY KEY,
        kickoff TEXT NOT NULL,
        status TEXT NOT NULL,
        league_id INTEGER NOT NULL,
        country TEXT NOT NULL,
        league TEXT NOT NULL,
        season INTEGER NOT NULL,
        round TEXT,
        home_team_id INTEGER NOT NULL,
        away_team_id INTEGER NOT NULL,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        final_home_goals INTEGER NOT NULL,
        final_away_goals INTEGER NOT NULL,
        ht_home_goals INTEGER, ht_away_goals INTEGER,
        ft_home_goals INTEGER, ft_away_goals INTEGER,
        sh_home_goals INTEGER, sh_away_goals INTEGER,
        et_home_goals INTEGER, et_away_goals INTEGER,
        pen_home_goals INTEGER, pen_away_goals INTEGER,
        goals_ht1_home INTEGER, goals_ht1_away INTEGER,
        goals_ht2_home INTEGER, goals_ht2_away INTEGER,
        goals_et_home INTEGER, goals_et_away INTEGER,
        goals_complete INTEGER NOT NULL DEFAULT 0,
        yellow_ht1_home INTEGER, yellow_ht1_away INTEGER,
        yellow_ht2_home INTEGER, yellow_ht2_away INTEGER,
        red_ht1_home INTEGER, red_ht1_away INTEGER,
        red_ht2_home INTEGER, red_ht2_away INTEGER,
        subs_ht1_home INTEGER, subs_ht1_away INTEGER,
        subs_ht2_home INTEGER, subs_ht2_away INTEGER,
        home_possession REAL, away_possession REAL,
        home_shots INTEGER, away_shots INTEGER,
        home_shots_on_goal INTEGER, away_shots_on_goal INTEGER,
        home_corners INTEGER, away_corners INTEGER,
        home_xg REAL, away_xg REAL,
        home_possession_ht1 REAL, home_possession_ht2 REAL,
        away_possession_ht1 REAL, away_possession_ht2 REAL,
        home_shots_ht1 INTEGER, home_shots_ht2 INTEGER,
        away_shots_ht1 INTEGER, away_shots_ht2 INTEGER,
        home_shots_on_goal_ht1 INTEGER, home_shots_on_goal_ht2 INTEGER,
        away_shots_on_goal_ht1 INTEGER, away_shots_on_goal_ht2 INTEGER,
        home_corners_ht1 INTEGER, home_corners_ht2 INTEGER,
        away_corners_ht1 INTEGER, away_corners_ht2 INTEGER,
        home_formation TEXT, away_formation TEXT,
        home_coach TEXT, away_coach TEXT,
        goal_events_json TEXT,
        card_events_json TEXT,
        substitution_events_json TEXT,
        home_stats_json TEXT, away_stats_json TEXT,
        home_stats_ht1_json TEXT, home_stats_ht2_json TEXT,
        away_stats_ht1_json TEXT, away_stats_ht2_json TEXT,
        home_lineup_json TEXT, away_lineup_json TEXT,
        home_players_json TEXT, away_players_json TEXT,
        events_available INTEGER NOT NULL DEFAULT 0,
        stats_available INTEGER NOT NULL DEFAULT 0,
        lineups_available INTEGER NOT NULL DEFAULT 0,
        players_available INTEGER NOT NULL DEFAULT 0,
        half_stats_status TEXT,
        half_stats_fetched_at TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fixture_results_league
        ON fixture_results(league_id, season, kickoff);
      CREATE INDEX IF NOT EXISTS idx_fixture_results_kickoff
        ON fixture_results(kickoff);
      CREATE INDEX IF NOT EXISTS idx_fixture_results_home
        ON fixture_results(home_team_id, kickoff);
      CREATE INDEX IF NOT EXISTS idx_fixture_results_away
        ON fixture_results(away_team_id, kickoff);
      CREATE INDEX IF NOT EXISTS idx_fixture_results_half_todo
        ON fixture_results(half_stats_status, kickoff);
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
      -- Team-Elo (src/elo.ts). elo_matches ist die einzige Quelle; Historie und Ratings sind
      -- abgeleitet und werden bei jedem Aufbau vollständig neu geschrieben.
      CREATE TABLE IF NOT EXISTS elo_matches (
        fixture_id INTEGER PRIMARY KEY,
        kickoff INTEGER NOT NULL,
        league_id INTEGER NOT NULL,
        league_name TEXT NOT NULL,
        league_type TEXT,
        country TEXT NOT NULL,
        season INTEGER NOT NULL,
        home_id INTEGER NOT NULL,
        home_name TEXT NOT NULL,
        away_id INTEGER NOT NULL,
        away_name TEXT NOT NULL,
        home_goals INTEGER NOT NULL,
        away_goals INTEGER NOT NULL,
        source TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_elo_matches_league_season ON elo_matches(league_id, season);
      -- Zeitpunkte der automatischen Pflege (lastImport, lastTopUp) - src/elo-update.ts.
      CREATE TABLE IF NOT EXISTS elo_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_elo_matches_kickoff ON elo_matches(kickoff);
      CREATE TABLE IF NOT EXISTS elo_league_seasons (
        league_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        fixtures INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY(league_id, season)
      );
      CREATE TABLE IF NOT EXISTS elo_history (
        system TEXT NOT NULL,
        fixture_id INTEGER NOT NULL,
        kickoff INTEGER NOT NULL,
        league_id INTEGER NOT NULL,
        competition TEXT NOT NULL,
        home_id INTEGER NOT NULL,
        away_id INTEGER NOT NULL,
        home_goals INTEGER NOT NULL,
        away_goals INTEGER NOT NULL,
        home_elo_before REAL NOT NULL,
        away_elo_before REAL NOT NULL,
        home_expected REAL NOT NULL,
        away_expected REAL NOT NULL,
        result REAL NOT NULL,
        home_advantage REAL NOT NULL,
        time_decay REAL NOT NULL,
        competition_multiplier REAL NOT NULL,
        mov REAL NOT NULL,
        home_k REAL NOT NULL,
        away_k REAL NOT NULL,
        home_elo_after REAL NOT NULL,
        away_elo_after REAL NOT NULL,
        config_version TEXT NOT NULL,
        PRIMARY KEY(system, fixture_id)
      );
      CREATE INDEX IF NOT EXISTS idx_elo_history_home ON elo_history(system, home_id, kickoff);
      CREATE INDEX IF NOT EXISTS idx_elo_history_away ON elo_history(system, away_id, kickoff);
      CREATE TABLE IF NOT EXISTS elo_ratings (
        system TEXT NOT NULL,
        team_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        elo REAL NOT NULL,
        games INTEGER NOT NULL,
        last_change REAL NOT NULL,
        change_30 REAL NOT NULL,
        change_90 REAL NOT NULL,
        peak REAL NOT NULL,
        low REAL NOT NULL,
        trend TEXT NOT NULL,
        league TEXT,
        country TEXT,
        confidence REAL NOT NULL,
        last_played INTEGER NOT NULL,
        as_of INTEGER NOT NULL,
        config_version TEXT NOT NULL,
        PRIMARY KEY(system, team_id)
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
    // Liga-Mitnahme je Spiel (Review 24.09.2026) - vorher stand sie in keiner Zeile.
    const eloHistoryColumns = this.db.prepare("PRAGMA table_info(elo_history)").all() as Array<{ name: string }>;
    for (const column of ["home_shift", "away_shift"]) {
      if (!eloHistoryColumns.some((item) => item.name === column)) {
        this.db.exec(`ALTER TABLE elo_history ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`);
      }
    }
    const goalColumns = this.db.prepare("PRAGMA table_info(goal_line_predictions)").all() as Array<{ name: string }>;
    // strength_factor seit 05.10.2026: Ohne den Faktor lässt sich im Report nicht sagen, welche
    // Seite aus der stärkeren Liga kam - das Maß "Favorit trifft" verwechselte das.
    for (const column of [
      "home_probability", "draw_probability", "away_probability", "btts_probability",
      "strength_factor"
    ]) {
      if (!goalColumns.some((item) => item.name === column)) {
        this.db.exec(`ALTER TABLE goal_line_predictions ADD COLUMN ${column} REAL`);
      }
    }
    const halfTimeColumns: Array<[string, string]> = [
      ["first_half_expected_home_goals", "REAL"],
      ["first_half_expected_away_goals", "REAL"],
      ["first_half_expected_total_goals", "REAL"],
      ["first_half_data_confidence", "INTEGER"],
      ["first_half_over05", "REAL"],
      ["first_half_under05", "REAL"],
      ["first_half_over15", "REAL"],
      ["first_half_under15", "REAL"],
      ["first_half_warnings_json", "TEXT"],
      ["actual_halftime_home_goals", "INTEGER"],
      ["actual_halftime_away_goals", "INTEGER"]
    ];
    for (const [column, type] of halfTimeColumns) {
      if (!goalColumns.some((item) => item.name === column)) {
        this.db.exec(`ALTER TABLE goal_line_predictions ADD COLUMN ${column} ${type}`);
      }
    }
    for (const [column, type] of [
      ["home_defense_json", "TEXT"], ["away_defense_json", "TEXT"],
      ["actual_home_xg", "REAL"], ["actual_away_xg", "REAL"]
    ] as Array<[string, string]>) {
      if (!goalColumns.some((item) => item.name === column)) {
        this.db.exec(`ALTER TABLE goal_line_predictions ADD COLUMN ${column} ${type}`);
      }
    }
  }

  expectedGoalsForFixtures(fixtureIds: number[]): Map<number, FixtureExpectedGoals> {
    const result = new Map<number, FixtureExpectedGoals>();
    for (let offset = 0; offset < fixtureIds.length; offset += 500) {
      const ids = fixtureIds.slice(offset, offset + 500);
      if (!ids.length) continue;
      const rows = this.db.prepare(`SELECT * FROM fixture_expected_goals WHERE fixture_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<Record<string, unknown>>;
      for (const row of rows) result.set(Number(row.fixture_id), {
        fixtureId: Number(row.fixture_id), kickoff: String(row.kickoff), leagueId: Number(row.league_id),
        season: Number(row.season), homeTeamId: Number(row.home_team_id), awayTeamId: Number(row.away_team_id),
        homeXg: row.home_xg === null ? null : Number(row.home_xg), awayXg: row.away_xg === null ? null : Number(row.away_xg),
        status: row.status as FixtureExpectedGoals["status"], fetchedAt: String(row.fetched_at)
      });
    }
    return result;
  }

  saveFixtureExpectedGoals(rows: FixtureExpectedGoals[]): void {
    const statement = this.db.prepare(`INSERT INTO fixture_expected_goals(
      fixture_id,kickoff,league_id,season,home_team_id,away_team_id,home_xg,away_xg,status,fetched_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fixture_id) DO UPDATE SET
      home_xg=excluded.home_xg, away_xg=excluded.away_xg, status=excluded.status, fetched_at=excluded.fetched_at`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) statement.run(row.fixtureId,row.kickoff,row.leagueId,row.season,row.homeTeamId,row.awayTeamId,row.homeXg,row.awayXg,row.status,row.fetchedAt);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /**
   * Die Spalten von `fixture_results` ohne die Halbzeit-Statistik. Als Liste notiert, damit
   * Spaltenfolge und Platzhalter nicht auseinanderlaufen können.
   */
  private static readonly RESULT_COLUMNS = [
    "fixture_id", "kickoff", "status", "league_id", "country", "league", "season", "round",
    "home_team_id", "away_team_id", "home_team", "away_team",
    "final_home_goals", "final_away_goals",
    "ht_home_goals", "ht_away_goals", "ft_home_goals", "ft_away_goals",
    "sh_home_goals", "sh_away_goals", "et_home_goals", "et_away_goals",
    "pen_home_goals", "pen_away_goals",
    "goals_ht1_home", "goals_ht1_away", "goals_ht2_home", "goals_ht2_away",
    "goals_et_home", "goals_et_away", "goals_complete",
    "yellow_ht1_home", "yellow_ht1_away", "yellow_ht2_home", "yellow_ht2_away",
    "red_ht1_home", "red_ht1_away", "red_ht2_home", "red_ht2_away",
    "subs_ht1_home", "subs_ht1_away", "subs_ht2_home", "subs_ht2_away",
    "home_possession", "away_possession", "home_shots", "away_shots",
    "home_shots_on_goal", "away_shots_on_goal", "home_corners", "away_corners",
    "home_xg", "away_xg",
    "home_formation", "away_formation", "home_coach", "away_coach",
    "goal_events_json", "card_events_json", "substitution_events_json",
    "home_stats_json", "away_stats_json",
    "home_lineup_json", "away_lineup_json", "home_players_json", "away_players_json",
    "events_available", "stats_available", "lineups_available", "players_available",
    "source", "fetched_at"
  ] as const;

  /**
   * Schreibt die Ergebnisdaten einer Partie. Die Halbzeit-Statistik fasst diese Methode
   * bewusst nicht an - dafür gibt es `saveHalfStatistics`. So kann ein späterer Lauf aus dem
   * Cache, der keine Halbzeitwerte kennt, sie auch nicht versehentlich löschen.
   *
   * Eine vorhandene Zeile wird nur überschrieben, wenn die neue in **jeder** Hinsicht
   * mindestens so reich ist. Eine Kopie mit Ereignissen, aber ohne Statistik, verdrängt damit
   * keine vollständigere - lieber einmal zu wenig geschrieben als Daten verloren.
   */
  saveFixtureResults(rows: FixtureResult[]): void {
    const columns = AnalyzerDatabase.RESULT_COLUMNS;
    const assignments = columns
      .filter((column) => column !== "fixture_id")
      .map((column) => `${column}=excluded.${column}`)
      .join(",");
    const statement = this.db.prepare(`INSERT INTO fixture_results(${columns.join(",")})
      VALUES(${columns.map(() => "?").join(",")})
      ON CONFLICT(fixture_id) DO UPDATE SET ${assignments}
      WHERE excluded.events_available >= fixture_results.events_available
        AND excluded.stats_available >= fixture_results.stats_available
        AND excluded.lineups_available >= fixture_results.lineups_available
        AND excluded.players_available >= fixture_results.players_available`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) statement.run(...resultValues(row));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /**
   * Trägt die Statistik je Halbzeit nach. `status` hält fest, ob gefragt wurde und ob es
   * etwas gab - `unavailable` verhindert, dass der nächste Lauf dieselben Ligen ohne
   * Halbzeitdaten erneut abfragt und Budget verbrennt.
   */
  saveHalfStatistics(rows: Array<{
    fixtureId: number;
    status: "available" | "unavailable";
    fetchedAt: string;
    home?: { firstHalf: TeamHalfStats | null; secondHalf: TeamHalfStats | null };
    away?: { firstHalf: TeamHalfStats | null; secondHalf: TeamHalfStats | null };
  }>): void {
    const statement = this.db.prepare(`UPDATE fixture_results SET
      home_possession_ht1=?, home_possession_ht2=?, away_possession_ht1=?, away_possession_ht2=?,
      home_shots_ht1=?, home_shots_ht2=?, away_shots_ht1=?, away_shots_ht2=?,
      home_shots_on_goal_ht1=?, home_shots_on_goal_ht2=?,
      away_shots_on_goal_ht1=?, away_shots_on_goal_ht2=?,
      home_corners_ht1=?, home_corners_ht2=?, away_corners_ht1=?, away_corners_ht2=?,
      home_stats_ht1_json=?, home_stats_ht2_json=?,
      away_stats_ht1_json=?, away_stats_ht2_json=?,
      half_stats_status=?, half_stats_fetched_at=?
      WHERE fixture_id=?`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const h1 = row.home?.firstHalf ?? null;
        const h2 = row.home?.secondHalf ?? null;
        const a1 = row.away?.firstHalf ?? null;
        const a2 = row.away?.secondHalf ?? null;
        statement.run(
          h1?.possession ?? null, h2?.possession ?? null,
          a1?.possession ?? null, a2?.possession ?? null,
          h1?.shots ?? null, h2?.shots ?? null, a1?.shots ?? null, a2?.shots ?? null,
          h1?.shotsOnGoal ?? null, h2?.shotsOnGoal ?? null,
          a1?.shotsOnGoal ?? null, a2?.shotsOnGoal ?? null,
          h1?.corners ?? null, h2?.corners ?? null, a1?.corners ?? null, a2?.corners ?? null,
          h1 ? JSON.stringify(h1) : null, h2 ? JSON.stringify(h2) : null,
          a1 ? JSON.stringify(a1) : null, a2 ? JSON.stringify(a2) : null,
          row.status, row.fetchedAt, row.fixtureId
        );
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /**
   * Partien, für die die Halbzeit-Statistik noch aussteht: neueste zuerst, und nur solche mit
   * Statistik überhaupt - ohne sie gibt es auch keine Halbzeitwerte, der Aufruf wäre verschenkt.
   */
  fixturesMissingHalfStatistics(limit: number): Array<{
    fixtureId: number; homeTeamId: number; awayTeamId: number;
  }> {
    const rows = this.db.prepare(`SELECT fixture_id, home_team_id, away_team_id
      FROM fixture_results
      WHERE half_stats_status IS NULL AND stats_available = 1
      ORDER BY kickoff DESC LIMIT ?`).all(limit) as Array<{
        fixture_id: number; home_team_id: number; away_team_id: number;
      }>;
    // Die Mannschaften kommen mit, damit der Nachtrag die beiden Statistikblöcke über die
    // Team-Kennung zuordnet statt über ihre Reihenfolge in der Antwort.
    return rows.map((row) => ({
      fixtureId: row.fixture_id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id
    }));
  }

  countFixturesMissingHalfStatistics(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS offen FROM fixture_results
      WHERE half_stats_status IS NULL AND stats_available = 1`).get() as { offen: number };
    return row.offen;
  }

  /**
   * Alle je abgerechneten Partien, neueste zuerst. Grundlage des Nachtrags: Nur für diese
   * Partien liegt überhaupt eine Antwort im Cache, weil nur sie je abgefragt wurden.
   */
  /**
   * Führt eine Liga Karten in ihren Ereignislisten? Je `Land|Liga` (siehe `leagueKey` in
   * `src/dashboard.ts`), nur Ligen mit mindestens 20 beendeten Spielen samt Ereignissen. Unter
   * einer Gelben je Spiel im Mittel gilt: keine Kartendaten. Prüfung vom 29.09.2026: 31 von 209
   * Ligen (etwa National League North/South, Liga Leumit) tragen Tore, aber keine Karten ein -
   * dort hieße „0 Karten“ sonst „keine Karte“ statt „unbekannt“.
   */
  cardDataByLeague(minimumMatches = 20): Map<string, boolean> {
    const rows = this.db.prepare(`
      SELECT country, league, COUNT(*) AS matches,
        AVG(yellow_ht1_home + yellow_ht1_away + yellow_ht2_home + yellow_ht2_away) AS yellow
      FROM fixture_results
      WHERE events_available = 1 AND yellow_ht1_home IS NOT NULL
      GROUP BY country, league
      HAVING COUNT(*) >= ?
    `).all(minimumMatches) as Array<{ country: string; league: string; yellow: number }>;
    return new Map(rows.map((row) => [`${row.country}|${row.league}`, row.yellow >= 1]));
  }

  settledFixtureIds(): number[] {
    const rows = this.db.prepare(`
      SELECT fixture_id, MAX(kickoff) AS kickoff FROM (
        SELECT fixture_id, kickoff FROM candidates WHERE settled_at IS NOT NULL
        UNION ALL
        SELECT fixture_id, kickoff FROM profile_predictions WHERE settled_at IS NOT NULL
        UNION ALL
        SELECT fixture_id, kickoff FROM goal_line_predictions WHERE settled_at IS NOT NULL
      )
      GROUP BY fixture_id
      ORDER BY kickoff DESC, fixture_id DESC
    `).all() as Array<{ fixture_id: number }>;
    return rows.map((row) => row.fixture_id);
  }

  /**
   * Torschüsse, Ecken, Schüsse gesamt, Ballbesitz und xG beider Seiten für die gefragten
   * Partien, soweit gespeichert. Grundlage der Spalten "Schüsse aufs Tor" und "Ecken" und der
   * Spielbild-Kriterien des Remis-Scores.
   *
   * Auch Partien **ohne** Statistik kommen zurück, kenntlich an `statsAvailable`. Sonst
   * gälten sie als unbekannt und würden bei jedem Lauf erneut geholt - gemessen am
   * 22.09.2026 betraf das 147 von 391 Vorspielen, also acht verschenkte Aufrufe je Lauf.
   * Ob ein solcher Eintrag noch einmal gefragt wird, entscheidet der Aufrufer.
   */
  recentStatsForFixtures(fixtureIds: number[]): Map<number, StoredRecentStats> {
    const result = new Map<number, StoredRecentStats>();
    for (let offset = 0; offset < fixtureIds.length; offset += 500) {
      const ids = fixtureIds.slice(offset, offset + 500);
      if (!ids.length) continue;
      // xG steht in fixture_results nur, wenn die Statistik es trug; der xG-Erstaufbau
      // (`fixture_expected_goals`) kennt weitere Partien und springt dann ein.
      const rows = this.db.prepare(`SELECT r.fixture_id, r.kickoff, r.fetched_at, r.stats_available,
          r.home_shots_on_goal, r.away_shots_on_goal, r.home_corners, r.away_corners,
          r.home_shots, r.away_shots, r.home_possession, r.away_possession,
          COALESCE(r.home_xg, x.home_xg) AS home_xg, COALESCE(r.away_xg, x.away_xg) AS away_xg
        FROM fixture_results r
        LEFT JOIN fixture_expected_goals x ON x.fixture_id = r.fixture_id AND x.status = 'available'
        WHERE r.fixture_id IN (${ids.map(() => "?").join(",")})`)
        .all(...ids) as Array<Record<string, number | string | null>>;
      for (const row of rows) {
        result.set(Number(row.fixture_id), {
          home: {
            shotsOnGoal: row.home_shots_on_goal as number | null,
            corners: row.home_corners as number | null,
            shots: row.home_shots as number | null,
            possession: row.home_possession as number | null,
            xg: row.home_xg as number | null
          },
          away: {
            shotsOnGoal: row.away_shots_on_goal as number | null,
            corners: row.away_corners as number | null,
            shots: row.away_shots as number | null,
            possession: row.away_possession as number | null,
            xg: row.away_xg as number | null
          },
          statsAvailable: row.stats_available === 1,
          kickoff: String(row.kickoff),
          fetchedAt: String(row.fetched_at)
        });
      }
    }
    return result;
  }

  fixtureResult(fixtureId: number): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM fixture_results WHERE fixture_id=?")
      .get(fixtureId) as Record<string, unknown> | undefined;
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
        AND julianday(excluded.snapshot_at) < julianday(excluded.kickoff)
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
        // Als Zeitpunkt vergleichen: Anstoßzeiten stehen teils als "…+02:00", Snapshots als
        // "…Z" - als Text verglichen kamen bis 05.10.2026 Prognosen bis 2 Stunden nach Anpfiff durch.
        if (Date.parse(snapshotAt) >= Date.parse(row.kickoff)) continue;
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

  /** Die gespeicherten Prognosen für den Nachtrag des Stärkefaktors. */
  strengthFactorRows(): Array<{ fixtureId: number; modelVersion: string; snapshotAt: string; strengthFactor: number | null }> {
    return (this.db.prepare(`
      SELECT fixture_id, model_version, snapshot_at, strength_factor FROM goal_line_predictions
    `).all() as Array<{ fixture_id: number; model_version: string; snapshot_at: string; strength_factor: number | null }>)
      .map((row) => ({
        fixtureId: row.fixture_id,
        modelVersion: row.model_version,
        snapshotAt: row.snapshot_at,
        strengthFactor: row.strength_factor
      }));
  }

  /**
   * Trägt den Stärkefaktor einer älteren Prognose aus ihrem Snapshot nach
   * (`tools/backfill-strength-factor.ts`). Ohne `overwrite` bleibt ein vorhandener Wert stehen.
   */
  backfillStrengthFactor(fixtureId: number, modelVersion: string, factor: number, overwrite = false): boolean {
    const result = this.db.prepare(`
      UPDATE goal_line_predictions SET strength_factor = ?
      WHERE fixture_id = ? AND model_version = ?
        AND (strength_factor IS NULL OR (? = 1 AND strength_factor <> ?))
    `).run(factor, fixtureId, modelVersion, overwrite ? 1 : 0, factor);
    return Number(result.changes) > 0;
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
        over15, under15, over25, under25, over35, under35,
        first_half_expected_home_goals, first_half_expected_away_goals,
        first_half_expected_total_goals, first_half_data_confidence,
        first_half_over05, first_half_under05, first_half_over15, first_half_under15,
        first_half_warnings_json, warnings_json, home_defense_json, away_defense_json,
        strength_factor
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
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
        first_half_expected_home_goals = excluded.first_half_expected_home_goals,
        first_half_expected_away_goals = excluded.first_half_expected_away_goals,
        first_half_expected_total_goals = excluded.first_half_expected_total_goals,
        first_half_data_confidence = excluded.first_half_data_confidence,
        first_half_over05 = excluded.first_half_over05,
        first_half_under05 = excluded.first_half_under05,
        first_half_over15 = excluded.first_half_over15,
        first_half_under15 = excluded.first_half_under15,
        first_half_warnings_json = excluded.first_half_warnings_json,
        warnings_json = excluded.warnings_json,
        home_defense_json = excluded.home_defense_json,
        away_defense_json = excluded.away_defense_json,
        strength_factor = excluded.strength_factor
      WHERE goal_line_predictions.settled_at IS NULL
        AND julianday(excluded.snapshot_at) < julianday(excluded.kickoff)
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
        // Als Zeitpunkt vergleichen: Anstoßzeiten stehen teils als "…+02:00", Snapshots als
        // "…Z" - als Text verglichen kamen bis 05.10.2026 Prognosen bis 2 Stunden nach Anpfiff durch.
        if (Date.parse(snapshotAt) >= Date.parse(row.kickoff)) continue;
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
          row.firstHalf.expectedHomeGoals,
          row.firstHalf.expectedAwayGoals,
          row.firstHalf.expectedTotalGoals,
          row.firstHalf.dataConfidence,
          row.firstHalf.probabilities.over05,
          row.firstHalf.probabilities.under05,
          row.firstHalf.probabilities.over15,
          row.firstHalf.probabilities.under15,
          JSON.stringify(row.firstHalf.warnings),
          JSON.stringify(row.warnings),
          JSON.stringify(row.defense?.home ?? null),
          JSON.stringify(row.defense?.away ?? null),
          row.strength?.factor ?? null
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
    // Fällig erst 110 Minuten nach Anpfiff: Früher ist kein Spiel beendet, und die Abrechnung
    // holt es frisch aus dem Netz - der Aufruf wäre verloren. Bis 05.10.2026 verzögerte der
    // Textvergleich mit "…+02:00" das zufällig um 2 Stunden; ohne ihn kostete es im Schnitt
    // rund 7 Aufrufe je Analyse, an vollen Spieltagen bis 55 (Prüfung vom 05.10.2026).
    const cutoff = new Date(now.getTime() - UNSETTLED_MIN_AGE_MS).toISOString();
    // Zurückgestellte Spiele erst zu ihrer Wiedervorlage, erledigte nie mehr (`deferSettlement`).
    const rows = this.db.prepare(`
      SELECT fixture_id, MAX(kickoff) AS kickoff FROM (
        SELECT fixture_id, kickoff
        FROM candidates
        WHERE settled_at IS NULL AND julianday(kickoff) < julianday(?)
        UNION ALL
        SELECT fixture_id, kickoff
        FROM profile_predictions
        WHERE settled_at IS NULL AND julianday(kickoff) < julianday(?)
        UNION ALL
        SELECT fixture_id, kickoff
        FROM goal_line_predictions
        WHERE settled_at IS NULL AND julianday(kickoff) < julianday(?)
      ) AS due
      WHERE NOT EXISTS (
        SELECT 1 FROM settle_deferrals d WHERE d.fixture_id = due.fixture_id
          AND (d.next_check IS NULL OR julianday(d.next_check) > julianday(?))
      )
      GROUP BY fixture_id
      ORDER BY kickoff DESC, fixture_id DESC
    `).all(cutoff, cutoff, cutoff, now.toISOString()) as Array<{ fixture_id: number }>;
    return rows.map((row) => row.fixture_id);
  }

  /** Abrechnung zurückstellen; `nextCheck` null = erledigt ohne Ergebnis. */
  deferSettlement(fixtureId: number, status: string, nextCheck: string | null, checkedAt: string): void {
    this.db.prepare(`INSERT INTO settle_deferrals(fixture_id, status, next_check, checked_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(fixture_id) DO UPDATE SET status = excluded.status, next_check = excluded.next_check,
        checked_at = excluded.checked_at`).run(fixtureId, status, nextCheck, checkedAt);
  }

  settleFixture(fixture: ApiFixture, actualXg?: { home: number | null; away: number | null }): number {
    const status = fixture.fixture.status.short;
    if (!["FT", "AET", "PEN"].includes(status)) return 0;
    const apiHome = fixture.score.fulltime?.home ?? fixture.goals.home;
    const apiAway = fixture.score.fulltime?.away ?? fixture.goals.away;
    if (apiHome === null || apiAway === null) return 0;
    // API-Football dreht gelegentlich nachträglich Heim und Gast (Senegal - Mozambique wurde
    // am 26.09.2026 zu Mozambique - Senegal, dazu PSG - Rennes). Die Prognosen stehen in der
    // Ausrichtung zum Zeitpunkt der Analyse, und nur Teamnamen sind gespeichert. Steht das
    // Paar gespiegelt da, werden auch Tore, Pausenstand und xG gespiegelt - sonst würde ein
    // Heimsieg als Auswärtssieg abgerechnet.
    const swappedFor = (storedHome: string, storedAway: string) =>
      storedHome !== storedAway
      && storedHome === fixture.teams.away.name
      && storedAway === fixture.teams.home.name;
    const scoreFor = (storedHome: string, storedAway: string) => swappedFor(storedHome, storedAway)
      ? { home: apiAway, away: apiHome, halfHome: fixture.score.halftime?.away ?? null, halfAway: fixture.score.halftime?.home ?? null, xgHome: actualXg?.away ?? null, xgAway: actualXg?.home ?? null }
      : { home: apiHome, away: apiAway, halfHome: fixture.score.halftime?.home ?? null, halfAway: fixture.score.halftime?.away ?? null, xgHome: actualXg?.home ?? null, xgAway: actualXg?.away ?? null };
    const rows = this.db.prepare(`
      SELECT id, market, selection, probability, home_team, away_team
      FROM candidates
      WHERE fixture_id = ? AND settled_at IS NULL
    `).all(fixture.fixture.id) as Array<{
      id: number;
      market: Market;
      selection: string;
      probability: number;
      home_team: string;
      away_team: string;
    }>;
    const update = this.db.prepare(`
      UPDATE candidates
      SET settled_at = ?, actual_home_goals = ?, actual_away_goals = ?, hit = ?, brier = ?
      WHERE id = ?
    `);
    for (const row of rows) {
      const { home, away } = scoreFor(row.home_team, row.away_team);
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
      SELECT id, market, selection, home_team, away_team
      FROM profile_predictions
      WHERE fixture_id = ? AND settled_at IS NULL
    `).all(fixture.fixture.id) as Array<{
      id: number;
      market: "draw" | "1x2";
      selection: "X" | "1" | "2";
      home_team: string;
      away_team: string;
    }>;
    const updateProfile = this.db.prepare(`
      UPDATE profile_predictions
      SET settled_at = ?, actual_home_goals = ?, actual_away_goals = ?, hit = ?
      WHERE id = ?
    `);
    for (const row of profileRows) {
      const { home, away } = scoreFor(row.home_team, row.away_team);
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
    const goalLineRows = this.db.prepare(`
      SELECT id, home_team, away_team
      FROM goal_line_predictions
      WHERE fixture_id = ? AND settled_at IS NULL
    `).all(fixture.fixture.id) as Array<{ id: number; home_team: string; away_team: string }>;
    const updateGoalLine = this.db.prepare(`
      UPDATE goal_line_predictions
      SET settled_at = ?, actual_home_goals = ?, actual_away_goals = ?,
          actual_halftime_home_goals = ?, actual_halftime_away_goals = ?,
          actual_home_xg = ?, actual_away_xg = ?
      WHERE id = ?
    `);
    for (const row of goalLineRows) {
      const score = scoreFor(row.home_team, row.away_team);
      updateGoalLine.run(
        new Date().toISOString(),
        score.home,
        score.away,
        score.halfHome,
        score.halfAway,
        score.xgHome,
        score.xgAway,
        row.id
      );
    }
    return rows.length + profileRows.length + goalLineRows.length;
  }

  defenseBadgeReport(): DefenseBadgePerformanceRow[] {
    const rows = this.db.prepare(`SELECT home_defense_json, away_defense_json,
      actual_home_goals, actual_away_goals FROM goal_line_predictions
      WHERE settled_at IS NOT NULL AND actual_home_goals IS NOT NULL AND actual_away_goals IS NOT NULL`).all() as Array<{
        home_defense_json: string | null; away_defense_json: string | null;
        actual_home_goals: number; actual_away_goals: number;
      }>;
    const samples = rows.flatMap((row) => [
      { json: row.home_defense_json, against: row.actual_away_goals },
      { json: row.away_defense_json, against: row.actual_home_goals }
    ]).map((sample) => {
      let profile: { badge?: string; strong?: boolean } | null = null;
      try { profile = sample.json ? JSON.parse(sample.json) as { badge?: string; strong?: boolean } : null; } catch { profile = null; }
      const cohort: DefenseBadgePerformanceRow["cohort"] = profile?.badge === "verified"
        ? "verified" : profile?.badge === "fallback" || (profile?.strong && !profile.badge) ? "fallback" : "unmarked";
      return { cohort, against: sample.against };
    });
    return (["verified", "fallback", "unmarked"] as const).flatMap((cohort) => {
      const group = samples.filter((sample) => sample.cohort === cohort);
      return group.length ? [{ cohort, teams: group.length,
        averageGoalsAgainst: group.reduce((sum, sample) => sum + sample.against, 0) / group.length,
        cleanSheetRate: group.filter((sample) => sample.against === 0).length / group.length }] : [];
    });
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
             first_half_over05, first_half_under05, first_half_over15, first_half_under15,
             actual_home_goals, actual_away_goals,
             actual_halftime_home_goals, actual_halftime_away_goals
      FROM goal_line_predictions
      WHERE settled_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM goal_line_prediction_scopes scope
          WHERE scope.prediction_id = goal_line_predictions.id
        )
    `).all() as Array<{
      model_version: string;
      over15: number | null;
      under15: number | null;
      over25: number | null;
      under25: number | null;
      over35: number | null;
      under35: number | null;
      first_half_over05: number | null;
      first_half_under05: number | null;
      first_half_over15: number | null;
      first_half_under15: number | null;
      actual_home_goals: number | null;
      actual_away_goals: number | null;
      actual_halftime_home_goals: number | null;
      actual_halftime_away_goals: number | null;
    }>;
    if (rows.length === 0) return [];
    type ProbabilityKey = "over15" | "under15" | "over25" | "under25" | "over35" | "under35" |
      "first_half_over05" | "first_half_under05" | "first_half_over15" | "first_half_under15";
    const definitions: Array<{
      period: GoalLinePerformanceRow["period"];
      line: GoalLinePerformanceRow["line"];
      direction: GoalLinePerformanceRow["direction"];
      probability: ProbabilityKey;
      threshold: number;
    }> = [
      { period: "fulltime", line: "1.5", direction: "over", probability: "over15", threshold: 2 },
      { period: "fulltime", line: "1.5", direction: "under", probability: "under15", threshold: 2 },
      { period: "fulltime", line: "2.5", direction: "over", probability: "over25", threshold: 3 },
      { period: "fulltime", line: "2.5", direction: "under", probability: "under25", threshold: 3 },
      { period: "fulltime", line: "3.5", direction: "over", probability: "over35", threshold: 4 },
      { period: "fulltime", line: "3.5", direction: "under", probability: "under35", threshold: 4 },
      { period: "first-half", line: "0.5", direction: "over", probability: "first_half_over05", threshold: 1 },
      { period: "first-half", line: "0.5", direction: "under", probability: "first_half_under05", threshold: 1 },
      { period: "first-half", line: "1.5", direction: "over", probability: "first_half_over15", threshold: 2 },
      { period: "first-half", line: "1.5", direction: "under", probability: "first_half_under15", threshold: 2 }
    ];
    const versions = [...new Set(rows.map((row) => row.model_version))].sort();
    return versions.flatMap((modelVersion) => {
      const versionRows = rows.filter((row) => row.model_version === modelVersion);
      return definitions.flatMap((definition) => {
        const usableRows = versionRows.filter((row) => {
          if (row[definition.probability] === null) return false;
          return definition.period === "fulltime"
            ? row.actual_home_goals !== null && row.actual_away_goals !== null
            : row.actual_halftime_home_goals !== null && row.actual_halftime_away_goals !== null;
        });
        if (usableRows.length === 0) return [];
        let hits = 0;
        let probabilityTotal = 0;
        let brierTotal = 0;
        for (const row of usableRows) {
          const totalGoals = definition.period === "fulltime"
            ? row.actual_home_goals! + row.actual_away_goals!
            : row.actual_halftime_home_goals! + row.actual_halftime_away_goals!;
          const over = totalGoals >= definition.threshold;
          const hit = definition.direction === "over" ? over : !over;
          const probability = row[definition.probability]!;
          const outcome = hit ? 1 : 0;
          hits += outcome;
          probabilityTotal += probability;
          brierTotal += (probability - outcome) ** 2;
        }
        const [intervalLow, intervalHigh] = wilsonInterval(hits, usableRows.length);
        return [{
          modelVersion,
          period: definition.period,
          line: definition.line,
          direction: definition.direction,
          total: usableRows.length,
          hits,
          hitRate: hits / usableRows.length,
          averageProbability: usableRows.length
            ? probabilityTotal / usableRows.length
            : 0,
          brierScore: usableRows.length ? brierTotal / usableRows.length : 0,
          intervalLow,
          intervalHigh
        }];
      });
    });
  }

  /**
   * Je abgerechnetem Spiel die neueste Prognose mit Gruppe, Modellfavorit und der Seite aus der
   * stärkeren Liga. Grundlage für `leagueStrengthReport` und `strongerSideByVersion`.
   */
  private leagueStrengthSamples(): Array<{
    cohort: LeagueStrengthPerformanceRow["cohort"];
    modelVersion: string;
    hit: boolean;
    probability: number;
    brier: number;
    stronger: { won: boolean; probability: number } | null;
  }> {
    const allRows = this.db.prepare(`
      SELECT fixture_id, model_version, home_probability, draw_probability, away_probability,
             actual_home_goals, actual_away_goals, warnings_json, strength_factor
      FROM goal_line_predictions
      WHERE settled_at IS NOT NULL
        AND actual_home_goals IS NOT NULL
        AND actual_away_goals IS NOT NULL
        AND home_probability IS NOT NULL
        AND draw_probability IS NOT NULL
        AND away_probability IS NOT NULL
    `).all() as Array<{
      fixture_id: number;
      model_version: string;
      home_probability: number;
      draw_probability: number;
      away_probability: number;
      actual_home_goals: number;
      actual_away_goals: number;
      warnings_json: string;
      strength_factor: number | null;
    }>;
    // Je Spiel nur die neueste Modellversion: Sonst zählt ein Spiel, das mehrere Fassungen
    // gesehen hat, mehrfach, und die Standardfehler werden zu klein (Prüfung vom 05.10.2026:
    // 516 Zeilen "gemessen" waren 397 Spiele).
    const newest = new Map<number, (typeof allRows)[number]>();
    for (const row of allRows) {
      const existing = newest.get(row.fixture_id);
      if (!existing || compareModelVersions(row.model_version, existing.model_version) > 0) {
        newest.set(row.fixture_id, row);
      }
    }
    const cohortOf = (warnings: string, modelVersion: string): LeagueStrengthPerformanceRow["cohort"] => {
      // Fassungen vor 3.1.0 kannten die Ligastärke nicht, trugen aber schon die
      // Cross-League-Warnung. Bis 05.10.2026 landeten sie in "gemessen" - 310 von 516 Zeilen,
      // und auf dieser Grundlage wurde am 02.09.2026 der Teiler von 900 auf 1500 gesetzt.
      if (/Cross-League/.test(warnings) && predatesLeagueStrength(modelVersion)) return "vor Ligastärke";
      if (/Kein Ligastärke-Vergleich/.test(warnings)) return "ohne Rating";
      if (/Team-Elo der U21-Nationalteams/.test(warnings)) return "Team-Elo U21";
      if (/Team-Elo der Nationalteams/.test(warnings)) return "Team-Elo";
      if (/aus derselben Liga/.test(warnings)) return "gleiche Liga";
      if (/geschätzt statt gemessen/.test(warnings)) return "geschätzt";
      if (/Cross-League/.test(warnings)) return "gemessen";
      return "Ligapartie";
    };
    return [...newest.values()].map((row) => {
      const probabilities = [row.home_probability, row.draw_probability, row.away_probability];
      const actual = row.actual_home_goals > row.actual_away_goals
        ? 0
        : row.actual_home_goals === row.actual_away_goals ? 1 : 2;
      const predicted = probabilities.indexOf(Math.max(...probabilities));
      const factor = row.strength_factor;
      return {
        cohort: cohortOf(row.warnings_json ?? "", row.model_version),
        modelVersion: row.model_version,
        hit: predicted === actual,
        probability: probabilities[predicted]!,
        brier: probabilities.reduce(
          (sum, probability, index) => sum + (probability - (index === actual ? 1 : 0)) ** 2,
          0
        ),
        // Faktor > 1: Heim aus der stärkeren Liga (Heimtore mal Faktor), < 1: Gast. Faktor 1
        // (gleiche Liga) und fehlender Faktor tragen keine stärkere Seite.
        stronger: factor !== null && factor !== 1
          ? factor > 1
            ? { won: actual === 0, probability: row.home_probability }
            : { won: actual === 2, probability: row.away_probability }
          : null
      };
    });
  }

  /**
   * Kalibrierung der 1X2-Wahrscheinlichkeit danach aufgeschlüsselt, wie gut die Ligastärke der
   * Partie bekannt war. Je Spiel zählt die neueste Modellversion; mit `modelVersion` nur Spiele,
   * deren neueste Prognose aus dieser Fassung stammt.
   * "Favorit trifft" vergleicht den Modellfavoriten mit seiner Prognose. Für den Teiler
   * (`strength.factorDivisor`) maßgeblich ist aber die Seite aus der stärkeren Liga
   * (`stronger*`): Der Modellfavorit ist bei Spielen zwischen Ligen oft die schwächere Liga.
   * Positiv heißt dort: Der Klassenunterschied wird unterschätzt.
   */
  /**
   * `modelVersion`: nur genau diese Fassung. `sinceVersion`: diese und alle späteren - für
   * Gruppen, die über mehrere Fassungen gleich rechnen (`STRENGTH_COMPARABLE_SINCE`).
   */
  leagueStrengthReport(options: { modelVersion?: string; sinceVersion?: string } = {}): LeagueStrengthPerformanceRow[] {
    const samples = this.leagueStrengthSamples()
      .filter((sample) => options.modelVersion === undefined || sample.modelVersion === options.modelVersion)
      .filter((sample) => options.sinceVersion === undefined ||
        compareModelVersions(sample.modelVersion, options.sinceVersion) >= 0);
    const order: Array<LeagueStrengthPerformanceRow["cohort"]> =
      ["Ligapartie", "gemessen", "geschätzt", "Team-Elo", "Team-Elo U21", "gleiche Liga", "ohne Rating", "vor Ligastärke"];
    return order.flatMap((cohort) => {
      const group = samples.filter((sample) => sample.cohort === cohort);
      if (group.length === 0) return [];
      const hits = group.filter((sample) => sample.hit).length;
      const [intervalLow, intervalHigh] = wilsonInterval(hits, group.length);
      const averageProbability = group.reduce((sum, sample) => sum + sample.probability, 0) / group.length;
      const hitRate = hits / group.length;
      return [{
        cohort,
        total: group.length,
        hits,
        hitRate,
        averageProbability,
        // Positiv heißt: Der Favorit gewinnt öfter als vorhergesagt.
        bias: hitRate - averageProbability,
        brierScore: group.reduce((sum, sample) => sum + sample.brier, 0) / group.length,
        intervalLow,
        intervalHigh,
        ...strongerSummary(group.flatMap((sample) => sample.stronger ? [sample.stronger] : []))
      }];
    });
  }

  /**
   * Die Seite aus der stärkeren Liga je Gruppe und Modellversion. Jede Fassung rechnet mit ihrem
   * eigenen Teiler (3.1.0 meist 900, 3.2.0-3.4.0 1500, ab 3.5.0 1200) - über Fassungen gemittelt
   * misst die Zahl keinen davon (Prüfung vom 05.10.2026).
   */
  strongerSideByVersion(): StrongerSideVersionRow[] {
    const samples = this.leagueStrengthSamples().filter((sample) => sample.stronger !== null);
    const keys = [...new Set(samples.map((sample) => `${sample.cohort}|${sample.modelVersion}`))];
    return keys
      .map((key) => {
        const [cohort, modelVersion] = key.split("|") as [LeagueStrengthPerformanceRow["cohort"], string];
        const group = samples.filter((sample) => sample.cohort === cohort && sample.modelVersion === modelVersion);
        const summary = strongerSummary(group.map((sample) => sample.stronger!));
        return {
          cohort,
          modelVersion,
          total: summary.strongerTotal,
          winRate: summary.strongerWinRate,
          predicted: summary.strongerPredicted,
          standardError: summary.strongerStandardError
        };
      })
      .sort((left, right) => left.cohort.localeCompare(right.cohort) ||
        compareModelVersions(left.modelVersion, right.modelVersion));
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

  /**
   * Ersetzt alle Liga-Ratings in einem Zug. Der Aufbau rechnet sie ohnehin vollständig aus
   * `strength_matches` neu; ein bloßes Überschreiben ließe Zeilen stehen, die es nicht mehr
   * gibt - etwa Frauenligen im Pool "uefa" nach deren Umzug in "uefa:women".
   */
  replaceLeagueStrength(snapshots: LeagueStrengthSnapshot[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM league_strength_snapshots");
      for (const snapshot of snapshots) this.saveLeagueStrength(snapshot);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Legt gespeicherte Pokalduelle in einen anderen Pool (einmalige Trennung der Frauen). */
  moveStrengthMatches(fixtureIds: number[], pool: string): number {
    const statement = this.db.prepare("UPDATE strength_matches SET pool = ? WHERE fixture_id = ?");
    let moved = 0;
    for (const fixtureId of fixtureIds) moved += Number(statement.run(pool, fixtureId).changes);
    return moved;
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

  /**
   * Ob eine Pokalsaison fertig geladen ist. Mit `seasonEnd` gilt eine Markierung nur, wenn sie
   * nach dem heutigen Saisonende gesetzt wurde: API-Football schiebt `end` mit jeder neu
   * angesetzten Runde nach hinten, eine ältere Markierung stammt dann aus einer Zeit, in der
   * die Saison nur scheinbar vorbei war (EFL Trophy 2026: markiert 21.09., Ende jetzt 24.11.).
   */
  isStrengthSeasonComplete(competitionId: number, season: number, seasonEnd?: string): boolean {
    const row = this.db.prepare(`
      SELECT completed_at
      FROM strength_build_progress
      WHERE competition_id = ? AND season = ?
    `).get(competitionId, season) as { completed_at: string } | undefined;
    if (!row) return false;
    if (seasonEnd === undefined) return true;
    const end = Date.parse(seasonEnd);
    return !Number.isFinite(end) || Date.parse(row.completed_at) >= end;
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
      WHERE pool = ? AND league_id = ? AND season <= ? AND julianday(as_of) < julianday(?)
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

  /**
   * Schwächstes belastbares Ligarating eines Pools. Dient als Untergrenze für Ligen ohne
   * eigenes Rating: die tauchen in der Elo-Kette nicht auf, weil sie unterklassig sind.
   */
  getPoolRatingFloor(pool: string, season: number, cutoff: string): number | null {
    const rows = this.db.prepare(`
      SELECT league_id, season, rating FROM (
        SELECT
          league_id,
          season,
          rating,
          ROW_NUMBER() OVER (
            PARTITION BY league_id ORDER BY season DESC, as_of DESC
          ) AS position
        FROM league_strength_snapshots
        WHERE pool = ? AND season <= ? AND julianday(as_of) < julianday(?) AND reliable = 1
      )
      WHERE position = 1
    `).all(pool, season, cutoff) as Array<{
      league_id: number;
      season: number;
      rating: number;
    }>;
    if (rows.length === 0) return null;
    return Math.min(...rows.map((row) =>
      1500 + (row.rating - 1500) * 0.8 ** Math.max(0, season - row.season)
    ));
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

  /** Für einen übersprungenen Wettbewerb: Eine alte Zuordnung darf nicht stehen bleiben. */
  clearTipicoCompetitionMapping(tipicoCompetitionId: number): void {
    this.db.prepare(`
      UPDATE tipico_competitions SET
        api_league_id = NULL, api_country_name = NULL, api_league_name = NULL, mapping_source = NULL
      WHERE tipico_competition_id = ?
    `).run(tipicoCompetitionId);
  }

  /** Die API-Liga-ID zu einem Wettbewerb, wie ihn die Analyse nennt (Land und Liga von API-Football). */
  apiLeagueIdByName(country: string, league: string): number | null {
    const row = this.db.prepare(`SELECT api_league_id FROM tipico_competitions
      WHERE api_country_name = ? AND api_league_name = ? AND api_league_id IS NOT NULL LIMIT 1`)
      .get(country, league) as { api_league_id: number } | undefined;
    return row?.api_league_id ?? null;
  }

  /** Die API-Fixture je Tipico-Ereignis, soweit die Analyse sie zugeordnet hat. */
  apiFixtureIdsForTipicoEvents(eventIds: string[]): Map<string, number> {
    const statement = this.db.prepare("SELECT api_fixture_id FROM tipico_fixtures WHERE tipico_event_id = ? AND api_fixture_id IS NOT NULL");
    const result = new Map<string, number>();
    for (const eventId of eventIds) {
      const row = statement.get(eventId) as { api_fixture_id: number } | undefined;
      if (row) result.set(eventId, row.api_fixture_id);
    }
    return result;
  }

  /**
   * Die Tipico-Teamnamen und den Tipico-Wettbewerb je API-Fixture, jeweils vom zuletzt gesehenen
   * Ereignis. Für `tools/add-tipico-names.ts`, das ältere Snapshots ohne API-Aufruf ergänzt.
   */
  tipicoEventsForFixtures(fixtureIds: number[]): Map<number, { homeTeam: string; awayTeam: string; competitionId: number }> {
    const statement = this.db.prepare(`
      SELECT home_team, away_team, tipico_competition_id FROM tipico_fixtures
      WHERE api_fixture_id = ? ORDER BY julianday(last_seen_at) DESC LIMIT 1
    `);
    const result = new Map<number, { homeTeam: string; awayTeam: string; competitionId: number }>();
    for (const fixtureId of fixtureIds) {
      const row = statement.get(fixtureId) as { home_team: string; away_team: string; tipico_competition_id: number } | undefined;
      if (row) result.set(fixtureId, { homeTeam: row.home_team, awayTeam: row.away_team, competitionId: row.tipico_competition_id });
    }
    return result;
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

  /** Legt abgeschlossene Spiele für das Team-Elo ab. Gibt die Zahl neuer Zeilen zurück. */
  saveEloMatches(matches: EloMatch[], source: string): number {
    const statement = this.db.prepare(`INSERT OR IGNORE INTO elo_matches(
      fixture_id,kickoff,league_id,league_name,league_type,country,season,home_id,home_name,away_id,away_name,
      home_goals,away_goals,source
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let inserted = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const match of matches) {
        const result = statement.run(
          match.fixtureId, match.kickoff, match.leagueId, match.leagueName, match.leagueType, match.country,
          match.season, match.homeId, match.homeName, match.awayId, match.awayName, match.homeGoals,
          match.awayGoals, source
        );
        inserted += Number(result.changes);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return inserted;
  }

  /** Ohne Team-ID alle Spiele, sonst nur die dieses Teams (für `npm run coverage`). */
  eloMatches(teamId?: number): EloMatch[] {
    const columns = `fixture_id, kickoff, league_id, league_name, league_type, country, season,
        home_id, home_name, away_id, away_name, home_goals, away_goals`;
    const rows = (teamId === undefined
      ? this.db.prepare(`SELECT ${columns} FROM elo_matches`).all()
      : this.db.prepare(`SELECT ${columns} FROM elo_matches WHERE home_id = ? OR away_id = ?`).all(teamId, teamId)
    ) as Array<Record<string, number | string | null>>;
    return rows.map((row) => ({
      fixtureId: Number(row.fixture_id), kickoff: Number(row.kickoff), leagueId: Number(row.league_id),
      leagueName: String(row.league_name), leagueType: row.league_type === null ? null : String(row.league_type),
      country: String(row.country), season: Number(row.season),
      homeId: Number(row.home_id), homeName: String(row.home_name),
      awayId: Number(row.away_id), awayName: String(row.away_name),
      homeGoals: Number(row.home_goals), awayGoals: Number(row.away_goals)
    }));
  }

  /** Spiele je Liga und Saison - für die Frage, welche Saison noch nachgeladen werden muss. */
  eloSeasonCounts(): Map<string, number> {
    const rows = this.db.prepare(`SELECT league_id, season, COUNT(*) AS n FROM elo_matches GROUP BY league_id, season`)
      .all() as Array<{ league_id: number; season: number; n: number }>;
    return new Map(rows.map((row) => [`${row.league_id}|${row.season}`, Number(row.n)]));
  }

  /** Liga-IDs mit Spielen seit dem Zeitpunkt, samt Zahl der Spiele im Bestand. */
  eloActiveLeagues(sinceMs: number): Map<number, number> {
    const rows = this.db.prepare(`SELECT league_id, COUNT(*) AS n FROM elo_matches
      WHERE league_id IN (SELECT DISTINCT league_id FROM elo_matches WHERE kickoff >= ?)
      GROUP BY league_id`).all(sinceMs) as Array<{ league_id: number; n: number }>;
    return new Map(rows.map((row) => [Number(row.league_id), Number(row.n)]));
  }

  getEloMeta(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM elo_meta WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setEloMeta(key: string, value: string): void {
    this.db.prepare(`INSERT INTO elo_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  /**
   * Hebt die Markierung „vollständig“ für diese Wettbewerbe auf. Einmalig am 29.09.2026 für die
   * Jugend- und Frauenwettbewerbe, bei denen die 80-%-Regel des Nachladens Saisons markiert hatte,
   * die nie geladen waren (U21-Quali 2023 und 2025, U21-EM 2021).
   */
  reopenEloSeasons(leagueIds: number[]): number {
    const statement = this.db.prepare(`DELETE FROM elo_league_seasons WHERE league_id = ?`);
    let reopened = 0;
    for (const leagueId of leagueIds) reopened += Number(statement.run(leagueId).changes);
    return reopened;
  }

  isEloSeasonComplete(leagueId: number, season: number): boolean {
    return this.db.prepare(`SELECT 1 FROM elo_league_seasons WHERE league_id = ? AND season = ?`)
      .get(leagueId, season) !== undefined;
  }

  markEloSeasonComplete(leagueId: number, season: number, fixtures: number, completedAt = new Date().toISOString()): void {
    this.db.prepare(`INSERT INTO elo_league_seasons(league_id, season, fixtures, completed_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(league_id, season) DO UPDATE SET fixtures = excluded.fixtures, completed_at = excluded.completed_at`)
      .run(leagueId, season, fixtures, completedAt);
  }

  /** Ersetzt Historie und Ratings vollständig - beides ist aus `elo_matches` abgeleitet. */
  replaceEloResults(history: EloHistoryRow[], ranking: EloRankingRow[], configVersion: string, asOf: number): void {
    const historyStatement = this.db.prepare(`INSERT INTO elo_history(
      system,fixture_id,kickoff,league_id,competition,home_id,away_id,home_goals,away_goals,home_elo_before,away_elo_before,
      home_expected,away_expected,result,home_advantage,time_decay,competition_multiplier,mov,home_k,away_k,
      home_elo_after,away_elo_after,config_version,home_shift,away_shift
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const ratingStatement = this.db.prepare(`INSERT INTO elo_ratings(
      system,team_id,name,elo,games,last_change,change_30,change_90,peak,low,trend,league,country,confidence,
      last_played,as_of,config_version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM elo_history; DELETE FROM elo_ratings;");
      for (const row of history) {
        historyStatement.run(
          row.system, row.fixtureId, row.kickoff, row.leagueId, row.competition, row.homeId, row.awayId,
          row.homeGoals, row.awayGoals, row.homeEloBefore, row.awayEloBefore, row.homeExpected, row.awayExpected,
          row.result, row.homeAdvantage, row.timeDecay, row.competitionMultiplier, row.mov, row.homeK, row.awayK,
          row.homeEloAfter, row.awayEloAfter, configVersion, row.homeShift, row.awayShift
        );
      }
      for (const row of ranking) {
        ratingStatement.run(
          row.system, row.teamId, row.name, row.elo, row.games, row.lastChange, row.change30, row.change90,
          row.peak, row.low, row.trend, row.league, row.country, row.confidence, row.lastPlayed, asOf, configVersion
        );
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  eloRatings(filter: { system?: string; country?: string; teamId?: number; name?: string } = {}): Array<Record<string, unknown>> {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.system) { where.push("system = ?"); params.push(filter.system); }
    if (filter.country) { where.push("country = ? COLLATE NOCASE"); params.push(filter.country); }
    if (filter.teamId !== undefined) { where.push("team_id = ?"); params.push(filter.teamId); }
    if (filter.name) { where.push("name LIKE ? COLLATE NOCASE"); params.push(`%${filter.name}%`); }
    return this.db.prepare(`SELECT * FROM elo_ratings ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY elo DESC`).all(...params) as Array<Record<string, unknown>>;
  }

  eloHistoryFor(system: string, teamId: number, limit = 50): Array<Record<string, unknown>> {
    return this.db.prepare(`SELECT h.*, m.league_name, m.home_name, m.away_name FROM elo_history h
      JOIN elo_matches m ON m.fixture_id = h.fixture_id
      WHERE h.system = ? AND (h.home_id = ? OR h.away_id = ?)
      ORDER BY h.kickoff DESC LIMIT ?`).all(system, teamId, teamId, limit) as Array<Record<string, unknown>>;
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
