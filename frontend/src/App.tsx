import {
  Binoculars, CalendarBlank, CaretDoubleLeft, CaretDoubleRight, CaretLeft, CaretRight, Calculator, CheckCircle, ClockCounterClockwise, Funnel, ListBullets, RocketLaunch, Shield, ShieldCheck, Star, WarningCircle, X
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BetBuilderDrawer, CartAddButton, CartBadge, MarketPickerModal } from "./BetCartUI";
import { toCartEntry, useBetCart } from "./betCart";
import { countryFlagCode } from "./countryFlags";
import { useDashboardData } from "./data";
import { edgeOf, loadKellySettings, loadKellyVisible, saveKellySettings, saveKellyVisible, type KellySettings } from "./kelly";
import { KellyButton, KellyDialog } from "./KellyUI";
import type { DashboardDocument, DashboardFixture, DashboardMarket, DashboardMarketKey, FormResult, LeagueStats, RecommendationLevel } from "./types";

const MARKET_OPTIONS: Array<{ key: "all" | DashboardMarketKey; label: string }> = [
  { key: "all", label: "Alle Märkte" },
  { key: "1x2", label: "1X2" },
  { key: "draw", label: "Remis" },
  { key: "btts", label: "BTTS" },
  { key: "over15", label: "Über 1,5" },
  { key: "over25", label: "Über 2,5" },
  { key: "firstHalfOver05", label: "1. HZ Ü0,5" },
  { key: "firstHalfOver15", label: "1. HZ Ü1,5" }
];
type MarketFilter = (typeof MARKET_OPTIONS)[number]["key"];
type Density = "micro" | "compact" | "comfort";
type LevelFilter = "all" | "strong" | "recommended";
type RangeMode = "next48" | "custom";
type H2hView = "outcome" | "btts" | "over" | "firstHalfOver";
type FormView = H2hView;
type FullTimeOverLine = 1.5 | 2.5 | 3.5;
type FirstHalfOverLine = 0.5 | 1.5;
type SortKey = "kickoff" | "team" | "form" | "h2h" | "expected" | "score" | "market";

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

function monthStart(value: string): string {
  const date = dateOnly(value);
  date.setUTCDate(1);
  return isoDate(date);
}

function shiftMonth(value: string, offset: number): string {
  const date = dateOnly(value);
  date.setUTCMonth(date.getUTCMonth() + offset, 1);
  return isoDate(date);
}

function calendarDays(month: string): Array<string | null> {
  const first = dateOnly(month);
  const leading = (first.getUTCDay() + 6) % 7;
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  next.setUTCDate(0);
  const values: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= next.getUTCDate(); day += 1) {
    const date = new Date(first);
    date.setUTCDate(day);
    values.push(isoDate(date));
  }
  while (values.length % 7 !== 0) values.push(null);
  return values;
}

