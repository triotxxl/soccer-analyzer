import assert from "node:assert/strict";
import test from "node:test";
import { backtestElo, backtestMetrics } from "../src/elo-backtest.ts";
import { classifyMatch, type EloMatch } from "../src/elo-competitions.ts";
import { ELO_CONFIG, type EloConfig } from "../src/elo-config.ts";
import { calculateHistoricalElo, decayFactor, expectedHome, movFactor, summarizeElo, teamKey } from "../src/elo.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-24T00:00:00Z");

let nextId = 1;
function match(partial: Partial<EloMatch> & Pick<EloMatch, "homeId" | "awayId" | "homeGoals" | "awayGoals">): EloMatch {
  return {
    fixtureId: nextId++,
    kickoff: NOW - 10 * DAY,
    leagueId: 100,
    leagueName: "Testliga",
    leagueType: "League",
    country: "Testland",
    season: 2026,
    homeName: `Team ${partial.homeId}`,
    awayName: `Team ${partial.awayId}`,
    ...partial
  };
}

/** Ohne Einstiegsfaktor und Startmittel - so sind einzelne Rechenschritte direkt prüfbar. */
const PLAIN: EloConfig = {
  ...ELO_CONFIG,
  provisional: { games: 0, multiplier: 1 },
  newTeamStart: { mode: "fixed", minRated: 5 },
  mov: { ...ELO_CONFIG.mov, enabled: false }
};

test("Erwartungswert: gleich stark ohne Heimvorteil 0,5, mit Heimvorteil darüber", () => {
  assert.equal(expectedHome(1500, 1500, 0), 0.5);
  assert.ok(Math.abs(expectedHome(1500, 1500, 60) - 0.5856) < 0.001);
  assert.ok(Math.abs(expectedHome(1600, 1500, 0) + expectedHome(1500, 1600, 0) - 1) < 1e-12);
});

test("ohne Einstiegsfaktor ist jedes Spiel nullsummig", () => {
  const matches = [
    match({ homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0 }),
    match({ homeId: 2, awayId: 3, homeGoals: 1, awayGoals: 1, kickoff: NOW - 9 * DAY }),
    match({ homeId: 3, awayId: 1, homeGoals: 3, awayGoals: 1, kickoff: NOW - 8 * DAY })
  ];
  const state = calculateHistoricalElo(matches, PLAIN, { asOf: NOW });
  const total = [...state.teams.values()].reduce((sum, team) => sum + team.rating, 0);
  assert.ok(Math.abs(total - 3 * 1500) < 1e-9);
});

test("ein Remis zwischen Gleichstarken auf neutralem Platz ändert nichts", () => {
  // Liga 1 ist die WM-Endrunde: Nationalteams, neutraler Platz.
  const state = calculateHistoricalElo([
    match({ homeId: 10, awayId: 11, homeGoals: 0, awayGoals: 0, leagueId: 1, leagueName: "World Cup", leagueType: "Cup", country: "World" })
  ], PLAIN, { asOf: NOW });
  assert.equal(state.teams.get(teamKey("national", 10))!.rating, 1500);
  assert.equal(state.history[0]!.homeAdvantage, 0);
});

test("der Zeit-Decay senkt den Einfluss eines alten Spiels auf die Aktualisierung", () => {
  const recent = calculateHistoricalElo([match({ homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, kickoff: NOW - 60 * DAY })], PLAIN, { asOf: NOW });
  const old = calculateHistoricalElo([match({ homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, kickoff: NOW - 900 * DAY })], PLAIN, { asOf: NOW });
  const recentGain = recent.teams.get(teamKey("club", 1))!.rating - 1500;
  const oldGain = old.teams.get(teamKey("club", 1))!.rating - 1500;
  assert.equal(recent.history[0]!.timeDecay, 1);
  // Rund 30 Monate: Stufe 24-60 Monate der Vereinsstaffel, 60 % des K.
  assert.equal(old.history[0]!.timeDecay, 0.6);
  assert.ok(Math.abs(oldGain / recentGain - 0.6) < 1e-9);
  assert.equal(decayFactor(ELO_CONFIG.club, 70), 0);
});

