import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InsightsError, InsightsService } from "../src/insights-service.ts";
import type { ApiFootballClient } from "../src/api.ts";
import type { DashboardDocument, DashboardFixture } from "../src/dashboard.ts";
import type { ApiFixture } from "../src/types.ts";
import { fixture } from "./helpers.ts";

const KICKOFF = Date.parse("2026-09-05T18:00:00.000Z") / 1000;
const HOME_ID = 10;
const AWAY_ID = 20;

function dashboardFixture(): DashboardFixture {
  return {
    fixtureId: 900, kickoff: new Date(KICKOFF * 1000).toISOString(), country: "Deutschland",
    league: "Bundesliga", homeTeam: "Heim FC", awayTeam: "Gast FC", modelVersion: "test",
    crossLeague: false, dataConfidence: 80, warnings: [], h2hNotice: null,
    form: { scope: "venue", home: [], away: [], homeMatches: [], awayMatches: [] },
    h2h: { outcomes: [], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    expectedGoals: { home: 1.4, away: 1.1, total: 2.5 },
    scores: { favorite: 70, draw: 55 }, markets: []
  };
}

async function dashboardFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "insights-"));
  const target = path.join(directory, "dashboard-latest.json");
  const document: DashboardDocument = {
    schemaVersion: 4,
    meta: {
      createdAt: "2026-09-04T10:00:00.000Z", timezone: "Europe/Berlin", sourceFile: "data.json",
      totalTipicoEvents: 1, selectedTipicoEvents: 1, selectedCompetitions: 1, fixtureCount: 1,
      firstAvailableDate: "2026-09-05", lastAvailableDate: "2026-09-05", maximumDays: 1, maximumHours: 8
    },
    fixtures: [dashboardFixture()], leagues: []
  };
  await writeFile(target, JSON.stringify(document), "utf8");
  return target;
}

function history(teamId: number, offset: number, count: number): ApiFixture[] {
  return Array.from({ length: count }, (_, index) => fixture({
    id: offset + index,
    timestamp: KICKOFF - (index + 1) * 86_400,
    homeId: index % 2 === 0 ? teamId : 500 + index,
    awayId: index % 2 === 0 ? 500 + index : teamId,
    homeGoals: 1, awayGoals: 0
  }));
}

interface Calls {
  batches: number[][];
  fixture: number;
  recent: number[];
  h2h: number;
}

function stubClient(calls: Calls): ApiFootballClient {
  const subject = fixture({ id: 900, timestamp: KICKOFF, homeId: HOME_ID, awayId: AWAY_ID, status: "NS" });
  let requestCount = 0;
  const client = {
    get requestCount() {
      return requestCount;
    },
    async getFixture(id: number) {
      calls.fixture += 1;
      requestCount += 1;
      return id === 900 ? [subject] : [];
    },
    async getTeamRecentFixtures(teamId: number) {
      calls.recent.push(teamId);
      requestCount += 1;
      return history(teamId, teamId * 100, 12);
    },
    async getHeadToHead() {
      calls.h2h += 1;
      requestCount += 1;
      return [fixture({ id: 700, timestamp: KICKOFF - 400 * 86_400, homeId: HOME_ID, awayId: AWAY_ID, homeGoals: 2, awayGoals: 2 })];
    },
    async getFixturesWithStatistics(ids: number[]) {
      calls.batches.push(ids);
      requestCount += 1;
      assert.ok(ids.length <= 20, "Ein Bündel darf höchstens 20 Partien umfassen.");
      return ids.map((id) => ({
        ...fixture({ id, timestamp: KICKOFF - 86_400, homeId: HOME_ID, awayId: 999, homeGoals: 1, awayGoals: 0 }),
        events: [],
        statistics: []
      }));
    }
  };
  return client as unknown as ApiFootballClient;
}

test("lädt die Detailkennzahlen in Bündeln zu höchstens 20 Partien", async () => {
  const calls: Calls = { batches: [], fixture: 0, recent: [], h2h: 0 };
  const service = new InsightsService({
    client: stubClient(calls), dashboardFile: await dashboardFile(), historyLimit: 12, h2hLimit: 10
  });

  const insights = await service.get(900);

  assert.equal(calls.fixture, 1);
  assert.deepEqual(calls.recent, [HOME_ID, AWAY_ID]);
  assert.equal(calls.h2h, 1);
  // 12 je Team plus ein direktes Duell ergeben 25 Partien, also zwei Bündel.
  assert.equal(calls.batches.length, 2);
  assert.equal(calls.batches.flat().length, 25);
  assert.equal(insights.home.id, HOME_ID);
  assert.equal(insights.away.id, AWAY_ID);
  assert.equal(insights.homeMatches.length, 12);
  assert.equal(insights.awayMatches.length, 12);
  assert.equal(insights.h2h.length, 1);
  assert.equal(insights.apiRequests, 6);
});

test("beantwortet einen zweiten Abruf ohne weitere Anfragen", async () => {
  const calls: Calls = { batches: [], fixture: 0, recent: [], h2h: 0 };
  const service = new InsightsService({
    client: stubClient(calls), dashboardFile: await dashboardFile(), historyLimit: 5, h2hLimit: 5
  });

  const first = await service.get(900);
  const second = await service.get(900);

  assert.equal(second, first);
  assert.equal(calls.fixture, 1);
  assert.equal(calls.batches.length, 1);
});

test("bündelt gleichzeitige Abrufe derselben Partie", async () => {
  const calls: Calls = { batches: [], fixture: 0, recent: [], h2h: 0 };
  const service = new InsightsService({
    client: stubClient(calls), dashboardFile: await dashboardFile(), historyLimit: 5, h2hLimit: 5
  });

  const [first, second] = await Promise.all([service.get(900), service.get(900)]);

  assert.equal(first, second);
  assert.equal(calls.fixture, 1);
});

test("meldet eine Partie außerhalb des letzten Laufs, ohne die API zu fragen", async () => {
  const calls: Calls = { batches: [], fixture: 0, recent: [], h2h: 0 };
  const service = new InsightsService({ client: stubClient(calls), dashboardFile: await dashboardFile() });

  await assert.rejects(
    () => service.get(123),
    (error: unknown) => error instanceof InsightsError && error.code === "fixture_unknown" && error.status === 404
  );
  assert.equal(calls.fixture, 0);
});

test("meldet einen fehlenden Lauf", async () => {
  const calls: Calls = { batches: [], fixture: 0, recent: [], h2h: 0 };
  const service = new InsightsService({
    client: stubClient(calls), dashboardFile: path.join(os.tmpdir(), "gibt-es-nicht.json")
  });

  await assert.rejects(
    () => service.get(900),
    (error: unknown) => error instanceof InsightsError && error.code === "dashboard_missing"
  );
});
