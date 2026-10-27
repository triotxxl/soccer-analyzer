import { leagueName, teamName, useNames } from "../../../shared/src/names";
import type { DashboardFixture } from "../../../shared/src/types";
import { dayKey, formatDay, formatTime, type TeamRow } from "../neoData";
import { Crest, EmptyState } from "./ui";

/** Rechte Detailansicht - vorerst nur Platzhalter (Davids Entscheidung, Referenz `renderDetailPlaceholder`). */
export function DetailPanel({ fixture, team, timezone }: { fixture: DashboardFixture | null; team: TeamRow | null; timezone: string }) {
  const source = useNames();
  let title = <>Keine Auswahl</>, meta: string | null = null;
  if (team) title = <><Crest name={team.name} logo={team.crest} /><span>{team.name}</span></>;
  else if (fixture) {
    const home = teamName(fixture, "home", source), away = teamName(fixture, "away", source);
    title = <><Crest name={home} logo={fixture.homeCrest} /><span>{home}</span><span className="sep">–</span><span>{away}</span><Crest name={away} logo={fixture.awayCrest} /></>;
    meta = `${leagueName(fixture, source)} · ${formatDay(dayKey(fixture.kickoff, timezone))} · ${formatTime(fixture.kickoff, timezone)}`;
  }
  return (
    <section className="panel" aria-labelledby="mk-title">
      <div className="panel-head">
        <div className="sh">
          <div className="sh-top"><div className="sh-title"><h2 id="mk-title" className="vs">{title}</h2></div></div>
          {meta && <div className="sh-sub"><div className="mk-meta"><span>{meta}</span></div></div>}
        </div>
      </div>
      <div className="panel-body">
        <div className="tiles-wrap">
          <EmptyState title="Detailansicht folgt">
            {team ? "Hier steht später die Analyse des gewählten Teams." : "Hier stehen später Marktchancen und direkter Vergleich (H2H) für das gewählte Spiel."}
          </EmptyState>
        </div>
      </div>
    </section>
  );
}
