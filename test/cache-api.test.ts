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
    transportRetries: 0,
    cache: new FileCache(timeoutDirectory),
    fetchFn: (async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as typeof fetch
  });
  await assert.rejects(() => timedOut.getLeagues(), /antwortete nicht/);
});

test("bricht auch einen hängenden Body-Stream ab", async () => {
  // Die Header sind da, der Body kommt nie. Ohne Timer über den Body-Read wartet der
  // Aufruf unbegrenzt - genau daran stand am 04.09.2026 ein ganzer Lauf still.
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-hanging-body-"));
  const client = new ApiFootballClient({
    apiKey: "test",
    timeoutMs: 20,
    transportRetries: 0,
    cache: new FileCache(directory),
    fetchFn: (async (_url: unknown, init?: RequestInit) => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    })) as unknown as typeof fetch
  });

  await assert.rejects(() => client.getLeagues(), /antwortete nicht/);
});

test("wiederholt einen abgebrochenen Verbindungsversuch", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-transport-retry-"));
  let calls = 0;
  const slept: number[] = [];
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    transportRetryMs: 10,
    sleepFn: async (ms) => { slept.push(ms); },
    fetchFn: (async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ response: [{ league: { id: 1 } }] }), { status: 200 });
    }) as typeof fetch
  });

  assert.equal((await client.getLeagues()).length, 1);
  assert.equal(calls, 3);
  // Wartezeit verdoppelt sich je Versuch.
  assert.deepEqual(slept, [10, 20]);
});

test("gibt nach erschöpften Wiederholungen den Verbindungsfehler weiter", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-transport-give-up-"));
  let calls = 0;
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    transportRetries: 2,
    sleepFn: async () => {},
    fetchFn: (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch
  });

  await assert.rejects(() => client.getLeagues(), /nicht erreichbar/);
  // Erstversuch plus zwei Wiederholungen.
  assert.equal(calls, 3);
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

test("half=true ist ein eigener Abruf und trifft den Cache ohne Halbzeiten nicht", async () => {
  // Der Cache-Schlüssel entsteht aus Endpunkt und sortierten Parametern. Ohne einen eigenen
  // Eintrag käme für den Halbzeit-Abruf die alte Antwort ohne statistics_1h zurück.
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-half-"));
  const urls: string[] = [];
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    fetchFn: (async (url: string) => {
      urls.push(String(url));
      const half = String(url).includes("half=true");
      return new Response(JSON.stringify({
        response: [{
          team: { id: 1, name: "Team 1" },
          statistics: [{ type: "Ball Possession", value: "60%" }],
          ...(half ? { statistics_1h: [{ type: "Ball Possession", value: "71%" }] } : {})
        }]
      }), { status: 200 });
    }) as unknown as typeof fetch
  });

  const ohne = await client.getFixtureStatistics(99, false);
  assert.equal(ohne[0]?.statistics_1h, undefined);

  const mit = await client.getFixtureStatistics(99, false, true);
  assert.equal(mit[0]?.statistics_1h?.[0]?.value, "71%");

  assert.equal(urls.length, 2, "beide Abrufe gehen ins Netz, keiner trifft den anderen");
  assert.ok(urls[0]?.includes("fixture=99") && !urls[0]?.includes("half"));
  assert.ok(urls[1]?.includes("half=true"));

  // Ein zweiter Halbzeit-Abruf kommt nun aus dem Cache.
  const nochmal = await client.getFixtureStatistics(99, false, true);
  assert.equal(nochmal[0]?.statistics_1h?.[0]?.value, "71%");
  assert.equal(urls.length, 2);
});
