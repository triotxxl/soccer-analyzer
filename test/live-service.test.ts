import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { config } from "../src/config.ts";
import { LiveError, LiveService } from "../src/live-service.ts";
import type { ApiFootballClient } from "../src/api.ts";
import type { DashboardDocument, DashboardFixture } from "../src/dashboard.ts";
import type { ApiFixture, ApiTeamStatistics } from "../src/types.ts";
import { fixture } from "./helpers.ts";

const NOW = Date.parse("2026-08-20T19:00:00.000Z");

function dashboardFixture(id: number, minutesAgo: number): DashboardFixture {
  return {
    fixtureId: id, kickoff: new Date(NOW - minutesAgo * 60_000).toISOString(),
    country: "Germany", league: "Bundesliga", homeTeam: `Heim ${id}`, awayTeam: `Gast ${id}`,
    modelVersion: "test", crossLeague: false, dataConfidence: 80, warnings: [], h2hNotice: null,
    form: { scope: "venue", home: [], away: [], homeMatches: [], awayMatches: [] },
    h2h: { outcomes: [], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    expectedGoals: { home: 1.5, away: 1.2, total: 2.7 },
    scores: { favorite: 70, draw: 55 }, markets: []
  };
}

function document(fixtures: DashboardFixture[]): DashboardDocument {
  return {
    schemaVersion: 4,
    meta: {
      createdAt: new Date(NOW - 7_200_000).toISOString(), timezone: "Europe/Berlin", sourceFile: "data.json",
      totalTipicoEvents: fixtures.length, selectedTipicoEvents: fixtures.length, selectedCompetitions: 1,
      fixtureCount: fixtures.length, firstAvailableDate: "2026-08-20", lastAvailableDate: "2026-08-20",
      maximumDays: 1, maximumHours: 4
    },
    fixtures, leagues: []
  };
}

function liveFixture(id: number, status: string, elapsed: number | null, withStatistics = true): ApiFixture {
  const game = fixture({ id, timestamp: (NOW - 3_600_000) / 1000, homeId: id * 10, awayId: id * 10 + 1, homeGoals: 1, awayGoals: 0, status });
  game.fixture.status = { long: status, short: status, elapsed };
  if (withStatistics) {
    game.statistics = [
      { team: game.teams.home, statistics: [{ type: "Shots on Goal", value: 5 }, { type: "Ball Possession", value: "55%" }] },
      { team: game.teams.away, statistics: [{ type: "Shots on Goal", value: 2 }, { type: "Ball Possession", value: "45%" }] }
    ] satisfies ApiTeamStatistics[];
  }
  return game;
}

interface StubCalls {
  batches: number[][];
  statistics: number[];
  liveAll: number;
}

function stubClient(
  respond: (ids: number[]) => ApiFixture[],
  calls: StubCalls,
  statistics: ApiTeamStatistics[] = [],
  liveAll: () => ApiFixture[] = () => []
) {
  const client = {
    requestCount: 0,
    requestsRemaining: 7_100,
    async getLiveFixtures() {
      calls.liveAll += 1;
      client.requestCount += 1;
      return liveAll();
    },
    async getFixturesWithStatistics(ids: number[], fresh = false) {
      assert.equal(fresh, true, "Live-Abrufe müssen den Cache umgehen");
      assert.ok(ids.length <= 20, "Batches dürfen höchstens 20 IDs enthalten");
      calls.batches.push(ids);
      client.requestCount += 1;
      return respond(ids);
    },
    async getFixtureStatistics(fixtureId: number) {
      calls.statistics.push(fixtureId);
      client.requestCount += 1;
      return statistics;
    }
  };
  return client as unknown as ApiFootballClient;
}

async function workspace(fixtures: DashboardFixture[]): Promise<{ directory: string; dashboardFile: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "live-service-"));
  const dashboardFile = path.join(directory, "dashboard-latest.json");
  await writeFile(dashboardFile, JSON.stringify(document(fixtures)), "utf8");
  return { directory, dashboardFile };
}

function service(dashboardFile: string, directory: string, client: ApiFootballClient, now = () => NOW): LiveService {
  return new LiveService({
    client, dashboardFile, now,
    snapshotDirectory: path.join(directory, "snapshots"),
    usageFile: path.join(directory, "live-usage.json")
  });
}

