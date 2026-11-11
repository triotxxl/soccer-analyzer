import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ApiFootballClient } from "../src/api.ts";
import { importApiOdds } from "../src/bookmaker-odds.ts";
import { FileCache } from "../src/cache.ts";
import { OddsPapiClient, offerBlocks } from "../src/oddspapi.ts";
import { offerReportLine, offerSelection } from "../src/offer-filter.ts";
import { decideOffer, matchOfferFixture, offerTeamSimilarity, type AfFixture, type OfferFixture } from "../src/offer-matching.ts";
import type { ApiFixture, ApiFixtureOdds } from "../src/types.ts";

const T = Date.parse("2026-11-14T19:30:00Z");
const offer = (id: string, home: string, away: string, kickoff = T, tournament = "Brazil | Brasileiro Serie B"): OfferFixture =>
  ({ id, home, away, kickoff, tournament });
const af = (fixtureId: number, home: string, away: string, leagueId = 72, kickoff = T): AfFixture =>
  ({ fixtureId, leagueId, home, away, kickoff });

test("Teamnamen: Rechtsform, Bundesstaat, Jahreszahl und Kürzel trennen nicht (echte Fälle vom 10.11.2026)", () => {
  assert.equal(offerTeamSimilarity("America Mineiro", "America FC MG"), 1);
  assert.equal(offerTeamSimilarity("Sport Recife", "SC Recife PE"), 1);
  assert.equal(offerTeamSimilarity("Hebar 1918", "FK Hebar Pazardzhik"), 1);
  assert.equal(offerTeamSimilarity("Atletico Goianiense", "AC Goianiense GO"), 1);
  assert.equal(offerTeamSimilarity("Juventus U23", "Juventus Next Gen"), 1);
  assert.equal(offerTeamSimilarity("Real Sociedad II", "Real Sociedad San Sebastian B"), 1);
  // ø wie OddsPapi als „oe“ (vorher wurde „Køge“ zu „k ge“ und fand nichts).
  assert.equal(offerTeamSimilarity("Køge W", "HB Koege Women"), 1);
  assert.equal(offerTeamSimilarity("Brøndby W", "Broendby IF Women"), 1);
});

test("Teamnamen: Frauen gegen Männer und erste gegen zweite Mannschaft passen nie", () => {
  assert.equal(offerTeamSimilarity("Juventus W", "Juventus"), 0);
  assert.equal(offerTeamSimilarity("Atletico Madrid II", "Atletico Madrid"), 0);
  // Nur ein allgemeines Wort gemeinsam trägt allein keine Zuordnung.
  assert.equal(offerTeamSimilarity("Real Madrid", "Real Zaragoza"), 0.4);
});

test("Zuordnung: Frauen aus dem Wettbewerb, vertauschte Seiten, verschobener Termin", () => {
  const women = matchOfferFixture(
    af(1, "Juventus W", "Lyon W", 525),
    [offer("a", "Juventus Turin", "Olympique Lyon", T, "International Clubs | UEFA Champions League Women"), offer("b", "Juventus Turin", "Olympique Lyon", T, "Italy | Serie A")]
  );
  assert.equal(women?.offer.id, "a");
  const swapped = matchOfferFixture(af(2, "Goias", "Sport Recife"), [offer("c", "SC Recife PE", "Goias EC GO")]);
  assert.equal(swapped?.swapped, true);
  // API-Football führt das Spiel auf einem Platzhaltertermin einen Tag später.
  const shifted = matchOfferFixture(af(3, "Comerciantes Unidos", "Sport Boys", 281, T + 21 * 3600e3), [offer("d", "Comerciantes Unidos", "Sport Boys Association")]);
  assert.equal(shifted?.offer.id, "d");
  // Ein Team sicher, das andere nur mit einem Wort: nur bei fast gleichem Anstoß.
  const loose = (dt: number) => matchOfferFixture(af(4, "Athletic Club II", "Racing Ferrol", 999, T + dt), [offer("e", "Athletic Bilbao B", "Racing Club de Ferrol")]);
  assert.equal(loose(0)?.offer.id, "e");
  assert.equal(loose(2 * 3600e3), null);
});

