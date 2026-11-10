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
import { decideOffer, type AfFixture, type OfferFixture } from "./offer-matching.ts";
import { zonedDate } from "./util.ts";

/** Spielraum um den frühesten und spätesten Anstoß, damit der Abgleich ±3 Stunden findet. */
const MARGIN_MS = 3 * 60 * 60 * 1000;

export interface OfferReport {
  /** `oddspapi`: echte Angebotsliste; `tipico-ligen`: Näherung, `note` sagt warum. */
  source: "oddspapi" | "tipico-ligen";
  bookmakers: string[];
  /** Je Seite: angeboten (direkt plus über die Liga) und davon direkt zugeordnet. */
  perBookmaker: Array<{ bookmaker: string; offered: number; direct: number }>;
  /** Bei mindestens einer Seite angeboten - diese Spiele werden analysiert. */
  offered: number;
  dropped: number;
  oddsPapiRequests: number;
  quota: OddsPapiQuota | null;
  note?: string;
}

export interface OfferSelection {
  filter: (events: ApiOddsEvent[]) => Promise<(event: ApiOddsEvent) => boolean>;
  /** Nach `filter` gefüllt. */
  report: () => OfferReport | null;
  /**
   * Nach `filter`: je Fixture-ID die Seiten, die das Spiel anbieten (für den Umschalter der Apps,
   * seit 10.11.2026). `null` bei der Näherung über die Tipico-Ligen - dann weiß niemand, wo.
   */
  offeredBy: () => Map<number, string[]> | null;
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

  const fallback = (note: string, requests = 0): ((event: ApiOddsEvent) => boolean) => {
    const allowLeague = germanOfferFilter(options.tipicoLeagueIds(), options.corrections);
    report = { source: "tipico-ligen", bookmakers, perBookmaker: [], offered: 0, dropped: 0, oddsPapiRequests: requests, quota: null, note };
    offeredBy = null;
    return (event) => allowLeague(event.leagueId);
  };

  const filter = async (events: ApiOddsEvent[]): Promise<(event: ApiOddsEvent) => boolean> => {
    let oddsPapi: OddsPapiClient | null;
    try {
      oddsPapi = options.oddsPapi === undefined ? new OddsPapiClient() : options.oddsPapi;
    } catch (error) {
      return fallback(error instanceof Error ? error.message : String(error));
    }
    if (!oddsPapi) return fallback("OddsPapi abgeschaltet");
    if (events.length === 0) {
      report = { source: "oddspapi", bookmakers, perBookmaker: [], offered: 0, dropped: 0, oddsPapiRequests: 0, quota: null };
      offeredBy = new Map();
      return () => true;
    }
    try {
      // Teamnamen: Die Quotenliste von API-Football trägt keine, die Tagesliste schon.
      const names = new Map<number, { home: string; away: string }>();
      const days = [...new Set(events.map((event) => zonedDate(new Date(event.kickoff), timezone)))].sort();
      for (const day of days) {
        for (const fixture of await options.client.getFixturesForDate(day, timezone, options.freshDaily ?? false)) {
          names.set(fixture.fixture.id, { home: fixture.teams.home.name, away: fixture.teams.away.name });
        }
      }
      const kickoffs = events.map((event) => Date.parse(event.kickoff));
      const from = Math.min(...kickoffs) - MARGIN_MS;
      const to = Math.max(...kickoffs) + MARGIN_MS;
      // Je Seite eine eigene Liste: Die Antwort von OddsPapi sagt nicht, welche Seite ein Spiel führt.
      const offersBy: Array<[string, OfferFixture[]]> = [];
      for (const bookmaker of bookmakers) offersBy.push([bookmaker, await oddsPapi.offerFixtures(from, to, bookmaker)]);
      const fixtures: AfFixture[] = events.flatMap((event) => {
        const teams = names.get(event.fixtureId);
        return teams ? [{ fixtureId: event.fixtureId, leagueId: event.leagueId, home: teams.home, away: teams.away, kickoff: Date.parse(event.kickoff) }] : [];
      });
      const include = new Set(options.corrections.include.map((entry) => entry.id));
      const exclude = new Set(options.corrections.exclude.map((entry) => entry.id));
      // Davids Korrekturliste gilt für jede Seite.
      const sites = new Map<number, string[]>();
      const perBookmaker: OfferReport["perBookmaker"] = [];
      for (const [bookmaker, offers] of offersBy) {
        const decision = decideOffer(fixtures, offers, { include, exclude });
        // Spiele ohne Eintrag in der Tagesliste (kein Teamname): nur über Liga oder Korrekturliste.
        const offeredHere = (event: ApiOddsEvent): boolean => names.has(event.fixtureId)
          ? decision.allowed.has(event.fixtureId)
          : !exclude.has(event.leagueId) && (include.has(event.leagueId) || decision.offeredLeagues.has(event.leagueId));
        let offered = 0;
        for (const event of events) {
          if (!offeredHere(event)) continue;
          offered += 1;
          sites.set(event.fixtureId, [...(sites.get(event.fixtureId) ?? []), bookmaker]);
        }
        perBookmaker.push({ bookmaker, offered, direct: decision.matched.size });
      }
      const quota = await oddsPapi.quota().catch(() => null);
      report = {
        source: "oddspapi",
        bookmakers,
        perBookmaker,
        offered: sites.size,
        dropped: events.length - sites.size,
        oddsPapiRequests: oddsPapi.requestCount,
        quota
      };
      offeredBy = sites;
      return (event) => sites.has(event.fixtureId);
    } catch (error) {
      return fallback(error instanceof Error ? error.message : String(error), oddsPapi.requestCount);
    }
  };

  return { filter, report: () => report, offeredBy: () => offeredBy };
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
    + ` · ${report.oddsPapiRequests} OddsPapi-Aufrufe${quota}`;
}
