import { useCallback, useEffect, useRef, useState } from "react";
import { decideMarket, marketsExcludeEachOther } from "../../src/market-outcome.ts";
import { teamName, type NameSource } from "./names";
import type { DashboardFixture, DashboardMarket, DashboardMarketKey, RecommendationLevel } from "./types";

const STORAGE_KEY = "football-analyzer:bet-cart";
const SETUP_STORAGE_KEY = "football-analyzer:combo-setup";

export interface CartEntry {
  id: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  /**
   * Die Tipico-Namen beim Hineinlegen (seit 11.10.2026), nur für die Anzeige. Die Felder oben und
   * `selection` bleiben bei API-Football - `sameTip` und `marketsExcludeEachOther` vergleichen
   * sie. Ältere Einträge tragen das Feld nicht und zeigen die Namen von API-Football.
   */
  tipico?: DashboardFixture["tipico"];
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
 * Wie „Kombis mischen“ mit einem Wettschein umgeht, der nicht glatt aufgeht.
 *
 * `einmalig`: Jeder Tipp wird höchstens einmal vergeben. Reicht der Wettschein nicht für
 * alle angeforderten Plätze, entsteht gar keine Kombi.
 *
 * `auffuellen`: Die Tipps werden der Reihe nach vergeben, jeder zuerst einmal. Erst wenn
 * der Wettschein durch ist, wird von vorn aufgefüllt - die letzte Kombi, die sonst
 * unvollständig bliebe, bekommt also schon verwendete Tipps dazu.
 *
 * In beiden Modi gilt: **je Kombi höchstens ein Tipp pro Spiel** (seit 11.10.2026). Zwei Tipps
 * aus einem Spiel hängen zusammen - ihre Quoten zu multiplizieren gäbe einen falschen
 * Kombi-Preis, und schließen sie einander aus, verliert die Kombi sicher.
 */
export type ComboFillMode = "einmalig" | "auffuellen";

export interface Combo {
  id: string;
  entries: CartEntry[];
  combinedOdds: number | null;
  /** Von Hand als „zu Tipico übertragen“ markiert; solche Kombis überstehen ein Neumischen. */
  transferred: boolean;
}

export interface ComboSetup {
  counts: Record<number, number>;
  mode: ComboFillMode;
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
    ...(fixture.tipico ? { tipico: fixture.tipico } : {}),
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
    ...(fixture.tipico ? { tipico: fixture.tipico } : {}),
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

/**
 * Die 1X2-Seite gegen den Modelltipp für das „+“-Menü. Die Quote kommt nur aus dem Snapshot
 * (`oddsHome`/`oddsAway`, ab `schemaVersion: 5`); eine über den Buchmacherschnitt geschätzte
 * Quote (`counterOddsOf`) taugt nicht als Wettpreis und wird hier bewusst nicht genommen.
 * Die Wahrscheinlichkeit ist `1 − p(1X2) − p(Remis)`, aber nur, wenn der 1X2-Markt belastbar ist.
 */
export function toCounterCartEntry(fixture: DashboardFixture, market: DashboardMarket): CartEntry | null {
  if (market.key !== "1x2" || market.pick === null) return null;
  const side = market.pick === "1" ? "2" : "1";
  const stored = side === "1" ? market.oddsHome : market.oddsAway;
  const odds = typeof stored === "number" && stored > 1 ? stored : null;
  const draw = fixture.markets.find((entry) => entry.key === "draw");
  const probability = market.probabilityReliable !== false && draw
    ? Math.max(0, 1 - market.probability - draw.probability)
    : null;
  return toQuickpickCartEntry(fixture, side, odds, probability);
}

/**
 * Mischbar ist ein Tipp vor dem Anpfiff und mit Quote. Nach dem Anpfiff stammt die Quote von
 * vorher und gilt nicht mehr (wie bei Kelly und im Quickpicker); ohne Quote gibt es keinen Preis.
 */
export function isPlayable(entry: CartEntry, now: number): boolean {
  return Date.parse(entry.kickoff) > now && entry.odds !== null;
}

/**
 * Der Tipp in Worten. Beim 1X2 mit der Mannschaft - „1X2 · Heimsieg“ verriet beim Übertragen zu
 * Tipico nicht, wer gemeint ist. Die Seite kommt aus `pick`, weil ältere Einträge die Mannschaft
 * nicht in `selection` tragen. Der Name folgt der Einstellung; `selection` bleibt unberührt.
 */
export function selectionLabel(entry: CartEntry, names: NameSource): string {
  if (entry.marketKey === "1x2" && entry.pick !== null) {
    return entry.pick === "1" ? `Heimsieg ${teamName(entry, "home", names)}` : `Auswärtssieg ${teamName(entry, "away", names)}`;
  }
  return `${entry.marketLabel} · ${entry.selection}`;
}

/** Kurzform für Rückmeldungen („Heimsieg Alpha FC ersetzt Remis“). */
export function shortTipLabel(entry: CartEntry, names: NameSource): string {
  return entry.marketKey === "1x2" ? selectionLabel(entry, names) : entry.marketLabel;
}

/** Ein beliebiger Ausgang mit Pausenstand - nur um zu prüfen, ob `decideMarket` die Auswahl kennt. */
const PROBE = { homeGoals: 1, awayGoals: 0, halftimeHomeGoals: 0, halftimeAwayGoals: 0 };

/**
 * Schließen zwei Tipps desselben Spiels einander aus? Nur für Auswahlen, die `decideMarket`
 * entscheiden kann: Eine unbekannte Auswahl gewinnt dort nie, und `marketsExcludeEachOther`
 * hielte sie deshalb für unvereinbar mit allem - sie verdrängte dann jeden Tipp des Spiels.
 */
function excludes(left: CartEntry, right: CartEntry): boolean {
  if (left.fixtureId !== right.fixtureId) return false;
  if (decideMarket(left.marketKey, left.selection, PROBE) === null) return false;
  if (decideMarket(right.marketKey, right.selection, PROBE) === null) return false;
  return marketsExcludeEachOther(left, right);
}

export interface PutResult {
  added: CartEntry[];
  /** Je hineingelegtem Tipp die Tipps, die er verdrängt hat. */
  replaced: Array<{ by: CartEntry; old: CartEntry[] }>;
  unchanged: CartEntry[];
}

function sameTip(left: CartEntry, right: CartEntry): boolean {
  return left.id === right.id && left.pick === right.pick && left.selection === right.selection;
}

/**
 * Legt Tipps in den Wettschein (Davids Entscheidung vom 11.10.2026): Gegensätze desselben Spiels
 * ersetzen einander - Remis ersetzt Heimsieg, Unter 2,5 ersetzt Über 2,5 -, wie schon immer die
 * zwei 1X2-Seiten mit ihrer gemeinsamen Kennung. Dieselbe Regel wie bei Kelly: nie auf beide
 * Seiten setzen. Verträgliche Tipps (Heimsieg und Über 2,5) bleiben nebeneinander.
 */
export function putEntriesInto(cart: CartEntry[], entries: CartEntry[]): { cart: CartEntry[]; result: PutResult } {
  let next = [...cart];
  const result: PutResult = { added: [], replaced: [], unchanged: [] };
  for (const entry of entries) {
    if (next.some((item) => sameTip(item, entry))) {
      result.unchanged.push(entry);
      continue;
    }
    const old = next.filter((item) => item.id === entry.id || excludes(entry, item));
    const slot = next.findIndex((item) => item.id === entry.id);
    next = next.filter((item) => !old.includes(item));
    if (slot >= 0) next.splice(Math.min(slot, next.length), 0, entry);
    else next.push(entry);
    if (old.length > 0) result.replaced.push({ by: entry, old });
    else result.added.push(entry);
  }
  return { cart: next, result };
}

/** Was „Rückgängig“ zurückholt: der Wettschein vor der letzten Sammeländerung. */
export interface CartChange {
  id: number;
  kind: "clear" | "started" | "add";
  before: CartEntry[];
  /** Wie viele Tipps die Änderung betraf. */
  count: number;
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

let changeCounter = 0;

/**
 * Der Wettschein selbst. Gespeichert werden nur die Tipps. Die letzte Sammeländerung (Leeren,
 * Angepfiffene entfernen, Hinzufügen aus dem Quickpicker) lässt sich einmal zurücknehmen -
 * statt einer Rückfrage vorher. Jede andere Änderung verwirft dieses Gedächtnis, damit
 * „Rückgängig“ nie einen Stand zurückholt, der danach von Hand geändert wurde.
 */
export function useBetCart() {
  const [cart, setCart] = useState<CartEntry[]>(() => loadCart());
  const [lastChange, setLastChange] = useState<CartChange | null>(null);
  // Die Aufrufer brauchen das Ergebnis sofort (Rückmeldung im Menü und im Quickpicker);
  // über die Referenz rechnet jeder Aufruf auf dem neuesten Stand, auch zwei im selben Takt.
  const cartRef = useRef(cart);
  const changeRef = useRef<CartChange | null>(null);

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  const commit = useCallback((next: CartEntry[], change: Omit<CartChange, "id" | "before"> | null) => {
    const before = cartRef.current;
    cartRef.current = next;
    changeRef.current = change ? { ...change, id: ++changeCounter, before } : null;
    setCart(next);
    setLastChange(changeRef.current);
  }, []);

  /** Ein Tipp aus dem „+“-Menü; gibt die verdrängten Tipps zurück. */
  const putEntry = useCallback((entry: CartEntry): CartEntry[] => {
    const { cart: next, result } = putEntriesInto(cartRef.current, [entry]);
    if (result.unchanged.length === 0) commit(next, null);
    return result.replaced[0]?.old ?? [];
  }, [commit]);

  /** Viele Tipps auf einmal (Quickpicker); lässt sich zurücknehmen, wenn sich etwas änderte. */
  const putEntries = useCallback((entries: CartEntry[]): { result: PutResult; changeId: number | null } => {
    const { cart: next, result } = putEntriesInto(cartRef.current, entries);
    const changed = result.added.length + result.replaced.length;
    if (changed === 0) return { result, changeId: null };
    commit(next, { kind: "add", count: changed });
    return { result, changeId: changeCounter };
  }, [commit]);

  const removeEntry = useCallback((id: string) => {
    commit(cartRef.current.filter((item) => item.id !== id), null);
  }, [commit]);

  const removeStarted = useCallback((now: number) => {
    const keep = cartRef.current.filter((item) => Date.parse(item.kickoff) > now);
    const count = cartRef.current.length - keep.length;
    if (count > 0) commit(keep, { kind: "started", count });
  }, [commit]);

  const clear = useCallback(() => {
    const count = cartRef.current.length;
    if (count > 0) commit([], { kind: "clear", count });
  }, [commit]);

  const undo = useCallback(() => {
    const change = changeRef.current;
    if (!change) return;
    commit(change.before, null);
  }, [commit]);

  return { cart, lastChange, putEntry, putEntries, removeEntry, removeStarted, clear, undo };
}

function loadComboSetup(): ComboSetup {
  const fallback: ComboSetup = { counts: {}, mode: "einmalig" };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SETUP_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ComboSetup>;
    const counts: Record<number, number> = {};
    for (const [size, count] of Object.entries(parsed.counts ?? {})) {
      const value = Math.floor(Number(count));
      if (Number(size) >= 2 && value > 0) counts[Number(size)] = value;
    }
    return { counts, mode: parsed.mode === "auffuellen" ? "auffuellen" : "einmalig" };
  } catch {
    return fallback;
  }
}

/**
 * Größen und Modus der Kombis werden gemerkt, die Kombis selbst nicht: Sie blenden nichts aus,
 * und ohne Gedächtnis stellt man bei jeder Analyse dieselben „3 Fünfer“ von Hand ein.
 */
export function useComboSetup() {
  const [setup, setSetup] = useState<ComboSetup>(loadComboSetup);
  useEffect(() => {
    try {
      window.localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(setup));
    } catch {
      // Ohne Speicher gilt die Einstellung nur bis zum Neuladen.
    }
  }, [setup]);
  return [setup, setSetup] as const;
}

/** Ein Abdruck des Wettscheins: Weicht er nach dem Mischen ab, sind die Kombis nicht mehr aktuell. */
export function cartKey(cart: CartEntry[]): string {
  return cart.map((entry) => `${entry.id}:${entry.pick ?? ""}:${entry.odds ?? ""}`).sort().join("|");
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

export function fixtureCount(pool: CartEntry[]): number {
  return new Set(pool.map((entry) => entry.fixtureId)).size;
}

function activeSizes(sizes: ComboSizeConfig[]): ComboSizeConfig[] {
  return sizes.filter((item) => item.count > 0 && item.size >= 2);
}

/** Bei „Ohne Wiederholung“ stehen die Tipps übertragener Kombis nicht mehr zur Wahl. */
function poolFor(pool: CartEntry[], mode: ComboFillMode, keep: Combo[]): CartEntry[] {
  if (mode !== "einmalig" || keep.length === 0) return pool;
  const taken = new Set(keep.flatMap((combo) => combo.entries.map((entry) => entry.id)));
  return pool.filter((entry) => !taken.has(entry.id));
}

/**
 * Verteilt die Tipps ohne Wiederholung, je Kombi höchstens einer pro Spiel. Große Kombis zuerst,
 * und jede nimmt aus den Spielen mit den meisten übrigen Tipps - so bleiben für die
 * nächsten Kombis möglichst viele verschiedene Spiele übrig. Ohne Zufall (`random: false`)
 * beantwortet dieselbe Verteilung nur, ob es aufgeht.
 */
function distribute(pool: CartEntry[], flatSizes: number[], random: boolean): CartEntry[][] | null {
  const remaining = new Map<number, CartEntry[]>();
  for (const entry of random ? shuffle(pool) : pool) {
    remaining.set(entry.fixtureId, [...(remaining.get(entry.fixtureId) ?? []), entry]);
  }
  const result: CartEntry[][] = [];
  for (const size of [...flatSizes].sort((left, right) => right - left)) {
    const games = (random ? shuffle([...remaining.keys()]) : [...remaining.keys()])
      .filter((game) => remaining.get(game)!.length > 0)
      .sort((left, right) => remaining.get(right)!.length - remaining.get(left)!.length);
    if (games.length < size) return null;
    result.push(games.slice(0, size).map((game) => remaining.get(game)!.shift()!));
  }
  return result;
}

export function canGenerate(pool: CartEntry[], sizes: ComboSizeConfig[], mode: ComboFillMode, keep: Combo[] = []): boolean {
  const active = activeSizes(sizes);
  if (active.length === 0) return false;
  const usable = poolFor(pool, mode, keep);
  // Beim Auffüllen muss der Wettschein nur eine einzelne Kombi mit lauter verschiedenen
  // Spielen tragen können - die Plätze darüber hinaus kommen aus der Wiederverwendung.
  if (mode === "auffuellen") return active.every((item) => item.size <= fixtureCount(usable));
  if (requestedTotal(active) > usable.length) return false;
  return distribute(usable, active.flatMap(({ size, count }) => Array.from({ length: count }, () => size)), false) !== null;
}

export function combinedOdds(entries: CartEntry[]): number | null {
  if (entries.length === 0 || entries.some((entry) => entry.odds === null)) return null;
  return entries.reduce((product, entry) => product * (entry.odds ?? 1), 1);
}

function comboId(size: number, index: number): string {
  return `${size}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function toCombo(entries: CartEntry[], index: number): Combo {
  return { id: comboId(entries.length, index), entries, combinedOdds: combinedOdds(entries), transferred: false };
}

/**
 * Mischt neue Kombis. `keep` (übertragene Kombis) bleibt unverändert vorn stehen; nur der Rest
 * wird neu gebaut - sonst löschte ein neues Mischen, was schon bei Tipico eingetragen ist.
 */
export function generateCombos(pool: CartEntry[], sizes: ComboSizeConfig[], mode: ComboFillMode, keep: Combo[] = []): Combo[] {
  if (!canGenerate(pool, sizes, mode, keep)) return [];
  const active = activeSizes(sizes);
  const usable = poolFor(pool, mode, keep);
  const flatSizes = shuffle(active.flatMap(({ size, count }) => Array.from({ length: count }, () => size)));

  if (mode === "auffuellen") {
    const combos: Combo[] = [];
    // Der Vorrat ist der noch nicht vergebene Rest des Wettscheins. Er wird erst neu
    // befüllt, wenn er leer ist - dadurch kommt jeder Tipp an die Reihe, bevor sich einer
    // wiederholt. Genau das unterscheidet das Auffüllen vom früheren freien Ziehen.
    let vorrat = shuffle(usable);
    for (const size of flatSizes) {
      const entries: CartEntry[] = [];
      // Tipps, die in DIESE Kombi nicht passen, weil ihr Spiel schon drin ist. Sie gehen
      // nicht verloren, sondern stehen der nächsten Kombi wieder vorn zur Verfügung.
      const zurueckgelegt: CartEntry[] = [];
      while (entries.length < size) {
        if (vorrat.length === 0) vorrat = shuffle(usable);
        const naechste = vorrat.shift()!;
        if (entries.some((taken) => taken.fixtureId === naechste.fixtureId)) zurueckgelegt.push(naechste);
        else entries.push(naechste);
      }
      // Die Schleife endet immer: `canGenerate` verlangt `size <= Zahl der Spiele`, ein
      // frisch befüllter Vorrat enthält also stets einen Tipp aus einem Spiel, das noch nicht
      // in dieser Kombi steckt.
      vorrat = [...zurueckgelegt, ...vorrat];
      combos.push(toCombo(entries, keep.length + combos.length));
    }
    return [...keep, ...combos];
  }

  const groups = distribute(usable, flatSizes, true);
  if (!groups) return [];
  return [...keep, ...shuffle(groups).map((entries, index) => toCombo(entries, keep.length + index))];
}
