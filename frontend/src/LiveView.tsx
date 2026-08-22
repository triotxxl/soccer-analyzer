import { Binoculars, Broadcast, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState, type CSSProperties } from "react";
import { CountryFlag, MarketCard, formatOdd, formatPercent } from "./App";
import type { LiveLoadState } from "./liveData";
import type {
  DashboardMarket,
  DashboardMarketKey,
  LiveBoardEvent,
  LiveBoardMatch,
  LiveTeamSnapshot
} from "./types";

const PANEL_WIDTH = 460;
const PANEL_MARGIN = 12;

/** Kennzahlen aus dem Live-Konzept, Abschnitt 8. Reihenfolge = Anzeigereihenfolge im Fenster. */
const METRIC_ROWS: Array<{ key: keyof LiveTeamSnapshot; label: string; unit?: string; decimals?: number }> = [
  { key: "possession", label: "Ballbesitz", unit: " %" },
  { key: "totalShots", label: "Schüsse gesamt" },
  { key: "shotsOnGoal", label: "Schüsse aufs Tor" },
  { key: "shotsOffGoal", label: "Schüsse daneben" },
  { key: "blockedShots", label: "Geblockte Schüsse" },
  { key: "shotsInsideBox", label: "Schüsse im Strafraum" },
  { key: "shotsOutsideBox", label: "Schüsse außerhalb" },
  { key: "corners", label: "Ecken" },
  { key: "goalkeeperSaves", label: "Paraden" },
  { key: "offsides", label: "Abseits" },
  { key: "fouls", label: "Fouls" },
  { key: "passAccuracy", label: "Passgenauigkeit", unit: " %" },
  { key: "yellowCards", label: "Gelbe Karten" },
  { key: "redCards", label: "Rote Karten" },
  { key: "expectedGoals", label: "xG (API)", decimals: 2 }
];

export function minuteLabel(match: LiveBoardMatch): string {
  if (match.status.short === "HT") return "HZ";
  if (match.status.short === "BT") return "Pause";
  if (match.status.short === "P") return "11 m";
  if (match.status.short === "INT" || match.status.short === "SUSP") return "Unt.";
  if (match.elapsed === null) return match.status.short;
  return `${match.elapsed}${match.extra ? `+${match.extra}` : ""}'`;
}

/** Fehlende Werte bleiben sichtbar leer - eine fehlende Statistik ist keine Null. */
function metricText(value: number | null, unit = "", decimals = 0): string {
  if (value === null) return "–";
  return `${decimals > 0 ? value.toFixed(decimals).replace(".", ",") : value}${unit}`;
}

function share(home: number | null, away: number | null): number | null {
  if (home === null || away === null) return null;
  const total = home + away;
  if (total <= 0) return null;
  return home / total;
}

function eventGlyph(event: LiveBoardEvent): string {
  const type = event.type.toLocaleLowerCase();
  if (type === "goal") return "⚽";
  if (type === "subst") return "⇄";
  if (type === "var") return "VAR";
  return event.detail.toLocaleLowerCase().includes("red") ? "🟥" : "🟨";
}

function MetricRow({ label, home, away, unit, decimals }: {
  label: string;
  home: number | null;
  away: number | null;
  unit?: string;
  decimals?: number;
}) {
  const ratio = share(home, away);
  return <div className="live-metric-row">
    <strong className="live-metric-home">{metricText(home, unit, decimals)}</strong>
    <span className="live-metric-body">
      <small>{label}</small>
      <span className="live-metric-bar" aria-hidden>
        {ratio === null
          ? <i className="empty" />
          : <><i className="home" style={{ width: `${ratio * 100}%` }} /><i className="away" style={{ width: `${(1 - ratio) * 100}%` }} /></>}
      </span>
    </span>
    <strong className="live-metric-away">{metricText(away, unit, decimals)}</strong>
  </div>;
}