test("die Tordifferenz zählt, ist aber gedeckelt und bremst Kantersiege des Stärkeren", () => {
  const mov = ELO_CONFIG.mov;
  assert.equal(movFactor(mov, 0, 0), 1);
  assert.ok(Math.abs(movFactor(mov, 1, 0) - 1) < 1e-12);
  assert.ok(movFactor(mov, 2, 0) > 1.5 && movFactor(mov, 2, 0) < 1.6);
  assert.equal(movFactor(mov, 9, 0), mov.cap);
  assert.ok(movFactor(mov, 3, 400) < movFactor(mov, 3, 0));
  // Ein extremer Außenseitersieg darf den Nenner nicht kippen lassen.
  assert.ok(movFactor(mov, 1, -5000) > 0);
});

test("ein Unentschieden nach Elfmeterschießen geht als Remis ein", () => {
  // API-Football führt im Endstand nur die Tore bis nach der Verlängerung.
  const state = calculateHistoricalElo([
    match({ homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 1, leagueType: "Cup", leagueName: "Pokal" })
  ], PLAIN, { asOf: NOW });
  assert.equal(state.history[0]!.result, 0.5);
});

test("Nationalteams landen nie auf der Vereinsskala", () => {
  const state = calculateHistoricalElo([
    match({ homeId: 50, awayId: 51, homeGoals: 2, awayGoals: 1, leagueId: 10, leagueName: "Friendlies", leagueType: "Cup", country: "World" }),
    match({ homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 1 })
  ], PLAIN, { asOf: NOW });
  assert.ok(state.teams.has(teamKey("national", 50)));
  assert.ok(!state.teams.has(teamKey("club", 50)));
  assert.ok(state.teams.has(teamKey("club", 1)));
  // Vereins-Testspiele (667) sind etwas anderes als Länderspiele (10).
  assert.deepEqual(
    classifyMatch({ leagueId: 667, leagueName: "Friendlies Clubs", leagueType: "Cup", country: "World" }),
    { excluded: false, system: "club", kind: "clubFriendly", isLeague: false, international: false, neutral: false }
  );
});

test("Frauen-, Jugend- und unbekannte internationale Wettbewerbe werden ausgeschlossen", () => {
  const state = calculateHistoricalElo([
    match({ homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, leagueName: "Frauen-Bundesliga Women" }),
    match({ homeId: 3, awayId: 4, homeGoals: 1, awayGoals: 0, leagueName: "U19 Bundesliga" }),
    match({ homeId: 5, awayId: 6, homeGoals: 1, awayGoals: 0, leagueId: 9999, leagueName: "Irgendein Turnier", country: "World" })
  ], PLAIN, { asOf: NOW });
  assert.equal(state.counts.excludedYouthWomen, 2);
  assert.equal(state.counts.excludedUnknown, 1);
  assert.equal(state.teams.size, 0);
});

test("die Ligaebene wird aus den Daten abgeleitet, nicht vorgegeben", () => {
  const matches: EloMatch[] = [];
  let day = 400;
  // Saison 2025: zwei Ligen desselben Landes, dazu Pokalspiele, in denen Liga 100 Liga 200 schlägt.
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 6; i += 2) {
      matches.push(match({ homeId: 1 + i, awayId: 2 + i, homeGoals: 1, awayGoals: 1, leagueId: 100, season: 2025, kickoff: NOW - day-- * DAY }));
      matches.push(match({ homeId: 11 + i, awayId: 12 + i, homeGoals: 1, awayGoals: 1, leagueId: 200, leagueName: "Zweite Liga", season: 2025, kickoff: NOW - day-- * DAY }));
    }
    for (let i = 0; i < 6; i += 1) {
      matches.push(match({ homeId: 1 + i, awayId: 11 + i, homeGoals: 3, awayGoals: 0, leagueId: 300, leagueName: "Pokal", leagueType: "Cup", season: 2025, kickoff: NOW - day-- * DAY }));
    }
  }
  // Saison 2026: beide Ligen spielen wieder.
  for (let i = 0; i < 6; i += 2) {
    matches.push(match({ homeId: 1 + i, awayId: 2 + i, homeGoals: 1, awayGoals: 0, leagueId: 100, season: 2026, kickoff: NOW - 20 * DAY }));
    matches.push(match({ homeId: 11 + i, awayId: 12 + i, homeGoals: 1, awayGoals: 0, leagueId: 200, leagueName: "Zweite Liga", season: 2026, kickoff: NOW - 20 * DAY }));
  }
  // Sechs Teams je Liga - die Vorgabe verlangt zehn belastbare, hier reichen sechs.
  const state = calculateHistoricalElo(matches, { ...PLAIN, tiers: { minTeams: 6, gap: 30 } }, { asOf: NOW });
  assert.equal(state.tiers.get("100|2026"), 1);
  assert.equal(state.tiers.get("200|2026"), 2);
  const second = state.history.find((row) => row.leagueId === 200 && row.kickoff === NOW - 20 * DAY)!;
  assert.equal(second.competition, "leagueTier2");
  assert.equal(second.competitionMultiplier, 0.9);
});

