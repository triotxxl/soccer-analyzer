import { describe, expect, it } from "vitest";
import { eloAgainstOf, eloAgainstText } from "./eloAgainst";
import type { DashboardFixture, DashboardMarket, TeamElo } from "./types";

const elo = (value: number, extra: Partial<TeamElo> = {}): TeamElo =>
  ({ elo: value, confidence: 90, system: "club", asOf: "2026-11-04", ...extra });
const markets = (pick: "1" | "2", probability: number, draw = 0.2, reliable?: boolean) => [
  { key: "1x2", pick, probability, ...(reliable === false ? { probabilityReliable: false } : {}) },
  { key: "draw", pick: null, probability: draw }
] as unknown as DashboardMarket[];
const fixture = (over: Partial<DashboardFixture>) => ({
  crossLeague: true, homeElo: elo(2103), awayElo: elo(2326), markets: markets("2", 0.21, 0.18), ...over
}) as Pick<DashboardFixture, "crossLeague" | "homeElo" | "awayElo" | "markets">;

describe("Hinweis Elo dagegen", () => {
  it("zeigt AEK - Real: Modell Heim, Elo Gast 223 Punkte vorn, auch wenn der Tipp auf Gast steht", () => {
    expect(eloAgainstOf(fixture({}))).toEqual({ modelSide: "home", gap: 223 });
  });

  it("gilt auch, wenn das Modell die Gastseite vorn sieht", () => {
    expect(eloAgainstOf(fixture({ homeElo: elo(2061), awayElo: elo(1884), markets: markets("2", 0.47, 0.24) })))
      .toEqual({ modelSide: "away", gap: 177 });
  });

  it("schweigt unter 100 Punkten und wenn Modell und Elo dieselbe Seite sehen", () => {
    expect(eloAgainstOf(fixture({ homeElo: elo(2200), awayElo: elo(2299) }))).toBeNull();
    expect(eloAgainstOf(fixture({ homeElo: elo(2300), awayElo: elo(2000) }))).toBeNull();
  });

  it("gilt nur für Vereinsspiele zwischen Ligen mit belastbarer Chance und belastbarem Elo", () => {
    expect(eloAgainstOf(fixture({ crossLeague: false }))).toBeNull();
    expect(eloAgainstOf(fixture({ homeElo: elo(1500, { system: "national" }), awayElo: elo(1900, { system: "national" }) }))).toBeNull();
    expect(eloAgainstOf(fixture({ homeElo: elo(2103, { confidence: 20 }) }))).toBeNull();
    expect(eloAgainstOf(fixture({ markets: markets("2", 0.21, 0.18, false) }))).toBeNull();
    expect(eloAgainstOf(fixture({ awayElo: undefined }))).toBeNull();
  });

  it("nennt beide Teams, den Abstand und warnt", () => {
    const text = eloAgainstText({ modelSide: "home", gap: 223 }, "AEK", "Real");
    expect(text).toContain("Das Modell sieht AEK vorn");
    expect(text).toContain("Real 223 Punkte stärker");
    expect(text).toContain("kann auch Zufall sein");
  });
});
