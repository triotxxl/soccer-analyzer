import { useState } from "react";
import { GoalDiffChart, PerfChart } from "../../shared/src/PerfChart";
import { goalDiffTrend, perfTrend, perfWindow, signed, tableEntryOf, type PerfRange } from "../../shared/src/perf";
import { noLastSeasonText, seasonList, useSeasonChoice } from "../../shared/src/seasonView";
import type { DashboardFixture } from "../../shared/src/types";

const RANGES: Array<[PerfRange, string]> = [["5", "Letzte 5"], ["10", "Letzte 10"], ["all", "Saison"]];

/**
 * Tabellenverlauf bei den direkten Duellen (seit 02.11.2026, Davids Wunsch) und darunter seit 04.11.2026 der
 * Tordifferenz-Verlauf: dieselben Diagramme und dieselbe Rechnung wie im H2H-Reiter von Neo
 * (`apps/shared/src/PerfChart.tsx`, `perf.ts`), nur in den Farben der alten App. Zeitraum und Saison gelten für
 * beide, damit die Spieltage untereinander stehen. Gezeigt wird immer eine Saison: die laufende, die letzte nur
 * auf Wahl (`seasonView.ts`). Alles aus dem Snapshot, kein Aufruf; im Turnier die Turniertabelle.
 */
export function LeaguePerfPanel({ fixture, fixtures, homeName, awayName }: {
  fixture: DashboardFixture;
  fixtures: readonly DashboardFixture[];
  homeName: string;
  awayName: string;
}) {
  const [range, setRange] = useState<PerfRange>("10");
  const [previous, setPrevious] = useSeasonChoice(fixture.fixtureId);
  const homeEntry = tableEntryOf(fixtures, fixture, fixture.homeTeam);
  const awayEntry = tableEntryOf(fixtures, fixture, fixture.awayTeam);
  const sides = [
    { name: homeName, color: "var(--home)", entry: homeEntry },
    { name: awayName, color: "var(--away)", entry: awayEntry },
  ];
  const hasPrevious = sides.some((x) => seasonList(x.entry, "positions", true));
  const series = sides.flatMap((x) => {
    const positions = seasonList(x.entry, "positions", previous);
    return positions ? [{ name: x.name, color: x.color, size: x.entry!.size, positions }] : [];
  });
  const missing = previous ? sides.filter((x) => x.entry && !seasonList(x.entry, "positions", true)).map((x) => x.name) : [];
  const played = Math.max(0, ...series.map((x) => x.positions.length));
  const { from, to } = perfWindow(played, range);
  const size = Math.max(0, ...series.flatMap((x) => [x.size, ...x.positions.filter((p): p is number => p !== null)]));
  const sameLeague = homeEntry && awayEntry && homeEntry.competition === awayEntry.competition;
  const scope = [sameLeague ? null : "jeweils in der eigenen Liga", previous ? "letzte Saison" : null].filter(Boolean).join(" · ");
  const gdSeries = sides.flatMap((x) => {
    const goalDiffs = seasonList(x.entry, "goalDiffs", previous);
    return goalDiffs ? [{ name: x.name, color: x.color, goalDiffs }] : [];
  });
  const gdPlayed = Math.max(0, ...gdSeries.map((x) => x.goalDiffs.length));
  const gdFrom = perfWindow(gdPlayed, range).from;
  const hint = (text: string) => (scope ? `${scope} · ${text}` : text);

  return <><section className="insight-panel league-perf" aria-label="Tabellenverlauf">
    <h3>Tabellenverlauf<span className="insight-scope">{hint("Platz nach Spieltag")}</span></h3>
    {series.length === 0
      ? <p>Kein Tabellenverlauf: Die Liga dieser Teams ist nicht in der aktuellen Analyse.</p>
      : <>
        <div className="insight-controls">
          <div className="segmented mini" role="group" aria-label="Zeitraum">
            {RANGES.map(([value, label]) => <button key={value} className={range === value ? "active" : ""}
              aria-pressed={range === value} onClick={() => setRange(value)}>{label}</button>)}
          </div>
          {hasPrevious && <div className="segmented mini" role="group" aria-label="Saison">
            <button className={previous ? "" : "active"} aria-pressed={!previous} onClick={() => setPrevious(false)}>Diese Saison</button>
            <button className={previous ? "active" : ""} aria-pressed={previous} onClick={() => setPrevious(true)}>Letzte Saison</button>
          </div>}
        </div>
        <PerfChart series={series} size={size} from={from} to={to} />
        <ul className="perf-legend">
          {series.map((x) => {
            const trend = perfTrend(x.positions, from, to);
            return trend && <li key={x.name}><i className="sw" style={{ borderColor: x.color }} /><b>{x.name}</b>
              {" "}{previous ? "am Ende" : "aktuell"} {trend.now}. · bester {trend.best}. · schlechtester {trend.worst}. · im Zeitraum {trend.text}</li>;
          })}
          {missing.length > 0 && <li>{noLastSeasonText(missing, fixture.crossLeague === true)}</li>}
          {!previous && range !== "all" && played < Number(range) && <li>Erst {played} Spieltage gespielt, daher {played} statt {range}.</li>}
        </ul>
      </>}
  </section>
  <section className="insight-panel league-perf" aria-label="Tordifferenz-Verlauf">
    <h3>Tordifferenz-Verlauf<span className="insight-scope">{hint("Tore minus Gegentore nach Spieltag")}</span></h3>
    {gdSeries.length === 0
      ? <p>{series.length === 0
        ? "Kein Tordifferenz-Verlauf: Die Liga dieser Teams ist nicht in der aktuellen Analyse."
        : "Der Tordifferenz-Verlauf erscheint nach der nächsten Analyse."}</p>
      : <>
        <GoalDiffChart series={gdSeries} from={gdFrom} to={gdPlayed} />
        <ul className="perf-legend">
          {gdSeries.map((x) => {
            const trend = goalDiffTrend(x.goalDiffs, gdFrom, gdPlayed);
            return trend && <li key={x.name}><i className="sw" style={{ borderColor: x.color }} /><b>{x.name}</b>
              {" "}{previous ? "am Ende" : "aktuell"} {signed(trend.now)} · im Zeitraum {signed(trend.change)}</li>;
          })}
          <li>Zeitraum und Saison wie beim Tabellenverlauf.</li>
        </ul>
      </>}
  </section></>;
}