test("ein neues Team startet beim Mittel seiner Liga, nicht bei 1500", () => {
  const config: EloConfig = { ...PLAIN, newTeamStart: { mode: "competitionMean", minRated: 2 } };
  // In einer geschlossenen Liga bleibt der Schnitt bei jeder Nullsummenrechnung 1500. Erst
  // Spiele nach außen - hier Pokalsiege gegen Team 50 - heben das Niveau der Liga.
  const cup = { leagueId: 300, leagueName: "Pokal", leagueType: "Cup" };
  const matches = [
    match({ homeId: 1, awayId: 50, homeGoals: 3, awayGoals: 0, kickoff: NOW - 40 * DAY, ...cup }),
    match({ homeId: 2, awayId: 50, homeGoals: 3, awayGoals: 0, kickoff: NOW - 39 * DAY, ...cup }),
    match({ homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 1, kickoff: NOW - 30 * DAY }),
    match({ homeId: 99, awayId: 2, homeGoals: 0, awayGoals: 0, kickoff: NOW - 5 * DAY })
  ];
  const state = calculateHistoricalElo(matches, config, { asOf: NOW });
  const row = state.history.find((entry) => entry.homeId === 99)!;
  assert.ok(row.homeEloBefore > 1500, String(row.homeEloBefore));
  // Mit festem Start bleibt es bei 1500.
  const fixed = calculateHistoricalElo(matches, PLAIN, { asOf: NOW });
  assert.equal(fixed.history.find((entry) => entry.homeId === 99)!.homeEloBefore, 1500);
});

test("das Vertrauen steigt mit Spielen und verschiedenen Gegnern", () => {
  const matches: EloMatch[] = [];
  for (let i = 0; i < 30; i += 1) {
    matches.push(match({ homeId: 1, awayId: 100 + (i % 12), homeGoals: 1, awayGoals: 1, kickoff: NOW - (40 + i) * DAY }));
  }
  matches.push(match({ homeId: 2, awayId: 3, homeGoals: 1, awayGoals: 0, kickoff: NOW - 5 * DAY }));
  const rows = summarizeElo(calculateHistoricalElo(matches, PLAIN, { asOf: NOW }));
  const busy = rows.find((row) => row.teamId === 1)!;
  const thin = rows.find((row) => row.teamId === 2)!;
  assert.ok(thin.confidence < 5, String(thin.confidence));
  assert.ok(busy.confidence > 10 * thin.confidence);
  // Nur Spiele in der eigenen Liga: gedeckelt, weil nichts die Liga mit anderen verbindet.
  assert.ok(busy.confidence < 40, String(busy.confidence));

  // Dieselben Spiele plus Europapokal heben das Vertrauen, ohne das Elo zu berühren.
  const europe = Array.from({ length: 8 }, (_, i) => match({
    homeId: 1, awayId: 500 + i, homeGoals: 1, awayGoals: 1, kickoff: NOW - (80 + i) * DAY,
    leagueId: 2, leagueName: "UEFA Champions League", leagueType: "Cup", country: "World"
  }));
  const withEurope = summarizeElo(calculateHistoricalElo([...matches, ...europe], PLAIN, { asOf: NOW }))
    .find((row) => row.teamId === 1)!;
  assert.ok(withEurope.confidence > busy.confidence + 10, String(withEurope.confidence));
});

