import { describe, expect, it } from "vitest";
import { minuteCover, noLastSeasonText, seasonList, seasonMatches } from "./seasonView";
import type { InsightMatch } from "./types";

const game = (fixtureId: number, leagueId: number, season: number, homeId = 1) =>
  ({ fixtureId, leagueId, season, home: { id: homeId }, away: { id: homeId === 1 ? 2 : 1 } }) as unknown as InsightMatch;

describe("Torphasen: nur die laufende Saison", () => {
  const matches = [game(1, 39, 2026), game(2, 39, 2026, 2), game(3, 2, 2026), game(4, 39, 2025), game(5, 2, 2025)];

  it("nimmt im Turnier die Turnierspiele dieser Ausgabe", () => {
    expect(seasonMatches(matches, 1, null, { id: 2, season: 2026 }).map((m) => m.fixtureId)).toEqual([3]);
  });

  it("nimmt in der Liga die Ligaspiele dieser Saison", () => {
    expect(seasonMatches(matches, 1, null, { id: 39, season: 2026 }).map((m) => m.fixtureId)).toEqual([1, 2]);
    expect(seasonMatches(matches, 1, "home", { id: 39, season: 2026 }).map((m) => m.fixtureId)).toEqual([1]);
  });

  it("fällt ohne Spiel im Wettbewerb auf die eigene Liga zurück, nie auf zwei Saisons", () => {
    expect(seasonMatches(matches, 1, null, { id: 81, season: 2026 }).map((m) => m.fixtureId)).toEqual([1, 2]);
  });
});

describe("Torminuten-Abdeckung", () => {
  const played = (homeGoals: number, awayGoals: number, minutesComplete: boolean) =>
    ({ homeGoals, awayGoals, minutesComplete }) as unknown as InsightMatch;

  it("erkennt eine Liga ohne Torminuten, auch wenn ein 0:0 als vollständig zählt (Sambia)", () => {
    const season = [played(0, 0, true), played(1, 0, false), played(1, 4, false)];
    expect(minuteCover(season, [played(0, 0, true)])).toEqual({ total: 1, counted: 1, none: true });
  });

  it("zählt bei teilweisen Torminuten die Spiele", () => {
    const season = [played(2, 1, true), played(1, 0, false), played(0, 0, true)];
    expect(minuteCover(season, season)).toEqual({ total: 3, counted: 2, none: false });
  });

  it("nur torlose Spiele sind keine Lücke", () => {
    const season = [played(0, 0, true)];
    expect(minuteCover(season, season).none).toBe(false);
  });
});

describe("Saisonwahl der Verläufe", () => {
  it("nennt den Grund, wenn einem Team die letzte Saison fehlt", () => {
    expect(noLastSeasonText(["Nafta"], false)).toBe("Nafta: letzte Saison nicht in dieser Liga, zum Beispiel Aufsteiger.");
    expect(noLastSeasonText(["Slavia", "Arsenal"], true)).toBe("Slavia und Arsenal: in der letzten Saison nicht dabei.");
  });

  const entry = { row: { positions: [3, 2], previousPositions: [9], goalDiffs: [1, 2] } } as unknown as Parameters<typeof seasonList>[0];

  it("liefert genau eine Saison und nichts, wo es keine gibt", () => {
    expect(seasonList(entry, "positions", false)).toEqual([3, 2]);
    expect(seasonList(entry, "positions", true)).toEqual([9]);
    expect(seasonList(entry, "goalDiffs", true)).toBeUndefined();
    expect(seasonList(null, "positions", false)).toBeUndefined();
  });
});
