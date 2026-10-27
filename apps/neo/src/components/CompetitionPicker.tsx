import type { ChangeEvent } from "react";
import { competitionLeague, competitionVariants, useNames } from "../../../shared/src/names";
import { countryLabel, scopePhrase, type Competition, type CountryGroup, type DayScope } from "../neoData";
import { Chevron, usePopover } from "./ui";

interface Props {
  tree: CountryGroup[];
  all: Competition[];
  deselected: string[];
  closedCountries: string[];
  /** Spiele je Wettbewerb im gewählten Zeitraum */
  counts: Map<string, number>;
  scope: DayScope;
  onDeselect: (ids: string[]) => void;
  onToggleCountry: (id: string) => void;
}

/** Wettbewerbs-Picker der Kopfleiste: Alle > Land > Liga / Pokal (Referenz `renderPicker`). */
export function CompetitionPicker({ tree, all, deselected, closedCountries, counts, scope, onDeselect, onToggleCountry }: Props) {
  const [open, setOpen, ref] = usePopover<HTMLDivElement>();
  const source = useNames();
  const off = new Set(deselected);
  const n = (ids: string[]) => ids.reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
  const allIds = all.map((c) => c.id);
  const available = allIds.filter((id) => (counts.get(id) ?? 0) > 0);
  const selectedAvailable = available.filter((id) => !off.has(id)).length;
  const filtered = deselected.length > 0;
  const naTitle = `Keine Spiele ${scopePhrase(scope)}`;

  const setIds = (ids: string[], on: boolean) => {
    const next = new Set(off);
    ids.forEach((id) => (on ? next.delete(id) : next.add(id)));
    onDeselect(allIds.filter((id) => next.has(id)));
  };
  const state = (ids: string[]) => {
    const chosen = ids.filter((id) => !off.has(id)).length;
    return chosen === 0 ? "none" : chosen === ids.length ? "all" : "some";
  };
  const box = (ids: string[], disabled = false) => {
    const s = state(ids);
    return {
      type: "checkbox" as const,
      checked: s === "all",
      ref: (el: HTMLInputElement | null) => { if (el) el.indeterminate = s === "some"; },
      onChange: (e: ChangeEvent<HTMLInputElement>) => setIds(ids, e.target.checked),
      disabled,
    };
  };

  return (
    <div className="cpick" ref={ref}>
      <button className={`cpick-btn${filtered ? " filtered" : ""}`} aria-expanded={open} aria-controls="cpick-panel" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        <span>Wettbewerbe</span><span className="count">{filtered ? `${selectedAvailable}/${available.length}` : `alle ${available.length}`}</span>
        <Chevron />
      </button>
      <div className="cpick-panel" id="cpick-panel" role="dialog" aria-label="Wettbewerbe filtern" hidden={!open}>
        <div className="cpick-quick" role="group" aria-label="Schnellauswahl">
          <button onClick={() => onDeselect([])}>Alle</button>
          <button onClick={() => onDeselect(allIds)}>Keine</button>
          <button onClick={() => onDeselect(all.filter((c) => c.cup).map((c) => c.id))}>Nur Ligen</button>
          <button onClick={() => onDeselect(all.filter((c) => !c.cup).map((c) => c.id))}>Nur Pokale</button>
        </div>
        <ul className="pk-tree">
          <li className="pk-all"><div className="pk-row"><span />
            <label><input {...box(allIds)} /><span className="name">Alle Wettbewerbe</span></label>
            <span className="count">{n(allIds)}</span></div></li>
          {tree.map((group) => {
            const ids = group.competitions.map((c) => c.id), none = n(ids) === 0, isOpen = !closedCountries.includes(group.id);
            const label = countryLabel(group, source);
            return (
              <li className="pk-country" key={group.id}>
                <div className={`pk-row${none ? " na" : ""}`} title={none ? naTitle : undefined}>
                  <button className="pk-tog" aria-expanded={isOpen} aria-label={`${label} ${isOpen ? "zuklappen" : "aufklappen"}`} onClick={() => onToggleCountry(group.id)}><Chevron /></button>
                  <label><input {...box(ids, none)} /><span className="cc">{group.code}</span><span className="name">{label}</span></label>
                  <span className="count">{n(ids)}</span>
                </div>
                <ul className="pk-leagues" hidden={!isOpen}>
                  {group.competitions.map((c) => {
                    const count = counts.get(c.id) ?? 0;
                    return (
                      <li key={c.id}><div className={`pk-row${count ? "" : " na"}`} title={count ? competitionVariants(c, source) : naTitle}><span />
                        <label><input {...box([c.id], !count)} /><span className="name">{competitionLeague(c, source)}</span><span className={`tag${c.cup ? "" : " lig"}`}>{c.cup ? "Pokal" : "Liga"}</span></label>
                        <span className="count">{count}</span></div></li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
        <p className="cpick-note">Zahlen: Spiele {scopePhrase(scope)} · ausgegraut: dort keine Spiele</p>
      </div>
    </div>
  );
}
