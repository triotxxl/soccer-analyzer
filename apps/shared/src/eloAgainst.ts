import type { DashboardFixture } from "./types";

/**
 * Hinweis „Elo dagegen“ für beide Apps (seit 04.11.2026, Davids Entscheidung nach der Prüfung AEK - Real):
 * Bei Vereinsspielen zwischen verschiedenen Ligen hält das Modell die Seite für wahrscheinlicher, die laut
 * Elo mindestens `ELO_AGAINST_GAP` Punkte schwächer ist. Das traf 30 von 234 Spielen; dort gewann die laut
 * Elo stärkere Seite 56,0 ± 10,1 %, das Modell sagte 30,0 %. Die Aufteilung der Tore aus der Teamform trägt
 * bei diesen Spielen neben Elo und Faktor nichts (`docs/aufteilung-zwischen-ligen.md`).
 *
 * Nur Anzeige: Der Hinweis ändert weder Tipp noch Chance, und keine Filterregel liest ihn. Ohne Heimvorteil
 * gerechnet wie die Elo-Stufen in Neo. Ein Elo mit wenig Grundlage löst ihn nicht aus.
 */
export const ELO_AGAINST_GAP = 100;
const MIN_CONFIDENCE = 30;

export interface EloAgainst {
  /** Die Seite, die das Modell für wahrscheinlicher hält. */
  modelSide: "home" | "away";
  /** Elo-Vorsprung der anderen Seite, gerundet. */
  gap: number;
}

export function eloAgainstOf(fixture: Pick<DashboardFixture, "crossLeague" | "homeElo" | "awayElo" | "markets">): EloAgainst | null {
  const home = fixture.homeElo, away = fixture.awayElo;
  if (!fixture.crossLeague || !home || !away || home.system !== "club" || away.system !== "club") return null;
  if (home.confidence < MIN_CONFIDENCE || away.confidence < MIN_CONFIDENCE) return null;
  const winner = fixture.markets.find((market) => market.key === "1x2");
  const draw = fixture.markets.find((market) => market.key === "draw");
  if (!winner || !draw || winner.probabilityReliable === false || !winner.pick) return null;
  const pick = winner.probability, other = Math.max(0, 1 - winner.probability - draw.probability);
  const homeChance = winner.pick === "1" ? pick : other, awayChance = winner.pick === "1" ? other : pick;
  if (homeChance === awayChance) return null;
  const modelSide = homeChance > awayChance ? "home" : "away";
  const gap = modelSide === "home" ? away.elo - home.elo : home.elo - away.elo;
  return gap >= ELO_AGAINST_GAP ? { modelSide, gap: Math.round(gap) } : null;
}

/** Erklärung des Hinweises in einfacher Sprache, in beiden Apps gleich. */
export function eloAgainstText(hint: EloAgainst, homeName: string, awayName: string): string {
  const model = hint.modelSide === "home" ? homeName : awayName, elo = hint.modelSide === "home" ? awayName : homeName;
  return `Das Modell sieht ${model} vorn, laut Elo ist aber ${elo} ${hint.gap} Punkte stärker. `
    + "Bei solchen Spielen zwischen verschiedenen Ligen gewann bisher öfter das Team mit dem höheren Elo, "
    + "als das Modell sagt. Das sind erst wenige Spiele und kann auch Zufall sein.";
}
