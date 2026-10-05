import { Binoculars, Broadcast, Info, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CountryFlag, formatOdd } from "./App";
import type { LiveLoadState } from "./liveData";
import {
  blockedText,
  chanceOf,
  eventText,
  isDecided,
  liveQuestionLabel,
  marketKeyOf,
  questionHasChance,
  SIDE_UNRELIABLE_TEXT,
  standText,
  totalCards,
  type LiveQuestion
} from "./liveQuestions";
import type { DashboardMarket, LiveBoardEvent, LiveBoardMatch, LiveTeamSnapshot } from "./types";

const PANEL_WIDTH = 440;
const PANEL_MARGIN = 12;

/** Ganze Prozent: Eine Nachkommastelle täte genauer, als eine Live-Schätzung ist. */
const pct = (value: number) => `${Math.round(value * 100)} %`;
const decimal = (value: number) => value.toFixed(2).replace(".", ",");

export const LIVE_WARNING = "Vorläufig, noch nicht an genug Spielen geprüft. Live-Chancen schätzt das Modell aus der"
  + " Torerwartung vor dem Anpfiff, Spielstand, Minute und Roten Karten. Sie gelten für 90 Minuten – rechne nicht mit Gewinn.";
const PROVISIONAL_TITLE = "Noch nicht an genug laufenden Spielen geprüft.";
const CUP_NOTE = "Gilt nach 90 Minuten. Im Pokal heißt das nicht „kommt weiter“.";
const NO_CARD_DATA = "Keine Kartendaten – in dieser Liga fehlen Karten in den Ereignissen.";

/** Die drei Hauptzahlen im Fenster; der Rest steht als eine Kontextzeile darunter. */
const MAIN_METRICS: Array<{ key: keyof LiveTeamSnapshot; label: string }> = [
  { key: "shotsOnGoal", label: "Schüsse aufs Tor" },
  { key: "shotsInsideBox", label: "Schüsse im Strafraum" },
  { key: "totalShots", label: "Schüsse gesamt" }
];
const CONTEXT_METRICS: Array<{ key: keyof LiveTeamSnapshot; label: string; unit?: string }> = [
  { key: "corners", label: "Ecken" },
  { key: "possession", label: "Ballbesitz", unit: " %" },
  { key: "fouls", label: "Fouls" },
  { key: "offsides", label: "Abseits" },
  { key: "goalkeeperSaves", label: "Paraden" }
];

export function minuteLabel(match: LiveBoardMatch): string {
  if (match.status.short === "HT") return "HZ";
  if (match.status.short === "BT") return "Pause";
  if (match.status.short === "P") return "11 m";
  if (match.status.short === "INT" || match.status.short === "SUSP") return "Unt.";
  if (match.elapsed === null) return match.status.short;
  const minute = `${match.elapsed}${match.extra ? `+${match.extra}` : ""}'`;
  return match.status.short === "ET" ? `${minute} Verl.` : minute;
}

/** Fehlende Werte bleiben sichtbar leer - eine fehlende Statistik ist keine Null. */
function metricText(value: number | null, unit = ""): string {
  return value === null ? "–" : `${value}${unit}`;
}

function share(home: number | null, away: number | null): number | null {
  if (home === null || away === null) return null;
  const total = home + away;
  if (total <= 0) return null;
  return home / total;
}

function eventGlyph(event: LiveBoardEvent): string {
  const type = event.type.toLocaleLowerCase();
  if (type === "goal") return event.detail.toLocaleLowerCase().includes("missed") ? "✕" : "⚽";
  if (type === "var") return "VAR";
  const detail = event.detail.toLocaleLowerCase();
  return detail.includes("red") || detail.includes("second") ? "🟥" : "🟨";
}

function statisticsMissingText(match: LiveBoardMatch): string {
  return match.statisticsCoverage === false
    ? "Diese Liga liefert keine Live-Statistik."
    : "Für dieses Spiel liefert API-Football gerade keine Live-Statistik.";
}

function Provisional({ match }: { match: LiveBoardMatch }) {
  if (!match.live.provisional) return null;
  return <span className="live-provisional" title={PROVISIONAL_TITLE}>vorläufig</span>;
}

