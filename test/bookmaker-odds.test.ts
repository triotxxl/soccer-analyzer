import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ApiFootballClient } from "../src/api.ts";
import { germanOfferFilter, importApiOdds, marketOddsOf, readOfferCorrections, selectApiOddsEvents } from "../src/bookmaker-odds.ts";
import { FileCache } from "../src/cache.ts";
import { requestedFixtureScope } from "../src/analyzer.ts";
import { resolveLeagues } from "../src/resolver.ts";
import type { ApiFixtureOdds, ApiLeague } from "../src/types.ts";
import { fixture } from "./helpers.ts";

// Echte Antwort von `/odds?date=2026-11-09&bookmaker=32` (Betano), auf fünf Wetten gekürzt.
const BETANO_SAMPLE: ApiFixtureOdds = {
  league: { id: 103, name: "Eliteserien", country: "Norway", season: 2026 },
  fixture: { id: 1494798, timezone: "Europe/Berlin", date: "2026-11-09T19:00:00+01:00", timestamp: 1794247200 },
  update: "2026-11-09T17:01:13+01:00",
  bookmakers: [{
    id: 32,
    name: "Betano",
    bets: [
      { id: 1, name: "Match Winner", values: [{ value: "Home", odd: "2.72" }, { value: "Draw", odd: "3.95" }, { value: "Away", odd: "2.22" }] },
      { id: 5, name: "Goals Over/Under", values: [
        { value: "Over 1.5", odd: "1.12" }, { value: "Under 1.5", odd: "5.60" },
        { value: "Over 2.5", odd: "1.39" }, { value: "Under 2.5", odd: "2.87" },
        { value: "Over 3.5", odd: "1.95" }, { value: "Under 3.5", odd: "1.82" },
        { value: "Over 3.0", odd: "1.57" }, { value: "Under 3.0", odd: "2.37" }
      ] },
      { id: 6, name: "Goals Over/Under First Half", values: [
        { value: "Over 1.5", odd: "2.02" }, { value: "Under 1.5", odd: "1.78" },
        { value: "Over 0.5", odd: "1.23" }, { value: "Under 0.5", odd: "3.90" }
      ] },
      { id: 8, name: "Both Teams Score", values: [{ value: "Yes", odd: "1.37" }, { value: "No", odd: "2.87" }] },
      { id: 12, name: "Double Chance", values: [{ value: "Home/Draw", odd: "1.67" }] }
    ]
  }]
};

/** Ein Spiel mit nur den angegebenen Wetten, Anpfiff `kickoff` (ISO), Anbieter `bookmakerId`. */
function item(id: number, kickoff: string, bookmakerId: number, bets: ApiFixtureOdds["bookmakers"][number]["bets"]): ApiFixtureOdds {
  return {
    league: { id: 78, name: "Bundesliga", country: "Germany", season: 2026 },
    fixture: { id, date: kickoff, timestamp: Date.parse(kickoff) / 1000 },
    bookmakers: [{ id: bookmakerId, name: bookmakerId === 32 ? "Betano" : "Bet365", bets }]
  };
}

const winner = (home: string, draw: string, away: string) =>
  ({ id: 1, name: "Match Winner", values: [{ value: "Home", odd: home }, { value: "Draw", odd: draw }, { value: "Away", odd: away }] });
const btts = { id: 8, name: "Both Teams Score", values: [{ value: "Yes", odd: "1.80" }, { value: "No", odd: "1.95" }] };

test("übersetzt die Wetten von API-Football in die 14 Märkte des Dashboards", () => {
  assert.deepEqual(marketOddsOf(BETANO_SAMPLE.bookmakers[0]!.bets), {
    home: 2.72, draw: 3.95, away: 2.22,
    bttsYes: 1.37, bttsNo: 2.87,
    over15: 1.12, under15: 5.6, over25: 1.39, under25: 2.87, over35: 1.95, under35: 1.82,
    firstHalfOver05: 1.23, firstHalfUnder05: 3.9, firstHalfOver15: 2.02, firstHalfUnder15: 1.78
  });
});

