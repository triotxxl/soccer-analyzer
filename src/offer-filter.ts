/**
 * Welche Spiele der Quotenliste von API-Football es bei einem deutschen Anbieter gibt (Quelle "api").
 *
 * Seit 10.11.2026 (Davids Entscheidung) über die Angebotsliste von OddsPapi (`src/oddspapi.ts`,
 * Zuordnung `src/offer-matching.ts`). Ohne Schlüssel, bei aufgebrauchtem Kontingent oder einem Fehler
 * gilt die Näherung vom 09.11.2026: jede Liga, die Tipico je angeboten hat (`germanOfferFilter`). Davids
 * Korrekturliste (`data/angebot-ligen.json`) gilt auf beiden Wegen und geht vor.
 */
import type { ApiFootballClient } from "./api.ts";
import { germanOfferFilter, type ApiOddsEvent, type OfferLeagueCorrections } from "./bookmaker-odds.ts";
import { config } from "./config.ts";
import { OddsPapiClient, type OddsPapiQuota } from "./oddspapi.ts";
import { decideOffer, findShiftedFixture, offerKnown, type AfFixture, type OfferFixture } from "./offer-matching.ts";
import type { ApiFixture } from "./types.ts";
import { isAnalyzableStatus, zonedDate } from "./util.ts";

/** Spielraum um den frühesten und spätesten Anstoß, damit der Abgleich ±3 Stunden findet. */
const MARGIN_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Wie weit neben einem nicht zugeordneten Angebotsspiel die Tageslisten von API-Football nachgeladen werden, um einen
 * Platzhaltertermin außerhalb des Zeitraums zu finden (ein Aufruf je Tag, 6 Stunden im Cache). Die Zuordnung selbst
 * erlaubt ±4 Tage; gesehen wurde bisher ein Tag (Serie B am 11.11.2026, Olympiakos – Panathinaikos am 05.10.2026).
 */
const PLACEHOLDER_DAYS = 2;

export interface OfferReport {
  /** `oddspapi`: echte Angebotsliste; `tipico-ligen`: Näherung, `note` sagt warum. */
  source: "oddspapi" | "tipico-ligen";
  bookmakers: string[];
  /** Je Seite: angeboten (direkt plus über die Liga) und davon direkt zugeordnet. */
  perBookmaker: Array<{ bookmaker: string; offered: number; direct: number }>;
  /** Bei mindestens einer Seite angeboten - diese Spiele werden analysiert. */
  offered: number;
  /** Dazu: angeboten, aber bei API-Football ohne Quote (seit 10.11.2026 ohne Quote analysiert). */
  withoutOdds: number;
  dropped: number;
  /** Angeboten, aber API-Football kennt das Spiel gar nicht (nur gezählt, die Liste steht versteckt im Snapshot). */
  unknown: number;
  /** Bei API-Football auf einem Platzhaltertermin; der Anstoß kommt von Betano bzw. Tipico. */
  rescheduled: number;
  oddsPapiRequests: number;
  quota: OddsPapiQuota | null;
  note?: string;
}

/** Ein angebotenes Spiel, das API-Football nicht kennt (seit 10.11.2026, Davids Wunsch: „versteckt auflisten“). */
export interface UnknownOffer {
  home: string;
  away: string;
  kickoff: string;
  tournament: string;
  sites: string[];
}

export interface OfferContext {
  days: string[];
  /** Liegt ein Anstoß im Umfang der Analyse? Für die Liste der unbekannten Spiele. */
  inScope?: (kickoff: number) => boolean;
  /**
   * Früheste Anstoßzeit, die noch zählt (laufende Spiele, 200 Minuten). Davor fragt der Filter keinen Block ab:
   * Kurz nach Mitternacht lag der Tagesbeginn im Block des Vortags, der ohne Quoten leer ist und trotzdem einen
   * Aufruf kostet (11.11.2026).
   */
  earliest?: number;
}

