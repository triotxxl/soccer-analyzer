import assert from "node:assert/strict";
import test from "node:test";
import { sectionOf, toFixtureResult } from "../src/fixture-result.ts";
import { event, fixture, teamStatistics } from "./helpers.ts";

const HOME = 1;
const AWAY = 2;
const KICKOFF = 1_767_222_000;

/** Die Angaben, die eine Partie in diesen Tests unterscheiden - der Rest ist immer gleich. */
type MatchOptions = Omit<
  Parameters<typeof fixture>[0],
  "id" | "timestamp" | "homeId" | "awayId"
>;

function match(options: MatchOptions = {}) {
  return fixture({ id: 100, timestamp: KICKOFF, homeId: HOME, awayId: AWAY, ...options });
}

test("die Nachspielzeit der ersten Halbzeit zählt noch zur ersten", () => {
  const result = toFixtureResult(match({
    homeGoals: 1, awayGoals: 0, halfTimeHomeGoals: 1, halfTimeAwayGoals: 0,
    events: [event({ type: "Goal", minute: 45, extra: 2, teamId: HOME })]
  }));
  assert.ok(result);
  assert.equal(result.goalsHt1Home, 1);
  assert.equal(result.goalsHt2Home, 0);
  assert.equal(result.goals[0]?.extra, 2);
  assert.equal(result.goalsComplete, true);
});

test("die Nachspielzeit der zweiten Halbzeit zählt nicht zur Verlängerung", () => {
  const result = toFixtureResult(match({
    homeGoals: 0, awayGoals: 1, halfTimeHomeGoals: 0, halfTimeAwayGoals: 0,
    events: [event({ type: "Goal", minute: 90, extra: 3, teamId: AWAY })]
  }));
  assert.ok(result);
  assert.equal(result.goalsHt2Away, 1);
  assert.equal(result.goalsEtAway, 0);
});

test("ein Eigentor zählt für den Gegner des Schützen", () => {
  const result = toFixtureResult(match({
    homeGoals: 0, awayGoals: 1, halfTimeHomeGoals: 0, halfTimeAwayGoals: 1,
    events: [event({ type: "Goal", minute: 20, teamId: HOME, detail: "Own Goal" })]
  }));
  assert.ok(result);
  assert.equal(result.goalsHt1Away, 1);
  assert.equal(result.goalsHt1Home, 0);
  assert.equal(result.goals[0]?.ownGoal, true);
  assert.equal(result.goals[0]?.scorerTeamId, HOME);
  assert.equal(result.goals[0]?.teamId, AWAY);
});

test("ein verschossener Elfmeter zählt nirgends", () => {
  const result = toFixtureResult(match({
    homeGoals: 0, awayGoals: 0, halfTimeHomeGoals: 0, halfTimeAwayGoals: 0,
    events: [event({ type: "Goal", minute: 30, teamId: HOME, detail: "Missed Penalty" })]
  }));
  assert.ok(result);
  assert.equal(result.goals.length, 0);
  assert.equal(result.goalsHt1Home, 0);
  assert.equal(result.goalsComplete, true);
});

test("ein Tor in der Verlängerung steht im eigenen Abschnitt und der Endstand geht auf", () => {
  const result = toFixtureResult(match({
    status: "AET", homeGoals: 2, awayGoals: 1, halfTimeHomeGoals: 1, halfTimeAwayGoals: 1,
    extraTimeHomeGoals: 1, extraTimeAwayGoals: 0,
    events: [
      event({ type: "Goal", minute: 10, teamId: HOME }),
      event({ type: "Goal", minute: 40, teamId: AWAY }),
      event({ type: "Goal", minute: 105, teamId: HOME })
    ]
  }));
  assert.ok(result);
  assert.equal(result.goalsHt1Home, 1);
  assert.equal(result.goalsEtHome, 1);
  assert.equal(result.etHomeGoals, 1);
  assert.equal(result.goalsComplete, true);
  assert.equal(
    (result.goalsHt1Home ?? 0) + (result.goalsHt2Home ?? 0) + (result.goalsEtHome ?? 0),
    result.finalHomeGoals
  );
});

