import assert from "node:assert/strict";
import test from "node:test";
import {
  clockOf,
  goalShareAfter,
  isShortMatch,
  liveChances,
  poissonCdf,
  RED_CARD_OPPONENT,
  RED_CARD_OWN,
  STOPPAGE_REMAINING,
  type LiveChanceInput
} from "../src/live-model.ts";

function input(overrides: Partial<LiveChanceInput> = {}): LiveChanceInput {
  return {
    lambdaHome: 1.6, lambdaAway: 1.1,
    clock: { phase: "running", minutesPlayed: 0 },
    goalsHome: 0, goalsAway: 0, redHome: 0, redAway: 0,
    sideReliable: true,
    ...overrides
  };
}

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} statt ${expected}`);

test("vor dem ersten Ball ist die Live-Chance die Poisson-Rechnung vor dem Anpfiff", () => {
  const chances = liveChances(input());
  assert.equal(chances.state, "ok");
  close(chances.remainingGoals!, 2.7);
  close(chances.anotherGoal!, 1 - Math.exp(-2.7));
  close(chances.lines!.over25, 1 - poissonCdf(2.7, 2));
  close(chances.result!.home + chances.result!.draw + chances.result!.away, 1);
  assert.ok(chances.result!.home > chances.result!.away);
});

test("der Anteil der Resttore fällt von 1 auf 0 und trägt die Nachspielzeit", () => {
  close(goalShareAfter(0), 1);
  close(goalShareAfter(90), 0);
  let previous = 1;
  for (let minute = 1; minute <= 90; minute += 1) {
    const share = goalShareAfter(minute);
    assert.ok(share <= previous, `Minute ${minute}`);
    previous = share;
  }
  // Ab der 85. Minute fällt gemessen noch in rund 30 % der Spiele ein Tor; eine gleichmäßige
  // Uhr sagte 14 %. Der Anteil muss deshalb weit über 5/90 liegen.
  assert.ok(goalShareAfter(85) > 0.11 && goalShareAfter(85) < 0.15, String(goalShareAfter(85)));
});

test("eine Rote Karte senkt die eigene Torrate und hebt die des Gegners", () => {
  const minute = { phase: "running", minutesPlayed: 60 } as const;
  const even = liveChances(input({ lambdaHome: 1.3, lambdaAway: 1.3, clock: minute }));
  const redHome = liveChances(input({ lambdaHome: 1.3, lambdaAway: 1.3, clock: minute, redHome: 1 }));
  close(even.nextGoal!.home, even.nextGoal!.away);
  close(redHome.nextGoal!.away / redHome.nextGoal!.home, (RED_CARD_OPPONENT) / (RED_CARD_OWN));
  // Gemessen je Team nur einmal: eine zweite Rote verstärkt den Faktor nicht.
  const twoReds = liveChances(input({ lambdaHome: 1.3, lambdaAway: 1.3, clock: minute, redHome: 2 }));
  close(twoReds.remainingGoals!, redHome.remainingGoals!);
});

test("eine schon überschrittene Linie steht bei 1, das nächste Tor summiert sich auf 1", () => {
  const chances = liveChances(input({ clock: { phase: "running", minutesPlayed: 70 }, goalsHome: 2, goalsAway: 1 }));
  assert.equal(chances.lines!.over15, 1);
  assert.equal(chances.lines!.over25, 1);
  assert.ok(chances.lines!.over35 > 0 && chances.lines!.over35 < 1);
  close(chances.nextGoal!.home + chances.nextGoal!.none + chances.nextGoal!.away, 1);
});

test("nach 90 Minuten bleibt kein Tor mehr, und der Ausgang steht fest", () => {
  const chances = liveChances(input({ clock: { phase: "running", minutesPlayed: 90 }, goalsHome: 0, goalsAway: 1 }));
  close(chances.remainingGoals!, 0);
  close(chances.anotherGoal!, 0);
  close(chances.result!.away, 1);
  close(chances.nextGoal!.none, 1);
});

test("ohne belastbare Aufteilung bleiben Sieger und nächstes Tor leer, die Torlinien nicht", () => {
  const chances = liveChances(input({ sideReliable: false, clock: { phase: "running", minutesPlayed: 30 } }));
  assert.equal(chances.nextGoal, null);
  assert.equal(chances.result, null);
  assert.ok(chances.lines !== null && chances.anotherGoal !== null);
});

test("Verlängerung, Schießen, Unterbrechung und Jugendspiele bekommen keine Zahl", () => {
  for (const phase of ["extraTime", "breakBeforeExtraTime", "penalties", "interrupted", "unknown", "notStarted"] as const) {
    const chances = liveChances(input({ clock: { phase } }));
    assert.equal(chances.state, phase);
    assert.equal(chances.anotherGoal, null);
    assert.equal(chances.lines, null);
  }
  const youth = liveChances(input({ shortMatch: true, clock: { phase: "running", minutesPlayed: 30 } }));
  assert.equal(youth.state, "shortMatch");
  assert.equal(youth.remainingGoals, null);
  assert.equal(youth.provisional, true);
});

test("erkennt Jugendspiele mit kürzeren Halbzeiten an den Teamnamen", () => {
  assert.equal(isShortMatch("Spain U17", "Italy U17"), true);
  assert.equal(isShortMatch("Hertha U16", "Union Berlin"), true);
  assert.equal(isShortMatch("Iceland U21", "Spain U21"), false);
  assert.equal(isShortMatch("Germany U19", "France U19"), false);
  assert.equal(isShortMatch("FC Köln", "Hamburger SV"), false);
});

test("übersetzt den Live-Status in gespielte Minuten", () => {
  assert.deepEqual(clockOf("1H", 20, null), { phase: "running", minutesPlayed: 19.5 });
  assert.deepEqual(clockOf("HT", 45, null), { phase: "running", minutesPlayed: 45 });
  assert.deepEqual(clockOf("2H", 46, null), { phase: "running", minutesPlayed: 45.5 });
  assert.deepEqual(clockOf("1H", 45, null), { phase: "running", minutesPlayed: 45 - STOPPAGE_REMAINING.firstHalf[0]! });
  assert.deepEqual(clockOf("2H", 90, 3), { phase: "running", minutesPlayed: 90 - STOPPAGE_REMAINING.secondHalf[3]! });
  // Manche Ligen zählen die Nachspielzeit in `elapsed` weiter statt in `extra`.
  assert.deepEqual(clockOf("2H", 93, null), clockOf("2H", 90, 3));
  // Jenseits der Tabelle gilt ihr letzter Eintrag.
  assert.deepEqual(clockOf("2H", 90, 30), { phase: "running", minutesPlayed: 90 - STOPPAGE_REMAINING.secondHalf.at(-1)! });
  assert.deepEqual(clockOf("NS", null, null), { phase: "notStarted" });
  assert.deepEqual(clockOf("ET", 105, null), { phase: "extraTime" });
  assert.deepEqual(clockOf("P", 120, null), { phase: "penalties" });
  assert.deepEqual(clockOf("INT", 60, null), { phase: "interrupted" });
  assert.deepEqual(clockOf("2H", null, null), { phase: "unknown" });
});
