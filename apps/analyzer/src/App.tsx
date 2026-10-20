import {
  Binoculars, CaretLeft, CaretRight, Crosshair, Info, MagnifyingGlass, RocketLaunch, Shield, ShieldCheck, WarningCircle, X
} from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BetSlipWindow, CartAddMenu, CartButton, type CartPutFeedback } from "./BetCartUI";
import {
  cartEntryId, cartKey, quickpickCartEntry, requestedTotal, toCartEntry, toCounterCartEntry, useBetCart, useComboSetup,
  type CartEntry, type Combo
} from "./betCart";
import { countryFlagCode } from "../../shared/src/countryFlags";
import { FixtureInsightPanels, InsightsNotice, useFixtureInsights } from "./FixtureInsights";
import { useDashboardData } from "../../shared/src/data";
import { heatmapMarkets } from "./heatmap";
import { HeatmapTable, type HeatmapSort } from "./HeatmapTable";
import { useLiveBoard } from "../../shared/src/liveData";
import { LiveView } from "./LiveView";
import {
  effectiveLiveSort,
  LIVE_PHASE_LABELS,
  LIVE_QUESTION_GROUPS,
  liveQuestionLabel,
  loadLiveQuestion,
  questionHasChance,
  saveLiveQuestion,
  visibleLiveMatches,
  type LiveChanceMin,
  type LivePhase,
  type LiveQuestion,
  type LiveSort
} from "./liveQuestions";
import { edgeOf, loadKellyAuto, loadKellySettings, loadKellyVisible, saveKellyAuto, saveKellySettings, saveKellyVisible, selectKelly, type KellySettings } from "./kelly";
import { KellyButton, KellyDialog, formatEuro, kellyProfileNote } from "./KellyUI";
import { FilterButton, FilterChip, FilterMenu, FilterSegment, type ClassGapFilter, type FilterMenuActions, type FilterMenuValues, type LeagueEntry, type LevelFilter, type SegmentOption } from "./FilterMenu";
import { MarketProfileView } from "./MarketProfileUI";
import { BrandMark, NavRail, type NavKey } from "./NavRail";
import { QuickpickButton, QuickpickChip, QuickpickDialog, QuickpickTableTip, type QuickpickCartFeedback } from "./QuickpickUI";
import { applyQuickpick, loadQuickpickStore, saveQuickpickStore, settingsOf, withSettings, QUICKPICK_PRESETS, REJECTION_LABELS, presetOf, type QuickpickFilterReport, type QuickpickPresetId, type QuickpickRejection, type QuickpickStore } from "./quickpick";
import { TeamCrest } from "../../shared/src/TeamCrest";
import { competitionCountry, competitionLeague, competitionMatches, competitionVariants, countryName, displayTeam, fixtureMatches, leagueName, loadNameSource, NamesContext, saveNameSource, selectionText, teamName, useNames, type NameSource } from "../../shared/src/names";
import { SettingsButton, SettingsWindow } from "./SettingsUI";
import { useMarketProfile } from "./marketProfile";
import { eloSystemLabel } from "../../../src/elo-config.ts";
import { gridTemplate, isFirstHalfMarket, isGoalLineMarket, minimumWidth, showsPoints, tableColumns, type TableColumn, type TableColumnId } from "./tableColumns";
import type { ClassGap, DashboardDocument, DashboardFixture, DashboardMarket, DashboardMarketKey, FormResult, LeagueStats, RecommendationLevel } from "../../shared/src/types";

/** Die Zwischenüberschriften der Marktlisten in dieser Reihenfolge. Reine Anzeige, keine Regel liest sie. */
export const MARKET_GROUPS = ["Ergebnis", "BTTS (beide treffen)", "Tore im Spiel", "Tore 1. Halbzeit"] as const;
export type MarketGroup = typeof MARKET_GROUPS[number];

/**
 * Als Record notiert, damit der Compiler bei jedem neuen Markt eine Gruppe verlangt - für die
 * Marktliste der Werkzeugleiste und die Marktauswahl am „Add“-Knopf zugleich.
 */
const MARKET_GROUP_OF: Record<DashboardMarketKey, MarketGroup> = {
  "1x2": "Ergebnis",
  draw: "Ergebnis",
  btts: "BTTS (beide treffen)",
  bttsNo: "BTTS (beide treffen)",
  over15: "Tore im Spiel",
  under15: "Tore im Spiel",
  over25: "Tore im Spiel",
  under25: "Tore im Spiel",
  over35: "Tore im Spiel",
  under35: "Tore im Spiel",
  firstHalfOver05: "Tore 1. Halbzeit",
  firstHalfUnder05: "Tore 1. Halbzeit",
  firstHalfOver15: "Tore 1. Halbzeit",
  firstHalfUnder15: "Tore 1. Halbzeit"
};

export function marketGroupOf(key: DashboardMarketKey): MarketGroup {
  return MARKET_GROUP_OF[key];
}

/**
 * Die Märkte der Auswahlliste. `group` ist die Zwischenüberschrift in der geöffneten Liste
 * (optgroup); „Alle Märkte“ steht ohne Überschrift darüber.
 */
const MARKET_OPTIONS: Array<{ key: "all" | DashboardMarketKey; label: string; group?: MarketGroup }> = ([
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
] as Array<{ key: "all" | DashboardMarketKey; label: string }>).map((option) =>
  option.key === "all" ? option : { ...option, group: MARKET_GROUP_OF[option.key] });

/**
 * Märkte, die auf das Ausbleiben setzen. Für sie kehrt sich die Bedeutung der H2H- und
 * Form-Punkte um: Getroffen hat, wer unter der Linie geblieben ist. Ohne diese Umkehr zeigte
 * die Ansicht zu einem Unter-Markt die Über-Treffer - ein Fehler, der plausibel aussieht.
 */
const COUNTER_MARKETS: DashboardMarketKey[] = [
  "bttsNo", "under15", "under25", "under35", "firstHalfUnder05", "firstHalfUnder15"
];
type MarketFilter = (typeof MARKET_OPTIONS)[number]["key"];

/** Kurznamen für die Kästchen „Empfohlene Märkte“ - dieselben wie in den Kelly-Einstellungen. */
const SHORT_MARKET_LABELS: Record<DashboardMarketKey, string> = {
  "1x2": "1X2", draw: "Remis", btts: "BTTS", bttsNo: "BTTS Nein",
  over15: "Ü1,5", under15: "U1,5", over25: "Ü2,5", under25: "U2,5", over35: "Ü3,5", under35: "U3,5",
  firstHalfOver05: "HZ Ü0,5", firstHalfUnder05: "HZ U0,5", firstHalfOver15: "HZ Ü1,5", firstHalfUnder15: "HZ U1,5"
};
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

/**
 * Die zwei Anzeigen der Pre-Match-Liste. Steht in der Werkzeugleiste und nicht im Filtermenü:
 * Sie blendet kein Spiel aus, genau wie Markt und Sortierung. Ab Werk "Kennzahlen" - Vorteil und
 * Kelly bleiben hinter der Wahl, weil ein großer Vorteil laut Messung meist ein Fehler des
 * Modells ist (Davids Entscheidung vom 25.09.2026). Die Spalten der Tabelle bleiben in beiden
 * gleich; die Kelly-Wetten stehen im eigenen Fenster (Davids Entscheidung vom 29.09.2026).
 */
type DisplayMode = "stats" | "kelly";
const TABLE_MODE_OPTIONS: ReadonlyArray<SegmentOption<DisplayMode>> = [
  { value: "stats", label: "Kennzahlen", title: "Wahrscheinlichkeit, Quote und Kennzahlen je Markt" },
  { value: "kelly", label: "Vorteil & Kelly", title: "Zeigt den Vorteil (Value) in der Marktspalte und öffnet die Kelly-Auswahl im eigenen Fenster; in der Heatmap die Value-Färbung – ein großer Vorteil ist meist ein Fehler des Modells" }
];

/** Der Satz, der im Modus "Vorteil & Kelly" immer unter der Leiste steht. Nicht wegklickbar. */
export const KELLY_WARNING = "Ein großer Vorteil ist meist ein Fehler des Modells. Auch die Kelly-Auswahl lag,"
  + " an alten Spielen geprüft, im Minus – rechne nicht mit Gewinn.";
type SortKey = "kickoff" | "league" | "team" | "form" | "h2h" | "expected" | "score" | "market" | "shots" | "corners" | "confidence";

/** Welche Sortierung ein Spaltenkopf setzt. Spalten ohne Eintrag sind nicht sortierbar. */
const COLUMN_SORT: Partial<Record<TableColumnId, SortKey>> = {
  match: "team", kickoff: "kickoff", form: "form", h2h: "h2h", expected: "expected", points: "score",
  shots: "shots", market: "market", data: "confidence"
};
const SORT_ORDER: SortKey[] = ["kickoff", "league", "team", "form", "h2h", "shots", "corners", "expected", "score", "market", "confidence"];

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

/** "Di 29.09., 11:00" - das Ende von `next48` im Kartenkopf. */
function formatRangeEnd(value: number, timezone: string): string {
  const date = new Date(value);
  const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "short" }).format(date).replace(".", "");
  const day = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(date);
  const clock = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
  return `${weekday} ${day}, ${clock}`;
}

