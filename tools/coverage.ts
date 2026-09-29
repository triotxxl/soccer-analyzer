/**
 * Lücken der neuesten Analyse bei Elo und Ligastärke, mit Ursache und Maßnahme.
 *
 *   npm run coverage            liest output/dashboard-latest.json und die SQLite-Datenbank
 *   npm run coverage -- --json  dasselbe maschinenlesbar
 *
 * Kostet kein API-Budget. Arbeitsliste zur Grundregel in AGENTS.md („Pflege“, erster Punkt).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "../src/config.ts";
import { findCoverageGaps } from "../src/coverage.ts";
import type { DashboardDocument } from "../src/dashboard.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import { getTeamElo } from "../src/elo-store.ts";

const file = path.join(ROOT_DIR, "output", "dashboard-latest.json");
const document = JSON.parse(await readFile(file, "utf8")) as DashboardDocument;
const database = new AnalyzerDatabase();
try {
  const report = findCoverageGaps(document, {
    eloMatches: (teamId) => database.eloMatches(teamId),
    storedElo: (teamId, system) => getTeamElo(database, teamId, system),
    apiLeagueId: (country, league) => database.apiLeagueIdByName(country, league)
  });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const open = report.missingStrength.filter((gap) => !gap.intended);
    console.log(`Analyse ${report.createdAt} · ${report.fixtures} Spiele`);
    console.log(`Ohne Elo: ${report.missingElo.length} Teams · Elo mit wenig Grundlage: ${report.lowConfidence.length}`
      + ` · 1X2 ohne Ligastärke: ${report.missingStrength.length} (davon ${open.length} offen)`);
    if (report.missingElo.length > 0) {
      console.log("\n== Ohne Elo");
      for (const gap of report.missingElo) console.log(`- ${gap.team} (${gap.teamId ?? "?"}) in ${gap.fixture}\n    Ursache: ${gap.cause}\n    Maßnahme: ${gap.action}`);
    }
    if (open.length > 0) {
      console.log("\n== 1X2 ohne Ligastärke - offen");
      for (const gap of open) console.log(`- ${gap.fixture} (${gap.competition})\n    Ursache: ${gap.cause}\n    Maßnahme: ${gap.action}`);
    }
    const intended = report.missingStrength.filter((gap) => gap.intended);
    if (intended.length > 0) {
      console.log("\n== 1X2 ohne Ligastärke - so vorgesehen");
      for (const gap of intended) console.log(`- ${gap.fixture}: ${gap.cause}`);
    }
    if (report.lowConfidence.length > 0) {
      console.log("\n== Elo mit wenig Grundlage (unter 30 % Vertrauen)");
      for (const entry of report.lowConfidence) console.log(`- ${entry.team} ${Math.round(entry.confidence)} % in ${entry.fixture}`);
    }
  }
} finally {
  database.close();
}
