import { Calculator, DownloadSimple, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { formatOdd, formatPercent, sortStateLabel } from "./App";
import { buildKellyExport, computeKellyCandidates, kellyExportFileName, type KellyCandidate, type KellySettings } from "./kelly";
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

function downloadJson(fileName: string, payload: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Firefox cancels the download when the URL is revoked in the same tick.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Die Filter tragen ihre Begründung als Titel-Tooltip mit sich - ohne die Messwerte daneben
// wirken sie wie willkürliche Regler, und genau das sind sie nicht.
function SettingField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="kelly-setting-field" title={hint}>
    <span>{label}{hint === undefined ? null : <abbr title={hint} aria-label={hint}> ⓘ</abbr>}</span>
    {children}
  </label>;
}

const MARKET_TOGGLES: Array<[DashboardMarketKey, string]> = [
  ["1x2", "1X2"],
  ["draw", "Remis"],
  ["btts", "BTTS"],
  ["over15", "Ü1,5"],
  ["over25", "Ü2,5"],
  ["firstHalfOver05", "HZ Ü0,5"],
  ["firstHalfOver15", "HZ Ü1,5"]
];

// 0.07 * 100 ergibt 7.000000000000001 - ohne Rundung landet der Float im Eingabefeld.
function roundForDisplay(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Zahlenfeld mit Entwurfszustand: Solange getippt wird, zeigt das Feld exakt das an, was
 * eingegeben wurde - auch die leere Eingabe. Nur gültige Zahlen werden nach oben gemeldet,
 * geklemmt wird erst beim Verlassen des Feldes. Ohne den Entwurf würde ein geleertes Feld
 * sofort wieder auf 0 springen und ließe sich nicht überschreiben.
 */
function NumberField({ label, hint, value, scale = 1, min, max, step, disabled, onCommit }: {
  label: string;
  hint?: string;
  value: number;
  scale?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const change = (raw: string) => {
    setDraft(raw);
    const parsed = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed / scale);
  };

  const blur = () => {
    const parsed = draft === null ? NaN : Number(draft);
    const shown = draft !== null && draft.trim() !== "" && Number.isFinite(parsed) ? parsed : value * scale;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, shown));
    setDraft(null);
    if (clamped / scale !== value) onCommit(clamped / scale);
  };

  return <SettingField label={label} hint={hint}>
    <input type="number" min={min} max={max} step={step} disabled={disabled}
      value={draft ?? String(roundForDisplay(value * scale))}
      onChange={(event) => change(event.target.value)}
      onBlur={blur} />
  </SettingField>;
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

  const { candidates, evaluated, scaleFactor, gameRiskLimits, filtered } = computeKellyCandidates(fixtures, marketFilter, settings);
  const limitedGames = gameRiskLimits.filter((game) => game.scaleFactor < 1);
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

  // Exportiert die Liste genau so, wie sie gerade gefiltert und sortiert angezeigt wird.
  const exportList = () => downloadJson(
    kellyExportFileName(marketFilter),
    buildKellyExport({ candidates: sorted, evaluated, scaleFactor, gameRiskLimits }, { marketFilter, marketLabel, settings })
  );

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="kelly-dialog" role="dialog" aria-label="Kelly-Kriterium" onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head">
        <strong>Kelly-Kriterium · {marketLabel}</strong>
        <span className="overlay-head-actions">
          <button aria-label="Liste als JSON exportieren" title="Liste als JSON exportieren"
            disabled={sorted.length === 0} onClick={exportList}><DownloadSimple /></button>
          <button aria-label="Schließen" onClick={onClose}><X /></button>
        </span>
      </div>

      <div className="kelly-settings-grid">
        <NumberField label="Budget (€)" value={settings.budget} min={0} step={5}
          onCommit={(value) => set("budget", value)} />
        <NumberField label="Mindestquote" value={settings.minOdds} min={1.01} step={0.05}
          onCommit={(value) => set("minOdds", value)} />
        <SettingField label="Kelly-Fraktion">
          <select value={settings.kellyFraction} onChange={(event) => set("kellyFraction", Number(event.target.value))}>
            <option value={1}>Full Kelly</option>
            <option value={0.5}>1/2 Kelly</option>
            <option value={0.25}>1/4 Kelly</option>
            <option value={0.125}>1/8 Kelly</option>
          </select>
        </SettingField>
        <NumberField label="Max. Einsatz/Wette (%)" value={settings.maxStakePercent} scale={100} min={0} max={100} step={0.5}
          onCommit={(value) => set("maxStakePercent", value)} />
        <NumberField label="Max. Gesamtrisiko (%)" value={settings.maxExposurePercent} scale={100} min={0} max={100} step={1}
          onCommit={(value) => set("maxExposurePercent", value)} />
        <NumberField label="Mindest-Edge (PP)" value={settings.minEdge} scale={100} min={0} step={0.5}
          onCommit={(value) => set("minEdge", value)} />
        <SettingField label="Edge-Deckel"
          hint="Über 13.124 abgerechneten Marktzeilen wächst die Selbstüberschätzung monoton mit dem Edge: 7–10 PP → −7,9 PP Bias, über 25 PP → −51,9 PP. Ein sehr hoher Edge ist ein Fehlersignal, kein Value.">
          <input type="checkbox" checked={settings.maxEdge !== null}
            aria-label="Edge-Deckel aktiv"
            onChange={(event) => set("maxEdge", event.target.checked ? 0.12 : null)} />
        </SettingField>
        <NumberField label="Max. Edge (PP)" value={settings.maxEdge ?? 0.12} scale={100} min={0} step={0.5}
          disabled={settings.maxEdge === null}
          onCommit={(value) => set("maxEdge", value)} />
        <NumberField label="Mindest-Datenvertrauen (%)" value={settings.minConfidence} min={0} max={100} step={5}
          hint="0 = aus. Das Band 70–85 % liegt in beiden Datenhälften bei rund −59 % ROI, 95 %+ ist das einzige nicht durchgehend negative Band."
          onCommit={(value) => set("minConfidence", value)} />
        <SettingField label="Cross-League ausschließen"
          hint="Cross-League-Auswahlen liegen bei −25,9 % ROI gegen −3,7 % innerhalb einer Liga, in beiden Datenhälften negativ.">
          <input type="checkbox" checked={settings.excludeCrossLeague}
            onChange={(event) => set("excludeCrossLeague", event.target.checked)} />
        </SettingField>
        <SettingField label="Märkte"
          hint="Abgewählte Märkte werden gar nicht erst Kandidat. 1X2 liegt bei −39,3 % ROI mit Ø-Quote 6,16 bei behaupteten 50,1 % Trefferchance.">
          <span className="kelly-market-toggles">
            {MARKET_TOGGLES.map(([key, label]) => <label key={key}>
              <input type="checkbox" checked={!settings.disabledMarkets.includes(key)}
                onChange={(event) => set("disabledMarkets", event.target.checked
                  ? settings.disabledMarkets.filter((entry) => entry !== key)
                  : [...settings.disabledMarkets, key])} />
              {label}
            </label>)}
          </span>
        </SettingField>
        <SettingField label="Mehrere Märkte je Spiel">
          <input type="checkbox" checked={settings.allowMultipleMarketsPerGame}
            onChange={(event) => set("allowMultipleMarketsPerGame", event.target.checked)} />
        </SettingField>
        <SettingField label="Game-Risk-Limit">
          <input type="checkbox" checked={settings.enableGameRiskLimit}
            onChange={(event) => set("enableGameRiskLimit", event.target.checked)} />
        </SettingField>
        <NumberField label="Max. Risiko/Spiel (%)" value={settings.maxRiskPerGame} scale={100} min={0} max={100} step={0.5}
          disabled={!settings.enableGameRiskLimit}
          onCommit={(value) => set("maxRiskPerGame", value)} />
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
                title="Fractional Kelly, begrenzt durch Max-Einsatz/Wette und ggf. Game-Risk- und Gesamtrisiko-Skalierung">
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
              <td><strong>{formatEuro(candidate.stake)}</strong>
                {candidate.gameScaleFactor < 1 && <small>Spiel-Limit: {(candidate.gameScaleFactor * 100).toFixed(0)} %</small>}
              </td>
            </tr>)}
            {sorted.length === 0 && <tr><td className="kelly-empty" colSpan={7}>Keine Value-Wetten im aktuellen Markt gefunden</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="kelly-footer">
        <p>{evaluated} Spiele im Markt „{marketLabel}" geprüft · {sorted.length} Kandidat{sorted.length === 1 ? "" : "en"} mit positivem Value</p>
        {(filtered.crossLeague > 0 || filtered.overMaxEdge > 0) && <p>
          Qualitätsfilter: {[
            filtered.crossLeague > 0 ? `${filtered.crossLeague} Cross-League-Partien` : null,
            filtered.overMaxEdge > 0 ? `${filtered.overMaxEdge} Kandidaten über dem Edge-Deckel` : null
          ].filter((entry) => entry !== null).join(" · ")} aussortiert
        </p>}
        <p>Summe Einsätze: <strong>{formatEuro(totalStake)}</strong> von {formatEuro(settings.budget)} Budget
          {scaleFactor < 1 && <> · Einsätze wegen Gesamtrisiko-Limit auf {(scaleFactor * 100).toFixed(0)} % skaliert</>}
        </p>
        {limitedGames.length > 0 && <p>
          Game-Risk-Limit {formatPercent(settings.maxRiskPerGame)} = {formatEuro(limitedGames[0]!.limit)} je Spiel ·{" "}
          {limitedGames.length} Partie{limitedGames.length === 1 ? "" : "n"} begrenzt ·{" "}
          Risiko dieser Partien {formatEuro(limitedGames.reduce((sum, game) => sum + game.stakeBefore, 0))} →{" "}
          <strong>{formatEuro(limitedGames.reduce((sum, game) => sum + game.stakeAfter, 0))}</strong>
        </p>}
        <p className="kelly-hint">Kelly setzt kalibrierte Wahrscheinlichkeiten voraus – die Modellwerte sind Schätzungen, keine Garantien. Fractional Kelly reduziert das Risiko bei Fehleinschätzungen.</p>
        <p className="kelly-hint">* „Kelly" zeigt den finalen Einsatzanteil nach Fraktion, Pro-Wette-, Spiel- und Gesamtrisiko-Cap; „Full" darunter ist der ungedeckelte volle Kelly-Wert.</p>
        <p className="kelly-hint">Das Game-Risk-Limit deckelt das Risiko aller Märkte einer Partie gemeinsam, weil sie korreliert sind. Es skaliert die Einsätze einer Partie proportional herunter und verändert die Kelly-Berechnung nicht.</p>
      </div>
    </div>
  </div>;
}
