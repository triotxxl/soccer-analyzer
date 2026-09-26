import type { AnalyzerDatabase } from "./database.ts";
import type { EloSystem } from "./elo-config.ts";

/**
 * Leseschnittstelle des Team-Elo. Sie liest nur, was `npm run elo -- build` zuletzt
 * geschrieben hat; gerechnet wird ausschließlich in `src/elo.ts`.
 */

export interface StoredElo {
  system: EloSystem;
  teamId: number;
  name: string;
  elo: number;
  games: number;
  lastChange: number;
  change30: number;
  change90: number;
  peak: number;
  low: number;
  trend: string;
  league: string | null;
  country: string | null;
  /** 0-100, getrennt vom Elo. */
  confidence: number;
  lastPlayed: number;
  asOf: number;
  configVersion: string;
}

function toStored(row: Record<string, unknown>): StoredElo {
  return {
    system: row.system as EloSystem,
    teamId: Number(row.team_id),
    name: String(row.name),
    elo: Number(row.elo),
    games: Number(row.games),
    lastChange: Number(row.last_change),
    change30: Number(row.change_30),
    change90: Number(row.change_90),
    peak: Number(row.peak),
    low: Number(row.low),
    trend: String(row.trend),
    league: row.league === null ? null : String(row.league),
    country: row.country === null ? null : String(row.country),
    confidence: Number(row.confidence),
    lastPlayed: Number(row.last_played),
    asOf: Number(row.as_of),
    configVersion: String(row.config_version)
  };
}

export function getTeamElo(database: AnalyzerDatabase, teamId: number, system: EloSystem = "club"): StoredElo | null {
  const row = database.eloRatings({ system, teamId })[0];
  return row ? toStored(row) : null;
}

export function getEloRanking(
  database: AnalyzerDatabase,
  filter: { system?: EloSystem; country?: string; name?: string } = {}
): StoredElo[] {
  return database.eloRatings(filter).map(toStored);
}

/**
 * Das Elo je Team-ID für die Anzeige neben dem Namen, über beide Systeme. Seit Version 1.2.0 steht
 * eine ID nur noch in einem; kommt sie doch in beiden vor, gilt der Eintrag mit mehr Spielen.
 * Vorher gewann still der niedrigere Wert - neben Hull City stand 1488 aus einem Spiel gegen
 * Curaçao statt 2072.
 */
export function getEloByTeam(database: Pick<AnalyzerDatabase, "eloRatings">): Map<number, StoredElo> {
  const byTeam = new Map<number, StoredElo>();
  for (const row of database.eloRatings().map(toStored)) {
    const existing = byTeam.get(row.teamId);
    if (!existing || row.games > existing.games) byTeam.set(row.teamId, row);
  }
  return byTeam;
}

export function getEloConfidence(database: AnalyzerDatabase, teamId: number, system: EloSystem = "club"): number | null {
  return getTeamElo(database, teamId, system)?.confidence ?? null;
}

export interface StoredEloGame {
  fixtureId: number;
  kickoff: number;
  competition: string;
  league: string;
  opponent: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  eloBefore: number;
  opponentEloBefore: number;
  expected: number;
  result: number;
  timeDecay: number;
  competitionMultiplier: number;
  mov: number;
  effectiveK: number;
  eloAfter: number;
  /**
   * Liga-Mitnahme seit dem vorigen Spiel dieses Teams, schon in `eloBefore` enthalten:
   * `eloBefore = eloAfter(voriges Spiel) + leagueShift`.
   */
  leagueShift: number;
}

/** Die Historie eines Teams aus seiner Sicht, jüngstes Spiel zuerst. */
export function getEloHistory(
  database: AnalyzerDatabase,
  teamId: number,
  system: EloSystem = "club",
  limit = 50
): StoredEloGame[] {
  return database.eloHistoryFor(system, teamId, limit).map((row) => {
    const home = Number(row.home_id) === teamId;
    const result = Number(row.result);
    return {
      fixtureId: Number(row.fixture_id),
      kickoff: Number(row.kickoff),
      competition: String(row.competition),
      league: String(row.league_name),
      opponent: String(home ? row.away_name : row.home_name),
      home,
      goalsFor: Number(home ? row.home_goals : row.away_goals),
      goalsAgainst: Number(home ? row.away_goals : row.home_goals),
      eloBefore: Number(home ? row.home_elo_before : row.away_elo_before),
      opponentEloBefore: Number(home ? row.away_elo_before : row.home_elo_before),
      expected: Number(home ? row.home_expected : row.away_expected),
      result: home ? result : 1 - result,
      timeDecay: Number(row.time_decay),
      competitionMultiplier: Number(row.competition_multiplier),
      mov: Number(row.mov),
      effectiveK: Number(home ? row.home_k : row.away_k),
      eloAfter: Number(home ? row.home_elo_after : row.away_elo_after),
      leagueShift: Number(home ? row.home_shift : row.away_shift)
    };
  });
}
