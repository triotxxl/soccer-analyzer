import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFixture,
  candidatesForFixture,
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