test("fragt die API nicht an, wenn keine relevante Partie im Zeitfenster liegt", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const client = stubClient(() => [], calls);
  const { directory, dashboardFile } = await workspace([dashboardFixture(1, 600), dashboardFixture(2, -600)]);

  const board = await service(dashboardFile, directory, client).getBoard();

  assert.deepEqual(calls.batches, []);
  assert.equal(client.requestCount, 0);
  assert.equal(board.candidates, 0);
  assert.deepEqual(board.matches, []);
  assert.equal(board.budget.usedToday, 0);
});

test("lädt 25 Kandidaten in zwei Batches und zeigt nur laufende Partien", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const fixtures = Array.from({ length: 25 }, (_, index) => dashboardFixture(index + 1, 60));
  const client = stubClient((ids) => ids.map((id) =>
    liveFixture(id, id === 5 ? "FT" : id === 6 ? "NS" : "2H", id === 5 || id === 6 ? null : 60 + id)), calls);
  const { directory, dashboardFile } = await workspace(fixtures);

  const board = await service(dashboardFile, directory, client).getBoard();

  assert.equal(board.strategy, "batch");
  assert.equal(calls.liveAll, 0, "unterhalb der Schwelle wird nicht gesammelt abgefragt");
  assert.equal(calls.batches.length, 2, "25 Fixtures ergeben genau zwei Anfragen");
  assert.deepEqual(calls.batches.map((batch) => batch.length), [20, 5]);
  assert.equal(board.matches.length, 23, "beendete und noch nicht gestartete Partien fallen heraus");
  assert.equal(board.matches.some((match) => match.fixtureId === 5), false);
  assert.equal(board.matches.some((match) => match.fixtureId === 6), false);
  assert.equal(board.budget.usedToday, 2);
  assert.equal(board.budget.apiRequestsRemaining, 7_100);
  // Absteigend nach Spielminute, damit späte Partien oben stehen.
  assert.ok((board.matches[0]?.elapsed ?? 0) >= (board.matches[1]?.elapsed ?? 0));
});

test("beendete Partien werden im nächsten Durchlauf nicht mehr abgefragt", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const client = stubClient((ids) => ids.map((id) => liveFixture(id, id === 2 ? "FT" : "2H", 75)), calls);
  const { directory, dashboardFile } = await workspace([dashboardFixture(1, 60), dashboardFixture(2, 60)]);
  let now = NOW;
  const live = service(dashboardFile, directory, client, () => now);

  await live.getBoard();
  now += config.livePollMs + 1;
  await live.getBoard();

  assert.deepEqual(calls.batches, [[1, 2], [1]]);
});

test("liefert zwischen zwei Abrufen den gecachten Stand und bündelt parallele Anfragen", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const client = stubClient((ids) => ids.map((id) => liveFixture(id, "2H", 55)), calls);
  const { directory, dashboardFile } = await workspace([dashboardFixture(1, 60)]);
  let now = NOW;
  const live = service(dashboardFile, directory, client, () => now);

  const [first, second] = await Promise.all([live.getBoard(), live.getBoard()]);
  assert.equal(calls.batches.length, 1, "parallele Anfragen teilen sich einen Abruf");
  assert.equal(first.createdAt, second.createdAt);

  now += config.livePollMs - 1;
  await live.getBoard();
  assert.equal(calls.batches.length, 1, "innerhalb des Poll-Intervalls wird nichts nachgeladen");

  now += 2;
  await live.getBoard();
  assert.equal(calls.batches.length, 2);
});

test("lädt fehlende Statistiken einzeln nach, aber höchstens einmal je Minute", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const client = stubClient((ids) => ids.map((id) => liveFixture(id, "2H", 50, false)), calls, [
    { team: { id: 10, name: "Team 10" }, statistics: [{ type: "Total Shots", value: 4 }] },
    { team: { id: 11, name: "Team 11" }, statistics: [{ type: "Total Shots", value: 1 }] }
  ]);
  const { directory, dashboardFile } = await workspace([dashboardFixture(1, 60)]);
  let now = NOW;
  const live = service(dashboardFile, directory, client, () => now);

  const first = await live.getBoard();
  assert.deepEqual(calls.statistics, [1]);
  assert.equal(first.matches[0]?.metrics.home.totalShots, 4);

  now += config.livePollMs + 1;
  await live.getBoard();
  assert.deepEqual(calls.statistics, [1], "innerhalb der Nachlade-Sperre bleibt es bei einem Einzelabruf");

  now += config.liveStatisticsFallbackTtlMs;
  await live.getBoard();
  assert.deepEqual(calls.statistics, [1, 1]);
});

