import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFirstHalfGoals,
  analyzeFixture,
  candidatesForFixture,
  firstHalfGoalLineProbabilities,
  firstHalfPlayedMatches,
  goalLineProbabilities,
  playedMatches,
  poissonProbabilities
} from "../src/model.ts";
import { fixture, history } from "./helpers.ts";

test("Poisson-Wahrscheinlichkeiten sind normiert und deterministisch", () => {
  const first = poissonProbabilities(1.5, 1.0);
  const second = poissonProbabilities(1.5, 1.0);
  assert.deepEqual(first, second);
  assert.ok(Math.abs(first.home + first.draw + first.away - 1) < 1e-9);
  const expectedBtts = (1 - Math.exp(-1.5)) * (1 - Math.exp(-1.0));
  assert.ok(Math.abs(first.btts - expectedBtts) < 1e-6);
});

test("Torlinien verwenden die exakte Poisson-CDF und komplementäre Wahrscheinlichkeiten", () => {
  const probabilities = goalLineProbabilities(1.5, 1.0);
  const lambda = 2.5;
  const p0 = Math.exp(-lambda);
  const p1 = p0 * lambda;
  const p2 = p1 * lambda / 2;
  const p3 = p2 * lambda / 3;
  assert.ok(Math.abs(probabilities.under15 - (p0 + p1)) < 1e-12);
  assert.ok(Math.abs(probabilities.under25 - (p0 + p1 + p2)) < 1e-12);
  assert.ok(Math.abs(probabilities.under35 - (p0 + p1 + p2 + p3)) < 1e-12);
  assert.ok(Math.abs(probabilities.over15 + probabilities.under15 - 1) < 1e-12);
  assert.ok(Math.abs(probabilities.over25 + probabilities.under25 - 1) < 1e-12);
  assert.ok(Math.abs(probabilities.over35 + probabilities.under35 - 1) < 1e-12);
  assert.ok(probabilities.over15 > probabilities.over25);
  assert.ok(probabilities.over25 > probabilities.over35);
  assert.ok(probabilities.under15 < probabilities.under25);
  assert.ok(probabilities.under25 < probabilities.under35);
  assert.deepEqual(goalLineProbabilities(0, 0), {
    over15: 0,
    under15: 1,
    over25: 0,
    under25: 1,
    over35: 0,
    under35: 1
  });
});

test("Halbzeit-Torlinien verwenden die exakte Poisson-CDF für 0,5 und 1,5", () => {
  const probabilities = firstHalfGoalLineProbabilities(0.7, 0.4);
  const lambda = 1.1;
  const p0 = Math.exp(-lambda);
  const p1 = p0 * lambda;
  assert.ok(Math.abs(probabilities.under05 - p0) < 1e-12);
  assert.ok(Math.abs(probabilities.under15 - (p0 + p1)) < 1e-12);
  assert.ok(Math.abs(probabilities.over05 + probabilities.under05 - 1) < 1e-12);
  assert.ok(Math.abs(probabilities.over15 + probabilities.under15 - 1) < 1e-12);
  assert.deepEqual(firstHalfGoalLineProbabilities(0, 0), {
    over05: 0, under05: 1, over15: 0, under15: 1
  });
});

test("Halbzeitmodell verwendet nur vollständige Halbzeitstände und nicht den Endstand", () => {
  const base = 1_800_000_000;
  const upcoming = fixture({ id: 999, timestamp: base, homeId: 1, awayId: 2 });
  const histories = (largeScores: boolean) => Array.from({ length: 16 }, (_, index) => fixture({
    id: index + 1,
    timestamp: base - (index + 1) * 86_400,
    homeId: index % 2 === 0 ? 1 : 10 + index,
    awayId: index % 2 === 0 ? 20 + index : 2,
    homeGoals: largeScores ? 5 : 1,
    awayGoals: largeScores ? 4 : 1,
    halfTimeHomeGoals: index % 3 === 0 ? 1 : 0,
    halfTimeAwayGoals: index % 4 === 0 ? 1 : 0
  }));
  const low = analyzeFirstHalfGoals(upcoming, histories(false));
  const high = analyzeFirstHalfGoals(upcoming, histories(true));
  assert.ok(Math.abs(low.expectedHomeGoals - high.expectedHomeGoals) < 1e-12);
  assert.ok(Math.abs(low.expectedAwayGoals - high.expectedAwayGoals) < 1e-12);
  const missing = fixture({
    id: 1000, timestamp: base - 20 * 86_400, homeId: 1, awayId: 2,
    homeGoals: 4, awayGoals: 4, halfTimeHomeGoals: null, halfTimeAwayGoals: null
  });
  assert.equal(firstHalfPlayedMatches([...histories(false), missing]).length, histories(false).length);
});

