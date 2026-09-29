import type { DashboardMarketKey } from "./types";

/**
 * Die Spalten der Pre-Match-Tabelle - an einer Stelle statt zweimal. Früher stand die Liste als
 * `grid-template-columns` in styles.css und ihre Mindestbreite als Summe in App.tsx; beide
 * mussten von Hand zusammenpassen, sonst klemmten Spalten oder die Tabelle scrollte ohne Not.
 * Jetzt erzeugt dieselbe Liste Raster und Mindestbreite.
 *
 * Je Markt steht nur, was zu ihm passt (Davids Entscheidung vom 28.09.2026). Die Anzeige
 * „Vorteil & Kelly“ ändert die Spalten nicht: Die Kelly-Wetten stehen im eigenen Fenster, nicht
 * in der Übersicht (Davids Entscheidung vom 29.09.2026).
 */

export type TableMarketFilter = "all" | DashboardMarketKey;

export type TableColumnId =
  | "match" | "kickoff" | "form" | "h2h" | "expected" | "points" | "shots"
  | "market" | "recommended"
  | "data";

export interface TableColumn {
  id: TableColumnId;
  /** Mindestbreite in px, am Inhalt gemessen - darunter klemmt die Spalte. */
  min: number;
  /** Anteil am Überschuss. */
  fr: number;
}

// Form 184 und H2H 134 sind die gemessenen Breiten von fünf Punkten samt Beschriftung (siehe
// den früheren Kommentar in styles.css); die übrigen Minima tragen ihren längsten Inhalt.
const COLUMNS: Record<TableColumnId, TableColumn> = {
  match: { id: "match", min: 200, fr: 1.6 },
  kickoff: { id: "kickoff", min: 128, fr: 0.8 },
  form: { id: "form", min: 184, fr: 1 },
  h2h: { id: "h2h", min: 134, fr: 0.8 },
  expected: { id: "expected", min: 84, fr: 0.5 },
  points: { id: "points", min: 52, fr: 0.34 },
  shots: { id: "shots", min: 56, fr: 0.34 },
  market: { id: "market", min: 140, fr: 0.9 },
  recommended: { id: "recommended", min: 280, fr: 1.6 },
  data: { id: "data", min: 84, fr: 0.5 }
};

/** Linker Innenabstand der Zeile (Platz für den Add-Knopf) plus rechter. */
export const ROW_PADDING = 50;
export const COLUMN_GAP = 10;

const GOAL_LINE_MARKETS: ReadonlyArray<TableMarketFilter> = [
  "over15", "under15", "over25", "under25", "over35", "under35"
];
const FIRST_HALF_MARKETS: ReadonlyArray<TableMarketFilter> = [
  "firstHalfOver05", "firstHalfUnder05", "firstHalfOver15", "firstHalfUnder15"
];

/** Torlinien des ganzen Spiels: Die Torerwartung steht dort als Summe. */
export function isGoalLineMarket(market: TableMarketFilter): boolean {
  return GOAL_LINE_MARKETS.includes(market);
}

export function isFirstHalfMarket(market: TableMarketFilter): boolean {
  return FIRST_HALF_MARKETS.includes(market);
}

/** 1X2- und Remis-Punkte nur, wo es um den Ausgang geht. */
export function showsPoints(market: TableMarketFilter): boolean {
  return market === "all" || market === "1x2" || market === "draw";
}

/**
 * Schüsse aufs Tor nur bei Tor- und BTTS-Märkten: Dort sagen sie etwas über die Torgefahr. Ecken
 * dienen keinem Markt der App und stehen nur noch in der Detailansicht und der Heatmap.
 */
export function showsShots(market: TableMarketFilter): boolean {
  return market === "btts" || market === "bttsNo" || isGoalLineMarket(market) || isFirstHalfMarket(market);
}

export function tableColumns(market: TableMarketFilter): TableColumn[] {
  const ids: TableColumnId[] = [
    "match", "kickoff", "form", "h2h", "expected",
    ...(showsPoints(market) ? ["points" as const] : []),
    ...(showsShots(market) ? ["shots" as const] : []),
    "market",
    ...(market === "all" ? ["recommended" as const] : []),
    "data"
  ];
  return ids.map((id) => COLUMNS[id]);
}

export function gridTemplate(columns: ReadonlyArray<TableColumn>): string {
  return columns.map((column) => `minmax(${column.min}px,${column.fr}fr)`).join(" ");
}

export function minimumWidth(columns: ReadonlyArray<TableColumn>): number {
  const content = columns.reduce((sum, column) => sum + column.min, 0);
  return content + Math.max(0, columns.length - 1) * COLUMN_GAP + ROW_PADDING;
}
