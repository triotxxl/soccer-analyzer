import type { DashboardFixture } from "./types";

/**
 * Tabellenverlauf (Platz nach jedem Spieltag) für beide Apps: Neo zeigt ihn im H2H-Reiter, die alte App seit
 * 02.11.2026 bei den direkten Duellen. Die Plätze stehen ab schemaVersion 11 je Tabellenzeile im Snapshot
 * (`positions`, `previousPositions`, `tablePositions` in src/draw-criteria.ts) - 0 Aufrufe. Der
 * Tordifferenz-Verlauf (ab schemaVersion 13, `goalDiffs`, `previousGoalDiffs`) steht in beiden Apps darunter.
 */

export type TableEntry = NonNullable<DashboardFixture["table"]>[number];

/**
 * Die Tabellenzeile eines Teams: In der Liga gilt die Tabelle des Spiels, im Turnier die des Turniers (Ligaphase,
 * Gruppe; `tournamentTable`, ab schemaVersion 14, Davids Vorgabe). Hat der Wettbewerb keine Tabelle, die eigene
 * Liga des Teams: aus der Tabelle eines anderen Spiels im Snapshot, sonst aus `domesticTable`.
 */
export function tableEntryOf(fixtures: readonly DashboardFixture[], fixture: DashboardFixture, teamName: string):
  { row: TableEntry; size: number; competition: string } | null {
  const side = teamName === fixture.homeTeam ? "home" : teamName === fixture.awayTeam ? "away" : null;
  const tournament = side && fixture.tournamentTable?.[side];
  if (tournament) return tournament;
  for (const f of [fixture, ...fixtures]) {
    const row = f.table?.find((r) => r.teamName === teamName);
    if (row) return { row, size: f.table!.length, competition: `${f.country}|${f.league}` };
  }
  return (side && fixture.domesticTable?.[side]) ?? null;
}

export type PerfRange = "5" | "10" | "all";

/** Spieltage im gewählten Zeitraum: `from` bis `played`, bei „Letzte 5/10“ höchstens so viele. */
export function perfWindow(played: number, range: PerfRange): { from: number; to: number } {
  const span = range === "all" ? played : Math.min(played, Number(range));
  return { from: Math.max(1, played - span + 1), to: played };
}

/** Platz jetzt, bester und schlechtester im Zeitraum und die Entwicklung in Worten. */
export function perfTrend(list: ReadonlyArray<number | null>, from: number, to: number):
  { now: number; best: number; worst: number; text: string } | null {
  const window = list.slice(from - 1, to).filter((p): p is number => typeof p === "number");
  const now = window[window.length - 1], start = window[0];
  if (now === undefined || start === undefined) return null;
  const diff = start - now, places = (k: number) => `${k} ${k === 1 ? "Platz" : "Plätze"}`;
  return { now, best: Math.min(...window), worst: Math.max(...window), text: diff > 0 ? `${places(diff)} besser` : diff < 0 ? `${places(-diff)} schlechter` : "gleich" };
}

/** Tordifferenz mit Vorzeichen, mit echtem Minuszeichen: „+12“, „0“, „−3“. */
export function signed(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0";
}

/** Skala des Tordifferenz-Verlaufs: enthält immer 0, Teilstriche auf runden Werten, die 0 ist immer einer davon. */
export function goalDiffScale(values: ReadonlyArray<number | null | undefined>): { min: number; max: number; ticks: number[] } {
  const known = values.filter((v): v is number => typeof v === "number");
  const low = Math.min(0, ...known), high = Math.max(0, ...known), span = Math.max(1, high - low);
  const step = span <= 6 ? 1 : span <= 12 ? 2 : span <= 30 ? 5 : span <= 60 ? 10 : 20;
  const min = Math.floor(low / step) * step, max = Math.max(min + step, Math.ceil(high / step) * step);
  const ticks: number[] = [];
  for (let t = min; t <= max; t += step) ticks.push(t);
  return { min, max, ticks };
}

/**
 * Tordifferenz jetzt und ihre Änderung im Zeitraum. Die Änderung zählt ab dem Stand vor dem ersten Spieltag des
 * Zeitraums - bei „Letzte 5“ also fünf Spieltage, nicht vier -, zu Saisonbeginn ab 0.
 */
export function goalDiffTrend(list: ReadonlyArray<number | null>, from: number, to: number): { now: number; change: number } | null {
  const window = list.slice(from - 1, to).filter((v): v is number => typeof v === "number");
  const now = window[window.length - 1];
  if (now === undefined) return null;
  return { now, change: now - (list.slice(0, from - 1).filter((v): v is number => typeof v === "number").at(-1) ?? 0) };
}