export interface OfferSelection {
  filter: (events: ApiOddsEvent[], context?: OfferContext) => Promise<(event: ApiOddsEvent) => boolean>;
  /** Nach `filter`: angebotene Spiele ohne Quote bei API-Football, als Ereignis ohne Quoten (`odds: {}`). */
  extras: () => ApiOddsEvent[];
  /** Nach `filter` gefüllt. */
  report: () => OfferReport | null;
  /**
   * Nach `filter`: je Fixture-ID die Seiten, die das Spiel anbieten (für den Umschalter der Apps,
   * seit 10.11.2026). `null` bei der Näherung über die Tipico-Ligen - dann weiß niemand, wo.
   */
  offeredBy: () => Map<number, string[]> | null;
  /**
   * Nach `filter`: Fixture-ID → Anstoß von Betano bzw. Tipico, wo API-Football das Spiel auf einem Platzhaltertermin
   * führt (zugeordnet nur über einen verschobenen Termin, mehr als 3 Stunden daneben). Der Buchmacher bietet auf den
   * echten Termin an - wie früher beim Tipico-Weg (`requestedFixtureScope`).
   */
  kickoffs: () => Map<number, number>;
  /** Nach `filter`: angebotene Spiele, die API-Football gar nicht kennt. */
  unknown: () => UnknownOffer[];
}

