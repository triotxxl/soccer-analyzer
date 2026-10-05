/**
 * Live-Chancen eines laufenden Spiels: erwartete Resttore, noch ein Tor, Torlinien am Ende,
 * nächstes Tor und Sieger nach 90 Minuten. Rein, ohne I/O - der Live-Dienst ruft es für jede
 * Tafel auf, `tools/live-model-report.ts` für die Messung an alten Spielen. Eine zweite Fassung
 * der Rechnung gibt es nicht (dieselbe Begründung wie bei `autoDecide`).
 *
 * Grundlage ist die Prüfung vom 29.09.2026 (Prüfer-Agent, 7.273 abgerechnete Spiele mit
 * Pre-Match-Prognose und lückenlosen Torminuten, Zeit-Split August/September):
 *
 * - Die Resttore je Team sind unabhängig Poisson-verteilt mit
 *   μ = λ · S(t) · RED_CARD_OWN^[eigene Rote] · RED_CARD_OPPONENT^[gegnerische Rote].
 *   λ ist die Torerwartung vor dem Anpfiff aus dem Dashboard, S(t) der Anteil der Tore eines
 *   Spiels, der nach dem Stand der Uhr noch fällt.
 * - Tore fallen nicht gleichmäßig. Die Minuten 45 und 90 tragen samt Nachspielzeit ein
 *   Vielfaches einer gewöhnlichen Minute, die ersten fünf Minuten sind langsam. Gegen eine
 *   gleichmäßige Uhr: Brier „noch ein Tor" −0,012 ± 0,001 in beiden Richtungen des Splits.
 * - Rot: gemessen je Team höchstens einmal (eine zweite Rote desselben Teams ist nicht
 *   gemessen und verstärkt den Faktor nicht).
 * - **Nicht drin, weil gemessen wirkungslos:** der Spielstand („der Rückliegende drückt",
 *   beim 1X2 sogar schlechter), die Live-Statistik (Schüsse aufs Tor der ersten Halbzeit: kann
 *   auch Zufall sein) und ein Nachschärfen λ nach den bisherigen Toren. Wer eines davon
 *   einbaut, misst vorher mit `npm run live-model-report`.
 *
 * Die Chancen gelten für 90 Minuten wie die Tipico-Märkte; Verlängerung, Elfmeterschießen und
 * Unterbrechungen bekommen keine Zahl. Bis zur Nachmessung an Spielen des laufenden Modells
 * (Kriterien in `tools/live-model-report.ts`) sind sie als vorläufig markiert.
 */

import type { LiveCoverage } from "./types.ts";

/** Liest `coverage.fixtures` einer Saison; ohne Angabe undefined statt einer geratenen Antwort. */
export function liveCoverageOf(coverage: Record<string, unknown> | undefined): LiveCoverage | undefined {
  const fixtures = coverage?.fixtures as Record<string, unknown> | undefined;
  if (!fixtures || typeof fixtures !== "object") return undefined;
  return { statistics: fixtures.statistics_fixtures === true, events: fixtures.events === true };
}

/** Steigt, sobald sich Formel oder Konstanten ändern - die Nachmessung gilt je Fassung. */
export const LIVE_MODEL_VERSION = "1.0.0";

/** Bis die Nachmessung bestanden ist und David freigibt. */
export const LIVE_MODEL_PROVISIONAL = true;

/**
 * Torrate je Minutenabschnitt relativ zu einer gleichmäßigen Minute (1/90), in der Reihenfolge
 * von `binOfMinute`: 1-5, 6-10, …, 36-40, 41-44, 45 samt 45+x, 46-50, …, 81-85, 86-89, 90 samt
 * 90+x. Minute 45 und 90 stehen je für den ganzen Block mit Nachspielzeit, weil API-Football
 * Nachspielzeit-Tore mal als „90" ohne `extra`, mal als „90+x" führt (die Summe ist stabil,
 * die Aufteilung nicht). `goalShareAfter` normiert auf die Summe 1; den Pegel liefert λ.
 *
 * Abgeleitet am 29.09.2026 mit `npm run live-model-report -- --derive` aus 7.276 Spielen
 * (02.08.-29.09.2026), Zeit und Rot gemeinsam geschätzt.
 */