test("Halbzeitmodell kennzeichnet den 45-Prozent-Prior bei fehlenden Halbzeitständen", () => {
  const base = 1_800_000_000;
  const upcoming = fixture({ id: 999, timestamp: base, homeId: 1, awayId: 2 });
  const withoutHalftime = history(base).map((match) => ({
    ...match,
    score: { ...match.score, halftime: { home: null, away: null } }
  }));
  const model = analyzeFirstHalfGoals(upcoming, withoutHalftime);
  assert.equal(model.usedFallback, true);
  assert.equal(model.quality, 0);
  assert.ok(Number.isFinite(model.probabilities.over05));
});

test("ignoriert abgesagte, kommende und Freundschaftsspiele", () => {
  const base = 1_800_000_000;
  const fixtures = [
    fixture({ id: 1, timestamp: base, homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 1 }),
    fixture({ id: 2, timestamp: base, homeId: 1, awayId: 2, status: "PST" }),
    fixture({ id: 3, timestamp: base, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 2, leagueName: "Club Friendlies" })
  ];
  assert.equal(playedMatches(fixtures).length, 1);
});

test("liefert bei ausreichender Historie Qualität und nachvollziehbare Kandidaten", () => {
  const base = 1_800_000_000;
  const upcoming = fixture({ id: 999, timestamp: base, homeId: 1, awayId: 2 });
  const model = analyzeFixture(upcoming, history(base));
  assert.ok(model.quality >= 60);
  assert.ok(model.expectedHomeGoals >= 0.2);
  const candidates = candidatesForFixture(upcoming, history(base), ["draw", "btts", "over25", "1x2"]);
  for (const candidate of candidates) {
    assert.ok(candidate.quality >= 60);
    assert.ok(candidate.reasons.length >= 2);
  }
});

test("kennzeichnet nur ausreichend belegte, relativ starke Defensiven", () => {
  const base = 1_800_000_000;
  const upcoming = fixture({ id: 999, timestamp: base, homeId: 1, awayId: 2 });
  const teamHistory = [
    ...Array.from({ length: 12 }, (_, index) => fixture({
      id: 1_000 + index, timestamp: base - (index + 1) * 7 * 86_400,
      homeId: 1, awayId: 100 + index, homeGoals: 1, awayGoals: 0
    })),
    ...Array.from({ length: 12 }, (_, index) => fixture({
      id: 2_000 + index, timestamp: base - (index + 1) * 7 * 86_400,
      homeId: 200 + index, awayId: 2, homeGoals: 2, awayGoals: 1
    }))
  ];
  const model = analyzeFixture(upcoming, history(base), teamHistory);
  assert.equal(model.defense.home.strong, true);
  assert.equal(model.defense.away.strong, false);
  assert.ok(model.defense.home.relativeToLeague <= 0.70);
  assert.equal(model.defense.home.venueMatches, 12);
});

test("filtert dünne Datenlagen unabhängig von hoher Wahrscheinlichkeit", () => {
  const upcoming = fixture({ id: 999, timestamp: 1_800_000_000, homeId: 1, awayId: 2 });
  assert.deepEqual(candidatesForFixture(upcoming, [], ["draw", "btts", "over25", "1x2"]), []);
});

test("bleibt bei einer torlosen Wettbewerbshistorie numerisch stabil", () => {
  const base = 1_800_000_000;
  const upcoming = fixture({ id: 999, timestamp: base, homeId: 1, awayId: 2 });
  const scoreless = Array.from({ length: 12 }, (_, index) => fixture({
    id: index + 1,
    timestamp: base - (index + 1) * 86_400,
    homeId: index % 2 === 0 ? 1 : 3,
    awayId: index % 2 === 0 ? 4 : 2,
    homeGoals: 0,
    awayGoals: 0
  }));
  const model = analyzeFixture(upcoming, scoreless);
  assert.ok(Number.isFinite(model.expectedHomeGoals));
  assert.ok(Number.isFinite(model.expectedAwayGoals));
  assert.ok(Number.isFinite(model.probabilities.draw));
  assert.ok(Math.abs(
    model.probabilities.home + model.probabilities.draw + model.probabilities.away - 1
  ) < 1e-9);
});