export function offerSelection(options: {
  client: ApiFootballClient;
  tipicoLeagueIds: () => Set<number>;
  corrections: OfferLeagueCorrections;
  /** Tageslisten frisch laden (die Analyse); prepare-analysis liest sie aus dem Cache. */
  freshDaily?: boolean;
  /** Für Tests; sonst aus ODDSPAPI_KEY. `null` heißt: kein OddsPapi. */
  oddsPapi?: OddsPapiClient | null;
  bookmakers?: string[];
  timezone?: string;
}): OfferSelection {
  const bookmakers = options.bookmakers ?? config.offerBookmakers;
  const timezone = options.timezone ?? config.timezone;
  let report: OfferReport | null = null;
  let offeredBy: Map<number, string[]> | null = null;
  let extras: ApiOddsEvent[] = [];
  let kickoffs = new Map<number, number>();
  let unknown: UnknownOffer[] = [];

  const fallback = (note: string, requests = 0): ((event: ApiOddsEvent) => boolean) => {
    const allowLeague = germanOfferFilter(options.tipicoLeagueIds(), options.corrections);
    report = { source: "tipico-ligen", bookmakers, perBookmaker: [], offered: 0, withoutOdds: 0, dropped: 0, unknown: 0, rescheduled: 0, oddsPapiRequests: requests, quota: null, note };
    offeredBy = null;
    return (event) => allowLeague(event.leagueId);
  };

  const filter = async (events: ApiOddsEvent[], context?: OfferContext): Promise<(event: ApiOddsEvent) => boolean> => {
    extras = [];
    kickoffs = new Map();
    unknown = [];
    let oddsPapi: OddsPapiClient | null;
    try {
      oddsPapi = options.oddsPapi === undefined ? new OddsPapiClient() : options.oddsPapi;
    } catch (error) {
      return fallback(error instanceof Error ? error.message : String(error));
    }
    if (!oddsPapi) return fallback("OddsPapi abgeschaltet");
    const days = [...new Set([...events.map((event) => zonedDate(new Date(event.kickoff), timezone)), ...(context?.days ?? [])])].sort();
    if (days.length === 0) {
      report = { source: "oddspapi", bookmakers, perBookmaker: [], offered: 0, withoutOdds: 0, dropped: 0, unknown: 0, rescheduled: 0, oddsPapiRequests: 0, quota: null };
      offeredBy = new Map();
      return () => true;
    }
    try {
      // Teamnamen: Die Quotenliste von API-Football trägt keine, die Tagesliste schon. Sie liefert zugleich
      // die Spiele ohne Quote, die eine Seite trotzdem anbietet.
      const daily = new Map<number, ApiFixture>();
      for (const day of days) {
        for (const fixture of await options.client.getFixturesForDate(day, timezone, options.freshDaily ?? false)) daily.set(fixture.fixture.id, fixture);
      }
      const eventIds = new Set(events.map((event) => event.fixtureId));
      const asAf = (fixture: ApiFixture): AfFixture => ({
        fixtureId: fixture.fixture.id, leagueId: fixture.league.id, home: fixture.teams.home.name, away: fixture.teams.away.name,
        kickoff: fixture.fixture.timestamp * 1000
      });
      const withOdds: AfFixture[] = events.flatMap((event) => {
        const fixture = daily.get(event.fixtureId);
        return fixture ? [{ ...asAf(fixture), leagueId: event.leagueId, kickoff: Date.parse(event.kickoff) }] : [];
      });
      const candidates = [...daily.values()]
        .filter((fixture) => !eventIds.has(fixture.fixture.id) && isAnalyzableStatus(fixture.fixture.status.short));
      // Fenster der Angebotsliste: Spiele mit Quote ±3 Stunden (Abgleich), dazu die Berliner Tage des Umfangs
      // (Mitternacht Berlin = 22:00 oder 23:00 UTC; mit 22:00 und 22:59 UTC bleibt es in denselben Zwei-Tage-
      // Blöcken - ein Spielraum über Mitternacht UTC hinaus kostete je Seite einen Block mehr).
      const eventKickoffs = withOdds.map((fixture) => fixture.kickoff);
      const from = Math.max(
        Math.min(...eventKickoffs.map((kickoff) => kickoff - MARGIN_MS), Date.parse(`${days[0]}T00:00:00Z`) - 2 * 60 * 60 * 1000),
        (context?.earliest ?? Number.NEGATIVE_INFINITY) - MARGIN_MS
      );
      const to = Math.max(...eventKickoffs.map((kickoff) => kickoff + MARGIN_MS), Date.parse(`${days.at(-1)}T22:59:59Z`));
      // Je Seite eine eigene Liste: Die Antwort von OddsPapi sagt nicht, welche Seite ein Spiel führt.
      const offersBy: Array<[string, OfferFixture[]]> = [];
      for (const bookmaker of bookmakers) offersBy.push([bookmaker, await oddsPapi.offerFixtures(from, to, bookmaker)]);
      const include = new Set(options.corrections.include.map((entry) => entry.id));
      const exclude = new Set(options.corrections.exclude.map((entry) => entry.id));
      // Ein Spiel ohne Quote kommt nur über einen eigenen Treffer dazu - nie über die Liga, sonst zöge eine
      // angebotene Liga jedes Spiel der Tagesliste mit. Vorab nur Spiele, die zeitlich zu einem Angebot passen
      // können, damit der Abgleich nicht über tausende Spiele läuft.
      const offerTimes = offersBy.flatMap(([, offers]) => offers.map((offer) => offer.kickoff)).sort((a, b) => a - b);
      const near = (kickoff: number) => offerTimes.some((time) => Math.abs(time - kickoff) <= 24 * 60 * 60 * 1000);
      const candidateFixtures = candidates.map(asAf).filter((fixture) => near(fixture.kickoff));
      // Davids Korrekturliste gilt für jede Seite.
      const sites = new Map<number, string[]>();
      const extraSites = new Map<number, string[]>();
      const perBookmaker: OfferReport["perBookmaker"] = [];
      const matchedOffers = new Set<string>();
      const afKickoff = new Map([...withOdds, ...candidateFixtures].map((fixture) => [fixture.fixtureId, fixture.kickoff]));
      for (const [bookmaker, offers] of offersBy) {
        // Gemeinsam abgleichen: Ein Angebotsspiel gehört höchstens zu einem Fixture, mit oder ohne Quote.
        const decision = decideOffer([...withOdds, ...candidateFixtures], offers, { include, exclude });
        for (const [fixtureId, match] of decision.matched) {
          matchedOffers.add(match.offer.id);
          // Platzhaltertermin: nur über den verschobenen Termin zugeordnet - der Anstoß des Anbieters gilt.
          const gap = Math.abs(match.offer.kickoff - (afKickoff.get(fixtureId) ?? match.offer.kickoff));
          if (gap > MARGIN_MS && !kickoffs.has(fixtureId)) kickoffs.set(fixtureId, match.offer.kickoff);
        }
        // Spiele ohne Eintrag in der Tagesliste (kein Teamname): nur über Liga oder Korrekturliste.
        const offeredHere = (event: ApiOddsEvent): boolean => daily.has(event.fixtureId)
          ? decision.allowed.has(event.fixtureId)
          : !exclude.has(event.leagueId) && (include.has(event.leagueId) || decision.offeredLeagues.has(event.leagueId));
        let offered = 0;
        for (const event of events) {
          if (!offeredHere(event)) continue;
          offered += 1;
          sites.set(event.fixtureId, [...(sites.get(event.fixtureId) ?? []), bookmaker]);
        }
        for (const fixture of candidateFixtures) {
          if (!decision.matched.has(fixture.fixtureId) || exclude.has(fixture.leagueId)) continue;
          extraSites.set(fixture.fixtureId, [...(extraSites.get(fixture.fixtureId) ?? []), bookmaker]);
        }
        perBookmaker.push({ bookmaker, offered, direct: [...decision.matched.keys()].filter((id) => eventIds.has(id)).length });
      }
      // Angeboten, aber im Zeitraum keinem Spiel zugeordnet. Geprüft gegen die ganze Tagesliste, auch beendete
      // Spiele, damit nichts als unbekannt gilt, was API-Football nur anders führt.
      const allDaily = [...daily.values()].map(asAf);
      const inScope = context?.inScope ?? (() => true);
      const pending = new Map<string, { offer: OfferFixture; sites: string[] }>();
      for (const [bookmaker, offers] of offersBy) {
        for (const offer of offers) {
          if (matchedOffers.has(offer.id) || !inScope(offer.kickoff)) continue;
          const seen = pending.get(offer.id);
          if (seen) { seen.sites.push(bookmaker); continue; }
          if (offerKnown(offer, allDaily)) { matchedOffers.add(offer.id); continue; }
          pending.set(offer.id, { offer, sites: [bookmaker] });
        }
      }
      // Platzhaltertermin außerhalb des Zeitraums (seit 11.11.2026, Davids Entscheidung „Anstoß vom Anbieter“): die
      // Tageslisten daneben nachladen. Ein Treffer wird wie ein Spiel ohne Quote analysiert, mit dem Anstoß des Anbieters.
      const loaded = new Set(days);
      const nearDays = new Set<string>();
      for (const { offer } of pending.values()) {
        for (let shift = -PLACEHOLDER_DAYS; shift <= PLACEHOLDER_DAYS; shift += 1) {
          const day = zonedDate(new Date(offer.kickoff + shift * DAY_MS), timezone);
          if (!loaded.has(day)) nearDays.add(day);
        }
      }
      const nearby: ApiFixture[] = [];
      for (const day of [...nearDays].sort()) nearby.push(...await options.client.getFixturesForDate(day, timezone));
      const nearbyAf = nearby.filter((fixture) => !daily.has(fixture.fixture.id)).map(asAf);
      const placeable = nearbyAf.filter((fixture) => !exclude.has(fixture.leagueId)
        && isAnalyzableStatus(nearby.find((item) => item.fixture.id === fixture.fixtureId)!.fixture.status.short));
      // Angeboten, aber API-Football kennt das Spiel nicht (El Salvador Liga de Ascenso am 10.11.2026): nicht
      // analysierbar - ohne Ansetzung gibt es weder Teams noch Historie.
      const byOffer: UnknownOffer[] = [];
      for (const { offer, sites: offerSites } of pending.values()) {
        const shifted = findShiftedFixture(offer, placeable);
        if (shifted && !extraSites.has(shifted.fixtureId)) {
          daily.set(shifted.fixtureId, nearby.find((item) => item.fixture.id === shifted.fixtureId)!);
          extraSites.set(shifted.fixtureId, offerSites);
          kickoffs.set(shifted.fixtureId, offer.kickoff);
          continue;
        }
        if (offerKnown(offer, nearbyAf)) continue;
        byOffer.push({
          home: offer.home, away: offer.away, kickoff: new Date(offer.kickoff).toISOString(),
          tournament: offer.tournament, sites: offerSites
        });
      }
      unknown = byOffer.sort((left, right) => left.kickoff.localeCompare(right.kickoff));
      extras = [...extraSites.keys()].map((fixtureId): ApiOddsEvent => {
        const fixture = daily.get(fixtureId)!;
        return {
          fixtureId, leagueId: fixture.league.id, country: fixture.league.country, league: fixture.league.name,
          season: fixture.league.season, kickoff: new Date(fixture.fixture.timestamp * 1000).toISOString(),
          bookmakerId: 0, bookmaker: "", updatedAt: null, odds: {}
        };
      });
      // Gezählt wird, was im Zeitraum liegt - am Anstoß des Anbieters, wo er gilt.
      const kickoffOf = (event: ApiOddsEvent) => kickoffs.get(event.fixtureId) ?? Date.parse(event.kickoff);
      // Mitgezählt statt neu gefragt; nur wenn alles aus dem Cache kam, einmal nachsehen.
      const quota = oddsPapi.currentQuota() ?? await oddsPapi.quota().catch(() => null);
      report = {
        source: "oddspapi",
        bookmakers,
        perBookmaker,
        offered: sites.size,
        withoutOdds: extras.filter((event) => inScope(kickoffOf(event))).length,
        dropped: events.length - sites.size,
        unknown: unknown.length,
        rescheduled: [...kickoffs.values()].filter(inScope).length,
        oddsPapiRequests: oddsPapi.requestCount,
        quota
      };
      offeredBy = new Map([...sites, ...extraSites]);
      return (event) => sites.has(event.fixtureId);
    } catch (error) {
      return fallback(error instanceof Error ? error.message : String(error), oddsPapi.requestCount);
    }
  };

  return { filter, extras: () => extras, report: () => report, offeredBy: () => offeredBy, kickoffs: () => kickoffs, unknown: () => unknown };
}

