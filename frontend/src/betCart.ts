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

export function canGenerate(pool: CartEntry[], sizes: ComboSizeConfig[], withRepetition: boolean): boolean {
  const active = sizes.filter((item) => item.count > 0 && item.size >= 2);
  if (active.length === 0) return false;
  if (withRepetition) return active.every((item) => item.size <= pool.length);
  return requestedTotal(active) <= pool.length;
}

export function combinedOdds(entries: CartEntry[]): number | null {
  if (entries.length === 0 || entries.some((entry) => entry.odds === null)) return null;
  return entries.reduce((product, entry) => product * (entry.odds ?? 1), 1);
}

function comboId(size: number, index: number): string {
  return `${size}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateCombos(pool: CartEntry[], sizes: ComboSizeConfig[], withRepetition: boolean): Combo[] {
  if (!canGenerate(pool, sizes, withRepetition)) return [];
  const active = sizes.filter((item) => item.count > 0 && item.size >= 2);

  if (withRepetition) {
    const combos = active.flatMap(({ size, count }) => Array.from({ length: count }, (_, index) => {
      const entries = shuffle(pool).slice(0, size);
      return { id: comboId(size, index), entries, combinedOdds: combinedOdds(entries) };
    }));
    return shuffle(combos);
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
