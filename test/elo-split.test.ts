import assert from "node:assert/strict";
import { test } from "node:test";
import { ELO_SPLIT, eloSplitGoals, meanWithError, outcomeLogLoss } from "../src/elo-split.ts";
import { poissonProbabilities } from "../src/model.ts";

test("die Werte der Elo-Aufteilung sind eingefroren (docs/aufteilung-zwischen-ligen.md)", () => {
  assert.deepEqual({ ...ELO_SPLIT }, { divisor: 1000, factorWeight: 0.75, homeShift: 0.3, floor: 0.05 });
});

test("die Elo-Aufteilung behält die Summe und folgt Elo, Faktor und Heimvorteil", () => {
  const even = eloSplitGoals(3, 0, 1);
  assert.ok(Math.abs(even.home + even.away - 3) < 1e-9);
  assert.ok(Math.abs(even.home / even.away - Math.exp(0.3)) < 1e-9, "ohne Abstand bleibt nur der Heimvorteil");
  assert.ok(eloSplitGoals(3, 200, 1).home > even.home);
  assert.ok(eloSplitGoals(3, 0, 1.5).home > even.home);
  assert.ok(eloSplitGoals(3, -200, 0.7).home < even.home);
});

test("die Mindestgrenze greift je Seite", () => {
  assert.equal(eloSplitGoals(2, -6000, 0.3).home, 0.05);
});

test("AEK - Real liegt mit Elo-Aufteilung nahe am gemessenen Stand der Prüfung", () => {
  const split = eloSplitGoals(2.486 + 1.41, 2103 - 2326, 0.939);
  const chances = poissonProbabilities(split.home, split.away);
  assert.ok(chances.home < 0.4 && chances.away > 0.35, `Heim ${chances.home}, Gast ${chances.away}`);
});

test("der Log-Loss nimmt den Ausgang nach 90 Minuten", () => {
  const chances = poissonProbabilities(1.5, 1);
  assert.ok(Math.abs(outcomeLogLoss(1.5, 1, 2, 1) + Math.log(chances.home)) < 1e-12);
  assert.ok(Math.abs(outcomeLogLoss(1.5, 1, 1, 1) + Math.log(chances.draw)) < 1e-12);
  assert.ok(Math.abs(outcomeLogLoss(1.5, 1, 0, 1) + Math.log(chances.away)) < 1e-12);
});

test("Mittelwert und Standardfehler", () => {
  const { mean, error } = meanWithError([1, 2, 3, 4]);
  assert.equal(mean, 2.5);
  assert.ok(Math.abs(error - Math.sqrt(5 / 3 / 4)) < 1e-12);
});