test("stoppt bei erschöpftem Tagesbudget und meldet den Zustand", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const client = stubClient((ids) => ids.map((id) => liveFixture(id, "2H", 50)), calls);
  const { directory, dashboardFile } = await workspace([dashboardFixture(1, 60)]);
  await writeFile(
    path.join(directory, "live-usage.json"),
    JSON.stringify({ date: "2026-08-20", used: config.liveDailyRequestBudget }),
    "utf8"
  );

  const board = await service(dashboardFile, directory, client).getBoard();

  assert.deepEqual(calls.batches, [], "ohne Budget wird die API nicht mehr angesprochen");
  assert.equal(board.budget.exhausted, true);
  assert.equal(board.candidates, 1);
  assert.match(board.message ?? "", /Tagesbudget/);
});

test("bricht die Batch-Schleife ab, sobald das Restbudget aufgebraucht ist", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const fixtures = Array.from({ length: 25 }, (_, index) => dashboardFixture(index + 1, 60));
  const client = stubClient((ids) => ids.map((id) => liveFixture(id, "2H", 50)), calls);
  const { directory, dashboardFile } = await workspace(fixtures);
  await writeFile(
    path.join(directory, "live-usage.json"),
    JSON.stringify({ date: "2026-08-20", used: config.liveDailyRequestBudget - 1 }),
    "utf8"
  );

  const board = await service(dashboardFile, directory, client).getBoard();

  assert.equal(calls.batches.length, 1, "nur der erste Batch passt noch ins Budget");
  assert.equal(board.matches.length, 20);
  assert.match(board.message ?? "", /Tagesbudget/);
  assert.equal(board.budget.usedToday, config.liveDailyRequestBudget);
});

test("schreibt je Stand genau eine Snapshot-Zeile", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  let goals = 1;
  const client = stubClient((ids) => ids.map((id) => {
    const game = liveFixture(id, "2H", 60);
    game.goals.home = goals;
    return game;
  }), calls);
  const { directory, dashboardFile } = await workspace([dashboardFixture(1, 60)]);
  const snapshotFile = path.join(directory, "snapshots", "2026-08-20.jsonl");
  let now = NOW;
  const live = service(dashboardFile, directory, client, () => now);

  await live.getBoard();
  now += config.livePollMs + 1;
  await live.getBoard();
  assert.equal((await readFile(snapshotFile, "utf8")).trim().split("\n").length, 1,
    "unveränderte Stände erzeugen keine zweite Zeile");

  goals = 2;
  now += config.livePollMs + 1;
  await live.getBoard();
  const lines = (await readFile(snapshotFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.score.home), [1, 2]);
  assert.equal(lines[0].fixtureId, 1);
});

test("meldet eine fehlende Dashboard-Datei als eigenen Fehlercode", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const client = stubClient(() => [], calls);
  const { directory } = await workspace([]);
  const live = service(path.join(directory, "fehlt.json"), directory, client);

  await assert.rejects(() => live.getBoard(), (error: unknown) => {
    assert.ok(error instanceof LiveError);
    assert.equal(error.code, "dashboard_missing");
    assert.equal(error.status, 404);
    return true;
  });
  assert.equal(client.requestCount, 0);
});

test("behält den letzten Stand, wenn ein Abruf scheitert", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  let fail = false;
  const client = stubClient((ids) => {
    if (fail) throw new Error("API-Football meldet HTTP 500.");
    return ids.map((id) => liveFixture(id, "2H", 61));
  }, calls);
  const { directory, dashboardFile } = await workspace([dashboardFixture(1, 60)]);
  let now = NOW;
  const live = service(dashboardFile, directory, client, () => now);

  await live.getBoard();
  fail = true;
  now += config.livePollMs + 1;
  const board = await live.getBoard();

  assert.equal(board.matches.length, 1, "der letzte erfolgreiche Stand bleibt sichtbar");
  assert.match(board.message ?? "", /konnten nicht aktualisiert werden/);
});

