import type { AnalyzerDatabase } from "./database.ts";
import { percent } from "./util.ts";

/** Ab dieser Stichprobe ist eine Abweichung mehr als Rauschen. */
const MINIMUM_SAMPLE = 30;
/** Ab dieser Abweichung lohnt der Blick in den vollständigen Bericht. */
const NOTABLE_BIAS = 0.05;

/**
 * Kurzfassung der Kalibrierung für das Ende eines Dashboard-Laufs: nur die Zeilen, aus
 * denen sich eine Entscheidung ableitet. Die vollständigen Tabellen bleiben
 * `npm run report` vorbehalten. Ohne abgerechnete Partien bleibt die Liste leer.
 */
export function calibrationSummaryLines(
  database: Pick<AnalyzerDatabase, "leagueStrengthReport" | "outcomeProbabilityReport">
): string[] {
  const strengthRows = database.leagueStrengthReport();
  if (strengthRows.length === 0) return [];
  const lines = ["Kalibrierung (Favorit trifft, Abweichung zur Prognose):"];
  for (const row of strengthRows) {
    const bias = `${row.bias >= 0 ? "+" : ""}${(row.bias * 100).toFixed(1).replace(".", ",")} pp`;
    const hint = row.total < MINIMUM_SAMPLE ? " · Stichprobe zu klein" : "";
    lines.push(
      `  ${row.cohort.padEnd(11)} ${String(row.total).padStart(5)} Partien · ` +
      `${percent(row.hitRate)} statt ${percent(row.averageProbability)} · ${bias}${hint}`
    );
  }
  const oneXTwo = database.outcomeProbabilityReport().find((row) => row.market === "1x2");
  if (oneXTwo) {
    lines.push(
      `  ${"1X2 gesamt".padEnd(11)} ${String(oneXTwo.total).padStart(5)} Partien · ` +
      `${percent(oneXTwo.hitRate)} statt ${percent(oneXTwo.averageProbability)}`
    );
  }
  const actionable = strengthRows.filter(
    (row) => row.total >= MINIMUM_SAMPLE && Math.abs(row.bias) >= NOTABLE_BIAS
  );
  if (actionable.length > 0) {
    lines.push(
      `  Auffällig: ${actionable.map((row) => row.cohort).join(", ")} · Details mit npm run report`
    );
  }
  return lines;
}
