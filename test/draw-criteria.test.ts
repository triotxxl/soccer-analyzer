import assert from "node:assert/strict";
import test from "node:test";
import { scoreDrawFixture } from "../src/draw-criteria.ts";
import { formatDrawAnalysis } from "../src/output.ts";
import type { ApiFixtureOdds, DrawScoreRow } from "../src/types.ts";
import { fixture, history } from "./helpers.ts";

function odds(fixtureId: number): ApiFixtureOdds[] {
  return [{
    fixture: { id: fixtureId },
    bookmakers: [{
      id: 1,
      name: "Test",
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

test("100-Punkte-System ist deterministisch und summiert alle Blöcke", () => {
  const timestamp = 1_800_000_000;
  const upcoming = fixture({ id: 999, timestamp, homeId: 1, awayId: 2 });
  const season = history(timestamp);
  const h2h = [1, 2, 3, 4, 5].map((id) =>
    fixture({
      id: 1_000 + id,
      timestamp: timestamp - id * 30 * 86_400,
      homeId: 1,
      awayId: 2,
      homeGoals: id <= 3 ? 1 : 2,
      awayGoals: id <= 3 ? 1 : 0
    })
  );
  const context = {
    fixture: upcoming,
    seasonFixtures: season,
    homeRecent: season.filter((match) =>
      match.teams.home.id === 1 || match.teams.away.id === 1
    ).slice(0, 5),
    awayRecent: season.filter((match) =>
      match.teams.home.id === 2 || match.teams.away.id === 2
    ).slice(0, 5),
    headToHead: h2h,
    odds: odds(999),
    standingsAvailable: true
  };
  const first = scoreDrawFixture(context);
  const second = scoreDrawFixture(context);
  assert.deepEqual(first, second);
  assert.equal(first.model, "league");
  assert.equal(first.modelVersion, "1.3.0");
  assert.equal(first.score, 69);
  assert.ok("table" in first.breakdown);
  assert.equal(first.breakdown.headToHead, 10);
  assert.ok(first.breakdown.market > 0);
  assert.ok((first.recentHomeResults?.length ?? 0) <= 5);
  assert.ok((first.recentAwayResults?.length ?? 0) <= 5);
  assert.deepEqual(first.h2hSummary?.recentMatches?.[0], {
    date: new Date((timestamp - 30 * 86_400) * 1000).toISOString(),
    homeTeam: "Team 1",
    awayTeam: "Team 2",
    homeGoals: 1,
    awayGoals: 1
  });
  const sum = Object.values(first.breakdown).reduce((total, value) => total + value, 0);
  assert.equal(first.score, Math.max(0, Math.min(100, sum)));
});

test("Wettbewerb ohne Tabelle erhält keine künstlichen Tabellenpunkte", () => {
  const timestamp = 1_800_000_000;
  const row = scoreDrawFixture({
    fixture: fixture({ id: 999, timestamp, homeId: 1, awayId: 2 }),
    seasonFixtures: history(timestamp),
    homeRecent: [],
    awayRecent: [],
    headToHead: [],
    odds: odds(999),
    standingsAvailable: false
  });
  assert.ok("table" in row.breakdown);
  if ("table" in row.breakdown) {
    assert.equal(row.breakdown.table, 0);
    assert.equal(row.breakdown.stability, 0);
    assert.equal(row.breakdown.venueBalance, 0);
    assert.ok(row.breakdown.deductions <= -5);
  }
});

test("H2H-Punkte setzen mindestens 50 Prozent Remis voraus", () => {
  const timestamp = 1_800_000_000;
  const makeH2h = (draws: number, matches: number) =>
    Array.from({ length: matches }, (_, index) => fixture({
      id: 2_000 + index,
      timestamp: timestamp - (index + 1) * 30 * 86_400,
      homeId: 1,
      awayId: 2,
      homeGoals: index < draws ? 1 : 2,
      awayGoals: index < draws ? 1 : 0
    }));
  const score = (headToHead: ReturnType<typeof makeH2h>) =>
    scoreDrawFixture({
      fixture: fixture({ id: 999, timestamp, homeId: 1, awayId: 2 }),
      seasonFixtures: [],
      homeRecent: [],
      awayRecent: [],
      headToHead,
      odds: [],
      standingsAvailable: false
    }).breakdown.headToHead;

  assert.equal(score(makeH2h(2, 5)), 0);
  assert.equal(score(makeH2h(1, 2)), 3);
  assert.equal(score(makeH2h(3, 5)), 10);
});

test("Ausgabe enthält nur Gesamttabelle und Top-12-Tabelle", () => {
  const rows: DrawScoreRow[] = Array.from({ length: 13 }, (_, index) => ({
    fixtureId: index + 1,
    kickoff: "2026-07-30T12:00:00.000Z",
    country: "Germany",
    league: "Bundesliga",
    homeTeam: `Heim ${index + 1}`,
    awayTeam: `Auswärts ${index + 1}`,
    odds: 3.2,
    score: 100 - index,
    confidence: 100,
    modelVersion: "1.3.0",
    marketScore: 100,
    sportsScore: 100,
    availableMaximum: 100,
    warnings: [],
    model: "league",
    rating: "sehr stark",
    breakdown: {
      table: 20,
      stability: 20,
      form: 20,
      goalLevel: 15,
      headToHead: 10,
      market: 10,
      venueBalance: 5,
      deductions: 0
    }
  }));
  const output = formatDrawAnalysis({
    createdAt: "2026-07-29T12:00:00.000Z",
    dates: ["2026-07-29", "2026-07-30"],
    rows,
    apiRequests: 0,
    apiRequestsRemaining: null
  });
  assert.match(output, /Remis-Ranking noch nicht validiert/);
  assert.match(output, /Datenvertrauen/);
  assert.doesNotMatch(output, /Gewinnwahrscheinlichkeit/);
  assert.equal((output.match(/^## /gm) ?? []).length, 2);
  assert.equal((output.match(/Heim 1 – Auswärts 1/g) ?? []).length, 2);
  assert.equal((output.match(/Heim 13 – Auswärts 13/g) ?? []).length, 1);
  assert.doesNotMatch(output, /API-Aufrufe|Gewinnzusage/);
});
