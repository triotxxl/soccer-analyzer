import type { DashboardDocument, DashboardFixture, DashboardMarket, DashboardMarketKey, FormResult } from "../../shared/src/types";

/** Kleiner Snapshot für die Tests: zwei Ligen an zwei Tagen und ein Pokalspiel ohne belastbares 1X2. */
export function market(key: DashboardMarketKey, probability: number, extra: Partial<DashboardMarket> = {}): DashboardMarket {
  return {
    key, label: key, selection: key, pick: null, selectionTone: "neutral", probability, odds: 2, confidence: 80, score: null,
    recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: [], ...extra,
  };
}

const table = (teams: string[]) => teams.map((teamName, i) => ({
  position: i + 1, teamName, played: 8, wins: 5 - i, draws: 1, losses: 2 + i, points: 16 - 3 * i, goalsFor: 14 - i, goalsAgainst: 8 + i,
  form: (i === 0 ? ["win", "draw", "win", "loss", "win"] : i === 1 ? ["loss"] : []) as FormResult[],
}));

export function fixture(id: number, extra: Partial<DashboardFixture>): DashboardFixture {
  return {
    fixtureId: id, kickoff: "2026-10-27T17:00:00.000Z", country: "Germany", league: "Bundesliga", homeTeam: "Heim FC", awayTeam: "Gast FC",
    modelVersion: "3.6.0", crossLeague: false, dataConfidence: 90, warnings: [], h2hNotice: null,
    form: { scope: "venue", home: ["win", "win", "draw"], away: ["loss"], homeMatches: [], awayMatches: [] },
    h2h: { outcomes: [], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    expectedGoals: { home: 1.8, away: 1.1, total: 2.9 }, scores: { favorite: 70, draw: 20 },
    markets: [
      market("1x2", 0.55, { pick: "1", oddsHome: 1.7, oddsAway: 4.8 }), market("draw", 0.25, { odds: 3.6 }),
      market("over25", 0.58, { odds: 1.8 }), market("under25", 0.42, { odds: 2.0 }),
      market("btts", 0.52, { odds: 1.9 }), market("bttsNo", 0.48, { odds: 1.85 }),
    ],
    ...extra,
  } as DashboardFixture;
}

export const DOCUMENT: DashboardDocument = {
  schemaVersion: 9,
  meta: {
    createdAt: "2026-10-27T13:00:00.000Z", timezone: "Europe/Berlin", sourceFile: "data.json", totalTipicoEvents: 3, selectedTipicoEvents: 3,
    selectedCompetitions: 3, fixtureCount: 3, firstAvailableDate: "2026-10-27", lastAvailableDate: "2026-10-28", maximumDays: 2, maximumHours: 48,
  },
  leagues: [],
  fixtures: [
    fixture(1, {
      kickoff: "2026-10-27T19:30:00.000Z", homeTeam: "Heim FC", awayTeam: "Gast FC", table: table(["Heim FC", "Gast FC", "Dritter SV"]),
      tipico: { homeTeam: "Heim (Tipico)", awayTeam: "Gast (Tipico)", country: "Deutschland", league: "Bundesliga" },
    }),
    fixture(2, {
      kickoff: "2026-10-27T17:00:00.000Z", country: "England", league: "Premier League", homeTeam: "London FC", awayTeam: "Leeds AFC",
      table: table(["Leeds AFC", "London FC"]),
      markets: [
        market("1x2", 0.6, { pick: "2", oddsHome: 4.5, oddsAway: 1.6 }), market("draw", 0.22, { odds: 3.8 }),
        market("over25", 0.71, { odds: 1.5 }), market("under25", 0.29, { odds: 2.6 }),
        market("btts", 0.5, { odds: 1.9 }), market("bttsNo", 0.5, { odds: 1.9 }),
      ],
    }),
    fixture(3, {
      kickoff: "2026-10-28T18:45:00.000Z", league: "DFB Pokal", homeTeam: "Dorf SV", awayTeam: "Heim FC", crossLeague: true, dataConfidence: 40,
      markets: [
        market("1x2", 0.8, { pick: "2", probabilityReliable: false, oddsHome: 9, oddsAway: 1.25 }), market("draw", 0.12, { odds: 6.5 }),
        market("over25", 0.66, { odds: 1.55 }), market("under25", 0.34, { odds: 2.4 }),
        market("btts", 0.4, { odds: 2.1 }), market("bttsNo", 0.6, { odds: 1.7 }),
      ],
    }),
  ],
};
