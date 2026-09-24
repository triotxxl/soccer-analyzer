import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardFixture } from "../src/dashboard.ts";
import {
  DRAW_SIGNAL_CONFIG,
  formatDrawPoints,
  scoreDrawSignals,
  type DrawSignalConfig,
  type DrawSignalId
} from "../src/draw-signals.ts";
import { evaluateRemisScore, DEFAULT_REMIS_SCORE_SETTINGS } from "../src/quickpick-remisscore.ts";
import type { RecentMatchSummary } from "../src/types.ts";

/** Ein Vorspiel aus Sicht von `team`, das zu Hause spielte. */
function match(
  id: number,
  team: string,
  opponent: string,
  goals: [number, number],
  halfTime: [number, number] = [0, 0],
  stats?: { own: number; other: number; possession?: number; xg?: [number, number] }
): RecentMatchSummary {
  return {
    fixtureId: id, teamWasHome: true, date: `2026-09-0${(id % 9) + 1}T15:00:00Z`,
    homeTeam: team, awayTeam: opponent, homeGoals: goals[0], awayGoals: goals[1],
    halfTimeHomeGoals: halfTime[0], halfTimeAwayGoals: halfTime[1],
    ...(stats ? {
      stats: {
        home: { shotsOnGoal: stats.own, corners: 4, possession: stats.possession ?? 50, xg: stats.xg?.[0] ?? null },
        away: { shotsOnGoal: stats.other, corners: 4, possession: 100 - (stats.possession ?? 50), xg: stats.xg?.[1] ?? null }
      }
    } : {})
  };
}

const TABLE: NonNullable<DashboardFixture["table"]> = [
  { position: 5, teamName: "Alpha", played: 10, wins: 4, draws: 4, losses: 2, points: 16, goalsFor: 12, goalsAgainst: 10, homePlayed: 5, homePoints: 9, awayPlayed: 5, awayPoints: 7 },
  { position: 6, teamName: "Beta", played: 10, wins: 4, draws: 3, losses: 3, points: 15, goalsFor: 11, goalsAgainst: 10, homePlayed: 5, homePoints: 6, awayPlayed: 5, awayPoints: 9 },
  { position: 4, teamName: "G1", played: 10, wins: 5, draws: 2, losses: 3, points: 17, goalsFor: 14, goalsAgainst: 11 },
  { position: 7, teamName: "G2", played: 10, wins: 4, draws: 2, losses: 4, points: 14, goalsFor: 12, goalsAgainst: 12 },
  { position: 1, teamName: "Top", played: 10, wins: 9, draws: 1, losses: 0, points: 28, goalsFor: 30, goalsAgainst: 5 },
  { position: 18, teamName: "Bottom", played: 10, wins: 0, draws: 1, losses: 9, points: 1, goalsFor: 3, goalsAgainst: 30 }
];

/** Ein sehr ausgeglichenes Spiel: Jedes Kriterium mit Gewicht sollte volle Punkte geben. */
function balancedFixture(): DashboardFixture {
  const stats = { own: 4, other: 4, possession: 50, xg: [1.1, 1.1] as [number, number] };
  const homeMatches = [1, 2, 3, 4, 5].map((id) => match(id, "Alpha", id % 2 ? "G1" : "G2", [1, 1], [0, 0], stats));
  const awayMatches = [6, 7, 8, 9, 10].map((id) => ({
    ...match(id, "G1", "Beta", [1, 1], [0, 1], stats),
    homeTeam: id % 2 ? "G1" : "G2", awayTeam: "Beta", teamWasHome: false
  }));
  const duels = [11, 12, 13].map((id) => match(id, "Alpha", "Beta", [0, 0], [0, 0], stats));
  return {
    fixtureId: 99, kickoff: "2026-09-26T15:00:00Z", country: "Land", league: "Liga",
    homeTeam: "Alpha", awayTeam: "Beta", modelVersion: "test", crossLeague: false,
    dataConfidence: 85, warnings: [], h2hNotice: null,
    form: {
      scope: "venue",
      home: ["draw", "draw", "draw", "draw", "draw"],
      away: ["draw", "draw", "draw", "draw", "draw"],
      homeMatches, awayMatches
    },
    h2h: { outcomes: ["draw", "draw", "draw"], btts: [false, false, false], draws: 3, consecutiveDraws: 3, matches: duels },
    table: TABLE,
    expectedGoals: { home: 1, away: 1, total: 2 },
    scores: { favorite: 20, draw: 60 },
    markets: [{
      key: "draw", label: "Remis", selection: "Unentschieden (X)", pick: null, selectionTone: "draw",
      probability: 0.3, odds: 3.2, confidence: 80, score: null,
      recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
    }]
  };
}

