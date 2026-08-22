import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFirstHalfGoals,
  analyzeFixture,
  buildDefenseRankings,
  candidatesForFixture,
  firstHalfGoalLineProbabilities,
  firstHalfLeagueBaseline,
  firstHalfPlayedMatches,
  leagueBaseline,
  goalLineProbabilities,
  playedMatches,
  poissonProbabilities
} from "../src/model.ts";
import type { FixtureExpectedGoals } from "../src/types.ts";
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
  assert.equal(model.defense.home.source, "goals");
  assert.equal(model.defense.home.strong, false);
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

test("ausreichend abgedecktes xGA verändert alle gemeinsamen Poisson-Märkte", () => {
  const base = Math.floor(Date.parse("2026-08-17T12:00:00Z") / 1000);
  const games = history(base);
  const expectedGoals = new Map<number, FixtureExpectedGoals>(games.map((game) => [game.fixture.id, {
    fixtureId: game.fixture.id, kickoff: game.fixture.date, leagueId: game.league.id,
    season: game.league.season, homeTeamId: game.teams.home.id, awayTeamId: game.teams.away.id,
    homeXg: 0.25, awayXg: 0.25, status: "available", fetchedAt: "2026-08-17T10:00:00Z"
  }]));
  const upcoming = fixture({ id: 999, timestamp: base + 3600, homeId: 1, awayId: 2 });
  const baseline = analyzeFixture(upcoming, games);
  const verified = analyzeFixture(upcoming, games, games, { expectedGoals });
  assert.equal(verified.defense.home.source, "xg");
  assert.equal(verified.defense.away.source, "xg");
  assert.ok(verified.expectedHomeGoals < baseline.expectedHomeGoals);
  assert.ok(verified.expectedAwayGoals < baseline.expectedAwayGoals);
  for (const market of ["home", "draw", "away", "btts", "over25"] as const) {
    assert.notEqual(verified.probabilities[market], baseline.probabilities[market]);
  }
});

test("rollenbezogene Perzentile markieren nur Top 20 Prozent eines Pools ab acht Teams", () => {
  const target = Math.floor(Date.parse("2026-08-17T12:00:00Z") / 1000);
  let id = 4000;
  const games = [];
  const xg = new Map<number, FixtureExpectedGoals>();
  for (let home = 1; home <= 8; home += 1) {
    for (let away = 1; away <= 8; away += 1) {
      if (home === away) continue;
      const game = fixture({ id: id++, timestamp: target - id * 1800, homeId: home, awayId: away,
        homeGoals: away <= 2 ? 0 : 1, awayGoals: home <= 2 ? 0 : 1 });
      games.push(game);
      xg.set(game.fixture.id, { fixtureId: game.fixture.id, kickoff: game.fixture.date,
        leagueId: game.league.id, season: game.league.season, homeTeamId: home, awayTeamId: away,
        homeXg: away <= 2 ? 0.35 : 1.1, awayXg: home <= 2 ? 0.35 : 1.1,
        status: "available", fetchedAt: "2026-08-17T10:00:00Z" });
    }
  }
  const rankings = buildDefenseRankings(games, xg, target);
  assert.equal(rankings.home.get("xg:1")?.strong, true);
  assert.equal(rankings.away.get("xg:1")?.strong, true);
  assert.equal(rankings.home.get("xg:8")?.strong, false);
  const upcoming = fixture({ id: 9999, timestamp: target, homeId: 1, awayId: 8 });
  const model = analyzeFixture(upcoming, games, games, { expectedGoals: xg, rankings });
  assert.equal(model.defense.home.badge, "verified");
  assert.ok((model.defense.home.percentile ?? 0) >= 0.8);
});

/**
 * Baut ein Pokal-Szenario nach dem Muster Westfalia Rhynern - Dynamo Dresden:
 * eine torreiche Amateurliga trifft auf eine torarme Profiliga, und die
 * Pokalhistorie selbst besteht aus Amateur-Gastgebern gegen Profi-Gäste.
 */
