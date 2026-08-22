import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../src/config.ts";
import {
  chunkIds,
  isFinishedStatus,
  isLiveStatus,
  liveCandidateIds,
  snapshotKey,
  snapshotLine,
  toBoardMatch
} from "../src/live-board.ts";
import type { DashboardFixture, DashboardMarket } from "../src/dashboard.ts";
import type { ApiTeamStatistics } from "../src/types.ts";
import { fixture } from "./helpers.ts";

const NOW = Date.parse("2026-08-20T19:00:00.000Z");

function market(odds: number | null = 1.85): DashboardMarket {
  return {
    key: "over25", label: "Über 2,5", selection: "Mindestens 3 Tore", pick: null,
    selectionTone: "neutral", probability: 0.64, odds, confidence: 82, score: null,
    recommendation: { level: "recommended", label: "Empfehlenswert" }, details: ["Test"]
  };
}

function dashboardFixture(id: number, kickoff: string): DashboardFixture {
  return {
    fixtureId: id, kickoff, country: "Germany", league: "Bundesliga",
    homeTeam: "FC Köln", awayTeam: "Hamburger SV", modelVersion: "test", crossLeague: false,
    dataConfidence: 82, warnings: [], h2hNotice: null,
    form: { scope: "venue", home: [], away: [], homeMatches: [], awayMatches: [] },
    h2h: { outcomes: [], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    expectedGoals: { home: 1.7, away: 1.2, total: 2.9 },
    scores: { favorite: 71, draw: 58 }, markets: [market()]
  };
}

test("wählt nur Fixtures im Live-Zeitfenster aus", () => {
  const fixtures = [
    dashboardFixture(1, new Date(NOW - config.liveCandidateTrailMs + 1000).toISOString()),
    dashboardFixture(2, new Date(NOW - config.liveCandidateTrailMs - 1000).toISOString()),
    dashboardFixture(3, new Date(NOW + config.liveCandidateLeadMs - 1000).toISOString()),
    dashboardFixture(4, new Date(NOW + config.liveCandidateLeadMs + 1000).toISOString())
  ];
  assert.deepEqual(liveCandidateIds(fixtures, NOW), [1, 3]);
});

test("überspringt bereits beendete Partien und ungültige Anstoßzeiten", () => {
  const fixtures = [
    dashboardFixture(1, new Date(NOW - 3_600_000).toISOString()),
    dashboardFixture(2, new Date(NOW - 3_600_000).toISOString()),
    dashboardFixture(3, "keine Zeitangabe")
  ];
  assert.deepEqual(liveCandidateIds(fixtures, NOW, new Set([2])), [1]);
});

test("bündelt Fixtures in Batches von höchstens 20", () => {
  const ids = Array.from({ length: 45 }, (_, index) => index + 1);
  const batches = chunkIds(ids);
  assert.deepEqual(batches.map((batch) => batch.length), [20, 20, 5]);
  assert.deepEqual(batches.flat(), ids);
  assert.deepEqual(chunkIds([]), []);
});

test("unterscheidet laufende von beendeten Statuswerten", () => {
  for (const status of ["1H", "HT", "2H", "ET", "P"]) assert.equal(isLiveStatus(status), true, status);
  for (const status of ["FT", "AET", "PEN", "PST", "CANC"]) assert.equal(isFinishedStatus(status), true, status);
  assert.equal(isLiveStatus("NS"), false);
  assert.equal(isFinishedStatus("2H"), false);
});

test("übernimmt eingebettete Statistiken und behält fehlende Werte als null", () => {
  const live = fixture({ id: 77, timestamp: NOW / 1000, homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, status: "2H" });
  live.fixture.status = { long: "Second Half", short: "2H", elapsed: 63, extra: 2 };
  live.statistics = [
    { team: live.teams.home, statistics: [
      { type: "Shots on Goal", value: 7 }, { type: "Total Shots", value: 17 },
      { type: "Shots insidebox", value: 11 }, { type: "Ball Possession", value: "58%" },
      { type: "Corner Kicks", value: 8 }, { type: "Goalkeeper Saves", value: 3 },
      { type: "Red Cards", value: null }
    ] },
    { team: live.teams.away, statistics: [
      { type: "Shots on Goal", value: 4 }, { type: "Total Shots", value: 9 },
      { type: "Ball Possession", value: "42%" }, { type: "Corner Kicks", value: 4 }
    ] }
  ] satisfies ApiTeamStatistics[];
  live.events = [
    { time: { elapsed: 55 }, team: live.teams.away, type: "Card", detail: "Yellow Card", player: { id: 3, name: "Spieler B" } },
    { time: { elapsed: 40 }, team: live.teams.home, type: "Goal", detail: "Normal Goal", player: { id: 9, name: "Spieler A" } },
    { time: { elapsed: 12 }, team: live.teams.home, type: "Offside", detail: "Offside" }
  ];

  const match = toBoardMatch(live, dashboardFixture(77, new Date(NOW - 3_600_000).toISOString()));

  assert.equal(match.fixtureId, 77);
  assert.equal(match.elapsed, 63);
  assert.equal(match.extra, 2);
  assert.equal(match.metricsAvailable, true);
  assert.equal(match.metrics.home.shotsOnGoal, 7);
  assert.equal(match.metrics.home.shotsInsideBox, 11);
  assert.equal(match.metrics.home.possession, 58);
  assert.equal(match.metrics.home.goalkeeperSaves, 3);
  // Fehlende Statistiken dürfen nie als 0 durchgereicht werden.
  assert.equal(match.metrics.home.redCards, null);
  assert.equal(match.metrics.away.shotsInsideBox, null);
  assert.equal(match.metrics.away.goalkeeperSaves, null);
  // Namen, Land und Liga stammen aus dem Dashboard, nicht aus der Live-Antwort.
  assert.equal(match.homeTeam, "FC Köln");
  assert.equal(match.prematch.markets[0]?.key, "over25");
  // Nur relevante Ereignisse, aufsteigend nach Minute.
  assert.deepEqual(match.events.map((event) => [event.minute, event.type, event.side]),
    [[40, "Goal", "home"], [55, "Card", "away"]]);
});

test("meldet fehlende Statistiken, damit der Einzelabruf greifen kann", () => {
  const live = fixture({ id: 78, timestamp: NOW / 1000, homeId: 1, awayId: 2, homeGoals: 0, awayGoals: 0, status: "1H" });
  live.fixture.status = { long: "First Half", short: "1H", elapsed: 20 };
  const dashboard = dashboardFixture(78, new Date(NOW - 1_200_000).toISOString());

  const withoutStatistics = toBoardMatch(live, dashboard);
  assert.equal(withoutStatistics.metricsAvailable, false);
  assert.equal(withoutStatistics.metrics.home.totalShots, null);

  const nachgeladen = toBoardMatch(live, dashboard, [
    { team: live.teams.home, statistics: [{ type: "Total Shots", value: 3 }] },
    { team: live.teams.away, statistics: [{ type: "Total Shots", value: 2 }] }
  ]);
  assert.equal(nachgeladen.metricsAvailable, true);
  assert.equal(nachgeladen.metrics.home.totalShots, 3);
});

test("schreibt eine JSONL-Zeile je Stand und erkennt unveränderte Stände", () => {
  const live = fixture({ id: 79, timestamp: NOW / 1000, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 1, status: "2H" });
  live.fixture.status = { long: "Second Half", short: "2H", elapsed: 70 };
  live.statistics = [
    { team: live.teams.home, statistics: [{ type: "Shots on Goal", value: 6 }] },
    { team: live.teams.away, statistics: [{ type: "Shots on Goal", value: 2 }] }
  ];
  const dashboard = dashboardFixture(79, new Date(NOW - 4_200_000).toISOString());
  const match = toBoardMatch(live, dashboard);

  assert.equal(snapshotKey(match), snapshotKey(toBoardMatch(live, dashboard)));
  const changed = structuredClone(live);
  changed.fixture.status.elapsed = 71;
  assert.notEqual(snapshotKey(match), snapshotKey(toBoardMatch(changed, dashboard)));

  const line = JSON.parse(snapshotLine(match, "2026-08-20T19:00:00.000Z"));
  assert.equal(line.fixtureId, 79);
  assert.equal(line.minute, 70);
  assert.equal(line.status, "2H");
  assert.deepEqual(line.score, { home: 2, away: 1 });
  assert.equal(line.statistics.home.shotsOnGoal, 6);
  assert.equal(line.statistics.away.corners, null);
  assert.deepEqual(line.prematchOdds, { over25: 1.85 });
  assert.equal(line.capturedAt, "2026-08-20T19:00:00.000Z");
});
