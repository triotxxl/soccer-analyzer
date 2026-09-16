import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FixtureInsightPanels } from "./FixtureInsights";
import type { FixtureInsights } from "./types";

const LEAGUE = { id: 78, name: "Bundesliga", country: "Deutschland", season: 2026 };

function insights(): FixtureInsights {
  return {
    fixtureId: 900,
    league: LEAGUE,
    home: { id: 10, name: "Heim FC" },
    away: { id: 20, name: "Gast FC" },
    homeMatches: [],
    awayMatches: [],
    h2h: [],
    coverage: { matches: 0, withMinutes: 0, withStats: 0 },
    fetchedAt: "2026-09-14T10:00:00.000Z",
    apiRequests: 0
  };
}

/**
 * Die Reihenfolge der Panels ist Teil der Bedienung: Erst die Torphasen, dann die direkten
 * Duelle, darunter die Match-Statistiken und zuletzt die Trends. Ein neues Panel gehört an
 * seinen Platz, nicht ans Ende.
 */
describe("Aufbau der Detailansicht", () => {
  afterEach(cleanup);

  it("rendert die Panels in der festgelegten Reihenfolge", () => {
    render(<FixtureInsightPanels insights={insights()} timezone="Europe/Berlin" />);
    expect(screen.getAllByRole("region").map((panel) => panel.getAttribute("aria-label"))).toEqual([
      "Torphasen",
      "Direkte Begegnungen",
      "Match-Statistiken",
      "Trends"
    ]);
  });
});