test("das Elfmeterschießen landet nicht in der Verlängerung", () => {
  // Die Schüsse des Schießens stehen als Tor-Ereignis mit Minute 120. Ohne die Ausnahme
  // zählten sie als Tore der Verlängerung und der Endstand ginge nicht mehr auf.
  const result = toFixtureResult(match({
    status: "PEN", homeGoals: 1, awayGoals: 1, halfTimeHomeGoals: 0, halfTimeAwayGoals: 1,
    penaltyHomeGoals: 4, penaltyAwayGoals: 3,
    events: [
      event({ type: "Goal", minute: 30, teamId: AWAY }),
      event({ type: "Goal", minute: 70, teamId: HOME }),
      event({ type: "Goal", minute: 120, teamId: HOME, detail: "Penalty" }),
      event({ type: "Goal", minute: 120, teamId: AWAY, detail: "Penalty" })
    ]
  }));
  assert.ok(result);
  assert.equal(result.goalsEtHome, 0);
  assert.equal(result.goalsEtAway, 0);
  assert.equal(result.penHomeGoals, 4);
  assert.equal(result.penAwayGoals, 3);
  assert.equal(result.goalsComplete, true);
});

test("Karten und Wechsel werden je Halbzeit gezählt", () => {
  const result = toFixtureResult(match({
    homeGoals: 0, awayGoals: 0, halfTimeHomeGoals: 0, halfTimeAwayGoals: 0,
    events: [
      event({ type: "Card", minute: 20, teamId: HOME, detail: "Yellow Card" }),
      event({ type: "Card", minute: 60, teamId: HOME, detail: "Yellow Card" }),
      event({ type: "Card", minute: 75, teamId: AWAY, detail: "Red Card" }),
      event({ type: "subst", minute: 46, teamId: HOME, detail: "Substitution 1" }),
      event({ type: "subst", minute: 80, teamId: AWAY, detail: "Substitution 1" })
    ]
  }));
  assert.ok(result);
  assert.equal(result.yellow.ht1Home, 1);
  assert.equal(result.yellow.ht2Home, 1);
  assert.equal(result.red.ht2Away, 1);
  assert.equal(result.red.ht1Home, 0);
  assert.equal(result.subs.ht2Home, 1);
  assert.equal(result.subs.ht1Home, 0);
  assert.equal(result.subs.ht2Away, 1);
});

test("eine zweite Gelbe zählt als Verwarnung und als Platzverweis", () => {
  const result = toFixtureResult(match({
    homeGoals: 0, awayGoals: 0, halfTimeHomeGoals: 0, halfTimeAwayGoals: 0,
    events: [event({ type: "Card", minute: 70, teamId: HOME, detail: "Second Yellow card" })]
  }));
  assert.ok(result);
  assert.equal(result.yellow.ht2Home, 1);
  assert.equal(result.red.ht2Home, 1);
});

test("ohne Ereignisliste bleiben die Zähler unbekannt statt null Ereignisse", () => {
  // Der Unterschied ist der Kern: Eine fehlende Liste heißt "wir wissen es nicht". Stünde
  // dort 0, läse jede spätere Auswertung das als "es gab keine Karten".
  const result = toFixtureResult(match({
    homeGoals: 2, awayGoals: 1, halfTimeHomeGoals: 1, halfTimeAwayGoals: 0
  }));
  assert.ok(result);
  assert.equal(result.goalsHt1Home, null);
  assert.equal(result.goalsHt2Home, null);
  assert.equal(result.yellow.ht1Home, null);
  assert.equal(result.red.ht2Away, null);
  assert.equal(result.subs.ht1Away, null);
  assert.equal(result.eventsAvailable, false);
  assert.equal(result.goalsComplete, false);
  // Der Pausenstand steht trotzdem, er kommt nicht aus den Ereignissen.
  assert.equal(result.htHomeGoals, 1);
  assert.equal(result.shHomeGoals, 1);
});

test("eine lückenhafte Ereignisliste gilt nicht als vollständig", () => {
  const result = toFixtureResult(match({
    homeGoals: 3, awayGoals: 0, halfTimeHomeGoals: 1, halfTimeAwayGoals: 0,
    events: [event({ type: "Goal", minute: 10, teamId: HOME })]
  }));
  assert.ok(result);
  assert.equal(result.goalsComplete, false);
  // Die gezählten Tore bleiben stehen; sie sind eine Untergrenze, keine Wahrheit.
  assert.equal(result.goalsHt1Home, 1);
});

