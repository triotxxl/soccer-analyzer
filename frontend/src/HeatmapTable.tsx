import { useMemo, type CSSProperties, type ReactNode } from "react";
import { ClassGapBadge, formatOdd, formatPercent, kickoffParts, sortStateLabel } from "./App";
import {
  drawScoreLabel, drawScoreTone, eloDelta, expectedGoalsDelta, formatDelta, formDelta, HEAT_SCALE, heatOf,
  recentDelta, sortHeatmap, valueHeat, type Heat, type HeatmapColumn
} from "./heatmap";
import { edgeOf } from "./kelly";
import type { DashboardFixture, DashboardMarket, DashboardMarketKey } from "./types";

/** Sortierung über eine Heatmap-Spalte; `null` heißt, die Reihenfolge der Tabelle gilt. */
export type HeatmapSort = { column: HeatmapColumn; direction: 1 | -1 } | null;

const heatStyle = (intensity: number) => ({ "--heat": intensity.toFixed(2) }) as CSSProperties;

/**
 * Eine Vorsprungszelle. Bewusst ohne aria-label: Sie steht in einem Knopf, und ein Label am
 * Kind wandert in den Namen der ganzen Zeile (wie bei `RecentStatCell`). Die Bedeutung trägt
 * die Spaltenüberschrift, die Einzelheiten der Tooltip.
 */
function HeatCell({ heat, text, title, faint = false }: { heat: Heat | null; text: string; title: string; faint?: boolean }) {
  return <span
    className={`heat-cell ${heat ? heat.side : "missing"}${faint ? " faint" : ""}`}
    style={heat ? heatStyle(heat.intensity) : undefined}
    title={title}
  >{text}</span>;
}

function OddsCell({ market, showEdge }: { market: DashboardMarket | undefined; showEdge: boolean }) {
  if (!market || market.odds === null) {
    return <span className="odds-cell missing" title="Keine Tipico-Quote für diesen Markt">–</span>;
  }
  const heat = valueHeat(market, showEdge);
  const reliable = market.probabilityReliable !== false;
  const edge = showEdge ? edgeOf(market) : null;
  const title = [
    market.selection,
    reliable ? `Modell ${formatPercent(market.probability)}` : "Ligastärke unbekannt – keine belastbare Wahrscheinlichkeit",
    market.recommendation.label,
    edge !== null ? `Value ${formatDelta(edge * 100, 1)} Prozentpunkte` : null
  ].filter(Boolean).join(" · ");
  return <span className={`odds-cell${heat !== null ? " value" : ""}`} style={heat !== null ? heatStyle(heat) : undefined} title={title}>
    {market.key === "1x2" && market.pick && <small className={`heatmap-pick ${market.selectionTone}`}>{market.pick}</small>}
    <strong>{formatOdd(market.odds)}</strong>
  </span>;
}

function eloCell(fixture: DashboardFixture) {
  const delta = eloDelta(fixture);
  if (!delta) {
    const mixed = fixture.homeElo && fixture.awayElo;
    return <HeatCell heat={null} text="–" title={mixed
      ? "Verein gegen Nationalteam – die Elo-Werte lassen sich nicht vergleichen"
      : "Kein Elo für beide Teams vorhanden"} />;
  }
  return <HeatCell heat={heatOf(delta.value, HEAT_SCALE.elo)} text={formatDelta(delta.value, 0)} faint={delta.lowConfidence}
    title={`Elo ${fixture.homeTeam} ${delta.home}, ${fixture.awayTeam} ${delta.away} · Vertrauen ${delta.confidence} %`
      + (delta.lowConfidence ? " – steht auf wenigen Spielen" : "")
      + " · nur zur Einordnung, geht in keinen Tipp ein"} />;
}

function formCell(fixture: DashboardFixture) {
  const delta = formDelta(fixture);
  if (!delta) return <HeatCell heat={null} text="–" title="Zu wenige Spiele für einen Formvergleich" />;
  const scope = fixture.form.scope === "overall" ? "alle Spiele" : "nur Heim- bzw. Auswärtsspiele";
  return <HeatCell heat={heatOf(delta.value, HEAT_SCALE.form)} text={formatDelta(delta.value, 0)}
    title={`Punkte aus den letzten Spielen (Sieg 3, Remis 1), ${scope}: ${fixture.homeTeam} ${delta.homePoints} aus ${delta.homeGames},`
      + ` ${fixture.awayTeam} ${delta.awayPoints} aus ${delta.awayGames}`} />;
}

