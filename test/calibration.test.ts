import assert from "node:assert/strict";
import test from "node:test";
import { calibrationSummaryLines } from "../src/calibration.ts";
import type { AnalyzerDatabase, LeagueStrengthPerformanceRow } from "../src/database.ts";

function strengthRow(
  cohort: LeagueStrengthPerformanceRow["cohort"],
  total: number,
  hitRate: number,
  averageProbability: number
): LeagueStrengthPerformanceRow {
  return {
    cohort, total, hits: Math.round(total * hitRate), hitRate, averageProbability,
    bias: hitRate - averageProbability, brierScore: 0.6, intervalLow: 0, intervalHigh: 1
  };
}

function databaseWith(rows: LeagueStrengthPerformanceRow[]) {
  return {
    leagueStrengthReport: () => rows,
    outcomeProbabilityReport: () => [{
      market: "1x2" as const, total: 2906, hits: 1345, hitRate: 0.463,
      averageProbability: 0.457, brierScore: 0.631, intervalLow: 0.445, intervalHigh: 0.481
    }]
  } as unknown as AnalyzerDatabase;
}

test("Kalibrier-Kurzfassung nennt auffällige Gruppen ab 30 Partien", () => {
  const lines = calibrationSummaryLines(databaseWith([
    strengthRow("Ligapartie", 2569, 0.478, 0.452),
    strengthRow("gemessen", 320, 0.331, 0.479),
    strengthRow("geschätzt", 14, 0.714, 0.807)
  ]));
  assert.match(lines[0]!, /Kalibrierung/);
  assert.match(lines.find((line) => line.includes("gemessen"))!, /-14,8 pp/);
  // Kleine Stichproben werden als solche gekennzeichnet und lösen keinen Hinweis aus.
  assert.match(lines.find((line) => line.includes("geschätzt"))!, /Stichprobe zu klein/);
  const notable = lines.at(-1)!;
  assert.match(notable, /Auffällig: gemessen/);
  assert.ok(!notable.includes("geschätzt"));
  assert.ok(lines.some((line) => line.includes("1X2 gesamt")));
});

test("Ohne auffällige Abweichung entfällt der Hinweis", () => {
  const lines = calibrationSummaryLines(databaseWith([strengthRow("Ligapartie", 2569, 0.478, 0.452)]));
  assert.ok(!lines.some((line) => line.includes("Auffällig")));
});

test("Ohne abgerechnete Partien bleibt die Kurzfassung leer", () => {
  assert.deepEqual(calibrationSummaryLines(databaseWith([])), []);
});
