import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ApiFootballClient } from "../src/api.ts";
import { FileCache } from "../src/cache.ts";

test("ignoriert beschädigte Cache-Dateien", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-cache-"));
  const cache = new FileCache(directory);
  await cache.set("key", { ok: true });
  const [file] = await readdir(directory);
  await writeFile(path.join(directory, file!), "{kaputt", "utf8");
  assert.equal(await cache.get("key", 10_000), null);
});

test("wartet bei HTTP 429 eine Minute und setzt denselben Request fort", async () => {
  const limitedDirectory = await mkdtemp(path.join(os.tmpdir(), "football-limit-"));
  const waits: number[] = [];
  let requests = 0;
  const limited = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(limitedDirectory),
    rateLimitRetryMs: 60_000,
    sleepFn: async (milliseconds) => { waits.push(milliseconds); },
    fetchFn: (async () => {
      requests += 1;
      return requests === 1
        ? new Response("{}", { status: 429 })
        : new Response(JSON.stringify({ response: [] }), { status: 200 });
    }) as typeof fetch
  });

  assert.deepEqual(await limited.getLeagues(), []);
  assert.equal(requests, 2);
  assert.deepEqual(waits, [60_000]);
});

test("wartet auch bei einer too-many-requests-Antwort und setzt fort", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-envelope-limit-"));
  const waits: number[] = [];
  let requests = 0;
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    sleepFn: async (milliseconds) => { waits.push(milliseconds); },
    fetchFn: (async () => {
      requests += 1;
      return new Response(JSON.stringify(
        requests === 1
          ? { errors: { rateLimit: "Too many requests" }, response: [] }
          : { response: [] }
      ), { status: 200 });
    }) as typeof fetch
  });

  assert.deepEqual(await client.getLeagues(), []);
  assert.equal(requests, 2);
  assert.deepEqual(waits, [60_000]);
});

test("begrenzt echte Netzwerkaufrufe auf das konfigurierte Minutenbudget", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-rate-window-"));
  const waits: number[] = [];
  let now = 1_000;
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    requestsPerMinute: 2,
    rateLimitWindowMs: 60_000,
    nowFn: () => now,
    sleepFn: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
    fetchFn: (async () => new Response(
      JSON.stringify({ response: [] }),
      { status: 200 }
    )) as typeof fetch
  });

  await Promise.all([
    client.getLeagueDetails(1),
    client.getLeagueDetails(2),
    client.getLeagueDetails(3)
  ]);
  assert.deepEqual(waits, [60_000]);
  assert.equal(client.requestCount, 3);
});

test("glättet den Pro-Tarif zusätzlich auf fünf Requests pro Sekunde", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-second-window-"));
  const waits: number[] = [];
  let now = 5_000;
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    requestsPerMinute: 300,
    requestsPerSecond: 2,
    rateLimitSecondWindowMs: 1_000,
    nowFn: () => now,
    sleepFn: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
    fetchFn: (async () => new Response(
      JSON.stringify({ response: [] }),
      { status: 200 }
    )) as typeof fetch
  });

  await Promise.all([
    client.getLeagueDetails(11),
    client.getLeagueDetails(12),
    client.getLeagueDetails(13)
  ]);
  assert.deepEqual(waits, [1_000]);
  assert.equal(client.requestCount, 3);
});

test("teilt einen 40-Spiele-Teamcache zwischen Analyse und Formfilter", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-team-history-"));
  const urls: string[] = [];
  const response = Array.from({ length: 40 }, (_, index) => ({
    fixture: { timestamp: index }
  }));
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    fetchFn: (async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ response }), { status: 200 });
    }) as typeof fetch
  });

  assert.equal((await client.getTeamRecentFixtures(7, 20)).length, 20);
  assert.equal((await client.getTeamRecentFixtures(7, 40)).length, 40);
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /last=40/);
});

test("übersetzt Timeouts in einen verständlichen Fehler", async () => {

  const timeoutDirectory = await mkdtemp(path.join(os.tmpdir(), "football-timeout-"));
  const timedOut = new ApiFootballClient({
    apiKey: "test",
    timeoutMs: 5,
    cache: new FileCache(timeoutDirectory),
    fetchFn: (async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as typeof fetch
  });
  await assert.rejects(() => timedOut.getLeagues(), /antwortete nicht/);
});

test("lädt Fixture-Statistiken in API-konformen 20er-ID-Batches", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-fixture-batch-"));
  let requested = "";
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    fetchFn: (async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ response: [] }), { status: 200 });
    }) as typeof fetch
  });
  await client.getFixturesWithStatistics(Array.from({ length: 20 }, (_, index) => index + 1));
  assert.match(requested, /fixtures\?ids=1-2-3-/);
  assert.throws(() => client.getFixturesWithStatistics(Array.from({ length: 21 }, (_, index) => index + 1)), /1 und 20/);
});
