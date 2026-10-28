import { leagueName, teamName, useNames } from "../../../shared/src/names";
import type { DashboardFixture } from "../../../shared/src/types";
import { dayKey, formatDay, formatTime, goalsFormat, likelyTips, percent, type TeamRow, type Tip } from "../neoData";
import { MarketsBody } from "./MarketsPanel";
import { Crest, EmptyState } from "./ui";

/** Kurzform für „Am ehesten“: der Tipp so, wie er im Kopf steht. */
const likelyLabel = (tip: Tip) => (tip.market === "btts" ? (tip.pick === "Ja" ? "Beide treffen" : "Nicht beide treffen") : tip.pick);

/**
 * Rechte Detailansicht. Bei „Spiele“ die Marktchancen des gewählten Spiels (Referenz `renderMarkets`),
 * H2H gesperrt mit „folgt“; bei Teams und Predictions vorerst der Platzhalter (`renderDetailPlaceholder`).
 */
export function DetailPanel({ fixture, team, timezone, markets, ou, onOu, moreOpen, onMoreOpen }: {
  fixture: DashboardFixture | null; team: TeamRow | null; timezone: string; markets: boolean;
  ou: number; onOu: (line: number) => void; moreOpen: boolean; onMoreOpen: (open: boolean) => void;
}) {
  const source = useNames();
  let title = <>{markets ? "Kein Spiel gewählt" : "Keine Auswahl"}</>, meta: string | null = null;
  if (team) title = <><Crest name={team.name} logo={team.crest} /><span>{team.name}</span></>;
  else if (fixture) {
    const home = teamName(fixture, "home", source), away = teamName(fixture, "away", source);
    title = <><Crest name={home} logo={fixture.homeCrest} /><span>{home}</span><span className="sep">–</span><span>{away}</span><Crest name={away} logo={fixture.awayCrest} /></>;
    meta = `${leagueName(fixture, source)} · ${formatDay(dayKey(fixture.kickoff, timezone))} · ${formatTime(fixture.kickoff, timezone)}`;
  }
  const showMarkets = markets && fixture && !team;
  const likely = showMarkets ? likelyTips(fixture, source) : [];
  return (
    <section className="panel" aria-labelledby="mk-title">
      <div className="panel-head">
        <div className="sh">
          <div className="sh-top">
            <div className="sh-title"><h2 id="mk-title" className="vs">{title}</h2></div>
            {markets && (
              <div className="seg" role="group" aria-label="Inhalt der Detailansicht">
                <button aria-pressed="true">Marktchancen</button>
                <button aria-pressed="false" disabled title="Der direkte Vergleich folgt">H2H <span className="tag lig">folgt</span></button>
              </div>
            )}
          </div>
          {meta && (
            <div className="sh-sub">
              <div className="mk-meta">
                <span>{meta}</span>
                {showMarkets && <>
                  <span>Erwartete Tore <b>{goalsFormat(fixture.expectedGoals.home)} : {goalsFormat(fixture.expectedGoals.away)}</b></span>
                  <span>Quoten: Tipico</span>
                </>}
              </div>
            </div>
          )}
          {likely.length > 0 && (
            <div className="sh-lead">
              <b>Am ehesten</b>
              {likely.map((tip) => <span key={tip.id}><strong>{likelyLabel(tip)}</strong> <span className="num">{percent(tip.probability)}</span></span>)}
            </div>
          )}
        </div>
      </div>
      <div className="panel-body">
        <div className="tiles-wrap">
          {showMarkets
            ? <MarketsBody fixture={fixture} ou={ou} onOu={onOu} moreOpen={moreOpen} onMoreOpen={onMoreOpen} />
            : markets
              ? <EmptyState title="Keine Marktchancen">Wähle einen Wettbewerb und ein Spiel, dann erscheinen hier die Chancen je Markt.</EmptyState>
              : <EmptyState title="Detailansicht folgt">
                  {team ? "Hier steht später die Analyse des gewählten Teams." : "Hier stehen später die Einzelheiten zum gewählten Tipp."}
                </EmptyState>}
        </div>
      </div>
    </section>
  );
}
