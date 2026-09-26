import { venueFormPercent } from "../../src/quickpick-core.ts";
import { edgeOf } from "./kelly";
import type { DashboardFixture, DashboardMarket, DashboardMarketKey } from "./types";

/**
 * Die kompakte Heatmap: jede Kennzahl als Vorsprung "Heim minus Auswärts". Reine Darstellung -
 * nichts hier geht in einen Tipp, eine Wahrscheinlichkeit oder einen Filter ein, und alles
 * stammt aus dem geladenen Snapshot.
 */

export type HeatSide = "home" | "away" | "even";
export interface Heat { side: HeatSide; intensity: number }

/**
 * Ab welchem Vorsprung eine Zelle voll gesättigt ist. Eine Anzeigeskala, keine Regel: Sie ist
 * so gewählt, dass ein im Spieltag deutlich auffallender Abstand kräftig erscheint und ein
 * kleiner kaum - Elo 250 entspricht grob 80 % Erwartung, 8 Formpunkte fast drei Siegen
 * Unterschied in fünf Spielen, ein halbes erwartetes Tor einem klaren Favoriten.
 */
export const HEAT_SCALE = { elo: 250, form: 8, xg: 0.5, shots: 3, corners: 3 } as const;
export type HeatMetric = keyof typeof HEAT_SCALE;

/** Ab diesem Value (in Wahrscheinlichkeit, 0,10 = 10 Prozentpunkte) ist eine Quote voll grün. */
export const VALUE_FULL = 0.10;

/** Die Märkte der Heatmap. Ein anderer im Markt-Dropdown gewählter Markt kommt als vierter dazu. */
export const HEATMAP_MARKETS: DashboardMarketKey[] = ["1x2", "draw", "btts"];

