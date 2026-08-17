import assert from "node:assert/strict";
import test from "node:test";
import { applyGoalLineFilters } from "../src/goal-line-filter.ts";
import type { GoalLineAnalysisResult, GoalLineRow } from "../src/types.ts";

function row(fixtureId: number, over05: number, over15: number): GoalLineRow {
  return {
    fixtureId,
    kickoff: "2026-08-20T18:00:00.000Z",
    country: "Germany",
    league: "Bundesliga",
    homeTeam: `Heim ${fixtureId}`,
    awayTeam: `Gast ${fixtureId}`,
    modelVersion: "2.0.0",
    expectedHomeGoals: 1.4,
    expectedAwayGoals: 1.1,
    expectedTotalGoals: 2.5,
    dataConfidence: 80,
    outcomeProbabilities: { home: 0.5, draw: 0.25, away: 0.25, btts: 0.55 },
    probabilities: { over15: 0.7, under15: 0.3, over25: 0.5, under25: 0.5, over35: 0.3, under35: 0.7 },
    firstHalf: {
      expectedHomeGoals: 0.65,
      expectedAwayGoals: 0.45,
      expectedTotalGoals: 1.1,
      dataConfidence: 78,
      probabilities: { over05, under05: 1 - over05, over15, under15: 1 - over15 },
      warnings: []
    },
    warnings: []
  };
}

test("filtert Torlinien lokal nach beiden Halbzeit-Mindestwahrscheinlichkeiten", () => {
  const result: GoalLineAnalysisResult = {
    createdAt: "2026-08-20T10:00:00.000Z",
    dates: ["2026-08-20"],
    rows: [row(1, 0.8, 0.45), row(2, 0.75, 0.3)],
    apiRequests: 0,
    apiRequestsRemaining: 7000
  };
  const filtered = applyGoalLineFilters(result, {
    minimumConfidence: null,
    minimumOver15: null,
    minimumOver25: null,
    minimumOver35: null,
    minimumFirstHalfOver05: 0.78,
    minimumFirstHalfOver15: 0.4
  });
  assert.deepEqual(filtered.rows.map((item) => item.fixtureId), [1]);
});
