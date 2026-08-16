import assert from "node:assert/strict";
import test from "node:test";
import { usesCrossLeagueModel } from "../src/analyzer.ts";
import { scoreCrossLeagueFixture } from "../src/cross-league-criteria.ts";
import type { ApiFixture, ApiFixtureOdds, ApiLeague } from "../src/types.ts";
import { fixture } from "./helpers.ts";

function teamHistory(options: {
  teamId: number;
  leagueId: number;
  country: string;
  cutoff: number;
  wins: boolean;
}): ApiFixture[] {
  return Array.from({ length: 10 }, (_, index) => {
    const opponentId = options.teamId * 100 + index + 1;
    return fixture({
      id: options.teamId * 1_000 + index,
      timestamp: options.cutoff - (index + 1) * 7 * 86_400,
      homeId: options.teamId,
      awayId: opponentId,
      homeGoals: options.wins ? 3 : 0,
      awayGoals: options.wins ? 0 : 2,
      leagueId: options.leagueId,
      leagueName: `Liga ${options.leagueId}`,
      country: options.country
    });
  });
}

function favoriteOdds(fixtureId: number): ApiFixtureOdds[] {
  return [{
    fixture: { id: fixtureId },
    bookmakers: [{
      id: 1,
      name: "API bookmaker",
      bets: [{
        id: 1,
        name: "Match Winner",
        values: [
          { value: "Home", odd: "1.30" },
          { value: "Draw", odd: "5.00" },
          { value: "Away", odd: "9.00" }
        ]
      }]
    }]
  }];
}

test("nur Wettbewerbe außerhalb interner Ligen nutzen Cross-League", () => {
  const upcoming = fixture({
    id: 999,
    timestamp: 1_800_000_000,
    homeId: 1,
    awayId: 2,
    leagueId: 3,
    leagueName: "UEFA Europa League",
    country: "World"
  });
  const league: ApiLeague = {
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: []
  };
  const cup: ApiLeague = {
    league: { id: 3, name: "UEFA Europa League", type: "Cup" },
    country: { name: "World" },
    seasons: []
  };
  assert.equal(usesCrossLeagueModel(upcoming, league), false);
  assert.equal(usesCrossLeagueModel(upcoming, cup), true);
});

test("Cross-League normalisiert verfügbare Evidenz und weist Datenvertrauen aus", () => {
  const timestamp = 1_800_000_000;
  const upcoming = fixture({
    id: 999,
    timestamp,
    homeId: 1,
    awayId: 2,
    leagueId: 3,
    leagueName: "UEFA Europa League",
    country: "World"
  });
  const homeHistory = teamHistory({
    teamId: 1,
    leagueId: 78,
    country: "Germany",
    cutoff: timestamp,
    wins: true
  });
  const awayHistory = teamHistory({
    teamId: 2,
    leagueId: 207,
    country: "Switzerland",
    cutoff: timestamp,
    wins: false
  });
  const first = scoreCrossLeagueFixture({
    fixture: upcoming,
    homeRecent: homeHistory,
    awayRecent: awayHistory,
    homeDomesticFixtures: homeHistory,
    awayDomesticFixtures: awayHistory,
    odds: favoriteOdds(999)
  });
  const second = scoreCrossLeagueFixture({
    fixture: upcoming,
    homeRecent: homeHistory,
    awayRecent: awayHistory,
    homeDomesticFixtures: homeHistory,
    awayDomesticFixtures: awayHistory,
    odds: favoriteOdds(999)
  });
  assert.deepEqual(first, second);
  assert.equal(first.model, "cross-league");
  assert.equal(first.selection, "1");
  assert.equal(first.modelVersion, "1.3.0");
  assert.equal(first.score, 93);
  assert.equal(first.confidence, 75);
  assert.ok("availableMaximum" in first.breakdown);
  assert.ok(
    "availableMaximum" in first.breakdown &&
    first.breakdown.availableMaximum >= 60
  );
});

test("Cross-League erfindet bei dünner Datenlage keine Empfehlung", () => {
  const timestamp = 1_800_000_000;
  const row = scoreCrossLeagueFixture({
    fixture: fixture({
      id: 999,
      timestamp,
      homeId: 1,
      awayId: 2,
      leagueId: 3,
      leagueName: "UEFA Europa League",
      country: "World"
    }),
    homeRecent: [],
    awayRecent: [],
    homeDomesticFixtures: [],
    awayDomesticFixtures: [],
    odds: []
  });
  assert.equal(row.score, 0);
  assert.equal(row.confidence, 5);
  assert.equal(row.rating, "nicht empfehlen – Datenlage");
  assert.ok(
    "warnings" in row.breakdown &&
    row.breakdown.warnings.includes("weniger als 60 mögliche Rohpunkte abgedeckt")
  );
});
