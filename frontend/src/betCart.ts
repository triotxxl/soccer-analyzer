import { useCallback, useEffect, useState } from "react";
import type { DashboardFixture, DashboardMarket, DashboardMarketKey, RecommendationLevel } from "./types";

const STORAGE_KEY = "football-analyzer:bet-cart";

export interface CartEntry {
  id: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  kickoff: string;
  marketKey: DashboardMarketKey;
  marketLabel: string;
  selection: string;
  pick: "1" | "2" | null;
  selectionTone: DashboardMarket["selectionTone"];
  odds: number | null;
  probability: number;
  recommendationLevel: RecommendationLevel;
  addedAt: number;
}

export interface ComboSizeConfig {
  size: number;
  count: number;
}

/**
 * Wie der Baukasten mit einem Warenkorb umgeht, der nicht glatt aufgeht.
 *
 * `einmalig`: Jede Wette wird höchstens einmal vergeben. Reicht der Warenkorb nicht für
 * alle angeforderten Plätze, entsteht gar keine Kombi.
 *
 * `auffuellen`: Die Wetten werden der Reihe nach vergeben, jede zuerst einmal. Erst wenn
 * der Warenkorb durch ist, wird von vorn aufgefüllt - die letzte Kombi, die sonst
 * unvollständig bliebe, bekommt also schon verwendete Wetten dazu. **Innerhalb einer Kombi
 * bleibt jede Wette einmalig**; dieselbe Wette zweimal im selben Schein wäre keine Kombi.
 */
export type ComboFillMode = "einmalig" | "auffuellen";

export interface Combo {
  id: string;
  entries: CartEntry[];
  combinedOdds: number | null;
}

export function cartEntryId(fixtureId: number, marketKey: DashboardMarketKey): string {
  return `${fixtureId}:${marketKey}`;
}

export function toCartEntry(fixture: DashboardFixture, market: DashboardMarket): CartEntry {
  return {
    id: cartEntryId(fixture.fixtureId, market.key),
    fixtureId: fixture.fixtureId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    league: fixture.league,
    country: fixture.country,
    kickoff: fixture.kickoff,
    marketKey: market.key,
    marketLabel: market.label,
    selection: market.selection,
    pick: market.pick,
    selectionTone: market.selectionTone,
    odds: market.odds,
    probability: market.probability,
    recommendationLevel: market.recommendation.level,
    addedAt: Date.now()
  };
}

/**
 * Ein Wettschein-Eintrag für die Seite, die der Quickpicker stützt. Nötig, weil die
 * Voreinstellung „Underdog" auch die Seite stützen kann, die das Modell **nicht** tippt -
 * `toCartEntry` würde dort den Gegner eintragen.
 *
 * Die Marktkennung bleibt `1x2`, damit `cartEntryId` weiterhin höchstens eine 1X2-Wette je
 * Partie zulässt: Ein Außenseiter ersetzt einen zuvor gelegten Modelltipp derselben Partie,
 * statt beide Seiten gleichzeitig im Schein zu haben.
 */
export function toQuickpickCartEntry(
  fixture: DashboardFixture,
  side: "1" | "2",
  odds: number | null,
  probability: number | null
): CartEntry {
  const team = side === "1" ? fixture.homeTeam : fixture.awayTeam;
  return {
    id: cartEntryId(fixture.fixtureId, "1x2"),
    fixtureId: fixture.fixtureId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    league: fixture.league,
    country: fixture.country,
    kickoff: fixture.kickoff,
    marketKey: "1x2",
    marketLabel: "1X2",
    selection: side === "1" ? `Heimsieg ${team}` : `Auswärtssieg ${team}`,
    pick: side,
    selectionTone: side === "1" ? "home" : "away",
    odds,
    probability: probability ?? 0,
    recommendationLevel: "none",
    addedAt: Date.now()
  };
}

function isCartEntry(value: unknown): value is CartEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CartEntry>;
  return typeof candidate.id === "string" && typeof candidate.fixtureId === "number" && typeof candidate.marketKey === "string";
}

function loadCart(): CartEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCartEntry) : [];
  } catch {
    return [];
  }
}

