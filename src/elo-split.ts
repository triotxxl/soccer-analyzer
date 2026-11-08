/**
 * Elo-Aufteilung der Tore bei Spielen zwischen Ligen, nur für die vorab festgelegte Prüfung
 * `docs/aufteilung-zwischen-ligen.md`. **Das Modell benutzt das nicht.** Die Summe der Tore bleibt wie
 * im Modell, nur ihre Verteilung auf Heim und Gast kommt aus Elo-Abstand und Faktor statt aus der
 * Teamform:
 *
 *   ln(Heim / Gast) = c + ΔElo · ln 10 / D + w · 2 · ln F
 *
 * Die Werte sind eingefroren (Prüfung vom 04.11.2026, auf nachgebauten Spielen gewählt). Wer sie
 * ändert, misst nichts mehr.
 */
import { poissonProbabilities } from "./model.ts";

export const ELO_SPLIT = { divisor: 1000, factorWeight: 0.75, homeShift: 0.3, floor: 0.05 } as const;

export function eloSplitGoals(total: number, eloDiff: number, factor: number): { home: number; away: number } {
  const ratio = Math.exp(
    ELO_SPLIT.homeShift + eloDiff * Math.LN10 / ELO_SPLIT.divisor + ELO_SPLIT.factorWeight * 2 * Math.log(factor)
  );
  const homeShare = ratio / (1 + ratio);
  return {
    home: Math.max(ELO_SPLIT.floor, total * homeShare),
    away: Math.max(ELO_SPLIT.floor, total * (1 - homeShare))
  };
}

/** −log p(Ausgang) des 1X2 aus zwei Torerwartungen; der Ausgang ist der Stand nach 90 Minuten. */
export function outcomeLogLoss(home: number, away: number, homeGoals: number, awayGoals: number): number {
  const probabilities = poissonProbabilities(home, away);
  const probability = homeGoals > awayGoals ? probabilities.home
    : homeGoals === awayGoals ? probabilities.draw : probabilities.away;
  return -Math.log(Math.max(probability, 1e-6));
}

/** Mittlerer Unterschied und sein Standardfehler (Standardabweichung / √n), eine Zeile je Spiel. */
export function meanWithError(values: readonly number[]): { mean: number; error: number } {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return { mean, error: Math.sqrt(variance / n) };
}
