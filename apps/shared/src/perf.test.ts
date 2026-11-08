import { describe, expect, it } from "vitest";
import { goalDiffScale, goalDiffTrend, perfTrend, perfWindow, signed, tableEntryOf } from "./perf";
import type { DashboardFixture } from "./types";

const row = (teamName: string, positions: number[]) => ({ teamName, position: positions.at(-1)!, positions }) as unknown as NonNullable<DashboardFixture["table"]>[number];
const fixture = (homeTeam: string, awayTeam: string, table?: ReturnType<typeof row>[], league = "Liga") =>
  ({ fixtureId: Math.random(), homeTeam, awayTeam, country: "Land", league, table }) as unknown as DashboardFixture;

describe("Tabellenverlauf", () => {
  it("begrenzt den Zeitraum auf die gespielten Spieltage", () => {
    expect(perfWindow(12, "5")).toEqual({ from: 8, to: 12 });
    expect(perfWindow(3, "10")).toEqual({ from: 1, to: 3 });
    expect(perfWindow(12, "all")).toEqual({ from: 1, to: 12 });
  });

  it("nennt Platz jetzt, besten, schlechtesten und die Entwicklung in Worten", () => {
    expect(perfTrend([5, 4, null, 2], 1, 4)).toEqual({ now: 2, best: 2, worst: 5, text: "3 Plätze besser" });
    expect(perfTrend([1, 2], 1, 2)?.text).toBe("1 Platz schlechter");
    expect(perfTrend([null, null], 1, 2)).toBeNull();
  });

  it("holt die Zeile eines Pokalspiels aus der Tabelle eines anderen Spiels", () => {
    const league = fixture("Heim FC", "Gast SV", [row("Heim FC", [3, 1]), row("Gast SV", [1, 2])]);
    const cup = fixture("Heim FC", "Dritter", undefined, "Pokal");
    expect(tableEntryOf([league], cup, "Heim FC")).toEqual({ row: league.table![0], size: 2, competition: "Land|Liga" });
    expect(tableEntryOf([league], cup, "Dritter")).toBeNull();
  });

  it("nimmt die Heimatliga des Spiels, wenn keine andere Tabelle das Team führt", () => {
    const own = { row: row("Heim FC", [3, 1]), size: 14, competition: "Griechenland|Super League" };
    const cup = { ...fixture("Heim FC", "Gast SV", undefined, "Pokal"), domesticTable: { home: own } };
    expect(tableEntryOf([cup], cup, "Heim FC")).toEqual(own);
    expect(tableEntryOf([cup], cup, "Gast SV")).toBeNull();
    const league = fixture("Heim FC", "Dritter", [row("Heim FC", [1, 1])]);
    expect(tableEntryOf([league], cup, "Heim FC")?.competition).toBe("Land|Liga");
  });

  it("im Turnier zählt die Turniertabelle, auch wenn die Heimatliga im Snapshot steht", () => {
    const stage = { row: row("Heim FC", [8, 5]), size: 36, competition: "World|Champions League" };
    const cup = { ...fixture("Heim FC", "Gast SV", undefined, "Ligaphase"), tournamentTable: { home: stage } };
    const league = fixture("Heim FC", "Dritter", [row("Heim FC", [1, 1])]);
    expect(tableEntryOf([league], cup, "Heim FC")).toEqual(stage);
    expect(tableEntryOf([league], cup, "Gast SV")).toBeNull();
  });
});

describe("Tordifferenz-Verlauf", () => {
  it("schreibt das Vorzeichen mit echtem Minus", () => {
    expect([signed(12), signed(0), signed(-3)]).toEqual(["+12", "0", "−3"]);
  });

  it("rechnet die Änderung ab dem Stand vor dem Zeitraum, zu Saisonbeginn ab 0", () => {
    const list = [1, 3, 2, 6, 5, 8];
    expect(goalDiffTrend(list, 2, 6)).toEqual({ now: 8, change: 7 });
    expect(goalDiffTrend(list, 1, 6)).toEqual({ now: 8, change: 8 });
    expect(goalDiffTrend([null, null, -2, -1], 1, 4)).toEqual({ now: -1, change: -1 });
    expect(goalDiffTrend([null, null], 1, 2)).toBeNull();
  });

  it("nimmt die 0 immer in die Skala, auch wenn alle Werte im Plus liegen", () => {
    const scale = goalDiffScale([4, 9, null, 17]);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(20);
    expect(scale.ticks).toEqual([0, 5, 10, 15, 20]);
    expect(goalDiffScale([-3, 2]).ticks).toEqual([-3, -2, -1, 0, 1, 2]);
    expect(goalDiffScale([-7, 8]).ticks).toContain(0);
    expect(goalDiffScale([0, 0])).toMatchObject({ min: 0, max: 1 });
  });
});
