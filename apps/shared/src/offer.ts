import type { DashboardDocument, DashboardFixture } from "./types";

/**
 * Umschalter Betano | Tipico (Davids Wunsch vom 10.11.2026): Die Analyse holt die Angebotsliste beider
 * deutschen Seiten von OddsPapi und schreibt je Spiel `offeredBy` (schemaVersion 16). Die Apps zeigen
 * nur die Spiele der gewählten Seite. Die Quoten bleiben in beiden Fällen die des Anbieters bei
 * API-Football (`fixture.bookmaker`, Betano) - API-Football liefert für Tipico keine.
 */
export type OfferSite = "betano.de" | "tipico";

export const OFFER_SITES: ReadonlyArray<{ id: OfferSite; label: string }> = [
  { id: "betano.de", label: "Betano" },
  { id: "tipico", label: "Tipico" }
];

/** Ab Werk Betano: Dort setzt David seit 09.11.2026. */
export const DEFAULT_OFFER_SITE: OfferSite = "betano.de";

export const offerSiteLabel = (site: OfferSite): string =>
  OFFER_SITES.find((entry) => entry.id === site)?.label ?? site;

export const isOfferSite = (value: unknown): value is OfferSite =>
  OFFER_SITES.some((entry) => entry.id === value);

/**
 * Die Seiten, zwischen denen sich umschalten lässt, oder `null`, wenn der Snapshot es nicht weiß
 * (ältere Analyse, Tipico-Weg, Näherung über die Tipico-Ligen) - dann bleibt der Schalter weg.
 */
export function offerSitesOf(document: Pick<DashboardDocument, "meta">): OfferSite[] | null {
  const offer = document.meta.offer;
  if (!offer || offer.source !== "oddspapi") return null;
  const sites = OFFER_SITES.map((entry) => entry.id).filter((id) => offer.bookmakers.includes(id));
  return sites.length >= 2 ? sites : null;
}

/** Bietet die Seite das Spiel an? Ohne Angabe im Spiel: ja (nichts verstecken, was niemand prüfen konnte). */
export const offeredAt = (fixture: Pick<DashboardFixture, "offeredBy">, site: OfferSite): boolean =>
  !fixture.offeredBy || fixture.offeredBy.includes(site);

/** Spiele je Seite, für die Zähler am Schalter. */
export function offerCounts(fixtures: ReadonlyArray<Pick<DashboardFixture, "offeredBy">>, sites: ReadonlyArray<OfferSite>): Record<OfferSite, number> {
  const counts = { "betano.de": 0, tipico: 0 } as Record<OfferSite, number>;
  for (const site of sites) counts[site] = fixtures.filter((fixture) => offeredAt(fixture, site)).length;
  return counts;
}
