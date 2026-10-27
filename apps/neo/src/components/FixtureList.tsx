import { leagueName, teamName, useNames } from "../../../shared/src/names";
import type { DashboardFixture } from "../../../shared/src/types";
import {
  competitionId, dayKey, formatDay, formatTime, goalsFormat, oddsFormat, oddsTriple, oneXTwo, percent, scopeLabel, scopePhrase,
  type Competition, type DayScope,
} from "../neoData";
import { shiftScope } from "./DatePicker";
import { EmptyState, Team, plural } from "./ui";

interface Props {
  fixtures: DashboardFixture[];
  competitions: Map<string, Competition>;
  /** Wettbewerbe in der Reihenfolge der Auswahl (für „Nach Liga“) */
  order: Competition[];
  timezone: string;
  scope: DayScope;
  onScope: (scope: DayScope) => void;
  fxOrder: "kickoff" | "league";
  onOrder: (order: "kickoff" | "league") => void;
  selected: number | null;
  onSelect: (id: number) => void;
  noCompetitions: boolean;
}

const NOT_COMPARABLE = "Keine Chance: Die Stärke der beiden Ligen lässt sich nicht vergleichen.";

function FixtureRow({ fixture, competition, withLeague, on, timezone, onSelect }: {
  fixture: DashboardFixture; competition: Competition | undefined; withLeague: boolean; on: boolean; timezone: string; onSelect: (id: number) => void;
}) {
  const source = useNames();
  const home = teamName(fixture, "home", source), away = teamName(fixture, "away", source);
  const triple = oneXTwo(fixture), odds = oddsTriple(fixture), dv = fixture.dataConfidence;
  const parts: Array<[string, number | null]> = [["1", triple?.home ?? null], ["X", triple?.draw ?? null], ["2", triple?.away ?? null]];
  const top = triple ? Math.max(triple.home, triple.draw, triple.away) : -1;
  const dvTitle = "Datenvertrauen: wie viele und wie verlässliche Daten das Modell für dieses Spiel hatte (0 bis 100)"
    + (dv < 50 ? ". Wenig Daten: die Chancen mit Vorsicht lesen." : ".");
  const said = triple
    ? `Heimsieg ${percent(triple.home)}, Remis ${percent(triple.draw)}, Auswärtssieg ${percent(triple.away)}.`
    : `${NOT_COMPARABLE}`;
  return (
    <div className={`fx-item${on ? " on" : ""}`}>
      <button className="fx" aria-pressed={on} onClick={() => onSelect(fixture.fixtureId)}>
        <span className="fx-time"><b>{formatTime(fixture.kickoff, timezone)}</b></span>
        <span className="fx-teams">
          <Team name={home} logo={fixture.homeCrest} />
          <Team name={away} logo={fixture.awayCrest} />
          <small className="fx-meta">
            {withLeague && <><span className="cc">{competition?.code}</span><span className="lgn">{leagueName(fixture, source)}</span><span aria-hidden="true">·</span></>}
            <span className={`dv${dv < 50 ? " low" : ""}`} title={dvTitle}>Datenlage {dv}</span>
          </small>
        </span>
        <span className="fx-xg"><small>Erw. Tore</small>{goalsFormat(fixture.expectedGoals.home)} : {goalsFormat(fixture.expectedGoals.away)}</span>
        <span>
          <span className="sr">{said} Tipico-Quoten {odds.map(oddsFormat).join(", ")}.</span>
          {triple
            ? <span className="split" aria-hidden="true"><i className="h" style={{ width: `${triple.home * 100}%` }} /><i className="d" style={{ width: `${triple.draw * 100}%` }} /><i className="a" style={{ width: `${triple.away * 100}%` }} /></span>
            : <span className="split none" aria-hidden="true" title={NOT_COMPARABLE} />}
          <span className="split-pct" aria-hidden="true">
            {parts.map(([k, v], i) => (
              <span key={k} className={v != null && v === top ? "max" : undefined}>
                <span title={v == null ? NOT_COMPARABLE : undefined}><em>{k}</em> {v == null ? "–" : percent(v)}</span>
                <span className="oc-o fx-q" title="Tipico-Quote">{oddsFormat(odds[i]!)}</span>
              </span>
            ))}
          </span>
        </span>
      </button>
    </div>
  );
}

/** Linke Liste „Spiele“: je Tag, nach Anstoß oder nach Liga gruppiert (Referenz `renderFixtures`). */
export function FixtureList({ fixtures, competitions, order, timezone, scope, onScope, fxOrder, onOrder, selected, onSelect, noCompetitions }: Props) {
  const source = useNames();
  const byLeague = fxOrder === "league";
  const days =[...new Set(fixtures.map((f) => dayKey(f.kickoff, timezone)))];
  return (
    <>
      <div className="panel-head">
        <div><h2 id="detail-title">{scopeLabel(scope)}</h2></div>
        <div className="mk-tools">
          <div className="seg" role="group" aria-label="Spiele ordnen">
            <button aria-pressed={!byLeague} onClick={() => onOrder("kickoff")}>Nach Anstoß</button>
            <button aria-pressed={byLeague} onClick={() => onOrder("league")}>Nach Liga</button>
          </div>
          <div className="range-nav" role="group" aria-label="Zeitraum verschieben" hidden={scope.mode === "days"}>
            <button className="dp-nav" aria-label="Früherer Zeitraum" onClick={() => onScope(shiftScope(scope, -1))}>‹</button>
            <button className="dp-nav" aria-label="Späterer Zeitraum" onClick={() => onScope(shiftScope(scope, 1))}>›</button>
          </div>
        </div>
      </div>
      <div className="panel-body" id="detail-body">
        {!fixtures.length ? (
          noCompetitions
            ? <EmptyState title="Keine Wettbewerbe gewählt">Wähle oben unter „Wettbewerbe“ mindestens eine Liga oder einen Pokal.</EmptyState>
            : <EmptyState title="Keine Spiele in diesem Zeitraum">Die gewählten Wettbewerbe spielen {scopePhrase(scope)} nicht. Wähle oben einen anderen Zeitraum oder weitere Wettbewerbe.</EmptyState>
        ) : days.map((day) => {
          const dayFx = fixtures.filter((f) => dayKey(f.kickoff, timezone) === day);
          return (
            <div key={day}>
              <div className="day-h">{formatDay(day, "long")}<span>{plural(dayFx.length, "Spiel", "Spiele")}</span></div>
              {byLeague
                ? order.map((c) => {
                  const list = dayFx.filter((f) => competitionId(f) === c.id);
                  if (!list.length) return null;
                  return (
                    <div key={c.id}>
                      <div className="grp sub"><span className="cc">{c.code}</span><span className="lg">{leagueName(list[0]!, source)}</span>{c.cup && <span className="tag">Pokal</span>}</div>
                      {list.map((f) => <FixtureRow key={f.fixtureId} fixture={f} competition={c} withLeague={false} on={f.fixtureId === selected} timezone={timezone} onSelect={onSelect} />)}
                    </div>
                  );
                })
                : dayFx.map((f) => <FixtureRow key={f.fixtureId} fixture={f} competition={competitions.get(competitionId(f))} withLeague on={f.fixtureId === selected} timezone={timezone} onSelect={onSelect} />)}
            </div>
          );
        })}
      </div>
    </>
  );
}
