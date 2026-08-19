import { Calculator, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { formatOdd, formatPercent, sortStateLabel } from "./App";
import { computeKellyCandidates, type KellyCandidate, type KellySettings } from "./kelly";
import type { DashboardFixture, DashboardMarketKey } from "./types";

export function KellyButton({ onOpen }: { onOpen(): void }) {
  return <button className="kelly-trigger" aria-label="Kelly-Kriterium öffnen" title="Kelly-Kriterium" onClick={onOpen}>
    <Calculator size={15} weight="bold" /> Kelly
  </button>;
}

function formatEdge(edge: number): string {
  const sign = edge >= 0 ? "+" : "";
  return `${sign}${(edge * 100).toFixed(1).replace(".", ",")} %`;
}

function formatEuro(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

type KellySortKey = "team" | "market" | "odds" | "probability" | "edge" | "kelly" | "stake";

function sortValue(candidate: KellyCandidate, key: KellySortKey): number | string {
  if (key === "team") return `${candidate.homeTeam} ${candidate.awayTeam}`;
  if (key === "market") return candidate.marketLabel;
  if (key === "odds") return candidate.odds;
  if (key === "probability") return candidate.probability;
  if (key === "edge") return candidate.edge;
  if (key === "kelly") return candidate.stakePercent;
  return candidate.stake;
}

function SettingField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="kelly-setting-field"><span>{label}</span>{children}</label>;
}

export function KellyDialog({ fixtures, marketFilter, marketLabel, settings, onSettingsChange, onClose }: {
  fixtures: DashboardFixture[];
  marketFilter: "all" | DashboardMarketKey;
  marketLabel: string;
  settings: KellySettings;
  onSettingsChange(settings: KellySettings): void;
  onClose(): void;
}) {
  const [sortKey, setSortKey] = useState<KellySortKey>("stake");
  const [sortDirection, setSortDirection] = useState<1 | -1>(-1);

  const { candidates, evaluated, scaleFactor } = computeKellyCandidates(fixtures, marketFilter, settings);
  const sorted = [...candidates].sort((left, right) => {
    const leftValue = sortValue(left, sortKey);
    const rightValue = sortValue(right, sortKey);
    const comparison = typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue.localeCompare(rightValue, "de")
      : (leftValue as number) - (rightValue as number);
    return comparison * sortDirection;
  });

  const sort = (key: KellySortKey) => {
    if (sortKey === key) { setSortDirection((value) => value === 1 ? -1 : 1); return; }
    setSortKey(key);
    setSortDirection(key === "team" || key === "market" ? 1 : -1);
  };
  const arrow = (key: KellySortKey) => sortKey === key ? (sortDirection === 1 ? "↑" : "↓") : "↕";

  const totalStake = sorted.reduce((sum, candidate) => sum + candidate.stake, 0);
  const set = <K extends keyof KellySettings>(key: K, value: KellySettings[K]) =>
    onSettingsChange({ ...settings, [key]: value });

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="kelly-dialog" role="dialog" aria-label="Kelly-Kriterium" onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head">
        <strong>Kelly-Kriterium · {marketLabel}</strong>
        <button aria-label="Schließen" onClick={onClose}><X /></button>
      </div>

      <div className="kelly-settings-grid">
        <SettingField label="Budget (€)">
          <input type="number" min={0} step={5} value={settings.budget}
            onChange={(event) => set("budget", Math.max(0, Number(event.target.value) || 0))} />
        </SettingField>
        <SettingField label="Mindestquote">
          <input type="number" min={1.01} step={0.05} value={settings.minOdds}
            onChange={(event) => set("minOdds", Math.max(1.01, Number(event.target.value) || 1.01))} />
        </SettingField>
        <SettingField label="Kelly-Fraktion">
          <select value={settings.kellyFraction} onChange={(event) => set("kellyFraction", Number(event.target.value))}>
            <option value={1}>Full Kelly</option>
            <option value={0.5}>1/2 Kelly</option>
            <option value={0.25}>1/4 Kelly</option>
            <option value={0.125}>1/8 Kelly</option>
          </select>
        </SettingField>
        <SettingField label="Max. Einsatz/Wette (%)">
          <input type="number" min={0} max={100} step={0.5} value={settings.maxStakePercent * 100}
            onChange={(event) => set("maxStakePercent", Math.max(0, Number(event.target.value) || 0) / 100)} />
        </SettingField>
        <SettingField label="Max. Gesamtrisiko (%)">
          <input type="number" min={0} max={100} step={1} value={settings.maxExposurePercent * 100}
            onChange={(event) => set("maxExposurePercent", Math.max(0, Number(event.target.value) || 0) / 100)} />
        </SettingField>
        <SettingField label="Mindest-Edge (PP)">
          <input type="number" min={0} step={0.5} value={settings.minEdge * 100}
            onChange={(event) => set("minEdge", Math.max(0, Number(event.target.value) || 0) / 100)} />
        </SettingField>
      </div>

      <div className="kelly-table-scroll">
        <table className="kelly-table">
          <thead>
            <tr>
              <th><button onClick={() => sort("team")} aria-label={sortStateLabel("Partie", sortKey === "team", sortDirection)}>Partie {arrow("team")}</button></th>
              <th><button onClick={() => sort("market")} aria-label={sortStateLabel("Markt", sortKey === "market", sortDirection)}>Markt {arrow("market")}</button></th>
              <th><button onClick={() => sort("odds")} aria-label={sortStateLabel("Quote", sortKey === "odds", sortDirection)}>Quote {arrow("odds")}</button></th>
              <th><button onClick={() => sort("probability")} aria-label={sortStateLabel("Modell", sortKey === "probability", sortDirection)}>Modell {arrow("probability")}</button></th>
              <th><button onClick={() => sort("edge")} aria-label={sortStateLabel("Value", sortKey === "edge", sortDirection)}>Value {arrow("edge")}</button></th>
              <th><button onClick={() => sort("kelly")}
                aria-label={sortStateLabel("Einsatzanteil nach Caps", sortKey === "kelly", sortDirection)}
                title="Fractional Kelly, begrenzt durch Max-Einsatz/Wette und ggf. Gesamtrisiko-Skalierung">
                Kelly* {arrow("kelly")}
              </button></th>
              <th><button onClick={() => sort("stake")} aria-label={sortStateLabel("Einsatz", sortKey === "stake", sortDirection)}>Einsatz {arrow("stake")}</button></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((candidate) => <tr key={`${candidate.fixtureId}:${candidate.marketKey}`}>
              <td><strong>{candidate.homeTeam} – {candidate.awayTeam}</strong><small>{candidate.country} · {candidate.league}</small></td>
              <td><strong>{candidate.marketLabel}</strong><small>{candidate.selection}</small></td>
              <td>{formatOdd(candidate.odds)}</td>
              <td>{formatPercent(candidate.probability)}</td>
              <td className="kelly-edge">{formatEdge(candidate.edge)}</td>
              <td><strong>{formatPercent(candidate.stakePercent)}</strong><small>Full: {formatPercent(candidate.fullKelly)}</small></td>
              <td><strong>{formatEuro(candidate.stake)}</strong></td>
            </tr>)}
            {sorted.length === 0 && <tr><td className="kelly-empty" colSpan={7}>Keine Value-Wetten im aktuellen Markt gefunden</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="kelly-footer">
        <p>{evaluated} Spiele im Markt „{marketLabel}" geprüft · {sorted.length} Kandidat{sorted.length === 1 ? "" : "en"} mit positivem Value</p>
        <p>Summe Einsätze: <strong>{formatEuro(totalStake)}</strong> von {formatEuro(settings.budget)} Budget
          {scaleFactor < 1 && <> · Einsätze wegen Gesamtrisiko-Limit auf {(scaleFactor * 100).toFixed(0)} % skaliert</>}
        </p>
        <p className="kelly-hint">Kelly setzt kalibrierte Wahrscheinlichkeiten voraus – die Modellwerte sind Schätzungen, keine Garantien. Fractional Kelly reduziert das Risiko bei Fehleinschätzungen.</p>
        <p className="kelly-hint">* „Kelly" zeigt den finalen Einsatzanteil nach Fraktion, Pro-Wette- und Gesamtrisiko-Cap; „Full" darunter ist der ungedeckelte volle Kelly-Wert.</p>
      </div>
    </div>
  </div>;
}