function crossLeagueScenario(target: number) {
  const amateurLeague = { leagueId: 747, leagueName: "Oberliga" };
  const proLeague = { leagueId: 79, leagueName: "2. Bundesliga" };
  let id = 1;

  // Pokalhistorie: Gastgeber unterlegen, Gäste treffen häufig.
  const cupHistory = Array.from({ length: 24 }, (_, index) => fixture({
    id: id++, timestamp: target - (index + 1) * 86_400,
    homeId: 300 + index, awayId: 400 + index,
    homeGoals: index % 4 === 0 ? 2 : 0, awayGoals: index % 3 === 0 ? 3 : 2,
    leagueId: 81, leagueName: "Pokal"
  }));

  // Amateurliga: viele Tore. Team 1 ist dort überdurchschnittlich, aber nicht extrem.
  const amateurHistory: ReturnType<typeof fixture>[] = [];
  for (let index = 0; index < 14; index += 1) {
    amateurHistory.push(fixture({
      id: id++, timestamp: target - (index + 1) * 86_400,
      homeId: 100 + index, awayId: 200 + index,
      homeGoals: index % 2 ? 3 : 2, awayGoals: index % 3 ? 2 : 1,
      ...amateurLeague
    }));
  }
  for (let index = 0; index < 7; index += 1) {
    amateurHistory.push(fixture({
      id: id++, timestamp: target - (index + 1) * 86_400 - 3600,
      homeId: 1, awayId: 210 + index, homeGoals: 3, awayGoals: 2, ...amateurLeague
    }));
    amateurHistory.push(fixture({
      id: id++, timestamp: target - (index + 1) * 86_400 - 7200,
      homeId: 220 + index, awayId: 1, homeGoals: 2, awayGoals: 3, ...amateurLeague
    }));
  }

  // Profiliga: wenige Tore. Team 2 ist dort ebenfalls überdurchschnittlich.
  const proHistory: ReturnType<typeof fixture>[] = [];
  for (let index = 0; index < 14; index += 1) {
    proHistory.push(fixture({
      id: id++, timestamp: target - (index + 1) * 86_400,
      homeId: 500 + index, awayId: 600 + index,
      homeGoals: index % 2 ? 1 : 2, awayGoals: index % 3 ? 1 : 0,
      ...proLeague
    }));
  }
  for (let index = 0; index < 7; index += 1) {
    proHistory.push(fixture({
      id: id++, timestamp: target - (index + 1) * 86_400 - 3600,
      homeId: 2, awayId: 610 + index, homeGoals: 2, awayGoals: 0, ...proLeague
    }));
    proHistory.push(fixture({
      id: id++, timestamp: target - (index + 1) * 86_400 - 7200,
      homeId: 620 + index, awayId: 2, homeGoals: 1, awayGoals: 2, ...proLeague
    }));
  }

  const upcoming = fixture({
    id: 99_999, timestamp: target, homeId: 1, awayId: 2, leagueId: 81, leagueName: "Pokal"
  });
  const teamHistory = [
    ...cupHistory,
    ...amateurHistory.filter((match) => match.teams.home.id === 1 || match.teams.away.id === 1),
    ...proHistory.filter((match) => match.teams.home.id === 2 || match.teams.away.id === 2)
  ];
  return { upcoming, cupHistory, amateurHistory, proHistory, teamHistory };
}

test("gemeinsame Pokalbasis überschätzt den unterklassigen Gastgeber", () => {
  const target = Math.floor(Date.UTC(2026, 7, 23, 13, 30) / 1000);
  const { upcoming, cupHistory, teamHistory } = crossLeagueScenario(target);
  const model = analyzeFixture(upcoming, cupHistory, teamHistory);
  // Der Fehler, um den es geht: die torreiche Amateurmannschaft wird zum Favoriten.
  assert.ok(model.probabilities.home > model.probabilities.away);
});

test("eigene Ligabasis je Seite baut die Cross-League-Inversion ab", () => {
  const target = Math.floor(Date.UTC(2026, 7, 23, 13, 30) / 1000);
  const { upcoming, cupHistory, amateurHistory, proHistory, teamHistory } =
    crossLeagueScenario(target);
  const sideBaselines = {
    home: leagueBaseline(amateurHistory, target),
    away: leagueBaseline(proHistory, target)
  };
  assert.ok(sideBaselines.home.homeGoals > sideBaselines.away.homeGoals);
  const before = analyzeFixture(upcoming, cupHistory, teamHistory);
  const after = analyzeFixture(upcoming, cupHistory, teamHistory, { sideBaselines });
  // Die Ligabasis nimmt die Verzerrung heraus. Sie behauptet aber nicht, eine der beiden
  // Ligen sei stärker - dafür ist allein der Stärkefaktor zuständig.
  assert.ok(after.probabilities.home < before.probabilities.home);
  assert.ok(after.probabilities.away > before.probabilities.away);
});

test("erst der Stärkefaktor macht den höherklassigen Gast zum Favoriten", () => {
  const target = Math.floor(Date.UTC(2026, 7, 23, 13, 30) / 1000);
  const { upcoming, cupHistory, amateurHistory, proHistory, teamHistory } =
    crossLeagueScenario(target);
  const sideBaselines = {
    home: leagueBaseline(amateurHistory, target),
    away: leagueBaseline(proHistory, target)
  };
  const model = analyzeFixture(upcoming, cupHistory, teamHistory, {
    sideBaselines, strengthFactor: 0.62
  });
  assert.ok(model.probabilities.away > model.probabilities.home);
});

