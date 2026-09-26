import { classifyMatch, type EloMatch } from "./elo-competitions.ts";
import { ELO_CONFIG, ELO_TEAM_MERGES, type EloConfig, type EloSystem } from "./elo-config.ts";
import { calculateHistoricalElo, expectedHome, mergeTeams, teamKey } from "./elo.ts";

/**
 * Backtest des Team-Elo **ohne Blick in die Zukunft**.
 *
 * - Für jede Testwoche werden die Ratings mit Stichtag = Wochenbeginn aus allen Spielen davor
 *   neu gerechnet (`calculateHistoricalElo` nimmt nur Spiele mit Anstoß < Stichtag). Das gilt
 *   auch für den Zeit-Decay und die Ligaebenen - beide hängen am Stichtag.
 * - Das Elo liefert einen Erwartungswert, keine drei Wahrscheinlichkeiten. Der Remis-Anteil je
 *   Abstand des Erwartungswerts von 0,5 wird **nur aus Spielen vor dem Testbeginn** gemessen;
 *   daraus werden P(1) = E − P(X)/2 und P(2) = 1 − E − P(X)/2.
 * - Vergleichsbasis: die Heim-/Remis-/Auswärtsquote der Trainingsspiele je System und
 *   Platzart, also ein Modell, das nur den Heimvorteil kennt. Ein Elo, das diese Basis nicht
 *   schlägt, weiß nichts über die Teams.
 */

export type BacktestGroup = "liga" | "pokal" | "international" | "testspiel" | "national";

export interface BacktestPrediction {
  fixtureId: number;
  kickoff: number;
  system: EloSystem;
  group: BacktestGroup;
  /** Beide Teams hatten zum Stichtag mindestens `minGames` bewertete Spiele. */
  established: boolean;
  expected: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  baseline: { pHome: number; pDraw: number; pAway: number };
  /** Ergebnis aus Heimsicht: 1, 0,5 oder 0. */
  actual: number;
}

export interface BacktestMetrics {
  n: number;
  /** Brier auf den Erwartungswert (0 / 0,5 / 1). */
  brierExpected: number;
  logLoss: number;
  brier1x2: number;
  /** Wie oft der Elo-Favorit gewann, und wie oft er laut Vorhersage hätte gewinnen sollen. */
  favoriteWins: number;
  favoritePredicted: number;
}