test("eine Quote bis 1 und eine Wette mit fremdem Namen gelten als keine Quote", () => {
  const odds = marketOddsOf([
    { id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.00" }, { value: "Draw", odd: "0" }, { value: "Away", odd: "1.50" }] },
    { id: 8, name: "Asian Handicap", values: [{ value: "Yes", odd: "1.90" }] }
  ]);
  assert.deepEqual(odds, { away: 1.5 });
});

test("ein Spiel bekommt alle Quoten vom ersten Anbieter der Liste, nie den besseren Preis", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  const kickoff = "2026-11-09T18:00:00Z";
  const { events } = selectApiOddsEvents([
    { bookmakerId: 32, items: [item(1, kickoff, 32, [winner("2.00", "3.40", "3.60")]), item(2, kickoff, 32, [btts])] },
    { bookmakerId: 8, items: [item(1, kickoff, 8, [winner("2.20", "3.60", "3.90"), btts]), item(2, kickoff, 8, [winner("1.90", "3.30", "4.20")]), item(3, kickoff, 8, [btts])] }
  ], "both", now);
  const byId = new Map(events.map((event) => [event.fixtureId, event]));
  // Spiel 1: Betano hat 1X2 - die höheren Bet365-Preise ändern daran nichts.
  assert.equal(byId.get(1)?.bookmaker, "Betano");
  assert.equal(byId.get(1)?.odds.home, 2);
  assert.equal(byId.get(1)?.odds.bttsYes, undefined, "keine Mischung über Anbieter");
  // Spiel 2: Betano ohne 1X2, Bet365 mit - ganz von Bet365.
  assert.equal(byId.get(2)?.bookmaker, "Bet365");
  assert.equal(byId.get(2)?.odds.bttsYes, undefined);
  // Spiel 3: nur Bet365.
  assert.equal(byId.get(3)?.bookmaker, "Bet365");
  assert.equal(byId.get(3)?.leagueId, 78);
});

test("Zeitfenster: 200 Minuten nach Anpfiff, 48-Stunden-Grenze und Berliner Tag des Anpfiffs", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const odds = [winner("2.00", "3.40", "3.60")];
  const listing = [{ bookmakerId: 32, items: [
    item(1, "2026-11-09T08:00:00Z", 32, odds), // 240 Minuten her - vorbei
    item(2, "2026-11-09T10:00:00Z", 32, odds), // 120 Minuten her - kann laufen
    item(3, "2026-11-11T11:00:00Z", 32, odds), // 47 Stunden - im Fenster
    item(4, "2026-11-11T13:00:00Z", 32, odds), // 49 Stunden - draußen
    item(5, "2026-11-12T23:30:00Z", 32, odds) // in Berlin schon der 13.11.
  ] }];
  assert.deepEqual(selectApiOddsEvents(listing, "next48", now).events.map((event) => event.fixtureId), [2, 3]);
  // "three" hat keine 48-Stunden-Grenze, aber den Berliner Kalender (09.-11.11.).
  assert.deepEqual(selectApiOddsEvents(listing, "three", now).events.map((event) => event.fixtureId), [2, 3, 4]);
});

test("nur Ligen eines deutschen Anbieters: Tipico-Ligen plus include, minus exclude", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  const kickoff = "2026-11-10T19:45:00Z";
  const odds = [winner("1.65", "4.05", "4.25")];
  const inLeague = (id: number, leagueId: number, name: string): ApiFixtureOdds =>
    ({ ...item(id, kickoff, 32, odds), league: { id: leagueId, name, country: "England", season: 2026 } });
  const listing = [{ bookmakerId: 32, items: [
    inLeague(1, 39, "Premier League"),
    inLeague(2, 58, "Non League Premier - Isthmian"), // Eastbourne Borough – Dulwich Hamlet, nie bei Tipico
    inLeague(3, 931, "Non League Premier - Southern Central"),
    inLeague(4, 41, "League One")
  ] }];
  const allow = germanOfferFilter(new Set([39, 41]), { include: [{ id: 931 }], exclude: [{ id: 41 }] });
  const { events, outsideOffer } = selectApiOddsEvents(listing, "three", now, "Europe/Berlin", allow);
  assert.deepEqual(events.map((event) => event.fixtureId), [1, 3]);
  assert.deepEqual([...outsideOffer.keys()].sort(), ["England | League One (41)", "England | Non League Premier - Isthmian (58)"]);
  // Ohne Filter (--alle-ligen) bleibt alles.
  assert.equal(selectApiOddsEvents(listing, "three", now, "Europe/Berlin").events.length, 4);
});

test("Korrekturliste: fehlende Datei heißt keine Korrekturen", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-offer-"));
  assert.deepEqual(await readOfferCorrections(path.join(directory, "fehlt.json")), { include: [], exclude: [] });
});

function fakeClient(pages: Record<string, ApiFixtureOdds[]>, failing: number[] = []) {
  const client = {
    requestCount: 0,
    async getOddsByDate(date: string, bookmakerId: number) {
      client.requestCount += 1;
      if (failing.includes(bookmakerId)) throw new Error(`Anbieter ${bookmakerId} nicht erreichbar`);
      return pages[`${date}:${bookmakerId}`] ?? [];
    }
  };
  return client as unknown as ApiFootballClient;
}