/** Drei Anteile nebeneinander - Heim, Mitte (Remis bzw. kein Tor), Gast. Keine neue Farbe. */
function ThreeWayBar({ home, middle, away }: { home: number; middle: number; away: number }) {
  return <span className="live-metric-bar" aria-hidden>
    <i className="home" style={{ width: `${home * 100}%` }} />
    <i className="middle" style={{ width: `${middle * 100}%` }} />
    <i className="away" style={{ width: `${away * 100}%` }} />
  </span>;
}

function prematchMarket(match: LiveBoardMatch, question: LiveQuestion): DashboardMarket | null {
  const key = marketKeyOf(question);
  return key ? match.prematch.markets.find((market) => market.key === key) ?? null : null;
}

/** „vor Anpfiff 60 %“ grau - ohne Stufe, ohne Quote. Nie bei `probabilityReliable: false`. */
function PrematchHint({ market }: { market: DashboardMarket | null }) {
  if (!market || market.probabilityReliable === false) return null;
  return <small className="live-prematch-hint" title="Wahrscheinlichkeit vor dem Anpfiff - im Spiel veraltet">vor Anpfiff {pct(market.probability)}</small>;
}

function nextGoalText(next: NonNullable<LiveBoardMatch["live"]["nextGoal"]>): string {
  return `Heim ${Math.round(next.home * 100)} · keins ${Math.round(next.none * 100)} · Gast ${Math.round(next.away * 100)}`;
}

function resultText(result: NonNullable<LiveBoardMatch["live"]["result"]>): string {
  return `1 ${Math.round(result.home * 100)} · X ${Math.round(result.draw * 100)} · 2 ${Math.round(result.away * 100)}`;
}

/** Die Zelle mit der Antwort auf die gewählte Frage und die Zelle daneben. */
function questionCells(match: LiveBoardMatch, question: LiveQuestion): [ReactNode, ReactNode] {
  const live = match.live;
  const blocked = blockedText(match);
  const market = prematchMarket(match, question);

  if (question === "cards") {
    const total = totalCards(match);
    if (total === null || !match.cards) return [<span className="live-fact">keine Kartendaten</span>, null];
    return [
      <strong className="live-chance">{total}</strong>,
      <small>Gelb {match.cards.home.yellow} : {match.cards.away.yellow} · Rot {match.cards.home.red} : {match.cards.away.red}</small>
    ];
  }

  if (question === "btts" || question === "bttsNo") {
    return [<span className="live-fact">{standText(match, question) ?? "–"}</span>, <PrematchHint market={market} />];
  }

  const stand = standText(match, question);
  if (isDecided(match, question)) {
    return [<span className="live-fact">{stand}</span>, <PrematchHint market={market} />];
  }
  if (blocked) {
    return [<span className="live-fact muted">{blocked}</span>, <PrematchHint market={market} />];
  }

  if (question === "nextGoal") {
    if (!live.nextGoal) return [<span className="live-fact muted">{SIDE_UNRELIABLE_TEXT}</span>, null];
    const side = live.nextGoal.home >= live.nextGoal.away ? "Heim" : "Gast";
    return [
      <span className="live-value-line"><strong className="live-chance">{side} {pct(chanceOf(match, question)!)}</strong><Provisional match={match} /></span>,
      <><ThreeWayBar home={live.nextGoal.home} middle={live.nextGoal.none} away={live.nextGoal.away} /><small>{nextGoalText(live.nextGoal)}</small></>
    ];
  }

  if (question === "result") {
    if (!live.result) return [<span className="live-fact muted">{SIDE_UNRELIABLE_TEXT}</span>, null];
    const { home, draw, away } = live.result;
    const outcome = home >= draw && home >= away ? "1" : draw >= away ? "X" : "2";
    return [
      <span className="live-value-line" title={match.prematch.crossLeague ? CUP_NOTE : "Gilt nach 90 Minuten."}>
        <strong className="live-chance">{outcome} · {pct(chanceOf(match, question)!)}</strong><Provisional match={match} />
      </span>,
      <><ThreeWayBar home={home} middle={draw} away={away} /><small>{resultText(live.result)}</small></>
    ];
  }

  const chance = chanceOf(match, question);
  const main = <span className="live-value-line">
    <strong className="live-chance">{chance === null ? "–" : pct(chance)}</strong><Provisional match={match} />
  </span>;
  if (question === "overview") {
    return [main, <>
      {live.nextGoal
        ? <><ThreeWayBar home={live.nextGoal.home} middle={live.nextGoal.none} away={live.nextGoal.away} /><small>Nächstes Tor: {nextGoalText(live.nextGoal)}</small></>
        : <small>Nächstes Tor: {SIDE_UNRELIABLE_TEXT}</small>}
      {live.remainingGoals !== null && <small>Erwartete Resttore {decimal(live.remainingGoals)}</small>}
    </>];
  }
  if (question === "anotherGoal") {
    return [main, live.remainingGoals !== null ? <small>Erwartete Resttore {decimal(live.remainingGoals)}</small> : null];
  }
  return [main, <>{stand && <small>{stand}</small>}<PrematchHint market={market} /></>];
}

function RedChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return <i className="live-red" title={count === 1 ? "Rote Karte" : `${count} Rote Karten`}>{count}</i>;
}

function StatCell({ home, away, title }: { home: string; away: string; title?: string }) {
  return <span className="live-stat" title={title}>
    <span className="home">{home}</span>
    <span className="away">{away}</span>
  </span>;
}

/** Pässe mit Quote dahinter („412 · 84 %“); fehlt eine Zahl, bleibt „–“. */
function passText(team: LiveTeamSnapshot): string {
  if (team.totalPasses === null) return "–";
  return team.passAccuracy === null ? `${team.totalPasses}` : `${team.totalPasses} · ${team.passAccuracy} %`;
}

/** Eine Karte steht nur beim Team, das sie hat - eine gelbe „0“ las sich wie eine Karte. */
function CardCount({ count, tone }: { count: number; tone: "yellow" | "red" }) {
  if (count <= 0) return null;
  return <span className={`live-card ${tone}`} title={tone === "red" ? "Rote Karten" : "Gelbe Karten"}>
    <i aria-hidden />{count}<span className="visually-hidden">{tone === "red" ? " Rot" : " Gelb"}</span>
  </span>;
}

/** Karten nur beim Team, das welche hat; ohne Kartendaten der Liga ein Strich. */
function CardsCell({ match }: { match: LiveBoardMatch }) {
  if (!match.cards) {
    return <span className="live-stat" title="Keine Kartendaten – in dieser Liga fehlen Karten in den Ereignissen.">
      <span className="home">–</span><span className="away">–</span>
    </span>;
  }
  const side = (team: { yellow: number; red: number }) => <>
    <CardCount count={team.yellow} tone="yellow" /><CardCount count={team.red} tone="red" />
  </>;
  return <span className="live-stat">
    <span className="home">{side(match.cards.home)}</span>
    <span className="away">{side(match.cards.away)}</span>
  </span>;
}

/** Die Kopfzeile der Liste: Die Frage steht hier einmal statt in jeder Zeile. */
function LiveHead({ question }: { question: LiveQuestion }) {
  return <div className="live-row live-head" aria-hidden>
    <span>Min.</span>
    <span>Spiel</span>
    <span>Stand</span>
    <span>{liveQuestionLabel(question === "overview" ? "anotherGoal" : question)}</span>
    <span>Aufs Tor</span>
    <span>Karten</span>
    <span>Ballbesitz</span>
    <span>Pässe</span>
  </div>;
}

/** Wo das Fenster aufgeht: an der Maus, oder bei der Tastatur neben der Zeile. */
export interface PanelAnchor { x: number; y: number }

