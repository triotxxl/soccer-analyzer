import { useCallback, useEffect, useState } from "react";
import type { DayScope, TipMarket } from "./neoData";

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
  pmarkets: TipMarket[];
  pmin: number;
  pmax: number;
  /** Torlinie der Marktchancen (Gesamttore und Über/Unter). */
  ou: number;
  /** „Weitere Märkte“ aufgeklappt. */
  moreOpen: boolean;
}

export const SPLIT = { min: 0.25, max: 0.65, def: 0.4 };
const STORAGE_KEY = "neo:state:v1";

const DEFAULTS: NeoState = {
  view: "fixtures", scope: null, calMonth: null, deselected: [], closedCountries: [], fixture: null, team: null, tip: null,
  fxOrder: "kickoff", teamsByLeague: false, split: SPLIT.def, pmarkets: ["1x2", "ou", "btts"], pmin: 0, pmax: 100, ou: 2.5, moreOpen: false,
};

function load(): NeoState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NeoState>) } : DEFAULTS;
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
