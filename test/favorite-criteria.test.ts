import assert from "node:assert/strict";
import test from "node:test";
import { scoreFavoriteFixture } from "../src/favorite-criteria.ts";
import { formatFavoriteAnalysis } from "../src/output.ts";
import type { ApiFixture, ApiFixtureOdds, FavoriteScoreRow } from "../src/types.ts";
import { fixture } from "./helpers.ts";

function strongFavoriteHistory(timestamp: number): ApiFixture[] {
  const matches: ApiFixture[] = [];
  for (let index = 1; index <= 10; index += 1) {
    matches.push(fixture({
      id: 100 + index,
      timestamp: timestamp - index * 7 * 86_400,
      homeId: 1,
      awayId: 100 + index,
      homeGoals: 3,
      awayGoals: 0
    }));
    matches.push(fixture({
      id: 200 + index,
      timestamp: timestamp - index * 7 * 86_400 - 1_000,
      homeId: 200 + index,
      awayId: 2,
      homeGoals: 2,
      awayGoals: 0
    }));
  }
  return matches;
}

function favoriteOdds(fixtureId: number): ApiFixtureOdds[] {
  return [{
    fixture: { id: fixtureId },
    bookmakers: [{
      id: 1,
      name: "Tipico Test",
      bets: [{
        id: 1,
        name: "Match Winner",
        values: [
          { value: "Home", odd: "1.40" },
          { value: "Draw", odd: "4.50" },
          { value: "Away", odd: "7.00" }
        ]
      }]
    }]
  }];
}

test("klarer statistisch bestätigter Heimsieg wird hoch bewertet", () => {
  const timestamp = 1_800_000_000;
  const upcoming = fixture({ id: 999, timestamp, homeId: 1, awayId: 2 });
  const season = strongFavoriteHistory(timestamp);
  const headToHead = [1, 2, 3, 4, 5].map((index) =>
    fixture({
      id: 500 + index,
      timestamp: timestamp - index * 30 * 86_400,
      homeId: 1,
      awayId: 2,
      homeGoals: index <= 4 ? 2 : 1,
      awayGoals: index <= 4 ? 0 : 1
    })
  );
  const context = {
    fixture: upcoming,
    seasonFixtures: season,
    homeRecent: season.filter((match) => match.teams.home.id === 1).slice(0, 5),
    awayRecent: season.filter((match) => match.teams.away.id === 2).slice(0, 5),
    headToHead,
    odds: favoriteOdds(999),
    standingsAvailable: true
  };
  const first = scoreFavoriteFixture(context);
  const second = scoreFavoriteFixture(context);
  assert.deepEqual(first, second);
  assert.equal(first.selection, "1");
  assert.equal(first.selectedTeam, "Team 1");
  assert.equal(first.odds, 1.4);
  assert.equal(first.modelVersion, "1.3.0");
  assert.equal(first.score, 95);
  assert.equal(first.rating, "sehr stark");
});

test("fehlende Tabelle und Quoten führen zu Abzügen", () => {
  const timestamp = 1_800_000_000;
  const row = scoreFavoriteFixture({
    fixture: fixture({ id: 999, timestamp, homeId: 1, awayId: 2 }),
    seasonFixtures: [],
    homeRecent: [],
    awayRecent: [],
    headToHead: [],
    odds: [],
    standingsAvailable: false
  });
  assert.equal(row.model, "league");
  assert.ok("deductions" in row.breakdown && row.breakdown.deductions <= -13);
  assert.equal(row.rating, "nicht empfehlen");
});

test("Tipico-Quoten bleiben bei der 1X2-Wertung rein informativ", () => {
  const timestamp = 1_800_000_000;
  const season = strongFavoriteHistory(timestamp);
  const row = scoreFavoriteFixture({
    fixture: fixture({ id: 999, timestamp, homeId: 1, awayId: 2 }),
    seasonFixtures: season,
    homeRecent: season.filter((match) => match.teams.home.id === 1).slice(0, 5),
    awayRecent: season.filter((match) => match.teams.away.id === 2).slice(0, 5),
    headToHead: [],
    odds: favoriteOdds(999),
    standingsAvailable: true,
    tipicoOdds: {
      homeTeam: "Team 1",
      awayTeam: "Team 2",
      home: 9,
      draw: 5,
      away: 1.3
    }
  });
  assert.equal(row.selection, "1");
  assert.equal(row.odds, 1.4);
});

test("1X2-Ausgabe zeigt Tipp, Quote, alle Spiele und Top 16", () => {
  const rows: FavoriteScoreRow[] = Array.from({ length: 17 }, (_, index) => ({
    fixtureId: index + 1,
    kickoff: "2026-07-30T12:00:00.000Z",
    country: "Germany",
    league: "Bundesliga",
    homeTeam: `Heim ${index + 1}`,
    awayTeam: `Auswärts ${index + 1}`,
    selection: "1",
    selectedTeam: `Heim ${index + 1}`,
    odds: 1.5,
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
      market: 20,
      table: 20,
      seasonStrength: 15,
      form: 15,
      goalDominance: 10,
      venueAdvantage: 10,
      headToHead: 5,
      dataQuality: 5,
      deductions: 0
    }
  }));
  const output = formatFavoriteAnalysis({
    createdAt: "2026-07-29T12:00:00.000Z",
    dates: ["2026-07-29", "2026-07-30"],
    rows,
    venueFormRows: [{
      fixtureId: 1,
      kickoff: rows[0]!.kickoff,
      homeTeam: "Form Heim",
      awayTeam: "Form Auswärts",
      selection: "1",
      odds: 1.3,
      homeForm: {
        matches: 10, points: 26, percentage: 26 / 30 * 100,
        wins: 8, draws: 2, losses: 0
      },
      awayForm: {
        matches: 10, points: 14, percentage: 14 / 30 * 100,
        wins: 4, draws: 2, losses: 4
      }
    }],
    apiRequests: 0,
    apiRequestsRemaining: null
  });
  assert.match(output, /\| Tipp \| Quote \|/);
  assert.match(output, /\| Modell \| Datenvertrauen \|/);
  assert.doesNotMatch(output, /Gewinnwahrscheinlichkeit/);
  assert.equal((output.match(/^## /gm) ?? []).length, 3);
  assert.equal((output.match(/Heim 1 – Auswärts 1/g) ?? []).length, 2);
  assert.match(output, /16 stärkste 1X2-Favoriten/);
  assert.equal((output.match(/Heim 16 – Auswärts 16/g) ?? []).length, 2);
  assert.equal((output.match(/Heim 17 – Auswärts 17/g) ?? []).length, 1);
  assert.match(output, /Ergänzung: Heim-\/Auswärtsform 70\/50/);
  assert.match(output, /Form Heim – Form Auswärts/);
});