test("Zuordnung: zwei gleich gute Kandidaten ergeben keine", () => {
  assert.equal(matchOfferFixture(af(1, "Nacional", "Penarol"), [offer("a", "Nacional", "Penarol"), offer("b", "Nacional", "Penarol")]), null);
});

test("Angebot: direkt, über die Liga, Korrekturliste geht vor", () => {
  const fixtures = [
    af(1, "Avai", "America Mineiro", 72),
    af(2, "CRB", "Ceara", 72), // OddsPapi: „CR Brasil AL“ - kein eigener Treffer, aber die Liga ist da
    af(3, "Austria U19", "Belarus U19", 893), // U19-EM-Qualifikation - nicht bei betano.de
    af(4, "Avro", "Whitby Town", 59),
    af(5, "Alcoyano", "Elche II", 877)
  ];
  const offers = [offer("x", "Avai FC SC", "America FC MG"), offer("y", "CR Brasil AL", "Ceara SC CE")];
  const decision = decideOffer(fixtures, offers, { include: new Set([59]), exclude: new Set() });
  assert.deepEqual([...decision.allowed].sort(), [1, 2, 4]);
  assert.deepEqual([...decision.viaLeague], [2]);
  assert.deepEqual([...decision.dropped].sort(), [3, 5]);
  assert.deepEqual([...decideOffer(fixtures, offers, { include: new Set(), exclude: new Set([72]) }).allowed], []);
});

test("OddsPapi: feste Zwei-Tage-Blöcke unter 48 Stunden ab geradem UTC-Tag", () => {
  const blocks = offerBlocks(Date.parse("2026-11-10T17:00:00Z"), Date.parse("2026-11-12T23:00:00Z"));
  assert.deepEqual(blocks.map((block) => new Date(block.from).toISOString()), ["2026-11-09T00:00:00.000Z", "2026-11-11T00:00:00.000Z"]);
  for (const block of blocks) assert.ok(block.to - block.from < 48 * 3600e3);
  assert.equal(blocks[1]!.from - blocks[0]!.to, 1000, "lückenlos");
});

function fakeOddsPapi(responses: { fixtures: unknown[] | Record<string, unknown[]>; requestCount?: number; requestLimit?: number }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === "/v4/account") {
      return new Response(JSON.stringify({ subscriptions: [{ is_active: true, request_count: responses.requestCount ?? 6, request_limit: responses.requestLimit ?? 250 }] }));
    }
    const fixtures = Array.isArray(responses.fixtures) ? responses.fixtures : responses.fixtures[url.searchParams.get("bookmakers") ?? ""] ?? [];
    return new Response(JSON.stringify(fixtures));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("OddsPapi: Blöcke aus dem Cache kosten nichts, das Kontingent wird vorher geprüft", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "oddspapi-"));
  const raw = [{ fixtureId: "id1", participant1Name: "Avai FC SC", participant2Name: "America FC MG", startTime: "2026-11-14T19:30:00.000Z", categoryName: "Brazil", tournamentName: "Brasileiro Serie B" }];
  const fake = fakeOddsPapi({ fixtures: raw });
  const client = () => new OddsPapiClient({ apiKey: "k", cache: new FileCache(directory), fetchImpl: fake.fetchImpl, pauseMs: 0 });
  const first = client();
  const list = await first.offerFixtures(T - 3600e3, T + 3600e3, "betano.de");
  assert.deepEqual(list.map((entry) => [entry.id, entry.tournament]), [["id1", "Brazil | Brasileiro Serie B"]]);
  assert.equal(first.requestCount, 1);
  const second = client();
  await second.offerFixtures(T - 3600e3, T + 3600e3, "betano.de");
  assert.equal(second.requestCount, 0, "zweite Analyse liest den Cache");
  assert.deepEqual(fake.calls, ["/v4/account", "/v4/fixtures"]);

  const full = fakeOddsPapi({ fixtures: raw, requestCount: 245, requestLimit: 250 });
  const exhausted = new OddsPapiClient({ apiKey: "k", cache: new FileCache(await mkdtemp(path.join(os.tmpdir(), "oddspapi-"))), fetchImpl: full.fetchImpl, pauseMs: 0 });
  await assert.rejects(exhausted.offerFixtures(T, T, "betano.de"), /Kontingent fast aufgebraucht/);
  assert.deepEqual(full.calls, ["/v4/account"], "kein zählender Aufruf");
});

