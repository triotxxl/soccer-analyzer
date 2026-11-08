import { Binoculars, Broadcast, Info, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CountryFlag, formatOdd } from "./App";
import type { LiveLoadState } from "../../shared/src/liveData";
import { countryName, leagueName, teamName, useNames, type NameSource } from "../../shared/src/names";
import {
  blockedText,
  chanceOf,
  eventSummary,
  eventText,
  isDecided,
  isGoalEvent,
  isRedCardEvent,
  liveQuestionLabel,
  marketKeyOf,
  matchClock,
  prematchTips,
  questionHasChance,
  SIDE_UNRELIABLE_TEXT,
  standText,
  totalCards,
  type LiveQuestion,
  type LiveTip
} from "./liveQuestions";
import { duelsOf, duelStats, H2H_FEW, type Duel } from "../../shared/src/duels";
import type { DashboardFixture, DashboardMarket, FormResult, LiveBoardEvent, LiveBoardMatch, LiveTeamSnapshot } from "../../shared/src/types";

/** Seit 03.11.2026 breiter (vorher 440): Kacheln der Chancen und die Tipp-Tabelle brauchen den Platz. */
const PANEL_WIDTH = 540;
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
function questionCells(match: LiveBoardMatch, question: LiveQuestion, names: NameSource): [ReactNode, ReactNode] {
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
    return [<span className="live-fact">{standText(match, question, names) ?? "–"}</span>, <PrematchHint market={market} />];
  }

  const stand = standText(match, question, names);
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

/**
 * Schüsse aufs Tor je Team, darunter der Ballbesitz als schmaler Balken (seit 03.11.2026; vorher je eine
 * eigene Spalte für Ballbesitz und Pässe). Die Statistik ist nur zum Einordnen da - sie fließt nicht in die
 * Chancen ein.
 */
function PressureCell({ match, title }: { match: LiveBoardMatch; title?: string }) {
  const { home, away } = match.metrics;
  const ratio = share(home.possession, away.possession);
  return <span className="live-stat" title={title}>
    <span className="home">{metricText(home.shotsOnGoal)}</span>
    <span className="away">{metricText(away.shotsOnGoal)}</span>
    {ratio !== null && <span className="live-metric-bar live-possession" title={`Ballbesitz ${home.possession} : ${away.possession} %`}>
      <i className="home" style={{ width: `${ratio * 100}%` }} /><i className="away" style={{ width: `${(1 - ratio) * 100}%` }} />
    </span>}
  </span>;
}

function tipTitle(tip: LiveTip): string {
  return `${tip.label} · ${tip.level === "strong" ? "stark empfohlen" : "empfohlen"} · vor dem Anpfiff ${pct(tip.before)}`
    + `${tip.odds ? ` · Quote ${formatOdd(tip.odds)}` : ""} · jetzt: ${tip.stand}${tip.now !== null ? ` · Live-Chance ${pct(tip.now)}` : ""}`;
}

/**
 * „Dein Tipp · jetzt“: die zwei stärksten Empfehlungen von vor dem Anpfiff mit ihrem Stand (seit
 * 03.11.2026, Davids Wunsch). Gold-Rand ★, Grün-Rand ✓ - dieselben Zeichen wie in der Tabelle.
 */
function TipChips({ tips }: { tips: LiveTip[] }) {
  if (tips.length === 0) return <span className="live-tips"><small>keine Empfehlung vor dem Anpfiff</small></span>;
  const rest = tips.length - 2;
  return <span className="live-tips">
    {tips.slice(0, 2).map((tip) => <span key={tip.key} className={`live-tip ${tip.level}`} title={tipTitle(tip)}>
      <span className="level-glyph" aria-hidden>{tip.level === "strong" ? "★" : "✓"}</span>
      <span className="live-tip-label">{tip.label}</span>
      <span className={`live-tip-stand ${tip.tone}`}>{tip.stand}{tip.now !== null && ` · ${pct(tip.now)}`}</span>
    </span>)}
    {rest > 0 && <small>+ {rest} {rest === 1 ? "weiterer" : "weitere"}</small>}
  </span>;
}

