import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageOf,
  goalEvents,
  scoringPeriodIndex,
  selectH2h,
  selectHistory,
  teamMatchStats,
  toInsightMatch
} from "../src/fixture-insights.ts";
import type { ApiFixture, ApiFixtureEvent } from "../src/types.ts";
import { fixture } from "./helpers.ts";

const NOW = Date.parse("2026-09-04T12:00:00.000Z") / 1000;

function goal(minute: number, teamId: number, detail = "Normal Goal"): ApiFixtureEvent {
  return {
    time: { elapsed: minute, extra: null },
    team: { id: teamId, name: `Team ${teamId}` },
    type: "Goal",
    detail
  };
}

test("ordnet Torminuten der richtigen Viertelstunde zu", () => {
  assert.equal(scoringPeriodIndex(1), 0);
  assert.equal(scoringPeriodIndex(15), 0);
  assert.equal(scoringPeriodIndex(16), 1);
  assert.equal(scoringPeriodIndex(45), 2);
  assert.equal(scoringPeriodIndex(46), 3);
  assert.equal(scoringPeriodIndex(90), 5);
  // Verlängerung fällt in die Schlussphase, statt eine siebte Spalte zu erzwingen.
  assert.equal(scoringPeriodIndex(105), 5);
  assert.equal(scoringPeriodIndex(0), 0);
});

test("schreibt ein Eigentor dem Gegner gut und lässt verschossene Elfmeter aus", () => {
  const events = [
    goal(12, 10),
    goal(33, 10, "Own Goal"),
    goal(60, 20, "Penalty"),
    goal(75, 20, "Missed Penalty")
  ];
  assert.deepEqual(goalEvents(events, 10, 20), [
    { teamId: 10, minute: 12 },
    { teamId: 20, minute: 33 },
    { teamId: 20, minute: 60 }
  ]);
});

test("liest Ballbesitz und Schüsse je Mannschaft", () => {
  const stats = teamMatchStats([
    {
      team: { id: 10, name: "Heim" },
      statistics: [
        { type: "Ball Possession", value: "55%" },
        { type: "Total Shots", value: 14 },
        { type: "Shots on Goal", value: 6 }
      ]
    }
  ], 10);
  assert.deepEqual(stats, { possession: 55, shots: 14, shotsOnGoal: 6 });
  assert.equal(teamMatchStats([], 10), null);
});

test("markiert eine Partie erst mit lückenloser Ereignisliste als auswertbar", () => {
  const match = fixture({ id: 1, timestamp: NOW - 86_400, homeId: 10, awayId: 20, homeGoals: 2, awayGoals: 1 });
  const complete = { ...match, events: [goal(10, 10), goal(40, 10), goal(80, 20)] };
  const partial = { ...match, events: [goal(10, 10)] };

  assert.equal(toInsightMatch(match, complete)!.minutesComplete, true);
  assert.equal(toInsightMatch(match, partial)!.minutesComplete, false);
  // Ohne Detaildatensatz bleiben die Minuten unbekannt, nicht null.
  assert.equal(toInsightMatch(match)!.minutesComplete, false);
  assert.deepEqual(toInsightMatch(match)!.goals, []);
});

test("wertet eine Partie mit Verlängerung nicht über Torminuten aus", () => {
  const match = fixture({ id: 2, timestamp: NOW - 86_400, homeId: 10, awayId: 20, homeGoals: 2, awayGoals: 1, status: "AET" });
  const detail = { ...match, events: [goal(10, 10), goal(40, 10), goal(80, 20)] };
  assert.equal(toInsightMatch(match, detail)!.minutesComplete, false);
});

test("lässt unfertige Partien ganz aus", () => {
  const upcoming = fixture({ id: 3, timestamp: NOW + 3_600, homeId: 10, awayId: 20, status: "NS" });
  assert.equal(toInsightMatch(upcoming), null);
});

test("wählt die jüngste Historie ohne Freundschaftsspiele und ohne die Partie selbst", () => {
  const history: ApiFixture[] = [
    fixture({ id: 11, timestamp: NOW - 86_400, homeId: 10, awayId: 30, homeGoals: 1, awayGoals: 0 }),
    fixture({ id: 12, timestamp: NOW - 2 * 86_400, homeId: 40, awayId: 10, homeGoals: 0, awayGoals: 0 }),
    fixture({ id: 13, timestamp: NOW - 3 * 86_400, homeId: 10, awayId: 50, homeGoals: 3, awayGoals: 1, leagueName: "Club Friendlies" }),
    fixture({ id: 14, timestamp: NOW + 86_400, homeId: 10, awayId: 60, status: "NS" }),
    fixture({ id: 15, timestamp: NOW - 4 * 86_400, homeId: 70, awayId: 10, homeGoals: 2, awayGoals: 2 })
  ];
  assert.deepEqual(
    selectHistory(history, 10, NOW, 10).map((match) => match.fixture.id),
    [11, 12, 15]
  );
  assert.deepEqual(selectHistory(history, 10, NOW, 2).map((match) => match.fixture.id), [11, 12]);
});

test("begrenzt die direkten Duelle auf abgeschlossene Partien vor dem Anpfiff", () => {
  const duels: ApiFixture[] = [
    fixture({ id: 21, timestamp: NOW + 3_600, homeId: 10, awayId: 20, status: "NS" }),
    fixture({ id: 22, timestamp: NOW - 86_400, homeId: 10, awayId: 20, homeGoals: 1, awayGoals: 1 }),
    fixture({ id: 23, timestamp: NOW - 2 * 86_400, homeId: 20, awayId: 10, homeGoals: 0, awayGoals: 2 })
  ];
  assert.deepEqual(selectH2h(duels, NOW, 5).map((match) => match.fixture.id), [22, 23]);
  assert.deepEqual(selectH2h(duels, NOW, 1).map((match) => match.fixture.id), [22]);
});

test("zählt die Abdeckung ohne Doppelungen", () => {
  const match = fixture({ id: 31, timestamp: NOW - 86_400, homeId: 10, awayId: 20, homeGoals: 1, awayGoals: 0 });
  const detailed = toInsightMatch(match, {
    ...match,
    events: [goal(20, 10)],
    statistics: [{ team: { id: 10, name: "Heim" }, statistics: [{ type: "Ball Possession", value: "51%" }] }]
  })!;
  const bare = toInsightMatch(fixture({ id: 32, timestamp: NOW - 2 * 86_400, homeId: 10, awayId: 40, homeGoals: 0, awayGoals: 0 }))!;
  assert.deepEqual(coverageOf([detailed, detailed, bare]), { matches: 2, withMinutes: 1, withStats: 1 });
});
