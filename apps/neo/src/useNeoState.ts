import { useCallback, useEffect, useState } from "react";
import type { PerfRange, Venue } from "./components/H2HPanel";
import { DEFAULT_OFFER_SITE, isOfferSite, type OfferSite } from "../../shared/src/offer";
import { AUTHOR_FILTERS, type AuthorFilter, type DayScope, type TipMarket, type TipOrder } from "./neoData";

export type NeoView = "fixtures" | "teams" | "preds";

/** Bedienzustand wie in der Referenz; Auswahl und Filter bleiben über das Neuladen erhalten. */
export interface NeoState {
  view: NeoView;
  scope: DayScope | null;
  calMonth: string | null;
  /** Abgewählte Wettbewerbe (Land|Liga der API) - neue Wettbewerbe einer späteren Analyse sind so von selbst gewählt. */
  deselected: string[];
  closedCountries: string[];
  fixture: number | null;
  team: string | null;
  tip: string | null;
  fxOrder: "kickoff" | "league";
  teamsByLeague: boolean;
  split: number;
  /** Predictions je Tag nach Chance oder nach Anstoß. */
  tipOrder: TipOrder;
  /** Predictions: Tipps des Modells oder der Autoren (Daves Filter). */
  tipSource: "model" | "authors";
  /** Die gewählten Daves-Filter unter „Autoren“. */
  authorFilters: AuthorFilter[];
  pmarkets: TipMarket[];
  pmin: number;
  pmax: number;
  /** Torlinie der Marktchancen (Gesamttore und Über/Unter). */
  ou: number;
  /** „Weitere Märkte“ aufgeklappt. */
  moreOpen: boolean;
  /** Detailansicht bei „Spiele“: Marktchancen oder H2H. */
  fxSide: "markets" | "h2h";
  /** H2H: alle Duelle oder nur die im Stadion des Heimteams. */
  h2hVenue: Venue;
  perfRange: PerfRange;
  /** Torphasen der Saison: Heimteam nur zu Hause, Gast nur auswärts. */
  phSplit: boolean;
  /** Nur Spiele, die diese deutsche Seite anbietet (Betano | Tipico, seit 10.11.2026). */
  offerSite: OfferSite;
}

export const SPLIT = { min: 0.25, max: 0.65, def: 0.4 };
const STORAGE_KEY = "neo:state:v1";

const DEFAULTS: NeoState = {
  view: "fixtures", scope: null, calMonth: null, deselected: [], closedCountries: [], fixture: null, team: null, tip: null,
  fxOrder: "kickoff", teamsByLeague: false, split: SPLIT.def, tipOrder: "chance", tipSource: "model", authorFilters: [...AUTHOR_FILTERS], pmarkets: ["1x2", "ou", "btts"], pmin: 0, pmax: 100, ou: 2.5, moreOpen: false,
  fxSide: "markets", h2hVenue: "all", perfRange: "10", phSplit: true, offerSite: DEFAULT_OFFER_SITE,
};

function load(): NeoState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const stored = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NeoState>) };
    return isOfferSite(stored.offerSite) ? stored : { ...stored, offerSite: DEFAULT_OFFER_SITE };
  } catch {
    return DEFAULTS;
  }
}

export function useNeoState(): [NeoState, (patch: Partial<NeoState> | ((s: NeoState) => Partial<NeoState>)) => void] {
  const [state, setState] = useState<NeoState>(load);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ohne Speicher gilt die Auswahl nur bis zum Neuladen */ }
  }, [state]);
  const update = useCallback((patch: Partial<NeoState> | ((s: NeoState) => Partial<NeoState>)) =>
    setState((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) })), []);
  return [state, update];
}