test("der Backtest nutzt kein Spiel ab dem Stichtag", () => {
  const testStart = NOW - 14 * DAY;
  const history = [
    match({ homeId: 1, awayId: 2, homeGoals: 3, awayGoals: 0, kickoff: NOW - 60 * DAY }),
    match({ homeId: 2, awayId: 1, homeGoals: 0, awayGoals: 2, kickoff: NOW - 50 * DAY })
  ];
  const probe = match({ homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, kickoff: testStart + DAY });
  const later = (goals: number) => match({ homeId: 2, awayId: 1, homeGoals: goals, awayGoals: 0, kickoff: testStart + 2 * DAY });

  const one = backtestElo([...history, probe, later(0)], PLAIN, { testStart, testEnd: NOW, stepDays: 7 });
  const two = backtestElo([...history, probe, later(9)], PLAIN, { testStart, testEnd: NOW, stepDays: 7 });
  const first = one.predictions.find((entry) => entry.fixtureId === probe.fixtureId)!;
  const second = two.predictions.find((entry) => entry.fixtureId === probe.fixtureId)!;
  assert.equal(first.expected, second.expected);

  const reference = calculateHistoricalElo(history, PLAIN, { asOf: testStart });
  assert.equal(first.expected, expectedHome(
    reference.teams.get(teamKey("club", 1))!.rating, reference.teams.get(teamKey("club", 2))!.rating, PLAIN.club.homeAdvantage
  ));
  const metrics = backtestMetrics(one.predictions)!;
  assert.equal(metrics.n, 2);
  assert.ok(Math.abs(first.pHome + first.pDraw + first.pAway - 1) < 1e-9);
});

test("die Liga-Mitnahme verschiebt die ganze Liga, nicht nur das Team, das gespielt hat", () => {
  const league = (homeId: number, awayId: number, leagueId: number, day: number) =>
    match({ homeId, awayId, homeGoals: 1, awayGoals: 1, leagueId, leagueName: `Liga ${leagueId}`, kickoff: NOW - day * DAY });
  const matches = [
    league(1, 2, 100, 30), league(11, 12, 200, 30),
    match({ homeId: 1, awayId: 11, homeGoals: 2, awayGoals: 0, leagueId: 300, leagueName: "Pokal", leagueType: "Cup", kickoff: NOW - 20 * DAY })
  ];
  const on = calculateHistoricalElo(matches, { ...PLAIN, leaguePropagation: { ...ELO_CONFIG.leaguePropagation, share: 0.3 } }, { asOf: NOW });
  const off = calculateHistoricalElo(matches, { ...PLAIN, leaguePropagation: { ...ELO_CONFIG.leaguePropagation, share: 0 } }, { asOf: NOW });
  const rating = (state: typeof on, id: number) => state.teams.get(teamKey("club", id))!.rating;
  const cup = on.history.find((row) => row.leagueId === 300)!;
  const gain = cup.homeEloAfter - cup.homeEloBefore;
  assert.ok(gain > 0);
  // Der Ligakollege von Team 1 steigt um 30 % dessen Gewinns, der von Team 11 fällt um 30 %
  // von dessen Verlust. Verglichen wird mit derselben Rechnung ohne Mitnahme.
  assert.ok(Math.abs(rating(on, 2) - rating(off, 2) - 0.3 * gain) < 1e-9);
  assert.ok(Math.abs(rating(on, 12) - rating(off, 12) - 0.3 * (cup.awayEloAfter - cup.awayEloBefore)) < 1e-9);
  // Die beiden, die gespielt haben, bekommen nichts doppelt.
  assert.ok(Math.abs(rating(on, 1) - rating(off, 1)) < 1e-9);
});

