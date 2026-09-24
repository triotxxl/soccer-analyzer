import type { ApiFootballClient } from "./api.ts";
import type { AnalyzerDatabase } from "./database.ts";
import { toFixtureResult } from "./fixture-result.ts";
import type { RecentMatchSummary } from "./types.ts";

/** Torschüsse und Ecken einer Mannschaft in einer Partie. null heißt: nicht überliefert. */
export interface MatchSideStats {
  shotsOnGoal: number | null;
  corners: number | null;
  /**
   * Schüsse gesamt, Ballbesitz in Prozent und xG. Optional, weil sie erst mit dem Remis-Score
   * dazukamen und Aufrufer mit dem alten Zuschnitt weiter gültig bleiben. Fehlend oder null
   * heißt beides "nicht überliefert".
   */
  shots?: number | null;
  possession?: number | null;
  xg?: number | null;
}

/** Der Durchschnitt über die letzten Partien, mit der Zahl der Partien, die ihn tragen. */
export interface RecentAverage {
  shotsOnGoal: number | null;
  corners: number | null;
  /** Wie viele der betrachteten Partien überhaupt Zahlen hatten. */
  matches: number;
}

/** Ein gespeicherter Eintrag, samt der Angabe, ob überhaupt Zahlen darin stehen. */
export interface StoredRecentStats {
  home: MatchSideStats;
  away: MatchSideStats;
  statsAvailable: boolean;
  kickoff: string;
  fetchedAt: string;
}

/**
 * Ob eine gespeicherte Partie ohne Statistik noch einmal gefragt wird.
 *
 * API-Football trägt Zahlen manchmal erst Stunden nach Abpfiff nach, deshalb wird eine junge
 * Partie täglich erneut gefragt. Eine ältere wohl nie mehr - dort führt die Liga schlicht
 * keine Statistik, und ohne diese Grenze würde derselbe leere Wettbewerb bei jedem Lauf
 * wieder Aufrufe kosten. Dieselbe Abwägung wie beim xG-Erstaufbau in `xg.ts`.
 */
export function shouldRetryStats(entry: StoredRecentStats, now: Date): boolean {
  if (entry.statsAvailable) return false;
  const alter = now.getTime() - Date.parse(entry.kickoff);
  const wartezeit = alter <= 7 * 86_400_000 ? 86_400_000 : 30 * 86_400_000;
  return now.getTime() - Date.parse(entry.fetchedAt) >= wartezeit;
}

export interface RecentStatsResult {
  /** Fixture-Kennung auf die Werte beider Seiten. */
  values: Map<number, { home: MatchSideStats; away: MatchSideStats }>;
  apiRequests: number;
  /** Partien, für die auch nach dem Abruf nichts vorliegt. */
  missing: number;
}

/** Wie viele der jüngsten Partien in den Schnitt eingehen. */
export const RECENT_STATS_WINDOW = 5;

/**
 * Sammelt Torschüsse und Ecken für die jüngsten Partien der Mannschaften eines Laufs.
 *
 * Zuerst wird in `fixture_results` nachgesehen - dort steht schon alles, was je abgerechnet
 * oder nachgetragen wurde, und das kostet nichts. Erst der Rest geht über `/fixtures?ids=` in
 * Bündeln zu 20 Partien ans Netz; diese Antwort trägt Ereignisse und Statistiken mit, ein
 * Bündel reicht also für zwanzig Partien.
 *
 * Jede geholte Partie wird in `fixture_results` abgelegt. Dadurch bezahlt der nächste Lauf
 * dieselbe Partie nicht noch einmal, und der Bestand wächst von selbst mit.
 */
export async function collectRecentStats(
  fixtureIds: number[],
  client: ApiFootballClient,
  database: AnalyzerDatabase,
  options: { maxRequests?: number; now?: Date } = {}
): Promise<RecentStatsResult> {
  const budget = Math.max(0, options.maxRequests ?? Number.POSITIVE_INFINITY);
  const now = options.now ?? new Date();
  const wanted = [...new Set(fixtureIds)];
  const values = new Map<number, { home: MatchSideStats; away: MatchSideStats }>();

  // Schritt 1: der kostenlose Teil. Auch Partien ohne Zahlen kommen mit - sie gelten als
  // geprüft und werden nicht erneut geholt, solange die Wiederholungsfrist läuft.
  const stored = database.recentStatsForFixtures(wanted);
  for (const [fixtureId, entry] of stored) {
    values.set(fixtureId, { home: entry.home, away: entry.away });
  }

  // Schritt 2: nur die Lücken, und nur solange Budget da ist.
  const pending = wanted.filter((fixtureId) => {
    const entry = stored.get(fixtureId);
    return !entry || shouldRetryStats(entry, now);
  });
  let apiRequests = 0;
  if (typeof client.getFixturesWithStatistics === "function") {
    for (let offset = 0; offset < pending.length && apiRequests < budget; offset += 20) {
      const batch = pending.slice(offset, offset + 20);
      const returned = await client.getFixturesWithStatistics(batch);
      apiRequests += 1;
      const saved = [];
      for (const fixture of returned) {
        const result = toFixtureResult(fixture, { source: "cache" });
        if (!result) continue;
        saved.push(result);
        values.set(result.fixtureId, {
          home: {
            shotsOnGoal: result.homeStats.full?.shotsOnGoal ?? null,
            corners: result.homeStats.full?.corners ?? null,
            shots: result.homeStats.full?.shots ?? null,
            possession: result.homeStats.full?.possession ?? null,
            xg: result.homeXg
          },
          away: {
            shotsOnGoal: result.awayStats.full?.shotsOnGoal ?? null,
            corners: result.awayStats.full?.corners ?? null,
            shots: result.awayStats.full?.shots ?? null,
            possession: result.awayStats.full?.possession ?? null,
            xg: result.awayXg
          }
        });
      }
      if (saved.length > 0) database.saveFixtureResults(saved);
    }
  }

  return {
    values,
    apiRequests,
    missing: wanted.filter((fixtureId) => {
      const entry = values.get(fixtureId);
      return !entry
        || (entry.home.shotsOnGoal === null && entry.away.shotsOnGoal === null
          && entry.home.corners === null && entry.away.corners === null);
    }).length
  };
}

/**
 * Der Schnitt über die jüngsten Partien einer Mannschaft.
 *
 * Gemittelt wird nur über die Partien, die den Wert tatsächlich führen - viele Ligen liefern
 * gar keine Statistik. Eine fehlende Partie als 0 mitzuzählen würde den Schnitt still nach
 * unten ziehen und aus "unbekannt" ein "schwach" machen. Trägt keine einzige Partie den Wert,
 * bleibt er null und die Ansicht zeigt einen Strich.
 */
export function recentAverage(
  matches: RecentMatchSummary[],
  values: Map<number, { home: MatchSideStats; away: MatchSideStats }>,
  window = RECENT_STATS_WINDOW
): RecentAverage {
  const sides = matches.slice(0, window)
    .map((match) => {
      const entry = values.get(match.fixtureId);
      if (!entry) return null;
      return match.teamWasHome ? entry.home : entry.away;
    })
    .filter((side): side is MatchSideStats => side !== null);

  const mean = (pick: (side: MatchSideStats) => number | null) => {
    const numbers = sides.map(pick).filter((value): value is number => value !== null);
    if (numbers.length === 0) return null;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  };

  const shotsOnGoal = mean((side) => side.shotsOnGoal);
  const corners = mean((side) => side.corners);
  return {
    shotsOnGoal,
    corners,
    matches: sides.filter((side) => side.shotsOnGoal !== null || side.corners !== null).length
  };
}
