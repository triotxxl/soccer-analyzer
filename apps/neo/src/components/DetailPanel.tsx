import { leagueName, teamName, useNames } from "../../../shared/src/names";
import { eloAgainstOf, eloAgainstText } from "../../../shared/src/eloAgainst";
import { quoteSourceName } from "../../../shared/src/quoteSource";
import type { DashboardFixture } from "../../../shared/src/types";
import {
  dayKey, eloFormat, eloThin, formatDay, formatTime, goalsFormat, likelyTips, percent, strengthOf, type TeamRow, type Tip,
} from "../neoData";
import type { NeoState, NeoView } from "../useNeoState";
import { H2HBody, H2HLead } from "./H2HPanel";
import { MarketsBody } from "./MarketsPanel";
import { Crest, EmptyState } from "./ui";

const ELO_HINT = "Elo: Spielstärke aus allen Spielen der letzten fünf Jahre - je höher, desto stärker. Vergleichbar nur "
  + "innerhalb derselben Skala (Vereine, Nationalteams, U21 …). Die Chancen oben kommen aus dem Modell, nicht aus dem Elo.";
const LEVEL_HINT = "Liga-Niveau: das mittlere Elo der Vereine einer Liga. Zeigt, ob zwei Ligen etwa gleich stark sind "
  + "oder eine Klasse dazwischen liegt.";

/** Elo beider Teams und, bei Spielen zwischen Ligen, das Liga-Niveau - je mit Urteil in Worten. */
function StrengthLines({ fixture }: { fixture: DashboardFixture }) {
  const source = useNames();
  const s = strengthOf(fixture, source), against = eloAgainstOf(fixture);
  if (!s.home.elo && !s.away.elo) return null;
  const side = (x: typeof s.home, strong: boolean) => (
    <span className={strong ? "up" : undefined}>
      {x.name} <span className={`num${x.elo && eloThin(x.elo) ? " thin" : ""}`}
        title={x.elo && eloThin(x.elo) ? "Wenig Grundlage: der Wert kann noch stark schwanken" : undefined}>{x.elo ? eloFormat(x.elo.elo) : "–"}</span>
    </span>
  );
  return (
    <div className="sh-elo">
      <div><b title={ELO_HINT}>Elo <small>(Spielstärke)</small></b>
        {side(s.home, s.stronger === "home")}{side(s.away, s.stronger === "away")}
        <em>{s.verdict ?? "nicht vergleichbar (verschiedene Skalen)"}</em></div>
      {s.league && <div><b title={LEVEL_HINT}>Liga-Niveau</b>
        <span className={s.league.stronger === "home" ? "up" : undefined}>{s.league.home.name} <span className="num">{eloFormat(s.league.home.level)}</span></span>
        <span className={s.league.stronger === "away" ? "up" : undefined}>{s.league.away.name} <span className="num">{eloFormat(s.league.away.level)}</span></span>
        <em>{s.league.verdict}</em></div>}
      {against && <p className="sh-against"><span className="tag">Elo dagegen</span>{eloAgainstText(against, s.home.name, s.away.name)}</p>}
    </div>
  );
}

/** Kurzform für „Am ehesten“: der Tipp so, wie er im Kopf steht. */
const likelyLabel = (tip: Tip) => (tip.market === "btts" ? (tip.pick === "Ja" ? "Beide treffen" : "Nicht beide treffen") : tip.pick);

type DetailState = Pick<NeoState, "ou" | "moreOpen" | "fxSide" | "h2hVenue" | "perfRange" | "phSplit">;

/**
 * Rechte Detailansicht. Bei „Spiele“ Marktchancen oder H2H des gewählten Spiels (Referenz `renderMarkets`,
 * `renderH2H`), bei Predictions das H2H zum Spiel des gewählten Tipps, bei Teams vorerst der Platzhalter
 * (`renderDetailPlaceholder`).
 */
export function DetailPanel({ fixture, fixtures, team, tip, timezone, view, ui, onUi }: {
  fixture: DashboardFixture | null; fixtures: readonly DashboardFixture[]; team: TeamRow | null; tip: Tip | null; timezone: string;
  view: NeoView; ui: DetailState; onUi: (patch: Partial<DetailState>) => void;
}) {
  const source = useNames();
  const markets = view === "fixtures", preds = view === "preds";
  let title = <>{markets ? "Kein Spiel gewählt" : preds ? "Kein Tipp gewählt" : "Keine Auswahl"}</>, meta: string | null = null;
  if (team) title = <><Crest name={team.name} logo={team.crest} /><span>{team.name}</span></>;
  else if (fixture) {
    const home = teamName(fixture, "home", source), away = teamName(fixture, "away", source);
    title = <><Crest name={home} logo={fixture.homeCrest} /><span>{home}</span><span className="sep">–</span><span>{away}</span><Crest name={away} logo={fixture.awayCrest} /></>;
    meta = `${leagueName(fixture, source)} · ${formatDay(dayKey(fixture.kickoff, timezone))} · ${formatTime(fixture.kickoff, timezone)}`;
  }
  const showFixture = (markets || preds) && fixture && !team;
  const h2h = showFixture && (preds || ui.fxSide === "h2h");
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
                {preds && tip && <span>{tip.author ? `Tipp aus ${tip.author.label}` : "Tipp"} <b>{likelyLabel(tip)}</b>
                  {tip.probability != null && <> <span className="num">{percent(tip.probability)}</span></>}</span>}
                {showFixture && !h2h && <>
                  <span>Erwartete Tore <b>{goalsFormat(fixture.expectedGoals.home)} : {goalsFormat(fixture.expectedGoals.away)}</b></span>
                  <span>Quoten: {quoteSourceName(fixture)}</span>
                </>}
              </div>
            </div>
          )}
          {showFixture && <StrengthLines fixture={fixture} />}
          {h2h && <H2HLead fixture={fixture} venue={ui.h2hVenue} />}
          {likely.length > 0 && (
            <div className="sh-lead">
              <b>Am ehesten</b>
              {likely.map((tip) => <span key={tip.id}><strong>{likelyLabel(tip)}</strong> <span className="num">{percent(tip.probability ?? 0)}</span></span>)}
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
                phSplit={ui.phSplit} onPhSplit={(phSplit) => onUi({ phSplit })} />
            : showFixture
              ? <MarketsBody fixture={fixture} ou={ui.ou} onOu={(ou) => onUi({ ou })} moreOpen={ui.moreOpen} onMoreOpen={(moreOpen) => onUi({ moreOpen })} />
              : markets
                ? <EmptyState title="Keine Marktchancen">Wähle einen Wettbewerb und ein Spiel, dann erscheinen hier die Chancen je Markt.</EmptyState>
                : preds
                  ? <EmptyState title="Kein H2H">Wähle links einen Tipp, dann erscheinen hier die direkten Duelle und die Saison beider Teams.</EmptyState>
                  : <EmptyState title="Detailansicht folgt">Hier steht später die Analyse des gewählten Teams.</EmptyState>}
        </div>
      </div>
    </section>
  );
}