function panelStyle(rect: DOMRect): CSSProperties {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const fitsRight = rect.right + PANEL_MARGIN + PANEL_WIDTH <= viewportWidth;
  const left = fitsRight
    ? rect.right + PANEL_MARGIN
    : Math.max(PANEL_MARGIN, rect.left - PANEL_WIDTH - PANEL_MARGIN);
  const top = Math.min(Math.max(PANEL_MARGIN, rect.top), Math.max(PANEL_MARGIN, viewportHeight - 480));
  return { top, left, width: PANEL_WIDTH };
}

export function LiveMetricsPanel({ match, rect }: { match: LiveBoardMatch; rect: DOMRect }) {
  return <div className="live-panel" style={panelStyle(rect)} role="dialog" aria-label={`Live-Metriken ${match.homeTeam} gegen ${match.awayTeam}`}>
    <div className="live-panel-head">
      <span className="live-minute live">{minuteLabel(match)}</span>
      <strong>{match.homeTeam} {match.goals.home ?? 0}:{match.goals.away ?? 0} {match.awayTeam}</strong>
      <small><CountryFlag country={match.country} /> {match.country} · {match.league}
        {match.halfTime.home !== null && <> · HZ {match.halfTime.home}:{match.halfTime.away ?? 0}</>}</small>
    </div>
    {match.metricsAvailable
      ? <div className="live-metric-list">
          {METRIC_ROWS.map((row) => <MetricRow
            key={row.key}
            label={row.label}
            home={match.metrics.home[row.key]}
            away={match.metrics.away[row.key]}
            unit={row.unit}
            decimals={row.decimals}
          />)}
          <p className="live-activity">Aktivitätsbild: <strong>{match.activity}</strong></p>
        </div>
      : <p className="live-panel-empty">Für diese Begegnung liefert API-Football keine Live-Statistiken.</p>}
    {match.events.length > 0 && <div className="live-events">
      <h4>Ereignisse</h4>
      <ul>{match.events.slice(-8).map((event, index) => <li className={event.side ?? "neutral"} key={`${event.minute}-${index}`}>
        <span className="live-event-minute">{event.minute}{event.extra ? `+${event.extra}` : ""}&#39;</span>
        <span className="live-event-glyph" aria-hidden>{eventGlyph(event)}</span>
        <span className="live-event-text">{event.detail}{event.player ? ` · ${event.player}` : ""}</span>
      </li>)}</ul>
    </div>}
    <div className="live-prematch">
      <h4>Pre-Match-Modell</h4>
      <p>Erwartete Tore {match.prematch.expectedGoals.home.toFixed(2).replace(".", ",")}:{match.prematch.expectedGoals.away.toFixed(2).replace(".", ",")} · Datenvertrauen {match.prematch.dataConfidence} %</p>
      <ul>{match.prematch.markets.map((market) => <li className={market.recommendation.level} key={market.key}>
        <span>{market.label}</span>
        <span>{formatPercent(market.probability)}</span>
        <strong>{formatOdd(market.odds)}</strong>
      </li>)}</ul>
    </div>
  </div>;
}

function visibleMarkets(markets: DashboardMarket[], filter: "all" | DashboardMarketKey): DashboardMarket[] {
  return filter === "all" ? markets : markets.filter((market) => market.key === filter);
}