function xgCell(fixture: DashboardFixture) {
  const delta = expectedGoalsDelta(fixture);
  const goals = (value: number) => value.toFixed(2).replace(".", ",");
  return <HeatCell heat={heatOf(delta.value, HEAT_SCALE.xg)} text={formatDelta(delta.value, 2)}
    title={`xG (erwartete Tore) laut Modell: ${fixture.homeTeam} ${goals(delta.home)}, ${fixture.awayTeam} ${goals(delta.away)}`} />;
}

function recentCell(fixture: DashboardFixture, field: "shotsOnGoal" | "corners") {
  const label = field === "shotsOnGoal" ? "Schüsse aufs Tor" : "Ecken";
  const delta = recentDelta(fixture, field);
  if (!delta) return <HeatCell heat={null} text="–" title={`${label}: für diese Liga gibt es keine Zahlen`} />;
  const average = (value: number) => value.toFixed(1).replace(".", ",");
  return <HeatCell heat={heatOf(delta.value, HEAT_SCALE[field === "shotsOnGoal" ? "shots" : "corners"])} text={formatDelta(delta.value, 1)}
    title={`${label} im Schnitt der letzten fünf Spiele: ${fixture.homeTeam} ${average(delta.home)}, ${fixture.awayTeam} ${average(delta.away)}`} />;
}

function drawScoreCell(fixture: DashboardFixture) {
  const score = fixture.scores.draw;
  if (score === null) return <span className="heatmap-draw-score missing" title="Keine Remis-Punkte für dieses Spiel">–</span>;
  return <span className={`heatmap-draw-score ${drawScoreTone(score)}`} title={`Remis-Punkte ${score} von 100 – ${drawScoreLabel(score)}`}>{score}</span>;
}

/**
 * Die kompakte Heatmap: eine Zeile je Spiel, jede Kennzahl als Vorsprung Heim minus Auswärts.
 * Sie bekommt die bereits gefilterte und sortierte Liste der Tabelle. Solange keine eigene
 * Spalte sortiert ist, übernimmt sie deren Reihenfolge. Die Spaltensortierung liegt in der App,
 * damit die Sortierauswahl über der Tabelle sie anzeigen und zurücksetzen kann.
 */
