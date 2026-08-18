import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDashboardDocument, writeDashboard, type DashboardInput } from "../src/dashboard.ts";

function dashboardInput(odds = 1.75): DashboardInput {
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
  assert.deepEqual(fixture.markets.map((market) => market.key), ["1x2", "draw", "btts", "over15", "over25", "firstHalfOver05", "firstHalfOver15"]);
  assert.deepEqual(fixture.expectedFirstHalfGoals, { home: 0.7, away: 0.45, total: 1.15 });
  assert.equal(fixture.markets[5]?.odds, 1.35);
  assert.equal(fixture.markets[5]?.recommendation.level, "recommended");
  assert.equal(fixture.markets[0]?.pick, "1");
  assert.equal(fixture.markets[0]?.odds, 1.75);
  assert.equal(fixture.markets[0]?.recommendation.level, "strong");
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
