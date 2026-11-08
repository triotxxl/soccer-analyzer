import { eloAgainstOf, eloAgainstText } from "../../../shared/src/eloAgainst";
import { useState, type ReactNode } from "react";
import { leagueName, teamName, useNames } from "../../../shared/src/names";
import type { DashboardFixture } from "../../../shared/src/types";
import {
  AUTHOR_FILTERS, authorFilterLabel, authorFilterWarning, dayKey, formatDay, formatTime, oddsFormat, percent, scopePhrase, TIP_MARKETS, tipCandidates,
  type AuthorFilter, type DayScope, type Tip, type TipMarket, type TipOrder,
} from "../neoData";
import { Chevron, EmptyState, Team, plural, usePopover } from "./ui";

interface Props {
  tips: Tip[];
  /** alle Spiele im Zeitraum und in den gewählten Wettbewerben, für die Zahlen je Markt */
  fixtures: DashboardFixture[];
  timezone: string;
  order: TipOrder;
  onOrder: (order: TipOrder) => void;
  tipSource: "model" | "authors";
  onTipSource: (source: "model" | "authors") => void;
  authorFilters: AuthorFilter[];
  onAuthorFilters: (filters: AuthorFilter[]) => void;
  /** Treffer je Daves-Filter im Zeitraum, auch für nicht gewählte Filter */
  authorCounts: Record<AuthorFilter, number>;
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

/**
 * Linke Liste „Predictions“ (Referenz `renderPreds`): Modell-Tipps je Spiel oder die Tipps der Autoren - seit
 * 02.11.2026 die drei Daves-Filter mit ihrer Vorgabe-Stufe (Davids Wahl), einzeln wählbar.
 */
export function PredictionsView({
  tips, fixtures, timezone, order, onOrder, tipSource, onTipSource, authorFilters, onAuthorFilters, authorCounts,
  markets, onMarkets, pmin, pmax, onRange, selected, onSelect, scope, noCompetitions,
}: Props) {
  const source = useNames();
  const authors = tipSource === "authors";
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const [lo, hi] = draft ?? [pmin, pmax];
  const inRange = (p: number | null) => (p ?? 0) * 100 >= pmin - 1e-9 && (p ?? 0) * 100 <= pmax + 1e-9;
  const count = (key: TipMarket) => fixtures.filter((f) => tipCandidates(f, source).some((t) => t.market === key && inRange(t.probability))).length;
  const marketLabel = !markets.length ? "Kein Markt gewählt" : markets.length === TIP_MARKETS.length ? "Alle Märkte" : TIP_MARKETS.filter((m) => markets.includes(m[0])).map((m) => m[1]).join(", ");
  const probLabel = pmin === 0 && pmax === 100 ? "Alle" : pmax === 100 ? `ab ${pmin} %` : `${pmin}–${pmax} %`;
  const sourceLabel = !authors ? "Modell" : !authorFilters.length ? "Autoren · kein Filter"
    : authorFilters.length === AUTHOR_FILTERS.length ? "Autoren · Daves Filter" : `Autoren · ${authorFilters.map(authorFilterLabel).join(", ")}`;
  const commit = () => { if (draft) { onRange(draft[0], draft[1]); setDraft(null); } };
  const days = [...new Set(tips.map((t) => dayKey(t.fixture.kickoff, timezone)))];
  const toggleFilter = (filter: AuthorFilter, on: boolean) => onAuthorFilters(AUTHOR_FILTERS.filter((f) => (f === filter ? on : authorFilters.includes(f))));

  return (
    <>
      <div className="panel-head">
        <div><h2 id="detail-title">{authors ? "Daves Tipps" : "Modell-Tipps"}</h2></div>
        <div className="mk-tools">
          <div className="seg" role="group" aria-label="Tipps ordnen">
            <button aria-pressed={order === "chance"} onClick={() => onOrder("chance")}>Nach Chance</button>
            <button aria-pressed={order === "kickoff"} onClick={() => onOrder("kickoff")}>Nach Anstoß</button>
          </div>
        </div>
      </div>
      <div className="panel-body" id="detail-body">
        <div className="pred-bar" role="toolbar" aria-label="Tipps filtern">
          <Drop label="Quelle" value={sourceLabel} filtered={authors}>
            <div className="pd-opts" role="listbox" aria-label="Quelle">
              <button className="pd-opt" role="option" aria-selected={!authors} onClick={() => onTipSource("model")}>
                <b>Modell</b><small>Wahrscheinlichster Tipp je Spiel aus den gewählten Märkten</small></button>
              <button className="pd-opt" role="option" aria-selected={authors} onClick={() => onTipSource("authors")}>
                <b>Autoren</b><small>Daves Filter: Tabelle, direkte Duelle (H2H) und Form suchen den Tipp aus</small></button>
            </div>
            <ul className="pk-tree pd-authors" aria-label="Daves Filter">{AUTHOR_FILTERS.map((filter) => (
              <li key={filter}><div className={`pk-row${authorCounts[filter] ? "" : " na"}`}><span />
                <label><input type="checkbox" checked={authors && authorFilters.includes(filter)}
                  onChange={(e) => toggleFilter(filter, authors ? e.target.checked : true)} />
                  <span className="name">{authorFilterLabel(filter)}</span></label>
                <span className="count">{authorCounts[filter]}</span></div></li>
            ))}</ul>
            <p className="cpick-note">Jeder Filter mit seiner Vorgabe-Stufe, wie im Quickpicker.</p>
          </Drop>
          {!authors && <Drop label="Märkte" value={marketLabel} filtered={markets.length !== TIP_MARKETS.length}>
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
          </Drop>}
          {!authors && <Drop label="Wahrscheinlichkeit" value={probLabel} filtered={!(pmin === 0 && pmax === 100)}>
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
          </Drop>}
        </div>
        {authors && authorFilters.length > 0 && (
          <ul className="pred-warn" aria-label="Warnungen der Filter">
            {authorFilters.map((filter) => <li key={filter}><span><b>{authorFilterLabel(filter)}:</b> {authorFilterWarning(filter)}</span></li>)}
          </ul>
        )}
        {!tips.length ? (
          <EmptyState title="Keine Tipps">{noCompetitions || !fixtures.length
            ? `${scopePhrase(scope)[0]!.toUpperCase()}${scopePhrase(scope).slice(1)} spielt keiner der gewählten Wettbewerbe. Wähle oben einen anderen Zeitraum.`
            : authors ? (!authorFilters.length ? "Es ist kein Filter gewählt. Wähle unter „Quelle“ mindestens einen von Daves Filtern."
              : "Daves Filter finden in diesem Zeitraum kein Spiel. Wähle unter „Quelle“ weitere Filter oder oben einen anderen Zeitraum.")
            : !markets.length ? "Es ist kein Markt gewählt. Wähle unter „Märkte“ mindestens einen."
              : "Für diese Auswahl gibt es keine Tipps. Wähle weitere Märkte, einen größeren Wahrscheinlichkeitsbereich oder oben weitere Wettbewerbe."}</EmptyState>
        ) : days.map((day) => {
          const list = tips.filter((t) => dayKey(t.fixture.kickoff, timezone) === day);
          return (
            <div key={day}>
              <div className="day-h">{formatDay(day, "long")}<span>{plural(list.length, "Tipp", "Tipps")}</span></div>
              {list.map((t) => {
                const f = t.fixture, on = t.id === selected, eloAgainst = t.market === "1x2" ? eloAgainstOf(f) : null;
                return (
                  <div key={t.id} className={`tip-item${on ? " on" : ""}`}>
                    <button className="tip" aria-pressed={on} onClick={() => onSelect(t.id)}>
                      <span className="fx-time"><b>{formatTime(f.kickoff, timezone)}</b></span>
                      <span className="tip-match">
                        <Team name={teamName(f, "home", source)} logo={f.homeCrest} />
                        <Team name={teamName(f, "away", source)} logo={f.awayCrest} />
                        <small>{leagueName(f, source)}</small>
                      </span>
                      <span className="tip-pick">
                        <small>{t.author ? t.author.label : t.marketLabel}</small>
                        <b>{t.pick}</b>
                        <span className="tip-au">
                          {t.author?.score ? `Remis-Score ${t.author.score.value.toLocaleString("de-DE")} von ${t.author.score.max.toLocaleString("de-DE")} · ` : ""}Chance laut Modell
                          {t.author?.modelAgainst && <span className="tag" title="Das Modell hält die andere Mannschaft für wahrscheinlicher">Modell dagegen</span>}
                          {eloAgainst && <span className="tag" title={eloAgainstText(eloAgainst, teamName(f, "home", source), teamName(f, "away", source))}>Elo dagegen</span>}
                        </span>
                      </span>
                      <span className="tip-prob hi">
                        <b>{t.probability == null ? "–" : percent(t.probability)}</b>
                        <small>Quote <span className="tip-q">{oddsFormat(t.odds)}</span></small>
                        <i style={{ ["--w" as string]: `${((t.probability ?? 0) * 100).toFixed(1)}%` }} />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
        <p className="note pred-note">{authors
          ? "Daves Filter suchen nach Tabelle, direkten Duellen und Form aus; die Chance daneben schätzt das Modell. Auch wahrscheinliche Tipps gehen oft verloren – rechne nicht mit Gewinn."
          : "Chancen sind Schätzungen des Modells. Auch wahrscheinliche Tipps gehen oft verloren – rechne nicht mit Gewinn."}</p>
      </div>
    </>
  );
}
