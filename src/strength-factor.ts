import { config } from "./config.ts";
import type { AnalyzerDatabase } from "./database.ts";
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
    factor: strengthFactor(homeRating.rating, awayRating.rating)
  };
}
