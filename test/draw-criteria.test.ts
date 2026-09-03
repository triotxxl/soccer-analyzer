import assert from "node:assert/strict";
import test from "node:test";
import { buildTable, leagueAverages, roundStage, scoreDrawFixture, tableScopeOf } from "../src/draw-criteria.ts";
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
    awayGoals: 1,
    halfTimeHomeGoals: 1,
    halfTimeAwayGoals: 1
  });
  const sum = Object.values(first.breakdown).reduce((total, value) => total + value, 0);
  assert.equal(first.score, Math.max(0, Math.min(100, sum)));
});

test("leagueAverages berechnet Torschnitt, BTTS- und Über-Quoten aus abgeschlossenen Spielen", () => {
  const timestamp = 1_800_000_000;
  const matches = [
    fixture({ id: 1, timestamp: timestamp - 86_400, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 1 }),
    fixture({ id: 2, timestamp: timestamp - 2 * 86_400, homeId: 3, awayId: 4, homeGoals: 1, awayGoals: 0 }),
    fixture({ id: 3, timestamp: timestamp - 3 * 86_400, homeId: 5, awayId: 6, homeGoals: 0, awayGoals: 0 }),
    fixture({ id: 4, timestamp: timestamp - 4 * 86_400, homeId: 7, awayId: 8 }),
    fixture({ id: 5, timestamp: timestamp + 86_400, homeId: 9, awayId: 10, homeGoals: 3, awayGoals: 3 })
  ];
  const stats = leagueAverages(matches, timestamp);
  assert.deepEqual(stats, {
    matches: 3,
    avgGoalsTotal: (3 + 1 + 0) / 3,
    bttsRate: 1 / 3,
    over15Rate: 1 / 3,
    over25Rate: 1 / 3,
    homeWinRate: 2 / 3,
    drawRate: 1 / 3,
    awayWinRate: 0
  });
});

