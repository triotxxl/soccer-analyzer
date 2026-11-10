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
  direct: number;
  viaLeague: number;
  dropped: number;
  oddsPapiRequests: number;
  quota: OddsPapiQuota | null;
  note?: string;
}

export interface OfferSelection {
  filter: (events: ApiOddsEvent[]) => Promise<(event: ApiOddsEvent) => boolean>;
  /** Nach `filter` gefüllt. */
  report: () => OfferReport | null;
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

  const fallback = (note: string, requests = 0): ((event: ApiOddsEvent) => boolean) => {
    const allowLeague = germanOfferFilter(options.tipicoLeagueIds(), options.corrections);
    report = { source: "tipico-ligen", bookmakers, direct: 0, viaLeague: 0, dropped: 0, oddsPapiRequests: requests, quota: null, note };
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
      report = { source: "oddspapi", bookmakers, direct: 0, viaLeague: 0, dropped: 0, oddsPapiRequests: 0, quota: null };
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
      const offers: OfferFixture[] = [];
      for (const bookmaker of bookmakers) {
        // Mehrere Seiten: Die Kennung trägt die Seite, damit gleiche Spiele beider Listen nicht kollidieren.
        for (const offer of await oddsPapi.offerFixtures(from, to, bookmaker)) offers.push({ ...offer, id: `${bookmaker}:${offer.id}` });
      }
      const fixtures: AfFixture[] = events.flatMap((event) => {
        const teams = names.get(event.fixtureId);
        return teams ? [{ fixtureId: event.fixtureId, leagueId: event.leagueId, home: teams.home, away: teams.away, kickoff: Date.parse(event.kickoff) }] : [];
      });
      const include = new Set(options.corrections.include.map((entry) => entry.id));
      const exclude = new Set(options.corrections.exclude.map((entry) => entry.id));
      const decision = decideOffer(fixtures, offers, { include, exclude });
      // Spiele ohne Eintrag in der Tagesliste (kein Teamname): nur über Liga oder Korrekturliste.
      const allowedOf = (event: ApiOddsEvent): boolean => {
        if (names.has(event.fixtureId)) return decision.allowed.has(event.fixtureId);
        return !exclude.has(event.leagueId) && (include.has(event.leagueId) || decision.offeredLeagues.has(event.leagueId));
      };
      const allowed = events.filter(allowedOf).length;
      const quota = await oddsPapi.quota().catch(() => null);
      report = {
        source: "oddspapi",
        bookmakers,
        direct: decision.matched.size,
        viaLeague: allowed - decision.matched.size,
        dropped: events.length - allowed,
        oddsPapiRequests: oddsPapi.requestCount,
        quota
      };
      return allowedOf;
    } catch (error) {
      return fallback(error instanceof Error ? error.message : String(error), oddsPapi.requestCount);
    }
  };

  return { filter, report: () => report };
}

/** Eine Zeile für die Ausgabe der Analyse. */
export function offerReportLine(report: OfferReport | null): string | null {
  if (!report) return null;
  const sites = report.bookmakers.join(", ");
  if (report.source === "tipico-ligen") {
    return `Angebot: Näherung über die Tipico-Ligen - Liste von ${sites} (OddsPapi) nicht verfügbar: ${report.note ?? "unbekannt"}`;
  }
  const quota = report.quota ? ` · Stand ${report.quota.requestCount} von ${report.quota.requestLimit}` : "";
  return `Angebot ${sites} (OddsPapi): ${report.direct} Spiele zugeordnet, ${report.viaLeague} über ihre Liga,`
    + ` ${report.dropped} nicht im Angebot · ${report.oddsPapiRequests} OddsPapi-Aufrufe${quota}`;
}
