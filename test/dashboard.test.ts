import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDashboardDocument, writeDashboard, type DashboardInput } from "../src/dashboard.ts";

function dashboardInput(odds = 1.75, strengthAvailable = true): DashboardInput {
  const base = { createdAt: "2026-08-11T16:00:00.000Z", dates: ["2026-08-11"], apiRequests: 0, apiRequestsRemaining: 7000 };
  return {
    createdAt: base.createdAt,
    sourceFile: "data.json",
    totalTipicoEvents: 1,
    selectedTipicoEvents: 1,
    selectedCompetitions: 1,
    tipicoOdds: [{ homeTeam: "Heim FC", awayTeam: "Gast FC", home: odds, draw: 3.5, away: 4.2, bttsYes: 1.8, over15: 1.25, over25: 1.9, firstHalfOver05: 1.35, firstHalfOver15: 2.4 }],
    draw: {
      ...base,
      leagues: [],
      rows: [{
        fixtureId: 1, kickoff: "2026-08-11T19:00:00.000Z", country: "Deutschland", league: "Bundesliga",
        homeTeam: "Heim FC", awayTeam: "Gast FC", odds: 3.5, score: 65, confidence: 80,
        modelVersion: "draw-test", marketScore: 0, sportsScore: 65, availableMaximum: 100, warnings: ["Draw-Warnung"],
        model: "cross-league", recentHomeResults: ["win", "draw", "loss"], recentAwayResults: ["loss", "win", "draw"],
        h2hSummary: {
          matches: 4, draws: 3, consecutiveDraws: 3, allDraws: false,
          recentHomeTeamResults: ["win", "draw", "loss", "draw"], recentBttsResults: [true, true, false, true],
          recentMatches: [{
            date: "2026-05-10T15:30:00.000Z", homeTeam: "Heim FC", awayTeam: "Gast FC",
            homeGoals: 2, awayGoals: 1, halfTimeHomeGoals: 1, halfTimeAwayGoals: 0
          }]
        },
        rating: "interessant",
        breakdown: { table: 0, stability: 0, form: 0, goalLevel: 0, headToHead: 0, market: 0, venueBalance: 0, deductions: 0 }
      }]
    },
    favorites: {
      ...base,
      rows: [{
        fixtureId: 1, kickoff: "2026-08-11T19:00:00.000Z", country: "Deutschland", league: "Bundesliga",
        homeTeam: "Heim FC", awayTeam: "Gast FC", selection: "1", selectedTeam: "Heim FC", odds,
        score: 75, confidence: 85, modelVersion: "favorite-test", marketScore: 0, sportsScore: 75,
        availableMaximum: 100, warnings: ["Favoriten-Warnung"], model: "cross-league", rating: "stark",
        breakdown: { market: 0, table: 0, seasonStrength: 0, form: 0, goalDominance: 0, venueAdvantage: 0, headToHead: 0, dataQuality: 0, deductions: 0 }
      }]
    },
    goals: {
      ...base,
      rows: [{
        fixtureId: 1, kickoff: "2026-08-11T19:00:00.000Z", country: "Deutschland", league: "Bundesliga",
        homeTeam: "Heim FC", awayTeam: "Gast FC", modelVersion: "goals-test", expectedHomeGoals: 1.5,
        expectedAwayGoals: 1, expectedTotalGoals: 2.5, dataConfidence: 85,
        outcomeProbabilities: { home: 0.72, draw: 0.34, away: 0.2, btts: 0.7 },
        defense: {
          home: { concededGoals: 0.65, relativeToLeague: 0.55, matches: 18, venueMatches: 9, strong: true },
          away: { concededGoals: 1.4, relativeToLeague: 1.05, matches: 16, venueMatches: 8, strong: false }
        },
        probabilities: { over15: 0.86, under15: 0.14, over25: 0.71, under25: 0.29, over35: 0.4, under35: 0.6 },
        ...(strengthAvailable ? { strength: {
          home: { leagueId: 78, rating: 1620, reliable: true },
          away: { leagueId: 79, rating: 1480, reliable: true },
          factor: 1.43
        } } : {}),
        firstHalf: {
          expectedHomeGoals: 0.7, expectedAwayGoals: 0.45, expectedTotalGoals: 1.15, dataConfidence: 85,
          probabilities: { over05: 0.78, under05: 0.22, over15: 0.42, under15: 0.58 }, warnings: ["Halbzeit-Warnung"]
        },
        warnings: ["Torlinien-Warnung"]
      }]
    }
  };
}