function criterion(fixture: DashboardFixture, id: DrawSignalId, config?: DrawSignalConfig) {
  return scoreDrawSignals(fixture, config).criteria.find((entry) => entry.id === id)!;
}

test("ein ausgeglichenes Spiel holt in jedem gewichteten Kriterium die vollen Punkte", () => {
  const result = scoreDrawSignals(balancedFixture());
  assert.equal(result.max, 25);
  assert.equal(result.evaluableMax, 25);
  for (const entry of result.criteria.filter((item) => item.weight > 0)) {
    assert.equal(entry.level, 1, `${entry.id}: ${entry.reason}`);
  }
  assert.equal(result.score, 25);
  assert.equal(result.version, DRAW_SIGNAL_CONFIG.version);
});

test("die Startgewichte ergeben zusammen 25 Punkte", () => {
  const total = Object.values(DRAW_SIGNAL_CONFIG.rules).reduce((sum, rule) => sum + rule.weight, 0);
  assert.equal(total, 25);
});

test("fehlende Daten machen ein Kriterium nicht bewertbar, statt es als unausgeglichen zu werten", () => {
  const fixture = balancedFixture();
  delete fixture.table;
  fixture.form.homeMatches = fixture.form.homeMatches.map(({ stats: _stats, ...rest }) => rest);
  const result = scoreDrawSignals(fixture);
  for (const id of ["tablePpg", "tableGoalDiff", "venueRecord", "shotShare", "xgShare", "possession"] as DrawSignalId[]) {
    const entry = result.criteria.find((item) => item.id === id)!;
    assert.equal(entry.evaluable, false, id);
    assert.equal(entry.points, 0, id);
  }
  // Tabelle 7 + Spielbild 5 Punkte fehlen im bewertbaren Maximum.
  assert.equal(result.evaluableMax, 13);
});

test("ohne Heim-/Auswärtsbilanz (Läufe vor schemaVersion 6) ist nur dieses Kriterium nicht bewertbar", () => {
  const fixture = balancedFixture();
  fixture.table = TABLE.map(({ homePlayed: _a, homePoints: _b, awayPlayed: _c, awayPoints: _d, ...rest }) => rest);
  assert.equal(criterion(fixture, "venueRecord").evaluable, false);
  assert.equal(criterion(fixture, "tablePpg").level, 1);
});

test("Tabellenunterschiede geben Teilpunkte und dann keine mehr", () => {
  const fixture = balancedFixture();
  fixture.table = TABLE.map((row) => row.teamName === "Beta" ? { ...row, points: 13 } : row);
  // 1,60 zu 1,30: Abstand 0,30 liegt zwischen 0,15 und 0,35.
  assert.equal(criterion(fixture, "tablePpg").points, 1.5);
  fixture.table = TABLE.map((row) => row.teamName === "Beta" ? { ...row, points: 8 } : row);
  assert.equal(criterion(fixture, "tablePpg").points, 0);
  assert.match(criterion(fixture, "tablePpg").reason, /1,60 zu 0,80/);
});

/** Davids Vorgabe: Eine ähnliche Form zählt nicht, wenn sie gegen schwächere Gegner zustande kam. */
test("die Form zählt nicht, wenn die Gegner unterschiedlich stark waren", () => {
  const fixture = balancedFixture();
  fixture.form.homeMatches = fixture.form.homeMatches.map((entry) => ({ ...entry, awayTeam: "Top" }));
  fixture.form.awayMatches = fixture.form.awayMatches.map((entry) => ({ ...entry, homeTeam: "Bottom" }));
  const entry = criterion(fixture, "venueForm");
  assert.equal(entry.evaluable, true);
  assert.equal(entry.level, 0);
  assert.match(entry.reason, /Gegner waren unterschiedlich stark/);
});

test("ohne auffindbare Gegner wird die Form trotzdem bewertet, mit Hinweis", () => {
  const fixture = balancedFixture();
  fixture.form.homeMatches = fixture.form.homeMatches.map((entry) => ({ ...entry, awayTeam: "Pokalgegner" }));
  const entry = criterion(fixture, "venueForm");
  assert.equal(entry.level, 1);
  assert.match(entry.reason, /nicht prüfbar/);
});

test("Testspiele fallen aus den direkten Duellen", () => {
  const fixture = balancedFixture();
  fixture.h2h.matches = [
    { ...fixture.h2h.matches[0]!, friendly: true },
    { ...fixture.h2h.matches[1]!, homeGoals: 2, awayGoals: 0 },
    { ...fixture.h2h.matches[2]!, homeGoals: 3, awayGoals: 1 }
  ];
  const entry = criterion(fixture, "h2hDraws");
  // Übrig bleiben zwei Duelle ohne Remis - das Testspiel-0:0 zählt nicht.
  assert.equal(entry.value, 0);
  assert.equal(entry.points, 0);
  assert.match(entry.reason, /letzte 2 Duelle: 0 Remis/);
});

