import {
  Binoculars, Crosshair, FlagPennant, RocketLaunch, Shield, ShieldCheck, WarningCircle, X
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BetBuilderDrawer, CartAddRadial, CartBadge } from "./BetCartUI";
import { toCartEntry, toQuickpickCartEntry, useBetCart } from "./betCart";
import { countryFlagCode } from "./countryFlags";
import { FixtureInsightPanels, InsightsNotice, useFixtureInsights } from "./FixtureInsights";
import { useDashboardData } from "./data";
import { heatmapMarkets } from "./heatmap";
import { HeatmapTable, type HeatmapSort } from "./HeatmapTable";
import { useLiveBoard } from "./liveData";
import { LiveView } from "./LiveView";
import { edgeOf, loadKellyAuto, loadKellySettings, loadKellyVisible, saveKellyAuto, saveKellySettings, saveKellyVisible, type KellySettings } from "./kelly";
import { KellyButton, KellyDialog } from "./KellyUI";
import { FilterButton, FilterChip, FilterMenu, FilterSegment, type ClassGapFilter, type FilterMenuActions, type FilterMenuValues, type LevelFilter, type SegmentOption } from "./FilterMenu";
import { MarketProfileView } from "./MarketProfileUI";
import { BrandMark, NavRail, type NavKey } from "./NavRail";
import { QuickpickButton, QuickpickChip, QuickpickDialog } from "./QuickpickUI";
import { applyQuickpick, loadQuickpickStore, saveQuickpickStore, settingsOf, withSettings, QUICKPICK_PRESETS, REJECTION_LABELS, presetOf, type QuickpickFilterReport, type QuickpickPresetId, type QuickpickRejection, type QuickpickStore } from "./quickpick";
import { TeamCrest } from "./TeamCrest";
import { useMarketProfile } from "./marketProfile";
import type { ClassGap, DashboardDocument, DashboardFixture, DashboardMarket, DashboardMarketKey, FormResult, LeagueStats, RecommendationLevel } from "./types";

const MARKET_OPTIONS: Array<{ key: "all" | DashboardMarketKey; label: string }> = [
  { key: "all", label: "Alle Märkte" },
  { key: "1x2", label: "1X2" },
  { key: "draw", label: "Remis" },
  { key: "btts", label: "BTTS" },
  { key: "bttsNo", label: "BTTS Nein" },
  { key: "over15", label: "Über 1,5" },
  { key: "under15", label: "Unter 1,5" },
  { key: "over25", label: "Über 2,5" },
  { key: "under25", label: "Unter 2,5" },
  { key: "over35", label: "Über 3,5" },
  { key: "under35", label: "Unter 3,5" },
  { key: "firstHalfOver05", label: "1. HZ Ü0,5" },
  { key: "firstHalfUnder05", label: "1. HZ U0,5" },
  { key: "firstHalfOver15", label: "1. HZ Ü1,5" },
  { key: "firstHalfUnder15", label: "1. HZ U1,5" }
];

/**
 * Märkte, die auf das Ausbleiben setzen. Für sie kehrt sich die Bedeutung der H2H- und
 * Form-Punkte um: Getroffen hat, wer unter der Linie geblieben ist. Ohne diese Umkehr zeigte
 * die Ansicht zu einem Unter-Markt die Über-Treffer - ein Fehler, der plausibel aussieht.
 */
const COUNTER_MARKETS: DashboardMarketKey[] = [
  "bttsNo", "under15", "under25", "under35", "firstHalfUnder05", "firstHalfUnder15"
];
type MarketFilter = (typeof MARKET_OPTIONS)[number]["key"];
type RangeMode = "next48" | "custom";
type H2hView = "outcome" | "btts" | "over" | "firstHalfOver";
type FormView = H2hView;
type FullTimeOverLine = 1.5 | 2.5 | 3.5;
type FirstHalfOverLine = 0.5 | 1.5;

const POINTS_VIEW_OPTIONS: ReadonlyArray<SegmentOption<H2hView>> = [
  { value: "outcome", label: "Ergebnis" },
  { value: "btts", label: "BTTS", title: "BTTS: beide Teams treffen" },
  { value: "over", label: "Tore" },
  { value: "firstHalfOver", label: "Tore 1. HZ", title: "Tore in der ersten Halbzeit" }
];
const FULL_TIME_LINE_OPTIONS: ReadonlyArray<SegmentOption<string>> = [
  { value: "1.5", label: "1,5" }, { value: "2.5", label: "2,5" }, { value: "3.5", label: "3,5" }
];
const FIRST_HALF_LINE_OPTIONS: ReadonlyArray<SegmentOption<string>> = [
  { value: "0.5", label: "0,5" }, { value: "1.5", label: "1,5" }
];
const DIRECTION_OPTIONS: ReadonlyArray<SegmentOption<"over" | "under">> = [
  { value: "over", label: "Über" }, { value: "under", label: "Unter" }
];
type SortKey = "kickoff" | "league" | "team" | "form" | "h2h" | "expected" | "score" | "market" | "shots" | "corners";

// Entspricht config.liveCandidateTrailMs: so lange nach dem Anpfiff kann eine Partie
// noch laufen. Nur innerhalb dieses Fensters bleiben angepfiffene Partien sichtbar.
const IN_PLAY_LOOKBACK_MS = 200 * 60 * 1000;

const levelRank: Record<RecommendationLevel, number> = { none: 0, recommended: 1, strong: 2 };
const formSortModes = ["draw", "home", "away"] as const;
const h2hSortTargets = ["draw", "loss", "win"] as const;
const formSortLabels: Record<(typeof formSortModes)[number], { badge: string; className: FormResult; label: string }> = {
  home: { badge: "H", className: "win", label: "Heimsiege" },
  away: { badge: "A", className: "loss", label: "Auswärtssiege" },
  draw: { badge: "U", className: "draw", label: "Unentschieden beider Teams" }
};
const h2hSortLabels: Record<FormResult, { badge: string; label: string }> = {
  win: { badge: "H", label: "Heimsiege" },
  draw: { badge: "U", label: "Unentschieden" },
  loss: { badge: "A", label: "Auswärtssiege" }
};
const resultLabels: Record<FormResult, { text: string; title: string }> = {
  win: { text: "S", title: "Sieg" },
  draw: { text: "U", title: "Unentschieden" },
  loss: { text: "N", title: "Niederlage" }
};

function berlinDate(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function clampDate(value: string, minimum: string, maximum: string): string {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function formatCalendarDate(value: string, options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" }): string {
  return new Intl.DateTimeFormat("de-DE", { ...options, timeZone: "UTC" }).format(dateOnly(value));
}

/**
 * Die Tage der Analyse, beginnend am ersten - nicht am Montag davor. Bei kurzen Analysen standen
 * sonst zwei Tage in zwei Wochenzeilen mit lauter Leere; jede Kachel trägt deshalb ihren
 * Wochentag selbst.
 */
function analysisDays(minimum: string, maximum: string): string[] {
  const days: string[] = [];
  for (const cursor = dateOnly(minimum); isoDate(cursor) <= maximum; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(isoDate(cursor));
  }
  return days;
}

/** "Di 29.09., 11:00" - das Ende von `next48` im Kartenkopf. */
function formatRangeEnd(value: number, timezone: string): string {
  const date = new Date(value);
  const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "short" }).format(date).replace(".", "");
  const day = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(date);
  const clock = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
  return `${weekday} ${day}, ${clock}`;
}

/**
 * Zeitraum ohne Kalender-Fenster: die Kachel "Nächste 48 Std." und eine Reihe Tageskacheln der
 * Analyse. Ein Klick wählt einen Tag, ein zweiter macht daraus einen Zeitraum - sofort wirksam,
 * ohne Übernehmen. `next48` bleibt strikt ab jetzt und ist kein Kalendertag.
 */