test("baut Auswahl mit Liga-ID und Fixture-IDs; ein Ersatzanbieter darf ausfallen, der erste nicht", async () => {
  const now = new Date("2026-11-09T10:00:00Z");
  const pages = { "2026-11-09:32": [BETANO_SAMPLE] };
  const result = await importApiOdds(fakeClient(pages, [8]), "today", now, { bookmakers: [32, 8], timezone: "Europe/Berlin" });
  assert.deepEqual(result.input.fixtureIds, [1494798]);
  assert.deepEqual(result.input.selections, [{ country: "Norway", league: "Eliteserien", apiLeagueId: 103 }]);
  assert.equal(result.events[0]?.updatedAt, "2026-11-09T17:01:13+01:00");
  assert.deepEqual([...result.byBookmaker], [["Betano", 1]]);
  assert.equal(result.failedBookmakers[0]?.bookmakerId, 8);

  await assert.rejects(
    importApiOdds(fakeClient(pages, [32]), "today", now, { bookmakers: [32, 8], timezone: "Europe/Berlin" }),
    /Anbieter 32/
  );
});

test("Quotenliste: Seiten nacheinander, zusammengeführt gespeichert, Seite 1 ohne page-Parameter", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-odds-listing-"));
  const urls: string[] = [];
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    sleepFn: async () => {},
    fetchFn: (async (url: string) => {
      urls.push(String(url));
      const page = Number(new URL(String(url)).searchParams.get("page") ?? 1);
      return new Response(JSON.stringify({
        response: [{ fixture: { id: page }, bookmakers: [] }],
        paging: { current: page, total: 3 }
      }), { status: 200 });
    }) as unknown as typeof fetch
  });
  const items = await client.getOddsByDate("2026-11-09", 32, "Europe/Berlin");
  assert.deepEqual(items.map((entry) => entry.fixture.id), [1, 2, 3]);
  assert.equal(urls.length, 3);
  assert.ok(!urls[0]!.includes("page="));
  assert.ok(urls[2]!.includes("page=3") && urls[2]!.includes("bookmaker=32"));
  // Zweiter Abruf binnen der Lebensdauer: aus dem Cache, kein Aufruf.
  assert.deepEqual((await client.getOddsByDate("2026-11-09", 32, "Europe/Berlin")).map((entry) => entry.fixture.id), [1, 2, 3]);
  assert.equal(urls.length, 3);
});

test("Quotenliste: eine leere Antwort ist eine leere Liste", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-odds-empty-"));
  const client = new ApiFootballClient({
    apiKey: "test",
    cache: new FileCache(directory),
    fetchFn: (async () => new Response(JSON.stringify({ results: 0, response: [], paging: { current: 1, total: 1 } }), { status: 200 })) as unknown as typeof fetch
  });
  assert.deepEqual(await client.getOddsByDate("2026-11-16", 32, "Europe/Berlin"), []);
});

const leagues: ApiLeague[] = [{
  league: { id: 78, name: "Bundesliga", type: "League" },
  country: { name: "Germany" },
  seasons: [{ year: 2026, start: "2026-08-01", end: "2027-05-30", current: true }]
}];

test("Liga-ID gilt vor Alias und Namen, auch wenn die Ligaliste sie nicht führt", async () => {
  const { resolved, failures } = await resolveLeagues([
    { country: "Irgendwo", league: "Name passt nicht", apiLeagueId: 78 },
    { country: "Neuland", league: "Unbekannte Liga", apiLeagueId: 99999 }
  ], leagues);
  assert.equal(failures.length, 0, "nie Exitcode 2 für eine Liga mit ID");
  assert.equal(resolved[0]?.source, "id");
  assert.equal(resolved[0]?.league, "Bundesliga", "Namen aus der Ligaliste, wo vorhanden");
  assert.equal(resolved[0]?.seasons.length, 1);
  assert.deepEqual(
    { id: resolved[1]?.leagueId, league: resolved[1]?.league, seasons: resolved[1]?.seasons },
    { id: 99999, league: "Unbekannte Liga", seasons: [] }
  );
});

test("Fixture-IDs wählen die Spiele; leer heißt kein Spiel, Fehlende werden genannt", async () => {
  const pool = [
    fixture({ id: 1, timestamp: 1_794_247_200, homeId: 10, awayId: 11 }),
    fixture({ id: 2, timestamp: 1_794_247_200, homeId: 12, awayId: 13 })
  ];
  const scope = await requestedFixtureScope(pool, { selections: [], markets: [], dates: "today", fixtureIds: [2, 7] });
  assert.deepEqual(scope.fixtures.map((entry) => entry.fixture.id), [2]);
  assert.deepEqual(scope.missingFixtureIds, [7]);
  const none = await requestedFixtureScope(pool, { selections: [], markets: [], dates: "today", fixtureIds: [] });
  assert.equal(none.fixtures.length, 0);
});
