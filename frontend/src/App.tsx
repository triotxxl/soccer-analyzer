import {
  Binoculars, CaretDoubleLeft, CaretDoubleRight, CheckCircle, ListBullets, RocketLaunch, Star, X
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useDashboardData } from "./data";
import type { DashboardDocument, DashboardFixture, DashboardMarket, DashboardMarketKey, FormResult, RecommendationLevel } from "./types";

const MARKET_OPTIONS: Array<{ key: "all" | DashboardMarketKey; label: string }> = [
  { key: "all", label: "Alle Märkte" },
  { key: "1x2", label: "1X2" },
  { key: "draw", label: "Remis" },
  { key: "btts", label: "BTTS" },
  { key: "over15", label: "Über 1,5" },
  { key: "over25", label: "Über 2,5" }
];
type MarketFilter = (typeof MARKET_OPTIONS)[number]["key"];
type Density = "micro" | "compact" | "comfort";
type LevelFilter = "all" | "strong" | "recommended";
type RangeMode = "days" | "hours";
type H2hView = "outcome" | "btts" | "over";
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

function kickoffParts(value: string, timezone: string): { clock: string; day: string } {
  const date = new Date(value);
  return {
    clock: new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date),
    day: new Intl.DateTimeFormat("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(date)
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

function formatOdd(value: number | null): string {
  return value === null ? "–" : value.toFixed(2).replace(".", ",");
}

function marketFor(fixture: DashboardFixture, key: DashboardMarketKey): DashboardMarket {
  return fixture.markets.find((item) => item.key === key)!;
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

function consecutive(values: boolean[]): number {
  const index = values.findIndex((value) => !value);
  return index === -1 ? values.length : index;
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

function H2hDots({ fixture, view, overLine }: { fixture: DashboardFixture; view: H2hView; overLine: 1.5 | 2.5 | 3.5 }) {
  if (view === "outcome") return <FormDots results={fixture.h2h.outcomes} h2h />;
  const values = view === "btts"
    ? fixture.h2h.btts.map((value) => ({ value, text: value ? "✓" : "×" }))
    : fixture.h2h.matches.map((match) => {
        const value = match.homeGoals + match.awayGoals > overLine;
        return { value, text: value ? "Ü" : "U" };
      });
  while (values.length < 5) values.push({ value: false, text: "–" });
  return <div className="dot-row">
    {values.slice(0, 5).map((item, index) => <span className={`result-dot ${item.text === "–" ? "missing" : item.value ? "hit" : "miss"} ${index === 0 ? "latest" : ""}`} key={index}>{item.text}</span>)}
  </div>;
}

function MarketCard({ market }: { market: DashboardMarket }) {
  const percentage = Math.round(market.probability * 100);
  return <div className={`market-card ${market.recommendation.level}`} title={`${market.selection} · ${market.recommendation.label}`}>
    <div className="market-line">
      <span className="level-glyph">{market.recommendation.level === "strong" ? "★" : market.recommendation.level === "recommended" ? "✓" : "·"}</span>
      {market.pick && <strong className={`pick ${market.selectionTone}`}>{market.pick}</strong>}
      <strong className="odd">{formatOdd(market.odds)}</strong>
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

function Dashboard({ document }: { document: DashboardDocument }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [banner, setBanner] = useState(true);
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [rangeMode, setRangeMode] = useState<RangeMode>("days");
  const [days, setDays] = useState(Math.min(2, document.meta.maximumDays));
  const [hours, setHours] = useState(Math.min(48, document.meta.maximumHours));
  const [showCrossLeague, setShowCrossLeague] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [h2hView, setH2hView] = useState<H2hView>("outcome");
  const [overLine, setOverLine] = useState<1.5 | 2.5 | 3.5>(2.5);
  const [density, setDensity] = useState<Density>("comfort");
  const [sortKey, setSortKey] = useState<SortKey>("kickoff");
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);
  const [formSortMode, setFormSortMode] = useState(0);
  const [h2hSortMode, setH2hSortMode] = useState(0);
  const [openFixture, setOpenFixture] = useState<number | null>(null);
  const now = Date.now();

  useEffect(() => {
    setDays((value) => Math.min(Math.max(1, value), document.meta.maximumDays));
    setHours((value) => Math.min(Math.max(1, value), document.meta.maximumHours));
    setOpenFixture((value) => value !== null && document.fixtures.some((fixture) => fixture.fixtureId === value) ? value : null);
  }, [document]);

  const inSelectedRange = (fixture: DashboardFixture): boolean => {
    const kickoff = Date.parse(fixture.kickoff);
    if (!showPast && kickoff < now) return false;
    if (rangeMode === "hours") return (showPast || kickoff >= now) && kickoff <= now + hours * 3_600_000;
    if (!document.meta.firstAvailableDate) return true;
    const cutoff = new Date(`${document.meta.firstAvailableDate}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + days - 1);
    return berlinDate(fixture.kickoff, document.meta.timezone) <= cutoff.toISOString().slice(0, 10);
  };

  const scopedFixtures = document.fixtures.filter((fixture) => inSelectedRange(fixture) && (showCrossLeague || !fixture.crossLeague));
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
    else if (sortKey === "expected") comparison = left.expectedGoals.total - right.expectedGoals.total;
    else if (sortKey === "score") comparison = (marketFilter === "draw" ? left.scores.draw ?? -1 : left.scores.favorite ?? -1) - (marketFilter === "draw" ? right.scores.draw ?? -1 : right.scores.favorite ?? -1);
    else if (sortKey === "market") comparison = marketFor(left, selectedMarket).probability - marketFor(right, selectedMarket).probability;
    else if (sortKey === "form") {
      const mode = formSortModes[formSortMode]!;
      if (mode === "home") comparison = countResults(left.form.home, "win") - countResults(right.form.home, "win");
      else if (mode === "away") comparison = countResults(left.form.away, "win") - countResults(right.form.away, "win");
      else comparison = countResults([...left.form.home, ...left.form.away], "draw") - countResults([...right.form.home, ...right.form.away], "draw");
    } else if (sortKey === "h2h") {
      if (h2hView === "btts") comparison = consecutive(left.h2h.btts) - consecutive(right.h2h.btts);
      else if (h2hView === "over") {
        const streak = (fixture: DashboardFixture) => consecutive(fixture.h2h.matches.map((match) => match.homeGoals + match.awayGoals > overLine));
        comparison = streak(left) - streak(right);
      } else {
        const target = h2hSortTargets[h2hSortMode]!;
        comparison = compareOutcomeSequences(left.h2h.outcomes, right.h2h.outcomes, target);
      }
    }
    return comparison * sortDirection || Date.parse(left.kickoff) - Date.parse(right.kickoff);
  }), [filtered, formSortMode, h2hSortMode, h2hView, marketFilter, overLine, sortDirection, sortKey]);

  const sort = (key: SortKey) => {
    if (key === "form") {
      setFormSortMode((value) => (value + 1) % 3);
      setSortKey(key);
      setSortDirection(-1);
      return;
    }
    if (key === "h2h" && h2hView === "outcome") {
      setH2hSortMode((value) => (value + 1) % 3);
      setSortKey(key);
      setSortDirection(-1);
      return;
    }
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
  const shownMarkets = marketFilter === "all" ? MARKET_OPTIONS.slice(1) : MARKET_OPTIONS.filter((option) => option.key === marketFilter);
  const showScore = marketFilter === "all" || marketFilter === "1x2" || marketFilter === "draw";
  const gridStyle = { "--market-count": shownMarkets.length } as CSSProperties;
  const rangeLabel = rangeMode === "days" ? `${days} Tag(e) ab ${document.meta.firstAvailableDate ? document.meta.firstAvailableDate.split("-").reverse().join(".") : "–"}` : `${hours} Stunde(n) ab jetzt`;

  const kpis = [
    { key: "all" as const, icon: ListBullets, value: counts.all, label: "Alle Partien", tone: "violet" },
    { key: "strong" as const, icon: Star, value: counts.strong, label: "Starke Tipps", tone: "gold" },
    { key: "recommended" as const, icon: CheckCircle, value: counts.recommended, label: "Empfehlungen", tone: "violet" }
  ];

  return <div className={`app-shell density-${density} ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">FA</span>{sidebarOpen && <span><strong>Fußball-Analyzer</strong><small>Modell v3.2</small></span>}</div>
      <button className="sidebar-toggle" onClick={() => setSidebarOpen((value) => !value)} aria-label="Sidebar umschalten">{sidebarOpen ? <CaretDoubleLeft /> : <CaretDoubleRight />}</button>
      {sidebarOpen && <>
        <section className="sidebar-section">
          <h2>Zeitraum</h2>
          <div className="range-grid">
            <button className={rangeMode === "days" ? "active" : ""} onClick={() => setRangeMode("days")}>Tage</button>
            <input aria-label="Anzahl Tage" type="number" min={1} max={document.meta.maximumDays} value={days} disabled={rangeMode !== "days"} onChange={(event) => setDays(Math.max(1, Math.min(document.meta.maximumDays, Number(event.target.value))))} />
            <button className={rangeMode === "hours" ? "active" : ""} onClick={() => setRangeMode("hours")}>Stunden</button>
            <input aria-label="Anzahl Stunden" type="number" min={1} max={document.meta.maximumHours} value={hours} disabled={rangeMode !== "hours"} onChange={(event) => setHours(Math.max(1, Math.min(document.meta.maximumHours, Number(event.target.value))))} />
          </div>
          <label><input type="checkbox" checked={showCrossLeague} onChange={(event) => setShowCrossLeague(event.target.checked)} /> Pokal- / Cross-League</label>
          <label><input type="checkbox" checked={showPast} onChange={(event) => setShowPast(event.target.checked)} /> Laufende / beendete Partien</label>
          <p>{rangeLabel}<br />{filtered.length} von {document.meta.fixtureCount} Partien</p>
        </section>
        <section className="sidebar-section kpi-section">
          <h2>Filter & Kennzahlen</h2>
          {kpis.map(({ key, icon: Icon, value, label, tone }) => <button key={key} className={`kpi ${tone} ${levelFilter === key ? "active" : ""}`} onClick={() => setLevelFilter((current) => current === key ? "all" : key)}>
            <span className="kpi-icon"><Icon size={18} weight="duotone" /></span><span><strong>{value}</strong><small>Partien</small><b>{label}</b></span><em>Filter</em>
          </button>)}
        </section>
      </>}
      <div className="mini-kpis">{kpis.map(({ key, icon: Icon, value }) => <button key={key} title={`${value} Partien`} onClick={() => setLevelFilter(key)}><Icon /><small>{value}</small></button>)}</div>
    </aside>

    <main className="content">
      {banner && <div className="banner"><span><RocketLaunch size={20} weight="duotone" /></span><p><strong>Grün</strong> markierte Tipps erfüllen alle Modellkriterien, gelbe sind starke Kandidaten. Sortiere über die Spaltenköpfe, filtere Märkte über die Reiter.</p><button onClick={() => setBanner(false)} aria-label="Hinweis schließen"><X /></button></div>}
      <nav className="market-tabs" aria-label="Marktfilter">
        {MARKET_OPTIONS.map((option) => <button className={marketFilter === option.key ? "active" : ""} key={option.key} onClick={() => { setMarketFilter(option.key); setOpenFixture(null); }}>{option.label}</button>)}
      </nav>
      <div className="view-toolbar">
        <span>H2H</span>
        <div className="segmented">
          {([ ["outcome", "Ergebnis"], ["btts", "BTTS"], ["over", "Über"] ] as const).map(([key, label]) => <button className={h2hView === key ? "active" : ""} onClick={() => setH2hView(key)} key={key}>{label}</button>)}
        </div>
        <select aria-label="Über-Linie für H2H" value={overLine} disabled={h2hView !== "over"} onChange={(event) => setOverLine(Number(event.target.value) as 1.5 | 2.5 | 3.5)}><option value={1.5}>Über 1,5</option><option value={2.5}>Über 2,5</option><option value={3.5}>Über 3,5</option></select>
        <div className="segmented density-switch">
          {([ ["micro", "XS"], ["compact", "Kompakt"], ["comfort", "Komfort"] ] as const).map(([key, label]) => <button className={density === key ? "active" : ""} onClick={() => setDensity(key)} key={key}>{label}</button>)}
        </div>
      </div>

      <div className="table-scroll">
        <div className="table-head fixture-grid" style={gridStyle}>
          <button onClick={() => sort("kickoff")}>Anstoß & Liga {arrow("kickoff")}</button>
          <button onClick={() => sort("team")}>Partie {arrow("team")}</button>
          <button onClick={() => sort("form")}>
            Letzte 5 Form {sortKey === "form"
              ? <span className={`sort-mode-badge ${formSortLabel.className}`} aria-label={`Sortierung: ${formSortLabel.label}`} title={formSortLabel.label}>{formSortLabel.badge}</span>
              : arrow("form")}
          </button>
          <button onClick={() => sort("h2h")}>
            Letzte 5 H2H {h2hView === "outcome" && sortKey === "h2h"
              ? <span className={`sort-mode-badge ${h2hSortTarget}`} aria-label={`Sortierung: ${h2hSortLabel.label}`} title={h2hSortLabel.label}>{h2hSortLabel.badge}</span>
              : arrow("h2h")}
          </button>
          <button onClick={() => sort("expected")}>Erw. Tore {arrow("expected")}</button>
          {showScore && <button onClick={() => sort("score")}>Score {arrow("score")}</button>}
          {shownMarkets.map((option) => <button key={option.key} onClick={() => sort("market")}>{option.label} {arrow("market")}</button>)}
        </div>
        {sortedFixtures.map((fixture) => {
          const time = kickoffParts(fixture.kickoff, document.meta.timezone);
          const isPast = Date.parse(fixture.kickoff) < now;
          const markets = visibleMarkets(fixture, marketFilter);
          return <article className={`fixture-wrap level-${bestLevel(fixture, marketFilter)} ${openFixture === fixture.fixtureId ? "open" : ""}`} key={fixture.fixtureId}>
            <button className="fixture-grid fixture-row" style={gridStyle} onClick={() => setOpenFixture((value) => value === fixture.fixtureId ? null : fixture.fixtureId)} aria-expanded={openFixture === fixture.fixtureId}>
              <span className="time-cell"><strong>{time.clock}{isPast && <em> angepfiffen</em>}</strong><small>{time.day} · {fixture.country} · {fixture.league}</small>{(fixture.h2hNotice || fixture.warnings.length > 0) && <i>{fixture.h2hNotice ? "H2H" : "Daten"}</i>}</span>
              <span className="teams-cell"><strong>{fixture.homeTeam}</strong><strong>{fixture.awayTeam}</strong></span>
              <span className="form-cell"><span className="scope">{fixture.form.scope === "overall" ? "Gesamt" : "H/A"}</span><span><FormDots results={fixture.form.home} /><FormDots results={fixture.form.away} /></span></span>
              <span className="h2h-cell"><H2hDots fixture={fixture} view={h2hView} overLine={overLine} /></span>
              <span className="expected-cell"><strong>{fixture.expectedGoals.home.toFixed(2).replace(".", ",")}</strong><i>:</i><strong>{fixture.expectedGoals.away.toFixed(2).replace(".", ",")}</strong></span>
              {showScore && <span className="score-cell">{marketFilter !== "draw" && <span><small>1X2</small><strong>{fixture.scores.favorite ?? "–"}</strong></span>}{marketFilter !== "1x2" && <span><small>X</small><strong>{fixture.scores.draw ?? "–"}</strong></span>}</span>}
              {markets.map((item) => <MarketCard market={item} key={item.key} />)}
            </button>
            {openFixture === fixture.fixtureId && <div className="fixture-details">
              <section><h3>Direkte Begegnungen</h3>{fixture.h2h.matches.length ? fixture.h2h.matches.map((match) => <p key={`${match.date}-${match.homeTeam}`}>{new Intl.DateTimeFormat("de-DE", { timeZone: document.meta.timezone }).format(new Date(match.date))} · {match.homeTeam} {match.homeGoals}:{match.awayGoals} {match.awayTeam}</p>) : <p>Keine H2H-Ergebnisse verfügbar.</p>}</section>
              <section><h3>Bewertung je Markt</h3><div className="market-details">{fixture.markets.map((item) => <div key={item.key} className={item.recommendation.level}><i /><span><strong>{item.label} · {item.recommendation.label}</strong>{item.details.join(" · ")}</span></div>)}</div></section>
            </div>}
          </article>;
        })}
        {sortedFixtures.length === 0 && <EmptyState title="Keine Partien für diese Auswahl" text="Wähle einen anderen Zeitraum oder setze den Bewertungsfilter zurück." />}
      </div>
    </main>
  </div>;
}

export function App() {
  const state = useDashboardData();
  if (state.status === "loading") return <div className="status-screen"><span className="brand-mark">FA</span><strong>Dashboard wird geladen …</strong></div>;
  if (!state.document) return <div className="status-screen"><span className="brand-mark">FA</span><EmptyState title="Noch keine Analyse vorhanden" text={state.message ?? "Starte npm run dashboard -- --dates next48 im Chat."} /></div>;
  return <><Dashboard document={state.document} />{state.status === "error" && <div className="connection-warning">{state.message} · Letzter erfolgreicher Stand wird weiter angezeigt.</div>}</>;
}
