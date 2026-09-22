import { ApiFootballClient } from "../src/api.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import { teamMatchStats } from "../src/fixture-insights.ts";
import type { ApiFixtureStatistic, ApiTeamStatistics } from "../src/types.ts";

/**
 * Trägt die Statistik je Halbzeit für bereits abgerechnete Partien nach.
 *
 * Das ist der einzige Teil, der API-Budget kostet: `half=true` gibt es nur bei
 * `/fixtures/statistics`, und dort nur für eine Partie je Aufruf - `fixtures?id=` und
 * `fixtures?ids=` weisen den Parameter ab. Ein 20er-Bündel wie beim xG-Aufbau ist also nicht
 * möglich, es bleibt bei einem Aufruf je Partie.
 *
 * Deshalb arbeitet das Werkzeug in Etappen: Standard sind 2.000 Aufrufe, neueste Partien
 * zuerst. Was geschrieben ist, bleibt; ein Abbruch ist unkritisch, der Rest steht beim
 * nächsten Lauf wieder oben auf der Liste.
 *
 * Aufruf:
 *   node tools/backfill-half-stats.ts
 *   node tools/backfill-half-stats.ts --budget 500
 */

const args = process.argv.slice(2);
const budgetIndex = args.indexOf("--budget");
const budget = budgetIndex >= 0 ? Number(args[budgetIndex + 1]) : 2_000;
if (!Number.isInteger(budget) || budget < 1) {
  throw new Error("--budget muss eine ganze Zahl ab 1 sein.");
}

/** Der Katalog einer Halbzeit, in einen Team-Eintrag verpackt, damit `teamMatchStats` ihn liest. */
function halfStats(
  entry: ApiTeamStatistics | undefined,
  list: ApiFixtureStatistic[] | undefined
) {
  if (!entry || !list) return null;
  return teamMatchStats([{ team: entry.team, statistics: list }], entry.team.id);
}

const database = new AnalyzerDatabase();
const client = new ApiFootballClient();
let gefragt = 0;
let mitWerten = 0;
let ohneWerte = 0;

try {
  const offenVorher = database.countFixturesMissingHalfStatistics();
  const fixtures = database.fixturesMissingHalfStatistics(budget);
  if (fixtures.length === 0) {
    console.log("Es fehlt nichts. Alle gespeicherten Spiele haben ihre Zahlen je Halbzeit.");
  } else {
    console.log(`${offenVorher} Spiele offen, davon werden jetzt bis zu ${fixtures.length} geholt.`);
  }

  for (const { fixtureId, homeTeamId, awayTeamId } of fixtures) {
    const statistics = await client.getFixtureStatistics(fixtureId, false, true);
    gefragt += 1;

    const seite = (teamId: number) => {
      const entry = statistics.find((item) => item.team.id === teamId);
      return {
        firstHalf: halfStats(entry, entry?.statistics_1h),
        secondHalf: halfStats(entry, entry?.statistics_2h)
      };
    };
    const heim = seite(homeTeamId);
    const gast = seite(awayTeamId);
    const vorhanden = [heim, gast]
      .some((row) => row.firstHalf !== null || row.secondHalf !== null);

    database.saveHalfStatistics([{
      fixtureId,
      // `unavailable` wird genauso festgehalten wie ein Treffer. Ohne diese Notiz würde der
      // nächste Lauf dieselben Ligen ohne Halbzeitzahlen erneut abfragen und Budget verbrennen.
      status: vorhanden ? "available" : "unavailable",
      fetchedAt: new Date().toISOString(),
      home: heim,
      away: gast
    }]);

    if (vorhanden) mitWerten += 1; else ohneWerte += 1;
    if (gefragt % 100 === 0) {
      console.log(`  ${gefragt} von ${fixtures.length} Spielen geholt.`);
    }
  }

  const offenNachher = database.countFixturesMissingHalfStatistics();
  console.log("");
  console.log(`${gefragt} Spiele geholt: ${mitWerten} mit Zahlen je Halbzeit, ${ohneWerte} ohne.`);
  console.log(`API-Aufrufe: ${client.requestCount}`);
  if (offenNachher > 0) {
    console.log(`Noch offen: ${offenNachher} Spiele. Nächste Etappe mit "npm run backfill-half-stats".`);
  } else {
    console.log("Es ist nichts mehr offen.");
  }
} finally {
  database.close();
}
