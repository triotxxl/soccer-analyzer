import { config } from "./config.ts";
import type { AnalyzerDatabase, LeagueStrengthPerformanceRow } from "./database.ts";
import { percent } from "./util.ts";

/** Ab dieser Stichprobe ist eine Abweichung mehr als Rauschen. */
const MINIMUM_SAMPLE = 30;
/** Ab dieser Abweichung lohnt der Blick in den vollständigen Bericht. */
const NOTABLE_BIAS = 0.05;
/** Und nur, wenn sie mindestens so viele Standardfehler groß ist - bei 30 Spielen sind 5 pp Rauschen. */
const NOTABLE_STANDARD_ERRORS = 2;

/** Gruppen zwischen Ligen bzw. Nationalteams: Dort entscheidet die stärkere Seite, nicht der Favorit. */
const BETWEEN_LEAGUES = new Set<LeagueStrengthPerformanceRow["cohort"]>(["gemessen", "geschätzt", "Team-Elo", "Team-Elo U21"]);

const signed = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1).replace(".", ",")} pp`;

/**
 * Kurzfassung der Kalibrierung für das Ende eines Dashboard-Laufs: nur die Zeilen, aus
 * denen sich eine Entscheidung ableitet. Die vollständigen Tabellen bleiben
 * `npm run report` vorbehalten. Ohne abgerechnete Partien bleibt die Liste leer.
 *
 * "Favorit trifft" läuft über alle Fassungen. Die Seite aus der stärkeren Liga zählt nur die
 * laufende Modellversion: Jede Fassung rechnet mit ihrem eigenen Teiler, ein Mittel darüber
 * misst keinen davon und hielte "Auffällig" wochenlang stehen (Prüfung vom 05.10.2026).
 */
export function calibrationSummaryLines(
  database: Pick<AnalyzerDatabase, "leagueStrengthReport" | "outcomeProbabilityReport">,
  modelVersion = config.goalLineModelVersion
): string[] {
  const strengthRows = database.leagueStrengthReport();
  if (strengthRows.length === 0) return [];
  const current = new Map(
    database.leagueStrengthReport({ modelVersion }).map((row) => [row.cohort, row])
  );
  const lines = ["Kalibrierung (Favorit trifft, Abweichung zur Prognose):"];
  for (const row of strengthRows) {
    const hint = row.total < MINIMUM_SAMPLE ? " · Stichprobe zu klein" : "";
    const legacy = row.cohort === "vor Ligastärke" ? " · Modell ohne Ligastärke, nur zur Einordnung" : "";
    lines.push(
      `  ${row.cohort.padEnd(14)} ${String(row.total).padStart(5)} Partien · ` +
      `${percent(row.hitRate)} statt ${percent(row.averageProbability)} · ${signed(row.bias)}${hint}${legacy}`
    );
    const now = current.get(row.cohort);
    if (BETWEEN_LEAGUES.has(row.cohort) && now && now.strongerTotal > 0) {
      const side = row.cohort.startsWith("Team-Elo") ? "stärkeres Team" : "stärkere Liga";
      lines.push(
        `  ${"".padEnd(14)} seit ${modelVersion}: ${now.strongerTotal} Spiele, ${side} gewinnt ` +
        `${percent(now.strongerWinRate)} statt ${percent(now.strongerPredicted)} · ` +
        `${signed(now.strongerWinRate - now.strongerPredicted)} ± ${(now.strongerStandardError * 100).toFixed(1).replace(".", ",")}` +
        `${now.strongerTotal < MINIMUM_SAMPLE ? " · Stichprobe zu klein" : ""}`
      );
    }
  }
  const oneXTwo = database.outcomeProbabilityReport().find((row) => row.market === "1x2");
  if (oneXTwo) {
    lines.push(
      `  ${"1X2 gesamt".padEnd(14)} ${String(oneXTwo.total).padStart(5)} Partien · ` +
      `${percent(oneXTwo.hitRate)} statt ${percent(oneXTwo.averageProbability)}`
    );
  }
  const actionable = strengthRows.filter((row) => {
    if (row.cohort === "vor Ligastärke") return false;
    if (BETWEEN_LEAGUES.has(row.cohort)) {
      const now = current.get(row.cohort);
      if (!now || now.strongerTotal < MINIMUM_SAMPLE) return false;
      const deviation = Math.abs(now.strongerWinRate - now.strongerPredicted);
      return deviation >= NOTABLE_BIAS && deviation >= NOTABLE_STANDARD_ERRORS * now.strongerStandardError;
    }
    return row.total >= MINIMUM_SAMPLE && Math.abs(row.bias) >= NOTABLE_BIAS;
  });
  if (actionable.length > 0) {
    lines.push(
      `  Auffällig: ${actionable.map((row) => row.cohort).join(", ")} · Details mit npm run report`
    );
  }
  return lines;
}