export const GOAL_RATE_BY_BIN: readonly number[] = [
  0.63, 0.8, 0.78, 0.86, 0.85, 0.82, 0.82, 0.86, 0.89, 3.48,
  0.84, 1.11, 0.97, 0.95, 0.95, 0.9, 0.97, 0.93, 1, 7.26
];

/** Torrate eines Teams mit eigener Roter Karte (×) - rund 40 % seltener; ± 0,029 aus 424 Toren. */
export const RED_CARD_OWN = 0.604;
/** Torrate eines Teams, dessen Gegner eine Rote hat (×) - rund 55 % öfter; ± 0,047 aus 1.074 Toren. */
export const RED_CARD_OPPONENT = 1.552;

/**
 * Anteil des Tor-Blocks 45 bzw. 90, der noch aussteht, wenn die Uhr 45+k bzw. 90+k zeigt
 * (Index k; k = 0 heißt: Minute 45 bzw. 90 läuft, Nachspielzeit noch nicht angezeigt; ein Tor
 * in der laufenden Minute zählt halb). Aus 2.076 Spielen seit dem 15.09.2026 (236 Tore im Block
 * 45, 468 im Block 90), weil API-Football erst seitdem `extra` verlässlich setzt. Jenseits des
 * letzten Eintrags gilt der letzte.
 */
export const STOPPAGE_REMAINING: { readonly firstHalf: readonly number[]; readonly secondHalf: readonly number[] } = {
  firstHalf: [0.83, 0.56, 0.36, 0.2, 0.1, 0.07, 0.04, 0.03],
  secondHalf: [0.9, 0.73, 0.59, 0.46, 0.35, 0.25, 0.16, 0.09, 0.04, 0.02]
};

/** Höchster Rest je Team, bis zu dem die Ergebnisverteilung summiert wird. */
const MAX_REMAINING_GOALS = 15;

export type LiveClock =
  | { phase: "running"; minutesPlayed: number }
  | { phase: "notStarted" | "extraTime" | "breakBeforeExtraTime" | "penalties" | "interrupted" | "unknown" };

export type LiveChanceState =
  | "ok"
  | "notStarted"
  | "extraTime"
  | "breakBeforeExtraTime"
  | "penalties"
  | "interrupted"
  | "unknown"
  | "shortMatch";

export interface LiveChances {
  state: LiveChanceState;
  provisional: boolean;
  modelVersion: string;
  /** Erwartete Tore bis zum Ende der 90 Minuten, beide Teams zusammen. */
  remainingGoals: number | null;
  /** P(mindestens noch ein Tor). */
  anotherGoal: number | null;
  /** Wer das nächste Tor schießt; null ohne belastbare Aufteilung (Ligastärke unbekannt). */
  nextGoal: { home: number; none: number; away: number } | null;
  /** Ausgang nach 90 Minuten; null ohne belastbare Aufteilung. */
  result: { home: number; draw: number; away: number } | null;
  /** P(über X,5 Tore am Ende); 1, wenn der Stand die Linie schon überschritten hat. */
  lines: { over15: number; over25: number; over35: number } | null;
}

export interface LiveChanceInput {
  /** Torerwartung vor dem Anpfiff (`DashboardFixture.expectedGoals`). */
  lambdaHome: number;
  lambdaAway: number;
  clock: LiveClock;
  goalsHome: number;
  goalsAway: number;
  redHome: number;
  redAway: number;
  /**
   * false, wenn der 1X2-Markt vor dem Anpfiff `probabilityReliable: false` trug: Dann ist die
   * Aufteilung λ_H/λ_A nicht belastbar, und Sieger wie nächstes Tor bleiben leer. Die Summe
   * (Resttore, Torlinien) bleibt - wie vor dem Anpfiff.
   */
  sideReliable: boolean;
  /** Jugendspiel mit kürzeren Halbzeiten (`isShortMatch`) - die Uhr passt dann nicht. */
  shortMatch?: boolean;
}