const dailyFixture = (id: number, home: string, away: string, leagueId: number): ApiFixture => ({
  fixture: { id, date: "2026-11-14T19:30:00Z", timestamp: T / 1000, timezone: "UTC", status: { long: "Not Started", short: "NS", elapsed: null } },
  league: { id: leagueId, name: `Liga ${leagueId}`, country: "Brazil", season: 2026 },
  teams: { home: { id: id * 10, name: home }, away: { id: id * 10 + 1, name: away } },
  goals: { home: null, away: null },
  score: {}
});

const oddsItem = (id: number, leagueId: number): ApiFixtureOdds => ({
  league: { id: leagueId, name: `Liga ${leagueId}`, country: "Brazil", season: 2026 },
  fixture: { id, date: "2026-11-14T19:30:00Z", timestamp: T / 1000 },
  bookmakers: [{ id: 32, name: "Betano", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "2.0" }, { value: "Draw", odd: "3.2" }, { value: "Away", odd: "3.5" }] }] }]
});

function afClient() {
  const client = {
    requestCount: 0,
    async getOddsByDate() { return [oddsItem(1, 72), oddsItem(2, 893)]; },
    async getFixturesForDate() { return [dailyFixture(1, "Avai", "America Mineiro", 72), dailyFixture(2, "Austria U19", "Belarus U19", 893)]; }
  };
  return client as unknown as ApiFootballClient;
}

const AVAI = { fixtureId: "id1", participant1Name: "Avai FC SC", participant2Name: "America FC MG", startTime: "2026-11-14T19:30:00.000Z", tournamentName: "Brasileiro Serie B" };
const U19 = { fixtureId: "id2", participant1Name: "Austria U19", participant2Name: "Belarus U19", startTime: "2026-11-14T19:30:00.000Z", tournamentName: "U19 European Championship, Qualification" };

test("Analyse: was mindestens eine Seite anbietet, mit den Seiten je Spiel; ohne OddsPapi die Näherung", async () => {
  const now = new Date("2026-11-14T10:00:00Z");
  const fake = fakeOddsPapi({ fixtures: { "betano.de": [AVAI], tipico: [AVAI, U19] } });
  const oddsPapi = new OddsPapiClient({ apiKey: "k", cache: new FileCache(await mkdtemp(path.join(os.tmpdir(), "oddspapi-"))), fetchImpl: fake.fetchImpl, pauseMs: 0 });
  const corrections = { include: [], exclude: [] };
  const offer = offerSelection({ client: afClient(), tipicoLeagueIds: () => new Set([893]), corrections, oddsPapi, timezone: "Europe/Berlin", bookmakers: ["betano.de", "tipico"] });
  const result = await importApiOdds(afClient(), "today", now, { bookmakers: [32], timezone: "Europe/Berlin", offerFilter: offer.filter });
  assert.deepEqual(result.input.fixtureIds, [1, 2]);
  assert.deepEqual([...offer.offeredBy()!], [[1, ["betano.de", "tipico"]], [2, ["tipico"]]]);
  assert.equal(offerReportLine(offer.report()),
    "Angebot (OddsPapi): betano.de 1 (1 zugeordnet), tipico 2 (2 zugeordnet) · zusammen 2, 0 bei keiner Seite · 2 OddsPapi-Aufrufe · Stand 8 von 250");
  // Der Kontostand wurde einmal gefragt und dann mitgezählt (6 + 2), nicht nach jedem Abruf neu.
  assert.equal(fake.calls.filter((call) => call === "/v4/account").length, 1);

  // Keine Seite führt das U19-Spiel: Es fällt weg.
  const betanoOnly = offerSelection({ client: afClient(), tipicoLeagueIds: () => new Set(), corrections, oddsPapi, timezone: "Europe/Berlin", bookmakers: ["betano.de"] });
  const onlyBetano = await importApiOdds(afClient(), "today", now, { bookmakers: [32], timezone: "Europe/Berlin", offerFilter: betanoOnly.filter });
  assert.deepEqual(onlyBetano.input.fixtureIds, [1]);
  assert.deepEqual([...onlyBetano.outsideOffer], [["Brazil | Liga 893 (893)", 1]]);

  // Ohne Schlüssel: Tipico-Ligen (hier nur 893) - und die Zeile sagt warum.
  const fallback = offerSelection({ client: afClient(), tipicoLeagueIds: () => new Set([893]), corrections, oddsPapi: null, timezone: "Europe/Berlin" });
  const approx = await importApiOdds(afClient(), "today", now, { bookmakers: [32], timezone: "Europe/Berlin", offerFilter: fallback.filter });
  assert.deepEqual(approx.input.fixtureIds, [2]);
  assert.match(offerReportLine(fallback.report()) ?? "", /Näherung über die Tipico-Ligen/);
  assert.equal(fallback.offeredBy(), null, "bei der Näherung weiß niemand, welche Seite");
});