export interface BacktestResult {
  trainGames: number;
  predictions: BacktestPrediction[];
  drawCurve: Record<EloSystem, number[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BINS = 10;
const binOf = (expected: number) => Math.min(BINS - 1, Math.floor(Math.abs(expected - 0.5) * 2 * BINS));

function groupOf(match: EloMatch): BacktestGroup | null {
  const cls = classifyMatch(match);
  if (cls.excluded) return null;
  if (cls.system === "national") return "national";
  if (cls.isLeague) return "liga";
  if (cls.kind === "clubFriendly") return "testspiel";
  if (cls.international) return "international";
  return "pokal";
}

const outcome = (match: EloMatch) => (match.homeGoals > match.awayGoals ? 1 : match.homeGoals === match.awayGoals ? 0.5 : 0);

export function backtestElo(
  matches: EloMatch[],
  config: EloConfig = ELO_CONFIG,
  options: { testStart: number; testEnd: number; stepDays?: number; minGames?: number }
): BacktestResult {
  const step = (options.stepDays ?? 7) * DAY_MS;
  const minGames = options.minGames ?? config.provisional.games;

  // Remis-Kurve und Vergleichsbasis nur aus der Zeit vor dem Test.
  const training = calculateHistoricalElo(matches, config, { asOf: options.testStart });
  const drawCounts: Record<EloSystem, Array<{ draws: number; n: number }>> = {
    club: Array.from({ length: BINS }, () => ({ draws: 0, n: 0 })),
    national: Array.from({ length: BINS }, () => ({ draws: 0, n: 0 }))
  };
  const base = new Map<string, { home: number; draw: number; away: number; n: number }>();
  for (const row of training.history) {
    const bin = drawCounts[row.system][binOf(row.homeExpected)]!;
    bin.n += 1;
    if (row.result === 0.5) bin.draws += 1;
    const key = `${row.system}|${row.homeAdvantage === 0 ? "neutral" : "heim"}`;
    const entry = base.get(key) ?? { home: 0, draw: 0, away: 0, n: 0 };
    entry.n += 1;
    if (row.result === 1) entry.home += 1; else if (row.result === 0.5) entry.draw += 1; else entry.away += 1;
    base.set(key, entry);
  }
  const drawCurve = {} as Record<EloSystem, number[]>;
  for (const system of ["club", "national"] as const) {
    const total = drawCounts[system].reduce((sum, bin) => ({ draws: sum.draws + bin.draws, n: sum.n + bin.n }), { draws: 0, n: 0 });
    const overall = total.n ? total.draws / total.n : 0.25;
    // Dünn besetzte Stufen fallen auf den Gesamtanteil zurück, statt mit drei Spielen zu raten.
    drawCurve[system] = drawCounts[system].map((bin) => (bin.n >= 30 ? bin.draws / bin.n : overall));
  }

  const predictions: BacktestPrediction[] = [];
  const testMatches = matches
    .filter((match) => match.kickoff >= options.testStart && match.kickoff < options.testEnd)
    .sort((left, right) => left.kickoff - right.kickoff);
  let index = 0;
  for (let weekStart = options.testStart; weekStart < options.testEnd; weekStart += step) {
    const weekEnd = Math.min(weekStart + step, options.testEnd);
    const week: EloMatch[] = [];
    while (index < testMatches.length && testMatches[index]!.kickoff < weekEnd) week.push(testMatches[index++]!);
    if (week.length === 0) continue;
    const state = calculateHistoricalElo(matches, config, { asOf: weekStart, lean: true });
    // Dieselben Team-IDs wie im Rechenkern, sonst fände ein Spiel unter einer alten ID sein Team nicht.
    for (const match of week.map((raw) => mergeTeams(raw, ELO_TEAM_MERGES))) {
      const cls = classifyMatch(match);
      const group = groupOf(match);
      if (cls.excluded || group === null) continue;
      const systemConfig = config[cls.system];
      const home = state.teams.get(teamKey(cls.system, match.homeId));
      const away = state.teams.get(teamKey(cls.system, match.awayId));
      const homeAdvantage = cls.neutral ? systemConfig.neutralHomeAdvantage : systemConfig.homeAdvantage;
      const expected = expectedHome(home?.rating ?? systemConfig.startRating, away?.rating ?? systemConfig.startRating, homeAdvantage);
      const pDraw = drawCurve[cls.system][binOf(expected)]!;
      const pHome = Math.max(0.01, expected - pDraw / 2);
      const pAway = Math.max(0.01, 1 - expected - pDraw / 2);
      const sum = pHome + pDraw + pAway;
      const baseEntry = base.get(`${cls.system}|${cls.neutral ? "neutral" : "heim"}`) ?? base.get(`${cls.system}|heim`);
      const baseline = baseEntry && baseEntry.n > 0
        ? { pHome: baseEntry.home / baseEntry.n, pDraw: baseEntry.draw / baseEntry.n, pAway: baseEntry.away / baseEntry.n }
        : { pHome: 0.45, pDraw: 0.27, pAway: 0.28 };
      predictions.push({
        fixtureId: match.fixtureId, kickoff: match.kickoff, system: cls.system, group,
        established: (home?.games ?? 0) >= minGames && (away?.games ?? 0) >= minGames,
        expected, pHome: pHome / sum, pDraw: pDraw / sum, pAway: pAway / sum, baseline,
        actual: outcome(match)
      });
    }
  }
  return { trainGames: training.history.length, predictions, drawCurve };
}

/** Kennzahlen über eine Auswahl von Vorhersagen, wahlweise für die Vergleichsbasis. */
export function backtestMetrics(predictions: BacktestPrediction[], useBaseline = false): BacktestMetrics | null {
  if (predictions.length === 0) return null;
  let brierExpected = 0;
  let logLoss = 0;
  let brier1x2 = 0;
  let favoriteWins = 0;
  let favoritePredicted = 0;
  for (const prediction of predictions) {
    const p = useBaseline ? prediction.baseline : prediction;
    const expected = useBaseline ? p.pHome + p.pDraw / 2 : prediction.expected;
    const o = { home: prediction.actual === 1 ? 1 : 0, draw: prediction.actual === 0.5 ? 1 : 0, away: prediction.actual === 0 ? 1 : 0 };
    brierExpected += (expected - prediction.actual) ** 2;
    const hit = o.home ? p.pHome : o.draw ? p.pDraw : p.pAway;
    logLoss -= Math.log(Math.max(hit, 1e-6));
    brier1x2 += (p.pHome - o.home) ** 2 + (p.pDraw - o.draw) ** 2 + (p.pAway - o.away) ** 2;
    const homeFavorite = p.pHome >= p.pAway;
    favoriteWins += homeFavorite ? o.home : o.away;
    favoritePredicted += homeFavorite ? p.pHome : p.pAway;
  }
  const n = predictions.length;
  return {
    n,
    brierExpected: brierExpected / n,
    logLoss: logLoss / n,
    brier1x2: brier1x2 / n,
    favoriteWins: favoriteWins / n,
    favoritePredicted: favoritePredicted / n
  };
}

/** Log-Loss je Spiel - für den gepaarten Vergleich zweier Konfigurationen. */
export function logLossOf(prediction: Pick<BacktestPrediction, "pHome" | "pDraw" | "pAway" | "actual">): number {
  const hit = prediction.actual === 1 ? prediction.pHome : prediction.actual === 0.5 ? prediction.pDraw : prediction.pAway;
  return -Math.log(Math.max(hit, 1e-6));
}