test("Dashboard-Dokument führt alle Analysen über fixtureId zusammen", () => {
  const document = buildDashboardDocument(dashboardInput());
  assert.equal(document.schemaVersion, 4);
  assert.equal(document.meta.timezone, "Europe/Berlin");
  assert.equal(document.meta.fixtureCount, 1);
  const fixture = document.fixtures[0]!;
  assert.equal(fixture.crossLeague, true);
  assert.equal(fixture.form.scope, "overall");
  assert.deepEqual(fixture.form.home, ["win", "draw", "loss"]);
  assert.equal(fixture.h2h.draws, 3);
  assert.equal(fixture.h2h.matches[0]?.homeGoals, 2);
  assert.equal(fixture.h2h.matches[0]?.halfTimeHomeGoals, 1);
  assert.equal(fixture.defense?.home.strong, true);
  assert.equal(fixture.scores.favorite, 75);
  assert.equal(fixture.scores.draw, 65);
  assert.match(fixture.h2hNotice ?? "", /3 direkte Duelle/);
  assert.deepEqual(new Set(fixture.warnings), new Set(["Torlinien-Warnung", "Draw-Warnung", "Favoriten-Warnung"]));
  // Jeder Gegenmarkt steht direkt hinter seinem Basismarkt.
  assert.deepEqual(fixture.markets.map((market) => market.key), [
    "1x2", "draw",
    "btts", "bttsNo",
    "over15", "under15",
    "over25", "under25",
    "over35", "under35",
    "firstHalfOver05", "firstHalfUnder05",
    "firstHalfOver15", "firstHalfUnder15"
  ]);
  assert.deepEqual(fixture.expectedFirstHalfGoals, { home: 0.7, away: 0.45, total: 1.15 });
  // Über den Schlüssel gesucht, nicht über die Position: Sonst bricht jeder neue Markt in der
  // Mitte diese Prüfung, ohne dass fachlich etwas kaputt wäre.
  const market = (key: string) => fixture.markets.find((entry) => entry.key === key);
  assert.equal(market("firstHalfOver05")?.odds, 1.35);
  assert.equal(market("firstHalfOver05")?.recommendation.level, "recommended");
  assert.equal(market("1x2")?.pick, "1");
  assert.equal(market("1x2")?.odds, 1.75);
  assert.equal(market("1x2")?.recommendation.level, "strong");
});

test("Gegenmärkte tragen die Gegenwahrscheinlichkeit und die Gegenquote", () => {
  const input = dashboardInput();
  input.tipicoOdds[0]!.bttsNo = 2.05;
  input.tipicoOdds[0]!.under25 = 1.95;
  input.tipicoOdds[0]!.over35 = 3.4;
  input.tipicoOdds[0]!.under35 = 1.3;
  const markets = buildDashboardDocument(input).fixtures[0]!.markets;
  const market = (key: string) => markets.find((entry) => entry.key === key)!;

  // BTTS Nein ist die Gegenwahrscheinlichkeit zu BTTS Ja (0,7).
  assert.equal(market("btts").probability, 0.7);
  assert.ok(Math.abs(market("bttsNo").probability - 0.3) < 1e-9);
  assert.equal(market("bttsNo").odds, 2.05);

  // Die Unter-Werte kommen unverändert aus dem Modell.
  assert.equal(market("under25").probability, 0.29);
  assert.equal(market("under25").odds, 1.95);
  assert.equal(market("under15").probability, 0.14);
  assert.equal(market("over35").probability, 0.4);
  assert.equal(market("under35").probability, 0.6);
  assert.equal(market("under35").odds, 1.3);
  assert.equal(market("firstHalfUnder05").probability, 0.22);
  assert.equal(market("firstHalfUnder15").probability, 0.58);

  // Ohne Gegenquote bleibt der Markt bewertbar, nur ohne Quote.
  assert.equal(market("under15").odds, null);
});

test("Tipico-Quote ändert weder sportliche Auswahl noch Empfehlungsstufe", () => {
  const low = buildDashboardDocument(dashboardInput(1.3)).fixtures[0]!.markets[0]!;
  const high = buildDashboardDocument(dashboardInput(5.5)).fixtures[0]!.markets[0]!;
  assert.equal(low.pick, high.pick);
  assert.equal(low.probability, high.probability);
  assert.deepEqual(low.recommendation, high.recommendation);
  assert.notEqual(low.odds, high.odds);
});

test("Halbzeit-Quoten bleiben informativ und Empfehlungen nutzen linienabhängige Schwellen", () => {
  const lowInput = dashboardInput();
  const highInput = dashboardInput();
  lowInput.tipicoOdds[0]!.firstHalfOver05 = 1.1;
  highInput.tipicoOdds[0]!.firstHalfOver05 = 4.5;
  const low = buildDashboardDocument(lowInput).fixtures[0]!.markets.find((market) => market.key === "firstHalfOver05")!;
  const high = buildDashboardDocument(highInput).fixtures[0]!.markets.find((market) => market.key === "firstHalfOver05")!;
  assert.equal(low.probability, high.probability);
  assert.deepEqual(low.recommendation, high.recommendation);
  assert.notEqual(low.odds, high.odds);

  const strongInput = dashboardInput();
  strongInput.goals.rows[0]!.firstHalf.probabilities.over15 = 0.45;
  const strong = buildDashboardDocument(strongInput).fixtures[0]!.markets.find((market) => market.key === "firstHalfOver15")!;
  assert.equal(strong.recommendation.level, "strong");
});