test("OddsPapi: Sperrzeit (429) wird abgewartet, ein leeres Kontingent nicht", async () => {
  const raw = [{ fixtureId: "id1", participant1Name: "A", participant2Name: "B", startTime: "2026-11-14T19:30:00.000Z" }];
  let fixturesCalls = 0;
  const flaky = (async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.pathname === "/v4/account") {
      // Wie am 10.11.2026: Kontostand direkt nach einem Abruf - erst 429, dann 200.
      return (flaky as unknown as { n: number }).n++ === 0
        ? new Response(JSON.stringify({ message: "Too many requests" }), { status: 429 })
        : new Response(JSON.stringify({ subscriptions: [{ request_count: 12, request_limit: 250 }] }));
    }
    fixturesCalls += 1;
    return new Response(JSON.stringify(raw));
  }) as typeof fetch & { n: number };
  flaky.n = 0;
  const client = new OddsPapiClient({ apiKey: "k", cache: new FileCache(await mkdtemp(path.join(os.tmpdir(), "oddspapi-"))), fetchImpl: flaky, pauseMs: 0, retryMs: 0 });
  assert.equal((await client.offerFixtures(T, T, "betano.de")).length, 1);
  assert.equal(fixturesCalls, 1);
  assert.deepEqual(client.currentQuota(), { requestCount: 13, requestLimit: 250 });

  let attempts = 0;
  const exhausted = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ code: "REQUEST_LIMIT_EXCEEDED" }), { status: 429 });
  }) as unknown as typeof fetch;
  const empty = new OddsPapiClient({ apiKey: "k", cache: new FileCache(await mkdtemp(path.join(os.tmpdir(), "oddspapi-"))), fetchImpl: exhausted, pauseMs: 0, retryMs: 0 });
  await assert.rejects(empty.offerFixtures(T, T, "betano.de"), /HTTP 429 REQUEST_LIMIT_EXCEEDED/);
  assert.equal(attempts, 1, "kein Neuversuch, wenn das Monatskontingent leer ist");
});