/** Die Minute, darunter ein schmaler Balken: wie weit das Spiel ist (Strich bei der Pause). */
function MinuteCell({ match }: { match: LiveBoardMatch }) {
  const clock = matchClock(match);
  return <span className="live-minute-cell">
    <span className="live-minute live">{minuteLabel(match)}</span>
    {clock !== null && <span className="live-clock" aria-hidden><i style={{ width: `${Math.round(clock * 1000) / 10}%` }} /></span>}
  </span>;
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
    <span title="Die Empfehlungen von vor dem Anpfiff (★ stark, ✓ empfohlen) und wie sie jetzt stehen">Dein Tipp · jetzt</span>
    <span title="Schüsse aufs Tor, darunter der Ballbesitz">Aufs Tor</span>
    <span>Karten</span>
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
  const names = useNames();
  const homeName = teamName(match, "home", names);
  const awayName = teamName(match, "away", names);
  const [main, secondary] = questionCells(match, question, names);
  const missing = match.metricsAvailable ? undefined : statisticsMissingText(match);
  const summary = eventSummary(match, names);
  // Seit 29.09.2026 per Klick statt beim Überfahren (Davids Wunsch): Das Fenster ging sonst
  // schon beim Weg über die Liste auf und verdeckte die Zeilen darunter.
  return <article
    className={`live-row${open ? " open" : ""}`}
    tabIndex={0}
    title="Klicken für die Kennzahlen"
    aria-label={`${homeName} gegen ${awayName}, ${match.goals.home ?? 0} zu ${match.goals.away ?? 0}, ${minuteLabel(match)}`}
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
    <MinuteCell match={match} />
    <span className="live-teams">
      <span className="live-team"><strong>{homeName}</strong><RedChip count={match.cards?.home.red ?? 0} /></span>
      <span className="live-team"><strong>{awayName}</strong><RedChip count={match.cards?.away.red ?? 0} /></span>
      <small className="live-league"><CountryFlag country={match.country} /> {countryName(match, names)} · {leagueName(match, names)}</small>
      {summary && <small className="live-league live-event-line" title={summary}>{summary}</small>}
    </span>
    <span className="live-score">
      <strong>{match.goals.home ?? 0}</strong>
      <strong>{match.goals.away ?? 0}</strong>
    </span>
    <span className="live-value">{main}{secondary && <span className="live-second">{secondary}</span>}</span>
    <TipChips tips={prematchTips(match, names)} />
    {/* Heim oben und Gast unten - auf Höhe der Teamnamen. */}
    <PressureCell match={match} title={missing} />
    <CardsCell match={match} />
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

/** Eine Kachel der Live-Chancen: Frage, große Zahl, darunter Balken oder Erklärung. */
function ChanceTile({ label, value, tone, children }: { label: string; value: string; tone?: "home" | "away"; children?: ReactNode }) {
  return <div className="live-chance-tile">
    <small>{label}</small>
    <strong className={tone}>{value}</strong>
    {children}
  </div>;
}

function LiveChancesSection({ match }: { match: LiveBoardMatch }) {
  const live = match.live;
  const blocked = blockedText(match);
  const next = live.nextGoal;
  const result = live.result;
  const nextSide = next ? (next.home >= next.away ? "home" : "away") : undefined;
  const outcome = result ? (result.home >= result.draw && result.home >= result.away ? "1" : result.draw >= result.away ? "X" : "2") : null;
  return <section className="live-section">
    <h4>Chancen live{live.provisional && <> · <span className="live-provisional" title={PROVISIONAL_TITLE}>vorläufig</span></>}</h4>
    {blocked ? <p className="live-panel-empty">{blocked}</p> : <>
      <div className="live-chance-tiles">
        <ChanceTile label="Noch ein Tor" value={pct(live.anotherGoal!)}>
          <small>Ø noch {decimal(live.remainingGoals!)} Tore</small>
        </ChanceTile>
        <ChanceTile label="Nächstes Tor" value={next ? `${nextSide === "home" ? "Heim" : "Gast"} ${pct(Math.max(next.home, next.away))}` : "–"} tone={nextSide}>
          {next ? <><ThreeWayBar home={next.home} middle={next.none} away={next.away} /><small>{nextGoalText(next)}</small></> : <small>{SIDE_UNRELIABLE_TEXT}</small>}
        </ChanceTile>
        <ChanceTile label="Sieger nach 90 Min." value={result && outcome ? `${outcome} · ${pct(Math.max(result.home, result.draw, result.away))}` : "–"}
          tone={outcome === "1" ? "home" : outcome === "2" ? "away" : undefined}>
          {result ? <><ThreeWayBar home={result.home} middle={result.draw} away={result.away} /><small>{resultText(result)}</small></> : <small>{SIDE_UNRELIABLE_TEXT}</small>}
        </ChanceTile>
      </div>
      <p className="live-goal-lines">Tore am Ende: {[lineText(match, "over15", "Ü1,5"), lineText(match, "over25", "Ü2,5"), lineText(match, "over35", "Ü3,5")].join(" · ")}</p>
      {(!next || !result) && <p className="live-panel-note">Ohne Ligastärke-Vergleich keine belastbare Chance auf Sieger und nächstes Tor.</p>}
      <p className="live-panel-note">{match.prematch.crossLeague ? CUP_NOTE : "Gilt für 90 Minuten."} Rechne nicht mit Gewinn.</p>
    </>}
  </section>;
}

/**
 * Spielverlauf von 0 bis 90 (mit Verlängerung bis 120): Tore als Punkt, Karten als Kärtchen, oben das
 * Heimteam, unten das Gastteam, dazu die gespielte Zeit und „jetzt“. Wechsel und VAR bleiben weg.
 */
function Timeline({ match }: { match: LiveBoardMatch }) {
  const names = useNames();
  const events = match.events.filter((event) => isGoalEvent(event) || event.type.toLocaleLowerCase() === "card");
  const extraTime = ["ET", "BT", "P"].includes(match.status.short) || match.events.some((event) => event.minute > 90);
  const span = extraTime ? 120 : 90;
  const at = (minute: number) => `${(Math.min(minute, span) / span) * 100}%`;
  const clock = matchClock(match);
  const now = clock === null ? null : extraTime ? Math.min(match.elapsed ?? 90, 120) / 120 : clock;
  return <section className="live-section">
    <h4>Spielverlauf</h4>
    <div className="live-timeline">
      <span className="live-timeline-track" />
      {now !== null && <span className="live-timeline-played" style={{ width: `${now * 100}%` }} />}
      <span className="live-timeline-tick" style={{ left: at(45) }} />
      {extraTime && <span className="live-timeline-tick" style={{ left: at(90) }} />}
      {now !== null && <span className="live-timeline-now" style={{ left: `${now * 100}%` }} />}
      {events.map((event, index) => {
        const kind = isGoalEvent(event) ? "goal" : isRedCardEvent(event) ? "red" : "yellow";
        const minute = `${event.minute}${event.extra ? `+${event.extra}` : ""}′`;
        return <span key={`${event.minute}-${index}`} className={`live-timeline-event ${event.side ?? "neutral"} ${kind}`} style={{ left: at(event.minute) }}
          title={`${minute} ${eventText(event.type, event.detail)}${event.player ? ` · ${event.player}` : ""}`}>
          {kind === "goal" && <small>{minute}</small>}
        </span>;
      })}
      <small className="live-timeline-axis" style={{ left: 0 }}>0′</small>
      <small className="live-timeline-axis center" style={{ left: at(45) }}>HZ</small>
      <small className="live-timeline-axis end" style={{ right: 0 }}>{span}′</small>
    </div>
    <p className="live-panel-note">Oben {teamName(match, "home", names)}, unten {teamName(match, "away", names)}{events.length === 0 ? " · noch keine Tore und Karten" : ""}.</p>
  </section>;
}

/** Die Empfehlungen von vor dem Anpfiff: Quote, Chance vorher, Live-Chance jetzt und Stand. */
function TipsSection({ match }: { match: LiveBoardMatch }) {
  const names = useNames();
  const tips = prematchTips(match, names);
  return <section className="live-section live-prematch">
    <h4>Deine Tipps vor dem Anpfiff · jetzt</h4>
    <p>Erwartete Tore {decimal(match.prematch.expectedGoals.home)} : {decimal(match.prematch.expectedGoals.away)} · Datenvertrauen {match.prematch.dataConfidence} %</p>
    {tips.length === 0
      ? <p className="live-panel-empty">Vor dem Anpfiff gab es für dieses Spiel keine Empfehlung.</p>
      : <div className="live-tip-table">
        <div className="live-tip-row head"><span>Tipp</span><span>Quote</span><span>vorher</span><span>jetzt</span><span>Stand</span></div>
        {tips.map((tip) => <div key={tip.key} className={`live-tip-row ${tip.level}`}>
          <span>{tip.level === "strong" ? "★ " : "✓ "}{tip.label}</span>
          <strong>{formatOdd(tip.odds)}</strong>
          <span>{pct(tip.before)}</span>
          <strong>{tip.now === null ? "–" : pct(tip.now)}</strong>
          <span className={`live-tip-stand ${tip.tone}`}>{tip.stand}</span>
        </div>)}
      </div>}
  </section>;
}

const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** Eine Häufigkeit in den Duellen: je Duell ein Strich, neueste links. null = unbekannt (ohne Pausenstand). */
interface DuelFrequency { label: string; hit: (duel: Duel) => boolean | null; tone: "hit" | "home" | "away" }

/**
 * H2H im Live-Fenster (seit 03.11.2026, Davids Wunsch: „die H2H-Stats sind nicht gut präsentiert“). Dieselben
 * Duelle wie in Neo (`duelsOf`, ohne Testspiele), im Stil der alten App: Bilanz, Häufigkeiten mit einem Strich
 * je Duell, letzte Duelle mit Pausenstand, Form. Häufigkeiten sind keine Chancen - das steht darunter.
 */
function LiveH2H({ match, fixture }: { match: LiveBoardMatch; fixture: DashboardFixture | undefined }) {
  const names = useNames();
  const [venue, setVenue] = useState<"all" | "home">("all");
  const home = teamName(match, "home", names);
  const away = teamName(match, "away", names);
  if (!fixture) return <section className="live-section"><p className="live-panel-empty">Für dieses Spiel stehen keine Duelle in der Analyse.</p></section>;
  const all = duelsOf(fixture);
  const duels = venue === "home" ? all.filter((duel) => duel.ourHome) : all;
  const stats = duelStats(duels);
  const ourHalfTimeLead = (duel: Duel) => duel.halfTime === null ? null
    : (duel.ourHome ? duel.halfTime.home - duel.halfTime.away : duel.halfTime.away - duel.halfTime.home) > 0;
  const frequencies: DuelFrequency[] = [
    { label: "Über 2,5 Tore", hit: (duel) => duel.homeGoals + duel.awayGoals > 2, tone: "hit" },
    { label: "Beide treffen", hit: (duel) => duel.homeGoals > 0 && duel.awayGoals > 0, tone: "hit" },
    { label: "Tor vor der Pause", hit: (duel) => duel.halfTime === null ? null : duel.halfTime.home + duel.halfTime.away > 0, tone: "hit" },
    { label: `${home} zur Pause vorn`, hit: ourHalfTimeLead, tone: "home" },
    { label: `${home} zu null`, hit: (duel) => duel.ga === 0, tone: "home" },
    { label: `${away} zu null`, hit: (duel) => duel.gh === 0, tone: "away" }
  ];
  const best = (duel: Duel | null, team: string) => duel
    ? `${team} ${Math.max(duel.gh, duel.ga)}:${Math.min(duel.gh, duel.ga)} (${shortDate(duel.date)})` : null;
  const bests = [best(stats.bestH, home), best(stats.bestA, away)].filter(Boolean);
  const years = duels.length ? (Date.now() - Date.parse(duels[0]!.date)) / YEAR_MS : 0;
  const widthOf = (count: number) => `${stats.n ? (count / stats.n) * 100 : 0}%`;
  const formOf = (results: FormResult[]) => results.slice(0, 5);
  const points = (results: FormResult[]) => results.reduce((sum, result) => sum + (result === "win" ? 3 : result === "draw" ? 1 : 0), 0);
  const words: Record<FormResult, string> = { win: "Sieg", draw: "Unentschieden", loss: "Niederlage" };
  const letter: Record<FormResult, string> = { win: "S", draw: "U", loss: "N" };

  return <>
    <section className="live-section">
      <div className="live-h2h-head">
        <h4>Direkte Duelle · {stats.n} {stats.n === 1 ? "Spiel" : "Spiele"}</h4>
        <div className="segmented live-tabs" role="group" aria-label="Duelle filtern">
          <button className={venue === "all" ? "active" : ""} aria-pressed={venue === "all"} onClick={() => setVenue("all")}>Alle</button>
          <button className={venue === "home" ? "active" : ""} aria-pressed={venue === "home"} onClick={() => setVenue("home")}>Nur in {home}</button>
        </div>
      </div>
      {stats.n === 0 ? <p className="live-panel-empty">Keine direkten Duelle {venue === "home" ? `in ${home} ` : ""}in der Analyse (Testspiele zählen nicht).</p> : <>
        <div className="live-duel">
          <span className="home"><strong>{stats.wH}</strong><small>{stats.wH === 1 ? "Sieg" : "Siege"} {home}</small></span>
          <span className="draw"><strong>{stats.dr}</strong><small>Remis</small></span>
          <span className="away"><strong>{stats.wA}</strong><small>{stats.wA === 1 ? "Sieg" : "Siege"} {away}</small></span>
          <span className="live-metric-bar live-duel-bar" aria-hidden>
            <i className="home" style={{ width: widthOf(stats.wH) }} /><i className="middle" style={{ width: widthOf(stats.dr) }} /><i className="away" style={{ width: widthOf(stats.wA) }} />
          </span>
          <small className="live-duel-foot">
            <span>Tore <b className="home">{stats.gH}</b> : <b className="away">{stats.gA}</b> · Ø {(((stats.gH + stats.gA) / stats.n)).toFixed(1).replace(".", ",")} je Spiel</span>
            {bests.length > 0 && <span>Höchster Sieg: {bests.join(" · ")}</span>}
          </small>
        </div>
        {stats.n < H2H_FEW && <p className="live-notice live-h2h-notice"><WarningCircle size={14} weight="duotone" aria-hidden />Nur {stats.n} {stats.n === 1 ? "Duell" : "Duelle"} – kann auch Zufall sein.</p>}
        {years >= 2 && <p className="live-notice live-h2h-notice"><WarningCircle size={14} weight="duotone" aria-hidden />Letztes Duell vor rund {Math.round(years)} Jahren – die Teams von damals sind nicht die von heute.</p>}
      </>}
    </section>

    {stats.n > 0 && <section className="live-section">
      <h4>Wie oft war es so? · neuestes Duell links</h4>
      <div className="live-freq-list">
        {frequencies.map((frequency) => {
          const marks = duels.map((duel) => frequency.hit(duel));
          const known = marks.filter((mark) => mark !== null).length;
          const hits = marks.filter((mark) => mark === true).length;
          return <div className="live-freq" key={frequency.label}>
            <span className="live-freq-label">{frequency.label}</span>
            <span className="live-freq-marks">{marks.map((mark, index) => <i key={duels[index]!.id}
              className={mark === null ? "unknown" : mark ? frequency.tone : "miss"}
              title={`${shortDate(duels[index]!.date)} · ${duels[index]!.homeTeam} ${duels[index]!.homeGoals}:${duels[index]!.awayGoals} ${duels[index]!.awayTeam}${mark === null ? " · ohne Pausenstand" : ""}`} />)}</span>
            <span className="live-freq-count"><strong>{hits}</strong> von {known}</span>
          </div>;
        })}
      </div>
      <p className="live-panel-note">So oft war es in den Duellen – keine Chance für das nächste Spiel.</p>
    </section>}

    {stats.n > 0 && <section className="live-section">
      <h4>Letzte Duelle</h4>
      <ul className="live-duel-list">{duels.map((duel) => <li key={duel.id}>
        <span className="live-duel-date">{shortDate(duel.date)}</span>
        <span className="live-duel-teams">
          <span className={duel.ourHome ? "home" : "away"}>{duel.homeTeam}</span> – <span className={duel.ourHome ? "away" : "home"}>{duel.awayTeam}</span>
          {duel.league && <small> {duel.league}</small>}
        </span>
        <strong>{duel.homeGoals}:{duel.awayGoals}</strong>
        <span className="live-duel-ht" title="Pausenstand">{duel.halfTime ? `${duel.halfTime.home}:${duel.halfTime.away}` : "–"}</span>
        <span className={`live-duel-result ${duel.res}`} title={`${words[duel.res]} für ${home}`}>{letter[duel.res]}</span>
      </li>)}</ul>
      <p className="live-panel-note">Rechts Pausenstand und Ergebnis aus Sicht von {home}.</p>
    </section>}

    <section className="live-section">
      <h4>Aktuelle Form · letzte 5, neueste links</h4>
      {([["home", home, fixture.form.home], ["away", away, fixture.form.away]] as const).map(([side, team, results]) => <div className="live-form" key={side}>
        <strong className={side}>{team}</strong>
        <span className="form-bars">{formOf(results).map((result, index) => <i key={index} className={`form-bar ${result}`} title={words[result]} />)}</span>
        <span>{points(formOf(results))} von {formOf(results).length * 3} Pkt.</span>
      </div>)}
      <p className="live-panel-note">{fixture.form.scope === "overall" ? "Alle Spiele, zu Hause und auswärts zusammen." : `${home} zu Hause, ${away} auswärts.`}</p>
    </section>
  </>;
}

export function LiveMetricsPanel({ match, fixture, anchor, panelRef }: {
  match: LiveBoardMatch;
  /** Das Spiel im Snapshot - für H2H und Form. Fehlt es, sagt der Reiter das. */
  fixture?: DashboardFixture;
  /** Bis 03.11.2026 für „Vor dem Anpfiff“; die Tipps stehen jetzt in eigener Tabelle. */
  question?: LiveQuestion;
  anchor: PanelAnchor;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const names = useNames();
  const [height, setHeight] = useState(0);
  const [tab, setTab] = useState<"live" | "h2h">("live");
  // Die Höhe hängt am Inhalt (Ereignisse, Statistik); gemessen vor dem Zeichnen, damit das
  // Fenster nicht sichtbar springt. Neu gemessen bei jedem Abruf, der den Inhalt ändert.
  useLayoutEffect(() => {
    const measured = panelRef.current?.offsetHeight ?? 0;
    if (measured !== height) setHeight(measured);
  });
  // Tore und Karten zuerst: Wechsel verdrängten sie früher aus den letzten acht Einträgen.
  const events = match.events.filter((event) => event.type.toLocaleLowerCase() !== "subst").slice(-8);
  const context = CONTEXT_METRICS
    .filter(({ key }) => match.metrics.home[key] !== null || match.metrics.away[key] !== null)
    .map(({ key, label, unit }) => <span key={key}>{label} <strong>{metricText(match.metrics.home[key], unit)}</strong> : <strong>{metricText(match.metrics.away[key], unit)}</strong></span>);
  const home = teamName(match, "home", names);
  const away = teamName(match, "away", names);
  return <div className="live-panel" ref={panelRef} style={panelStyle(anchor, height)} role="dialog" aria-label={`Live-Kennzahlen ${home} gegen ${away}`}>
    <div className="live-panel-head">
      <span className="live-minute live">{minuteLabel(match)}</span>
      <strong>{home} {match.goals.home ?? 0}:{match.goals.away ?? 0} {away}</strong>
      <small><CountryFlag country={match.country} /> {countryName(match, names)} · {leagueName(match, names)}
        {match.halfTime.home !== null && <> · HZ {match.halfTime.home}:{match.halfTime.away ?? 0}</>}</small>
      <div className="segmented live-tabs" role="tablist" aria-label="Ansicht im Fenster">
        <button role="tab" className={tab === "live" ? "active" : ""} aria-selected={tab === "live"} onClick={() => setTab("live")}>Live</button>
        <button role="tab" className={tab === "h2h" ? "active" : ""} aria-selected={tab === "h2h"} onClick={() => setTab("h2h")}>H2H</button>
      </div>
    </div>
    {tab === "h2h" ? <LiveH2H match={match} fixture={fixture} /> : <>
    <Timeline match={match} />
    <LiveChancesSection match={match} />
    <TipsSection match={match} />
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
      <p className="live-panel-note">Nur zum Einordnen – die Live-Statistik fließt nicht in die Chancen ein.</p>
    </section>
    </>}
  </div>;
}

export function LiveView({ state, matches, fixtures, runningCount, question, onResetFilters }: {
  state: LiveLoadState;
  /** Die Spiele des Snapshots nach ID - für H2H und Form im Fenster. */
  fixtures?: ReadonlyMap<number, DashboardFixture>;
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
    {active && <LiveMetricsPanel match={active} fixture={fixtures?.get(active.fixtureId)} anchor={opened!.anchor} panelRef={panelRef} />}
  </>;
}