function DateRangePopover({
  minimum, maximum, start, end, visibleMonth, onVisibleMonthChange, onSelect, onApply, onCancel
}: {
  minimum: string;
  maximum: string;
  start: string;
  end: string;
  visibleMonth: string;
  onVisibleMonthChange(value: string): void;
  onSelect(value: string): void;
  onApply(): void;
  onCancel(): void;
}) {
  const days = calendarDays(visibleMonth);
  const minimumMonth = monthStart(minimum);
  const maximumMonth = monthStart(maximum);
  return <div className="date-popover" role="dialog" aria-label="Datumsbereich auswählen">
    <div className="date-popover-head">
      <button aria-label="Vorheriger Monat" disabled={visibleMonth <= minimumMonth} onClick={() => onVisibleMonthChange(shiftMonth(visibleMonth, -1))}><CaretLeft /></button>
      <strong>{formatCalendarDate(visibleMonth, { month: "long", year: "numeric" })}</strong>
      <button aria-label="Nächster Monat" disabled={visibleMonth >= maximumMonth} onClick={() => onVisibleMonthChange(shiftMonth(visibleMonth, 1))}><CaretRight /></button>
    </div>
    <div className="date-weekdays" aria-hidden="true">{["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="date-calendar">
      {days.map((date, index) => date === null
        ? <span key={`blank-${index}`} />
        : <button
            key={date}
            disabled={date < minimum || date > maximum}
            className={`${date >= start && date <= end ? "in-range" : ""} ${date === start ? "range-start" : ""} ${date === end ? "range-end" : ""}`}
            aria-label={formatCalendarDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            aria-pressed={date >= start && date <= end}
            onClick={() => onSelect(date)}
          >{Number(date.slice(-2))}</button>)}
    </div>
    <div className="date-selection" aria-live="polite"><span>Von <strong>{formatCalendarDate(start)}</strong></span><span>Bis <strong>{formatCalendarDate(end)}</strong></span></div>
    <div className="date-actions"><button onClick={onCancel}>Abbrechen</button><button className="primary" onClick={onApply}>Übernehmen</button></div>
  </div>;
}

function leagueKey(country: string, league: string): string {
  return `${country}::${league}`;
}

function CountryFlag({ country }: { country: string }) {
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

function kickoffParts(value: string, timezone: string): { clock: string; day: string } {
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

function DefenseShield({ profile, team }: { profile: NonNullable<DashboardFixture["defense"]>["home"] | undefined; team: string }) {
  if (!profile?.strong) return null;
  const verified = profile.badge === "verified";
  const percentile = profile.percentile == null ? "Top 20 %" : `${Math.round(profile.percentile * 100)}. Perzentil`;
  const sample = `${profile.matches} Spiele (${profile.venueMatches} Rollen-Spiele)`;
  const coverage = profile.xgCoverage === undefined ? "" : ` · xG-Abdeckung ${Math.round(profile.xgCoverage * 100)} % gesamt/${Math.round((profile.venueXgCoverage ?? 0) * 100)} % Rolle`;
  const metric = verified
    ? `xGA ${profile.expectedGoalsAgainst?.toFixed(2).replace(".", ",") ?? "–"} · Gegentore ${profile.concededGoals.toFixed(2).replace(".", ",")}`
    : `Gegentore ${profile.concededGoals.toFixed(2).replace(".", ",")}`;
  const label = `${team}: ${verified ? "xG-verifizierte" : "durch Torhistorie belegte"} Top-20-%-Defensive · ${percentile} · ${metric} · ${sample}${coverage}`;
  return <span className={`defense-shield ${verified ? "verified" : "fallback"}`} role="img" aria-label={label} title={label}>
    {verified ? <ShieldCheck size={16} weight="fill" aria-hidden /> : <Shield size={16} weight="regular" aria-hidden />}
  </span>;
}

type MatchSummary = DashboardFixture["h2h"]["matches"][number];

function matchViewDots(
  matches: MatchSummary[],
  view: Exclude<H2hView, "outcome">,
  overLine: FullTimeOverLine,
  firstHalfOverLine: FirstHalfOverLine
): Array<{ value: boolean | null; text: string; title: string }> {
  const values = view === "btts"
    ? matches.map((match) => {
      const value = match.homeGoals > 0 && match.awayGoals > 0;
      return { value, text: value ? "✓" : "×", title: value ? "BTTS" : "Kein BTTS" };
    })
    : view === "firstHalfOver"
      ? matches.map((match) => {
        if (typeof match.halfTimeHomeGoals !== "number" || typeof match.halfTimeAwayGoals !== "number") {
          return { value: null, text: "–", title: "Kein Halbzeitstand verfügbar" };
        }
        const value = match.halfTimeHomeGoals + match.halfTimeAwayGoals > firstHalfOverLine;
        return {
          value,
          text: value ? "Ü" : "U",
          title: `1. Halbzeit ${match.halfTimeHomeGoals}:${match.halfTimeAwayGoals} · ${value ? "Über" : "Unter"} ${firstHalfOverLine.toLocaleString("de-DE")}`
        };
      })
      : matches.map((match) => {
        const value = match.homeGoals + match.awayGoals > overLine;
        return { value, text: value ? "Ü" : "U", title: `Endstand ${match.homeGoals}:${match.awayGoals}` };
      });
  while (values.length < 5) values.push({ value: null, text: "–", title: "Keine Daten" });
  return values.slice(0, 5);
}

function formMatchesStreak(
  matches: MatchSummary[] | undefined,
  view: Exclude<FormView, "outcome">,
  overLine: FullTimeOverLine,
  firstHalfOverLine: FirstHalfOverLine
): number {
  return consecutive(matchViewDots(matches ?? [], view, overLine, firstHalfOverLine).map((item) => item.value));
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
  firstHalfOverLine: FirstHalfOverLine
): number {
  if (key === "form") {
    if (formView === "outcome") {
      const mode = formSortModes[formSortMode]!;
      if (mode === "home") return countResults(left.form.home, "win") - countResults(right.form.home, "win");
      if (mode === "away") return countResults(left.form.away, "win") - countResults(right.form.away, "win");
      return countResults([...left.form.home, ...left.form.away], "draw") - countResults([...right.form.home, ...right.form.away], "draw");
    }
    const pairScore = (fixture: DashboardFixture) => {
      const homeStreak = formMatchesStreak(fixture.form.homeMatches, formView, overLine, firstHalfOverLine);
      const awayStreak = formMatchesStreak(fixture.form.awayMatches, formView, overLine, firstHalfOverLine);
      return { min: Math.min(homeStreak, awayStreak), sum: homeStreak + awayStreak };
    };
    const l = pairScore(left);
    const r = pairScore(right);
    return (l.min - r.min) || (l.sum - r.sum);
  }
  if (h2hView === "btts") return consecutive(left.h2h.btts) - consecutive(right.h2h.btts);
  if (h2hView === "over") {
    const streak = (fixture: DashboardFixture) => consecutive(fixture.h2h.matches.map((match) => match.homeGoals + match.awayGoals > overLine));
    return streak(left) - streak(right);
  }
  if (h2hView === "firstHalfOver") {
    const streak = (fixture: DashboardFixture) => consecutive(firstHalfOverResults(fixture, firstHalfOverLine));
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

function H2hDots({ fixture, view, overLine, firstHalfOverLine }: {
  fixture: DashboardFixture;
  view: H2hView;
  overLine: FullTimeOverLine;
  firstHalfOverLine: FirstHalfOverLine;
}) {
  if (view === "outcome") return <FormDots results={fixture.h2h.outcomes} h2h />;
  return <ViewDots values={matchViewDots(fixture.h2h.matches, view, overLine, firstHalfOverLine)} />;
}

function FormMatchDots({ matches, view, overLine, firstHalfOverLine }: {
  matches: MatchSummary[] | undefined;
  view: Exclude<FormView, "outcome">;
  overLine: FullTimeOverLine;
  firstHalfOverLine: FirstHalfOverLine;
}) {
  return <ViewDots values={matchViewDots(matches ?? [], view, overLine, firstHalfOverLine)} />;
}

function MarketCard({ market, showEdge }: { market: DashboardMarket; showEdge: boolean }) {
  const percentage = Math.round(market.probability * 100);
  const edge = showEdge ? edgeOf(market) : null;
  return <div className={`market-card ${market.recommendation.level}`} title={`${market.selection} · ${market.recommendation.label}`}>
    <div className="market-line">
      <span className="level-glyph">{market.recommendation.level === "strong" ? "★" : market.recommendation.level === "recommended" ? "✓" : "·"}</span>
      {market.pick && <strong className={`pick ${market.selectionTone}`}>{market.pick}</strong>}
      <strong className="odd">{formatOdd(market.odds)}</strong>
      {edge !== null && <span className={`market-edge ${edge >= 0 ? "pos" : "neg"}`} title="Value = Modellwahrscheinlichkeit − quotenimplizierte Wahrscheinlichkeit">{edge >= 0 ? "+" : ""}{(edge * 100).toFixed(1).replace(".", ",")} PP</span>}
    </div>
    <div className="probability-line">
      <span className="probability-track"><span style={{ width: `${percentage}%` }} /></span>
      <span>{formatPercent(market.probability)}</span>
    </div>
  </div>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state">
    <Binoculars size={32} weight="duotone" />
    <strong>{title}</strong>
    <span>{text}</span>
  </div>;
}

function defaultSidebarOpen(): boolean {
  return typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 700px)").matches;
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
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  const [mobileViewport, setMobileViewport] = useState(() => !defaultSidebarOpen());
  const [banner, setBanner] = useState(() => !loadBannerDismissed());
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [rangeMode, setRangeMode] = useState<RangeMode>("next48");
  const [customStart, setCustomStart] = useState(document.meta.firstAvailableDate ?? "");
  const [customEnd, setCustomEnd] = useState(document.meta.lastAvailableDate ?? "");
  const [draftStart, setDraftStart] = useState(customStart);
  const [draftEnd, setDraftEnd] = useState(customEnd);
  const [selectingRangeEnd, setSelectingRangeEnd] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(monthStart(customStart || "1970-01-01"));
  const [showCrossLeague, setShowCrossLeague] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [deselectedLeagues, setDeselectedLeagues] = useState<Set<string>>(new Set());
  const [leagueFilterOpen, setLeagueFilterOpen] = useState(false);
  const [leagueSearch, setLeagueSearch] = useState("");
  const [h2hView, setH2hView] = useState<H2hView>("outcome");
  const [formView, setFormView] = useState<FormView>("outcome");
  const [overLine, setOverLine] = useState<FullTimeOverLine>(2.5);
  const [firstHalfOverLine, setFirstHalfOverLine] = useState<FirstHalfOverLine>(0.5);
  const [density, setDensity] = useState<Density>("comfort");
  const [sortKey, setSortKey] = useState<SortKey>("kickoff");
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);
  const [formSortMode, setFormSortMode] = useState(0);
  const [h2hSortMode, setH2hSortMode] = useState(0);
  const [secondarySortKey, setSecondarySortKey] = useState<"form" | "h2h" | null>(null);
  const [openFixture, setOpenFixture] = useState<number | null>(null);
  const [pickerFixtureId, setPickerFixtureId] = useState<number | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [kellyOpen, setKellyOpen] = useState(false);
  const [showKelly, setShowKelly] = useState(() => loadKellyVisible());
  const [kellySettings, setKellySettings] = useState<KellySettings>(() => loadKellySettings());
  const { cart, addEntry, removeEntry, clear: clearCart } = useBetCart();
  const dateControlRef = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const pickerFixture = pickerFixtureId === null ? null : document.fixtures.find((item) => item.fixtureId === pickerFixtureId) ?? null;

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
    if (market === "btts") {
      setH2hView("btts");
      setFormView("btts");
    } else if (market === "over15") {
      setH2hView("over");
      setFormView("over");
      setOverLine(1.5);
    } else if (market === "over25") {
      setH2hView("over");
      setFormView("over");
      setOverLine(2.5);
    } else if (market === "firstHalfOver05") {
      setH2hView("firstHalfOver");
      setFormView("firstHalfOver");
      setFirstHalfOverLine(0.5);
    } else if (market === "firstHalfOver15") {
      setH2hView("firstHalfOver");
      setFormView("firstHalfOver");
      setFirstHalfOverLine(1.5);
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
      setVisibleMonth((value) => clampDate(monthStart(value), monthStart(minimum), monthStart(maximum)));
    } else {
      setCustomStart("");
      setCustomEnd("");
      setCalendarOpen(false);
      setRangeMode("next48");
    }
    setOpenFixture((value) => value !== null && document.fixtures.some((fixture) => fixture.fixtureId === value) ? value : null);
    setPickerFixtureId((value) => value !== null && document.fixtures.some((fixture) => fixture.fixtureId === value) ? value : null);
    setMarketFilter((value) => value === "all" || document.fixtures.some((fixture) => fixture.markets.some((market) => market.key === value)) ? value : "all");
    setDeselectedLeagues((prev) => new Set([...prev].filter((key) => availableLeagues.some((item) => item.key === key))));
  }, [availableLeagues, document]);

  useEffect(() => {
    if (!calendarOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!dateControlRef.current?.contains(event.target as Node)) setCalendarOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [calendarOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 700px)");
    const syncSidebar = (event: MediaQueryListEvent) => {
      setMobileViewport(!event.matches);
      setSidebarOpen(event.matches);
    };
    media.addEventListener("change", syncSidebar);
    return () => media.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pickerFixtureId !== null) setPickerFixtureId(null);
      else if (builderOpen) setBuilderOpen(false);
      else if (kellyOpen) setKellyOpen(false);
      else if (calendarOpen) setCalendarOpen(false);
      else if (leagueFilterOpen) setLeagueFilterOpen(false);
      else setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [builderOpen, calendarOpen, kellyOpen, leagueFilterOpen, pickerFixtureId]);

  useEffect(() => { saveKellySettings(kellySettings); }, [kellySettings]);
  useEffect(() => { saveKellyVisible(showKelly); }, [showKelly]);

  const openCalendar = () => {
    if (!document.meta.firstAvailableDate || !document.meta.lastAvailableDate) return;
    const start = clampDate(customStart || document.meta.firstAvailableDate, document.meta.firstAvailableDate, document.meta.lastAvailableDate);
    const end = clampDate(customEnd || document.meta.lastAvailableDate, start, document.meta.lastAvailableDate);
    setDraftStart(start);
    setDraftEnd(end);
    setSelectingRangeEnd(false);
    setVisibleMonth(monthStart(start));
    setCalendarOpen(true);
  };

  const selectCalendarDate = (date: string) => {
    if (!selectingRangeEnd) {
      setDraftStart(date);
      setDraftEnd(date);
      setSelectingRangeEnd(true);
      return;
    }
    setDraftStart(date < draftStart ? date : draftStart);
    setDraftEnd(date < draftStart ? draftStart : date);
    setSelectingRangeEnd(false);
  };

  const applyCalendarRange = () => {
    setCustomStart(draftStart);
    setCustomEnd(draftEnd);
    setRangeMode("custom");
    setCalendarOpen(false);
  };

  const inSelectedRange = (fixture: DashboardFixture): boolean => {
    const kickoff = Date.parse(fixture.kickoff);
    if (rangeMode === "next48") return kickoff >= now && kickoff <= now + 48 * 3_600_000;
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
  const filtered = scopedFixtures.filter((fixture) => {
    const level = bestLevel(fixture, marketFilter);
    return levelFilter === "all" || (levelFilter === "strong" ? level === "strong" : levelRank[level] >= levelRank.recommended);
  });

  const sortedFixtures = useMemo(() => [...filtered].sort((left, right) => {
    const selectedMarket = marketFilter === "all" ? "1x2" : marketFilter;
    let comparison = 0;
    if (sortKey === "kickoff") comparison = Date.parse(left.kickoff) - Date.parse(right.kickoff);
    else if (sortKey === "team") comparison = `${left.homeTeam} ${left.awayTeam}`.localeCompare(`${right.homeTeam} ${right.awayTeam}`, "de");
    else if (sortKey === "expected") {
      const firstHalf = marketFilter === "firstHalfOver05" || marketFilter === "firstHalfOver15";
      comparison = (firstHalf ? left.expectedFirstHalfGoals?.total ?? -1 : left.expectedGoals.total) -
        (firstHalf ? right.expectedFirstHalfGoals?.total ?? -1 : right.expectedGoals.total);
    }
    else if (sortKey === "score") comparison = (marketFilter === "draw" ? left.scores.draw ?? -1 : left.scores.favorite ?? -1) - (marketFilter === "draw" ? right.scores.draw ?? -1 : right.scores.favorite ?? -1);
    else if (sortKey === "market") comparison = (marketFor(left, selectedMarket)?.probability ?? -1) - (marketFor(right, selectedMarket)?.probability ?? -1);
    else if (sortKey === "form" || sortKey === "h2h") {
      comparison = columnComparison(sortKey, left, right, formView, h2hView, formSortMode, h2hSortMode, overLine, firstHalfOverLine);
      if (comparison === 0 && secondarySortKey) {
        comparison = columnComparison(secondarySortKey, left, right, formView, h2hView, formSortMode, h2hSortMode, overLine, firstHalfOverLine);
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
      setSortDirection(key === "kickoff" || key === "team" ? 1 : -1);
    }
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
  const columnCount = 5 + (showScore ? 1 : 0) + shownMarkets.length;
  const minimumWidth = density === "micro"
    ? 723 + (showScore ? 68 : 0) + shownMarkets.length * 108 + (columnCount - 1) * 12
    : 860 + (showScore ? 82 : 0) + shownMarkets.length * 122 + (columnCount - 1) * 12;
  const gridStyle = {
    "--market-count": shownMarkets.length,
    "--table-min-width": `${minimumWidth}px`
  } as CSSProperties;
  const fixtureGridClass = `fixture-grid${showScore ? " has-score" : ""}`;
  const rangeLabel = rangeMode === "next48"
    ? "Nächste 48 Stunden ab jetzt"
    : `${customStart ? formatCalendarDate(customStart) : "–"} – ${customEnd ? formatCalendarDate(customEnd) : "–"}`;

  const kpis = [
    { key: "all" as const, icon: ListBullets, value: counts.all, label: "Alle Partien", tone: "neutral" },
    { key: "strong" as const, icon: Star, value: counts.strong, label: "Starke Tipps", tone: "gold" },
    { key: "recommended" as const, icon: CheckCircle, value: counts.recommended, label: "Empfehlungen", tone: "green" }
  ];

  return <>
  <div className={`app-shell density-${density} ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
    {sidebarOpen && mobileViewport && <button className="sidebar-backdrop" aria-label="Sidebar schließen" onClick={() => setSidebarOpen(false)} />}
    <aside className="sidebar" id="dashboard-sidebar" aria-label="Dashboard-Filter" aria-hidden={mobileViewport && !sidebarOpen}>
      <div className="sidebar-head">
        <div className="brand"><span className="brand-mark">FA</span>{sidebarOpen && <span><strong>Fußball-Analyzer</strong><small>Modell v3.2</small></span>}</div>
        <button className="sidebar-toggle" onClick={() => setSidebarOpen((value) => !value)} aria-controls="dashboard-sidebar" aria-expanded={sidebarOpen} aria-label={sidebarOpen ? "Sidebar einklappen" : "Sidebar ausklappen"} title={sidebarOpen ? "Sidebar einklappen" : "Sidebar ausklappen"}>{sidebarOpen ? <CaretDoubleLeft /> : <CaretDoubleRight />}</button>
      </div>
      {sidebarOpen && <>
        <section className="sidebar-section">
          <h2><CalendarBlank size={14} weight="bold" aria-hidden /> Zeitraum</h2>
          <div className="date-range-control" ref={dateControlRef}>
            <button className={`date-range-trigger ${rangeMode === "custom" ? "active" : ""}`} disabled={!document.meta.firstAvailableDate || !document.meta.lastAvailableDate} aria-label="Datumsbereich auswählen" aria-haspopup="dialog" aria-expanded={calendarOpen} onClick={() => calendarOpen ? setCalendarOpen(false) : openCalendar()}>
              <CalendarBlank size={16} weight="duotone" /><span><strong>Datumsbereich</strong><small>{customStart && customEnd ? `${formatCalendarDate(customStart, { day: "2-digit", month: "2-digit" })} – ${formatCalendarDate(customEnd, { day: "2-digit", month: "2-digit" })}` : "Keine Tage verfügbar"}</small></span>
            </button>
            <button className={`quick-range ${rangeMode === "next48" ? "active" : ""}`} aria-pressed={rangeMode === "next48"} onClick={() => { setRangeMode("next48"); setCalendarOpen(false); }}>48h</button>
            {calendarOpen && document.meta.firstAvailableDate && document.meta.lastAvailableDate && <DateRangePopover
              minimum={document.meta.firstAvailableDate}
              maximum={document.meta.lastAvailableDate}
              start={draftStart}
              end={draftEnd}
              visibleMonth={visibleMonth}
              onVisibleMonthChange={setVisibleMonth}
              onSelect={selectCalendarDate}
              onApply={applyCalendarRange}
              onCancel={() => setCalendarOpen(false)}
            />}
          </div>
          <label className="check-row"><input type="checkbox" checked={showCrossLeague} onChange={(event) => setShowCrossLeague(event.target.checked)} /> Pokal- / Cross-League</label>
          <label className="check-row"><input type="checkbox" checked={showPast} onChange={(event) => setShowPast(event.target.checked)} /> Laufende / beendete Partien</label>
          <p>{rangeLabel}<br />{filtered.length} von {document.meta.fixtureCount} Partien</p>
        </section>
        <section className="sidebar-section">
          <h2><ListBullets size={14} weight="bold" aria-hidden /> Wettbewerbe</h2>
          <button className={`league-filter-trigger ${deselectedLeagues.size > 0 ? "active" : ""}`}
            aria-label="Wettbewerbe auswählen" aria-haspopup="dialog" aria-expanded={leagueFilterOpen}
            onClick={() => setLeagueFilterOpen(true)}>
            <span><strong>Wettbewerbe</strong><small>{availableLeagues.length - deselectedLeagues.size} von {availableLeagues.length} ausgewählt</small></span>
          </button>
        </section>
        <section className="sidebar-section">
          <h2><Calculator size={14} weight="bold" aria-hidden /> Kelly-Kriterium</h2>
          <label className="check-row"><input type="checkbox" checked={showKelly} onChange={(event) => {
            setShowKelly(event.target.checked);
            if (!event.target.checked) setKellyOpen(false);
          }} /> Value & Kelly-Ansicht anzeigen</label>
        </section>
        <section className="sidebar-section kpi-section">
          <h2><Funnel size={14} weight="bold" aria-hidden /> Filter & Kennzahlen</h2>
          {kpis.map(({ key, icon: Icon, value, label, tone }) => <button key={key} className={`kpi ${tone} ${levelFilter === key ? "active" : ""}`} aria-pressed={levelFilter === key} onClick={() => setLevelFilter((current) => current === key ? "all" : key)}>
            <span className="kpi-icon"><Icon size={16} weight="duotone" /></span><span className="kpi-label">{label}</span><strong className="kpi-value">{value}</strong>
          </button>)}
        </section>
        <section className="sidebar-section defense-legend" aria-label="Legende Defensivstärke">
          <h2><ShieldCheck size={14} weight="bold" aria-hidden /> Defensivstärke</h2>
          <span title="Zählt laut Expected Goals Against (xGA) zu den 20 % defensivstärksten Teams der Liga. xGA bewertet die Qualität der gegnerischen Torchancen, nicht nur die tatsächlich kassierten Tore."><ShieldCheck size={16} weight="fill" aria-hidden /> Top 20 %, durch xGA verifiziert</span>
          <span title="Zählt zu den 20 % defensivstärksten Teams der Liga, gemessen an tatsächlich kassierten Toren. xGA-Daten waren für eine genauere Einordnung nicht verfügbar."><Shield size={16} weight="regular" aria-hidden /> Top 20 %, Torhistorie</span>
        </section>
        <div className="sidebar-footer">
          <ClockCounterClockwise size={14} weight="bold" aria-hidden />
          <span>Datenstand: {formatDataTimestamp(document.meta.createdAt, document.meta.timezone)}</span>
        </div>
      </>}
      <div className="mini-kpis" aria-hidden={sidebarOpen || mobileViewport}>{kpis.map(({ key, icon: Icon, value, label, tone }) => <button key={key} tabIndex={sidebarOpen || mobileViewport ? -1 : 0} aria-label={`${label}: ${value} Partien`} aria-pressed={levelFilter === key} title={`${label}: ${value} Partien`} className={`${tone} ${levelFilter === key ? "active" : ""}`} onClick={() => setLevelFilter((current) => current === key ? "all" : key)}><Icon /><small>{value}</small></button>)}</div>
      <span className="mini-footer" role="img" aria-hidden={sidebarOpen || mobileViewport} aria-label={`Datenstand: ${formatDataTimestamp(document.meta.createdAt, document.meta.timezone)}`} title={`Datenstand: ${formatDataTimestamp(document.meta.createdAt, document.meta.timezone)}`}>
        <ClockCounterClockwise size={16} weight="bold" aria-hidden />
      </span>
    </aside>

    <main className="content">
      <button className="mobile-sidebar-toggle" tabIndex={mobileViewport ? 0 : -1} aria-hidden={!mobileViewport} onClick={() => setSidebarOpen(true)} aria-controls="dashboard-sidebar" aria-expanded={sidebarOpen}><ListBullets size={17} weight="duotone" /> Filter & Zeitraum</button>
      {banner && <div className="banner"><span><RocketLaunch size={20} weight="duotone" /></span><p><strong>Grün</strong> markierte Tipps erfüllen alle Modellkriterien, gelbe sind starke Kandidaten. Sortiere über die Spaltenköpfe, filtere Märkte über die Reiter.</p><button onClick={() => { setBanner(false); saveBannerDismissed(); }} aria-label="Hinweis schließen"><X /></button></div>}
      <nav className="market-tabs" aria-label="Marktfilter">
        {availableMarketOptions.map((option) => <button className={marketFilter === option.key ? "active" : ""} aria-pressed={marketFilter === option.key} key={option.key} onClick={() => selectMarket(option.key)}>{option.label}</button>)}
      </nav>
      <div className="view-toolbar">
        <span>H2H</span>
        <div className="segmented" role="group" aria-label="H2H-Ansicht">
          {([ ["outcome", "Ergebnis"], ["btts", "BTTS"], ["over", "Über"], ["firstHalfOver", "1. HZ Über"] ] as const).map(([key, label]) => <button className={h2hView === key ? "active" : ""} aria-pressed={h2hView === key} onClick={() => setH2hView(key)} key={key}>{label}</button>)}
        </div>
        <span>Form</span>
        <div className="segmented" role="group" aria-label="Form-Ansicht">
          {([ ["outcome", "Ergebnis"], ["btts", "BTTS"], ["over", "Über"], ["firstHalfOver", "1. HZ Über"] ] as const).map(([key, label]) => <button className={formView === key ? "active" : ""} aria-pressed={formView === key} onClick={() => setFormView(key)} key={key}>{label}</button>)}
        </div>
        <select
          aria-label={activeLineView === "firstHalfOver" ? "Über-Linie für H2H & Form, 1. Halbzeit" : "Über-Linie für H2H & Form"}
          value={activeLineView === "firstHalfOver" ? firstHalfOverLine : overLine}
          disabled={activeLineView === null}
          onChange={(event) => activeLineView === "firstHalfOver"
            ? setFirstHalfOverLine(Number(event.target.value) as FirstHalfOverLine)
            : setOverLine(Number(event.target.value) as FullTimeOverLine)}
        >
          {activeLineView === "firstHalfOver"
            ? <><option value={0.5}>Über 0,5</option><option value={1.5}>Über 1,5</option></>
            : <><option value={1.5}>Über 1,5</option><option value={2.5}>Über 2,5</option><option value={3.5}>Über 3,5</option></>}
        </select>
        {showKelly && <KellyButton onOpen={() => setKellyOpen(true)} />}
        <div className="segmented density-switch">
          {([ ["micro", "XS"], ["compact", "Kompakt"], ["comfort", "Komfort"] ] as const).map(([key, label]) => <button className={density === key ? "active" : ""} aria-pressed={density === key} onClick={() => setDensity(key)} key={key}>{label}</button>)}
        </div>
      </div>

      <div className="table-scroll">
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
            <CartAddButton fixture={fixture} onOpen={() => setPickerFixtureId(fixture.fixtureId)} />
            <button className={`${fixtureGridClass} fixture-row`} style={gridStyle} onClick={() => setOpenFixture((value) => value === fixture.fixtureId ? null : fixture.fixtureId)} aria-expanded={openFixture === fixture.fixtureId}>
              <span className="fixture-summary-cell">
                <span className="teams-cell">
                  <span className="team-name"><strong>{fixture.homeTeam}</strong><DefenseShield profile={fixture.defense?.home} team={fixture.homeTeam} /></span>
                  <span className="team-name"><strong>{fixture.awayTeam}</strong><DefenseShield profile={fixture.defense?.away} team={fixture.awayTeam} /></span>
                </span>
                <span className="fixture-meta"><strong>{time.clock}{isPast && <em> angepfiffen</em>}</strong><small>{time.day} · <CountryFlag country={fixture.country} /> {fixture.country} · {fixture.league}</small>{(fixture.h2hNotice || fixture.warnings.length > 0) && <i>{fixture.h2hNotice ? "H2H" : "Daten"}</i>}</span>
              </span>
              <span className="form-cell">
                <span className="form-labels" aria-label={fixture.form.scope === "overall" ? "Form insgesamt: Home und Away" : "Heim- und Auswärtsform"}>
                  <small>Home</small><small>Away</small>
                </span>
                <span>{formView === "outcome"
                  ? <><FormDots results={fixture.form.home} /><FormDots results={fixture.form.away} /></>
                  : <>
                    <FormMatchDots matches={fixture.form.homeMatches} view={formView} overLine={overLine} firstHalfOverLine={firstHalfOverLine} />
                    <FormMatchDots matches={fixture.form.awayMatches} view={formView} overLine={overLine} firstHalfOverLine={firstHalfOverLine} />
                  </>}</span>
              </span>
              <span className="h2h-cell"><H2hDots fixture={fixture} view={h2hView} overLine={overLine} firstHalfOverLine={firstHalfOverLine} /></span>
              <span className="expected-cell"><strong>{(showFirstHalfExpected ? fixture.expectedFirstHalfGoals?.home ?? 0 : fixture.expectedGoals.home).toFixed(2).replace(".", ",")}</strong><i>:</i><strong>{(showFirstHalfExpected ? fixture.expectedFirstHalfGoals?.away ?? 0 : fixture.expectedGoals.away).toFixed(2).replace(".", ",")}</strong></span>
              {showScore && <span className="score-cell">{marketFilter !== "draw" && <span><small>1X2</small><strong>{fixture.scores.favorite ?? "–"}</strong></span>}{marketFilter !== "1x2" && <span><small>X</small><strong>{fixture.scores.draw ?? "–"}</strong></span>}</span>}
              {markets.map((item) => <MarketCard market={item} showEdge={showKelly} key={item.key} />)}
            </button>
            </div>
            {openFixture === fixture.fixtureId && (() => {
              const showTable = !fixture.crossLeague && !!fixture.table?.length;
              return <div className={`fixture-details ${showTable ? "has-table" : ""}`}>
              <section><h3>Direkte Begegnungen</h3>{fixture.h2h.matches.length
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
                : <p>Keine H2H-Ergebnisse verfügbar.</p>}</section>
              {showTable && <section><h3>Ligatabelle</h3>
                <table className="standings-table">
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
              <section><h3>Bewertung je Markt</h3><div className="market-details">{fixture.markets.map((item) => <div key={item.key} className={item.recommendation.level}><i /><span><strong>{item.label} · {item.recommendation.label}</strong>{item.details.join(" · ")}</span></div>)}</div></section>
            </div>;
            })()}
          </article>;
        })}
        {sortedFixtures.length === 0 && <EmptyState title="Keine Partien für diese Auswahl" text="Wähle einen anderen Zeitraum oder setze den Bewertungsfilter zurück." />}
      </div>
    </main>
  </div>
  {pickerFixture && <MarketPickerModal
    fixture={pickerFixture}
    cart={cart}
    onSelect={(market) => { addEntry(toCartEntry(pickerFixture, market)); setPickerFixtureId(null); }}
    onClose={() => setPickerFixtureId(null)}
  />}
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
    onSettingsChange={setKellySettings}
    onClose={() => setKellyOpen(false)}
  />}
  </>;
}

export function App() {
  const state = useDashboardData();
  if (state.status === "loading") return <div className="status-screen"><span className="brand-mark">FA</span><strong>Dashboard wird geladen …</strong></div>;
  if (!state.document) return <div className="status-screen"><span className="brand-mark">FA</span><EmptyState title="Noch keine Analyse vorhanden" text={state.message ?? "Starte npm run dashboard -- --dates next48 im Chat."} /></div>;
  return <><Dashboard document={state.document} />{state.status === "error" && <div className="connection-warning" role="status"><WarningCircle size={16} weight="duotone" aria-hidden /><span>{state.message} · Letzter erfolgreicher Stand wird weiter angezeigt.</span></div>}</>;
}
