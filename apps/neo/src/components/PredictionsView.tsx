import { useState, type ReactNode } from "react";
import { leagueName, teamName, useNames } from "../../../shared/src/names";
import type { DashboardFixture } from "../../../shared/src/types";
import { dayKey, formatDay, formatTime, oddsFormat, percent, scopePhrase, TIP_MARKETS, tipCandidates, type DayScope, type Tip, type TipMarket } from "../neoData";
import { Chevron, EmptyState, Team, plural, usePopover } from "./ui";

interface Props {
  tips: Tip[];
  /** alle Spiele im Zeitraum und in den gewählten Wettbewerben, für die Zahlen je Markt */
  fixtures: DashboardFixture[];
  timezone: string;
  markets: TipMarket[];
  onMarkets: (m: TipMarket[]) => void;
  pmin: number;
  pmax: number;
  onRange: (min: number, max: number) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  scope: DayScope;
  noCompetitions: boolean;
}

const PROB_PRESETS: Array<[string, number, number]> = [["Alle", 0, 100], ["ab 50 %", 50, 100], ["ab 60 %", 60, 100], ["ab 70 %", 70, 100], ["ab 80 %", 80, 100]];

function Drop({ label, value, filtered, children }: { label: string; value: string; filtered: boolean; children: ReactNode }) {
  const [open, setOpen, ref] = usePopover<HTMLDivElement>();
  return (
    <div className="cpick pdrop" ref={ref}>
      <button className={`cpick-btn pdrop-btn${filtered ? " filtered" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="pdrop-k">{label}</span><span className="pdrop-v">{value}</span><Chevron />
      </button>
      <div className="cpick-panel pdrop-panel" role="dialog" aria-label={label} hidden={!open}>{children}</div>
    </div>
  );
}

/** Linke Liste „Predictions“: Modell-Tipps je Spiel (Referenz `renderPreds`). Autoren-Tipps folgen. */
export function PredictionsView({ tips, fixtures, timezone, markets, onMarkets, pmin, pmax, onRange, selected, onSelect, scope, noCompetitions }: Props) {
  const source = useNames();
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const [lo, hi] = draft ?? [pmin, pmax];
  const inRange = (p: number) => p * 100 >= pmin - 1e-9 && p * 100 <= pmax + 1e-9;
  const count = (key: TipMarket) => fixtures.filter((f) => tipCandidates(f, source).some((t) => t.market === key && inRange(t.probability))).length;
  const marketLabel = !markets.length ? "Kein Markt gewählt" : markets.length === TIP_MARKETS.length ? "Alle Märkte" : TIP_MARKETS.filter((m) => markets.includes(m[0])).map((m) => m[1]).join(", ");
  const probLabel = pmin === 0 && pmax === 100 ? "Alle" : pmax === 100 ? `ab ${pmin} %` : `${pmin}–${pmax} %`;
  const commit = () => { if (draft) { onRange(draft[0], draft[1]); setDraft(null); } };
  const days = [...new Set(tips.map((t) => dayKey(t.fixture.kickoff, timezone)))];

  return (
    <>
      <div className="panel-head"><div><h2 id="detail-title">Modell-Tipps</h2></div></div>
      <div className="panel-body" id="detail-body">
        <div className="pred-bar" role="toolbar" aria-label="Tipps filtern">
          <Drop label="Quelle" value="Modell" filtered={false}>
            <div className="pd-opts" role="listbox" aria-label="Quelle">
              <button className="pd-opt" role="option" aria-selected="true"><b>Modell</b><small>Wahrscheinlichster Tipp je Spiel aus den gewählten Märkten</small></button>
              <button className="pd-opt" role="option" aria-selected="false" aria-disabled="true" disabled><b>Autoren <span className="tag lig">folgt</span></b><small>Tipps von Autoren kommen später dazu</small></button>
            </div>
          </Drop>
          <Drop label="Märkte" value={marketLabel} filtered={markets.length !== TIP_MARKETS.length}>
            <div className="cpick-quick" role="group" aria-label="Schnellauswahl">
              <button onClick={() => onMarkets(TIP_MARKETS.map((m) => m[0]))}>Alle</button>
              <button onClick={() => onMarkets([])}>Keine</button>
            </div>
            <ul className="pk-tree">{TIP_MARKETS.map(([key, label, sub]) => {
              const n = count(key);
              return (
                <li key={key}><div className={`pk-row${n ? "" : " na"}`}><span />
                  <label><input type="checkbox" checked={markets.includes(key)}
                    onChange={(e) => onMarkets(TIP_MARKETS.map((m) => m[0]).filter((k) => (k === key ? e.target.checked : markets.includes(k))))} />
                    <span className="name">{label}</span><span className="tag lig">{sub}</span></label>
                  <span className="count">{n}</span></div></li>
              );
            })}</ul>
          </Drop>
          <Drop label="Wahrscheinlichkeit" value={probLabel} filtered={!(pmin === 0 && pmax === 100)}>
            <div className="cpick-quick" role="group" aria-label="Schnellauswahl">
              {PROB_PRESETS.map(([label, a, b]) => <button key={label} aria-pressed={pmin === a && pmax === b} onClick={() => onRange(a, b)}>{label}</button>)}
            </div>
            <div className="pp-range">
              <label htmlFor="pp-min">Von <output>{lo} %</output></label>
              <input type="range" id="pp-min" min={0} max={100} step={5} value={lo}
                onChange={(e) => setDraft([Math.min(+e.target.value, hi), hi])} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
              <label htmlFor="pp-max">Bis <output>{hi} %</output></label>
              <input type="range" id="pp-max" min={0} max={100} step={5} value={hi}
                onChange={(e) => setDraft([lo, Math.max(+e.target.value, lo)])} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
            </div>
            <p className="cpick-note">{plural(tips.length, "Tipp", "Tipps")} im Bereich</p>
          </Drop>
        </div>
        {!tips.length ? (
          <EmptyState title="Keine Tipps">{noCompetitions || !fixtures.length
            ? `${scopePhrase(scope)[0]!.toUpperCase()}${scopePhrase(scope).slice(1)} spielt keiner der gewählten Wettbewerbe. Wähle oben einen anderen Zeitraum.`
            : !markets.length ? "Es ist kein Markt gewählt. Wähle unter „Märkte“ mindestens einen."
              : "Für diese Auswahl gibt es keine Tipps. Wähle weitere Märkte, einen größeren Wahrscheinlichkeitsbereich oder oben weitere Wettbewerbe."}</EmptyState>
        ) : days.map((day) => {
          const list = tips.filter((t) => dayKey(t.fixture.kickoff, timezone) === day);
          return (
            <div key={day}>
              <div className="day-h">{formatDay(day, "long")}<span>{plural(list.length, "Tipp", "Tipps")}</span></div>
              {list.map((t) => {
                const f = t.fixture, on = t.id === selected;
                return (
                  <div key={t.id} className={`tip-item${on ? " on" : ""}`}>
                    <button className="tip" aria-pressed={on} onClick={() => onSelect(t.id)}>
                      <span className="fx-time"><b>{formatTime(f.kickoff, timezone)}</b></span>
                      <span className="tip-match">
                        <Team name={teamName(f, "home", source)} logo={f.homeCrest} />
                        <Team name={teamName(f, "away", source)} logo={f.awayCrest} />
                        <small>{leagueName(f, source)}</small>
                      </span>
                      <span className="tip-pick"><small>{t.marketLabel}</small><b>{t.pick}</b><span className="tip-au">Chance laut Modell</span></span>
                      <span className="tip-prob hi">
                        <b>{percent(t.probability)}</b>
                        <small>Quote <span className="tip-q">{oddsFormat(t.odds)}</span></small>
                        <i style={{ ["--w" as string]: `${(t.probability * 100).toFixed(1)}%` }} />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
        <p className="note pred-note">Chancen sind Schätzungen des Modells. Auch wahrscheinliche Tipps gehen oft verloren – rechne nicht mit Gewinn.</p>
      </div>
    </>
  );
}