test("gleichklassige Pokalpaarungen erben keinen Auswärtsdrall des Wettbewerbs", () => {
  const target = Math.floor(Date.UTC(2026, 7, 23, 13, 30) / 1000);
  const { cupHistory } = crossLeagueScenario(target);
  const league = { leagueId: 79, leagueName: "2. Bundesliga" };
  let id = 5000;

  // Eine Liga mit normalem Heimvorteil und zwei gleich starken Vereinen darin.
  const leagueHistory = [
    ...Array.from({ length: 16 }, (_, index) => fixture({
      id: id++, timestamp: target - (index + 1) * 86_400,
      homeId: 700 + index, awayId: 800 + index, homeGoals: 2, awayGoals: 1, ...league
    })),
    ...[2, 3].flatMap((teamId) => [
      ...Array.from({ length: 7 }, (_, index) => fixture({
        id: id++, timestamp: target - (index + 1) * 86_400 - 3600 * teamId,
        homeId: teamId, awayId: 810 + index, homeGoals: 2, awayGoals: 1, ...league
      })),
      ...Array.from({ length: 7 }, (_, index) => fixture({
        id: id++, timestamp: target - (index + 1) * 86_400 - 7200 * teamId,
        homeId: 820 + index, awayId: teamId, homeGoals: 2, awayGoals: 1, ...league
      }))
    ])
  ];
  const upcoming = fixture({
    id: 98_765, timestamp: target, homeId: 2, awayId: 3, leagueId: 81, leagueName: "Pokal"
  });
  const teamHistory = [...cupHistory, ...leagueHistory];

  // Die Pokalhistorie besteht aus Amateurgastgebern gegen Profigäste. Genau dieser Drall
  // darf bei zwei gleichklassigen Vereinen nicht in die Erwartung durchschlagen.
  const cupBaseline = leagueBaseline(cupHistory, target);
  assert.ok(
    cupBaseline.awayGoals > cupBaseline.homeGoals * 2,
    "die Pokalhistorie muss den erwarteten Auswärtsdrall haben"
  );

  const baseline = leagueBaseline(leagueHistory, target);
  const model = analyzeFixture(upcoming, cupHistory, teamHistory, {
    sideBaselines: { home: baseline, away: baseline }
  });
  assert.ok(
    model.expectedHomeGoals > model.expectedAwayGoals,
    `Heimvorteil erwartet, war λ ${model.expectedHomeGoals} : ${model.expectedAwayGoals}`
  );
});

test("Stärkefaktor verschiebt die erwarteten Tore symmetrisch", () => {
  const target = Math.floor(Date.UTC(2026, 7, 23, 13, 30) / 1000);
  const { upcoming, cupHistory, teamHistory } = crossLeagueScenario(target);
  const neutral = analyzeFixture(upcoming, cupHistory, teamHistory);
  const weakened = analyzeFixture(upcoming, cupHistory, teamHistory, { strengthFactor: 0.5 });
  assert.ok(weakened.expectedHomeGoals < neutral.expectedHomeGoals);
  assert.ok(weakened.expectedAwayGoals > neutral.expectedAwayGoals);
  assert.ok(weakened.probabilities.away > neutral.probabilities.away);
});

test("leagueBaseline fällt ohne Historie auf die Ligaprioren zurück", () => {
  const target = Math.floor(Date.UTC(2026, 7, 23, 13, 30) / 1000);
  assert.deepEqual(leagueBaseline([], target), { homeGoals: 1.45, awayGoals: 1.15 });
  const firstHalf = firstHalfLeagueBaseline([], target);
  assert.ok(Math.abs(firstHalf.homeGoals - 1.45 * 0.45) < 1e-12);
  assert.ok(Math.abs(firstHalf.awayGoals - 1.15 * 0.45) < 1e-12);
});

test("ohne Seitenbasis und Stärkefaktor bleibt das Modell unverändert", () => {
  const target = Math.floor(Date.UTC(2026, 7, 23, 13, 30) / 1000);
  const { upcoming, cupHistory, teamHistory } = crossLeagueScenario(target);
  const bare = analyzeFixture(upcoming, cupHistory, teamHistory);
  const explicit = analyzeFixture(upcoming, cupHistory, teamHistory, { strengthFactor: 1 });
  assert.equal(bare.expectedHomeGoals, explicit.expectedHomeGoals);
  assert.equal(bare.expectedAwayGoals, explicit.expectedAwayGoals);
});