function DayRangePicker({ minimum, maximum, custom, start, end, selectingEnd, onNext48, onSelect }: {
  minimum: string | null;
  maximum: string | null;
  custom: boolean;
  start: string;
  end: string;
  /** Der erste Tag ist gewählt, der zweite Klick macht einen Zeitraum daraus. */
  selectingEnd: boolean;
  onNext48(): void;
  onSelect(value: string): void;
}) {
  return <div className="day-range" role="group" aria-label="Zeitraum">
    <button type="button" className={`quick-range${custom ? "" : " active"}`} aria-pressed={!custom}
      aria-label="Nächste 48 Std." title="Ab jetzt genau 48 Stunden – kein Kalendertag" onClick={onNext48}>
      <span>Nächste</span><span>48 Std.</span>
    </button>
    {minimum && maximum ? <div className="day-tiles">
      {analysisDays(minimum, maximum).map((date) => {
        const selected = custom && date >= start && date <= end;
        const dayOfMonth = Number(date.slice(-2));
        return <button type="button" key={date} className={`day-tile${selected ? " selected" : ""}`}
          aria-label={formatCalendarDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          aria-pressed={selected} onClick={() => onSelect(date)}>
          <span className="day-weekday">{formatCalendarDate(date, { weekday: "short" }).replace(".", "")}</span>
          {/* Am Monatsersten mit Monat, damit ein Zeitraum über den Wechsel lesbar bleibt. */}
          <span className="day-num">{dayOfMonth === 1 ? `1.${Number(date.slice(5, 7))}` : dayOfMonth}</span>
        </button>;
      })}
    </div> : <p className="filter-note">Keine Tage verfügbar.</p>}
    {/* Nur während der Wahl: Der erste Klick wählt schon einen Tag, und genau dann erklärt
        der Satz den zweiten. Ein Bedienhinweis in Ruhe stand bei jedem Öffnen unter der
        wichtigsten Stellschraube (UX-Review vom 28.09.2026). */}
    {minimum && maximum && custom && selectingEnd && <p className="filter-note day-range-hint">
      Noch den letzten Tag anklicken – sonst gilt nur dieser.
    </p>}
  </div>;
}

function leagueKey(country: string, league: string): string {
  return `${country}::${league}`;
}

export function CountryFlag({ country }: { country: string }) {
  const code = countryFlagCode(country);
  if (!code) return null;
  return <span className={`fi fi-${code} country-flag`} aria-hidden />;
}

type LeagueSortKey = "country" | "league" | "avgGoals" | "btts" | "over15" | "over25" | "homeWin" | "draw" | "awayWin" | "matches";

function leagueSortValue(
  item: { country: string; league: string },
  stats: LeagueStats | undefined,
  key: LeagueSortKey
): number | string | null {
  if (key === "country") return item.country;
  if (key === "league") return item.league;
  if (!stats) return null;
  if (key === "avgGoals") return stats.avgGoalsTotal;
  if (key === "btts") return stats.bttsRate;
  if (key === "over15") return stats.over15Rate;
  if (key === "over25") return stats.over25Rate;
  if (key === "homeWin") return typeof stats.homeWinRate === "number" ? stats.homeWinRate : null;
  if (key === "draw") return typeof stats.drawRate === "number" ? stats.drawRate : null;
  if (key === "awayWin") return typeof stats.awayWinRate === "number" ? stats.awayWinRate : null;
  return stats.matches;
}

function LeagueFilterModal({ leagues, statsByKey, deselected, search, onSearchChange, onToggle, onSelectAll, onSelectNone, onClose }: {
  leagues: Array<{ key: string; country: string; league: string; count: number }>;
  statsByKey: Map<string, LeagueStats>;
  deselected: Set<string>;
  search: string;
  onSearchChange(value: string): void;
  onToggle(key: string): void;
  onSelectAll(): void;
  onSelectNone(): void;
  onClose(): void;
}) {
  const [sortKey, setSortKey] = useState<LeagueSortKey>("country");
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);

  const query = search.trim().toLowerCase();
  const visible = query
    ? leagues.filter((item) => `${item.country} ${item.league}`.toLowerCase().includes(query))
    : leagues;
  const sorted = [...visible].sort((left, right) => {
    const leftValue = leagueSortValue(left, statsByKey.get(left.key), sortKey);
    const rightValue = leagueSortValue(right, statsByKey.get(right.key), sortKey);
    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const comparison = typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue.localeCompare(rightValue, "de")
      : (leftValue as number) - (rightValue as number);
    return comparison * sortDirection;
  });

  const sort = (key: LeagueSortKey) => {
    if (sortKey === key) { setSortDirection((value) => value === 1 ? -1 : 1); return; }
    setSortKey(key);
    setSortDirection(key === "country" || key === "league" ? 1 : -1);
  };
  const arrow = (key: LeagueSortKey) => sortKey === key ? (sortDirection === 1 ? "↑" : "↓") : "↕";

  const allSelected = deselected.size === 0;
  const noneSelected = leagues.length > 0 && deselected.size === leagues.length;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = !allSelected && !noneSelected;
  }, [allSelected, noneSelected]);

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="league-filter-modal" role="dialog" aria-label="Wettbewerbe auswählen" onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head">
        <strong>Wettbewerbe</strong>
        <button aria-label="Schließen" onClick={onClose}><X /></button>
      </div>
      <div className="league-modal-toolbar">
        <input className="league-search" type="text" placeholder="Wettbewerb suchen…" value={search}
          onChange={(event) => onSearchChange(event.target.value)} aria-label="Wettbewerb suchen" />
      </div>
      <div className="league-table-scroll">
        <table className="league-table">
          <thead>
            <tr>
              <th><input type="checkbox" ref={selectAllRef} checked={allSelected}
                onChange={() => allSelected ? onSelectNone() : onSelectAll()}
                aria-label={allSelected ? "Alle Wettbewerbe abwählen" : "Alle Wettbewerbe auswählen"} /></th>
              <th><button onClick={() => sort("country")} aria-label={sortStateLabel("Land", sortKey === "country", sortDirection)}>Land {arrow("country")}</button></th>
              <th><button onClick={() => sort("league")} aria-label={sortStateLabel("Wettbewerb", sortKey === "league", sortDirection)}>Wettbewerb {arrow("league")}</button></th>
              <th><button onClick={() => sort("avgGoals")} aria-label={sortStateLabel("Ø Tore", sortKey === "avgGoals", sortDirection)}>Ø Tore {arrow("avgGoals")}</button></th>
              <th><button onClick={() => sort("btts")} aria-label={sortStateLabel("BTTS", sortKey === "btts", sortDirection)}>BTTS {arrow("btts")}</button></th>
              <th><button onClick={() => sort("over15")} aria-label={sortStateLabel("Über 1,5", sortKey === "over15", sortDirection)}>Ü 1,5 {arrow("over15")}</button></th>
              <th><button onClick={() => sort("over25")} aria-label={sortStateLabel("Über 2,5", sortKey === "over25", sortDirection)}>Ü 2,5 {arrow("over25")}</button></th>
              <th><button onClick={() => sort("homeWin")} aria-label={sortStateLabel("Heimsieg-Quote", sortKey === "homeWin", sortDirection)}>1 {arrow("homeWin")}</button></th>
              <th><button onClick={() => sort("draw")} aria-label={sortStateLabel("Remis-Quote", sortKey === "draw", sortDirection)}>X {arrow("draw")}</button></th>
              <th><button onClick={() => sort("awayWin")} aria-label={sortStateLabel("Auswärtssieg-Quote", sortKey === "awayWin", sortDirection)}>2 {arrow("awayWin")}</button></th>
              <th><button onClick={() => sort("matches")} aria-label={sortStateLabel("Spiele", sortKey === "matches", sortDirection)}>Spiele {arrow("matches")}</button></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => {
              const stats = statsByKey.get(item.key);
              return <tr className={deselected.has(item.key) ? "off" : ""} key={item.key}>
                <td><input type="checkbox" checked={!deselected.has(item.key)} onChange={() => onToggle(item.key)} aria-label={`${item.country} · ${item.league}`} /></td>
                <td onClick={() => onToggle(item.key)}><CountryFlag country={item.country} /> {item.country}</td>
                <td onClick={() => onToggle(item.key)}>{item.league}</td>
                <td>{stats ? stats.avgGoalsTotal.toFixed(2).replace(".", ",") : "–"}</td>
                <td>{stats ? formatPercent(stats.bttsRate) : "–"}</td>
                <td>{stats ? formatPercent(stats.over15Rate) : "–"}</td>
                <td>{stats ? formatPercent(stats.over25Rate) : "–"}</td>
                <td>{typeof stats?.homeWinRate === "number" ? formatPercent(stats.homeWinRate) : "–"}</td>
                <td>{typeof stats?.drawRate === "number" ? formatPercent(stats.drawRate) : "–"}</td>
                <td>{typeof stats?.awayWinRate === "number" ? formatPercent(stats.awayWinRate) : "–"}</td>
                <td>{stats ? stats.matches : "–"}</td>
              </tr>;
            })}
            {sorted.length === 0 && <tr><td className="league-empty" colSpan={11}>Keine Treffer</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}

export function kickoffParts(value: string, timezone: string): { clock: string; day: string } {
  const date = new Date(value);
  return {
    clock: new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date),
    day: new Intl.DateTimeFormat("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(date)
  };
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

export function formatOdd(value: number | null): string {
  return value === null ? "–" : value.toFixed(2).replace(".", ",");
}

function formatDataTimestamp(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const BANNER_STORAGE_KEY = "football-analyzer:banner-dismissed";

function loadBannerDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BANNER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveBannerDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BANNER_STORAGE_KEY, "1");
  } catch {
    // Storage unavailable - dismissal just doesn't persist for this session.
  }
}

const VIEW_STORAGE_KEY = "football-analyzer:view";

export type AppView = "prematch" | "live" | "profile";

const VIEWS: AppView[] = ["prematch", "live", "profile"];

function loadView(): AppView {
  if (typeof window === "undefined") return "prematch";
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return VIEWS.find((view) => view === stored) ?? "prematch";
  } catch {
    return "prematch";
  }
}

function saveView(view: AppView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Storage unavailable - the choice just doesn't persist for this session.
  }
}

const LAYOUT_STORAGE_KEY = "football-analyzer:table-layout";

/** Die Darstellung der Pre-Match-Liste: die ausführliche Tabelle oder die kompakte Heatmap. */
export type TableLayout = "table" | "heatmap";

function loadLayout(): TableLayout {
  if (typeof window === "undefined") return "table";
  try {
    return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === "heatmap" ? "heatmap" : "table";
  } catch {
    return "table";
  }
}

function saveLayout(layout: TableLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Storage unavailable - the choice just doesn't persist for this session.
  }
}

const SORT_STORAGE_KEY = "football-analyzer:sort";

const SORT_KEYS: SortKey[] = ["kickoff", "league", "team", "form", "h2h", "expected", "score", "market", "shots", "corners"];

type StoredSort = { key: SortKey; direction: 1 | -1 };

/**
 * Die Sortierung überlebt ein Neuladen. Anders als der aktive Quickpick-Filter blendet sie
 * keine Zeile aus, eine gemerkte Wahl kann also nichts unbemerkt verstecken.
 */
function loadSort(): StoredSort {
  const fallback: StoredSort = { key: "kickoff", direction: 1 };
  if (typeof window === "undefined") return fallback;
  try {
    const stored = JSON.parse(window.localStorage.getItem(SORT_STORAGE_KEY) ?? "null") as Partial<StoredSort> | null;
    const key = SORT_KEYS.find((candidate) => candidate === stored?.key);
    if (!key) return fallback;
    return { key, direction: stored?.direction === -1 ? -1 : 1 };
  } catch {
    return fallback;
  }
}

function saveSort(sort: StoredSort): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // Storage unavailable - the choice just doesn't persist for this session.
  }
}

export function sortStateLabel(label: string, active: boolean, direction: 1 | -1): string {
  if (!active) return `${label}, nicht sortiert`;
  return `${label}, ${direction === 1 ? "aufsteigend" : "absteigend"} sortiert`;
}

function marketFor(fixture: DashboardFixture, key: DashboardMarketKey): DashboardMarket | undefined {
  return fixture.markets.find((item) => item.key === key);
}

function visibleMarkets(fixture: DashboardFixture, filter: MarketFilter): DashboardMarket[] {
  return filter === "all" ? fixture.markets : fixture.markets.filter((market) => market.key === filter);
}

function bestLevel(fixture: DashboardFixture, filter: MarketFilter): RecommendationLevel {
  return visibleMarkets(fixture, filter).reduce<RecommendationLevel>(
    (best, market) => levelRank[market.recommendation.level] > levelRank[best] ? market.recommendation.level : best,
    "none"
  );
}

function countResults(results: FormResult[], target: FormResult): number {
  return results.filter((result) => result === target).length;
}

function consecutiveResults(results: FormResult[], target: FormResult): number {
  const index = results.findIndex((result) => result !== target);
  return index === -1 ? results.length : index;
}

function outcomePriority(target: FormResult): FormResult[] {
  if (target === "win") return ["win", "draw", "loss"];
  if (target === "loss") return ["loss", "draw", "win"];
  return ["draw", "win", "loss"];
}

function compareOutcomeSequences(left: FormResult[], right: FormResult[], target: FormResult): number {
  const priority = outcomePriority(target);
  for (const result of priority) {
    const streakComparison = consecutiveResults(left, result) - consecutiveResults(right, result);
    if (streakComparison !== 0) return streakComparison;
    const countComparison = countResults(left, result) - countResults(right, result);
    if (countComparison !== 0) return countComparison;
  }
  const rank = new Map(priority.map((result, index) => [result, priority.length - index]));
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const positionComparison = (rank.get(left[index]!) ?? 0) - (rank.get(right[index]!) ?? 0);
    if (positionComparison !== 0) return positionComparison;
  }
  return left.length - right.length;
}

function consecutive(values: Array<boolean | null | undefined>): number {
  const index = values.findIndex((value) => value !== true);
  return index === -1 ? values.length : index;
}

function firstHalfOverResults(fixture: DashboardFixture, line: FirstHalfOverLine): Array<boolean | null> {
  return fixture.h2h.matches.map((match) => {
    if (typeof match.halfTimeHomeGoals !== "number" || typeof match.halfTimeAwayGoals !== "number") return null;
    return match.halfTimeHomeGoals + match.halfTimeAwayGoals > line;
  });
}

function FormDots({ results, h2h = false }: { results: FormResult[]; h2h?: boolean }) {
  const padded: Array<FormResult | null> = [...results.slice(0, 5)];
  while (padded.length < 5) padded.push(null);
  return <div className="dot-row">
    {padded.map((result, index) => result
      ? <span className={`result-dot ${result} ${index === 0 ? "latest" : ""}`} title={resultLabels[result].title} key={index}>{h2h ? ({ win: "H", draw: "U", loss: "A" } as const)[result] : resultLabels[result].text}</span>
      : <span className="result-dot missing" title="Keine Daten" key={index}>–</span>)}
  </div>;
}

