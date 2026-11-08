import type { DashboardFixture, FormResult } from "./types";

/**
 * Direkte Duelle (H2H) für beide Apps: Neo zeigt sie im H2H-Reiter, die alte App seit 03.11.2026 im
 * Live-Fenster. Bis dahin standen `duelsOf`/`duelStats` in apps/neo/src/neoData.ts. Grundlage ist
 * `h2h.history` des Snapshots (ab schemaVersion 11 bis zu 10 Duelle mit Wettbewerb) - 0 Aufrufe.
 */

/** Unter so vielen Duellen bzw. Spielen steht „kann auch Zufall sein“ (Davids Entscheidung 28.10.2026). */
export const H2H_FEW = 5;

export interface Duel {
  id: number;
  date: string;
  league: string | null;
  /** War das heutige Heimteam in diesem Duell zu Hause? */
  ourHome: boolean;
  /** Die Namen, wie API-Football sie für dieses Duell führt. */
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  /** Pausenstand dieses Duells (Heim : Gast des Duells); null, wenn der Snapshot ihn nicht trägt. */
  halfTime: { home: number; away: number } | null;
  /** Tore aus Sicht des heutigen Heim- bzw. Gastteams. */
  gh: number;
  ga: number;
  res: FormResult;
}

/**
 * Die direkten Duelle eines Spiels, neueste zuerst, ohne Testspiele (`h2hSummary` zählt sie mit, für
 * eine Bilanz taugen sie nicht). Ab schemaVersion 11 bis zu 10 Duelle mit Wettbewerb (`h2h.history`),
 * davor die fünf aus `h2h.matches` ohne Wettbewerb.
 */
export function duelsOf(fixture: Pick<DashboardFixture, "h2h">): Duel[] {
  const list = fixture.h2h.history ?? fixture.h2h.matches;
  return list.filter((m) => m.friendly !== true).map((m) => {
    const gh = m.teamWasHome ? m.homeGoals : m.awayGoals, ga = m.teamWasHome ? m.awayGoals : m.homeGoals;
    const halfTime = m.halfTimeHomeGoals != null && m.halfTimeAwayGoals != null
      ? { home: m.halfTimeHomeGoals, away: m.halfTimeAwayGoals } : null;
    return {
      id: m.fixtureId, date: m.date, league: m.league ?? null, ourHome: m.teamWasHome,
      homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeGoals: m.homeGoals, awayGoals: m.awayGoals, halfTime,
      gh, ga, res: gh > ga ? "win" : gh < ga ? "loss" : "draw",
    };
  });
}

export interface DuelStats {
  n: number; wH: number; dr: number; wA: number; gH: number; gA: number;
  bestH: Duel | null; bestA: Duel | null;
}

export function duelStats(duels: readonly Duel[]): DuelStats {
  const best = (res: FormResult) => duels.filter((d) => d.res === res)
    .reduce<Duel | null>((top, d) => (!top || Math.abs(d.gh - d.ga) > Math.abs(top.gh - top.ga) ? d : top), null);
  return {
    n: duels.length,
    wH: duels.filter((d) => d.res === "win").length, dr: duels.filter((d) => d.res === "draw").length,
    wA: duels.filter((d) => d.res === "loss").length,
    gH: duels.reduce((s, d) => s + d.gh, 0), gA: duels.reduce((s, d) => s + d.ga, 0),
    bestH: best("win"), bestA: best("loss"),
  };
}
