import { ApiFootballClient } from "./api.ts";
import { config } from "./config.ts";
import { AnalyzerDatabase } from "./database.ts";
import { toFixtureResult } from "./fixture-result.ts";
import { parseExpectedGoals } from "./xg.ts";

export interface SettleResult {
  /** Fällige Partien, die zum Startzeitpunkt auf eine Abrechnung warteten. */
  due: number;
  /** Tatsächlich abgefragte Partien. */
  checked: number;
  /** Abgerechnete Prognosezeilen. */
  settled: number;
  /** Partien, deren Ergebnisdaten gespeichert wurden. */
  results: number;
  /** Davon mit Statistik je Halbzeit. */
  halfStatistics: number;
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
 *
 * Partien können in Blöcken von `concurrency` Stück gleichzeitig abgefragt werden statt
 * einzeln nacheinander - der Rate-Limiter in ApiFootballClient serialisiert ohnehin auf
 * `apiRequestsPerSecond`, aber ohne Parallelität wartet jede Partie zusätzlich die volle
 * Netzwerklatenz der vorherigen ab. Innerhalb eines Blocks bleibt die Bearbeitungsreihen-
 * folge erhalten (wichtig für die "neueste zuerst"-Reihenfolge und deterministische Tests),
 * zwischen Blöcken wird das Budget mit dem tatsächlichen `client.requestCount` geprüft.
 *
 * Standard ist 1, also sequenziell: gemessen am 04.09.2026 laufen von zehn gleichzeitig
 * geöffneten Verbindungen zu v3.football.api-sports.io die Hälfte in einen Connect-Timeout
 * (auch mit IPv4 zuerst), während Anfragen über eine bestehende Verbindung sauber
 * durchgehen. Ein einziger Fehlschlag bricht den ganzen Lauf ab, deshalb ist Parallelität
 * hier teurer als der Zeitgewinn. Über `SETTLE_CONCURRENCY` bzw. `--concurrency`
 * hochdrehbar, sobald das Netz mehr verträgt.
 */
export async function settleFixtures(options: {
  client?: ApiFootballClient;
  database?: AnalyzerDatabase;
  requestBudget?: number | null;
  concurrency?: number;
  now?: Date;
} = {}): Promise<SettleResult> {
  const client = options.client ?? new ApiFootballClient();
  const ownsDatabase = !options.database;
  const database = options.database ?? new AnalyzerDatabase();
  const requestBudget = options.requestBudget ?? null;
  const concurrency = Math.max(1, options.concurrency ?? config.settleConcurrency);
  const requestStart = client.requestCount;
  const fixtureIds = database.unsettledFixtures(options.now ?? new Date());
  let checked = 0;
  let settled = 0;
  let results = 0;
  let halfStatistics = 0;
  let budgetReached = false;

  async function settleOne(fixtureId: number): Promise<void> {
    const fixture = (await client.getFixture(fixtureId, true))[0];
    checked += 1;
    if (!fixture || !["FT", "AET", "PEN"].includes(fixture.fixture.status.short)) return;
    // `half` kostet keinen zusätzlichen Aufruf: Es ist dieselbe Anfrage, die zusätzlich
    // `statistics_1h` und `statistics_2h` mitbringt. Nur `/fixtures/statistics` kennt den
    // Parameter, die Bündel über `ids=` weisen ihn ab.
    const statistics = await client.getFixtureStatistics(fixtureId, false, true);
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

    // Die Partie trägt Ereignisse, Aufstellungen und Spielerwerte bereits mit sich; ohne
    // diesen Schritt wurden sie nach der Abrechnung verworfen.
    const result = toFixtureResult(fixture, { statistics, source: "api" });
    if (result) {
      database.saveFixtureResults([result]);
      results += 1;
      database.saveHalfStatistics([{
        fixtureId,
        status: result.halfStatsAvailable ? "available" : "unavailable",
        fetchedAt: result.fetchedAt,
        home: { firstHalf: result.homeStats.firstHalf, secondHalf: result.homeStats.secondHalf },
        away: { firstHalf: result.awayStats.firstHalf, secondHalf: result.awayStats.secondHalf }
      }]);
      if (result.halfStatsAvailable) halfStatistics += 1;
    }
  }

  try {
    let cursor = 0;
    outer: while (cursor < fixtureIds.length) {
      // Zwei Aufrufe je beendeter Partie: Ergebnis und Statistiken. Wer keinen Platz mehr
      // für beide hat, fängt gar nicht erst an, damit kein halb abgefragtes Spiel entsteht.
      // Reservierung ist pessimistisch (worst case), weil vorab nicht bekannt ist, ob eine
      // Partie schon beendet ist.
      let reserved = client.requestCount - requestStart;
      const batch: number[] = [];
      while (cursor < fixtureIds.length && batch.length < concurrency) {
        if (requestBudget !== null && reserved + 2 > requestBudget) {
          budgetReached = true;
          break;
        }
        batch.push(fixtureIds[cursor]!);
        reserved += 2;
        cursor += 1;
      }
      if (batch.length === 0) break outer;
      await Promise.all(batch.map((fixtureId) => settleOne(fixtureId)));
      if (budgetReached) break outer;
    }
  } finally {
    if (ownsDatabase) database.close();
  }
  return {
    due: fixtureIds.length,
    checked,
    settled,
    results,
    halfStatistics,
    apiRequests: client.requestCount - requestStart,
    budgetReached
  };
}