/** Welche Kennzahl die beiden neuen Spalten zeigen. */
type RecentStatField = "shotsOnGoal" | "corners";

/**
 * Der Schnitt einer Seite, oder null, wenn keine der letzten Partien den Wert trug. Läufe vor
 * dieser Ergänzung führen das Feld gar nicht und landen ebenfalls bei null.
 */
function recentValue(
  fixture: DashboardFixture,
  side: "home" | "away",
  field: RecentStatField
): number | null {
  const stats = side === "home" ? fixture.form.homeStats : fixture.form.awayStats;
  return stats?.[field] ?? null;
}

/**
 * Sortiert wird über die Summe beider Seiten - eine Partie, in der beide Mannschaften viel
 * schießen, steht oben. Partien ganz ohne Zahlen rutschen ans Ende statt als 0 mitten hinein.
 */
function recentSortValue(fixture: DashboardFixture, field: RecentStatField): number {
  const home = recentValue(fixture, "home", field);
  const away = recentValue(fixture, "away", field);
  if (home === null && away === null) return -1;
  return (home ?? 0) + (away ?? 0);
}

/** Eine Zahl mit einer Nachkommastelle, Komma wie im Rest der Ansicht. */
function recentLabel(value: number | null): string {
  return value === null ? "–" : value.toFixed(1).replace(".", ",");
}

/**
 * Eine Zelle der beiden neuen Spalten: oben das Heim-, unten das Auswärtsteam, jeweils der
 * Schnitt der letzten fünf Partien. Ein Strich heißt "nicht überliefert" - viele kleinere
 * Ligen führen weder Schüsse noch Ecken.
 */
function RecentStatCell({ fixture, field, label }: {
  fixture: DashboardFixture;
  field: RecentStatField;
  label: string;
}) {
  const home = recentValue(fixture, "home", field);
  const away = recentValue(fixture, "away", field);
  const title = home === null && away === null
    ? `${label}: für diese Liga gibt es keine Zahlen`
    : `${label} im Schnitt der letzten fünf Spiele – ${fixture.homeTeam}: ${recentLabel(home)}, ${fixture.awayTeam}: ${recentLabel(away)}`;
  // Bewusst ohne aria-label: Die Zelle steht in einem Knopf, und ein Label am Kind wandert in
  // den Namen der ganzen Zeile. Die Bedeutung trägt die Spaltenüberschrift.
  return <span className="recent-stat-cell" title={title}>
    <strong className={home === null ? "missing" : ""}>{recentLabel(home)}</strong>
    <strong className={away === null ? "missing" : ""}>{recentLabel(away)}</strong>
  </span>;
}

/**
 * Das Team-Elo klein neben dem Namen. **Unverbindlich** - Davids Vorgabe vom 24.09.2026: Es geht
 * in keinen Tipp, keine Wahrscheinlichkeit und keinen Filter ein, es steht nur zur Einordnung da.
 * Unter 50 % Vertrauen wird es blasser, weil der Wert dann auf wenigen Spielen steht.
 * Bewusst ohne aria-label: Die Zeile ist ein Knopf, und ein Label am Kind wandert in dessen Namen.
 */
function EloTag({ value, team }: { value: DashboardFixture["homeElo"]; team: string }) {
  if (!value) return null;
  const elo = Math.round(value.elo);
  const confidence = Math.round(value.confidence);
  const stand = new Date(value.asOf).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return <small className={confidence < 50 ? "elo-tag unsicher" : "elo-tag"}
    title={`Elo ${elo} (${value.system === "national" ? "Nationalteams" : "Vereine"}): Stärkewert von ${team} aus den Spielen der letzten fünf Jahre.`
      + ` Vertrauen ${confidence} %, Stand ${stand}. Nur zur Einordnung – geht in keinen Tipp ein.`}>
    {elo}
  </small>;
}

function DefenseShield({ profile, team }: { profile: NonNullable<DashboardFixture["defense"]>["home"] | undefined; team: string }) {
  if (!profile?.strong) return null;
  const verified = profile.badge === "verified";
  const percentile = profile.percentile == null ? "Top 20 %"
    : `besser als ${Math.round(profile.percentile * 100)} % der Mannschaften`;
  const sample = `aus ${profile.matches} Spielen (${profile.venueMatches} davon zu Hause bzw. auswärts)`;
  const coverage = profile.xgCoverage === undefined ? ""
    : ` · xG-Werte liegen für ${Math.round(profile.xgCoverage * 100)} % der Spiele vor`;
  const metric = verified
    ? `xGA (erwartete Gegentore) ${profile.expectedGoalsAgainst?.toFixed(2).replace(".", ",") ?? "–"} · echte Gegentore ${profile.concededGoals.toFixed(2).replace(".", ",")}`
    : `Gegentore ${profile.concededGoals.toFixed(2).replace(".", ",")}`;
  const label = `${team}: starke Abwehr, ${verified ? "durch xG bestätigt" : "aus den kassierten Toren belegt"}`
    + ` · ${percentile} · ${metric} · ${sample}${coverage}`;
  return <span className={`defense-shield ${verified ? "verified" : "fallback"}`} role="img" aria-label={label} title={label}>
    {verified ? <ShieldCheck size={16} weight="fill" aria-hidden /> : <Shield size={16} weight="regular" aria-hidden />}
  </span>;
}

type MatchSummary = DashboardFixture["h2h"]["matches"][number];

function matchViewDots(
  matches: MatchSummary[],
  view: Exclude<H2hView, "outcome">,
  overLine: FullTimeOverLine,
  firstHalfOverLine: FirstHalfOverLine,
  /** Bei einem Gegenmarkt zählt das Ausbleiben als Treffer. */
  inverted = false
): Array<{ value: boolean | null; text: string; title: string }> {
  const values = view === "btts"
    ? matches.map((match) => {
      const both = match.homeGoals > 0 && match.awayGoals > 0;
      const value = inverted ? !both : both;
      return { value, text: both ? "✓" : "×", title: both ? "BTTS" : "Kein BTTS" };
    })
    // Über/Unter zeigt die Torzahl statt eines "Ü"/"U": Die Farbe des Punktes sagt schon,
    // ob die Linie gerissen wurde, der Buchstabe wiederholt das nur. Die Zahl beantwortet
    // stattdessen, wie deutlich - ein 5:2 und ein 2:1 sind beide "Ü", aber nicht dasselbe.
    : view === "firstHalfOver"
      ? matches.map((match) => {
        if (typeof match.halfTimeHomeGoals !== "number" || typeof match.halfTimeAwayGoals !== "number") {
          return { value: null, text: "–", title: "Kein Halbzeitstand verfügbar" };
        }
        const goals = match.halfTimeHomeGoals + match.halfTimeAwayGoals;
        const over = goals > firstHalfOverLine;
        const value = inverted ? !over : over;
        return {
          value,
          text: String(goals),
          title: `1. Halbzeit ${match.halfTimeHomeGoals}:${match.halfTimeAwayGoals} · ${goals} Tor${goals === 1 ? "" : "e"} · ${over ? "Über" : "Unter"} ${firstHalfOverLine.toLocaleString("de-DE")}`
        };
      })
      : matches.map((match) => {
        const goals = match.homeGoals + match.awayGoals;
        const over = goals > overLine;
        const value = inverted ? !over : over;
        return {
          value,
          text: String(goals),
          title: `Endstand ${match.homeGoals}:${match.awayGoals} · ${goals} Tor${goals === 1 ? "" : "e"} · ${over ? "Über" : "Unter"} ${overLine.toLocaleString("de-DE")}`
        };
      });
  while (values.length < 5) values.push({ value: null, text: "–", title: "Keine Daten" });
  return values.slice(0, 5);
}

function formMatchesStreak(
  matches: MatchSummary[] | undefined,
  view: Exclude<FormView, "outcome">,
  overLine: FullTimeOverLine,
  firstHalfOverLine: FirstHalfOverLine,
  inverted = false
): number {
  return consecutive(matchViewDots(matches ?? [], view, overLine, firstHalfOverLine, inverted).map((item) => item.value));
}

function columnComparison(
  key: "form" | "h2h",
  left: DashboardFixture,
  right: DashboardFixture,
  formView: FormView,
  h2hView: H2hView,
  formSortMode: number,
  h2hSortMode: number,
  overLine: FullTimeOverLine,
  firstHalfOverLine: FirstHalfOverLine,
  inverted: boolean
): number {
  if (key === "form") {
    if (formView === "outcome") {
      const mode = formSortModes[formSortMode]!;
      if (mode === "home") return countResults(left.form.home, "win") - countResults(right.form.home, "win");
      if (mode === "away") return countResults(left.form.away, "win") - countResults(right.form.away, "win");
      return countResults([...left.form.home, ...left.form.away], "draw") - countResults([...right.form.home, ...right.form.away], "draw");
    }
    const pairScore = (fixture: DashboardFixture) => {
      const homeStreak = formMatchesStreak(fixture.form.homeMatches, formView, overLine, firstHalfOverLine, inverted);
      const awayStreak = formMatchesStreak(fixture.form.awayMatches, formView, overLine, firstHalfOverLine, inverted);
      return { min: Math.min(homeStreak, awayStreak), sum: homeStreak + awayStreak };
    };
    const l = pairScore(left);
    const r = pairScore(right);
    return (l.min - r.min) || (l.sum - r.sum);
  }
  // Auch die Sortierung folgt der Richtung: Bei einem Unter-Markt steht oben, wer die längste
  // Serie unter der Linie hat.
  const flip = (values: Array<boolean | null>) => inverted
    ? values.map((value) => value === null ? null : !value)
    : values;
  if (h2hView === "btts") return consecutive(flip(left.h2h.btts)) - consecutive(flip(right.h2h.btts));
  if (h2hView === "over") {
    const streak = (fixture: DashboardFixture) => consecutive(flip(fixture.h2h.matches.map((match) => match.homeGoals + match.awayGoals > overLine)));
    return streak(left) - streak(right);
  }
  if (h2hView === "firstHalfOver") {
    const streak = (fixture: DashboardFixture) => consecutive(flip(firstHalfOverResults(fixture, firstHalfOverLine)));
    return streak(left) - streak(right);
  }
  const target = h2hSortTargets[h2hSortMode]!;
  return compareOutcomeSequences(left.h2h.outcomes, right.h2h.outcomes, target);
}

function ViewDots({ values }: { values: Array<{ value: boolean | null; text: string; title: string }> }) {
  return <div className="dot-row">
    {values.map((item, index) => <span className={`result-dot ${item.value === null ? "missing" : item.value ? "hit" : "miss"} ${index === 0 ? "latest" : ""}`} title={item.title} key={index}>{item.text}</span>)}
  </div>;
}

function H2hDots({ fixture, view, overLine, firstHalfOverLine, inverted }: {
  fixture: DashboardFixture;
  view: H2hView;
  overLine: FullTimeOverLine;
  firstHalfOverLine: FirstHalfOverLine;
  inverted: boolean;
}) {
  if (view === "outcome") return <FormDots results={fixture.h2h.outcomes} h2h />;
  return <ViewDots values={matchViewDots(fixture.h2h.matches, view, overLine, firstHalfOverLine, inverted)} />;
}

function FormMatchDots({ matches, view, overLine, firstHalfOverLine, inverted }: {
  matches: MatchSummary[] | undefined;
  view: Exclude<FormView, "outcome">;
  overLine: FullTimeOverLine;
  firstHalfOverLine: FirstHalfOverLine;
  inverted: boolean;
}) {
  return <ViewDots values={matchViewDots(matches ?? [], view, overLine, firstHalfOverLine, inverted)} />;
}