test("ein Remis in den letzten drei Duellen gibt ein Drittel der Punkte", () => {
  const fixture = balancedFixture();
  fixture.h2h.matches = [
    fixture.h2h.matches[0]!,
    { ...fixture.h2h.matches[1]!, homeGoals: 2, awayGoals: 0 },
    { ...fixture.h2h.matches[2]!, homeGoals: 0, awayGoals: 1 }
  ];
  assert.equal(criterion(fixture, "h2hDraws").points, 1);
});

test("Gewicht 0 schaltet ein Kriterium ab, gemessen wird es weiter", () => {
  const config: DrawSignalConfig = {
    ...DRAW_SIGNAL_CONFIG,
    rules: { ...DRAW_SIGNAL_CONFIG.rules, lowExpectedGoals: { ...DRAW_SIGNAL_CONFIG.rules.lowExpectedGoals, weight: 0 } }
  };
  const result = scoreDrawSignals(balancedFixture(), config);
  const entry = result.criteria.find((item) => item.id === "lowExpectedGoals")!;
  assert.equal(entry.level, 1);
  assert.equal(entry.points, 0);
  assert.equal(result.max, 22);
  assert.equal(result.score, 22);
});

test("ein einseitiges Spielbild kostet die Schusspunkte", () => {
  const fixture = balancedFixture();
  fixture.form.homeMatches = fixture.form.homeMatches.map((entry) => ({
    ...entry, stats: { home: { ...entry.stats!.home, shotsOnGoal: 8 }, away: { ...entry.stats!.away, shotsOnGoal: 2 } }
  }));
  const entry = criterion(fixture, "shotShare");
  assert.equal(entry.points, 0);
  assert.match(entry.reason, /80 % zu 50 %/);
});

test("die Auswärtsseite liest ihre eigene Statistik, nicht die des Gastgebers", () => {
  const fixture = balancedFixture();
  // Beta war in allen Vorspielen Gast und hatte 6 von 8 Schüssen aufs Tor: Anteil 75 %.
  fixture.form.awayMatches = fixture.form.awayMatches.map((entry) => ({
    ...entry, stats: { home: { ...entry.stats!.home, shotsOnGoal: 2 }, away: { ...entry.stats!.away, shotsOnGoal: 6 } }
  }));
  assert.match(criterion(fixture, "shotShare").reason, /50 % zu 75 %/);
});

test("Punkte werden ohne überflüssige Nachkommastelle angezeigt", () => {
  assert.equal(formatDrawPoints(3), "3");
  assert.equal(formatDrawPoints(1.5), "1,5");
  assert.equal(formatDrawPoints(1 / 3 * 3), "1");
});

test("die Voreinstellung filtert nach Score und nach bewertbaren Punkten", () => {
  const passing = evaluateRemisScore(balancedFixture(), DEFAULT_REMIS_SCORE_SETTINGS);
  assert.equal(passing.passes, true);
  assert.equal(passing.market, "draw");
  assert.equal(passing.side, null);
  assert.equal(passing.remisScore?.score, 25);

  const tooHigh = evaluateRemisScore(balancedFixture(), { ...DEFAULT_REMIS_SCORE_SETTINGS, minScore: 26 });
  assert.equal(tooHigh.rejectedBy, "remisScore");

  const thin = balancedFixture();
  delete thin.table;
  thin.form.homeMatches = thin.form.homeMatches.map(({ stats: _stats, ...rest }) => rest);
  assert.equal(evaluateRemisScore(thin, DEFAULT_REMIS_SCORE_SETTINGS).rejectedBy, "remisDaten");

  const noMarket = balancedFixture();
  noMarket.markets = [];
  assert.equal(evaluateRemisScore(noMarket, DEFAULT_REMIS_SCORE_SETTINGS).rejectedBy, "keinMarkt");
});

test("archivierte Läufe ohne Vorspiel-Listen brechen die Bewertung nicht", () => {
  const fixture = balancedFixture() as unknown as { form: Record<string, unknown>; h2h: Record<string, unknown> };
  delete fixture.form.homeMatches;
  delete fixture.form.awayMatches;
  delete fixture.h2h.matches;
  const result = scoreDrawSignals(fixture as unknown as DashboardFixture);
  assert.equal(result.criteria.find((item) => item.id === "shotShare")!.evaluable, false);
  assert.equal(result.criteria.find((item) => item.id === "h2hDraws")!.evaluable, false);
});