function LiveRow({ match, question, open, onToggle }: {
  match: LiveBoardMatch;
  question: LiveQuestion;
  open: boolean;
  onToggle(fixtureId: number, anchor: PanelAnchor): void;
}) {
  const [main, secondary] = questionCells(match, question);
  const missing = match.metricsAvailable ? undefined : statisticsMissingText(match);
  const { home, away } = match.metrics;
  // Seit 29.09.2026 per Klick statt beim Überfahren (Davids Wunsch): Das Fenster ging sonst
  // schon beim Weg über die Liste auf und verdeckte die Zeilen darunter.
  return <article
    className={`live-row${open ? " open" : ""}`}
    tabIndex={0}
    title="Klicken für die Kennzahlen"
    aria-label={`${match.homeTeam} gegen ${match.awayTeam}, ${match.goals.home ?? 0} zu ${match.goals.away ?? 0}, ${minuteLabel(match)}`}
    onClick={(event) => {
      // Sonst schlösse der Klick-daneben-Wächter das eben geöffnete Fenster gleich wieder.
      event.stopPropagation();
      onToggle(match.fixtureId, { x: event.clientX, y: event.clientY });
    }}
    onKeyDown={(event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onToggle(match.fixtureId, { x: rect.right, y: rect.top });
    }}
  >
    <span className="live-minute live">{minuteLabel(match)}</span>
    <span className="live-teams">
      <span className="live-team"><strong>{match.homeTeam}</strong><RedChip count={match.cards?.home.red ?? 0} /></span>
      <span className="live-team"><strong>{match.awayTeam}</strong><RedChip count={match.cards?.away.red ?? 0} /></span>
      <small className="live-league"><CountryFlag country={match.country} /> {match.country} · {match.league}</small>
    </span>
    <span className="live-score">
      <strong>{match.goals.home ?? 0}</strong>
      <strong>{match.goals.away ?? 0}</strong>
    </span>
    <span className="live-value">{main}{secondary && <span className="live-second">{secondary}</span>}</span>
    {/* Je Kennzahl eine Spalte, Heim oben und Gast unten - auf Höhe der Teamnamen. */}
    <StatCell title={missing} home={metricText(home.shotsOnGoal)} away={metricText(away.shotsOnGoal)} />
    <CardsCell match={match} />
    <StatCell title={missing} home={metricText(home.possession, " %")} away={metricText(away.possession, " %")} />
    <StatCell title={missing} home={passText(home)} away={passText(away)} />
  </article>;
}

function MetricRow({ label, home, away }: { label: string; home: number | null; away: number | null }) {
  const ratio = share(home, away);
  return <div className="live-metric-row">
    <strong className="live-metric-home">{metricText(home)}</strong>
    <span className="live-metric-body">
      <small>{label}</small>
      <span className="live-metric-bar" aria-hidden>
        {ratio === null
          ? <i className="empty" />
          : <><i className="home" style={{ width: `${ratio * 100}%` }} /><i className="away" style={{ width: `${(1 - ratio) * 100}%` }} /></>}
      </span>
    </span>
    <strong className="live-metric-away">{metricText(away)}</strong>
  </div>;
}

/**
 * Das Fenster geht an der Maus auf: rechts daneben, und wo rechts kein Platz ist, links davon.
 * Nach unten rückt es so weit hoch, dass es ganz zu sehen ist - dafür braucht es seine echte
 * Höhe, die erst nach dem Zeichnen feststeht (`height`, 0 beim ersten Zeichnen).
 */
function panelStyle(anchor: PanelAnchor, height: number): CSSProperties {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const fitsRight = anchor.x + PANEL_MARGIN + PANEL_WIDTH <= viewportWidth;
  const left = fitsRight
    ? anchor.x + PANEL_MARGIN
    : Math.max(PANEL_MARGIN, anchor.x - PANEL_WIDTH - PANEL_MARGIN);
  const top = Math.max(PANEL_MARGIN, Math.min(anchor.y, viewportHeight - height - PANEL_MARGIN));
  return { top, left, width: PANEL_WIDTH };
}

function lineText(match: LiveBoardMatch, key: "over15" | "over25" | "over35", label: string): string {
  const stand = match.marketStands[key];
  if (stand?.status === "won") return `${label} erreicht`;
  const value = match.live.lines?.[key];
  return value === undefined ? `${label} –` : `${label} ${pct(value)}`;
}

function LiveChancesSection({ match }: { match: LiveBoardMatch }) {
  const live = match.live;
  const blocked = blockedText(match);
  return <section className="live-section">
    <h4>Chancen live{live.provisional && <> · <span className="live-provisional" title={PROVISIONAL_TITLE}>vorläufig</span></>}</h4>
    {blocked ? <p className="live-panel-empty">{blocked}</p> : <>
      <dl className="live-chances">
        <div><dt>Noch ein Tor</dt><dd>{pct(live.anotherGoal!)}</dd></div>
        <div><dt>Erwartete Resttore</dt><dd>{decimal(live.remainingGoals!)}</dd></div>
        <div><dt>Nächstes Tor</dt><dd>{live.nextGoal ? nextGoalText(live.nextGoal) : SIDE_UNRELIABLE_TEXT}</dd></div>
        <div><dt>Sieger nach 90 Min.</dt><dd>{live.result ? resultText(live.result) : SIDE_UNRELIABLE_TEXT}</dd></div>
        <div><dt>Tore am Ende</dt><dd>{[lineText(match, "over15", "Ü1,5"), lineText(match, "over25", "Ü2,5"), lineText(match, "over35", "Ü3,5")].join(" · ")}</dd></div>
      </dl>
      {(!live.nextGoal || !live.result) && <p className="live-panel-note">Ohne Ligastärke-Vergleich keine belastbare Chance auf Sieger und nächstes Tor.</p>}
      <p className="live-panel-note">{match.prematch.crossLeague ? CUP_NOTE : "Gilt für 90 Minuten."} Rechne nicht mit Gewinn.</p>
    </>}
  </section>;
}