/** Abschnitt von `GOAL_RATE_BY_BIN` für eine Spielminute 1-90 (45/90 samt Nachspielzeit). */
export function binOfMinute(minute: number): number {
  if (minute <= 44) return Math.floor((Math.max(1, minute) - 1) / 5);
  if (minute === 45) return 9;
  if (minute <= 89) return 10 + Math.floor((minute - 46) / 5);
  return 19;
}

const TOTAL_RATE = (() => {
  let sum = 0;
  for (let minute = 1; minute <= 90; minute += 1) sum += GOAL_RATE_BY_BIN[binOfMinute(minute)]!;
  return sum;
})();

/**
 * Anteil der Tore eines Spiels, der nach `minutesPlayed` noch fällt. Minute m deckt das
 * Intervall (m−1, m] ab; ein Bruchteil zählt anteilig.
 */
export function goalShareAfter(minutesPlayed: number): number {
  let remaining = 0;
  for (let minute = 1; minute <= 90; minute += 1) {
    const open = Math.max(0, Math.min(1, minute - minutesPlayed));
    if (open > 0) remaining += open * GOAL_RATE_BY_BIN[binOfMinute(minute)]!;
  }
  return remaining / TOTAL_RATE;
}

function stoppageShare(table: readonly number[], extra: number): number {
  const index = Math.max(0, Math.floor(extra));
  return table[Math.min(index, table.length - 1)]!;
}

/**
 * Übersetzt den Live-Status von API-Football in gespielte Minuten. `elapsed` zeigt die laufende
 * Minute (Tore der 67. tragen `elapsed: 67`), deshalb zählt sie zur Hälfte als gespielt. In der
 * Nachspielzeit bleibt vom Block 45 bzw. 90 der gemessene Rest übrig.
 */
export function clockOf(status: string, elapsed: number | null, extra: number | null): LiveClock {
  switch (status) {
    case "NS":
    case "TBD":
      return { phase: "notStarted" };
    case "HT":
      return { phase: "running", minutesPlayed: 45 };
    case "ET":
      return { phase: "extraTime" };
    case "BT":
      return { phase: "breakBeforeExtraTime" };
    case "P":
      return { phase: "penalties" };
    case "SUSP":
    case "INT":
      return { phase: "interrupted" };
    case "1H": {
      if (elapsed === null) return { phase: "unknown" };
      if (elapsed < 45) return { phase: "running", minutesPlayed: Math.max(0, elapsed - 0.5) };
      const stoppage = extra ?? elapsed - 45;
      return { phase: "running", minutesPlayed: 45 - stoppageShare(STOPPAGE_REMAINING.firstHalf, stoppage) };
    }
    case "2H": {
      if (elapsed === null) return { phase: "unknown" };
      if (elapsed < 90) return { phase: "running", minutesPlayed: Math.max(45, elapsed - 0.5) };
      const stoppage = extra ?? elapsed - 90;
      return { phase: "running", minutesPlayed: 90 - stoppageShare(STOPPAGE_REMAINING.secondHalf, stoppage) };
    }
    default:
      return { phase: "unknown" };
  }
}

/**
 * Jugendspiele mit kürzeren Halbzeiten (U17 und jünger spielen meist 2 × 40 oder kürzer).
 * Die Minutentabelle stammt aus 90-Minuten-Spielen und würde dort die Uhr falsch lesen.
 */
export function isShortMatch(homeTeam: string, awayTeam: string): boolean {
  const age = (name: string) => Number(/\bU-?(\d{2})\b/i.exec(name)?.[1] ?? Number.NaN);
  return [homeTeam, awayTeam].some((name) => age(name) <= 17);
}

