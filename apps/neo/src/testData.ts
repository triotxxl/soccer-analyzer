import type { DashboardDocument, DashboardFixture, DashboardMarket, DashboardMarketKey, FormResult, FixtureInsights, TeamElo } from "../../shared/src/types";
import type { RecentMatchSummary } from "../../../src/types";

/**
 * Kleiner Snapshot für die Tests: zwei Ligen an zwei Tagen und ein Pokalspiel ohne belastbares 1X2.
 * `marketDetail` trägt London - Leeds voll, das Pokalspiel ohne Richtung, Heim - Gast gar nicht (alte Analyse).
 */
export function market(key: DashboardMarketKey, probability: number, extra: Partial<DashboardMarket> = {}): DashboardMarket {
  return {
    key, label: key, selection: key, pick: null, selectionTone: "neutral", probability, odds: 2, confidence: 80, score: null,
    recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: [], ...extra,
  };
}

const table = (teams: string[]) => teams.map((teamName, i) => ({
  position: i + 1, teamName, played: 8, wins: 5 - i, draws: 1, losses: 2 + i, points: 16 - 3 * i, goalsFor: 14 - i, goalsAgainst: 8 + i,
  form: (i === 0 ? ["win", "draw", "win", "loss", "win"] : i === 1 ? ["loss"] : []) as FormResult[],
  positions: i === 0 ? [3, 2, 1, 1] : i === 1 ? [1, 1, 2, 2] : [2, 3, 3, 3],
  goalDiffs: i === 0 ? [1, 3, 2, 6] : i === 1 ? [2, 1, 3, 4] : [-1, -2, -2, -3],
  ...(i === 0 ? { previousPositions: [5, 4, 4, 3] } : {}),
}));

/** Direkte Duelle London - Leeds: fünf Pflichtspiele (neueste zuerst) und ein Testspiel, das nicht zählt. */
const duel = (id: number, date: string, londonHome: boolean, london: number, leeds: number, extra: Partial<RecentMatchSummary> = {}): RecentMatchSummary => ({
  fixtureId: id, teamWasHome: londonHome, date, league: "Premier League", friendly: false,
  homeTeam: londonHome ? "London FC" : "Leeds AFC", awayTeam: londonHome ? "Leeds AFC" : "London FC",
  homeGoals: londonHome ? london : leeds, awayGoals: londonHome ? leeds : london, ...extra,
});
export const HISTORY: RecentMatchSummary[] = [
  duel(501, "2026-04-18T14:30:00Z", false, 0, 3),
  duel(502, "2025-11-29T15:00:00Z", true, 2, 0),
  duel(503, "2025-07-12T15:00:00Z", true, 4, 4, { friendly: true, league: "Friendlies Clubs" }),
  duel(504, "2025-03-08T15:00:00Z", false, 1, 1),
  duel(505, "2024-10-19T15:00:00Z", true, 3, 0),
  duel(506, "2024-02-24T15:00:00Z", false, 0, 2),
];

