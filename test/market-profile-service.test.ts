import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { buildObservations, MarketProfileError, MarketProfileService } from "../src/market-profile-service.ts";

const workspaces: string[] = [];

/** Legt eine Datenbank mit Ergebnissen und einen Ordner mit Snapshots an. */
function workspace(options: {
  snapshots: Record<string, unknown>;
  results: Array<{ fixtureId: number; home: number; away: number; htHome?: number | null; htAway?: number | null }>;
}): { databaseFile: string; outputDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "market-profile-"));
  workspaces.push(root);
  const outputDir = path.join(root, "output");
  fs.mkdirSync(outputDir);
  for (const [name, content] of Object.entries(options.snapshots)) {
    fs.writeFileSync(path.join(outputDir, name), JSON.stringify(content));
  }

  const databaseFile = path.join(root, "analyzer.sqlite");
  const database = new DatabaseSync(databaseFile);
  database.exec(`CREATE TABLE goal_line_predictions (
    fixture_id INTEGER, settled_at TEXT,
    actual_home_goals INTEGER, actual_away_goals INTEGER,
    actual_halftime_home_goals INTEGER, actual_halftime_away_goals INTEGER)`);
  for (const result of options.results) {
    database.prepare(`INSERT INTO goal_line_predictions VALUES (?, '2026-03-02T12:00:00Z', ?, ?, ?, ?)`)
      .run(result.fixtureId, result.home, result.away, result.htHome ?? null, result.htAway ?? null);
  }
  database.close();
  return { databaseFile, outputDir };
}

function snapshot(fixtureId: number, marketKey: string, probability: number, odds: number, extra: Record<string, unknown> = {}) {
  return {
    fixtures: [{
      fixtureId, kickoff: "2026-03-01T18:00:00+01:00", country: "Deutschland", league: "Bundesliga",
      homeTeam: "A", awayTeam: "B",
      markets: [{ key: marketKey, label: marketKey, selection: "Auswahl", probability, odds, confidence: 90 }],
      ...extra
    }]
  };
}

after(() => {
  for (const root of workspaces) fs.rmSync(root, { recursive: true, force: true });
});

describe("MarketProfileService", () => {
  it("verbindet Snapshot-Quoten mit dem abgerechneten Ergebnis", () => {
    const { databaseFile, outputDir } = workspace({
      snapshots: { "dashboard-2026-03-01.json": snapshot(1, "over25", 0.6, 2) },
      results: [{ fixtureId: 1, home: 2, away: 1 }]
    });
    const observations = buildObservations({ databaseFile, outputDir });
    assert.equal(observations.length, 1);
    assert.equal(observations[0]!.hit, 1);
    assert.ok(Math.abs(observations[0]!.edge - 0.1) < 1e-9);
  });

  it("nimmt je Partie und Markt den jüngsten Snapshot, weil Quoten nachgeführt werden", () => {
    const { databaseFile, outputDir } = workspace({
      snapshots: {
        "dashboard-2026-03-01.json": snapshot(1, "over25", 0.6, 2),
        "dashboard-2026-03-02.json": snapshot(1, "over25", 0.6, 3)
      },
      results: [{ fixtureId: 1, home: 2, away: 1 }]
    });
    const observations = buildObservations({ databaseFile, outputDir });
    assert.equal(observations.length, 1);
    assert.equal(observations[0]!.odds, 3);
  });

  it("lässt unentscheidbare und unzuverlässige Zeilen weg", () => {
    const { databaseFile, outputDir } = workspace({
      snapshots: {
        // Halbzeitmarkt ohne überlieferten Pausenstand.
        "dashboard-2026-03-01.json": snapshot(1, "firstHalfOver05", 0.7, 1.6),
        // Markt ohne belastbare Wahrscheinlichkeit.
        "dashboard-2026-03-02.json": {
          fixtures: [{
            fixtureId: 2, kickoff: "2026-03-01T18:00:00+01:00", country: "X", league: "Y",
            homeTeam: "C", awayTeam: "D",
            markets: [{ key: "1x2", label: "1X2", selection: "Heimsieg C", probability: 0.5, odds: 2, confidence: 50, probabilityReliable: false }]
          }]
        }
      },
      results: [{ fixtureId: 1, home: 2, away: 1 }, { fixtureId: 2, home: 1, away: 0 }]
    });
    assert.equal(buildObservations({ databaseFile, outputDir }).length, 0);
  });

  it("überspringt eine halb geschriebene Snapshot-Datei", () => {
    const { databaseFile, outputDir } = workspace({
      snapshots: { "dashboard-2026-03-01.json": snapshot(1, "over25", 0.6, 2) },
      results: [{ fixtureId: 1, home: 2, away: 1 }]
    });
    fs.writeFileSync(path.join(outputDir, "dashboard-2026-03-03.json"), '{"fixtures":[{"fix');
    assert.equal(buildObservations({ databaseFile, outputDir }).length, 1);
  });

  it("meldet eine fehlende Datenbank als klaren Fehler", () => {
    const { outputDir } = workspace({ snapshots: {}, results: [] });
    assert.throws(
      () => buildObservations({ databaseFile: path.join(outputDir, "gibtEsNicht.sqlite"), outputDir }),
      (error: unknown) => error instanceof MarketProfileError && error.code === "database_missing");
  });

  it("hält das Ergebnis, bis sich die Quellen ändern", () => {
    const { databaseFile, outputDir } = workspace({
      snapshots: { "dashboard-2026-03-01.json": snapshot(1, "over25", 0.6, 2) },
      results: [{ fixtureId: 1, home: 2, away: 1 }]
    });
    const service = new MarketProfileService({ databaseFile, outputDir });
    assert.equal(service.get(), service.get(), "derselbe Stand muss dasselbe Objekt liefern");
  });
});