function LiveRow({ match, marketFilter, showEdge, onHover, onLeave }: {
  match: LiveBoardMatch;
  marketFilter: "all" | DashboardMarketKey;
  showEdge: boolean;
  onHover(fixtureId: number, rect: DOMRect): void;
  onLeave(fixtureId: number): void;
}) {
  const markets = visibleMarkets(match.prematch.markets, marketFilter);
  const shotsOn = match.metrics.home.shotsOnGoal;
  const shotsOnAway = match.metrics.away.shotsOnGoal;
  const possession = share(match.metrics.home.possession, match.metrics.away.possession);
  const reds = { home: match.metrics.home.redCards ?? 0, away: match.metrics.away.redCards ?? 0 };
  const open = (element: HTMLElement) => onHover(match.fixtureId, element.getBoundingClientRect());
  return <article
    className="live-row"
    style={{ "--market-count": markets.length } as CSSProperties}
    tabIndex={0}
    aria-label={`${match.homeTeam} gegen ${match.awayTeam}, ${match.goals.home ?? 0} zu ${match.goals.away ?? 0}, ${minuteLabel(match)}`}
    onMouseEnter={(event) => open(event.currentTarget)}
    onMouseLeave={() => onLeave(match.fixtureId)}
    onFocus={(event) => open(event.currentTarget)}
    onBlur={() => onLeave(match.fixtureId)}
  >
    <span className="live-minute live">{minuteLabel(match)}</span>
    <span className="live-teams">
      <span className="live-team"><strong>{match.homeTeam}</strong>{reds.home > 0 && <i className="live-red" title="Rote Karte">{reds.home}</i>}</span>
      <span className="live-team"><strong>{match.awayTeam}</strong>{reds.away > 0 && <i className="live-red" title="Rote Karte">{reds.away}</i>}</span>
    </span>
    <span className="live-score">
      <strong>{match.goals.home ?? 0}</strong>
      <strong>{match.goals.away ?? 0}</strong>
    </span>
    <span className="live-meta">
      <small><CountryFlag country={match.country} /> {match.country}</small>
      <small>{match.league}</small>
    </span>
    <span className="live-momentum" title="Schüsse aufs Tor und Ballbesitz">
      <span className="live-momentum-line"><small>SaT</small><strong>{metricText(shotsOn)}:{metricText(shotsOnAway)}</strong></span>
      <span className="live-metric-bar" aria-hidden>
        {possession === null
          ? <i className="empty" />
          : <><i className="home" style={{ width: `${possession * 100}%` }} /><i className="away" style={{ width: `${(1 - possession) * 100}%` }} /></>}
      </span>
    </span>
    {markets.map((market) => <MarketCard market={market} showEdge={showEdge} key={market.key} />)}
  </article>;
}

export function LiveView({ state, marketFilter, showEdge, isLeagueVisible }: {
  state: LiveLoadState;
  marketFilter: "all" | DashboardMarketKey;
  showEdge: boolean;
  isLeagueVisible(country: string, league: string): boolean;
}) {
  const [hovered, setHovered] = useState<{ fixtureId: number; rect: DOMRect } | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHovered(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const matches = (state.board?.matches ?? []).filter((match) => isLeagueVisible(match.country, match.league));
  const active = hovered === null ? null : matches.find((match) => match.fixtureId === hovered.fixtureId) ?? null;

  if (state.status === "loading" || state.status === "idle") {
    return <div className="live-status"><Broadcast size={20} weight="duotone" aria-hidden /> Live-Daten werden geladen …</div>;
  }
  if (state.status === "error" && !state.board) {
    return <div className="live-status error"><WarningCircle size={20} weight="duotone" aria-hidden /> {state.message}</div>;
  }

  return <>
    {state.message && <div className="live-notice" role="status">
      <WarningCircle size={16} weight="duotone" aria-hidden /><span>{state.message}</span>
    </div>}
    <div className="live-list">
      {matches.map((match) => <LiveRow
        key={match.fixtureId}
        match={match}
        marketFilter={marketFilter}
        showEdge={showEdge}
        onHover={(fixtureId, rect) => setHovered({ fixtureId, rect })}
        onLeave={(fixtureId) => setHovered((value) => value?.fixtureId === fixtureId ? null : value)}
      />)}
      {matches.length === 0 && <div className="empty-state">
        <Binoculars size={32} weight="duotone" />
        <strong>Aktuell läuft keine der analysierten Partien</strong>
        <span>Die Live-Ansicht überwacht nur Begegnungen aus dem letzten Dashboard-Lauf. Solange keine davon läuft, wird kein einziger API-Call verbraucht.</span>
      </div>}
    </div>
    {active && <LiveMetricsPanel match={active} rect={hovered!.rect} />}
  </>;
}