function saveCart(entries: CartEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable (private mode, quota) - cart just stays in-memory for this session.
  }
}

export function useBetCart() {
  const [cart, setCart] = useState<CartEntry[]>(() => loadCart());

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  const addEntry = useCallback((entry: CartEntry) => {
    setCart((current) => current.some((item) => item.id === entry.id) ? current : [...current, entry]);
  }, []);

  const removeEntry = useCallback((id: string) => {
    setCart((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => setCart([]), []);

  return { cart, addEntry, removeEntry, clear };
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

export function sizeRange(poolLength: number): number[] {
  if (poolLength < 2) return [];
  return Array.from({ length: poolLength - 1 }, (_, index) => index + 2);
}

export function requestedTotal(sizes: ComboSizeConfig[]): number {
  return sizes.filter((item) => item.count > 0 && item.size >= 2).reduce((sum, item) => sum + item.size * item.count, 0);
}

export function canGenerate(pool: CartEntry[], sizes: ComboSizeConfig[], mode: ComboFillMode): boolean {
  const active = sizes.filter((item) => item.count > 0 && item.size >= 2);
  if (active.length === 0) return false;
  // Beim Auffüllen muss der Warenkorb nur eine einzelne Kombi mit lauter verschiedenen
  // Wetten tragen können - die Plätze darüber hinaus kommen aus der Wiederverwendung.
  if (mode === "auffuellen") return active.every((item) => item.size <= pool.length);
  return requestedTotal(active) <= pool.length;
}

export function combinedOdds(entries: CartEntry[]): number | null {
  if (entries.length === 0 || entries.some((entry) => entry.odds === null)) return null;
  return entries.reduce((product, entry) => product * (entry.odds ?? 1), 1);
}

function comboId(size: number, index: number): string {
  return `${size}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateCombos(pool: CartEntry[], sizes: ComboSizeConfig[], mode: ComboFillMode): Combo[] {
  if (!canGenerate(pool, sizes, mode)) return [];
  const active = sizes.filter((item) => item.count > 0 && item.size >= 2);

  if (mode === "auffuellen") {
    const flatSizes = shuffle(active.flatMap(({ size, count }) => Array.from({ length: count }, () => size)));
    const combos: Combo[] = [];
    // Der Vorrat ist der noch nicht vergebene Rest des Warenkorbs. Er wird erst neu
    // befüllt, wenn er leer ist - dadurch kommt jede Wette an die Reihe, bevor sich eine
    // wiederholt. Genau das unterscheidet das Auffüllen vom früheren freien Ziehen.
    let vorrat = shuffle(pool);
    for (const size of flatSizes) {
      const entries: CartEntry[] = [];
      // Wetten, die in DIESE Kombi nicht passen, weil sie schon drin sind. Sie gehen
      // nicht verloren, sondern stehen der nächsten Kombi wieder vorn zur Verfügung.
      const zurueckgelegt: CartEntry[] = [];
      while (entries.length < size) {
        if (vorrat.length === 0) vorrat = shuffle(pool);
        const naechste = vorrat.shift()!;
        if (entries.some((taken) => taken.id === naechste.id)) zurueckgelegt.push(naechste);
        else entries.push(naechste);
      }
      // Die Schleife endet immer: `canGenerate` verlangt `size <= pool.length`, ein
      // frisch befüllter Vorrat enthält also stets eine Wette, die noch nicht in dieser
      // Kombi steckt.
      vorrat = [...zurueckgelegt, ...vorrat];
      combos.push({ id: comboId(size, combos.length), entries, combinedOdds: combinedOdds(entries) });
    }
    return combos;
  }

  const flatSizes = shuffle(active.flatMap(({ size, count }) => Array.from({ length: count }, () => size)));
  const shuffledPool = shuffle(pool);
  const combos: Combo[] = [];
  let cursor = 0;
  for (const size of flatSizes) {
    const entries = shuffledPool.slice(cursor, cursor + size);
    cursor += size;
    combos.push({ id: comboId(size, combos.length), entries, combinedOdds: combinedOdds(entries) });
  }
  return combos;
}
