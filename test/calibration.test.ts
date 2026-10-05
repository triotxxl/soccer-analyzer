import assert from "node:assert/strict";
import test from "node:test";
import { calibrationSummaryLines } from "../src/calibration.ts";
import type { AnalyzerDatabase, LeagueStrengthPerformanceRow } from "../src/database.ts";

function strengthRow(
  cohort: LeagueStrengthPerformanceRow["cohort"],
  total: number,
  hitRate: number,
  averageProbability: number,
  stronger: { total: number; winRate: number; predicted: number } = { total: 0, winRate: 0, predicted: 0 }
): LeagueStrengthPerformanceRow {
  return {
    cohort, total, hits: Math.round(total * hitRate), hitRate, averageProbability,
    bias: hitRate - averageProbability, brierScore: 0.6, intervalLow: 0, intervalHigh: 1,
    strongerTotal: stronger.total, strongerWinRate: stronger.winRate, strongerPredicted: stronger.predicted,
    strongerStandardError: stronger.total
      ? Math.sqrt(stronger.winRate * (1 - stronger.winRate) / stronger.total)
      : 0
  };
}

/**
 * `all`: über alle Fassungen; `current`: nur für Fassung 3.5.0. Jede andere Version bekommt
 * nichts - ein falscher Standardwert für die laufende Fassung fiele so auf.
 */
function databaseWith(all: LeagueStrengthPerformanceRow[], current: LeagueStrengthPerformanceRow[] = []) {
  return {
    leagueStrengthReport: (options: { modelVersion?: string } = {}) =>
      options.modelVersion === undefined ? all : options.modelVersion === "3.5.0" ? current : [],
    outcomeProbabilityReport: () => [{
      market: "1x2" as const, total: 2906, hits: 1345, hitRate: 0.463,
      averageProbability: 0.457, brierScore: 0.631, intervalLow: 0.445, intervalHigh: 0.481
    }]
  } as unknown as AnalyzerDatabase;
}

test("Kalibrier-Kurzfassung nennt auffällige Gruppen ab 30 Partien", () => {
  const lines = calibrationSummaryLines(databaseWith([
    strengthRow("Ligapartie", 2569, 0.478, 0.452),
    strengthRow("ohne Rating", 320, 0.331, 0.479),
    strengthRow("gleiche Liga", 14, 0.714, 0.807)
  ]), "3.5.0");
  assert.match(lines[0]!, /Kalibrierung/);
  assert.match(lines.find((line) => line.includes("ohne Rating"))!, /-14,8 pp/);
  // Kleine Stichproben werden als solche gekennzeichnet und lösen keinen Hinweis aus.
  assert.match(lines.find((line) => line.includes("gleiche Liga"))!, /Stichprobe zu klein/);
  const notable = lines.at(-1)!;
  assert.match(notable, /Auffällig: ohne Rating/);
  assert.ok(!notable.includes("gleiche Liga"));
  assert.ok(lines.some((line) => line.includes("1X2 gesamt")));
});

test("Bei Spielen zwischen Ligen zählt die stärkere Liga der laufenden Fassung", () => {
  // Über alle Fassungen auffällig (Teiler 1500), in der laufenden Fassung deutlich daneben.
  const lines = calibrationSummaryLines(databaseWith(
    [
      strengthRow("gemessen", 190, 0.585, 0.549, { total: 190, winRate: 0.621, predicted: 0.519 }),
      strengthRow("Team-Elo", 72, 0.57, 0.555, { total: 66, winRate: 0.53, predicted: 0.543 }),
      strengthRow("vor Ligastärke", 300, 0.33, 0.47)
    ],
    [
      strengthRow("gemessen", 160, 0.6, 0.55, { total: 160, winRate: 0.65, predicted: 0.52 }),
      strengthRow("Team-Elo", 40, 0.6, 0.55, { total: 40, winRate: 0.55, predicted: 0.54 })
    ]
  ));
  // Ohne zweites Argument gilt die laufende Fassung aus der Konfiguration.
  assert.match(
    lines.find((line) => line.includes("stärkere Liga gewinnt"))!,
    /seit 3\.5\.0: 160 Spiele, stärkere Liga gewinnt 65,0 % statt 52,0 % · \+13,0 pp ± 3,8/
  );
  assert.ok(lines.some((line) => /seit 3\.5\.0: 40 Spiele, stärkeres Team gewinnt/.test(line)));
  assert.match(lines.at(-1)!, /Auffällig: gemessen · Details/);
  assert.match(lines.find((line) => line.includes("vor Ligastärke"))!, /nur zur Einordnung/);
});

test("Alte Fassungen lösen bei Spielen zwischen Ligen keinen Hinweis aus", () => {
  // Der Fall vom 05.10.2026: über alle Fassungen +9,9 pp, die laufende Fassung hat noch keine Spiele.
  const lines = calibrationSummaryLines(databaseWith([
    strengthRow("gemessen", 191, 0.586, 0.547, { total: 190, winRate: 0.616, predicted: 0.516 })
  ]), "3.5.0");
  assert.ok(!lines.some((line) => line.includes("stärkere Liga gewinnt")));
  assert.ok(!lines.some((line) => line.includes("Auffällig")));
});

test("Eine Abweichung unter zwei Standardfehlern ist nicht auffällig", () => {
  // 6 pp bei 40 Spielen: Standardfehler rund 7,7 pp - kann auch Zufall sein.
  const row = strengthRow("gemessen", 40, 0.6, 0.55, { total: 40, winRate: 0.6, predicted: 0.54 });
  const lines = calibrationSummaryLines(databaseWith([row], [row]), "3.5.0");
  assert.ok(lines.some((line) => line.includes("stärkere Liga gewinnt")));
  assert.ok(!lines.some((line) => line.includes("Auffällig")));
});

test("Ohne auffällige Abweichung entfällt der Hinweis", () => {
  const lines = calibrationSummaryLines(databaseWith([strengthRow("Ligapartie", 2569, 0.478, 0.452)]), "3.5.0");
  assert.ok(!lines.some((line) => line.includes("Auffällig")));
});

test("Ohne abgerechnete Partien bleibt die Kurzfassung leer", () => {
  assert.deepEqual(calibrationSummaryLines(databaseWith([])), []);
});