test("Spiele ohne Quote bei API-Football: aufgenommen, wenn eine Seite sie anbietet - nur mit eigenem Treffer", async () => {
  const now = new Date("2026-11-14T10:00:00Z");
  const withExtras = () => {
    const client = {
      requestCount: 0,
      async getOddsByDate() { return [oddsItem(1, 72)]; },
      async getFixturesForDate() {
        return [
          dailyFixture(1, "Avai", "America Mineiro", 72),
          dailyFixture(3, "Vissel Kobe", "Machida Zelvia", 101), // Tipico führt es, Betano bei API-Football nicht
          dailyFixture(4, "Kawasaki Frontale", "Kashiwa Reysol", 101), // keine Seite führt es
          { ...dailyFixture(5, "Kimberley Mar del Plata", "Olimpo Bahia Blanca", 134), fixture: { ...dailyFixture(5, "x", "y", 134).fixture, status: { long: "Postponed", short: "PST", elapsed: null } } }
        ];
      }
    };
    return client as unknown as ApiFootballClient;
  };
  const KOBE = { fixtureId: "id3", participant1Name: "Vissel Kobe", participant2Name: "Machida Zelvia", startTime: "2026-11-14T19:30:00.000Z", tournamentName: "J.League Cup" };
  const OLIMPO = { fixtureId: "id5", participant1Name: "Kimberley de Mar Del Plata", participant2Name: "Club Olimpo", startTime: "2026-11-14T19:30:00.000Z", tournamentName: "Torneo Federal A" };
  const fake = fakeOddsPapi({ fixtures: { "betano.de": [AVAI], tipico: [AVAI, KOBE, OLIMPO] } });
  const oddsPapi = new OddsPapiClient({ apiKey: "k", cache: new FileCache(await mkdtemp(path.join(os.tmpdir(), "oddspapi-"))), fetchImpl: fake.fetchImpl, pauseMs: 0 });
  const offer = offerSelection({ client: withExtras(), tipicoLeagueIds: () => new Set(), corrections: { include: [], exclude: [] }, oddsPapi, timezone: "Europe/Berlin", bookmakers: ["betano.de", "tipico"] });
  const result = await importApiOdds(withExtras(), "today", now, { bookmakers: [32], timezone: "Europe/Berlin", offerFilter: offer.filter, offerExtras: offer.extras });
  // 3 ohne Quote dazu; 4 bietet niemand an, 5 ist verlegt.
  assert.deepEqual(result.input.fixtureIds, [1, 3]);
  assert.equal(result.withoutOdds, 1);
  assert.deepEqual(result.events.find((event) => event.fixtureId === 3)?.odds, {});
  assert.deepEqual([...result.byBookmaker], [["Betano", 1]], "ein Spiel ohne Quote zählt bei keinem Anbieter");
  assert.deepEqual(offer.offeredBy()!.get(3), ["tipico"]);
  assert.match(offerReportLine(offer.report()) ?? "", /dazu 1 angeboten ohne Quote bei API-Football/);
});