test("fragt Statistiken nicht erneut an, wenn die Liga keine liefert", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  // Randligen wie Kasachstan 1. Division liefern weder eingebettet noch einzeln Statistiken.
  const client = stubClient((ids) => ids.map((id) => liveFixture(id, "2H", 50, false)), calls, []);
  const { directory, dashboardFile } = await workspace([dashboardFixture(1, 60)]);
  let now = NOW;
  const live = service(dashboardFile, directory, client, () => now);

  const first = await live.getBoard();
  assert.deepEqual(calls.statistics, [1], "einmal darf nachgeladen werden");
  assert.equal(first.matches[0]?.metricsAvailable, false);

  for (let step = 0; step < 5; step += 1) {
    now += config.liveStatisticsFallbackTtlMs + config.livePollMs;
    await live.getBoard();
  }

  assert.deepEqual(calls.statistics, [1], "danach kostet die Partie keinen Einzelabruf mehr");
  assert.equal(calls.batches.length, 6, "der gemeinsame Batch läuft unverändert weiter");
});

test("wechselt oberhalb der Schwelle auf den Sammelabruf und spart dabei Calls", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const fixtures = Array.from({ length: 60 }, (_, index) => dashboardFixture(index + 1, 60));
  const laufend = fixtures.map((f) => liveFixture(f.fixtureId, "2H", 55, false));
  const client = stubClient((ids) => ids.map((id) => liveFixture(id, "2H", 55)), calls, [], () => laufend);
  const { directory, dashboardFile } = await workspace(fixtures);
  let now = NOW;
  const live = service(dashboardFile, directory, client, () => now);

  const first = await live.getBoard();
  assert.equal(first.strategy, "live-all");
  assert.equal(first.matches.length, 60);
  assert.equal(calls.liveAll, 1, "ein Sammelabruf deckt alle Partien ab");
  assert.equal(calls.batches.length, 3, "Statistiken kommen in 20er-Buendeln");
  const nachErstlauf = client.requestCount;

  // Zweiter Durchlauf innerhalb der Statistik-Minute: nur der Sammelabruf.
  now += config.livePollMs + 1;
  await live.getBoard();
  assert.equal(calls.liveAll, 2);
  assert.equal(client.requestCount - nachErstlauf, 1, "Statistiken werden nicht erneut geholt");

  // Der Buendelabruf haette hier 3 Calls je Aktualisierung gekostet statt einem.
  assert.equal(calls.batches.length, 3);
});

test("fragt nur die Partien ab, die die Ansicht beobachtet", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const fixtures = Array.from({ length: 30 }, (_, index) => dashboardFixture(index + 1, 60));
  const client = stubClient((ids) => ids.map((id) => liveFixture(id, "2H", 55)), calls);
  const { directory, dashboardFile } = await workspace(fixtures);
  const live = service(dashboardFile, directory, client);

  // Ohne Einschraenkung waeren es 30 Kandidaten und damit der Sammelabruf.
  const board = await live.getBoard([3, 7, 11]);

  assert.equal(board.candidates, 3);
  assert.equal(board.strategy, "batch");
  assert.deepEqual(calls.batches, [[3, 7, 11]], "abgewaehlte Partien kosten keinen Call");
  assert.equal(calls.liveAll, 0);
  assert.equal(board.matches.length, 3);
});

test("beendet Partien, die im Sammelabruf nicht mehr auftauchen", async () => {
  const calls: StubCalls = { batches: [], statistics: [], liveAll: 0 };
  const fixtures = Array.from({ length: 30 }, (_, index) => dashboardFixture(index + 1, 60));
  let laufend = fixtures.map((f) => liveFixture(f.fixtureId, "2H", 55));
  const client = stubClient((ids) => ids.map((id) => liveFixture(id, "2H", 55)), calls, [], () => laufend);
  const { directory, dashboardFile } = await workspace(fixtures);
  let now = NOW;
  const live = service(dashboardFile, directory, client, () => now);

  const first = await live.getBoard();
  assert.equal(first.candidates, 30);

  // Bis auf zwei sind alle abgepfiffen und stehen nicht mehr in der Live-Liste.
  laufend = laufend.slice(0, 2);
  now += config.livePollMs + 1;
  const second = await live.getBoard();
  assert.equal(second.matches.length, 2);

  now += config.livePollMs + 1;
  const third = await live.getBoard();
  assert.equal(third.candidates, 2, "beendete Partien fallen dauerhaft aus dem Umfang");
  assert.equal(third.strategy, "batch", "der geschrumpfte Umfang nutzt wieder Buendel");
});
