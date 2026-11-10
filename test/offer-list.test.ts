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

function fakeOddsPapi(responses: { fixtures: unknown[]; requestCount?: number; requestLimit?: number }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === "/v4/account") {
      return new Response(JSON.stringify({ subscriptions: [{ is_active: true, request_count: responses.requestCount ?? 6, request_limit: responses.requestLimit ?? 250 }] }));
    }
    return new Response(JSON.stringify(responses.fixtures));
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

test("Analyse: nur Spiele aus der Angebotsliste; ohne OddsPapi die Näherung über die Tipico-Ligen", async () => {
  const now = new Date("2026-11-14T10:00:00Z");
  const fake = fakeOddsPapi({ fixtures: [{ fixtureId: "id1", participant1Name: "Avai FC SC", participant2Name: "America FC MG", startTime: "2026-11-14T19:30:00.000Z", tournamentName: "Brasileiro Serie B" }] });
  const oddsPapi = new OddsPapiClient({ apiKey: "k", cache: new FileCache(await mkdtemp(path.join(os.tmpdir(), "oddspapi-"))), fetchImpl: fake.fetchImpl, pauseMs: 0 });
  const corrections = { include: [], exclude: [] };
  const offer = offerSelection({ client: afClient(), tipicoLeagueIds: () => new Set([893]), corrections, oddsPapi, timezone: "Europe/Berlin" });
  const result = await importApiOdds(afClient(), "today", now, { bookmakers: [32], timezone: "Europe/Berlin", offerFilter: offer.filter });
  assert.deepEqual(result.input.fixtureIds, [1]);
  assert.deepEqual([...result.outsideOffer], [["Brazil | Liga 893 (893)", 1]]);
  assert.match(offerReportLine(offer.report()) ?? "", /1 Spiele zugeordnet, 0 über ihre Liga, 1 nicht im Angebot · 1 OddsPapi-Aufrufe · Stand 6 von 250/);

  // Ohne Schlüssel: Tipico-Ligen (hier nur 893) - und die Zeile sagt warum.
  const fallback = offerSelection({ client: afClient(), tipicoLeagueIds: () => new Set([893]), corrections, oddsPapi: null, timezone: "Europe/Berlin" });
  const approx = await importApiOdds(afClient(), "today", now, { bookmakers: [32], timezone: "Europe/Berlin", offerFilter: fallback.filter });
  assert.deepEqual(approx.input.fixtureIds, [2]);
  assert.match(offerReportLine(fallback.report()) ?? "", /Näherung über die Tipico-Ligen/);
});