test("ohne belastbare Ratings wird keine Ligaebene vergeben - keine zufällige Abwertung", () => {
  // Zwei Ligen ohne ein einziges Spiel gegeneinander: Beide stehen bei 1500, die Reihenfolge wäre
  // Zufall. Früher wurde trotzdem eine davon Ebene 2 (so lag die 2. Bundesliga 2021 vor der ersten).
  const matches: EloMatch[] = [];
  for (let season = 2025; season <= 2026; season += 1) {
    for (let i = 0; i < 12; i += 2) {
      for (let round = 0; round < 3; round += 1) {
        const day = (2026 - season) * 300 + 60 + round * 10 + i;
        matches.push(match({ homeId: 1 + i, awayId: 2 + i, homeGoals: 1, awayGoals: 0, leagueId: 100, season, kickoff: NOW - day * DAY }));
        matches.push(match({ homeId: 21 + i, awayId: 22 + i, homeGoals: 1, awayGoals: 0, leagueId: 200, leagueName: "Zweite", season, kickoff: NOW - day * DAY }));
      }
    }
  }
  const state = calculateHistoricalElo(matches, { ...PLAIN, tiers: { minTeams: 10, gap: 30 } }, { asOf: NOW });
  // Beide Ligen gleich stark (je 1500 im Schnitt, weil nullsummig): beide Ebene 1.
  assert.notEqual(state.tiers.get("200|2026"), 2);
  assert.notEqual(state.tiers.get("200|2026"), 3);
  // Mit dem Einstieg der Vorgabe hat 2025 noch kein Team zehn gewichtete Spiele: keine Ebene.
  const strict = calculateHistoricalElo(matches, { ...ELO_CONFIG, leaguePropagation: { ...ELO_CONFIG.leaguePropagation, share: 0 } }, { asOf: NOW });
  assert.equal(strict.tiers.get("100|2025"), undefined);
  assert.equal(strict.tiers.get("200|2025"), undefined);
});

test("die Historie ist lückenlos: nachher + Liga-Mitnahme = nächstes vorher", () => {
  const league = (homeId: number, awayId: number, leagueId: number, day: number) =>
    match({ homeId, awayId, homeGoals: 1, awayGoals: 1, leagueId, leagueName: `Liga ${leagueId}`, kickoff: NOW - day * DAY });
  const matches = [
    league(1, 2, 100, 30), league(11, 12, 200, 30),
    match({ homeId: 1, awayId: 11, homeGoals: 2, awayGoals: 0, leagueId: 300, leagueName: "Pokal", leagueType: "Cup", kickoff: NOW - 20 * DAY }),
    league(2, 1, 100, 10)
  ];
  const state = calculateHistoricalElo(matches, { ...PLAIN, leaguePropagation: { ...ELO_CONFIG.leaguePropagation, share: 0.3 } }, { asOf: NOW });
  const first = state.history.find((row) => row.kickoff === NOW - 30 * DAY && row.leagueId === 100)!;
  const next = state.history.find((row) => row.kickoff === NOW - 10 * DAY)!;
  // Team 2 hat das Pokalspiel nicht gespielt, aber über die Mitnahme gewonnen.
  assert.ok(next.homeShift > 0);
  assert.ok(Math.abs(first.awayEloAfter + next.homeShift - next.homeEloBefore) < 1e-9);
  // Team 1 hat selbst gespielt: keine offene Verschiebung.
  assert.equal(next.awayShift, 0);
});

test("die Rangliste nennt die aktuelle Liga eines Aufsteigers, nicht die häufigste", () => {
  const matches: EloMatch[] = [];
  for (let i = 0; i < 10; i += 1) {
    matches.push(match({ homeId: 1, awayId: 100 + i, homeGoals: 1, awayGoals: 0, leagueId: 40, leagueName: "Championship", kickoff: NOW - (100 - i) * DAY }));
  }
  matches.push(match({ homeId: 1, awayId: 200, homeGoals: 0, awayGoals: 0, leagueId: 39, leagueName: "Premier League", kickoff: NOW - 5 * DAY }));
  const row = summarizeElo(calculateHistoricalElo(matches, PLAIN, { asOf: NOW })).find((entry) => entry.teamId === 1)!;
  assert.equal(row.league, "Premier League");
});