test("Dashboard-Ausgabe schreibt latest und datierten Snapshot als JSON", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dashboard-test-"));
  try {
    const files = await writeDashboard(dashboardInput(), directory);
    assert.equal(path.basename(files.latest), "dashboard-latest.json");
    assert.match(path.basename(files.snapshot), /^dashboard-2026-08-11T16-00-00-000Z\.json$/);
    const latest = JSON.parse(await readFile(files.latest, "utf8")) as { schemaVersion: number };
    assert.equal(latest.schemaVersion, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Cross-League ohne Ligastärke-Vergleich weist keine 1X2-Wahrscheinlichkeit aus", () => {
  const fixture = buildDashboardDocument(dashboardInput(1.75, false)).fixtures[0]!;
  const outcome = fixture.markets.find((market) => market.key === "1x2")!;
  assert.equal(fixture.crossLeague, true);
  assert.equal(outcome.probabilityReliable, false);
  assert.equal(outcome.recommendation.level, "none");
  assert.ok(outcome.details.some((detail) => /Value und Kelly bleiben aus/.test(detail)));

  // Der fehlende Torfaktor kippt die Richtung des Ergebnisses, lässt Torsumme und BTTS
  // aber nahezu unberührt - diese Märkte bleiben deshalb bewertbar.
  for (const key of ["draw", "btts", "over15", "over25"] as const) {
    const market = fixture.markets.find((item) => item.key === key)!;
    assert.equal(market.probabilityReliable, undefined);
  }
  assert.equal(fixture.markets.find((market) => market.key === "over15")!.recommendation.level, "strong");
});

test("Mit Ligastärke-Vergleich bleibt die 1X2-Bewertung unangetastet", () => {
  const outcome = buildDashboardDocument(dashboardInput()).fixtures[0]!.markets[0]!;
  assert.equal(outcome.probabilityReliable, undefined);
  assert.equal(outcome.recommendation.level, "strong");
  assert.ok(outcome.details.some((detail) => /Ligastärke: /.test(detail)));
});

test("Klassenunterschied kommt aus dem Ligarating, sobald der Torfaktor deutlich wird", () => {
  const input = dashboardInput();
  input.goals.rows[0]!.strength = {
    home: { leagueId: 78, rating: 1700, reliable: true },
    away: { leagueId: 79, rating: 1400, reliable: true },
    factor: 2.15
  };
  const gap = buildDashboardDocument(input).fixtures[0]!.classGap!;
  assert.equal(gap.level, "clear");
  assert.equal(gap.stronger, "home");
  assert.equal(gap.source, "rating");
  assert.match(gap.label, /Ligastärke 1700 gegen 1400/);

  input.goals.rows[0]!.strength.factor = 2.4;
  assert.equal(buildDashboardDocument(input).fixtures[0]!.classGap!.level, "extreme");

  // Ein Faktor unter 1,5 ist kein Klassenunterschied, sondern normale Ligastreuung.
  input.goals.rows[0]!.strength.factor = 1.3;
  assert.equal(buildDashboardDocument(input).fixtures[0]!.classGap, undefined);
});

test("Eine nur geschätzte Ligastärke genügt für die untere Stufe", () => {
  const input = dashboardInput();
  input.goals.rows[0]!.strength = {
    home: { leagueId: 78, rating: 1560, reliable: true },
    away: { leagueId: 0, rating: 1440, reliable: false },
    factor: 1.36
  };
  const gap = buildDashboardDocument(input).fixtures[0]!.classGap!;
  assert.equal(gap.level, "clear");
  assert.equal(gap.stronger, "home");
  assert.match(gap.label, /eine Seite geschätzt/);
});

test("Ohne Ligarating trägt das Quotenbild die Markierung", () => {
  const input = dashboardInput(1.24, false);
  input.tipicoOdds[0]!.away = 12;
  const gap = buildDashboardDocument(input).fixtures[0]!.classGap!;
  assert.equal(gap.level, "extreme");
  assert.equal(gap.stronger, "home");
  assert.equal(gap.source, "market");
  assert.match(gap.label, /Quotenbild 1,24 gegen 12,00/);

  // Der Tipp bleibt unberührt: Die Markierung ist nachgelagert, kein Modelleingang.
  const outcome = buildDashboardDocument(input).fixtures[0]!.markets[0]!;
  assert.equal(outcome.pick, "1");
  assert.equal(outcome.probability, 0.72);
});

test("Ausgeglichene Quoten und Ligapartien bleiben unmarkiert", () => {
  const balanced = dashboardInput(2.1, false);
  balanced.tipicoOdds[0]!.away = 3.4;
  assert.equal(buildDashboardDocument(balanced).fixtures[0]!.classGap, undefined);

  const domestic = dashboardInput(1.24, false);
  domestic.tipicoOdds[0]!.away = 12;
  domestic.draw.rows[0]!.model = "league";
  domestic.favorites.rows[0]!.model = "league";
  const fixture = buildDashboardDocument(domestic).fixtures[0]!;
  assert.equal(fixture.crossLeague, false);
  assert.equal(fixture.classGap, undefined);
});