function poisson(mean: number, count: number): number {
  if (mean <= 0) return count === 0 ? 1 : 0;
  let value = Math.exp(-mean);
  for (let k = 1; k <= count; k += 1) value *= mean / k;
  return value;
}

/** P(X ≤ count) für X ~ Poisson(mean). */
export function poissonCdf(mean: number, count: number): number {
  let sum = 0;
  for (let k = 0; k <= count; k += 1) sum += poisson(mean, k);
  return Math.min(1, sum);
}

export interface RemainingMeans {
  muHome: number;
  muAway: number;
  goalsHome: number;
  goalsAway: number;
  sideReliable: boolean;
}

/**
 * Die Poisson-Rechnung ab den Rest-Torerwartungen. Getrennt von `liveChances`, damit der Report
 * die gleichmäßige Uhr als Vergleich durch genau dieselbe Rechnung schicken kann.
 */
export function chancesFromMeans(input: RemainingMeans): Omit<LiveChances, "state" | "provisional" | "modelVersion"> {
  const muHome = Math.max(0, input.muHome);
  const muAway = Math.max(0, input.muAway);
  const total = muHome + muAway;
  const anotherGoal = 1 - Math.exp(-total);
  const scored = input.goalsHome + input.goalsAway;
  const over = (line: number) => (scored > line ? 1 : 1 - poissonCdf(total, Math.floor(line) - scored));

  let nextGoal: LiveChances["nextGoal"] = null;
  let result: LiveChances["result"] = null;
  if (input.sideReliable) {
    nextGoal = total > 0
      ? { home: (muHome / total) * anotherGoal, none: 1 - anotherGoal, away: (muAway / total) * anotherGoal }
      : { home: 0, none: 1, away: 0 };
    let home = 0;
    let draw = 0;
    let away = 0;
    for (let i = 0; i <= MAX_REMAINING_GOALS; i += 1) {
      const pHome = poisson(muHome, i);
      for (let j = 0; j <= MAX_REMAINING_GOALS; j += 1) {
        const mass = pHome * poisson(muAway, j);
        const difference = input.goalsHome + i - input.goalsAway - j;
        if (difference > 0) home += mass;
        else if (difference === 0) draw += mass;
        else away += mass;
      }
    }
    const sum = home + draw + away;
    result = { home: home / sum, draw: draw / sum, away: away / sum };
  }

  return {
    remainingGoals: total,
    anotherGoal,
    nextGoal,
    result,
    lines: { over15: over(1.5), over25: over(2.5), over35: over(3.5) }
  };
}

export function liveChances(input: LiveChanceInput): LiveChances {
  const base = { provisional: LIVE_MODEL_PROVISIONAL, modelVersion: LIVE_MODEL_VERSION };
  const empty = { remainingGoals: null, anotherGoal: null, nextGoal: null, result: null, lines: null };
  if (input.shortMatch) return { state: "shortMatch", ...base, ...empty };
  if (input.clock.phase !== "running") return { state: input.clock.phase, ...base, ...empty };
  if (!Number.isFinite(input.lambdaHome) || !Number.isFinite(input.lambdaAway)) {
    return { state: "unknown", ...base, ...empty };
  }

  const share = goalShareAfter(input.clock.minutesPlayed);
  const ownHome = input.redHome > 0 ? RED_CARD_OWN : 1;
  const ownAway = input.redAway > 0 ? RED_CARD_OWN : 1;
  const opponentHome = input.redAway > 0 ? RED_CARD_OPPONENT : 1;
  const opponentAway = input.redHome > 0 ? RED_CARD_OPPONENT : 1;
  return {
    state: "ok",
    ...base,
    ...chancesFromMeans({
      muHome: input.lambdaHome * share * ownHome * opponentHome,
      muAway: input.lambdaAway * share * ownAway * opponentAway,
      goalsHome: input.goalsHome,
      goalsAway: input.goalsAway,
      sideReliable: input.sideReliable
    })
  };
}