export function HeatmapTable({ fixtures, markets, timezone, now, showEdge, openFixture, onToggleFixture, cartSlot, empty, sort, onSortChange }: {
  fixtures: DashboardFixture[];
  markets: Array<{ key: DashboardMarketKey; label: string }>;
  timezone: string;
  now: number;
  showEdge: boolean;
  openFixture: number | null;
  onToggleFixture(fixtureId: number): void;
  cartSlot(fixture: DashboardFixture): ReactNode;
  empty: ReactNode;
  sort: HeatmapSort;
  onSortChange(sort: HeatmapSort): void;
}) {
  const rows = useMemo(() => sort ? sortHeatmap(fixtures, sort.column, sort.direction) : fixtures, [fixtures, sort]);

  const toggleSort = (column: HeatmapColumn) => {
    if (sort?.column === column) { onSortChange({ column, direction: sort.direction === 1 ? -1 : 1 }); return; }
    // Vorsprünge und Remis-Punkte zuerst absteigend: oben steht, wo am meisten los ist.
    // Quoten aufsteigend: oben stehen die Favoriten.
    const ascending = column === "kickoff" || column === "team" || column.startsWith("market:");
    onSortChange({ column, direction: ascending ? 1 : -1 });
  };

  const head = (column: HeatmapColumn, label: string, name: string, title?: string) => {
    const active = sort?.column === column;
    return <button key={column} className={active ? "active" : ""} title={title}
      aria-label={sortStateLabel(name, active, sort?.direction ?? 1)} onClick={() => toggleSort(column)}>
      {label} <i className="heatmap-arrow" aria-hidden>{active ? (sort!.direction === 1 ? "↑" : "↓") : "↕"}</i>
    </button>;
  };

  // Hinzufügen 38 + Innenabstand 10, Zeit 88, Spiel 260, fünf Vorsprünge je 84, Remis-Punkte 76,
  // Märkte je 100, dazu die Lücken. Muss zur Spaltenliste in styles.css passen.
  const columns = 8 + markets.length;
  const style = {
    "--heatmap-markets": markets.length,
    "--heatmap-min-width": `${48 + 88 + 260 + 5 * 84 + 76 + markets.length * 100 + (columns - 1) * 6}px`
  } as CSSProperties;

  return <div className="heatmap-area">
    <div className="table-scroll heatmap-scroll">
      <div className="heatmap-head heatmap-grid" style={style}>
        {head("kickoff", "Zeit", "Anstoß")}
        {head("team", "Spiel", "Spiel")}
        {head("elo", "Δ Elo", "Elo-Unterschied", "Elo-Unterschied (Stärkewert aus den Spielen der letzten fünf Jahre), Heim minus Auswärts. Der Heimvorteil ist nicht eingerechnet – er ist rund 60 Punkte wert. Nur zur Einordnung – geht in keinen Tipp ein.")}
        {head("form", "Δ Form", "Formunterschied", "Punkte aus den letzten 5 Spielen (Sieg 3, Remis 1), Heim minus Auswärts")}
        {head("xg", "Δ xG", "xG-Unterschied", "xG (erwartete Tore) laut Modell, Heim minus Auswärts")}
        {head("shots", "Δ Sch.", "Unterschied Schüsse aufs Tor", "Schüsse aufs Tor im Schnitt der letzten fünf Spiele, Heim minus Auswärts")}
        {head("corners", "Δ Eck.", "Unterschied Ecken", "Ecken im Schnitt der letzten fünf Spiele, Heim minus Auswärts")}
        {head("drawScore", "Remis-Pkt.", "Remis-Punkte", "Remis-Punkte (0–100). Grün ab 50, kräftiger ab 60 und 70.")}
        {markets.map((market) => head(`market:${market.key}`, market.label, `Quote ${market.label}`))}
      </div>
      {rows.map((fixture) => {
        const time = kickoffParts(fixture.kickoff, timezone);
        const started = Date.parse(fixture.kickoff) < now;
        const open = openFixture === fixture.fixtureId;
        return <article className={`heatmap-row-wrap${open ? " open" : ""}`} style={style} key={fixture.fixtureId}>
          <div className="fixture-row-wrap">
            {cartSlot(fixture)}
            <button className="heatmap-grid heatmap-row" style={style} aria-expanded={open} onClick={() => onToggleFixture(fixture.fixtureId)}>
              <span className={`heatmap-time${started ? " started" : ""}`} title={started ? "Bereits angepfiffen" : undefined}>
                <small>{time.day}</small><strong>{time.clock}</strong>
              </span>
              <span className="heatmap-teams">
                <strong className="home">{fixture.homeTeam}</strong>
                <i aria-hidden>–</i>
                <strong className="away">{fixture.awayTeam}</strong>
                <small className="heatmap-league" title={`${fixture.country} · ${fixture.league}`}>{fixture.league}</small>
                {fixture.classGap && <ClassGapBadge gap={fixture.classGap} homeTeam={fixture.homeTeam} awayTeam={fixture.awayTeam} />}
              </span>
              {eloCell(fixture)}
              {formCell(fixture)}
              {xgCell(fixture)}
              {recentCell(fixture, "shotsOnGoal")}
              {recentCell(fixture, "corners")}
              {drawScoreCell(fixture)}
              {markets.map((market) => <OddsCell key={market.key} market={fixture.markets.find((item) => item.key === market.key)} showEdge={showEdge} />)}
            </button>
          </div>
        </article>;
      })}
      {rows.length === 0 && empty}
    </div>
    <p className="heatmap-legend">
      <span>Werte = Heim minus Auswärts</span>
      <span><b className="home">blau</b> = Heim vorn, <b className="away">orange</b> = Auswärts vorn</span>
      {showEdge
        ? <span>Quoten: <b className="value">grüner</b> = mehr Value (Modell sieht die Chance höher als die Quote)</span>
        : <span>Value-Färbung: „Vorteil &amp; Kelly-Einsatz anzeigen“ einschalten</span>}
      <span>Details beim Drüberfahren</span>
    </p>
  </div>;
}
