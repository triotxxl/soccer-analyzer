import { ApiFootballClient } from "./api.ts";
import { AnalyzerDatabase } from "./database.ts";
import { parseExpectedGoals } from "./xg.ts";

export interface SettleResult {
  /** Fällige Partien, die zum Startzeitpunkt auf eine Abrechnung warteten. */
  due: number;
  /** Tatsächlich abgefragte Partien. */
  checked: number;
  /** Abgerechnete Prognosezeilen. */
  settled: number;
  apiRequests: number;
  budgetReached: boolean;
}

/**
 * Rechnet fällige Prognosen gegen die tatsächlichen Ergebnisse ab, neueste Partien zuerst.
 * Jede Partie kostet einen Aufruf für das Ergebnis und bei beendetem Spiel einen zweiten
 * für die Statistiken. Ohne Budget läuft der gesamte Rückstand durch, was bei mehreren
 * tausend offenen Partien das Tagesbudget übersteigt - deshalb bricht die Schleife ab,
 * sobald das übergebene Budget erschöpft ist. Der Rest bleibt offen und kommt beim
 * nächsten Aufruf dran.
 */
export async function settleFixtures(options: {
  client?: ApiFootballClient;
  database?: AnalyzerDatabase;
  requestBudget?: number | null;
  now?: Date;
} = {}): Promise<SettleResult> {
  const client = options.client ?? new ApiFootballClient();
  const ownsDatabase = !options.database;
  const database = options.database ?? new AnalyzerDatabase();
  const requestBudget = options.requestBudget ?? null;
  const requestStart = client.requestCount;
  const fixtureIds = database.unsettledFixtures(options.now ?? new Date());
  let checked = 0;
  let settled = 0;
  let budgetReached = false;
  try {
    for (const fixtureId of fixtureIds) {
      // Zwei Aufrufe je beendeter Partie: Ergebnis und Statistiken. Wer keinen Platz mehr
      // für beide hat, fängt gar nicht erst an, damit kein halb abgefragtes Spiel entsteht.
      if (requestBudget !== null && client.requestCount - requestStart + 2 > requestBudget) {
        budgetReached = true;
        break;
      }
      const fixture = (await client.getFixture(fixtureId, true))[0];
      checked += 1;
      if (!fixture || !["FT", "AET", "PEN"].includes(fixture.fixture.status.short)) continue;
      const statistics = await client.getFixtureStatistics(fixtureId, false);
      const xg = parseExpectedGoals(statistics, fixture.teams.home.id, fixture.teams.away.id);
      database.saveFixtureExpectedGoals([{
        fixtureId,
        kickoff: fixture.fixture.date,
        leagueId: fixture.league.id,
        season: fixture.league.season,
        homeTeamId: fixture.teams.home.id,
        awayTeamId: fixture.teams.away.id,
        homeXg: xg.home,
        awayXg: xg.away,
        status: xg.home !== null && xg.away !== null ? "available" : "unavailable",
        fetchedAt: new Date().toISOString()
      }]);
      settled += database.settleFixture(fixture, xg);
    }
  } finally {
    if (ownsDatabase) database.close();
  }
  return {
    due: fixtureIds.length,
    checked,
    settled,
    apiRequests: client.requestCount - requestStart,
    budgetReached
  };
}