const elo = (value: number, extra: Partial<TeamElo> = {}): TeamElo =>
  ({ elo: value, confidence: 80, system: "club", asOf: "2026-10-28T11:45:00.000Z", ...extra });

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
  schemaVersion: 14,
  meta: {
    createdAt: "2026-10-27T13:00:00.000Z", timezone: "Europe/Berlin", sourceFile: "data.json", totalTipicoEvents: 3, selectedTipicoEvents: 3,
    selectedCompetitions: 3, fixtureCount: 3, firstAvailableDate: "2026-10-27", lastAvailableDate: "2026-10-28", maximumDays: 2, maximumHours: 48,
  },
  leagues: [],
  fixtures: [
    fixture(1, {
      kickoff: "2026-10-27T19:30:00.000Z", homeTeam: "Heim FC", awayTeam: "Gast FC", table: table(["Heim FC", "Gast FC", "Dritter SV"]),
      tipico: { homeTeam: "Heim (Tipico)", awayTeam: "Gast (Tipico)", country: "Deutschland", league: "Bundesliga" },
      homeElo: elo(1872, { league: "Bundesliga", leagueLevel: 1850, leagueClubs: 18 }),
      awayElo: elo(1840, { league: "Bundesliga", leagueLevel: 1850, leagueClubs: 18 }),
    }),
    fixture(2, {
      kickoff: "2026-10-27T17:00:00.000Z", country: "England", league: "Premier League", homeTeam: "London FC", awayTeam: "Leeds AFC",
      table: table(["Leeds AFC", "London FC"]),
      markets: [
        market("1x2", 0.6, { pick: "2", oddsHome: 4.5, oddsAway: 1.6 }), market("draw", 0.22, { odds: 3.8 }),
        market("over25", 0.71, { odds: 1.5 }), market("under25", 0.29, { odds: 2.6 }),
        market("btts", 0.5, { odds: 1.9 }), market("bttsNo", 0.5, { odds: 1.9 }),
      ],
      h2h: { outcomes: [], btts: [], draws: 1, consecutiveDraws: 0, matches: HISTORY.slice(0, 5), history: HISTORY },
      marketDetail: {
        totalGoals: [0.06, 0.17, 0.24, 0.23, 0.16, 0.08, 0.06],
        exactScores: [{ home: 1, away: 1, probability: 0.12 }, { home: 1, away: 2, probability: 0.11 }, { home: 0, away: 1, probability: 0.09 }, { home: 2, away: 1, probability: 0.08 }],
        halfTime: { home: 0.3, draw: 0.42, away: 0.28 },
        firstGoal: { home: 0.4, none: 0.07, away: 0.53 },
      },
    }),
    fixture(3, {
      kickoff: "2026-10-28T18:45:00.000Z", league: "DFB Pokal", homeTeam: "Dorf SV", awayTeam: "Heim FC", crossLeague: true, dataConfidence: 40,
      markets: [
        market("1x2", 0.8, { pick: "2", probabilityReliable: false, oddsHome: 9, oddsAway: 1.25 }), market("draw", 0.12, { odds: 6.5 }),
        market("over25", 0.66, { odds: 1.55 }), market("under25", 0.34, { odds: 2.4 }),
        market("btts", 0.4, { odds: 2.1 }), market("bttsNo", 0.6, { odds: 1.7 }),
      ],
      marketDetail: { totalGoals: [0.1, 0.2, 0.25, 0.2, 0.13, 0.07, 0.05], exactScores: null, halfTime: null, firstGoal: null },
      homeElo: elo(1402, { confidence: 22, league: "Regionalliga Nord", leagueLevel: 1430, leagueClubs: 16 }),
      awayElo: elo(1872, { league: "Bundesliga", leagueLevel: 1850, leagueClubs: 18 }),
      classGap: { level: "extreme", stronger: "away", source: "elo", label: "Liga-Niveau (Vereins-Elo) 1430 gegen 1850 · Torfaktor 0,45" },
    }),
  ],
};

/** Detailkennzahlen für London - Leeds (Torphasen): zwei Duelle mit Torminuten, ein Ligaspiel je Team. */
const im = (id: number, home: number, away: number, goals: Array<[number, number]>, extra: Partial<FixtureInsights["h2h"][number]> = {}) => ({
  fixtureId: id, date: "2026-04-18T14:30:00Z", leagueId: 39, league: "Premier League", country: "England", season: 2026,
  home: { id: home, name: String(home) }, away: { id: away, name: String(away) }, homeGoals: 0, awayGoals: 0,
  halfTimeHomeGoals: null, halfTimeAwayGoals: null, goals: goals.map(([teamId, minute]) => ({ teamId, minute })),
  minutesComplete: true, stats: { home: null, away: null }, ...extra,
});
export const INSIGHTS: FixtureInsights = {
  fixtureId: 2, league: { id: 39, name: "Premier League", country: "England", season: 2026 },
  home: { id: 10, name: "London FC" }, away: { id: 20, name: "Leeds AFC" },
  homeMatches: [im(601, 10, 30, [[10, 12], [10, 80]]), im(602, 40, 10, [[40, 33]])],
  awayMatches: [im(603, 50, 20, [[20, 5], [50, 88]])],
  h2h: [im(501, 20, 10, [[20, 3], [20, 50], [20, 91]]), im(502, 10, 20, [[10, 44], [10, 60]]), im(503, 10, 20, [[10, 1]], { league: "Friendlies Clubs" })],
  coverage: { matches: 3, withMinutes: 3, withStats: 0 }, fetchedAt: "2026-10-28T10:00:00Z", apiRequests: 4,
};