/** Eine Zeile für die Ausgabe der Analyse. */
export function offerReportLine(report: OfferReport | null): string | null {
  if (!report) return null;
  const sites = report.bookmakers.join(", ");
  if (report.source === "tipico-ligen") {
    return `Angebot: Näherung über die Tipico-Ligen - Liste von ${sites} (OddsPapi) nicht verfügbar: ${report.note ?? "unbekannt"}`;
  }
  const quota = report.quota ? ` · Stand ${report.quota.requestCount} von ${report.quota.requestLimit}` : "";
  const each = report.perBookmaker.map((entry) => `${entry.bookmaker} ${entry.offered} (${entry.direct} zugeordnet)`).join(", ");
  return `Angebot (OddsPapi): ${each} · zusammen ${report.offered}, ${report.dropped} bei keiner Seite`
    + (report.withoutOdds ? ` · dazu ${report.withoutOdds} angeboten ohne Quote bei API-Football` : "")
    + (report.rescheduled ? ` · ${report.rescheduled} mit Anstoß vom Anbieter (Platzhaltertermin bei API-Football)` : "")
    + (report.unknown ? ` · ${report.unknown} angeboten, aber API-Football unbekannt` : "")
    + ` · ${report.oddsPapiRequests} OddsPapi-Aufrufe${quota}`;
}