test("Platzhaltertermin: Anstoß vom Anbieter; unbekannte Spiele werden nur gesammelt", async () => {
  const at = (iso: string) => Date.parse(iso);
  const daily = (id: number, home: string, away: string, leagueId: number, kickoff: string, short = "NS"): ApiFixture => ({
    fixture: { id, date: kickoff, timestamp: at(kickoff) / 1000, timezone: "UTC", status: { long: short, short, elapsed: null } },
    league: { id: leagueId, name: `Liga ${leagueId}`, country: "Colombia", season: 2026 },
    teams: { home: { id: id * 10, name: home }, away: { id: id * 10 + 1, name: away } },
    goals: { home: null, away: null }, score: {}
  });
  const odds = (id: number, leagueId: number, kickoff: string): ApiFixtureOdds => ({
    league: { id: leagueId, name: `Liga ${leagueId}`, country: "Colombia", season: 2026 },
    fixture: { id, date: kickoff, timestamp: at(kickoff) / 1000 },
    bookmakers: [{ id: 32, name: "Betano", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "2.0" }, { value: "Draw", odd: "3.2" }, { value: "Away", odd: "3.5" }] }] }]
  });
  // API-Football: beide kolumbianischen Spiele auf Donnerstag 22:00 (Platzhalter), dazu ein beendetes CRB - Ceará.
  const client = {
    requestCount: 0,
    async getOddsByDate() { return [odds(1, 239, "2026-11-12T21:00:00Z"), odds(2, 239, "2026-11-12T21:00:00Z")]; },
    async getFixturesForDate() {
      return [daily(1, "Millonarios", "Alianza Valledupar", 239, "2026-11-12T21:00:00Z"),
        daily(2, "Deportivo Cali", "Deportes Tolima", 239, "2026-11-12T21:00:00Z"),
        daily(3, "CRB", "Ceara", 72, "2026-11-12T19:00:00Z", "FT")];
    }
  } as unknown as ApiFootballClient;
  const offer = (id: string, home: string, away: string, kickoff: string, tournament: string) =>
    ({ fixtureId: id, participant1Name: home, participant2Name: away, startTime: kickoff, tournamentName: tournament });
  const fake = fakeOddsPapi({ fixtures: { tipico: [
    // Bei Tipico der echte Termin: Millonarios am Freitag (im Umfang), Cali erst am Samstag (außerhalb, aber im selben Block).
    offer("m", "Millonarios FC", "Alianza FC Valledupar", "2026-11-13T20:30:00.000Z", "Liga DIMAYOR"),
    offer("c", "Deportivo Cali", "CD Tolima", "2026-11-14T20:30:00.000Z", "Liga DIMAYOR"),
    offer("crb", "CR Brasil AL", "Ceara SC CE", "2026-11-12T19:00:00.000Z", "Brasileiro Serie B"),
    offer("sv", "Neo Pipil San Juan Nonualco", "CD Dragon", "2026-11-12T03:00:00.000Z", "Liga de Ascenso")
  ] } });
  const oddsPapi = new OddsPapiClient({ apiKey: "k", cache: new FileCache(await mkdtemp(path.join(os.tmpdir(), "oddspapi-"))), fetchImpl: fake.fetchImpl, pauseMs: 0 });
  const selection = offerSelection({ client, tipicoLeagueIds: () => new Set(), corrections: { include: [], exclude: [] }, oddsPapi, timezone: "Europe/Berlin", bookmakers: ["tipico"] });
  const result = await importApiOdds(client, "three", new Date("2026-11-11T22:00:00Z"), {
    bookmakers: [32], timezone: "Europe/Berlin", offerFilter: selection.filter, offerExtras: selection.extras, offerKickoffs: selection.kickoffs
  });
  // Millonarios mit dem Tipico-Anstoß analysiert, Cali fällt mit dem echten Termin aus dem Umfang.
  assert.deepEqual(result.input.fixtureIds, [1]);
  assert.deepEqual(result.input.kickoffOverrides, { 1: "2026-11-13T20:30:00.000Z" });
  assert.equal(result.events[0]?.kickoff, "2026-11-13T20:30:00.000Z");
  assert.equal(result.movedOut, 1);
  // Unbekannt ist nur das Spiel aus El Salvador; „CR Brasil AL“ kennt API-Football als „CRB“.
  assert.deepEqual(selection.unknown().map((game) => `${game.home} - ${game.away}`), ["Neo Pipil San Juan Nonualco - CD Dragon"]);
  // Gezählt wird nur, was im Zeitraum liegt: Cali fällt mit dem Anstoß des Anbieters heraus.
  assert.match(offerReportLine(selection.report()) ?? "", /1 mit Anstoß vom Anbieter .* 1 angeboten, aber API-Football unbekannt/);
});