test("leagueAverages liefert null ohne abgeschlossene Spiele", () => {
  const timestamp = 1_800_000_000;
  const matches = [fixture({ id: 1, timestamp: timestamp - 86_400, homeId: 1, awayId: 2 })];
  assert.equal(leagueAverages(matches, timestamp), null);
  assert.equal(leagueAverages([], timestamp), null);
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
    apiRequestsRemaining: null,
    leagues: []
  });
  assert.match(output, /Remis-Ranking noch nicht validiert/);
  assert.match(output, /Datenvertrauen/);
  assert.doesNotMatch(output, /Gewinnwahrscheinlichkeit/);
  assert.equal((output.match(/^## /gm) ?? []).length, 2);
  assert.equal((output.match(/Heim 1 – Auswärts 1/g) ?? []).length, 2);
  assert.equal((output.match(/Heim 13 – Auswärts 13/g) ?? []).length, 1);
  assert.doesNotMatch(output, /API-Aufrufe|Gewinnzusage/);
});

test("buildTable ohne Geltungsbereich zählt weiter alles vor dem Cutoff", () => {
  const cutoff = 2_000_000_000;
  const fixtures = [
    fixture({ id: 1, timestamp: cutoff - 400, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0, season: 2026, round: "Regular Season - 1" }),
    fixture({ id: 2, timestamp: cutoff - 300, homeId: 1, awayId: 3, homeGoals: 1, awayGoals: 0, season: 2025, round: "Regular Season - 30" })
  ];
  const row = buildTable(fixtures, cutoff).find((entry) => entry.id === 1)!;
  assert.equal(row.played, 2);
});

test("buildTable lässt die Vorsaison draußen, sobald ein Geltungsbereich gesetzt ist", () => {
  const cutoff = 2_000_000_000;
  const target = fixture({ id: 9, timestamp: cutoff + 100, homeId: 1, awayId: 2, season: 2026, round: "Regular Season - 2" });
  const fixtures = [
    fixture({ id: 1, timestamp: cutoff - 400, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0, season: 2026, round: "Regular Season - 1" }),
    fixture({ id: 2, timestamp: cutoff - 300, homeId: 1, awayId: 3, homeGoals: 1, awayGoals: 0, season: 2025, round: "Regular Season - 30" })
  ];
  const row = buildTable(fixtures, cutoff, tableScopeOf(target)).find((entry) => entry.id === 1)!;
  assert.equal(row.played, 1);
  assert.equal(row.points, 3);
});

test("buildTable trennt Apertura und Clausura derselben Saison", () => {
  const cutoff = 2_000_000_000;
  const target = fixture({ id: 9, timestamp: cutoff + 100, homeId: 1, awayId: 2, season: 2026, round: "Clausura - 3" });
  const fixtures = [
    fixture({ id: 1, timestamp: cutoff - 500, homeId: 1, awayId: 2, homeGoals: 3, awayGoals: 0, season: 2026, round: "Apertura - 1" }),
    fixture({ id: 2, timestamp: cutoff - 400, homeId: 1, awayId: 3, homeGoals: 3, awayGoals: 0, season: 2026, round: "Apertura - 2" }),
    fixture({ id: 3, timestamp: cutoff - 300, homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 1, season: 2026, round: "Clausura - 1" })
  ];
  const row = buildTable(fixtures, cutoff, tableScopeOf(target)).find((entry) => entry.id === 1)!;
  assert.equal(row.played, 1);
  assert.equal(row.points, 1);
});

test("buildTable zählt K.-o.-Partien nicht in die Tabelle", () => {
  const cutoff = 2_000_000_000;
  const target = fixture({ id: 9, timestamp: cutoff + 100, homeId: 1, awayId: 2, season: 2026, round: "Apertura - 4" });
  const fixtures = [
    fixture({ id: 1, timestamp: cutoff - 500, homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, season: 2026, round: "Apertura - 1" }),
    fixture({ id: 2, timestamp: cutoff - 400, homeId: 1, awayId: 3, homeGoals: 4, awayGoals: 0, season: 2026, round: "Apertura - Semi-finals" })
  ];
  const row = buildTable(fixtures, cutoff, tableScopeOf(target)).find((entry) => entry.id === 1)!;
  assert.equal(row.played, 1);
  assert.equal(row.goalsFor, 1);
});

test("eine Endrunde ohne Abschnitt nutzt die Spieltage derselben Saison", () => {
  const cutoff = 2_000_000_000;
  // "Quarter-finals" nennt keinen Abschnitt - der Geltungsbereich fällt auf die Saison
  // zurück, K.-o.-Partien bleiben trotzdem draußen.
  const target = fixture({ id: 9, timestamp: cutoff + 100, homeId: 1, awayId: 2, season: 2026, round: "Quarter-finals" });
  const fixtures = [
    fixture({ id: 1, timestamp: cutoff - 500, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 1, season: 2026, round: "Regular Season - 1" }),
    fixture({ id: 2, timestamp: cutoff - 450, homeId: 1, awayId: 3, homeGoals: 1, awayGoals: 0, season: 2025, round: "Regular Season - 20" }),
    fixture({ id: 3, timestamp: cutoff - 400, homeId: 1, awayId: 3, homeGoals: 5, awayGoals: 0, season: 2026, round: "Round of 16" })
  ];
  const table = buildTable(fixtures, cutoff, tableScopeOf(target));
  const row = table.find((entry) => entry.id === 1)!;
  assert.equal(row.played, 1);
  assert.equal(row.goalsFor, 2);
});

test("ein reiner Pokal ergibt gar keine Tabelle", () => {
  const cutoff = 2_000_000_000;
  const target = fixture({ id: 9, timestamp: cutoff + 100, homeId: 1, awayId: 2, season: 2026, round: "Semi-finals" });
  const fixtures = [
    fixture({ id: 1, timestamp: cutoff - 500, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 1, season: 2026, round: "Round of 32" }),
    fixture({ id: 2, timestamp: cutoff - 400, homeId: 1, awayId: 3, homeGoals: 1, awayGoals: 0, season: 2026, round: "Round of 16" })
  ];
  assert.equal(buildTable(fixtures, cutoff, tableScopeOf(target)).length, 0);
});

test("fehlt die Runde ganz, bleibt es bei der Saison-Eingrenzung", () => {
  const cutoff = 2_000_000_000;
  const target = fixture({ id: 9, timestamp: cutoff + 100, homeId: 1, awayId: 2, season: 2026 });
  const fixtures = [
    fixture({ id: 1, timestamp: cutoff - 500, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 1, season: 2026 }),
    fixture({ id: 2, timestamp: cutoff - 400, homeId: 1, awayId: 3, homeGoals: 1, awayGoals: 0, season: 2025 })
  ];
  const row = buildTable(fixtures, cutoff, tableScopeOf(target)).find((entry) => entry.id === 1)!;
  assert.equal(row.played, 1);
});

test("roundStage erkennt Spieltag, Abschnitt und K.-o.-Runde", () => {
  assert.deepEqual(roundStage("Regular Season - 12"), { stage: "Regular Season", matchday: true });
  assert.deepEqual(roundStage("Apertura - 5"), { stage: "Apertura", matchday: true });
  assert.deepEqual(roundStage("Apertura - Semi-finals"), { stage: "Apertura", matchday: false });
  assert.deepEqual(roundStage("Quarter-finals"), { stage: null, matchday: false });
});