export function MarketCard({ market, showEdge }: { market: DashboardMarket; showEdge: boolean }) {
  const percentage = Math.round(market.probability * 100);
  const reliable = market.probabilityReliable !== false;
  const edge = showEdge ? edgeOf(market) : null;
  return <div
    className={`market-card ${market.recommendation.level}${reliable ? "" : " unreliable"}`}
    title={reliable
      ? `${market.selection} · ${market.recommendation.label}`
      : `${market.selection} · ohne Ligastärke-Vergleich keine belastbare Wahrscheinlichkeit`}
  >
    <div className="market-line">
      <span className="level-glyph">{market.recommendation.level === "strong" ? "★" : market.recommendation.level === "recommended" ? "✓" : "·"}</span>
      {market.pick && <strong className={`pick ${market.selectionTone}`}>{market.pick}</strong>}
      <strong className="odd">{formatOdd(market.odds)}</strong>
      {edge !== null && <span className={`market-edge ${edge >= 0 ? "pos" : "neg"}`} title="Value: um wie viel besser das Modell die Chance sieht, als die Quote es hergibt. Angegeben in Prozentpunkten.">{edge >= 0 ? "+" : ""}{(edge * 100).toFixed(1).replace(".", ",")} PP</span>}
    </div>
    {reliable
      ? <div className="probability-line">
        <span className="probability-track"><span style={{ width: `${percentage}%` }} /></span>
        <span>{formatPercent(market.probability)}</span>
      </div>
      : <div className="probability-line"><span className="probability-note">Ligastärke unbekannt</span></div>}
  </div>;
}

export function ClassGapBadge({ gap, homeTeam, awayTeam }: { gap: ClassGap; homeTeam: string; awayTeam: string }) {
  const stronger = gap.stronger === "home" ? homeTeam : awayTeam;
  const title = `${gap.level === "extreme" ? "Sehr großer" : "Deutlicher"} Klassenunterschied · ${stronger} ist die höhere Klasse · `
    + `${gap.source === "rating" ? "Modell" : "Markt"}: ${gap.label}`;
  return <i className={`class-gap ${gap.level} ${gap.source}`} title={title} aria-label={title}>
    Klasse {gap.stronger === "home" ? "↑" : "↓"}
  </i>;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state">
    <Binoculars size={32} weight="duotone" />
    <strong>{title}</strong>
    <span>{text}</span>
    {action}
  </div>;
}

/**
 * Nennt den häufigsten Abweisungsgrund. Ohne ihn sucht der Benutzer die leere Tabelle beim
 * Zeitraum, während in Wahrheit ein Regler zu eng steht.
 */
function quickpickReason(report: QuickpickFilterReport): string {
  const top = (Object.entries(report.rejected) as Array<[QuickpickRejection, number]>)
    .sort((left, right) => right[1] - left[1])[0];
  const scope = `Von ${report.evaluated} geprüften Spielen passt keines.`;
  if (!top || top[1] === 0) return `${scope} Öffne den Quickpicker und stelle den Filter lockerer.`;
  return `${scope} Häufigster Grund: ${REJECTION_LABELS[top[0]]} (${top[1]}×).`;
}

type StandingsRow = NonNullable<DashboardFixture["table"]>[number];

function standingsWindow(table: StandingsRow[], homeTeam: string, awayTeam: string, padding = 2): Array<StandingsRow | null> {
  const homeIndex = table.findIndex((row) => row.teamName === homeTeam);
  const awayIndex = table.findIndex((row) => row.teamName === awayTeam);
  if (homeIndex === -1 || awayIndex === -1) return table;
  const ranges = [
    [Math.max(0, homeIndex - padding), Math.min(table.length - 1, homeIndex + padding)],
    [Math.max(0, awayIndex - padding), Math.min(table.length - 1, awayIndex + padding)]
  ].sort((left, right) => left[0]! - right[0]!);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start! <= last[1] + 1) last[1] = Math.max(last[1], end!);
    else merged.push([start!, end!]);
  }
  if (merged[0]![0] > 0) merged.unshift([0, 0]);
  const rows: Array<StandingsRow | null> = [];
  merged.forEach(([start, end], index) => {
    if (index > 0 && start > merged[index - 1]![1] + 1) rows.push(null);
    for (let position = start; position <= end; position += 1) rows.push(table[position]!);
  });
  return rows;
}