test("ohne Pausenstand wird die zweite Halbzeit nicht gerechnet", () => {
  const result = toFixtureResult(match({
    homeGoals: 2, awayGoals: 1, halfTimeHomeGoals: null, halfTimeAwayGoals: null
  }));
  assert.ok(result);
  assert.equal(result.shHomeGoals, null);
  assert.equal(result.shAwayGoals, null);
});

test("die Statistik wird je Halbzeit übernommen, Ballbesitz als Zahl", () => {
  const result = toFixtureResult(match({
    homeGoals: 1, awayGoals: 0, halfTimeHomeGoals: 1, halfTimeAwayGoals: 0,
    events: [event({ type: "Goal", minute: 30, teamId: HOME })]
  }), {
    statistics: [
      teamStatistics({
        teamId: HOME,
        full: { "Ball Possession": "66%", "Total Shots": 11, "Shots on Goal": 6 },
        firstHalf: { "Ball Possession": "71%", "Total Shots": 8, "Shots on Goal": 4 },
        secondHalf: { "Ball Possession": "61%", "Total Shots": 3, "Shots on Goal": 2 }
      }),
      teamStatistics({
        teamId: AWAY,
        full: { "Ball Possession": "34%", "Total Shots": 15, "Shots on Goal": 5 },
        firstHalf: { "Ball Possession": "29%", "Total Shots": 5, "Shots on Goal": 2 },
        secondHalf: { "Ball Possession": "39%", "Total Shots": 10, "Shots on Goal": 3 }
      })
    ]
  });
  assert.ok(result);
  assert.equal(result.homeStats.full?.possession, 66);
  assert.equal(result.homeStats.firstHalf?.possession, 71);
  assert.equal(result.homeStats.secondHalf?.shots, 3);
  assert.equal(result.awayStats.firstHalf?.shotsOnGoal, 2);
  assert.equal(result.statsAvailable, true);
  assert.equal(result.halfStatsAvailable, true);
});

test("ohne Statistik bleibt alles leer statt null", () => {
  const result = toFixtureResult(match({
    homeGoals: 1, awayGoals: 0, halfTimeHomeGoals: 0, halfTimeAwayGoals: 0
  }));
  assert.ok(result);
  assert.equal(result.homeStats.full, null);
  assert.equal(result.homeStats.firstHalf, null);
  assert.equal(result.statsAvailable, false);
  assert.equal(result.halfStatsAvailable, false);
});

test("eine Statistik ohne Halbzeitwerte gilt nicht als Halbzeitstatistik", () => {
  const result = toFixtureResult(match({
    homeGoals: 1, awayGoals: 0, halfTimeHomeGoals: 0, halfTimeAwayGoals: 0
  }), {
    statistics: [teamStatistics({ teamId: HOME, full: { "Ball Possession": "50%" } })]
  });
  assert.ok(result);
  assert.equal(result.statsAvailable, true);
  assert.equal(result.halfStatsAvailable, false);
});

test("Aufstellung und Spielerwerte werden übernommen", () => {
  const result = toFixtureResult(match({
    homeGoals: 0, awayGoals: 0, halfTimeHomeGoals: 0, halfTimeAwayGoals: 0,
    lineups: [{
      team: { id: HOME, name: "Team 1" },
      coach: { id: 9, name: "Marko Mitrovic" },
      formation: "4-3-3",
      startXI: [],
      substitutes: []
    }],
    players: [{ team: { id: HOME, name: "Team 1" }, players: [] }]
  }));
  assert.ok(result);
  assert.equal(result.homeLineup?.formation, "4-3-3");
  assert.equal(result.homeLineup?.coach?.name, "Marko Mitrovic");
  assert.equal(result.lineupsAvailable, true);
  assert.equal(result.awayLineup, null);
});

test("eine nicht beendete Partie ergibt keinen Datensatz", () => {
  assert.equal(toFixtureResult(match({ status: "NS" })), null);
  assert.equal(toFixtureResult(match({ status: "PST", homeGoals: null, awayGoals: null })), null);
});

test("die Abschnittsgrenzen liegen bei 45 und 90", () => {
  assert.equal(sectionOf(1), 1);
  assert.equal(sectionOf(45), 1);
  assert.equal(sectionOf(46), 2);
  assert.equal(sectionOf(90), 2);
  assert.equal(sectionOf(91), 3);
  assert.equal(sectionOf(null), null);
});