/** Die Wochen eines Monats ab Montag; `null` füllt die Tage vor dem Ersten und nach dem Letzten. */
function monthWeeks(month: string): Array<Array<string | null>> {
  const first = dateOnly(`${month}-01`);
  const cells: Array<string | null> = Array.from({ length: (first.getUTCDay() + 6) % 7 }, () => null);
  for (const cursor = new Date(first); isoDate(cursor).startsWith(month); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    cells.push(isoDate(cursor));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}

/** "2026-10" plus/minus Monate. */
function shiftMonth(month: string, offset: number): string {
  const date = dateOnly(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return isoDate(date).slice(0, 7);
}

const CALENDAR_WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * Zeitraum als richtiger Kalender (Davids Wunsch vom 30.09.2026, vorher eine Reihe Tageskacheln):
 * die Kachel "Nächste 48 Std.", die Felder Von und Bis zum Tippen oder über den Kalender des
 * Browsers, darunter eine Monatsansicht Mo-So mit Blättern. Tage außerhalb der Analyse stehen da,
 * sind aber nicht wählbar. Ein Klick wählt einen Tag, ein zweiter macht daraus einen Zeitraum -
 * sofort wirksam, ohne Übernehmen; während der Wahl zeigt das Überfahren den künftigen Zeitraum.
 * `next48` bleibt strikt ab jetzt und ist kein Kalendertag.
 */
function DayRangePicker({ minimum, maximum, custom, start, end, selectingEnd, onNext48, onSelect, onRange }: {
  minimum: string | null;
  maximum: string | null;
  custom: boolean;
  start: string;
  end: string;
  /** Der erste Tag ist gewählt, der zweite Klick macht einen Zeitraum daraus. */
  selectingEnd: boolean;
  onNext48(): void;
  onSelect(value: string): void;
  /** Von und Bis aus den Eingabefeldern, schon geordnet und begrenzt. */
  onRange(start: string, end: string): void;
}) {
  const [shownMonth, setShownMonth] = useState(() => (custom && start ? start : minimum ?? "").slice(0, 7));
  const [hovered, setHovered] = useState<string | null>(null);
  if (!minimum || !maximum) {
    return <div className="day-range" role="group" aria-label="Zeitraum">
      <button type="button" className={`quick-range${custom ? "" : " active"}`} aria-pressed={!custom}
        aria-label="Nächste 48 Std." title="Ab jetzt genau 48 Stunden – kein Kalendertag" onClick={onNext48}>
        <span>Nächste</span><span>48 Std.</span>
      </button>
      <p className="filter-note">Keine Tage verfügbar.</p>
    </div>;
  }

  const firstMonth = minimum.slice(0, 7);
  const lastMonth = maximum.slice(0, 7);
  // Nach einer neuen Analyse kann der gemerkte Monat außerhalb liegen.
  const month = shownMonth < firstMonth ? firstMonth : shownMonth > lastMonth ? lastMonth : shownMonth;
  const monthTitle = formatCalendarDate(`${month}-01`, { month: "long", year: "numeric" });

  // Während der Wahl zeigt das Überfahren, welcher Zeitraum mit dem nächsten Klick entsteht.
  const preview = custom && selectingEnd && hovered ? hovered : null;
  // Während der Wahl ist start === end, der Zeitraum reicht also vom gewählten zum überfahrenen Tag.
  const rangeStart = preview && preview < start ? preview : start;
  const rangeEnd = preview && preview > end ? preview : end;

  const typed = (field: "start" | "end", value: string) => {
    // Ein geleertes oder halb getipptes Feld liefert "", das lässt den Zeitraum stehen.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const date = clampDate(value, minimum, maximum);
    const otherStart = custom ? start : date;
    const otherEnd = custom ? end : date;
    if (field === "start") onRange(date, date > otherEnd ? date : otherEnd);
    else onRange(date < otherStart ? date : otherStart, date);
    setShownMonth(date.slice(0, 7));
  };

  return <div className="day-range" role="group" aria-label="Zeitraum">
    <button type="button" className={`quick-range${custom ? "" : " active"}`} aria-pressed={!custom}
      aria-label="Nächste 48 Std." title="Ab jetzt genau 48 Stunden – kein Kalendertag" onClick={onNext48}>
      <span>Nächste</span><span>48 Std.</span>
    </button>
    <div className="date-fields">
      <label className="date-field">
        <span>Von</span>
        <input type="date" min={minimum} max={maximum} value={custom ? start : ""}
          onChange={(event) => typed("start", event.target.value)} />
      </label>
      <label className="date-field">
        <span>Bis</span>
        <input type="date" min={minimum} max={maximum} value={custom ? end : ""}
          onChange={(event) => typed("end", event.target.value)} />
      </label>
    </div>
    <div className="calendar" onMouseLeave={() => setHovered(null)}>
      <div className="calendar-head">
        <button type="button" className="calendar-nav" aria-label="Voriger Monat" disabled={month <= firstMonth}
          onClick={() => setShownMonth(shiftMonth(month, -1))}><CaretLeft /></button>
        <strong aria-live="polite">{monthTitle}</strong>
        <button type="button" className="calendar-nav" aria-label="Nächster Monat" disabled={month >= lastMonth}
          onClick={() => setShownMonth(shiftMonth(month, 1))}><CaretRight /></button>
      </div>
      <div className="calendar-grid">
        {CALENDAR_WEEKDAYS.map((weekday) => <span key={weekday} className="calendar-weekday" aria-hidden>{weekday}</span>)}
        {monthWeeks(month).flat().map((date, index) => {
          if (!date) return <span key={`leer-${index}`} aria-hidden />;
          const available = date >= minimum && date <= maximum;
          const selected = custom && date >= start && date <= end;
          const inRange = custom && date >= rangeStart && date <= rangeEnd;
          const edge = custom && (date === rangeStart || date === rangeEnd);
          return <button type="button" key={date}
            className={`calendar-day${inRange ? " in-range" : ""}${edge ? " edge" : ""}${preview && inRange && !selected ? " preview" : ""}`}
            aria-label={formatCalendarDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            aria-pressed={selected} disabled={!available}
            title={available ? undefined : "Keine Analyse für diesen Tag"}
            onMouseEnter={() => setHovered(date)} onClick={() => onSelect(date)}>
            <span className="day-num">{Number(date.slice(-2))}</span>
          </button>;
        })}
      </div>
    </div>
    {/* Nur während der Wahl: Der erste Klick wählt schon einen Tag, und genau dann erklärt
        der Satz den zweiten. Ein Bedienhinweis in Ruhe stand bei jedem Öffnen unter der
        wichtigsten Stellschraube (UX-Review vom 28.09.2026). */}
    {custom && selectingEnd && <p className="filter-note day-range-hint">
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
  item: LeagueEntry,
  stats: LeagueStats | undefined,
  key: LeagueSortKey,
  names: NameSource
): number | string | null {
  // Sortiert wird nach dem, was zu sehen ist.
  if (key === "country") return competitionCountry(item, names);
  if (key === "league") return competitionLeague(item, names);
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
  leagues: LeagueEntry[];
  statsByKey: Map<string, LeagueStats>;
  deselected: Set<string>;
  search: string;
  onSearchChange(value: string): void;
  onToggle(key: string): void;
  onSelectAll(): void;
  onSelectNone(): void;
  onClose(): void;
}) {
  const names = useNames();
  const [sortKey, setSortKey] = useState<LeagueSortKey>("country");
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);

  // Die Suche findet einen Wettbewerb unter beiden Namen, gleich wie der Schalter steht.
  const query = search.trim().toLowerCase();
  const visible = query ? leagues.filter((item) => competitionMatches(item, query)) : leagues;
  const sorted = [...visible].sort((left, right) => {
    const leftValue = leagueSortValue(left, statsByKey.get(left.key), sortKey, names);
    const rightValue = leagueSortValue(right, statsByKey.get(right.key), sortKey, names);
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

  const shownCounts = new Map<string, number>();
  for (const item of leagues) {
    const shown = `${competitionCountry(item, names)} · ${competitionLeague(item, names)}`;
    shownCounts.set(shown, (shownCounts.get(shown) ?? 0) + 1);
  }

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
              const shown = `${competitionCountry(item, names)} · ${competitionLeague(item, names)}`;
              // Zwei API-Ligen mit gleicher Tipico-Anzeige: Der Name des Häkchens muss eindeutig bleiben.
              const label = shownCounts.get(shown)! > 1 ? `${shown} (${item.country} · ${item.league})` : shown;
              return <tr className={deselected.has(item.key) ? "off" : ""} key={item.key}>
                <td><input type="checkbox" checked={!deselected.has(item.key)} onChange={() => onToggle(item.key)} aria-label={label} /></td>
                {/* Die Flagge hängt am Land von API-Football - die Tabelle der Flaggen kennt die englischen Namen. */}
                <td onClick={() => onToggle(item.key)}><CountryFlag country={item.country} /> {competitionCountry(item, names)}</td>
                <td onClick={() => onToggle(item.key)} title={competitionVariants(item, names)}>{competitionLeague(item, names)}</td>
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

const SORT_KEYS: SortKey[] = SORT_ORDER;

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

/**
 * Ein Strich der Form- und H2H-Spalten. `count` steht nur in den Ansichten "Tore" und
 * "Tore 1. HZ" im Strich (Davids Entscheidung vom 11.10.2026); ein leerer String hält dort die
 * Breite, ohne ein "–" zu zeigen, das sich neben Ziffern wie ein Minus läse.
 */
type BarTone = FormResult | "hit" | "miss" | "missing";
interface FormBar { tone: BarTone; title: string; count?: string }

/**
 * Fünf schmale Striche, links das jüngste Spiel, darunter ein kleiner Strich als Markierung.
 * Die Striche sind für Screenreader stumm; die Zusammenfassung wandert als unsichtbarer Text in
 * den Namen der Zeile (die ganze Zeile ist ein Knopf) und nennt deshalb Mannschaft und Markt.
 */
function FormBars({ bars, summary, total }: {
  bars: FormBar[];
  summary: string;
  total?: { value: string; title: string; missing: boolean };
}) {
  return <span className="form-bars-line">
    <span className="form-bars" aria-hidden="true" title={summary}>
      {bars.map((bar, index) => <i
        className={["form-bar", bar.tone, bar.count !== undefined ? "count" : "", index === 0 && bar.tone !== "missing" ? "latest" : ""].filter(Boolean).join(" ")}
        title={bar.title} key={index}>{bar.count}</i>)}
    </span>
    <span className="visually-hidden">{summary}</span>
    {total && <strong className={`form-total${total.missing ? " missing" : ""}`} title={total.title} aria-hidden="true">{total.value}</strong>}
  </span>;
}

const MISSING_BAR: FormBar = { tone: "missing", title: "Kein Spiel" };

function padBars(bars: FormBar[], counted = false): FormBar[] {
  const padded = bars.slice(0, 5);
  while (padded.length < 5) padded.push(counted ? { ...MISSING_BAR, count: "" } : MISSING_BAR);
  return padded;
}

/**
 * Ein API-Teamname aus früheren Spielen, angezeigt nach Einstellung: Nur die beiden Mannschaften
 * des Spiels haben einen Tipico-Namen (`displayTeam` in `names.ts`).
 */
type Rename = (apiName: string) => string;
const SAME_NAME: Rename = (name) => name;

/** Stand immer als „Heim Tore:Tore Gast“ - „2:1“ allein ließe offen, wer zwei Tore hatte. */
function scoreLine(match: MatchSummary, rename: Rename = SAME_NAME): string {
  return `${rename(match.homeTeam)} ${match.homeGoals}:${match.awayGoals} ${rename(match.awayTeam)}`;
}

function matchDate(match: MatchSummary, timezone: string): string {
  const date = new Date(match.date);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
}

function matchDetail(match: MatchSummary | undefined, timezone: string, rename: Rename = SAME_NAME): string {
  if (!match) return "";
  const date = matchDate(match, timezone);
  return ` · ${scoreLine(match, rename)}${date ? ` · ${date}` : ""}`;
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Punkte aus der Form: Sieg 3, Unentschieden 1 - dieselbe Rechnung wie `formDelta` der Heatmap. */
function formPoints(results: FormResult[]): number {
  return results.reduce((sum, result) => sum + (result === "win" ? 3 : result === "draw" ? 1 : 0), 0);
}

function FormOutcomeBars({ team, results, matches, timezone, rename = SAME_NAME }: {
  team: string;
  results: FormResult[];
  matches: MatchSummary[] | undefined;
  timezone: string;
  rename?: Rename;
}) {
  // Stand und Datum nur, wenn beide Listen sicher zusammenpassen. Ältere Läufe ohne
  // `homeMatches` zeigen dann nur das Wort.
  const aligned = matches !== undefined && matches.length === results.length;
  const shown = results.slice(0, 5);
  const words: Record<FormResult, string> = { win: "Sieg", draw: "Unentschieden", loss: "Niederlage" };
  const bars = padBars(shown.map((result, index) => ({
    tone: result,
    title: `${words[result]}${aligned ? matchDetail(matches[index], timezone, rename) : ""}`
  })));
  const points = formPoints(shown);
  const games = shown.length;
  const parts = [
    countPhrase(countResults(shown, "win"), "Sieg", "Siege"),
    countPhrase(countResults(shown, "draw"), "Unentschieden", "Unentschieden"),
    countPhrase(countResults(shown, "loss"), "Niederlage", "Niederlagen")
  ].filter((part) => !part.startsWith("0 "));
  const pointsText = games === 5 ? `${points} Punkte` : `${points} Punkte aus ${countPhrase(games, "Spiel", "Spielen")}`;
  const summary = games === 0 ? `${team}: keine Spiele` : `${team}: ${pointsText} – ${parts.join(", ")}`;
  const total = games === 0
    ? { value: "–", title: "Keine Spiele", missing: true }
    : {
      value: String(points),
      title: games === 5
        ? `${points} von 15 Punkten aus den letzten 5 Spielen (Sieg 3, Unentschieden 1)`
        : `${points} Punkte aus ${countPhrase(games, "Spiel", "Spielen")} (Sieg 3, Unentschieden 1)`,
      missing: false
    };
  return <FormBars bars={bars} summary={summary} total={total} />;
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

/**
 * Erwartete Tore mit zwei Nachkommastellen. Läufe vor Schema 2 führen keine Halbzeitwerte -
 * dann steht ein Strich, keine 0,00, die eine torlose Halbzeit behauptete.
 */
function goalLabel(value: number | undefined): string {
  return value === undefined ? "–" : value.toFixed(2).replace(".", ",");
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
  const names = useNames();
  const home = recentValue(fixture, "home", field);
  const away = recentValue(fixture, "away", field);
  const title = home === null && away === null
    ? `${label}: für diese Liga gibt es keine Zahlen`
    : `${label} im Schnitt der letzten fünf Spiele – ${teamName(fixture, "home", names)}: ${recentLabel(home)}, ${teamName(fixture, "away", names)}: ${recentLabel(away)}`;
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
    title={`Elo ${elo} (${eloSystemLabel(value.system)}): Stärkewert von ${team} aus den Spielen der letzten fünf Jahre.`
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

type ViewBarValue = { value: boolean | null; title: string; count?: string };

function matchViewBars(
  matches: MatchSummary[],
  view: Exclude<H2hView, "outcome">,
  overLine: FullTimeOverLine,
  firstHalfOverLine: FirstHalfOverLine,
  /** Bei einem Gegenmarkt zählt das Ausbleiben als Treffer. */
  inverted = false,
  rename: Rename = SAME_NAME
): ViewBarValue[] {
  const values: ViewBarValue[] = view === "btts"
    ? matches.map((match) => {
      const both = match.homeGoals > 0 && match.awayGoals > 0;
      const value = inverted ? !both : both;
      // Kein ✓/× im Strich: Grün ✓ heißt in der Tabelle „empfehlenswert“.
      return { value, title: `${both ? "Beide Teams treffen" : "Nicht beide Teams treffen"} · Endstand ${scoreLine(match, rename)}` };
    })
    // Über/Unter zeigt die Torzahl im Strich: Die Farbe sagt schon, ob die Linie gerissen
    // wurde. Die Zahl beantwortet stattdessen, wie deutlich - ein 5:2 und ein 2:1 sind beide
    // "Ü", aber nicht dasselbe.
    : view === "firstHalfOver"
      ? matches.map((match) => {
        if (typeof match.halfTimeHomeGoals !== "number" || typeof match.halfTimeAwayGoals !== "number") {
          return { value: null, count: "", title: "Kein Halbzeitstand verfügbar" };
        }
        const goals = match.halfTimeHomeGoals + match.halfTimeAwayGoals;
        const over = goals > firstHalfOverLine;
        const value = inverted ? !over : over;
        return {
          value,
          count: String(goals),
          title: `1. Halbzeit ${rename(match.homeTeam)} ${match.halfTimeHomeGoals}:${match.halfTimeAwayGoals} ${rename(match.awayTeam)} · ${goals} Tor${goals === 1 ? "" : "e"} · ${over ? "Über" : "Unter"} ${firstHalfOverLine.toLocaleString("de-DE")}`
        };
      })
      : matches.map((match) => {
        const goals = match.homeGoals + match.awayGoals;
        const over = goals > overLine;
        const value = inverted ? !over : over;
        return {
          value,
          count: String(goals),
          title: `Endstand ${scoreLine(match, rename)} · ${goals} Tor${goals === 1 ? "" : "e"} · ${over ? "Über" : "Unter"} ${overLine.toLocaleString("de-DE")}`
        };
      });
  while (values.length < 5) values.push(view === "btts" ? { value: null, title: "Kein Spiel" } : { value: null, count: "", title: "Kein Spiel" });
  return values.slice(0, 5);
}

/** Der Markt einer Treffer-Ansicht in Worten, für Zusammenfassung und Spaltenkopf. */
function viewMarketLabel(
  view: Exclude<H2hView, "outcome">,
  overLine: FullTimeOverLine,
  firstHalfOverLine: FirstHalfOverLine,
  inverted: boolean
): string {
  if (view === "btts") return inverted ? "BTTS Nein" : "BTTS";
  const direction = inverted ? "Unter" : "Über";
  return view === "over"
    ? `${direction} ${overLine.toLocaleString("de-DE")}`
    : `1. HZ ${direction} ${firstHalfOverLine.toLocaleString("de-DE")}`;
}

function formMatchesStreak(
  matches: MatchSummary[] | undefined,
  view: Exclude<FormView, "outcome">,
  overLine: FullTimeOverLine,
  firstHalfOverLine: FirstHalfOverLine,
  inverted = false
): number {
  return consecutive(matchViewBars(matches ?? [], view, overLine, firstHalfOverLine, inverted).map((item) => item.value));
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

/** Der Hinweis im Spaltenkopf erklärt die Striche der gerade gewählten Ansicht. */
function pairHeadTitle(
  kind: "form" | "h2h",
  view: H2hView,
  overLine: FullTimeOverLine,
  firstHalfOverLine: FirstHalfOverLine,
  inverted: boolean
): string {
  const intro = kind === "h2h"
    ? "H2H: die direkten Duelle beider Mannschaften. Links das jüngste Spiel, der kleine Strich darunter markiert es."
    : "Die letzten 5 Spiele, oben Heim, unten Gast. Links das jüngste Spiel, der kleine Strich darunter markiert es.";
  if (view === "outcome") {
    return kind === "h2h"
      ? `${intro} Der Strich hat die Farbe der Mannschaft, die gewann, wie ihr Name links; Grau unentschieden, leer: kein Spiel.`
      : `${intro} Grün Sieg, Grau Unentschieden, Rot Niederlage, leer: kein Spiel. Rechts die Punkte (Sieg 3, Unentschieden 1).`;
  }
  const label = viewMarketLabel(view, overLine, firstHalfOverLine, inverted);
  const count = view === "over" ? " Die Zahl im Strich: Tore im Spiel."
    : view === "firstHalfOver" ? " Die Zahl im Strich: Tore in der 1. Halbzeit." : "";
  return `${intro} Grün: passt zu ${label}, Rot: passt nicht, leer: kein Spiel.${count}`;
}

function MatchViewBars({ subject, matches, view, overLine, firstHalfOverLine, inverted, rename = SAME_NAME }: {
  /** Die Mannschaft der Formreihe oder „H2H“. */
  subject: string;
  matches: MatchSummary[] | undefined;
  view: Exclude<H2hView, "outcome">;
  overLine: FullTimeOverLine;
  firstHalfOverLine: FirstHalfOverLine;
  inverted: boolean;
  rename?: Rename;
}) {
  const values = matchViewBars(matches ?? [], view, overLine, firstHalfOverLine, inverted, rename);
  const bars = values.map((item): FormBar => ({
    tone: item.value === null ? "missing" : item.value ? "hit" : "miss",
    title: item.title,
    ...(item.count !== undefined ? { count: item.count } : {})
  }));
  const known = values.filter((item) => item.value !== null);
  const hits = known.filter((item) => item.value === true).length;
  const label = viewMarketLabel(view, overLine, firstHalfOverLine, inverted);
  const summary = known.length === 0
    ? `${subject} ${label}: keine Spiele`
    : `${subject} ${label}: passt in ${hits} von ${countPhrase(known.length, "Spiel", "Spielen")}`;
  return <FormBars bars={bars} summary={summary} />;
}

function H2hBars({ fixture, view, overLine, firstHalfOverLine, inverted, timezone }: {
  fixture: DashboardFixture;
  view: H2hView;
  overLine: FullTimeOverLine;
  firstHalfOverLine: FirstHalfOverLine;
  inverted: boolean;
  timezone: string;
}) {
  const names = useNames();
  const rename: Rename = (name) => displayTeam(name, fixture, names);
  const home = teamName(fixture, "home", names);
  const away = teamName(fixture, "away", names);
  if (view !== "outcome") {
    return <MatchViewBars subject="H2H" matches={fixture.h2h.matches} view={view} overLine={overLine}
      firstHalfOverLine={firstHalfOverLine} inverted={inverted} rename={rename} />;
  }
  // H2H aus Sicht der heutigen Heimmannschaft: Der Strich trägt die Farbe der Mannschaft, die
  // gewann, wie ihr Name in der Spalte „Spiel“. Der Hinweis nennt sie beim Namen.
  const outcomes = fixture.h2h.outcomes.slice(0, 5);
  const aligned = fixture.h2h.matches.length === fixture.h2h.outcomes.length;
  const word = (result: FormResult) => result === "win" ? `Sieg ${home}`
    : result === "loss" ? `Sieg ${away}` : "Unentschieden";
  const bars = padBars(outcomes.map((result, index) => ({
    tone: result,
    title: `${word(result)}${aligned ? matchDetail(fixture.h2h.matches[index], timezone, rename) : ""}`
  })));
  const parts = [
    countPhrase(countResults(outcomes, "win"), `Sieg ${home}`, `Siege ${home}`),
    countPhrase(countResults(outcomes, "draw"), "Unentschieden", "Unentschieden"),
    countPhrase(countResults(outcomes, "loss"), `Sieg ${away}`, `Siege ${away}`)
  ].filter((part) => !part.startsWith("0 "));
  const summary = outcomes.length === 0 ? "H2H: keine Duelle" : `H2H: ${parts.join(", ")}`;
  return <FormBars bars={bars} summary={summary} />;
}

/** `selection`: der Tipp als Text nach Namens-Einstellung (`selectionText`); ohne Angabe der des Backends. */
export function MarketCard({ market, showEdge, selection = market.selection }: { market: DashboardMarket; showEdge: boolean; selection?: string }) {
  const percentage = Math.round(market.probability * 100);
  const reliable = market.probabilityReliable !== false;
  const edge = showEdge ? edgeOf(market) : null;
  return <div
    className={`market-card ${market.recommendation.level}${reliable ? "" : " unreliable"}`}
    title={reliable
      ? `${selection} · ${market.recommendation.label}`
      : `${selection} · ohne Ligastärke-Vergleich keine belastbare Wahrscheinlichkeit`}
  >
    <div className="market-line">
      <span className="level-glyph">{levelGlyph(market.recommendation.level)}</span>
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

export function levelGlyph(level: RecommendationLevel): string {
  return level === "strong" ? "★" : level === "recommended" ? "✓" : "·";
}

/**
 * Bei „Alle Märkte“ steht neben der 1X2-Zelle nur, was eine Empfehlung trägt - statt vierzehn
 * Kästchen, für die die Tabelle seitlich scrollte. ★ vor ✓, damit sichtbar bleibt, warum ein
 * Spiel den Stufenfilter besteht. Höchstens drei, der Rest als Zahl mit den Namen im Tooltip;
 * alle Märkte stehen aufgeklappt unter „Bewertung je Markt“. Ohne belastbare Wahrscheinlichkeit
 * erscheint ein Markt hier nie. Nur title, kein Knopf: Die ganze Zeile ist schon einer.
 */
function RecommendedMarkets({ fixture }: { fixture: DashboardFixture }) {
  const picks = fixture.markets
    .filter((market) => market.key !== "1x2" && market.recommendation.level !== "none" && market.probabilityReliable !== false)
    .sort((left, right) => levelRank[right.recommendation.level] - levelRank[left.recommendation.level]);
  if (picks.length === 0) return <span className="recommended-cell empty" title="Kein weiterer Markt mit Empfehlung">–</span>;
  const rest = picks.slice(3);
  return <span className="recommended-cell">
    {picks.slice(0, 3).map((market) => <span key={market.key} className={`rec-chip ${market.recommendation.level}`}
      title={`${market.label} · ${market.selection} · Quote ${formatOdd(market.odds)} · ${formatPercent(market.probability)} · ${market.recommendation.label}`}>
      <span className="level-glyph">{levelGlyph(market.recommendation.level)}</span>
      {SHORT_MARKET_LABELS[market.key]} · {formatOdd(market.odds)} · {Math.round(market.probability * 100)} %
    </span>)}
    {rest.length > 0 && <span className="rec-more" title={rest.map((market) => `${market.label} (${market.recommendation.label})`).join(" · ")}>
      +{rest.length}
    </span>}
  </span>;
}

/**
 * Das Datenvertrauen stand früher nirgends in der Zeile, obwohl es die Empfehlung mitbestimmt.
 * Darunter die Zahl der Hinweise, der Wortlaut im Tooltip - früher ein blaues Kürzel „Daten“.
 */
function DataCell({ fixture, market }: { fixture: DashboardFixture; market: DashboardMarket | undefined }) {
  const confidence = Math.round(market ? market.confidence : fixture.dataConfidence);
  const count = fixture.warnings.length;
  return <span className="data-cell"
    title={count > 0 ? `Datenvertrauen ${confidence} % · Hinweise zu den Daten: ${fixture.warnings.join(" · ")}` : `Datenvertrauen ${confidence} %`}>
    <strong>{confidence} %</strong>
    {count > 0 && <small><WarningCircle size={11} weight="bold" aria-hidden />{count} {count === 1 ? "Hinweis" : "Hinweise"}</small>}
  </span>;
}

export function ClassGapBadge({ gap, homeTeam, awayTeam }: { gap: ClassGap; homeTeam: string; awayTeam: string }) {
  const stronger = gap.stronger === "home" ? homeTeam : awayTeam;
  const title = `${gap.level === "extreme" ? "Sehr großer" : "Deutlicher"} Klassenunterschied · ${stronger} ist die höhere Klasse · `
    + `${gap.source === "rating" ? "Modell" : gap.source === "elo" ? "Team-Elo" : "Markt"}: ${gap.label}`;
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
  // Filtermenü, Quickpicker, Wettschein und Einstellungen - offen ist höchstens eins.
  const [openMenu, setOpenMenu] = useState<"filter" | "quickpick" | "cart" | "settings" | null>(null);
  const filterMenuOpen = openMenu === "filter";
  const quickpickOpen = openMenu === "quickpick";
  const cartOpen = openMenu === "cart";
  const settingsOpen = openMenu === "settings";
  const closeMenuIfOpen = (menu: NonNullable<typeof openMenu>) => setOpenMenu((current) => current === menu ? null : current);
  const setFilterMenuOpen = (open: boolean) => open ? setOpenMenu("filter") : closeMenuIfOpen("filter");
  const setQuickpickOpen = (open: boolean) => open ? setOpenMenu("quickpick") : closeMenuIfOpen("quickpick");
  const setCartOpen = (open: boolean) => open ? setOpenMenu("cart") : closeMenuIfOpen("cart");
  const setSettingsOpen = (open: boolean) => open ? setOpenMenu("settings") : closeMenuIfOpen("settings");
  const settingsAnchorRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  // Welche Namen die App zeigt (Einstellungen); gemerkt, ab Werk Tipico.
  const [nameSource, setNameSource] = useState<NameSource>(loadNameSource);
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
  const [cartMenuFixtureId, setCartMenuFixtureId] = useState<number | null>(null);
  // „In der Tabelle zeigen“ im Quickpicker: zu diesem Spiel scrollen, sobald die Zeile steht.
  const [scrollToFixture, setScrollToFixture] = useState<number | null>(null);
  useEffect(() => {
    if (scrollToFixture === null) return;
    const row = window.document.querySelector(`[data-fixture-id="${scrollToFixture}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
    // Sonst bliebe der Fokus auf dem Knopf im gerade geschlossenen Quickpicker.
    row?.querySelector<HTMLButtonElement>(".fixture-row")?.focus({ preventScroll: true });
    setScrollToFixture(null);
  }, [scrollToFixture]);
  // Der Wettschein hängt wie Filter und Quickpicker als nicht-modales Fenster unter seinem Knopf.
  const cartAnchorRef = useRef<HTMLDivElement>(null);
  const cartButtonRef = useRef<HTMLButtonElement>(null);
  // Die Kombis leben hier statt im Fenster: Sie überstehen das Schließen, nicht aber ein Neuladen
  // (Davids Entscheidung vom 11.10.2026). `mixedKey` ist der Abdruck des Wettscheins beim Mischen.
  const [combos, setCombos] = useState<Combo[]>([]);
  const [mixedKey, setMixedKey] = useState("");
  const [comboSetup, setComboSetup] = useComboSetup();
  const [kellyOpen, setKellyOpen] = useState(false);
  const [showKelly, setShowKelly] = useState(() => loadKellyVisible());
  const [liveRatedOnly, setLiveRatedOnly] = useState(false);
  // Live hat eine eigene Frage statt des Marktes der Tabelle: „Noch ein Tor“ oder „Nächstes Tor“
  // gibt es vor dem Anpfiff nicht, und ein Wechsel in Live stellte sonst die Tabelle mit um.
  const [liveQuestion, setLiveQuestion] = useState<LiveQuestion>(loadLiveQuestion);
  const [liveSort, setLiveSort] = useState<LiveSort>("kickoff");
  // Die Anzeige-Filter werden wie alle Filter nicht gespeichert.
  const [liveChanceMin, setLiveChanceMin] = useState<LiveChanceMin>("all");
  const [liveRedOnly, setLiveRedOnly] = useState(false);
  const [livePhase, setLivePhase] = useState<LivePhase>("all");
  const [kellySettings, setKellySettings] = useState<KellySettings>(() => loadKellySettings());
  const quickpickAnchorRef = useRef<HTMLDivElement>(null);
  const quickpickButtonRef = useRef<HTMLButtonElement>(null);
  // Die Regler werden gespeichert, der aktive Zustand nicht: Ein Filter, der nach einem
  // Neuladen unbemerkt fast alle Zeilen ausblendet, wäre dieselbe Falle wie der geerbte
  // Einsatzrahmen der Kelly-Automatik, der wochenlang unentdeckt auf 100 % stand.
  const [quickpickActive, setQuickpickActive] = useState(false);
  // Die Suche über der Tabelle. Bewusst nicht gemerkt: Eine vergessene Suche, die nach dem Neuladen
  // fast alle Spiele ausblendet, wäre dieselbe Falle wie ein gemerkter Quickpick-Filter.
  const [search, setSearch] = useState("");
  // Beide Voreinstellungen behalten ihre eigenen Regler; gewechselt wird nur, welche aktiv ist.
  const [quickpickStore, setQuickpickStore] = useState<QuickpickStore>(loadQuickpickStore);
  const quickpickSettings = settingsOf(quickpickStore);
  const { cart, lastChange, putEntry, putEntries, removeEntry, removeStarted, clear: clearCart, undo: undoCart } = useBetCart();
  // Was „Alle n in den Wettschein“ getan hat - der Quickpicker meldet es im Fuß, statt den
  // Wettschein zu öffnen. `changeId` sagt, ob „Rückgängig“ noch genau diesen Schritt zurücknimmt.
  const [cartFeedback, setCartFeedback] = useState<QuickpickCartFeedback | null>(null);
  // Gegensätze ersetzen einander: Beim 1X2 teilen sich Modelltipp und Gegenseite eine Kennung,
  // und Remis verdrängt einen Sieger-Tipp desselben Spiels (`putEntriesInto`).
  const addFromMenu = (fixture: DashboardFixture, market: DashboardMarket, counterSide: "1" | "2" | null): CartPutFeedback | null => {
    const entry = counterSide === null ? toCartEntry(fixture, market) : toCounterCartEntry(fixture, market);
    if (!entry) return null;
    return { entry, replaced: putEntry(entry) };
  };
  const watchedFixtureIds = useMemo(() => document.fixtures
    .filter((fixture) => !deselectedLeagues.has(leagueKey(fixture.country, fixture.league)))
    .filter((fixture) => !liveRatedOnly
      || fixture.markets.some((market) => market.recommendation.level !== "none"))
    .map((fixture) => fixture.fixtureId),
    [deselectedLeagues, document, liveRatedOnly]);
  const live = useLiveBoard(view === "live", watchedFixtureIds);
  const marketProfile = useMarketProfile(showKelly && view === "prematch");
  const now = Date.now();

  // Eine Zeile je API-Liga (`leagueKey`, daran hängt die gemerkte Abwahl), dazu alle
  // Tipico-Bezeichnungen ihrer Spiele - eine API-Liga kann bei Tipico mehrere Gruppen haben.
  const availableLeagues = useMemo(() => {
    const map = new Map<string, LeagueEntry & { count: number; tipicoCountries: string[]; tipicoLeagues: string[] }>();
    for (const fixture of document.fixtures) {
      const key = leagueKey(fixture.country, fixture.league);
      const entry = map.get(key) ?? { key, country: fixture.country, league: fixture.league, count: 0, tipicoCountries: [], tipicoLeagues: [] };
      entry.count += 1;
      if (fixture.tipico) {
        entry.tipicoCountries.push(fixture.tipico.country);
        entry.tipicoLeagues.push(fixture.tipico.league);
      }
      map.set(key, entry);
    }
    return [...map.values()].sort((left, right) =>
      competitionCountry(left, nameSource).localeCompare(competitionCountry(right, nameSource), "de")
      || competitionLeague(left, nameSource).localeCompare(competitionLeague(right, nameSource), "de"));
  }, [document, nameSource]);

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
    setCartMenuFixtureId((value) => value !== null && document.fixtures.some((fixture) => fixture.fixtureId === value) ? value : null);
    setMarketFilter((value) => value === "all" || document.fixtures.some((fixture) => fixture.markets.some((market) => market.key === value)) ? value : "all");
    setDeselectedLeagues((prev) => new Set([...prev].filter((key) => availableLeagues.some((item) => item.key === key))));
  }, [availableLeagues, document]);

  // Schließt das Menü; auf Wunsch kehrt der Fokus zum Knopf zurück (Escape, ✕), statt im
  // verschwundenen Menü ins Leere zu fallen.
  const closeFilterMenu = (returnFocus: boolean) => {
    setFilterMenuOpen(false);
    if (returnFocus) filterButtonRef.current?.focus();
  };
  // Dieselben Regeln für den Quickpicker. Schließen hebt den Filter nie auf - das ist das ✕ am
  // Schildchen oder der Schalter „Tabelle filtern“, eine bewusste Handlung.
  const closeQuickpick = (returnFocus: boolean) => {
    setQuickpickOpen(false);
    if (returnFocus) quickpickButtonRef.current?.focus();
  };
  const closeCart = (returnFocus: boolean) => {
    setCartOpen(false);
    if (returnFocus) cartButtonRef.current?.focus();
  };
  const closeSettings = (returnFocus: boolean) => {
    setSettingsOpen(false);
    if (returnFocus) settingsButtonRef.current?.focus();
  };
  // Ein Zustand für alle vier Fenster - das Öffnen des einen schließt die anderen von selbst.
  const openFilterMenu = () => setOpenMenu("filter");
  const openQuickpick = () => setOpenMenu("quickpick");
  const openCart = () => setOpenMenu("cart");

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
    if (!quickpickOpen) {
      // Die Rückmeldung gilt dem letzten Klick in diesem Fenster - beim nächsten Öffnen nicht mehr.
      setCartFeedback(null);
      return;
    }
    const closeOutside = (event: PointerEvent) => {
      if (!quickpickAnchorRef.current?.contains(event.target as Node)) setQuickpickOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [quickpickOpen]);

  useEffect(() => {
    if (!cartOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!cartAnchorRef.current?.contains(event.target as Node)) setCartOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [cartOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!settingsAnchorRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [settingsOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (cartMenuFixtureId !== null) setCartMenuFixtureId(null);
      // Schließt nur die Einstellungen - nicht zusätzlich die aufgeklappte Zeile dahinter.
      else if (settingsOpen) closeSettings(true);
      else if (cartOpen) closeCart(true);
      else if (kellyOpen) setKellyOpen(false);
      // Schließt nur das Panel und hebt den Filter nicht auf - das ist der Klick aufs ✕ im
      // Streifen, eine bewusste Handlung statt eines Nebeneffekts vom Wegklicken.
      else if (quickpickOpen) closeQuickpick(true);
      // Der Wettbewerbe-Dialog liegt über dem Menü - von oben nach unten.
      else if (leagueFilterOpen) setLeagueFilterOpen(false);
      else if (filterMenuOpen) closeFilterMenu(true);
      else if (openFixture !== null) setOpenFixture(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [cartOpen, filterMenuOpen, kellyOpen, leagueFilterOpen, openFixture, quickpickOpen, cartMenuFixtureId, settingsOpen]);

  const selectNav = (key: NavKey) => {
    if (key === "table" || key === "heatmap") {
      setView("prematch");
      setLayout(key);
    } else {
      setView(key);
    }
    // Die Fenster hängen an der Werkzeugleiste; ohne das gingen sie nach Live und zurück
    // von selbst wieder auf. Die Einstellungen schließen ebenso.
    setOpenMenu(null);
  };

  useEffect(() => { saveView(view); }, [view]);
  useEffect(() => { saveLayout(layout); }, [layout]);
  useEffect(() => { saveSort({ key: sortKey, direction: sortDirection }); }, [sortKey, sortDirection]);
  useEffect(() => { saveKellySettings(kellySettings); }, [kellySettings]);
  useEffect(() => { saveQuickpickStore(quickpickStore); }, [quickpickStore]);
  useEffect(() => { saveKellyVisible(showKelly); }, [showKelly]);
  useEffect(() => { saveKellyAuto(kellyAuto); }, [kellyAuto]);
  useEffect(() => { saveNameSource(nameSource); }, [nameSource]);

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
  // Von und Bis aus den Eingabefeldern: ein fertiger Zeitraum, der nächste Klick beginnt neu.
  const selectCalendarRange = (start: string, end: string) => {
    setCustomStart(start);
    setCustomEnd(end);
    setRangeMode("custom");
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
  // Eine Rechnung für Kelly-Zeile und Dialog - auf dem Umfang, nicht auf `filtered`.
  // Ohne useMemo: `scopedFixtures` und `now` entstehen je Render neu, und die Rechnung ist billig.
  // `now` hält angepfiffene Spiele heraus, auch wenn „Laufende / beendete Partien“ sie in der
  // Tabelle zeigt: Ihre Quote stammt von vor dem Anpfiff.
  const kellySelection = showKelly && view === "prematch"
    ? selectKelly(scopedFixtures, marketFilter, kellySettings, kellyAuto, marketProfile.profile, { now })
    : null;
  const quickpickLabel = presetOf(quickpickSettings).label;
  // Die Suche grenzt wie Quickpick und Stufe nur die Tabelle ein, nicht den Umfang - Kelly und die
  // Zähler im Filtermenü bleiben unberührt.
  const filtered = scopedFixtures.filter((fixture) => {
    if (!fixtureMatches(fixture, search)) return false;
    if (quickpickActive && !quickpick.passing.has(fixture.fixtureId)) return false;
    if (classGapFilter === "only" && !fixture.classGap) return false;
    if (classGapFilter === "hide" && fixture.classGap) return false;
    const level = bestLevel(fixture, marketFilter);
    return levelFilter === "all" || (levelFilter === "strong" ? level === "strong" : levelRank[level] >= levelRank.recommended);
  });

  const heatmap = layout === "heatmap";
  const columns = tableColumns(marketFilter);
  const selectedMarketKey: DashboardMarketKey = marketFilter === "all" ? "1x2" : marketFilter;
  // Das Datenvertrauen des gezeigten Marktes; bei „Alle Märkte“ das des Spiels.
  const dataMarketOf = (fixture: DashboardFixture): DashboardMarket | undefined =>
    marketFilter !== "all" ? marketFor(fixture, selectedMarketKey) : undefined;
  const confidenceOf = (fixture: DashboardFixture): number => dataMarketOf(fixture)?.confidence ?? fixture.dataConfidence;
  // Sortierbar ist nur, was zu sehen ist. Eine gemerkte Wahl auf eine ausgeblendete Spalte fällt
  // auf den Anstoß zurück, wird aber nicht überschrieben - beim Zurückwechseln ist sie wieder da.
  const sortableKeys: SortKey[] = heatmap
    ? ["kickoff", "league", "team", "form", "h2h", "shots", "corners", "expected", ...(showsPoints(marketFilter) ? ["score" as const] : []), "market"]
    : (["kickoff", "league", ...columns.flatMap((column) => COLUMN_SORT[column.id] ?? [])] as SortKey[]);
  const effectiveSortKey: SortKey = sortableKeys.includes(sortKey) ? sortKey : "kickoff";
  const effectiveDirection: 1 | -1 = effectiveSortKey === sortKey ? sortDirection : 1;

  const sortedFixtures = [...filtered].sort((left, right) => {
    const byKickoff = Date.parse(left.kickoff) - Date.parse(right.kickoff);
    let comparison = 0;
    if (effectiveSortKey === "kickoff") comparison = byKickoff;
    else if (effectiveSortKey === "league") comparison = `${countryName(left, nameSource)} ${leagueName(left, nameSource)}`.localeCompare(`${countryName(right, nameSource)} ${leagueName(right, nameSource)}`, "de");
    else if (effectiveSortKey === "team") comparison = `${teamName(left, "home", nameSource)} ${teamName(left, "away", nameSource)}`.localeCompare(`${teamName(right, "home", nameSource)} ${teamName(right, "away", nameSource)}`, "de");
    else if (effectiveSortKey === "expected") {
      const firstHalf = isFirstHalfMarket(marketFilter);
      comparison = (firstHalf ? left.expectedFirstHalfGoals?.total ?? -1 : left.expectedGoals.total) -
        (firstHalf ? right.expectedFirstHalfGoals?.total ?? -1 : right.expectedGoals.total);
    }
    else if (effectiveSortKey === "shots") comparison = recentSortValue(left, "shotsOnGoal") - recentSortValue(right, "shotsOnGoal");
    else if (effectiveSortKey === "corners") comparison = recentSortValue(left, "corners") - recentSortValue(right, "corners");
    else if (effectiveSortKey === "score") comparison = (marketFilter === "draw" ? left.scores.draw ?? -1 : left.scores.favorite ?? -1) - (marketFilter === "draw" ? right.scores.draw ?? -1 : right.scores.favorite ?? -1);
    else if (effectiveSortKey === "market") comparison = (marketFor(left, selectedMarketKey)?.probability ?? -1) - (marketFor(right, selectedMarketKey)?.probability ?? -1);
    else if (effectiveSortKey === "confidence") comparison = confidenceOf(left) - confidenceOf(right);
    else if (effectiveSortKey === "form" || effectiveSortKey === "h2h") {
      comparison = columnComparison(effectiveSortKey, left, right, formView, h2hView, formSortMode, h2hSortMode, overLine, firstHalfOverLine, counterDirection);
      if (comparison === 0 && secondarySortKey) {
        comparison = columnComparison(secondarySortKey, left, right, formView, h2hView, formSortMode, h2hSortMode, overLine, firstHalfOverLine, counterDirection);
      }
    }
    return comparison * effectiveDirection || byKickoff;
  });

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
  const arrow = (key: SortKey) => effectiveSortKey === key ? (effectiveDirection === 1 ? "↑" : "↓") : "↕";
  const formSortModeKey = formSortModes[formSortMode]!;
  const formSortLabel = formSortLabels[formSortModeKey];
  const h2hSortTarget = h2hSortTargets[h2hSortMode]!;
  const h2hSortLabel = h2hSortLabels[h2hSortTarget];
  const activeLineView = h2hView === "over" || h2hView === "firstHalfOver"
    ? h2hView
    : formView === "over" || formView === "firstHalfOver" ? formView : null;
  const availableMarketOptions = MARKET_OPTIONS.filter((option) => option.key === "all" || document.fixtures.some((fixture) => fixture.markets.some((market) => market.key === option.key)));
  // Aufeinanderfolgende Märkte derselben Gruppe; eine Gruppe ohne verfügbaren Markt entsteht gar nicht.
  const marketOptionGroups = availableMarketOptions.reduce<Array<{ group?: string; options: typeof availableMarketOptions }>>((groups, option) => {
    const last = groups.at(-1);
    if (last && last.group === option.group) last.options.push(option);
    else groups.push({ group: option.group, options: [option] });
    return groups;
  }, []);
  const showFirstHalfExpected = isFirstHalfMarket(marketFilter);
  // Raster und Mindestbreite kommen aus derselben Spaltenliste (tableColumns.ts).
  const tableWidth = { "--table-min-width": `${minimumWidth(columns)}px` } as CSSProperties;
  const gridStyle = { ...tableWidth, gridTemplateColumns: gridTemplate(columns) } as CSSProperties;
  const fixtureGridClass = "fixture-grid";
  const activeSortDirection = heatmap && heatmapSort ? heatmapSort.direction : effectiveDirection;
  const flipSortDirection = () => {
    if (heatmap && heatmapSort) setHeatmapSort({ ...heatmapSort, direction: heatmapSort.direction === 1 ? -1 : 1 });
    // Steht die Wahl gerade auf dem Rückfall, dreht der Knopf den Anstoß um, den man sieht.
    else if (effectiveSortKey !== sortKey) { setSortKey(effectiveSortKey); setSortDirection(-1); }
    else setSortDirection((value) => value === 1 ? -1 : 1);
  };
  const sortLabels: Record<SortKey, string> = {
    kickoff: "Anstoß",
    league: "Liga",
    team: "Heimteam (A–Z)",
    form: "Form (letzte 5)",
    h2h: "H2H (direkte Duelle)",
    shots: "Schüsse aufs Tor",
    corners: "Ecken",
    expected: showFirstHalfExpected ? "Erwartete Tore 1. HZ" : "Erwartete Tore",
    score: "Punkte",
    market: `Wahrscheinlichkeit ${availableMarketOptions.find((option) => option.key === selectedMarketKey)?.label ?? "1X2"}`,
    confidence: "Datenvertrauen"
  };
  const sortOptions: Array<[SortKey, string]> = SORT_ORDER
    .filter((key) => sortableKeys.includes(key))
    .map((key) => [key, sortLabels[key]]);
  const heatmapColumns = heatmapMarkets(marketFilter).map((key) =>
    ({ key, label: MARKET_OPTIONS.find((option) => option.key === key)?.label ?? key }));
  const emptyState = search.trim() !== ""
    ? <EmptyState title={`Kein Spiel passt zu „${search.trim()}“`}
        text="Gesucht wird in Mannschaften, Wettbewerb und Land – unter den Spielen, die die übrigen Filter zeigen."
        action={<button className="empty-state-action" onClick={() => setSearch("")}>Suche leeren</button>} />
    : quickpickActive
    ? <EmptyState title={`${quickpickLabel} lässt kein Spiel übrig`}
        text={quickpickReason(quickpick.report)}
        action={<button className="empty-state-action" onClick={() => setQuickpickActive(false)}>
          Filter aufheben
        </button>} />
    : <EmptyState title="Keine Spiele für diese Auswahl" text="Wähle einen anderen Zeitraum oder lockere die Filter."
        action={<button className="empty-state-action" onClick={() => resetFilters()}>Filter zurücksetzen</button>} />;

  const isLeagueVisible = (country: string, league: string) =>
    !deselectedLeagues.has(leagueKey(country, league));
  const liveMatches = (live.board?.matches ?? []).filter((match) => isLeagueVisible(match.country, match.league));
  const liveChanceApplies = questionHasChance(liveQuestion);
  const liveVisible = visibleLiveMatches(liveMatches, {
    question: liveQuestion, chanceMin: liveChanceMin, redOnly: liveRedOnly, phase: livePhase, sort: liveSort
  });

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
    if (liveRatedOnly) activeFilters.push({ key: "rated", label: "Nur Spiele mit Empfehlung vor Anpfiff", clearLabel: "Wieder alle Spiele beobachten", clear: () => setLiveRatedOnly(false) });
    // Ein Chancenfilter, der bei der gewählten Frage nicht greift, blendet nichts aus und steht
    // deshalb auch nicht als Schildchen da.
    if (liveChanceMin !== "all" && liveChanceApplies) activeFilters.push({ key: "chance", label: `Chance ab ${liveChanceMin} %`, clearLabel: "Chancenfilter aufheben", clear: () => setLiveChanceMin("all") });
    if (liveRedOnly) activeFilters.push({ key: "red", label: "Rote Karte im Spiel", clearLabel: "Wieder alle laufenden Spiele zeigen", clear: () => setLiveRedOnly(false) });
    if (livePhase !== "all") activeFilters.push({ key: "phase", label: LIVE_PHASE_LABELS[livePhase], clearLabel: "Phasenfilter aufheben", clear: () => setLivePhase("all") });
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
      setLiveChanceMin("all");
      setLiveRedOnly(false);
      setLivePhase("all");
      return;
    }
    setLevelFilter("all");
    selectNext48();
    setShowCrossLeague(true);
    setClassGapFilter("all");
    setShowPast(false);
    setQuickpickActive(false);
    setSearch("");
  };

  const filterMenuValues: FilterMenuValues = {
    variant: view === "live" ? "live" : "prematch",
    levelFilter,
    counts,
    marketLabel: marketFilter === "all" ? null : marketLabelOf(marketFilter),
    classGapFilter,
    showCrossLeague,
    showPast,
    liveRatedOnly,
    live: {
      chanceMin: liveChanceMin,
      chanceApplies: liveChanceApplies,
      questionLabel: liveQuestionLabel(liveQuestion),
      redOnly: liveRedOnly,
      phase: livePhase,
      shown: liveVisible.length
    },
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
    setLiveRatedOnly,
    setLiveChanceMin,
    setLiveRedOnly,
    setLivePhase,
    openLeagueFilter: () => setLeagueFilterOpen(true),
    toggleLeague,
    selectOnlyLeague: (key) => setDeselectedLeagues(new Set(availableLeagues.filter((item) => item.key !== key).map((item) => item.key))),
    reset: resetFilters,
    close: () => closeFilterMenu(true)
  };

  const rangeControl = <DayRangePicker minimum={document.meta.firstAvailableDate ?? null}
    maximum={document.meta.lastAvailableDate ?? null} custom={rangeMode === "custom"}
    start={customStart} end={customEnd} selectingEnd={selectingRangeEnd} onNext48={selectNext48} onSelect={selectCalendarDate}
    onRange={selectCalendarRange} />;

  // H2H und Form zeigen dieselbe Größe: Der Markt setzt beide ohnehin gleich (`selectMarket`),
  // getrennt einstellen war eine Kombination, die niemand brauchte. Beide Zustände bleiben, weil
  // die Sortierung je Spalte liest. In der Heatmap wirkt der Block nicht und entfällt.
  const setPointsView = (value: H2hView) => {
    setH2hView(value);
    setFormView(value);
  };
  const displayControls = heatmap ? undefined : <div className="filter-display">
    <FilterSegment name="points-view" legend="Striche in Form und H2H" value={h2hView}
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
      onToggle={() => (filterMenuOpen ? setFilterMenuOpen(false) : openFilterMenu())} />
    {filterMenuOpen && <FilterMenu values={filterMenuValues} actions={filterMenuActions}
      rangeControl={view === "prematch" ? rangeControl : undefined}
      displayControls={view === "prematch" ? displayControls : undefined} />}
  </div>;

  // Der Quickpicker hängt wie das Filtermenü als nicht-modales Fenster unter seinem Knopf. Das
  // Fenster richtet sich an der Knopfgruppe aus (.quickpick-anchor ist nicht positioniert),
  // damit es an derselben Stelle aufgeht wie das Filtermenü und nicht rechts abgeschnitten wird.
  const quickpickControl = <div className="filter-anchor quickpick-anchor" ref={quickpickAnchorRef} onBlur={(event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) setQuickpickOpen(false);
  }}>
    <QuickpickButton buttonRef={quickpickButtonRef} active={quickpickActive} open={quickpickOpen}
      onToggle={() => (quickpickOpen ? setQuickpickOpen(false) : openQuickpick())} />
    {quickpickOpen && <QuickpickDialog
      fixtures={scopedFixtures}
      store={quickpickStore}
      active={quickpickActive}
      timezone={document.meta.timezone}
      now={now}
      shownInTable={filtered.length}
      onSettingsChange={(next) => setQuickpickStore((store) => withSettings(store, next))}
      // Die Rückmeldung bleibt beim Filterwechsel stehen: Gerade beim Einsammeln aus mehreren
      // Filtern ist sie der laufende Stand.
      onPresetChange={(preset: QuickpickPresetId) => setQuickpickStore((store) => ({ ...store, aktiv: preset }))}
      onActiveChange={setQuickpickActive}
      cart={cart}
      comboPlaces={requestedTotal(Object.entries(comboSetup.counts).map(([size, count]) => ({ size: Number(size), count })))}
      onRemoveEntry={(id) => {
        removeEntry(id);
        setCartFeedback(null);
      }}
      tableFixtureIds={new Set(filtered.map((fixture) => fixture.fixtureId))}
      onShowInTable={(fixtureId) => {
        // Der Filter bleibt an - „zeigen“ heißt die gefilterte Tabelle, mit Spiel aufgeklappt
        // (lädt wie ein Klick auf die Zeile einmalig die Detailkennzahlen). Ohne Spiel geht der
        // Fokus an den Quickpick-Knopf zurück, mit Spiel an dessen Zeile.
        setQuickpickActive(true);
        closeQuickpick(fixtureId === null);
        if (fixtureId !== null) {
          setOpenFixture(fixtureId);
          setScrollToFixture(fixtureId);
        }
      }}
      cartFeedback={cartFeedback}
      canUndoCart={cartFeedback !== null && cartFeedback.changeId !== null && lastChange?.id === cartFeedback.changeId}
      onUndoCart={() => {
        undoCart();
        setCartFeedback(null);
      }}
      onOpenCart={openCart}
      onAddAll={(rows) => {
        // Dieselbe Funktion wie der Knopf je Zeile im Quickpicker (`quickpickCartEntry`).
        const entries = rows
          .map((row) => quickpickCartEntry(row.fixture, row.evaluation, quickpickSettings.preset))
          .filter((entry): entry is CartEntry => entry !== null);
        // Der Quickpicker bleibt offen (Davids Entscheidung vom 11.10.2026): So lassen sich
        // mehrere Filter nacheinander einsammeln, und der Fuß sagt, was geschah.
        const { result, changeId } = putEntries(entries);
        setCartFeedback({
          added: result.added.length,
          unchanged: result.unchanged.length,
          replaced: result.replaced,
          changeId
        });
      }}
      onClose={() => closeQuickpick(true)}
    />}
  </div>;

  // Rechts in der Leiste, über dem abgedunkelten Hintergrund wie Filter und Quickpick (z-index 41).
  const cartControl = <div className="filter-anchor cart-anchor" ref={cartAnchorRef} onBlur={(event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) setCartOpen(false);
  }}>
    <CartButton buttonRef={cartButtonRef} count={cart.length} open={cartOpen}
      onToggle={() => (cartOpen ? setCartOpen(false) : openCart())} />
    {cartOpen && <BetSlipWindow
      cart={cart}
      now={now}
      timezone={document.meta.timezone}
      lastChange={lastChange}
      setup={comboSetup}
      combos={combos}
      combosStale={combos.length > 0 && cartKey(cart) !== mixedKey}
      onRemove={removeEntry}
      onRemoveStarted={() => removeStarted(Date.now())}
      onClear={clearCart}
      onUndo={undoCart}
      onSetupChange={setComboSetup}
      onMix={(next) => {
        setCombos(next);
        setMixedKey(cartKey(cart));
      }}
      onCombosChange={setCombos}
      onClose={() => closeCart(true)}
    />}
  </div>;

  const marketControl = <label className="toolbar-field">
    <span>Markt</span>
    <select title="Markt" value={marketFilter} onChange={(event) => selectMarket(event.target.value as MarketFilter)}>
      {marketOptionGroups.map(({ group, options }) => {
        const items = options.map((option) => <option value={option.key} key={option.key}>{option.label}</option>);
        return group ? <optgroup label={group} key={group}>{items}</optgroup> : <Fragment key="ungrouped">{items}</Fragment>;
      })}
    </select>
  </label>;

  const selectTableMode = (mode: DisplayMode) => {
    setShowKelly(mode === "kelly");
    if (mode !== "kelly") setKellyOpen(false);
  };
  const tableModeControl = <FilterSegment className="toolbar-segment" name="table-mode" legend="Anzeige"
    value={showKelly ? "kelly" : "stats"} onChange={selectTableMode} options={TABLE_MODE_OPTIONS} />;

  // Die Kelly-Zeile nennt, was der Dialog sonst erst nach dem Öffnen zeigt - auch den
  // Einsatzrahmen, der bis zum 15.09.2026 unbemerkt auf 100 % stand.
  const kellyStatus = (() => {
    if (!kellySelection) return null;
    const note = kellyProfileNote(kellyAuto, marketProfile);
    const loading = kellyAuto && marketProfile.profile === null && (marketProfile.status === "loading" || marketProfile.status === "idle");
    const count = kellySelection.candidates.length;
    const slots = kellySelection.slots;
    return <div className="kelly-status">
      <p className="kelly-status-line">
        <span title={"Geprüft werden die Spiele aus Zeitraum und Wettbewerben im Filter, samt „Nur"
          + " Ligaspiele“, und der gewählte Markt. Angepfiffene Spiele zählen nie mit. Bewertung und"
          + " Klassenunterschied grenzen nur die Tabelle ein."}>
          Kelly-Auswahl · {marketLabelOf(marketFilter)}:
        </span>
        {loading ? <> {note}</> : <>
          {" "}<strong>{count}</strong> {count === 1 ? "Wette" : "Wetten"}
          {" · "}<strong>{formatEuro(kellySelection.totalStake)}</strong> von {formatEuro(kellySettings.budget)}
          {" · "}{kellySelection.automatic ? "Automatik" : note ?? "Manuell"}
          {" · "}Einsatzrahmen {formatPercent(kellySettings.maxExposurePercent)}
          {" "}({Number.isFinite(slots.plaetze) ? `≈ ${slots.plaetze} Plätze` : "ohne Grenze"})        </>}
      </p>
      <p className="filter-note warning"><Info size={13} weight="bold" aria-hidden />{KELLY_WARNING}</p>
    </div>;
  })();

  const clearAndRefocus = (clear: () => void) => {
    clear();
    // Das Schildchen verschwindet mit dem Filter; der Fokus geht an den Filter-Knopf.
    filterButtonRef.current?.focus();
  };
  const filterStatusRow = (status: ReactNode) => <div className="filter-status-row">
    {status}
    {activeFilters.map((filter) => <FilterChip key={filter.key} label={filter.label} title="Filter öffnen"
      clearLabel={filter.clearLabel} onOpen={openFilterMenu} onClear={() => clearAndRefocus(filter.clear)} />)}
    {showQuickpickChip && <QuickpickChip label={quickpickLabel}
      passed={quickpick.report.passed} evaluated={quickpick.report.evaluated}
      onOpen={openQuickpick} onClear={() => clearAndRefocus(() => setQuickpickActive(false))} />}
  </div>;

  // Die Technik (Kontingent, Abrufart) steht im Tooltip; sichtbar bleibt, was beim Lesen zählt.
  const liveBudgetTitle = live.board
    ? [
        `API-Aufrufe heute: ${live.board.budget.usedToday} von ${live.board.budget.capToday}`,
        ...(live.board.budget.apiRequestsRemaining !== null ? [`Kontingent verbleibend: ${live.board.budget.apiRequestsRemaining}`] : []),
        live.board.strategy === "live-all" ? "Ein Sammelabruf für alle laufenden Spiele" : "Abruf in Bündeln zu 20 Spielen"
      ].join(" · ")
    : undefined;
  const liveStatus = <p className="filter-status live-status" title={liveBudgetTitle}>
    <span><strong>{liveVisible.length}</strong> {liveVisible.length === 1 ? "laufendes Spiel" : "laufende Spiele"}
      {liveVisible.length !== liveMatches.length && <> von {liveMatches.length}</>}</span>
    {" · "}{live.board ? `${live.board.candidates} im Zeitfenster` : "Warte auf Daten"}
    {live.board && <>{" · "}Aktualisiert: {formatDataTimestamp(live.board.createdAt, document.meta.timezone)}</>}
  </p>;

  const selectLiveQuestion = (question: LiveQuestion) => {
    setLiveQuestion(question);
    saveLiveQuestion(question);
  };
  const liveQuestionControl = <label className="toolbar-field">
    <span>Markt</span>
    <select title="Markt" value={liveQuestion} onChange={(event) => selectLiveQuestion(event.target.value as LiveQuestion)}>
      {LIVE_QUESTION_GROUPS.map(({ group, options }) => {
        const items = options.map((option) => <option value={option.key} key={option.key}>{option.label}</option>);
        return group ? <optgroup label={group} key={group}>{items}</optgroup> : <Fragment key="ungrouped">{items}</Fragment>;
      })}
    </select>
  </label>;
  // Sortierbar nur, was zu sehen ist. Vorgabe ist der Anstoß: Nach Chance springen die Zeilen
  // bei jedem Abruf, und ein offenes Kennzahlen-Fenster säße über der falschen Zeile.
  const liveSortOptions: Array<[LiveSort, string]> = [
    ["kickoff", "Anstoß"],
    ["minute", "Spielminute"],
    ...(liveChanceApplies ? [["chance", "Chance"] as [LiveSort, string]] : []),
    ...(liveQuestion === "cards" ? [["cards", "Karten"] as [LiveSort, string]] : [])
  ];
  const liveSortControl = <div className="toolbar-field sort-field">
    <label htmlFor="live-sort-select">Sortierung</label>
    <select id="live-sort-select" title="Sortierung" value={effectiveLiveSort(liveSort, liveQuestion)}
      onChange={(event) => setLiveSort(event.target.value as LiveSort)}>
      {liveSortOptions.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
    </select>
  </div>;

  // Kopf und Zeilen der Tabelle folgen der Spaltenliste (tableColumns.ts): je Modus und Markt nur,
  // was dazu passt. Der Kopf markiert die wirksame Sortierung, nicht eine gemerkte ausgeblendete.
  const sortButton = (key: SortKey, label: string, options: { title?: string; className?: string; content?: ReactNode } = {}) =>
    <button className={[options.className, effectiveSortKey === key ? "sorted" : ""].filter(Boolean).join(" ") || undefined}
      title={options.title} onClick={() => sort(key)}
      aria-label={sortStateLabel(label, effectiveSortKey === key, effectiveDirection)}>
      {options.content ?? label} {arrow(key)}
    </button>;
  const headLabel = (label: string, title: string) => <span className="head-label" title={title}>{label}</span>;
  const pairSortBadge = (key: "form" | "h2h") => {
    const outcome = key === "form" ? formView === "outcome" : h2hView === "outcome";
    if (outcome && effectiveSortKey === key) {
      return key === "form"
        ? <span className={`sort-mode-badge ${formSortLabel.className}`} aria-label={`Sortierung: ${formSortLabel.label}`} title={formSortLabel.label}>{formSortLabel.badge}</span>
        : <span className={`sort-mode-badge ${h2hSortTarget}`} aria-label={`Sortierung: ${h2hSortLabel.label}`} title={h2hSortLabel.label}>{h2hSortLabel.badge}</span>;
    }
    if (secondarySortKey === key) return <span className="sort-mode-badge secondary" aria-label="Sekundäre Sortierung" title="Sekundäre Sortierung">2</span>;
    return arrow(key);
  };
  const headCell = (column: TableColumn): ReactNode => {
    switch (column.id) {
      case "match": return sortButton("team", "Spiel");
      case "kickoff": return sortButton("kickoff", "Anstoß", { title: "Anstoß, Land und Liga" });
      case "form": return <button className={effectiveSortKey === "form" ? "sorted" : undefined} onClick={() => sort("form")} title={pairHeadTitle("form", formView, overLine, firstHalfOverLine, counterDirection)}>Letzte 5 Form {pairSortBadge("form")}</button>;
      case "h2h": return <button className={effectiveSortKey === "h2h" ? "sorted" : undefined} onClick={() => sort("h2h")} title={pairHeadTitle("h2h", h2hView, overLine, firstHalfOverLine, counterDirection)}>Letzte 5 H2H {pairSortBadge("h2h")}</button>;
      case "expected": return sortButton("expected", showFirstHalfExpected ? "Erw. Tore 1. HZ" : "Erw. Tore", {
        title: isGoalLineMarket(marketFilter) || showFirstHalfExpected
          ? "Erwartete Tore laut Modell, groß die Summe beider Mannschaften"
          : "Erwartete Tore laut Modell, Heim : Auswärts"
      });
      case "points": return sortButton("score", "Punkte", { title: "1X2- und Remis-Punkte aus dem 100-Punkte-System" });
      case "shots": return sortButton("shots", "Schüsse aufs Tor", {
        className: "icon-head", title: "Schüsse aufs Tor im Schnitt der letzten fünf Spiele",
        content: <Crosshair size={15} weight="bold" aria-hidden="true" />
      });
      case "market": return sortButton("market", marketFilter === "all" ? "1X2" : marketLabelOf(marketFilter), { title: "Tipp, Quote und Wahrscheinlichkeit laut Modell" });
      case "recommended": return headLabel("Empfohlene Märkte", "Weitere Märkte mit ✓ oder ★, höchstens drei. Alle Märkte stehen aufgeklappt unter „Bewertung je Markt“.");
      case "data": return sortButton("confidence", "Daten", { title: "Datenvertrauen – wie verlässlich die Daten zu diesem Spiel sind. Fließt in die Empfehlung ein." });
    }
  };

  const rowCells = (fixture: DashboardFixture, showDay: boolean): ReactNode[] => {
    const time = kickoffParts(fixture.kickoff, document.meta.timezone);
    // Nur Anzeige - Vergleiche und Schlüssel bleiben auf den API-Feldern (`names.ts`).
    const home = teamName(fixture, "home", nameSource);
    const away = teamName(fixture, "away", nameSource);
    const place = `${countryName(fixture, nameSource)} · ${leagueName(fixture, nameSource)}`;
    const rename: Rename = (name) => displayTeam(name, fixture, nameSource);
    const isPast = Date.parse(fixture.kickoff) < now;
    const quickpickEvaluation = quickpickActive ? quickpick.evaluations.get(fixture.fixtureId) : undefined;
    const cells: ReactNode[] = [];
    for (const column of columns) {
      switch (column.id) {
        case "match": cells.push(<span className="fixture-summary-cell" key="match">
          <span className="teams-cell">
            <span className="team-name"><TeamCrest name={home} logo={fixture.homeCrest} /><strong>{home}</strong><EloTag value={fixture.homeElo} team={home} /><DefenseShield profile={fixture.defense?.home} team={home} /></span>
            <span className="team-name"><TeamCrest name={away} logo={fixture.awayCrest} /><strong>{away}</strong><EloTag value={fixture.awayElo} team={away} /><DefenseShield profile={fixture.defense?.away} team={away} /></span>
          </span>
          {quickpickEvaluation?.passes && <QuickpickTableTip preset={quickpickSettings.preset}
            row={{ fixture, evaluation: quickpickEvaluation, names: nameSource }} />}
        </span>); break;
        case "kickoff": cells.push(<span className="kickoff-cell" key="kickoff">
          <span className="kickoff-line">
            <strong>{time.clock}{isPast && <em> angepfiffen</em>}</strong>
            {fixture.classGap && <ClassGapBadge gap={fixture.classGap} homeTeam={home} awayTeam={away} />}
          </span>
          {/* Das Datum nur ohne Tages-Trennzeile - sonst stünde es in jeder Zeile doppelt. */}
          <small className="kickoff-place" title={place}>{showDay && `${time.day} · `}<CountryFlag country={fixture.country} /> {place}</small>
        </span>); break;
        case "form": cells.push(<span className="form-cell" key="form">
          {/*
            * Bei Pokal- und Länderspielen zählt der Lauf die letzten Spiele insgesamt
            * (src/dashboard.ts setzt dann scope "overall"). "Heim"/"Ausw." hätte dort
            * eine Trennung nach Ort behauptet, die in den Punkten gar nicht steckt.
            */}
          <span
            className="form-labels"
            title={fixture.form.scope === "overall"
              ? `Alle Spiele der letzten Zeit, zu Hause und auswärts zusammen – oben ${home}, unten ${away}`
              : `Nur die Heimspiele von ${home} gegen die Auswärtsspiele von ${away}`}
            aria-label={fixture.form.scope === "overall" ? "Form aus allen Spielen" : "Heim- und Auswärtsform"}
          >
            {fixture.form.scope === "overall"
              ? <><small>Alle</small><small>Alle</small></>
              : <><small>Heim</small><small>Ausw.</small></>}
          </span>
          <span>{formView === "outcome"
            ? <>
              <FormOutcomeBars team={home} results={fixture.form.home} matches={fixture.form.homeMatches} timezone={document.meta.timezone} rename={rename} />
              <FormOutcomeBars team={away} results={fixture.form.away} matches={fixture.form.awayMatches} timezone={document.meta.timezone} rename={rename} />
            </>
            : <>
              <MatchViewBars subject={home} matches={fixture.form.homeMatches} view={formView} overLine={overLine} firstHalfOverLine={firstHalfOverLine} inverted={counterDirection} rename={rename} />
              <MatchViewBars subject={away} matches={fixture.form.awayMatches} view={formView} overLine={overLine} firstHalfOverLine={firstHalfOverLine} inverted={counterDirection} rename={rename} />
            </>}</span>
        </span>); break;
        case "h2h": cells.push(<span className="h2h-cell" key="h2h">
          <H2hBars fixture={fixture} view={h2hView} overLine={overLine} firstHalfOverLine={firstHalfOverLine} inverted={counterDirection} timezone={document.meta.timezone} />
          {/* Eine Auffälligkeit, kein Grund für einen Tipp - deshalb grau, nie grün oder gold. */}
          {fixture.h2hNotice && <small className="h2h-notice" title={`${fixture.h2hNotice} · eine Auffälligkeit, kein Grund für einen Tipp`}>Remis-Serie</small>}
        </span>); break;
        case "expected": {
          const title = `Erwartete Tore laut Modell · ${home} ${goalLabel(fixture.expectedGoals.home)} · ${away} ${goalLabel(fixture.expectedGoals.away)}`;
          if (showFirstHalfExpected) cells.push(<span className="expected-cell total" key="expected" title={title}>
            <strong>Σ {goalLabel(fixture.expectedFirstHalfGoals?.total)}</strong><small>Spiel Σ {goalLabel(fixture.expectedGoals.total)}</small>
          </span>);
          else if (isGoalLineMarket(marketFilter)) cells.push(<span className="expected-cell total" key="expected" title={title}>
            <strong>Σ {goalLabel(fixture.expectedGoals.total)}</strong><small>{goalLabel(fixture.expectedGoals.home)} : {goalLabel(fixture.expectedGoals.away)}</small>
          </span>);
          else cells.push(<span className="expected-cell" key="expected" title={title}>
            <strong>{goalLabel(fixture.expectedGoals.home)}</strong><i>:</i><strong>{goalLabel(fixture.expectedGoals.away)}</strong>
          </span>);
          break;
        }
        case "points": cells.push(<span className="score-cell" key="points">
          {marketFilter !== "draw" && <span><small>1X2</small><strong>{fixture.scores.favorite ?? "–"}</strong></span>}
          {marketFilter !== "1x2" && <span><small>X</small><strong>{fixture.scores.draw ?? "–"}</strong></span>}
        </span>); break;
        case "shots": cells.push(<RecentStatCell fixture={fixture} field="shotsOnGoal" label="Schüsse aufs Tor" key="shots" />); break;
        case "market": {
          const market = marketFor(fixture, selectedMarketKey);
          cells.push(market
            ? <MarketCard market={market} showEdge={showKelly} selection={selectionText(fixture, market, nameSource)} key="market" />
            : <span className="market-card missing" key="market">–</span>);
          break;
        }
        case "recommended": cells.push(<RecommendedMarkets fixture={fixture} key="recommended" />); break;
        case "data": cells.push(<DataCell fixture={fixture} market={dataMarketOf(fixture)} key="data" />); break;
      }
    }
    return cells;
  };

  // Trennzeilen je Tag nur, wenn nach Anstoß sortiert ist - in beide Richtungen. Der Tag kommt
  // aus der Berliner Zeit, nicht aus UTC; angepfiffene Spiele gehören zu ihrem Tag.
  const groupedByDay = effectiveSortKey === "kickoff";
  const dayOf = (fixture: DashboardFixture) => berlinDate(fixture.kickoff, document.meta.timezone);
  const dayCounts = new Map<string, number>();
  for (const fixture of sortedFixtures) dayCounts.set(dayOf(fixture), (dayCounts.get(dayOf(fixture)) ?? 0) + 1);
  const dayLabel = (day: string) => `${formatCalendarDate(day, { weekday: "short" }).replace(".", "")} ${formatCalendarDate(day, { day: "2-digit", month: "2-digit" })}`;

  // Unten in der Leiste, über dem abgedunkelten Hintergrund wie Filter und Wettschein (z-index 41).
  const settingsControl = <div className="nav-rail-settings" ref={settingsAnchorRef} onBlur={(event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) setSettingsOpen(false);
  }}>
    <SettingsButton buttonRef={settingsButtonRef} open={settingsOpen}
      onToggle={() => setOpenMenu(settingsOpen ? null : "settings")} />
    {settingsOpen && <SettingsWindow anchor={settingsButtonRef.current} names={nameSource}
      onNamesChange={setNameSource} onClose={() => closeSettings(true)} />}
  </div>;

  return <NamesContext.Provider value={nameSource}>
  <div className="app-shell density-compact">
    <NavRail active={navKey} onSelect={selectNav} createdAt={document.meta.createdAt} timezone={document.meta.timezone}
      settings={settingsControl} />

    <main className="content">
      {banner && <div className="banner"><span><RocketLaunch size={20} weight="duotone" /></span><p><strong className="gold">Gold ★</strong> heißt sehr empfehlenswert, <strong>Grün ✓</strong> empfehlenswert. Sortiere über die Spaltenköpfe; Zeitraum, Wettbewerbe und Stufe stellst du über „Filter“ ein.</p><button onClick={() => { setBanner(false); saveBannerDismissed(); }} aria-label="Hinweis schließen"><X /></button></div>}
      {view === "prematch" ? <>
      <div className="view-toolbar prematch-toolbar">
        <div className="toolbar-row">
          {/* Links, was Spiele ausblendet; rechts der Linie, was nur die Darstellung ändert. */}
          <div className="toolbar-group toolbar-filters">
            {filterControl}
            {quickpickControl}
          </div>
          {/* Die Suche blendet ebenfalls aus und steht deshalb links der Linie. Das Feld zeigt
              selbst, wonach gesucht wird - ein Schildchen darunter wäre doppelt. */}
          <div className="toolbar-search">
            <MagnifyingGlass size={14} weight="bold" aria-hidden />
            <input type="search" aria-label="Spiele suchen" placeholder="Mannschaft, Liga, Land"
              title="Sucht in Mannschaften, Wettbewerb und Land – mit Tipico- und API-Namen. Mehrere Wörter müssen alle vorkommen."
              value={search} onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && search !== "") { event.stopPropagation(); setSearch(""); }
              }} />
            {search !== "" && <button type="button" className="toolbar-search-clear" aria-label="Suche leeren"
              title="Suche leeren" onClick={() => setSearch("")}><X size={12} weight="bold" aria-hidden /></button>}
          </div>
          <span className="toolbar-divider" aria-hidden />
          {marketControl}
          <div className="toolbar-field sort-field">
            <label htmlFor="sort-select">Sortierung</label>
            <div className="sort-control">
              <select id="sort-select" title="Sortierung" value={heatmap && heatmapSort ? "heatmap" : effectiveSortKey} onChange={(event) => selectSort(event.target.value as SortKey)}>
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
          <div className="toolbar-group">
            {tableModeControl}
            {showKelly && <KellyButton onOpen={() => setKellyOpen(true)} />}
          </div>
          {cartControl}
        </div>
        {filterStatusRow(<p className="filter-status">
          <span aria-live="polite"><strong>{filtered.length}</strong> Spiele angezeigt</span>
          {/* Ein eigener Zeitraum steht schon im Schildchen daneben. */}
          {rangeMode === "next48" && <>{" · "}Nächste 48 Stunden ab jetzt</>}
        </p>)}
        {kellyStatus}
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
        cartSlot={(fixture) => <CartAddMenu
          compact
          fixture={fixture}
          cart={cart}
          open={cartMenuFixtureId === fixture.fixtureId}
          started={Date.parse(fixture.kickoff) <= now}
          onOpen={() => setCartMenuFixtureId(fixture.fixtureId)}
          onClose={() => setCartMenuFixtureId((current) => current === fixture.fixtureId ? null : current)}
          onSelect={(market, counterSide) => addFromMenu(fixture, market, counterSide)}
          onRemove={(market) => removeEntry(cartEntryId(fixture.fixtureId, market.key))}
        />}
        empty={emptyState}
      /> : <div className="table-scroll">
        <div className={`table-head ${fixtureGridClass}`} style={gridStyle} data-columns={columns.map((column) => column.id).join(" ")}>
          {columns.map((column) => <Fragment key={column.id}>{headCell(column)}</Fragment>)}
        </div>
        {(() => {
          let previousDay: string | null = null;
          return sortedFixtures.map((fixture) => {
            const day = dayOf(fixture);
            const divider = groupedByDay && day !== previousDay;
            previousDay = day;
            const count = dayCounts.get(day) ?? 0;
            return <Fragment key={fixture.fixtureId}>
              {divider && <div className="day-divider" style={tableWidth}>
                <h3>{dayLabel(day)}</h3><span>{count} {count === 1 ? "Spiel" : "Spiele"}</span>
              </div>}
              <article data-fixture-id={fixture.fixtureId} className={`fixture-wrap level-${bestLevel(fixture, marketFilter)} ${openFixture === fixture.fixtureId ? "open" : ""}`} style={tableWidth}>
                <div className="fixture-row-wrap">
                <CartAddMenu
                  fixture={fixture}
                  cart={cart}
                  open={cartMenuFixtureId === fixture.fixtureId}
                  started={Date.parse(fixture.kickoff) <= now}
                  onOpen={() => setCartMenuFixtureId(fixture.fixtureId)}
                  onClose={() => setCartMenuFixtureId((current) => current === fixture.fixtureId ? null : current)}
                  onSelect={(market, counterSide) => addFromMenu(fixture, market, counterSide)}
                  onRemove={(market) => removeEntry(cartEntryId(fixture.fixtureId, market.key))}
                />
                <button className={`${fixtureGridClass} fixture-row`} style={gridStyle} onClick={() => setOpenFixture((value) => value === fixture.fixtureId ? null : fixture.fixtureId)} aria-expanded={openFixture === fixture.fixtureId}>
                  {rowCells(fixture, !groupedByDay)}
                </button>
                </div>
              </article>
            </Fragment>;
          });
        })()}
        {sortedFixtures.length === 0 && emptyState}
      </div>}
      {openFixture !== null && (() => {
        const fixture = sortedFixtures.find((item) => item.fixtureId === openFixture);
        if (!fixture) return null;
        const time = kickoffParts(fixture.kickoff, document.meta.timezone);
        const showTable = !fixture.crossLeague && !!fixture.table?.length;
        const detailed = insights.status === "ready" && insights.insights.fixtureId === fixture.fixtureId;
        const loading = insights.status === "loading";
        const home = teamName(fixture, "home", nameSource);
        const away = teamName(fixture, "away", nameSource);
        return <aside className="fixture-detail-panel" aria-label="Details">
              <header className="fixture-detail-head">
                <span className="fixture-detail-teams">
                  <strong className="home">{home}</strong>
                  <strong className="away">{away}</strong>
                  <small>{time.clock} · {time.day} · <CountryFlag country={fixture.country} /> {countryName(fixture, nameSource)} · {leagueName(fixture, nameSource)}</small>
                  {/* Aus dem Lauf, ohne Abruf - steht deshalb schon, während die Kennzahlen laden.
                      Ecken und (bei 1X2/Remis) Schüsse sind aus der Zeile hierher gewandert. */}
                  <small className="detail-recent" title="Schnitt der letzten fünf Spiele, Heim : Auswärts">
                    Schnitt letzte 5 · Schüsse aufs Tor {recentLabel(recentValue(fixture, "home", "shotsOnGoal"))} : {recentLabel(recentValue(fixture, "away", "shotsOnGoal"))}
                    {" · "}Ecken {recentLabel(recentValue(fixture, "home", "corners"))} : {recentLabel(recentValue(fixture, "away", "corners"))}
                  </small>
                </span>
                <button className="fixture-detail-close" aria-label="Details schließen" onClick={() => setOpenFixture(null)}><X /></button>
              </header>
              {loading
                ? <div className="insight-loading" role="status"><i aria-hidden /><span>Torphasen und Trends werden geladen …</span></div>
                : <>
              {detailed
                ? <FixtureInsightPanels insights={insights.insights} timezone={document.meta.timezone}
                  homeName={home} awayName={away} leagueName={leagueName(fixture, nameSource)} />
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
                        <span className="home">{home}</span>
                        <span className="h2h-match-score">
                          <strong className={outcome === "win" ? "home" : outcome === "loss" ? "lose" : ""}>{currentHomeGoals}</strong>
                          <i>:</i>
                          <strong className={outcome === "loss" ? "away" : outcome === "win" ? "lose" : ""}>{currentAwayGoals}</strong>
                        </span>
                        <span className="away">{away}</span>
                      </span>
                      <span className="h2h-match-venue" title={homeTeamWasHome ? `${home} spielte zu Hause` : `${home} spielte auswärts`}>{homeTeamWasHome ? "H" : "A"}</span>
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
                        <td>{displayTeam(row.teamName, fixture, nameSource)}</td>
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
      {/* Live hat eine eigene Frage statt des Marktes der Tabelle; sie steuert, was jede Zeile zeigt. */}
      <div className="view-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group toolbar-filters">{filterControl}</div>
          <span className="toolbar-divider" aria-hidden />
          {liveQuestionControl}
          {liveSortControl}
        </div>
        {filterStatusRow(liveStatus)}
      </div>
      <LiveView
        state={live}
        matches={liveVisible}
        runningCount={liveMatches.length}
        question={liveQuestion}
        onResetFilters={resetFilters}
      />
      </>}
    </main>
  </div>
  {/* Dunkelt den Rest ab, solange Filtermenü, Quickpicker, Wettschein oder Einstellungen offen sind.
      Der Wettbewerbe-Dialog bringt seinen eigenen Hintergrund mit - zwei übereinander dunkelten doppelt ab. */}
  {openMenu !== null && !leagueFilterOpen && <div className="menu-backdrop" aria-hidden />}
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
  {kellySelection && kellyOpen && <KellyDialog
    selection={kellySelection}
    profileState={marketProfile}
    marketFilter={marketFilter}
    marketLabel={MARKET_OPTIONS.find((option) => option.key === marketFilter)?.label ?? "Alle Märkte"}
    settings={kellySettings}
    auto={kellyAuto}
    onAutoChange={setKellyAuto}
    onSettingsChange={setKellySettings}
    onClose={() => setKellyOpen(false)}
  />}
  </NamesContext.Provider>;
}

export function App() {
  const state = useDashboardData();
  if (state.status === "loading") return <div className="status-screen"><BrandMark /><strong>Dashboard wird geladen …</strong></div>;
  if (!state.document) return <div className="status-screen"><BrandMark /><EmptyState title="Noch keine Analyse vorhanden" text={state.message ?? "Starte npm run dashboard -- --dates next48 im Chat."} /></div>;
  return <><Dashboard document={state.document} />{state.status === "error" && <div className="connection-warning" role="status"><WarningCircle size={16} weight="duotone" aria-hidden /><span>{state.message} · Letzter erfolgreicher Stand wird weiter angezeigt.</span></div>}</>;
}