function Dashboard({ document }: { document: DashboardDocument }) {
  const [view, setView] = useState<AppView>(loadView);
  const [layout, setLayout] = useState<TableLayout>(loadLayout);
  const navKey: NavKey = view === "prematch" ? layout : view;
  // Zeigt die H2H- und Form-Spalte auf das Ausbleiben statt auf das Eintreten.
  const [counterDirection, setCounterDirection] = useState(false);
  const [kellyAuto, setKellyAuto] = useState(loadKellyAuto);
  // Das Filtermenü liegt über dem Inhalt und verdrängt nichts. Im Marktprofil gibt es keins -
  // dort wirkt kein Filter, die Ansicht lädt ihre Daten selbst.
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterAnchorRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const [banner, setBanner] = useState(() => !loadBannerDismissed());
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [rangeMode, setRangeMode] = useState<RangeMode>("next48");
  const [customStart, setCustomStart] = useState(document.meta.firstAvailableDate ?? "");
  const [customEnd, setCustomEnd] = useState(document.meta.lastAvailableDate ?? "");
  // Wartet der nächste Tagesklick auf das Ende eines Zeitraums?
  const [selectingRangeEnd, setSelectingRangeEnd] = useState(false);
  const [showCrossLeague, setShowCrossLeague] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [deselectedLeagues, setDeselectedLeagues] = useState<Set<string>>(new Set());
  const [leagueFilterOpen, setLeagueFilterOpen] = useState(false);
  const [leagueSearch, setLeagueSearch] = useState("");
  const [h2hView, setH2hView] = useState<H2hView>("outcome");
  const [formView, setFormView] = useState<FormView>("outcome");
  const [overLine, setOverLine] = useState<FullTimeOverLine>(2.5);
  const [firstHalfOverLine, setFirstHalfOverLine] = useState<FirstHalfOverLine>(0.5);
  const [classGapFilter, setClassGapFilter] = useState<ClassGapFilter>("all");
  const [initialSort] = useState(loadSort);
  const [sortKey, setSortKey] = useState<SortKey>(initialSort.key);
  const [sortDirection, setSortDirection] = useState<1 | -1>(initialSort.direction);
  // Eine Spaltensortierung der Heatmap geht der Tabellenreihenfolge vor, bis die Sortierauswahl
  // sie zurücksetzt.
  const [heatmapSort, setHeatmapSort] = useState<HeatmapSort>(null);
  const [formSortMode, setFormSortMode] = useState(0);
  const [h2hSortMode, setH2hSortMode] = useState(0);
  const [secondarySortKey, setSecondarySortKey] = useState<"form" | "h2h" | null>(null);
  const [openFixture, setOpenFixture] = useState<number | null>(null);
  // Der Abruf hängt allein an der aufgeklappten Partie: zugeklappt kostet die Ansicht nichts.
  const insights = useFixtureInsights(openFixture);
  const [radialFixtureId, setRadialFixtureId] = useState<number | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [kellyOpen, setKellyOpen] = useState(false);
  const [showKelly, setShowKelly] = useState(() => loadKellyVisible());
  const [liveRatedOnly, setLiveRatedOnly] = useState(false);
  const [kellySettings, setKellySettings] = useState<KellySettings>(() => loadKellySettings());
  const [quickpickOpen, setQuickpickOpen] = useState(false);
  // Die Regler werden gespeichert, der aktive Zustand nicht: Ein Filter, der nach einem
  // Neuladen unbemerkt fast alle Zeilen ausblendet, wäre dieselbe Falle wie der geerbte
  // Einsatzrahmen der Kelly-Automatik, der wochenlang unentdeckt auf 100 % stand.
  const [quickpickActive, setQuickpickActive] = useState(false);
  // Beide Voreinstellungen behalten ihre eigenen Regler; gewechselt wird nur, welche aktiv ist.
  const [quickpickStore, setQuickpickStore] = useState<QuickpickStore>(loadQuickpickStore);
  const quickpickSettings = settingsOf(quickpickStore);
  const { cart, addEntry, removeEntry, clear: clearCart } = useBetCart();
  const watchedFixtureIds = useMemo(() => document.fixtures
    .filter((fixture) => !deselectedLeagues.has(leagueKey(fixture.country, fixture.league)))
    .filter((fixture) => !liveRatedOnly
      || fixture.markets.some((market) => market.recommendation.level !== "none"))
    .map((fixture) => fixture.fixtureId),
    [deselectedLeagues, document, liveRatedOnly]);
  const live = useLiveBoard(view === "live", watchedFixtureIds);
  const marketProfile = useMarketProfile(showKelly && view === "prematch");
  const now = Date.now();

  const availableLeagues = useMemo(() => {
    const map = new Map<string, { key: string; country: string; league: string; count: number }>();
    for (const fixture of document.fixtures) {
      const key = leagueKey(fixture.country, fixture.league);
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { key, country: fixture.country, league: fixture.league, count: 1 });
    }
    return [...map.values()].sort((left, right) =>
      left.country.localeCompare(right.country, "de") || left.league.localeCompare(right.league, "de"));
  }, [document]);

  const leagueStatsByKey = useMemo(() =>
    new Map((document.leagues ?? []).map((entry) => [leagueKey(entry.country, entry.league), entry])),
    [document]);

  const toggleLeague = (key: string) => setDeselectedLeagues((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const selectAllLeagues = () => setDeselectedLeagues(new Set());
  const selectNoneLeagues = () => setDeselectedLeagues(new Set(availableLeagues.map((item) => item.key)));

  const selectMarket = (market: MarketFilter) => {
    setMarketFilter(market);
    setOpenFixture(null);
    // Die Richtung gehört zum Markt: Wer "Unter 2,5" wählt, will in H2H und Form die Partien
    // hervorgehoben sehen, die unter der Linie geblieben sind.
    setCounterDirection(COUNTER_MARKETS.includes(market as DashboardMarketKey));

    const goalLine: Partial<Record<MarketFilter, FullTimeOverLine>> = {
      over15: 1.5, under15: 1.5, over25: 2.5, under25: 2.5, over35: 3.5, under35: 3.5
    };
    const halfLine: Partial<Record<MarketFilter, FirstHalfOverLine>> = {
      firstHalfOver05: 0.5, firstHalfUnder05: 0.5, firstHalfOver15: 1.5, firstHalfUnder15: 1.5
    };

    if (market === "btts" || market === "bttsNo") {
      setH2hView("btts");
      setFormView("btts");
    } else if (goalLine[market] !== undefined) {
      setH2hView("over");
      setFormView("over");
      setOverLine(goalLine[market]!);
    } else if (halfLine[market] !== undefined) {
      setH2hView("firstHalfOver");
      setFormView("firstHalfOver");
      setFirstHalfOverLine(halfLine[market]!);
    } else {
      setH2hView("outcome");
      setFormView("outcome");
    }
  };

  useEffect(() => {
    const minimum = document.meta.firstAvailableDate;
    const maximum = document.meta.lastAvailableDate;
    if (minimum && maximum) {
      setCustomStart((value) => clampDate(value || minimum, minimum, maximum));
      setCustomEnd((value) => clampDate(value || maximum, minimum, maximum));
    } else {
      setCustomStart("");
      setCustomEnd("");
      setRangeMode("next48");
    }
    // Ein halb gewählter Zeitraum aus dem alten Lauf soll den nächsten Klick nicht verlängern.
    setSelectingRangeEnd(false);
    setOpenFixture((value) => value !== null && document.fixtures.some((fixture) => fixture.fixtureId === value) ? value : null);
    setRadialFixtureId((value) => value !== null && document.fixtures.some((fixture) => fixture.fixtureId === value) ? value : null);
    setMarketFilter((value) => value === "all" || document.fixtures.some((fixture) => fixture.markets.some((market) => market.key === value)) ? value : "all");
    setDeselectedLeagues((prev) => new Set([...prev].filter((key) => availableLeagues.some((item) => item.key === key))));
  }, [availableLeagues, document]);

  // Schließt das Menü; auf Wunsch kehrt der Fokus zum Knopf zurück (Escape, ✕), statt im
  // verschwundenen Menü ins Leere zu fallen.
  const closeFilterMenu = (returnFocus: boolean) => {
    setFilterMenuOpen(false);
    if (returnFocus) filterButtonRef.current?.focus();
  };

  useEffect(() => {
    // Solange der Wettbewerbe-Dialog offen ist, gehört jeder Klick ihm - sonst schlösse ein
    // Häkchen dort das Menü dahinter.
    if (!filterMenuOpen || leagueFilterOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!filterAnchorRef.current?.contains(event.target as Node)) setFilterMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [filterMenuOpen, leagueFilterOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (radialFixtureId !== null) setRadialFixtureId(null);
      else if (builderOpen) setBuilderOpen(false);
      else if (kellyOpen) setKellyOpen(false);
      // Schließt nur das Panel und hebt den Filter nicht auf - das ist der Klick aufs ✕ im
      // Streifen, eine bewusste Handlung statt eines Nebeneffekts vom Wegklicken.
      else if (quickpickOpen) setQuickpickOpen(false);
      // Der Wettbewerbe-Dialog liegt über dem Menü - von oben nach unten.
      else if (leagueFilterOpen) setLeagueFilterOpen(false);
      else if (filterMenuOpen) closeFilterMenu(true);
      else if (openFixture !== null) setOpenFixture(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [builderOpen, filterMenuOpen, kellyOpen, leagueFilterOpen, openFixture, quickpickOpen, radialFixtureId]);

  const selectNav = (key: NavKey) => {
    if (key === "table" || key === "heatmap") {
      setView("prematch");
      setLayout(key);
    } else {
      setView(key);
    }
    setFilterMenuOpen(false);
  };

  useEffect(() => { saveView(view); }, [view]);
  useEffect(() => { saveLayout(layout); }, [layout]);
  useEffect(() => { saveSort({ key: sortKey, direction: sortDirection }); }, [sortKey, sortDirection]);
  useEffect(() => { saveKellySettings(kellySettings); }, [kellySettings]);
  useEffect(() => { saveQuickpickStore(quickpickStore); }, [quickpickStore]);
  useEffect(() => { saveKellyVisible(showKelly); }, [showKelly]);
  useEffect(() => { saveKellyAuto(kellyAuto); }, [kellyAuto]);

  // Ein Klick wählt einen Tag, der nächste macht daraus einen Zeitraum - sofort wirksam. Nach
  // "Nächste 48 Std." beginnt ein Klick immer neu, statt still an den alten Tag anzuschließen.
  const selectCalendarDate = (date: string) => {
    if (rangeMode !== "custom" || !selectingRangeEnd) {
      setCustomStart(date);
      setCustomEnd(date);
      setRangeMode("custom");
      setSelectingRangeEnd(true);
      return;
    }
    setCustomStart(date < customStart ? date : customStart);
    setCustomEnd(date < customStart ? customStart : date);
    setSelectingRangeEnd(false);
  };
  const selectNext48 = () => {
    setRangeMode("next48");
    setSelectingRangeEnd(false);
  };

  const inSelectedRange = (fixture: DashboardFixture): boolean => {
    const kickoff = Date.parse(fixture.kickoff);
    if (rangeMode === "next48") {
      const earliest = showPast ? now - IN_PLAY_LOOKBACK_MS : now;
      return kickoff >= earliest && kickoff <= now + 48 * 3_600_000;
    }
    if (!showPast && kickoff < now) return false;
    if (!customStart || !customEnd) return false;
    const localDate = berlinDate(fixture.kickoff, document.meta.timezone);
    return localDate >= customStart && localDate <= customEnd;
  };

  const scopedFixtures = document.fixtures.filter((fixture) =>
    inSelectedRange(fixture) &&
    (showCrossLeague || !fixture.crossLeague) &&
    !deselectedLeagues.has(leagueKey(fixture.country, fixture.league)));
  const counts = {
    all: scopedFixtures.length,
    strong: scopedFixtures.filter((fixture) => bestLevel(fixture, marketFilter) === "strong").length,
    recommended: scopedFixtures.filter((fixture) => levelRank[bestLevel(fixture, marketFilter)] >= levelRank.recommended).length
  };
  // Bewusst aus `scopedFixtures` gerechnet und erst in `filtered` angewandt: In
  // `scopedFixtures` hingen auch die KPI-Zahlen und die Kelly-Auswahl daran. Kelly ist eine
  // eigene Regel mit eigener Rückrechnung und darf von einem Tabellenfilter nicht
  // beschnitten werden.
  const quickpick = applyQuickpick(quickpickActive ? scopedFixtures : [], quickpickSettings);
  const quickpickLabel = presetOf(quickpickSettings).label;
  const filtered = scopedFixtures.filter((fixture) => {
    if (quickpickActive && !quickpick.passing.has(fixture.fixtureId)) return false;
    if (classGapFilter === "only" && !fixture.classGap) return false;
    if (classGapFilter === "hide" && fixture.classGap) return false;
    const level = bestLevel(fixture, marketFilter);
    return levelFilter === "all" || (levelFilter === "strong" ? level === "strong" : levelRank[level] >= levelRank.recommended);
  });

  const sortedFixtures = useMemo(() => [...filtered].sort((left, right) => {
    const selectedMarket = marketFilter === "all" ? "1x2" : marketFilter;
    let comparison = 0;
    if (sortKey === "kickoff") comparison = Date.parse(left.kickoff) - Date.parse(right.kickoff);
    else if (sortKey === "league") comparison = `${left.country} ${left.league}`.localeCompare(`${right.country} ${right.league}`, "de");
    else if (sortKey === "team") comparison = `${left.homeTeam} ${left.awayTeam}`.localeCompare(`${right.homeTeam} ${right.awayTeam}`, "de");
    else if (sortKey === "expected") {
      const firstHalf = marketFilter === "firstHalfOver05" || marketFilter === "firstHalfOver15";
      comparison = (firstHalf ? left.expectedFirstHalfGoals?.total ?? -1 : left.expectedGoals.total) -
        (firstHalf ? right.expectedFirstHalfGoals?.total ?? -1 : right.expectedGoals.total);
    }
    else if (sortKey === "shots") comparison = recentSortValue(left, "shotsOnGoal") - recentSortValue(right, "shotsOnGoal");
    else if (sortKey === "corners") comparison = recentSortValue(left, "corners") - recentSortValue(right, "corners");
    else if (sortKey === "score") comparison = (marketFilter === "draw" ? left.scores.draw ?? -1 : left.scores.favorite ?? -1) - (marketFilter === "draw" ? right.scores.draw ?? -1 : right.scores.favorite ?? -1);
    else if (sortKey === "market") comparison = (marketFor(left, selectedMarket)?.probability ?? -1) - (marketFor(right, selectedMarket)?.probability ?? -1);
    else if (sortKey === "form" || sortKey === "h2h") {
      comparison = columnComparison(sortKey, left, right, formView, h2hView, formSortMode, h2hSortMode, overLine, firstHalfOverLine, counterDirection);
      if (comparison === 0 && secondarySortKey) {
        comparison = columnComparison(secondarySortKey, left, right, formView, h2hView, formSortMode, h2hSortMode, overLine, firstHalfOverLine, counterDirection);
      }
    }
    return comparison * sortDirection || Date.parse(left.kickoff) - Date.parse(right.kickoff);
  }), [filtered, firstHalfOverLine, formSortMode, formView, h2hSortMode, h2hView, marketFilter, overLine, secondarySortKey, sortDirection, sortKey]);

  const cyclePairMode = (key: "form" | "h2h") => {
    if (key === "form") setFormSortMode((value) => (value + 1) % 3);
    else setH2hSortMode((value) => (value + 1) % 3);
  };

  const sort = (key: SortKey) => {
    if (key === "form" || key === "h2h") {
      const other: "form" | "h2h" = key === "form" ? "h2h" : "form";
      const isOutcome = key === "form" ? formView === "outcome" : h2hView === "outcome";

      if (sortKey === key) {
        if (isOutcome) {
          cyclePairMode(key);
          setSortDirection(-1);
          return;
        }
        setSortDirection((value) => value === 1 ? -1 : 1);
        return;
      }
      if (secondarySortKey === key) {
        setSecondarySortKey(other);
        setSortKey(key);
        return;
      }
      if (sortKey === other) {
        if (isOutcome) cyclePairMode(key);
        setSecondarySortKey(key);
        return;
      }
      setSecondarySortKey(null);
      if (isOutcome) cyclePairMode(key);
      setSortKey(key);
      setSortDirection(-1);
      return;
    }
    setSecondarySortKey(null);
    if (sortKey === key) setSortDirection((value) => value === 1 ? -1 : 1);
    else {
      setSortKey(key);
      setSortDirection(key === "kickoff" || key === "league" || key === "team" ? 1 : -1);
    }
  };
  // Die Auswahl über der Tabelle setzt dieselbe Sortierung wie ein erster Klick auf den
  // Spaltenkopf. Ein erneuter Klick dort würde bei Form und H2H die Zielgröße weiterschalten,
  // die Auswahl wählt dagegen nur die Spalte.
  const selectSort = (key: SortKey) => {
    setHeatmapSort(null);
    if (key === sortKey) return;
    if ((key === "form" || key === "h2h") && (key === "form" ? formView : h2hView) === "outcome") cyclePairMode(key);
    setSecondarySortKey(null);
    setSortKey(key);
    setSortDirection(key === "kickoff" || key === "league" || key === "team" ? 1 : -1);
  };
  const arrow = (key: SortKey) => sortKey === key ? (sortDirection === 1 ? "↑" : "↓") : "↕";
  const formSortModeKey = formSortModes[formSortMode]!;
  const formSortLabel = formSortLabels[formSortModeKey];
  const h2hSortTarget = h2hSortTargets[h2hSortMode]!;
  const h2hSortLabel = h2hSortLabels[h2hSortTarget];
  const activeLineView = h2hView === "over" || h2hView === "firstHalfOver"
    ? h2hView
    : formView === "over" || formView === "firstHalfOver" ? formView : null;
  const availableMarketOptions = MARKET_OPTIONS.filter((option) => option.key === "all" || document.fixtures.some((fixture) => fixture.markets.some((market) => market.key === option.key)));
  const shownMarkets = marketFilter === "all" ? availableMarketOptions.slice(1) : availableMarketOptions.filter((option) => option.key === marketFilter);
  const showFirstHalfExpected = marketFilter === "firstHalfOver05" || marketFilter === "firstHalfOver15";
  const showScore = marketFilter === "all" || marketFilter === "1x2" || marketFilter === "draw";
  // Vier Basisspalten, dazu der Score, wenn der Markt ihn zeigt, und die Marktspalten.
  // Die Summe muss zur Spaltenliste in styles.css passen, sonst scrollt die Tabelle
  // entweder zu frueh oder laesst die letzte Spalte abschneiden.
  // Partie, Form, H2H, Schüsse, Ecken, Erwartete Tore - dazu Score und die Märkte.
  const columnCount = 6 + (showScore ? 1 : 0) + shownMarkets.length;
  // 822 = die sechs Basisminima (280+184+134+46+46+82) plus den Innenabstand der Zeile
  // (40+10); der Score kommt mit seinem eigenen Minimum dazu. Die Summe muss zur Spaltenliste
  // in styles.css passen, sonst klemmen die Spalten oder die Tabelle scrollt ohne Not.
  const minimumWidth = 822 + (showScore ? 52 : 0) + shownMarkets.length * 126 + (columnCount - 1) * 10;
  const gridStyle = {
    "--market-count": shownMarkets.length,
    "--table-min-width": `${minimumWidth}px`
  } as CSSProperties;
  const fixtureGridClass = `fixture-grid${showScore ? " has-score" : ""}`;
  const heatmap = layout === "heatmap";
  const activeSortDirection = heatmap && heatmapSort ? heatmapSort.direction : sortDirection;
  const flipSortDirection = () => {
    if (heatmap && heatmapSort) setHeatmapSort({ ...heatmapSort, direction: heatmapSort.direction === 1 ? -1 : 1 });
    else setSortDirection((value) => value === 1 ? -1 : 1);
  };
  const sortMarketKey = marketFilter === "all" ? "1x2" : marketFilter;
  const sortOptions: Array<[SortKey, string]> = [
    ["kickoff", "Anstoß"],
    ["league", "Liga"],
    ["team", "Heimteam (A–Z)"],
    ["form", "Form (letzte 5)"],
    ["h2h", "H2H (direkte Duelle)"],
    ["shots", "Schüsse aufs Tor"],
    ["corners", "Ecken"],
    ["expected", showFirstHalfExpected ? "Erwartete Tore 1. HZ" : "Erwartete Tore"],
    ...(showScore || sortKey === "score" ? [["score", "Score"] as [SortKey, string]] : []),
    ["market", `Wahrscheinlichkeit ${availableMarketOptions.find((option) => option.key === sortMarketKey)?.label ?? "1X2"}`]
  ];
  const heatmapColumns = heatmapMarkets(marketFilter).map((key) =>
    ({ key, label: MARKET_OPTIONS.find((option) => option.key === key)?.label ?? key }));
  const emptyState = quickpickActive
    ? <EmptyState title={`${quickpickLabel} lässt keine Partie übrig`}
        text={quickpickReason(quickpick.report)}
        action={<button className="empty-state-action" onClick={() => setQuickpickActive(false)}>
          Filter aufheben
        </button>} />
    : <EmptyState title="Keine Spiele für diese Auswahl" text="Wähle einen anderen Zeitraum oder lockere die Filter."
        action={<button className="empty-state-action" onClick={() => resetFilters()}>Filter zurücksetzen</button>} />;
  const rangeLabel = rangeMode === "next48"
    ? "Nächste 48 Stunden ab jetzt"
    : `${customStart ? formatCalendarDate(customStart) : "–"} – ${customEnd ? formatCalendarDate(customEnd) : "–"}`;

  const isLeagueVisible = (country: string, league: string) =>
    !deselectedLeagues.has(leagueKey(country, league));
  const liveMatches = (live.board?.matches ?? []).filter((match) => isLeagueVisible(match.country, match.league));

  const valueCount = filtered.filter((fixture) =>
    fixture.markets.some((market) => (edgeOf(market) ?? 0) > 0)).length;

  const marketLabelOf = (key: MarketFilter) => availableMarketOptions.find((option) => option.key === key)?.label ?? key;
  const leagueCount = { selected: availableLeagues.length - deselectedLeagues.size, total: availableLeagues.length };
  const chipDate = (value: string) => formatCalendarDate(value, { day: "2-digit", month: "2-digit" });
  const customRangeText = !customStart || !customEnd ? "Eigener Zeitraum"
    // Ein einzelner Tag liest sich als Tag, nicht als Zeitraum von ihm zu sich selbst.
    : customStart === customEnd ? formatCalendarDate(customStart, { weekday: "short", day: "2-digit", month: "2-digit" }).replace(",", "")
    : `${chipDate(customStart)} – ${chipDate(customEnd)}`;

  // Jeder Filter, der Spiele ausblendet oder den Umfang ändert, steht bei geschlossenem Menü als
  // Schildchen da - ein unbemerkter Filter wäre dieselbe Falle, vor der der Quickpick-Zustand
  // bewahrt wird. Markt, Sortierung und Anzeige blenden nichts aus und fehlen deshalb.
  type ActiveFilter = { key: string; label: string; clearLabel: string; clear(): void };
  const leagueChip: ActiveFilter = {
    key: "leagues", label: `${leagueCount.selected} von ${leagueCount.total} Wettbewerben`,
    clearLabel: "Alle Wettbewerbe zeigen", clear: selectAllLeagues
  };
  const activeFilters: ActiveFilter[] = [];
  if (view === "live") {
    if (deselectedLeagues.size > 0) activeFilters.push(leagueChip);
    if (liveRatedOnly) activeFilters.push({ key: "rated", label: "Nur Spiele mit Empfehlung", clearLabel: "Wieder alle Spiele beobachten", clear: () => setLiveRatedOnly(false) });
  } else {
    if (levelFilter !== "all") activeFilters.push({ key: "level", label: levelFilter === "strong" ? "★ Starke Tipps" : "✓ Empfehlungen", clearLabel: "Bewertungsfilter aufheben", clear: () => setLevelFilter("all") });
    if (rangeMode === "custom") activeFilters.push({
      key: "range",
      label: customRangeText,
      clearLabel: "Zurück auf die nächsten 48 Stunden",
      clear: selectNext48
    });
    if (deselectedLeagues.size > 0) activeFilters.push(leagueChip);
    if (!showCrossLeague) activeFilters.push({ key: "cross", label: "Nur Ligaspiele", clearLabel: "Pokalspiele und Spiele zwischen verschiedenen Ligen wieder zeigen", clear: () => setShowCrossLeague(true) });
    if (classGapFilter !== "all") activeFilters.push({ key: "classGap", label: classGapFilter === "only" ? "Nur mit Klassenunterschied" : "Ohne Klassenunterschied", clearLabel: "Klassenfilter aufheben", clear: () => setClassGapFilter("all") });
    if (showPast) activeFilters.push({ key: "past", label: "Mit angepfiffenen Spielen", clearLabel: "Angepfiffene Spiele wieder ausblenden", clear: () => setShowPast(false) });
  }
  const showQuickpickChip = view === "prematch" && quickpickActive;
  const activeFilterCount = activeFilters.length + (showQuickpickChip ? 1 : 0);

  // Setzt zurück, was Spiele ausblendet oder den Umfang ändert. Markt, Sortierung, H2H/Form/Linie
  // und der Vorteil-Schalter bleiben - sie blenden nichts aus. Die Quickpick-Regler bleiben auch.
  const resetFilters = () => {
    selectAllLeagues();
    if (view === "live") {
      setLiveRatedOnly(false);
      return;
    }
    setLevelFilter("all");
    selectNext48();
    setShowCrossLeague(true);
    setClassGapFilter("all");
    setShowPast(false);
    setQuickpickActive(false);
  };

  const filterMenuValues: FilterMenuValues = {
    variant: view === "live" ? "live" : "prematch",
    levelFilter,
    counts,
    marketLabel: marketFilter === "all" ? null : marketLabelOf(marketFilter),
    classGapFilter,
    showCrossLeague,
    showPast,
    showKelly,
    liveRatedOnly,
    leagues: leagueCount,
    leagueList: availableLeagues,
    deselectedLeagues,
    leagueFilterOpen,
    watched: { count: watchedFixtureIds.length, total: document.fixtures.length },
    shown: filtered.length,
    // Dasselbe `now` wie `inSelectedRange`: Die angezeigte Grenze ist die, die filtert.
    rangeSummary: rangeMode === "next48" ? `bis ${formatRangeEnd(now + 48 * 3_600_000, document.meta.timezone)}` : customRangeText,
    resetDisabled: activeFilterCount === 0
  };
  const filterMenuActions: FilterMenuActions = {
    setLevelFilter,
    setClassGapFilter,
    // Ohne Spiele zwischen Ligen gibt es keinen Klassenunterschied - ein stehengebliebenes
    // "nur mit" ließe die Tabelle leer und das abgeschaltete Feld unbedienbar zurück.
    setShowCrossLeague: (value) => {
      setShowCrossLeague(value);
      if (!value) setClassGapFilter("all");
    },
    setShowPast,
    setShowKelly: (value) => {
      setShowKelly(value);
      if (!value) setKellyOpen(false);
    },
    setLiveRatedOnly,
    openLeagueFilter: () => setLeagueFilterOpen(true),
    toggleLeague,
    selectOnlyLeague: (key) => setDeselectedLeagues(new Set(availableLeagues.filter((item) => item.key !== key).map((item) => item.key))),
    reset: resetFilters,
    close: () => closeFilterMenu(true)
  };

  const rangeControl = <DayRangePicker minimum={document.meta.firstAvailableDate ?? null}
    maximum={document.meta.lastAvailableDate ?? null} custom={rangeMode === "custom"}
    start={customStart} end={customEnd} selectingEnd={selectingRangeEnd} onNext48={selectNext48} onSelect={selectCalendarDate} />;

  // H2H und Form zeigen dieselbe Größe: Der Markt setzt beide ohnehin gleich (`selectMarket`),
  // getrennt einstellen war eine Kombination, die niemand brauchte. Beide Zustände bleiben, weil
  // die Sortierung je Spalte liest. In der Heatmap wirkt der Block nicht und entfällt.
  const setPointsView = (value: H2hView) => {
    setH2hView(value);
    setFormView(value);
  };
  const displayControls = heatmap ? undefined : <div className="filter-display">
    <FilterSegment name="points-view" legend="Punkte in Form und H2H" value={h2hView}
      onChange={setPointsView} options={POINTS_VIEW_OPTIONS} />
    {activeLineView && <div className="filter-display-line">
      <FilterSegment name="points-line" legend="Linie"
        value={String(activeLineView === "firstHalfOver" ? firstHalfOverLine : overLine)}
        onChange={(value) => {
          if (activeLineView === "firstHalfOver") setFirstHalfOverLine(Number(value) as FirstHalfOverLine);
          else setOverLine(Number(value) as FullTimeOverLine);
        }}
        options={activeLineView === "firstHalfOver" ? FIRST_HALF_LINE_OPTIONS : FULL_TIME_LINE_OPTIONS} />
      <FilterSegment name="points-direction" legend="Richtung" value={counterDirection ? "under" : "over"}
        onChange={(value) => setCounterDirection(value === "under")} options={DIRECTION_OPTIONS} />
    </div>}
  </div>;

  const filterControl = <div className="filter-anchor" ref={filterAnchorRef} onBlur={(event) => {
    // Nur echtes Wegtabben schließt. Ohne Ziel (Knopf verschwindet nach "Übernehmen" oder wird
    // nach "Zurücksetzen" abgeschaltet) bleibt das Menü offen, ebenso während des
    // Wettbewerbe-Dialogs darüber.
    if (leagueFilterOpen) return;
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) setFilterMenuOpen(false);
  }}>
    <FilterButton buttonRef={filterButtonRef} open={filterMenuOpen} activeCount={activeFilterCount}
      onToggle={() => setFilterMenuOpen((value) => !value)} />
    {filterMenuOpen && <FilterMenu values={filterMenuValues} actions={filterMenuActions}
      rangeControl={view === "prematch" ? rangeControl : undefined}
      displayControls={view === "prematch" ? displayControls : undefined} />}
  </div>;

  const marketControl = <label className="toolbar-field">
    <span>Markt</span>
    <select value={marketFilter} onChange={(event) => selectMarket(event.target.value as MarketFilter)}>
      {availableMarketOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
    </select>
  </label>;

  const clearAndRefocus = (clear: () => void) => {
    clear();
    // Das Schildchen verschwindet mit dem Filter; der Fokus geht an den Filter-Knopf.
    filterButtonRef.current?.focus();
  };
  const filterStatusRow = (status: ReactNode) => <div className="filter-status-row">
    {status}
    {activeFilters.map((filter) => <FilterChip key={filter.key} label={filter.label} title="Filter öffnen"
      clearLabel={filter.clearLabel} onOpen={() => setFilterMenuOpen(true)} onClear={() => clearAndRefocus(filter.clear)} />)}
    {showQuickpickChip && <QuickpickChip label={quickpickLabel}
      passed={quickpick.report.passed} evaluated={quickpick.report.evaluated}
      onOpen={() => setQuickpickOpen(true)} onClear={() => clearAndRefocus(() => setQuickpickActive(false))} />}
  </div>;

  const liveStatus = <p className="filter-status live-status">
    <span><strong>{liveMatches.length}</strong> {liveMatches.length === 1 ? "laufendes Spiel" : "laufende Spiele"}</span>
    {" · "}{live.board ? `${live.board.candidates} im Zeitfenster` : "Warte auf Daten"}
    {live.board && <>{" · "}API-Aufrufe heute: {live.board.budget.usedToday} von {live.board.budget.capToday}</>}
    {live.board && live.board.budget.apiRequestsRemaining !== null && <>{" · "}Kontingent verbleibend: {live.board.budget.apiRequestsRemaining}</>}
    {live.board && <>{" · "}Aktualisiert: {formatDataTimestamp(live.board.createdAt, document.meta.timezone)}
      {" · "}{live.board.strategy === "live-all" ? "Sammelabruf" : "Bündelabruf"}</>}
  </p>;

  return <>
  <div className="app-shell density-compact">
    <NavRail active={navKey} onSelect={selectNav} createdAt={document.meta.createdAt} timezone={document.meta.timezone} />

    <main className="content">
      {banner && <div className="banner"><span><RocketLaunch size={20} weight="duotone" /></span><p><strong className="gold">Gold ★</strong> heißt sehr empfehlenswert, <strong>Grün ✓</strong> empfehlenswert. Sortiere über „Sortierung“ oder die Spaltenköpfe; Zeitraum, Wettbewerbe und Stufe stellst du über „Filter“ ein.</p><button onClick={() => { setBanner(false); saveBannerDismissed(); }} aria-label="Hinweis schließen"><X /></button></div>}
      {view === "prematch" ? <>
      <div className="view-toolbar">
        <div className="toolbar-row">
          {filterControl}
          {marketControl}
          <div className="toolbar-field sort-field">
            <label htmlFor="sort-select">Sortierung</label>
            <div className="sort-control">
              <select id="sort-select" value={heatmap && heatmapSort ? "heatmap" : sortKey} onChange={(event) => selectSort(event.target.value as SortKey)}>
                {heatmap && heatmapSort && <option value="heatmap" disabled>Spalte der Heatmap</option>}
                {sortOptions.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
              </select>
              <button type="button" className="sort-direction" onClick={flipSortDirection}
                title="Reihenfolge umdrehen"
                aria-label={`Reihenfolge umdrehen, jetzt ${activeSortDirection === 1 ? "aufsteigend" : "absteigend"}`}>
                {activeSortDirection === 1 ? "↑" : "↓"}
              </button>
            </div>
          </div>
          <div className="toolbar-actions">
            <QuickpickButton active={quickpickActive} onOpen={() => setQuickpickOpen(true)} />
            {showKelly && <KellyButton onOpen={() => setKellyOpen(true)} />}
          </div>
        </div>
        {filterStatusRow(<p className="filter-status">
          <span aria-live="polite"><strong>{filtered.length}</strong> Spiele angezeigt</span>
          {" · "}{rangeLabel}
          {showKelly && <>{" · "}<strong>{valueCount}</strong> mit Vorteil</>}
        </p>)}
      </div>

      <div className="table-with-detail">
      {heatmap ? <HeatmapTable
        sort={heatmapSort}
        onSortChange={setHeatmapSort}
        fixtures={sortedFixtures}
        markets={heatmapColumns}
        timezone={document.meta.timezone}
        now={now}
        showEdge={showKelly}
        openFixture={openFixture}
        onToggleFixture={(fixtureId) => setOpenFixture((value) => value === fixtureId ? null : fixtureId)}
        cartSlot={(fixture) => <CartAddRadial
          compact
          fixture={fixture}
          cart={cart}
          open={radialFixtureId === fixture.fixtureId}
          onOpen={() => setRadialFixtureId(fixture.fixtureId)}
          onClose={() => setRadialFixtureId((current) => current === fixture.fixtureId ? null : current)}
          onSelect={(market) => addEntry(toCartEntry(fixture, market))}
        />}
        empty={emptyState}
      /> : <div className="table-scroll">
        <div className={`table-head ${fixtureGridClass}`} style={gridStyle}>
          <span className="fixture-summary-head">
            <button onClick={() => sort("team")} aria-label={sortStateLabel("Partie", sortKey === "team", sortDirection)}>Partie {arrow("team")}</button>
            <button onClick={() => sort("kickoff")} aria-label={sortStateLabel("Anstoß & Liga", sortKey === "kickoff", sortDirection)}>Anstoß & Liga {arrow("kickoff")}</button>
          </span>
          <button onClick={() => sort("form")}>
            Letzte 5 Form {formView === "outcome" && sortKey === "form"
              ? <span className={`sort-mode-badge ${formSortLabel.className}`} aria-label={`Sortierung: ${formSortLabel.label}`} title={formSortLabel.label}>{formSortLabel.badge}</span>
              : secondarySortKey === "form"
                ? <span className="sort-mode-badge secondary" aria-label="Sekundäre Sortierung" title="Sekundäre Sortierung">2</span>
                : arrow("form")}
          </button>
          <button onClick={() => sort("h2h")}>
            Letzte 5 H2H {h2hView === "outcome" && sortKey === "h2h"
              ? <span className={`sort-mode-badge ${h2hSortTarget}`} aria-label={`Sortierung: ${h2hSortLabel.label}`} title={h2hSortLabel.label}>{h2hSortLabel.badge}</span>
              : secondarySortKey === "h2h"
                ? <span className="sort-mode-badge secondary" aria-label="Sekundäre Sortierung" title="Sekundäre Sortierung">2</span>
                : arrow("h2h")}
          </button>
          <button className="icon-head" onClick={() => sort("shots")} title="Schüsse aufs Tor im Schnitt der letzten fünf Spiele" aria-label={sortStateLabel("Schüsse aufs Tor", sortKey === "shots", sortDirection)}>
            <Crosshair size={15} weight="bold" aria-hidden="true" /> {arrow("shots")}
          </button>
          <button className="icon-head" onClick={() => sort("corners")} title="Ecken im Schnitt der letzten fünf Spiele" aria-label={sortStateLabel("Ecken", sortKey === "corners", sortDirection)}>
            <FlagPennant size={15} weight="bold" aria-hidden="true" /> {arrow("corners")}
          </button>
          <button onClick={() => sort("expected")} aria-label={sortStateLabel(showFirstHalfExpected ? "Erw. Tore 1. HZ" : "Erw. Tore", sortKey === "expected", sortDirection)}>{showFirstHalfExpected ? "Erw. Tore 1. HZ" : "Erw. Tore"} {arrow("expected")}</button>
          {showScore && <button onClick={() => sort("score")} aria-label={sortStateLabel("Score", sortKey === "score", sortDirection)}>Score {arrow("score")}</button>}
          {shownMarkets.map((option) => <button key={option.key} onClick={() => sort("market")} aria-label={sortStateLabel(option.label, sortKey === "market", sortDirection)}>{option.label} {arrow("market")}</button>)}
        </div>
        {sortedFixtures.map((fixture) => {
          const time = kickoffParts(fixture.kickoff, document.meta.timezone);
          const isPast = Date.parse(fixture.kickoff) < now;
          const markets = visibleMarkets(fixture, marketFilter);
          return <article className={`fixture-wrap level-${bestLevel(fixture, marketFilter)} ${openFixture === fixture.fixtureId ? "open" : ""}`} style={gridStyle} key={fixture.fixtureId}>
            <div className="fixture-row-wrap">
            <CartAddRadial
              fixture={fixture}
              cart={cart}
              open={radialFixtureId === fixture.fixtureId}
              onOpen={() => setRadialFixtureId(fixture.fixtureId)}
              onClose={() => setRadialFixtureId((current) => current === fixture.fixtureId ? null : current)}
              onSelect={(market) => addEntry(toCartEntry(fixture, market))}
            />
            <button className={`${fixtureGridClass} fixture-row`} style={gridStyle} onClick={() => setOpenFixture((value) => value === fixture.fixtureId ? null : fixture.fixtureId)} aria-expanded={openFixture === fixture.fixtureId}>
              <span className="fixture-summary-cell">
                <span className="teams-cell">
                  <span className="team-name"><TeamCrest name={fixture.homeTeam} logo={fixture.homeCrest} /><strong>{fixture.homeTeam}</strong><EloTag value={fixture.homeElo} team={fixture.homeTeam} /><DefenseShield profile={fixture.defense?.home} team={fixture.homeTeam} /></span>
                  <span className="team-name"><TeamCrest name={fixture.awayTeam} logo={fixture.awayCrest} /><strong>{fixture.awayTeam}</strong><EloTag value={fixture.awayElo} team={fixture.awayTeam} /><DefenseShield profile={fixture.defense?.away} team={fixture.awayTeam} /></span>
                </span>
                <span className="fixture-meta"><strong>{time.clock}{isPast && <em> angepfiffen</em>}</strong><small>{time.day} · <CountryFlag country={fixture.country} /> {fixture.country} · {fixture.league}</small>{(fixture.h2hNotice || fixture.warnings.length > 0) && <i>{fixture.h2hNotice ? "H2H" : "Daten"}</i>}{fixture.classGap && <ClassGapBadge gap={fixture.classGap} homeTeam={fixture.homeTeam} awayTeam={fixture.awayTeam} />}</span>
              </span>
              <span className="form-cell">
                {/*
                  * Bei Pokal- und Länderspielen zählt der Lauf die letzten Spiele insgesamt
                  * (src/dashboard.ts setzt dann scope "overall"). "Home"/"Away" hätte dort
                  * eine Trennung nach Ort behauptet, die in den Punkten gar nicht steckt.
                  */}
                <span
                  className="form-labels"
                  title={fixture.form.scope === "overall"
                    ? `Alle Spiele der letzten Zeit, zu Hause und auswärts zusammen – oben ${fixture.homeTeam}, unten ${fixture.awayTeam}`
                    : `Nur die Heimspiele von ${fixture.homeTeam} gegen die Auswärtsspiele von ${fixture.awayTeam}`}
                  aria-label={fixture.form.scope === "overall" ? "Form aus allen Spielen" : "Heim- und Auswärtsform"}
                >
                  {fixture.form.scope === "overall"
                    ? <><small>Alle</small><small>Alle</small></>
                    : <><small>Home</small><small>Away</small></>}
                </span>
                <span>{formView === "outcome"
                  ? <><FormDots results={fixture.form.home} /><FormDots results={fixture.form.away} /></>
                  : <>
                    <FormMatchDots matches={fixture.form.homeMatches} view={formView} overLine={overLine} firstHalfOverLine={firstHalfOverLine} inverted={counterDirection} />
                    <FormMatchDots matches={fixture.form.awayMatches} view={formView} overLine={overLine} firstHalfOverLine={firstHalfOverLine} inverted={counterDirection} />
                  </>}</span>
              </span>
              <span className="h2h-cell"><H2hDots fixture={fixture} view={h2hView} overLine={overLine} firstHalfOverLine={firstHalfOverLine} inverted={counterDirection} /></span>
              <RecentStatCell fixture={fixture} field="shotsOnGoal" label="Schüsse aufs Tor" />
              <RecentStatCell fixture={fixture} field="corners" label="Ecken" />
              <span className="expected-cell"><strong>{(showFirstHalfExpected ? fixture.expectedFirstHalfGoals?.home ?? 0 : fixture.expectedGoals.home).toFixed(2).replace(".", ",")}</strong><i>:</i><strong>{(showFirstHalfExpected ? fixture.expectedFirstHalfGoals?.away ?? 0 : fixture.expectedGoals.away).toFixed(2).replace(".", ",")}</strong></span>
              {showScore && <span className="score-cell">{marketFilter !== "draw" && <span><small>1X2</small><strong>{fixture.scores.favorite ?? "–"}</strong></span>}{marketFilter !== "1x2" && <span><small>X</small><strong>{fixture.scores.draw ?? "–"}</strong></span>}</span>}
              {markets.map((item) => <MarketCard market={item} showEdge={showKelly} key={item.key} />)}
            </button>
            </div>
          </article>;
        })}
        {sortedFixtures.length === 0 && emptyState}
      </div>}
      {openFixture !== null && (() => {
        const fixture = sortedFixtures.find((item) => item.fixtureId === openFixture);
        if (!fixture) return null;
        const time = kickoffParts(fixture.kickoff, document.meta.timezone);
        const showTable = !fixture.crossLeague && !!fixture.table?.length;
        const detailed = insights.status === "ready" && insights.insights.fixtureId === fixture.fixtureId;
        const loading = insights.status === "loading";
        return <aside className="fixture-detail-panel" aria-label="Details">
              <header className="fixture-detail-head">
                <span className="fixture-detail-teams">
                  <strong className="home">{fixture.homeTeam}</strong>
                  <strong className="away">{fixture.awayTeam}</strong>
                  <small>{time.clock} · {time.day} · <CountryFlag country={fixture.country} /> {fixture.country} · {fixture.league}</small>
                </span>
                <button className="fixture-detail-close" aria-label="Details schließen" onClick={() => setOpenFixture(null)}><X /></button>
              </header>
              {loading
                ? <div className="insight-loading" role="status"><i aria-hidden /><span>Torphasen und Trends werden geladen …</span></div>
                : <>
              {detailed
                ? <FixtureInsightPanels insights={insights.insights} timezone={document.meta.timezone} />
                : <section className="insight-panel"><h3>Direkte Begegnungen</h3><InsightsNotice state={insights} />{fixture.h2h.matches.length
                ? <ul className="h2h-match-list">{fixture.h2h.matches.map((match, index) => {
                    const outcome = fixture.h2h.outcomes[index];
                    const hasHalfTime = typeof match.halfTimeHomeGoals === "number" && typeof match.halfTimeAwayGoals === "number";
                    const homeTeamWasHome = match.homeTeam === fixture.homeTeam;
                    const currentHomeGoals = homeTeamWasHome ? match.homeGoals : match.awayGoals;
                    const currentAwayGoals = homeTeamWasHome ? match.awayGoals : match.homeGoals;
                    const currentHalfHomeGoals = homeTeamWasHome ? match.halfTimeHomeGoals : match.halfTimeAwayGoals;
                    const currentHalfAwayGoals = homeTeamWasHome ? match.halfTimeAwayGoals : match.halfTimeHomeGoals;
                    return <li className={`h2h-match-row ${outcome ?? ""}`} key={`${match.date}-${match.homeTeam}`}>
                      <span className="h2h-match-date">{new Intl.DateTimeFormat("de-DE", { timeZone: document.meta.timezone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(match.date))}</span>
                      <span className="h2h-match-teams">
                        <span className="home">{fixture.homeTeam}</span>
                        <span className="h2h-match-score">
                          <strong className={outcome === "win" ? "home" : outcome === "loss" ? "lose" : ""}>{currentHomeGoals}</strong>
                          <i>:</i>
                          <strong className={outcome === "loss" ? "away" : outcome === "win" ? "lose" : ""}>{currentAwayGoals}</strong>
                        </span>
                        <span className="away">{fixture.awayTeam}</span>
                      </span>
                      <span className="h2h-match-venue" title={homeTeamWasHome ? `${fixture.homeTeam} spielte zu Hause` : `${fixture.homeTeam} spielte auswärts`}>{homeTeamWasHome ? "H" : "A"}</span>
                      {hasHalfTime && <span className="h2h-match-half">HZ {currentHalfHomeGoals}:{currentHalfAwayGoals}</span>}
                    </li>;
                  })}</ul>
                : <p>Keine H2H-Ergebnisse verfügbar.</p>}</section>}
              {showTable && <section className="insight-panel"><h3>Ligatabelle</h3>
                <table className="standings-table" aria-label="Ligatabelle">
                  <thead><tr><th>Pl.</th><th>Team</th><th>Sp</th><th>+/-</th><th>Pkt</th></tr></thead>
                  <tbody>{standingsWindow(fixture.table!, fixture.homeTeam, fixture.awayTeam).map((row, index) => row === null
                    ? <tr className="standings-gap" key={`gap-${index}`}><td colSpan={5}>⋯</td></tr>
                    : <tr className={row.teamName === fixture.homeTeam ? "home" : row.teamName === fixture.awayTeam ? "away" : ""} key={row.teamName}>
                        <td>{row.position}</td>
                        <td>{row.teamName}</td>
                        <td>{row.played}</td>
                        <td>{row.goalsFor - row.goalsAgainst > 0 ? "+" : ""}{row.goalsFor - row.goalsAgainst}</td>
                        <td>{row.points}</td>
                      </tr>)}</tbody>
                </table>
              </section>}
              <section className="insight-panel"><h3>Bewertung je Markt</h3><div className="market-details">{fixture.markets.map((item) => <div key={item.key} className={item.recommendation.level}><i /><span><strong>{item.label} · {item.recommendation.label}</strong>{item.details.join(" · ")}</span></div>)}</div></section>
              </>}
            </aside>;
      })()}
      </div>
      </> : view === "profile" ? <MarketProfileView /> : <>
      {/* Der Markt wirkt auch hier auf die Markttafeln - deshalb sichtbar, nicht still geerbt. */}
      <div className="view-toolbar">
        <div className="toolbar-row">
          {filterControl}
          {marketControl}
        </div>
        {filterStatusRow(liveStatus)}
      </div>
      <LiveView
        state={live}
        marketFilter={marketFilter}
        showEdge={showKelly}
        isLeagueVisible={isLeagueVisible}
      />
      </>}
    </main>
  </div>
  {leagueFilterOpen && <LeagueFilterModal
    leagues={availableLeagues}
    statsByKey={leagueStatsByKey}
    deselected={deselectedLeagues}
    search={leagueSearch}
    onSearchChange={setLeagueSearch}
    onToggle={toggleLeague}
    onSelectAll={selectAllLeagues}
    onSelectNone={selectNoneLeagues}
    onClose={() => setLeagueFilterOpen(false)}
  />}
  <CartBadge count={cart.length} onClick={() => setBuilderOpen(true)} />
  {builderOpen && <BetBuilderDrawer cart={cart} onRemove={removeEntry} onClear={clearCart} onClose={() => setBuilderOpen(false)} />}
  {showKelly && kellyOpen && <KellyDialog
    fixtures={scopedFixtures}
    marketFilter={marketFilter}
    marketLabel={MARKET_OPTIONS.find((option) => option.key === marketFilter)?.label ?? "Alle Märkte"}
    settings={kellySettings}
    profile={marketProfile.profile}
    auto={kellyAuto}
    onAutoChange={setKellyAuto}
    onSettingsChange={setKellySettings}
    onClose={() => setKellyOpen(false)}
  />}
  {quickpickOpen && <QuickpickDialog
    fixtures={scopedFixtures}
    store={quickpickStore}
    active={quickpickActive}
    timezone={document.meta.timezone}
    onSettingsChange={(next) => setQuickpickStore((store) => withSettings(store, next))}
    onPresetChange={(preset: QuickpickPresetId) => setQuickpickStore((store) => ({ ...store, aktiv: preset }))}
    onActiveChange={setQuickpickActive}
    onAddAll={(rows) => {
      for (const row of rows) {
        // Eine Voreinstellung ohne Seite stützt eine Torlinie. Dafür gibt es den allgemeinen
        // Konstruktor: Er übernimmt Marktkennung, Beschriftung und Auswahl direkt aus dem
        // Markt des Laufs, und `cartEntryId` lässt die Wette neben einer 1X2-Wette derselben
        // Partie bestehen, statt sie zu verdrängen.
        if (row.evaluation.market !== "1x2") {
          const market = row.fixture.markets.find((entry) => entry.key === row.evaluation.market);
          if (market) addEntry(toCartEntry(row.fixture, market));
          continue;
        }
        // Die gestützte Seite muss in den Schein, nicht der Modelltipp: Bei „Dominanz" können
        // die beiden auseinanderfallen, und dann wäre der Eintrag schlicht die falsche Wette.
        if (row.evaluation.side === null) continue;
        addEntry(toQuickpickCartEntry(row.fixture, row.evaluation.side, row.evaluation.odds, null));
      }
      setQuickpickOpen(false);
      setBuilderOpen(true);
    }}
    onClose={() => setQuickpickOpen(false)}
  />}
  </>;
}

export function App() {
  const state = useDashboardData();
  if (state.status === "loading") return <div className="status-screen"><BrandMark /><strong>Dashboard wird geladen …</strong></div>;
  if (!state.document) return <div className="status-screen"><BrandMark /><EmptyState title="Noch keine Analyse vorhanden" text={state.message ?? "Starte npm run dashboard -- --dates next48 im Chat."} /></div>;
  return <><Dashboard document={state.document} />{state.status === "error" && <div className="connection-warning" role="status"><WarningCircle size={16} weight="duotone" aria-hidden /><span>{state.message} · Letzter erfolgreicher Stand wird weiter angezeigt.</span></div>}</>;
}
