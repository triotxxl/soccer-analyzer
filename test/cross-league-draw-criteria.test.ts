import assert from "node:assert/strict";
import test from "node:test";
import { scoreCrossLeagueDrawFixture } from "../src/cross-league-draw-criteria.ts";
import type { ApiFixture, ApiFixtureOdds } from "../src/types.ts";
import { fixture } from "./helpers.ts";

function balancedHistory(options: {
  teamId: number;
  leagueId: number;
  country: string;
  cutoff: number;
  away: boolean;
}): ApiFixture[] {
  return Array.from({ length: 10 }, (_, index) => fixture({
    id: options.teamId * 1_000 + index,
    timestamp: options.cutoff - (index + 1) * 7 * 86_400,
    homeId: options.away ? options.teamId * 100 + index + 1 : options.teamId,
    awayId: options.away ? options.teamId : options.teamId * 100 + index + 1,
    homeGoals: 1,
    awayGoals: 1,
    leagueId: options.leagueId,
    leagueName: `Liga ${options.leagueId}`,
    country: options.country
  }));
}

function balancedOdds(fixtureId: number): ApiFixtureOdds[] {
  return [{
    fixture: { id: fixtureId },
    bookmakers: [{
      id: 1,
      name: "API bookmaker",
      bets: [{
        id: 1,
        name: "Match Winner",
        values: [
          { value: "Home", odd: "2.70" },
          { value: "Draw", odd: "3.20" },
          { value: "Away", odd: "2.75" }
        ]
      }]
    }]
  }];
}

test("ausgeglichenes Cross-League-Spiel erhält Stärke und Datenvertrauen", () => {
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
  const home = balancedHistory({
    teamId: 1,
    leagueId: 78,
    country: "Germany",
    cutoff: timestamp,
    away: false
  });
  const away = balancedHistory({
    teamId: 2,
    leagueId: 207,
    country: "Switzerland",
    cutoff: timestamp,
    away: true
  });
  const h2h = Array.from({ length: 3 }, (_, index) => fixture({
    id: 5_000 + index,
    timestamp: timestamp - (index + 1) * 30 * 86_400,
    homeId: 1,
    awayId: 2,
    homeGoals: 1,
    awayGoals: 1,
    leagueId: 3,
    leagueName: "UEFA Europa League",
    country: "World"
  }));
  const context = {
    fixture: upcoming,
    homeRecent: home,
    awayRecent: away,
    homeDomesticFixtures: home,
    awayDomesticFixtures: away,
    headToHead: h2h,
    odds: balancedOdds(999)
  };
  const first = scoreCrossLeagueDrawFixture(context);
  const second = scoreCrossLeagueDrawFixture(context);
  assert.deepEqual(first, second);
  assert.equal(first.model, "cross-league");
  assert.equal(first.odds, 3.2);
  assert.equal(first.modelVersion, "1.3.0");
  assert.equal(first.score, 98);
  assert.ok(first.confidence >= 75);
  assert.equal(first.rating, "sehr stark");
  assert.ok("availableMaximum" in first.breakdown);
});

test("dünne Cross-League-Datenlage erzeugt keine Remis-Empfehlung", () => {
  const row = scoreCrossLeagueDrawFixture({
    fixture: fixture({
      id: 999,
      timestamp: 1_800_000_000,
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
    headToHead: [],
    odds: []
  });
  assert.equal(row.score, 0);
  assert.equal(row.model, "cross-league");
  assert.equal(row.rating, "nicht empfehlen – Datenlage");
});

test("Cross-League-Anzeige verwendet die letzten Pflichtspiele insgesamt", () => {
  const timestamp = 1_800_000_000;
  const row = scoreCrossLeagueDrawFixture({
    fixture: fixture({
      id: 999,
      timestamp,
      homeId: 1,
      awayId: 2,
      leagueId: 3,
      leagueName: "UEFA Europa League",
      country: "World"
    }),
    homeRecent: [
      fixture({ id: 101, timestamp: timestamp - 100, homeId: 9, awayId: 1, homeGoals: 2, awayGoals: 0 }),
      fixture({ id: 102, timestamp: timestamp - 200, homeId: 1, awayId: 8, homeGoals: 3, awayGoals: 1 })
    ],
    awayRecent: [
      fixture({ id: 201, timestamp: timestamp - 100, homeId: 2, awayId: 7, homeGoals: 1, awayGoals: 1 }),
      fixture({ id: 202, timestamp: timestamp - 200, homeId: 6, awayId: 2, homeGoals: 0, awayGoals: 2 })
    ],
    homeDomesticFixtures: [],
    awayDomesticFixtures: [],
    headToHead: [],
    odds: []
  });
  assert.deepEqual(row.recentHomeResults, ["loss", "win"]);
  assert.deepEqual(row.recentAwayResults, ["draw", "win"]);
});

test("Cross-League-H2H-Punkte setzen mindestens 50 Prozent Remis voraus", () => {
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
  const makeH2h = (draws: number, matches: number) =>
    Array.from({ length: matches }, (_, index) => fixture({
      id: 6_000 + index,
      timestamp: timestamp - (index + 1) * 30 * 86_400,
      homeId: 1,
      awayId: 2,
      homeGoals: index < draws ? 1 : 2,
      awayGoals: index < draws ? 1 : 0,
      leagueId: 3,
      leagueName: "UEFA Europa League",
      country: "World"
    }));
  const score = (headToHead: ReturnType<typeof makeH2h>) =>
    scoreCrossLeagueDrawFixture({
      fixture: upcoming,
      homeRecent: [],
      awayRecent: [],
      homeDomesticFixtures: [],
      awayDomesticFixtures: [],
      headToHead,
      odds: []
    }).breakdown.headToHead;

  assert.equal(score(makeH2h(2, 5)), 0);
  assert.equal(score(makeH2h(1, 2)), 1);
  assert.equal(score(makeH2h(3, 5)), 5);
});