test("stark verfallene alte Spiele verbrauchen den Einstieg nicht", () => {
  const config: EloConfig = { ...ELO_CONFIG, leaguePropagation: { ...ELO_CONFIG.leaguePropagation, share: 0 }, newTeamStart: { mode: "fixed", minRated: 5 }, mov: { ...ELO_CONFIG.mov, enabled: false } };
  const matches: EloMatch[] = [];
  // Zwölf Spiele vor gut vier Jahren: je 7,5 % K, zusammen weniger als ein volles Spiel.
  for (let i = 0; i < 12; i += 1) {
    matches.push(match({ homeId: 1, awayId: 100 + i, homeGoals: 1, awayGoals: 1, kickoff: NOW - (1550 + i) * DAY }));
  }
  matches.push(match({ homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, kickoff: NOW - 5 * DAY }));
  const state = calculateHistoricalElo(matches, config, { asOf: NOW });
  const recent = state.history.at(-1)!;
  const base = config.club.k * recent.competitionMultiplier * recent.timeDecay * recent.mov;
  assert.ok(Math.abs(recent.homeK - base * config.provisional.multiplier) < 1e-9, String(recent.homeK));
});

test("Änderungen über 30 und 90 Tage enthalten die Liga-Mitnahme", () => {
  const league = (homeId: number, awayId: number, leagueId: number, day: number) =>
    match({ homeId, awayId, homeGoals: 1, awayGoals: 1, leagueId, leagueName: `Liga ${leagueId}`, kickoff: NOW - day * DAY });
  const matches = [
    league(1, 2, 100, 120), league(11, 12, 200, 120),
    match({ homeId: 1, awayId: 11, homeGoals: 3, awayGoals: 0, leagueId: 300, leagueName: "Pokal", leagueType: "Cup", kickoff: NOW - 10 * DAY })
  ];
  const rows = summarizeElo(calculateHistoricalElo(matches, { ...PLAIN, leaguePropagation: { ...ELO_CONFIG.leaguePropagation, share: 0.3 } }, { asOf: NOW }));
  const mate = rows.find((row) => row.teamId === 2)!;
  // Team 2 hat seit 120 Tagen nicht gespielt, ist aber über die Mitnahme gestiegen.
  assert.ok(mate.change30 > 0);
  assert.ok(Math.abs(mate.change30 - mate.change90) < 1e-9);
});

test("ein Spiel zwischen Verein und Nationalteam zählt in keinem System", () => {
  // API-Football legt solche Testspiele unter „Friendlies" (10) ab - Hull City gegen Curaçao -, und
  // umgekehrt stehen Nationalteam-IDs in „Friendlies Clubs" (667).
  const qualifier = { leagueId: 32, leagueName: "World Cup - Qualification Europe", leagueType: "Cup", country: "World" };
  const matches = [
    match({ homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, kickoff: NOW - 40 * DAY }),
    match({ homeId: 50, awayId: 51, homeGoals: 2, awayGoals: 0, kickoff: NOW - 30 * DAY, ...qualifier }),
    match({ homeId: 1, awayId: 50, homeGoals: 0, awayGoals: 1, kickoff: NOW - 20 * DAY, leagueId: 10, leagueName: "Friendlies", leagueType: "Cup", country: "World" }),
    match({ homeId: 2, awayId: 51, homeGoals: 3, awayGoals: 1, kickoff: NOW - 19 * DAY, leagueId: 667, leagueName: "Friendlies Clubs", leagueType: "Cup", country: "World" }),
    // Ein Länderspiel unter Nationalteams bleibt ein Länderspiel.
    match({ homeId: 51, awayId: 50, homeGoals: 1, awayGoals: 1, kickoff: NOW - 10 * DAY, leagueId: 10, leagueName: "Friendlies", leagueType: "Cup", country: "World" })
  ];
  const state = calculateHistoricalElo(matches, PLAIN, { asOf: NOW });
  assert.equal(state.counts.excludedMixed, 2);
  assert.ok(!state.teams.has(teamKey("national", 1)));
  assert.ok(!state.teams.has(teamKey("club", 50)));
  assert.ok(!state.teams.has(teamKey("club", 51)));
  assert.equal(state.teams.get(teamKey("national", 50))!.games, 2);
});

