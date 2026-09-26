import { describe, expect, it } from "vitest";
import {
  drawScoreTone, eloDelta, expectedGoalsDelta, formatDelta, formDelta, heatmapMarkets, heatOf, recentDelta,
  sortHeatmap, valueHeat
} from "./heatmap";
import type { DashboardFixture, DashboardMarket } from "./types";

function market(overrides: Partial<DashboardMarket> = {}): DashboardMarket {
  return {
    key: "draw", label: "Remis", selection: "Unentschieden (X)", pick: null, selectionTone: "draw",
    probability: 0.3, odds: 4, confidence: 85, score: null,
    recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: [], ...overrides
  };
}

function fixture(overrides: Partial<DashboardFixture> = {}): DashboardFixture {
  return {
    fixtureId: 1, kickoff: "2026-09-25T18:00:00.000Z", country: "Deutschland", league: "Bundesliga",
    homeTeam: "Heim FC", awayTeam: "Gast FC", modelVersion: "test", crossLeague: false, dataConfidence: 85,
    warnings: [], h2hNotice: null,
    form: { scope: "venue", home: ["win", "win", "draw"], away: ["loss", "draw", "loss"], homeMatches: [], awayMatches: [] },
    h2h: { outcomes: [], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    expectedGoals: { home: 1.62, away: 1.15, total: 2.77 }, scores: { favorite: 70, draw: 44 },
    markets: [market()], ...overrides
  };
}

const elo = (value: number, system: "club" | "national" = "club", confidence = 80) =>
  ({ elo: value, confidence, system, asOf: "2026-09-24T00:00:00.000Z" });

describe("Heatmap-Werte", () => {
  it("zählt jeden Vorsprung als Heim minus Auswärts", () => {
    const current = fixture({ homeElo: elo(1895.4), awayElo: elo(1987.2) });
    expect(eloDelta(current)).toMatchObject({ value: -92, home: 1895, away: 1987 });
    expect(expectedGoalsDelta(current).value).toBe(0.47);
    // Aus den angezeigten Werten gerechnet: 1,32 zu 1,11 ergibt +0,21, nicht +0,22.
    expect(expectedGoalsDelta(fixture({ expectedGoals: { home: 1.3240, away: 1.1085, total: 2.43 } })).value).toBe(0.21);
    expect(heatOf(-92, 250)).toEqual({ side: "away", intensity: 92 / 250 });
    expect(heatOf(0.47, 0.5).side).toBe("home");
  });

  it("vergleicht kein Elo zwischen Verein und Nationalteam und markiert wenig Vertrauen", () => {
    expect(eloDelta(fixture({ homeElo: elo(1800), awayElo: elo(1700, "national") }))).toBeNull();
    expect(eloDelta(fixture({ homeElo: elo(1800) }))).toBeNull();
    expect(eloDelta(fixture({ homeElo: elo(1800, "club", 40), awayElo: elo(1700) }))?.lowConfidence).toBe(true);
  });

  it("rechnet die Form in Punkte aus fünf Spielen um und liest eine leere Liste nicht als 0", () => {
    // Heim 7 aus 3 Spielen, Gast 1 aus 3: (7/3 - 1/3) × 5 = 10.
    expect(formDelta(fixture())).toMatchObject({ value: 10, homePoints: 7, awayPoints: 1 });
    expect(formDelta(fixture({ form: { ...fixture().form, away: [] } }))).toBeNull();
  });

  it("gibt ohne Schuss- oder Eckenzahlen einer Seite keinen Vorsprung aus", () => {
    const stats = (shotsOnGoal: number | null) => ({ shotsOnGoal, corners: 5, matches: 5 });
    const current = fixture({ form: { ...fixture().form, homeStats: stats(4.2), awayStats: stats(7.2) } });
    expect(recentDelta(current, "shotsOnGoal")?.value).toBe(-3);
    expect(recentDelta(current, "corners")?.value).toBe(0);
    expect(recentDelta(fixture({ form: { ...fixture().form, homeStats: stats(null), awayStats: stats(3) } }), "shotsOnGoal")).toBeNull();
    expect(recentDelta(fixture(), "corners")).toBeNull();
  });

  it("kappt die Farbe bei voller Sättigung und schreibt nie -0", () => {
    expect(heatOf(900, 250).intensity).toBe(1);
    expect(heatOf(0, 250)).toEqual({ side: "even", intensity: 0 });
    expect(formatDelta(-0, 2)).toBe("0,00");
    expect(formatDelta(0.17, 2)).toBe("+0,17");
    expect(formatDelta(-3, 1)).toBe("-3,0");
  });

  it("färbt Value nur mit Schalter und nie bei einer unsicheren 1X2-Wahrscheinlichkeit", () => {
    const withValue = market({ probability: 0.3, odds: 4 }); // 30 % gegen 25 % aus der Quote
    expect(valueHeat(withValue, false)).toBeNull();
    expect(valueHeat(withValue, true)).toBeCloseTo(0.5);
    expect(valueHeat(market({ probability: 0.2, odds: 4 }), true)).toBeNull();
    expect(valueHeat(market({ key: "1x2", probability: 0.9, odds: 2, probabilityReliable: false }), true)).toBeNull();
  });

  it("stuft die Remis-Punkte nach den Grenzen des Remis-Systems", () => {
    expect([0, 44, 50, 60, 70, 85].map(drawScoreTone)).toEqual(["zero", "low", "s50", "s60", "s70", "s70"]);
  });

  it("zeigt 1X2, Remis und BTTS und nimmt einen anderen gewählten Markt als vierten dazu", () => {
    expect(heatmapMarkets("all")).toEqual(["1x2", "draw", "btts"]);
    expect(heatmapMarkets("draw")).toEqual(["1x2", "draw", "btts"]);
    expect(heatmapMarkets("over25")).toEqual(["1x2", "draw", "btts", "over25"]);
  });

  it("sortiert fehlende Werte in beiden Richtungen ans Ende", () => {
    const strong = fixture({ fixtureId: 1, homeElo: elo(1900), awayElo: elo(1600) });
    const weak = fixture({ fixtureId: 2, homeElo: elo(1600), awayElo: elo(1900) });
    const none = fixture({ fixtureId: 3 });
    expect(sortHeatmap([none, weak, strong], "elo", -1).map((item) => item.fixtureId)).toEqual([1, 2, 3]);
    expect(sortHeatmap([none, strong, weak], "elo", 1).map((item) => item.fixtureId)).toEqual([2, 1, 3]);
  });
});
