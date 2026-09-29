import { config } from "./config.ts";
import type { AnalyzerDatabase } from "./database.ts";
import type { EloSystem } from "./elo-config.ts";
import { clamp } from "./util.ts";

export interface LeagueRating {
  leagueId: number;
  rating: number;
  /** false, wenn das Rating über den Pool-Floor geschätzt wurde statt gemessen zu sein. */
  reliable: boolean;
}

export interface StrengthComparison {
  home: LeagueRating;
  away: LeagueRating;
  factor: number;
  /**
   * Woher der Faktor kommt. "league": Liga-Elo beider Heimatligen. "sameLeague": beide Teams
   * aus derselben Liga, also kein Klassenunterschied und Faktor 1. "teamElo": Team-Elo der
   * Nationalteams; `rating` trägt dann das Team-Elo, `leagueId` ist 0.
   */
  source: "league" | "sameLeague" | "teamElo";
}

/**
 * Ligarating für eine Seite. Ohne belastbaren Snapshot gilt das schwächste belastbare
 * Rating des Pools abzüglich eines Abschlags: eine Liga, die in der Elo-Kette aus
 * Pokalbegegnungen nie auftaucht, ist unterklassig und nicht Mittelfeld. Ohne jeden
 * belastbaren Snapshot im Pool gibt es kein Rating.
 */
export function ratingFor(
  database: Pick<AnalyzerDatabase, "getLeagueStrength">,
  pool: string,
  leagueId: number,
  season: number,
  cutoff: string,
  floor: number | null
): LeagueRating | null {
  const snapshot = database.getLeagueStrength(pool, leagueId, season, cutoff);
  if (snapshot?.reliable) {
    return { leagueId, rating: snapshot.rating, reliable: true };
  }
  if (floor === null) return null;
  return {
    leagueId,
    rating: floor - config.strength.unratedPenalty,
    reliable: false
  };
}

/**
 * Torfaktor aus der Ratingdifferenz. Wird auf die erwarteten Heimtore multipliziert und
 * von den Auswärtstoren geteilt, ist also symmetrisch: factor(a, b) === 1 / factor(b, a).
 */
export function strengthFactor(homeRating: number, awayRating: number): number {
  return clamp(
    10 ** ((homeRating - awayRating) / config.strength.factorDivisor),
    config.strength.factorMin,
    config.strength.factorMax
  );
}

/** Ratings beider Seiten samt Faktor, oder null wenn eine Seite kein Rating bekommt. */
export function compareStrength(
  database: Pick<AnalyzerDatabase, "getLeagueStrength">,
  pool: string,
  home: { leagueId: number; season: number },
  away: { leagueId: number; season: number },
  cutoff: string,
  floor: number | null
): StrengthComparison | null {
  const homeRating = ratingFor(database, pool, home.leagueId, home.season, cutoff, floor);
  const awayRating = ratingFor(database, pool, away.leagueId, away.season, cutoff, floor);
  if (!homeRating || !awayRating) return null;
  // Zwei geschätzte Ratings sind identisch und tragen keine Information.
  if (!homeRating.reliable && !awayRating.reliable) return null;
  return {
    home: homeRating,
    away: awayRating,
    factor: strengthFactor(homeRating.rating, awayRating.rating),
    source: "league"
  };
}

/** Das Nötigste aus dem gespeicherten Team-Elo (`StoredElo` in src/elo-store.ts). */
export interface TeamEloInput {
  /** Nur die Skalen aus `config.strength.teamEloSystems` tragen einen Faktor. */
  system: EloSystem;
  elo: number;
  /** Bei Nationalteams der Kontinentalverband (UEFA, CAF, AFC, CONCACAF, CONMEBOL, OFC). */
  league: string | null;
}

/**
 * Torfaktor aus dem Team-Elo zweier Nationalteams, oder null. Nur, wenn beide Seiten ein
 * Nationalteam-Elo haben und demselben Verband angehören - zwischen Verbänden sind die
 * Elo-Skalen schlecht verbunden, dort half der Faktor gemessen nicht (siehe
 * `config.strength.teamEloDivisor`). Die Differenz geht ohne Elo-Heimvorteil ein, weil die
 * erwarteten Tore des Modells den Heimvorteil schon tragen.
 */
export function teamEloComparison(home: TeamEloInput | null, away: TeamEloInput | null): StrengthComparison | null {
  if (!home || !away) return null;
  if (home.system !== away.system || !config.strength.teamEloSystems.includes(home.system)) return null;
  if (!home.league || !away.league || home.league !== away.league) return null;
  return {
    home: { leagueId: 0, rating: home.elo, reliable: true },
    away: { leagueId: 0, rating: away.elo, reliable: true },
    factor: clamp(
      10 ** ((home.elo - away.elo) / config.strength.teamEloDivisor),
      config.strength.factorMin,
      config.strength.factorMax
    ),
    source: "teamElo"
  };
}

/**
 * Zwei Teams derselben Liga, etwa in einem Pokal: Es gibt keinen Klassenunterschied, der
 * Faktor ist 1. Bis 28.09.2026 lieferte dieser Fall null, und die 1X2-Wahrscheinlichkeit
 * wurde als "Ligastärke unbekannt" versteckt, obwohl sie gemessen gut passte (90 Spiele in
 * den archivierten Läufen, Favorit 44,1 % vorhergesagt gegen 42,2 % eingetreten).
 */
export function sameLeagueComparison(leagueId: number, rating: LeagueRating | null): StrengthComparison {
  const side = rating ?? { leagueId, rating: 0, reliable: false };
  return { home: side, away: side, factor: 1, source: "sameLeague" };
}
