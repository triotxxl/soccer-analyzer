import type { KeyboardEvent } from "react";
import { competitionLeague, useNames } from "../../../shared/src/names";
import type { FormResult } from "../../../shared/src/types";
import { scopePhrase, sortName, type Competition, type DayScope, type LeagueTable, type TeamRow } from "../neoData";
import { EmptyState, Team } from "./ui";

interface Props {
  tables: LeagueTable[];
  competitions: Map<string, Competition>;
  byLeague: boolean;
  onByLeague: (v: boolean) => void;
  selected: string | null;
  onSelect: (key: string) => void;
  scope: DayScope;
  noCompetitions: boolean;
}

const FORM: Record<FormResult, [string, string]> = { win: ["S", "Sieg"], draw: ["U", "Unentschieden"], loss: ["N", "Niederlage"] };

function FormChips({ form }: { form: FormResult[] | null }) {
  if (!form?.length) return <span className="note" title="Keine Ligaspiele bekannt (ältere Analysen führen die Form noch nicht)">–</span>;
  return (
    <span className="form" title="Letzte Ligaspiele, neuestes links" aria-label={`Form, neuestes zuerst: ${form.map((r) => FORM[r][1]).join(", ")}`}>
      {form.map((r, i) => <i key={i} className={FORM[r][0]} aria-hidden="true">{FORM[r][0]}</i>)}
    </span>
  );
}

/** Linke Liste „Teams“ (Referenz `renderTeams`). */
export function TeamsView({ tables, competitions, byLeague, onByLeague, selected, onSelect, scope, noCompetitions }: Props) {
  const source = useNames();
  const rowKey = (e: KeyboardEvent, key: string) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(key); } };
  const row = (r: TeamRow, withLeague: boolean) => {
    const c = competitions.get(r.competitionId);
    const diff = r.goalsFor - r.goalsAgainst;
    return (
      <tr key={r.key} tabIndex={0} aria-selected={r.key === selected} onClick={() => onSelect(r.key)} onKeyDown={(e) => rowKey(e, r.key)}>
        <td className="num">{r.position}</td>
        <td className="l"><Team name={r.name} logo={r.crest} /></td>
        {withLeague && <td className="l"><span className="lgc"><span className="cc">{c?.code}</span><span className="hide-sm">{c ? competitionLeague(c, source) : ""}</span></span></td>}
        <td className="num">{r.played}</td>
        <td className="num hide-sm">{r.wins}</td><td className="num hide-sm">{r.draws}</td><td className="num hide-sm">{r.losses}</td>
        <td className="num">{r.goalsFor}:{r.goalsAgainst}</td>
        <td className="num hide-sm">{diff > 0 ? "+" : ""}{diff}</td>
        <td className="pts">{r.points}</td>
        <td className="l hide-xs"><FormChips form={r.form} /></td>
        <td className="go" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" /></svg></td>
      </tr>
    );
  };
  const table = (rows: TeamRow[], withLeague: boolean) => (
    <div className="tbl-wrap"><table>
      <thead><tr>
        <th title={withLeague ? "Platz in der eigenen Liga" : "Platz"}>{withLeague ? "Pl." : "#"}</th><th className="l">Team</th>
        {withLeague && <th className="l">Liga</th>}
        <th>Sp</th><th className="hide-sm">S</th><th className="hide-sm">U</th><th className="hide-sm">N</th><th>Tore</th><th className="hide-sm">Diff</th><th>Pkt</th>
        <th className="l hide-xs">Form</th><th><span className="sr">Öffnen</span></th>
      </tr></thead>
      <tbody>{rows.map((r) => row(r, withLeague))}</tbody>
    </table></div>
  );
  const all = tables.flatMap((t) => t.rows).sort((a, b) => sortName(a.name).localeCompare(sortName(b.name), "de"));

  return (
    <>
      <div className="panel-head">
        <div><h2 id="detail-title">Teams</h2></div>
        <div className="seg" role="group" aria-label="Teams anzeigen">
          <button aria-pressed={!byLeague} onClick={() => onByLeague(false)}>Alle Teams</button>
          <button aria-pressed={byLeague} onClick={() => onByLeague(true)}>Nach Ligen</button>
        </div>
      </div>
      <div className="panel-body" id="detail-body">
        {!all.length ? (
          noCompetitions
            ? <EmptyState title="Keine Wettbewerbe gewählt">Wähle oben unter „Wettbewerbe“ mindestens eine Liga oder einen Pokal, um Teams zu sehen.</EmptyState>
            : <EmptyState title="Keine Tabellen im Zeitraum">{`${scopePhrase(scope)[0]!.toUpperCase()}${scopePhrase(scope).slice(1)} spielt keine der gewählten Ligen. Wähle oben einen anderen Zeitraum.`}</EmptyState>
        ) : (
          <>
            <p className="tbl-hint">Wähle ein Team – seine Analyse erscheint in der Detailansicht.</p>
            {byLeague
              ? tables.map((t) => (
                <div key={t.competition.id}>
                  <div className="grp"><span className="cc">{t.competition.code}</span><span className="lg">{competitionLeague(t.competition, source)}</span><span>· Tabelle nach {t.played} Spieltagen</span></div>
                  {table(t.rows, false)}
                </div>
              ))
              : table(all, true)}
          </>
        )}
      </div>
    </>
  );
}
