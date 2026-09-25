import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { EloMatch } from "../src/elo-competitions.ts";
import { autoUpdateElo, importFromCache, topUpRunningSeasons, TOP_UP_INTERVAL_MS, type EloClient } from "../src/elo-update.ts";
import type { ApiFixture, ApiLeague } from "../src/types.ts";

const NOW = Date.parse("2026-09-24T20:00:00Z");
const HOUR = 60 * 60 * 1000;

function fixture(id: number, status = "FT", leagueId = 100): ApiFixture {
  return {
    fixture: { id, date: "2026-09-20T15:00:00+00:00", timestamp: Date.parse("2026-09-20T15:00:00Z") / 1000, timezone: "UTC", status: { long: status, short: status, elapsed: 90 } },
    league: { id: leagueId, name: `Liga ${leagueId}`, country: "Testland", season: 2026 },
    teams: { home: { id: 1, name: "Alpha" }, away: { id: 2, name: "Beta" } },
    goals: status === "NS" ? { home: null, away: null } : { home: 2, away: 1 },
    score: {}
  };
}

function league(id: number, name = `Liga ${id}`): ApiLeague {
  return {
    league: { id, name, type: "League" },
    country: { name: "Testland" },
    seasons: [{ year: 2026, start: "2026-07-01", end: "2027-05-31", current: true }]
  };
}

/** Eine Cache-Datei im Format von `FileCache`, mit gesetztem Änderungsdatum. */
function cacheFile(directory: string, name: string, value: unknown, modified: number): void {
  const file = path.join(directory, `${name}.json`);
  writeFileSync(file, JSON.stringify({ storedAt: modified, value }));
  utimesSync(file, modified / 1000, modified / 1000);
}

function collector() {
  const saved: EloMatch[] = [];
  return { saved, saveEloMatches: (matches: EloMatch[]) => { saved.push(...matches); return matches.length; } };
}

test("der Import seit dem letzten Mal liest nur jüngere Cache-Dateien", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "elo-cache-"));
  try {
    cacheFile(directory, "alt", [fixture(1)], NOW - 5 * HOUR);
    cacheFile(directory, "neu", [fixture(2)], NOW - HOUR);
    const database = collector();
    const result = importFromCache(database, new Map([[100, "League"]]), { since: NOW - 2 * HOUR, directory });
    assert.equal(result.files, 2);
    assert.equal(result.read, 1);
    assert.deepEqual(database.saved.map((match) => match.fixtureId), [2]);
    assert.equal(database.saved[0]!.leagueType, "League");

    const all = collector();
    assert.equal(importFromCache(all, new Map(), { directory }).read, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("eine abgeschlossene Kopie wird nicht von einem älteren Stand vor dem Anpfiff verdrängt", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "elo-cache-"));
  try {
    cacheFile(directory, "beide", [fixture(7, "FT"), fixture(7, "NS")], NOW);
    const database = collector();
    importFromCache(database, new Map(), { directory });
    assert.equal(database.saved.length, 1);
    assert.equal(database.saved[0]!.homeGoals, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Ein API-Client, der nur zählt - jede Saison kostet einen Aufruf. */
function fakeClient(leagues: ApiLeague[]): EloClient & { seasonCalls: number[] } {
  const client = {
    requestCount: 0,
    seasonCalls: [] as number[],
    getAllLeagues: async () => leagues,
    getSeasonFixtures: async (leagueId: number) => {
      client.requestCount += 1;
      client.seasonCalls.push(leagueId);
      return [fixture(1000 + leagueId, "FT", leagueId)];
    }
  };
  return client as unknown as EloClient & { seasonCalls: number[] };
}

test("die Wochenrunde hält das Budget ein und holt Verbindungswettbewerbe zuerst", async () => {
  const leagues = [league(100), league(200), league(2, "UEFA Champions League"), league(300)];
  const client = fakeClient(leagues);
  const database = { ...collector(), eloActiveLeagues: () => new Map([[100, 50], [200, 900], [2, 10]]) };
  const result = await topUpRunningSeasons(client, database, leagues, new Map(), { budget: 2, now: NOW });
  // Liga 300 ist nicht aktiv. Von den drei aktiven passen zwei ins Budget: erst die Champions
  // League, dann die Liga mit dem größten Bestand.
  assert.equal(result.leagues, 3);
  assert.deepEqual(client.seasonCalls, [2, 200]);
  assert.equal(result.apiRequests, 2);
  assert.equal(result.budgetReached, true);
});

function fakeDatabase(meta: Record<string, string>) {
  return {
    ...collector(),
    meta,
    getEloMeta: (key: string) => meta[key] ?? null,
    setEloMeta: (key: string, value: string) => { meta[key] = value; },
    eloActiveLeagues: () => new Map([[100, 5]]),
    eloMatches: () => [],
    replaceEloResults: () => undefined
  };
}

test("die Wochenrunde läuft nur, wenn die letzte älter als sieben Tage ist", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "elo-cache-"));
  try {
    const leagues = [league(100)];
    const recent = fakeDatabase({ lastImport: String(NOW - HOUR), lastTopUp: String(NOW - 2 * 24 * HOUR) });
    const quiet = fakeClient(leagues);
    const skipped = await autoUpdateElo(quiet, recent, { now: NOW, topUpBudget: 600, directory });
    assert.equal(skipped.topUp, null);
    assert.equal(quiet.requestCount, 0);
    assert.equal(skipped.nextTopUp, NOW - 2 * 24 * HOUR + TOP_UP_INTERVAL_MS);
    assert.equal(recent.meta.lastImport, String(NOW));

    const stale = fakeDatabase({ lastTopUp: String(NOW - 8 * 24 * HOUR) });
    const busy = fakeClient(leagues);
    const ran = await autoUpdateElo(busy, stale, { now: NOW, topUpBudget: 600, directory });
    assert.equal(ran.topUp?.loaded, 1);
    assert.equal(stale.meta.lastTopUp, String(NOW));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("eine Wochenrunde, die am Budget hängen bleibt, gilt nicht als erledigt", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "elo-cache-"));
  try {
    const leagues = [league(100), league(200)];
    const database = { ...fakeDatabase({}), eloActiveLeagues: () => new Map([[100, 5], [200, 5]]) };
    const result = await autoUpdateElo(fakeClient(leagues), database, { now: NOW, topUpBudget: 1, directory });
    assert.equal(result.topUp?.budgetReached, true);
    assert.equal(database.meta.lastTopUp, undefined);
    assert.equal(database.meta.lastImport, String(NOW));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
