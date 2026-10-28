import { leagueName, teamName, useNames } from "../../../shared/src/names";
import type { DashboardFixture } from "../../../shared/src/types";
import { dayKey, formatDay, formatTime, goalsFormat, likelyTips, percent, type TeamRow, type Tip } from "../neoData";
import type { NeoState } from "../useNeoState";
import { H2HBody, H2HLead } from "./H2HPanel";
import { MarketsBody } from "./MarketsPanel";
import { Crest, EmptyState } from "./ui";

/** Kurzform für „Am ehesten“: der Tipp so, wie er im Kopf steht. */
const likelyLabel = (tip: Tip) => (tip.market === "btts" ? (tip.pick === "Ja" ? "Beide treffen" : "Nicht beide treffen") : tip.pick);

type DetailState = Pick<NeoState, "ou" | "moreOpen" | "fxSide" | "h2hVenue" | "perfRange" | "perfPrev" | "phSplit">;

/**
 * Rechte Detailansicht. Bei „Spiele“ Marktchancen oder H2H des gewählten Spiels (Referenz `renderMarkets`,
 * `renderH2H`); bei Teams und Predictions vorerst der Platzhalter (`renderDetailPlaceholder`).
 */
export function DetailPanel({ fixture, fixtures, team, timezone, markets, ui, onUi }: {
  fixture: DashboardFixture | null; fixtures: readonly DashboardFixture[]; team: TeamRow | null; timezone: string; markets: boolean;
  ui: DetailState; onUi: (patch: Partial<DetailState>) => void;
}) {
  const source = useNames();
  let title = <>{markets ? "Kein Spiel gewählt" : "Keine Auswahl"}</>, meta: string | null = null;
  if (team) title = <><Crest name={team.name} logo={team.crest} /><span>{team.name}</span></>;
  else if (fixture) {
    const home = teamName(fixture, "home", source), away = teamName(fixture, "away", source);
    title = <><Crest name={home} logo={fixture.homeCrest} /><span>{home}</span><span className="sep">–</span><span>{away}</span><Crest name={away} logo={fixture.awayCrest} /></>;
    meta = `${leagueName(fixture, source)} · ${formatDay(dayKey(fixture.kickoff, timezone))} · ${formatTime(fixture.kickoff, timezone)}`;
  }
  const showFixture = markets && fixture && !team;
  const h2h = showFixture && ui.fxSide === "h2h";
  const likely = showFixture && !h2h ? likelyTips(fixture, source) : [];
  return (
    <section className="panel" aria-labelledby="mk-title">
      <div className="panel-head">
        <div className="sh">
          <div className="sh-top">
            <div className="sh-title"><h2 id="mk-title" className="vs">{title}</h2></div>
            {markets && (
              <div className="seg" role="group" aria-label="Inhalt der Detailansicht">
                <button aria-pressed={ui.fxSide !== "h2h"} onClick={() => onUi({ fxSide: "markets" })}>Marktchancen</button>
                <button aria-pressed={ui.fxSide === "h2h"} onClick={() => onUi({ fxSide: "h2h" })}>H2H</button>
              </div>
            )}
          </div>
          {meta && (
            <div className="sh-sub">
              <div className="mk-meta">
                <span>{meta}</span>
                {showFixture && !h2h && <>
                  <span>Erwartete Tore <b>{goalsFormat(fixture.expectedGoals.home)} : {goalsFormat(fixture.expectedGoals.away)}</b></span>
                  <span>Quoten: Tipico</span>
                </>}
              </div>
            </div>
          )}
          {h2h && <H2HLead fixture={fixture} venue={ui.h2hVenue} />}
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
          {h2h
            ? <H2HBody fixture={fixture} fixtures={fixtures} timezone={timezone}
                venue={ui.h2hVenue} onVenue={(h2hVenue) => onUi({ h2hVenue })}
                perfRange={ui.perfRange} onPerfRange={(perfRange) => onUi({ perfRange })}
                perfPrev={ui.perfPrev} onPerfPrev={(perfPrev) => onUi({ perfPrev })}
                phSplit={ui.phSplit} onPhSplit={(phSplit) => onUi({ phSplit })} />
            : showFixture
              ? <MarketsBody fixture={fixture} ou={ui.ou} onOu={(ou) => onUi({ ou })} moreOpen={ui.moreOpen} onMoreOpen={(moreOpen) => onUi({ moreOpen })} />
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
