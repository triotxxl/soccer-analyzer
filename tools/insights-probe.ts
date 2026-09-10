import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "../src/config.ts";
import { InsightsService } from "../src/insights-service.ts";
import { scoringPeriodIndex } from "../src/fixture-insights.ts";
import type { DashboardDocument } from "../src/dashboard.ts";

/**
 * Prüft die Detailkennzahlen einer einzelnen Partie an echten Daten und zeigt, wie viele
 * API-Anfragen sie gekostet hat. Aufruf: `node tools/insights-probe.ts [fixtureId]`.
 */
const latest = path.join(ROOT_DIR, "output", "dashboard-latest.json");
const document = JSON.parse(await readFile(latest, "utf8")) as DashboardDocument;
const requested = Number(process.argv[2]);
const entry = Number.isInteger(requested)
  ? document.fixtures.find((item) => item.fixtureId === requested)
  : document.fixtures[0];
if (!entry) throw new Error("Partie steht nicht im letzten Lauf.");

const service = new InsightsService();
const insights = await service.get(entry.fixtureId);

const periods = (matches: typeof insights.homeMatches, teamId: number, venue: "home" | "away") => {
  const scored = Array.from({ length: 6 }, () => 0);
  let used = 0;
  for (const match of matches) {
    if (!match.minutesComplete) continue;
    if ((match.home.id === teamId ? "home" : "away") !== venue) continue;
    used += 1;
    for (const goal of match.goals) {
      if (goal.teamId === teamId) scored[scoringPeriodIndex(goal.minute)] += 1;
    }
  }
  return { scored, used };
};

console.log(`${insights.home.name} - ${insights.away.name} (${insights.league.name} ${insights.league.season})`);
console.log(`API-Anfragen: ${insights.apiRequests}`);
console.log(`Abdeckung: ${JSON.stringify(insights.coverage)}`);
console.log(`Historie: Heim ${insights.homeMatches.length}, Auswärts ${insights.awayMatches.length}, H2H ${insights.h2h.length}`);
console.log("Torphasen Heim (Heimspiele):", periods(insights.homeMatches, insights.home.id, "home"));
console.log("Torphasen Gast (Auswärtsspiele):", periods(insights.awayMatches, insights.away.id, "away"));
const sample = insights.homeMatches[0];
if (sample) {
  console.log("Beispielpartie:", {
    datum: sample.date.slice(0, 10),
    liga: sample.league,
    stand: `${sample.homeGoals}:${sample.awayGoals}`,
    minuten: sample.goals,
    minutenVollstaendig: sample.minutesComplete,
    statistik: sample.stats
  });
}
