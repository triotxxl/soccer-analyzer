import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { EloMatch } from "../src/elo-competitions.ts";
import { getEloByTeam } from "../src/elo-store.ts";
import { autoUpdateElo, importFromCache, runningSeason, topUpRunningSeasons, TOP_UP_INTERVAL_MS, type EloClient } from "../src/elo-update.ts";
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

test("eine unterbrochene Wochenrunde setzt fort, statt dieselben Ligen erneut zu bezahlen", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "elo-cache-"));
  try {
    const leagues = [league(100), league(200)];
    const database = { ...fakeDatabase({}), eloActiveLeagues: () => new Map([[100, 50], [200, 5]]) };
    const client = fakeClient(leagues);
    const first = await autoUpdateElo(client, database, { now: NOW, topUpBudget: 1, directory });
    assert.deepEqual(client.seasonCalls, [100]);
    assert.equal(first.topUp?.budgetReached, true);

    const second = await autoUpdateElo(client, database, { now: NOW + 2 * HOUR, topUpBudget: 1, directory });
    // Bis Elo 1.1.0 lud die zweite Analyse wieder Liga 100 und kam nie bei Liga 200 an.
    assert.deepEqual(client.seasonCalls, [100, 200]);
    assert.equal(second.topUp?.alreadyDone, 1);
    assert.equal(second.topUp?.budgetReached, false);
    assert.equal(database.meta.lastTopUp, String(NOW + 2 * HOUR));
    assert.equal(database.meta.topUpDone, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ein Fortschritt, der älter als eine Woche ist, verfällt", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "elo-cache-"));
  try {
    const leagues = [league(100), league(200)];
    const database = {
      ...fakeDatabase({ topUpDone: JSON.stringify({ startedAt: NOW - 8 * 24 * HOUR, leagues: [100] }) }),
      eloActiveLeagues: () => new Map([[100, 50], [200, 5]])
    };
    const client = fakeClient(leagues);
    await autoUpdateElo(client, database, { now: NOW, topUpBudget: 5, directory });
    assert.deepEqual(client.seasonCalls, [100, 200]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("die Wochenrunde holt jede Liga mit laufender Saison, auch nach einer langen Pause", async () => {
  const season = (year: number, start: string, end: string, current = false) => ({ year, start, end, current });
  const leagues: ApiLeague[] = [
    // Sommerpause vorbei: letzte Saison endete im Mai, die neue läuft seit August.
    { ...league(731, "Highland League"), seasons: [season(2025, "2025-07-26", "2026-04-18"), season(2026, "2026-07-25", "2027-04-17", true)] },
    // Pause: beendet, die nächste beginnt erst. `current` zeigt noch auf die alte.
    { ...league(111, "Pausenliga"), seasons: [season(2026, "2026-03-01", "2026-08-30", true), season(2027, "2026-10-10", "2027-05-30")] },
    // Nicht im Bestand des letzten Jahres: gehört nicht zur Runde.
    league(999, "Fremde Liga")
  ];
  let since = 0;
  const database = {
    ...collector(),
    eloActiveLeagues: (value: number) => { since = value; return new Map([[731, 300], [111, 200]]); }
  };
  const client = fakeClient(leagues);
  const result = await topUpRunningSeasons(client, database, leagues, new Map(), { budget: 10, now: NOW });
  assert.equal(since, NOW - 400 * 24 * HOUR);
  assert.deepEqual(client.seasonCalls, [731]);
  assert.equal(result.leagues, 1);
  // Nach dem Saisonende laut API noch 14 Tage, dann Pause.
  assert.equal(runningSeason(leagues[1]!, Date.parse("2026-09-10T00:00:00Z"))?.year, 2026);
  assert.equal(runningSeason(leagues[1]!, Date.parse("2026-09-20T00:00:00Z")), null);
});

test("eine Team-ID in beiden Systemen zeigt den Eintrag mit mehr Spielen", () => {
  const row = (system: string, elo: number, games: number) => ({
    system, team_id: 64, name: "Hull City", elo, games, last_change: 0, change_30: 0, change_90: 0, peak: elo, low: elo,
    trend: "stabil", league: null, country: null, confidence: 50, last_played: 0, as_of: NOW, config_version: "1.1.0"
  });
  // Sortiert nach Elo absteigend - früher gewann der letzte, also der niedrigere Wert.
  const byTeam = getEloByTeam({ eloRatings: () => [row("club", 2072, 270), row("national", 1488, 1)] });
  assert.equal(byTeam.get(64)?.elo, 2072);
  assert.equal(byTeam.get(64)?.system, "club");
});