test("Platzhaltertermin außerhalb des Zeitraums und U21 ohne Altersangabe (echte Fälle vom 11.11.2026)", async () => {
  const at = (iso: string) => Date.parse(iso);
  const daily = (id: number, home: string, away: string, leagueId: number, kickoff: string): ApiFixture => ({
    fixture: { id, date: kickoff, timestamp: at(kickoff) / 1000, timezone: "UTC", status: { long: "NS", short: "NS", elapsed: null } },
    league: { id: leagueId, name: `Liga ${leagueId}`, country: "Brazil", season: 2026 },
    teams: { home: { id: id * 10, name: home }, away: { id: id * 10 + 1, name: away } },
    goals: { home: null, away: null }, score: {}
  });
  const byDay: Record<string, ApiFixture[]> = {
    "2026-11-12": [daily(1, "Iceland U21", "Greece U21", 38, "2026-11-12T13:00:00Z"), daily(2, "Iceland", "Greece", 5, "2026-11-12T19:45:00Z")],
    // API-Football führt Ponte Preta - Operário einen Tag später als Betano, außerhalb des Zeitraums.
    "2026-11-14": [daily(3, "Ponte Preta", "Operario-PR", 72, "2026-11-14T19:30:00Z")]
  };
  const days: string[] = [];
  const client = {
    requestCount: 0,
    async getOddsByDate() { return []; },
    async getFixturesForDate(day: string) { days.push(day); return byDay[day] ?? []; }
  } as unknown as ApiFootballClient;
  const offer = (id: string, home: string, away: string, kickoff: string, tournament: string) =>
    ({ fixtureId: id, participant1Name: home, participant2Name: away, startTime: kickoff, tournamentName: tournament });
  const fake = fakeOddsPapi({ fixtures: { "betano.de": [
    offer("u21", "Iceland", "Greece", "2026-11-12T13:00:00.000Z", "U21 UEFA European Championship, Qualification"),
    offer("pp", "AA Ponte Preta SP", "Operario Ferroviario EC PR", "2026-11-13T22:00:00.000Z", "Brasileiro Serie B")
  ] } });
  const oddsPapi = new OddsPapiClient({ apiKey: "k", cache: new FileCache(await mkdtemp(path.join(os.tmpdir(), "oddspapi-"))), fetchImpl: fake.fetchImpl, pauseMs: 0 });
  const selection = offerSelection({ client, tipicoLeagueIds: () => new Set(), corrections: { include: [], exclude: [] }, oddsPapi, timezone: "Europe/Berlin", bookmakers: ["betano.de"] });
  const result = await importApiOdds(client, "three", new Date("2026-11-11T22:00:00Z"), {
    bookmakers: [32], timezone: "Europe/Berlin", offerFilter: selection.filter, offerExtras: selection.extras, offerKickoffs: selection.kickoffs
  });
  // Die U21 statt des A-Teams, Ponte Preta mit dem Anstoß von Betano - beide ohne Quote analysiert.
  assert.deepEqual(result.input.fixtureIds, [1, 3]);
  assert.deepEqual(result.input.kickoffOverrides, { 3: "2026-11-13T22:00:00.000Z" });
  // Die Analyse lädt die Tagesliste, in der API-Football das Spiel führt.
  assert.deepEqual(result.input.placeholderDates, ["2026-11-14"]);
  assert.ok(days.includes("2026-11-14"));
  assert.deepEqual(selection.unknown(), []);
  assert.deepEqual(selection.offeredBy()?.get(3), ["betano.de"]);
});

test("OddsPapi: ein leerer Block (404 FIXTURE_NOT_FOUND) ist eine leere Liste, kein Fehler", async () => {
  let fixtureCalls = 0;
  const empty = (async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.pathname === "/v4/account") return new Response(JSON.stringify({ subscriptions: [{ request_count: 14, request_limit: 250 }] }));
    fixtureCalls += 1;
    return new Response(JSON.stringify({ error: { message: "No fixtures found for the specified criteria.", code: "FIXTURE_NOT_FOUND" } }), { status: 404 });
  }) as typeof fetch;
  const directory = await mkdtemp(path.join(os.tmpdir(), "oddspapi-"));
  const client = () => new OddsPapiClient({ apiKey: "k", cache: new FileCache(directory), fetchImpl: empty, pauseMs: 0, retryMs: 0 });
  assert.deepEqual(await client().offerFixtures(T, T, "betano.de"), []);
  // Gespeichert: Die nächste Analyse fragt den leeren Block nicht noch einmal.
  assert.deepEqual(await client().offerFixtures(T, T, "betano.de"), []);
  assert.equal(fixtureCalls, 1);
});