test("ein doppelt geführtes Spiel zählt einmal, ein Team gegen sich selbst gar nicht", () => {
  const cup = { leagueId: 300, leagueName: "Pokal", leagueType: "Cup" };
  const matches = [
    match({ homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0, kickoff: NOW - 20 * DAY }),
    // Dasselbe Spiel unter zweiter ID, eine halbe Stunde später angesetzt.
    match({ homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0, kickoff: NOW - 20 * DAY + 30 * 60 * 1000 }),
    // Drei Tage später im Pokal, gleicher Stand: ein zweites, echtes Spiel.
    match({ homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0, kickoff: NOW - 17 * DAY, ...cup }),
    // Anderer Stand am selben Tag: Welches stimmt, ist nicht zu sagen - beide bleiben.
    match({ homeId: 3, awayId: 4, homeGoals: 1, awayGoals: 1, kickoff: NOW - 10 * DAY }),
    match({ homeId: 3, awayId: 4, homeGoals: 2, awayGoals: 1, kickoff: NOW - 10 * DAY }),
    match({ homeId: 5, awayId: 5, homeGoals: 1, awayGoals: 0, kickoff: NOW - 5 * DAY })
  ];
  const state = calculateHistoricalElo(matches, PLAIN, { asOf: NOW });
  assert.equal(state.counts.excludedDuplicate, 2);
  assert.equal(state.history.length, 4);
  assert.equal(state.teams.get(teamKey("club", 1))!.games, 2);
  assert.ok(!state.teams.has(teamKey("club", 5)));
});

test("zusammengeführte Team-IDs ergeben eine Geschichte, mit Land und Ausnahme", () => {
  // Wie AFC Malmö: 2023-2025 unter ID 300, seit 2026 unter 400. ID 500 teilt sich der Verein
  // mit einem tunesischen Klub - nur die schwedischen Spiele und Testspiele gehören dazu.
  const merges = [
    { from: 300, to: 400, note: "alt" },
    { from: 500, to: 400, countries: ["Sweden", "World"], exceptFixtures: [9003], note: "geteilt" }
  ];
  const sweden = { country: "Sweden", leagueId: 564, leagueName: "Ettan - Södra" };
  const friendly = { country: "World", leagueId: 667, leagueName: "Friendlies Clubs", leagueType: "Cup" };
  const matches = [
    match({ fixtureId: 9001, homeId: 300, awayId: 1, homeGoals: 2, awayGoals: 0, homeName: "Ariana", kickoff: NOW - 400 * DAY, ...sweden }),
    match({ fixtureId: 9002, homeId: 500, awayId: 2, homeGoals: 1, awayGoals: 1, homeName: "Ariana", kickoff: NOW - 200 * DAY, ...friendly }),
    // Tunesischer Gegner im Testspiel: bleibt beim tunesischen Klub.
    match({ fixtureId: 9003, homeId: 3, awayId: 500, homeGoals: 1, awayGoals: 0, awayName: "Ariana", kickoff: NOW - 150 * DAY, ...friendly }),
    // Tunesische Liga: bleibt ebenfalls bei 500.
    match({ fixtureId: 9004, homeId: 500, awayId: 4, homeGoals: 0, awayGoals: 0, homeName: "Ariana", kickoff: NOW - 100 * DAY, country: "Tunisia", leagueId: 828, leagueName: "Ligue 2" }),
    match({ fixtureId: 9005, homeId: 400, awayId: 5, homeGoals: 3, awayGoals: 1, homeName: "AFC Malmo", kickoff: NOW - 10 * DAY, ...sweden })
  ];
  const state = calculateHistoricalElo(matches, PLAIN, { asOf: NOW, merges });
  const malmo = state.teams.get(teamKey("club", 400))!;
  assert.equal(malmo.games, 3);
  assert.equal(malmo.name, "AFC Malmo");
  assert.ok(!state.teams.has(teamKey("club", 300)));
  assert.equal(state.teams.get(teamKey("club", 500))!.games, 2);
  // Ohne Zusammenführung zerfällt dieselbe Geschichte in drei Teams.
  const split = calculateHistoricalElo(matches, PLAIN, { asOf: NOW, merges: [] });
  assert.equal(split.teams.get(teamKey("club", 400))!.games, 1);
});