export function LiveMetricsPanel({ match, question, anchor, panelRef }: {
  match: LiveBoardMatch;
  question: LiveQuestion;
  anchor: PanelAnchor;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const [height, setHeight] = useState(0);
  // Die Höhe hängt am Inhalt (Ereignisse, Statistik); gemessen vor dem Zeichnen, damit das
  // Fenster nicht sichtbar springt. Neu gemessen bei jedem Abruf, der den Inhalt ändert.
  useLayoutEffect(() => {
    const measured = panelRef.current?.offsetHeight ?? 0;
    if (measured !== height) setHeight(measured);
  });
  // Tore und Karten zuerst: Wechsel verdrängten sie früher aus den letzten acht Einträgen.
  const events = match.events.filter((event) => event.type.toLocaleLowerCase() !== "subst").slice(-8);
  const selectedKey = marketKeyOf(question);
  const prematchMarkets = match.prematch.markets.filter((market) =>
    market.key === selectedKey || market.recommendation.level !== "none");
  const context = CONTEXT_METRICS
    .filter(({ key }) => match.metrics.home[key] !== null || match.metrics.away[key] !== null)
    .map(({ key, label, unit }) => <span key={key}>{label} <strong>{metricText(match.metrics.home[key], unit)}</strong> : <strong>{metricText(match.metrics.away[key], unit)}</strong></span>);
  return <div className="live-panel" ref={panelRef} style={panelStyle(anchor, height)} role="dialog" aria-label={`Live-Kennzahlen ${match.homeTeam} gegen ${match.awayTeam}`}>
    <div className="live-panel-head">
      <span className="live-minute live">{minuteLabel(match)}</span>
      <strong>{match.homeTeam} {match.goals.home ?? 0}:{match.goals.away ?? 0} {match.awayTeam}</strong>
      <small><CountryFlag country={match.country} /> {match.country} · {match.league}
        {match.halfTime.home !== null && <> · HZ {match.halfTime.home}:{match.halfTime.away ?? 0}</>}</small>
    </div>
    <LiveChancesSection match={match} />
    <section className="live-section">
      <h4>Karten</h4>
      {match.cards
        ? <p className="live-cards">Gelb <strong>{match.cards.home.yellow} : {match.cards.away.yellow}</strong> · Rot <strong>{match.cards.home.red} : {match.cards.away.red}</strong></p>
        : <p className="live-panel-empty">{NO_CARD_DATA}</p>}
    </section>
    {events.length > 0 && <section className="live-section live-events">
      <h4>Tore und Karten</h4>
      <ul>{events.map((event, index) => <li className={event.side ?? "neutral"} key={`${event.minute}-${index}`}>
        <span className="live-event-minute">{event.minute}{event.extra ? `+${event.extra}` : ""}&#39;</span>
        <span className="live-event-glyph" aria-hidden>{eventGlyph(event)}</span>
        <span className="live-event-text">{eventText(event.type, event.detail)}{event.player ? ` · ${event.player}` : ""}</span>
      </li>)}</ul>
    </section>}
    <section className="live-section">
      <h4>Statistik</h4>
      {match.metricsAvailable
        ? <div className="live-metric-list">
            {MAIN_METRICS.map((row) => <MetricRow key={row.key} label={row.label}
              home={match.metrics.home[row.key]} away={match.metrics.away[row.key]} />)}
            {context.length > 0 && <p className="live-context">{context}</p>}
          </div>
        : <p className="live-panel-empty">{statisticsMissingText(match)}</p>}
    </section>
    <section className="live-section live-prematch">
      <h4>Vor dem Anpfiff</h4>
      <p>Erwartete Tore {decimal(match.prematch.expectedGoals.home)} : {decimal(match.prematch.expectedGoals.away)} · Datenvertrauen {match.prematch.dataConfidence} %</p>
      {prematchMarkets.length > 0 && <ul>{prematchMarkets.map((market) => <li className={market.recommendation.level} key={market.key}>
        <span>{market.recommendation.level === "strong" ? "★ " : market.recommendation.level === "recommended" ? "✓ " : ""}{market.label}</span>
        {/* Ohne Ligastärke-Vergleich bleibt die Wahrscheinlichkeit verborgen (AGENTS.md Punkt 5). */}
        <span>{market.probabilityReliable === false ? SIDE_UNRELIABLE_TEXT : pct(market.probability)}</span>
        <strong>{formatOdd(market.odds)}</strong>
      </li>)}</ul>}
    </section>
  </div>;
}

export function LiveView({ state, matches, runningCount, question, onResetFilters }: {
  state: LiveLoadState;
  /** Die laufenden Spiele nach Wettbewerben und Anzeige-Filtern, fertig sortiert. */
  matches: LiveBoardMatch[];
  /** Laufende Spiele vor den Anzeige-Filtern - trennt „läuft keins“ von „Filter blenden alles aus“. */
  runningCount: number;
  question: LiveQuestion;
  onResetFilters(): void;
}) {
  const [opened, setOpened] = useState<{ fixtureId: number; anchor: PanelAnchor } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Zu geht es mit Escape, einem Klick daneben oder einem zweiten Klick auf dieselbe Zeile.
  // Ein Klick ins Fenster selbst lässt es offen.
  useEffect(() => {
    if (!opened) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpened(null);
    };
    const closeOutside = (event: MouseEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      setOpened(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("click", closeOutside);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("click", closeOutside);
    };
  }, [opened]);

  const toggle = (fixtureId: number, anchor: PanelAnchor) =>
    setOpened((value) => value?.fixtureId === fixtureId ? null : { fixtureId, anchor });
  const active = opened === null ? null : matches.find((match) => match.fixtureId === opened.fixtureId) ?? null;

  if (state.status === "loading" || state.status === "idle") {
    return <div className="live-status"><Broadcast size={20} weight="duotone" aria-hidden /> Live-Daten werden geladen …</div>;
  }
  if (state.status === "error" && !state.board) {
    return <div className="live-status error"><WarningCircle size={20} weight="duotone" aria-hidden /> {state.message}</div>;
  }

  const showsChance = questionHasChance(question)
    && matches.some((match) => match.live.state === "ok" && match.live.provisional);

  return <>
    {state.message && <div className="live-notice" role="status">
      <WarningCircle size={16} weight="duotone" aria-hidden /><span>{state.message}</span>
    </div>}
    {showsChance && <p className="filter-note warning live-warning"><Info size={13} weight="bold" aria-hidden />{LIVE_WARNING}</p>}
    {/* Das Fenster steht fest an der Klickstelle; scrollt die Liste darunter weg, gehört es zu
        keiner sichtbaren Zeile mehr und geht zu. */}
    <div className="live-list" onScroll={() => setOpened(null)}>
      {matches.length > 0 && <LiveHead question={question} />}
      {matches.map((match) => <LiveRow
        key={match.fixtureId}
        match={match}
        question={question}
        open={opened?.fixtureId === match.fixtureId}
        onToggle={toggle}
      />)}
      {matches.length === 0 && (runningCount === 0
        ? <div className="empty-state">
            <Binoculars size={32} weight="duotone" />
            <strong>Gerade läuft keins der analysierten Spiele</strong>
            <span>Die Live-Ansicht beobachtet nur Spiele aus der letzten Analyse. Solange keins läuft, kostet sie keine API-Aufrufe.</span>
          </div>
        : <div className="empty-state">
            <Binoculars size={32} weight="duotone" />
            <strong>Kein laufendes Spiel passt zu den Filtern</strong>
            <span>{runningCount === 1 ? "Ein Spiel läuft" : `${runningCount} Spiele laufen`}, aber keins erfüllt die Filter.</span>
            <button className="empty-state-action" onClick={onResetFilters}>Filter zurücksetzen</button>
          </div>)}
    </div>
    {active && <LiveMetricsPanel match={active} question={question} anchor={opened!.anchor} panelRef={panelRef} />}
  </>;
}