export function heatmapMarkets(filter: "all" | DashboardMarketKey): DashboardMarketKey[] {
  return filter === "all" || HEATMAP_MARKETS.includes(filter) ? HEATMAP_MARKETS : [...HEATMAP_MARKETS, filter];
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Positiv heißt Heim vorn. 0 (auch -0 nach dem Runden) ist ausgeglichen. */
export function heatOf(value: number, scale: number): Heat {
  if (value === 0 || !Number.isFinite(value)) return { side: "even", intensity: 0 };
  return { side: value > 0 ? "home" : "away", intensity: Math.min(Math.abs(value) / scale, 1) };
}

export interface EloDelta { value: number; home: number; away: number; confidence: number; lowConfidence: boolean }

/**
 * Vereine und Nationalteams stehen auf getrennten Elo-Skalen; ein Abstand zwischen beiden
 * wäre eine Zahl ohne Bedeutung. Die Differenz wird aus den gerundeten Werten gebildet, damit
 * sie zu den beiden Zahlen im Tooltip passt.
 */
export function eloDelta(fixture: DashboardFixture): EloDelta | null {
  const home = fixture.homeElo;
  const away = fixture.awayElo;
  if (!home || !away || home.system !== away.system) return null;
  const confidence = Math.round(Math.min(home.confidence, away.confidence));
  const homeElo = Math.round(home.elo);
  const awayElo = Math.round(away.elo);
  return { value: homeElo - awayElo, home: homeElo, away: awayElo, confidence, lowConfidence: confidence < 50 };
}

export interface FormDelta { value: number; homePoints: number; awayPoints: number; homeGames: number; awayGames: number }

/**
 * Punkte aus den letzten fünf Spielen (Sieg 3, Remis 1), auf fünf Spiele umgerechnet, damit
 * eine Seite mit nur drei Ergebnissen nicht wie eine formschwache aussieht.
 *
 * Die leere Liste wird vorher abgefangen: `venueFormPercent` gibt dafür 0 zurück, und genau
 * dieses 0 las der Daves-Filter einmal als "miserable Form" (siehe `MIN_FORM_SAMPLE`).
 */
export function formDelta(fixture: DashboardFixture): FormDelta | null {
  const home = fixture.form.home.slice(0, 5);
  const away = fixture.form.away.slice(0, 5);
  if (home.length === 0 || away.length === 0) return null;
  const points = (results: typeof home) => Math.round(venueFormPercent(results) / 100 * results.length * 3);
  const homePoints = points(home);
  const awayPoints = points(away);
  return {
    value: Math.round((homePoints / home.length - awayPoints / away.length) * 5),
    homePoints, awayPoints, homeGames: home.length, awayGames: away.length
  };
}

export interface GoalsDelta { value: number; home: number; away: number }

/**
 * Die Torerwartung des Modells, nicht das xG von API-Football. Wie beim Elo aus den gerundeten
 * Werten gebildet, damit der Vorsprung zu den beiden Zahlen in Tabelle und Tooltip passt.
 */
export function expectedGoalsDelta(fixture: DashboardFixture): GoalsDelta {
  const home = round(fixture.expectedGoals.home, 2);
  const away = round(fixture.expectedGoals.away, 2);
  return { value: round(home - away, 2), home, away };
}

export type RecentField = "shotsOnGoal" | "corners";

/** Schnitt der letzten fünf Spiele. Fehlt eine Seite, gibt es keinen Vorsprung - nicht 0. */
export function recentDelta(fixture: DashboardFixture, field: RecentField): GoalsDelta | null {
  const homeValue = fixture.form.homeStats?.[field];
  const awayValue = fixture.form.awayStats?.[field];
  if (typeof homeValue !== "number" || typeof awayValue !== "number") return null;
  const home = round(homeValue, 1);
  const away = round(awayValue, 1);
  return { value: round(home - away, 1), home, away };
}

export type DrawScoreTone = "zero" | "low" | "s50" | "s60" | "s70";

/**
 * Die Stufen des 100-Punkte-Remis-Systems, dieselben Grenzen wie `rating` in
 * `src/draw-criteria.ts` (ab 50 schwach, ab 60 interessant, ab 70 stark). Nur Färbung.
 */
export function drawScoreTone(score: number): DrawScoreTone {
  if (score >= 70) return "s70";
  if (score >= 60) return "s60";
  if (score >= 50) return "s50";
  return score === 0 ? "zero" : "low";
}

export function drawScoreLabel(score: number): string {
  if (score >= 80) return "sehr stark";
  if (score >= 70) return "stark";
  if (score >= 60) return "interessant";
  if (score >= 50) return "schwach";
  return "nicht empfehlen";
}

/**
 * Wie grün eine Quote wird, 0 bis 1, oder null für "nicht färben". Nur mit dem Schalter
 * "Vorteil & Kelly-Einsatz anzeigen" - Davids Entscheidung vom 25.09.2026: Ein großer Value ist
 * laut Messung meist ein Ausrutscher des Modells, eine immer sichtbare Färbung höbe gerade die
 * schwächsten Wetten hervor. `edgeOf` gibt für einen unsicheren 1X2-Markt schon null zurück.
 */
export function valueHeat(market: DashboardMarket | undefined, showEdge: boolean): number | null {
  if (!showEdge || !market) return null;
  const edge = edgeOf(market);
  if (edge === null || edge <= 0) return null;
  return Math.min(edge / VALUE_FULL, 1);
}

/** Vorzeichen immer sichtbar, Komma wie im Rest der App, keine "-0". */
export function formatDelta(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits).replace(".", ",");
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

export type HeatmapColumn = "kickoff" | "team" | HeatMetric | "drawScore" | `market:${DashboardMarketKey}`;

export function heatmapSortValue(fixture: DashboardFixture, column: HeatmapColumn): number | string | null {
  if (column === "kickoff") return Date.parse(fixture.kickoff);
  if (column === "team") return `${fixture.homeTeam} ${fixture.awayTeam}`;
  if (column === "elo") return eloDelta(fixture)?.value ?? null;
  if (column === "form") return formDelta(fixture)?.value ?? null;
  if (column === "xg") return expectedGoalsDelta(fixture).value;
  if (column === "shots") return recentDelta(fixture, "shotsOnGoal")?.value ?? null;
  if (column === "corners") return recentDelta(fixture, "corners")?.value ?? null;
  if (column === "drawScore") return fixture.scores.draw;
  const key = column.slice("market:".length) as DashboardMarketKey;
  return fixture.markets.find((market) => market.key === key)?.odds ?? null;
}

/** Fehlende Werte stehen in beiden Richtungen am Ende, Gleichstand nach Anstoß. */
export function sortHeatmap(fixtures: DashboardFixture[], column: HeatmapColumn, direction: 1 | -1): DashboardFixture[] {
  return [...fixtures].sort((left, right) => {
    const a = heatmapSortValue(left, column);
    const b = heatmapSortValue(right, column);
    if (a === null && b === null) return Date.parse(left.kickoff) - Date.parse(right.kickoff);
    if (a === null) return 1;
    if (b === null) return -1;
    const comparison = typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b, "de")
      : (a as number) - (b as number);
    return comparison * direction || Date.parse(left.kickoff) - Date.parse(right.kickoff);
  });
}