test("mainLeague: ein Nebenwettbewerb zieht einen Verein nicht aus seiner Liga", () => {
  // Verein 1 spielt Serie A (Liga 100, zehn Spiele je Team), dann Staatsliga (Liga 500, drei je
  // Team) und danach im Pokal gegen Verein 31 aus Liga 200 - wie Palmeiras im Februar.
  const config = (membership: "lastLeague" | "mainLeague"): EloConfig => ({
    ...PLAIN,
    leaguePropagation: { share: 0.3, membership, sideCompetition: { ratio: 0.5, stickyDays: 180, minMatches: 5 } }
  });
  const scenario = (stateLeagueDay: number, cupDay: number) => {
    const matches: EloMatch[] = [];
    let day = 300;
    const roundRobin = (teams: number[], leagueId: number, twice: boolean, start: number) => {
      let d = start;
      teams.forEach((home, i) => teams.forEach((away, j) => {
        if (home !== away && (twice || i < j)) {
          matches.push(match({ homeId: home, awayId: away, homeGoals: 1, awayGoals: 1, leagueId, leagueName: `Liga ${leagueId}`, kickoff: NOW - d-- * DAY }));
        }
      }));
    };
    roundRobin([1, 2, 3, 4, 5, 6], 100, true, day);
    day -= 40;
    roundRobin([31, 32, 33, 34], 200, false, day);
    roundRobin([1, 2, 21, 22], 500, false, stateLeagueDay);
    const cup = match({ homeId: 1, awayId: 31, homeGoals: 3, awayGoals: 0, leagueId: 300, leagueName: "Pokal", leagueType: "Cup", kickoff: NOW - cupDay * DAY });
    return { matches, cup };
  };
  // Was das Pokalspiel an Team 3 (nur Serie A) und Team 21 (nur Staatsliga) weitergibt, gemessen
  // gegen denselben Bestand ohne das Pokalspiel - relativ zum Gewinn von Verein 1.
  const passedOn = (membership: "lastLeague" | "mainLeague", stateLeagueDay: number, cupDay: number) => {
    const { matches, cup } = scenario(stateLeagueDay, cupDay);
    const withCup = calculateHistoricalElo([...matches, cup], config(membership), { asOf: NOW });
    const without = calculateHistoricalElo(matches, config(membership), { asOf: NOW });
    const row = withCup.history.find((entry) => entry.leagueId === 300)!;
    const gain = row.homeEloAfter - row.homeEloBefore;
    const shift = (id: number) => (withCup.teams.get(teamKey("club", id))!.rating - without.teams.get(teamKey("club", id))!.rating) / gain;
    return { serieA: shift(3), stateOnly: shift(21) };
  };
  // Staatsliga 150 Tage nach der Serie A: Mit mainLeague bleibt Verein 1 in der Serie A.
  const main = passedOn("mainLeague", 150, 100);
  assert.ok(Math.abs(main.serieA - 0.3) < 1e-9, String(main.serieA));
  assert.equal(main.stateOnly, 0);
  // Bisher zog das letzte Ligaspiel ihn in die Staatsliga.
  const last = passedOn("lastLeague", 150, 100);
  assert.equal(last.serieA, 0);
  assert.ok(Math.abs(last.stateOnly - 0.3) < 1e-9, String(last.stateOnly));
  // Nach mehr als 180 Tagen ohne Serie-A-Spiel gilt die kürzere Liga doch - wie nach einem Abstieg.
  const relegated = passedOn("mainLeague", 60, 20);
  assert.equal(relegated.serieA, 0);
  assert.ok(Math.abs(relegated.stateOnly - 0.3) < 1e-9, String(relegated.stateOnly));
});
