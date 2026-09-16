import { CaretDown, CaretRight, Calculator, DownloadSimple, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { formatOdd, formatPercent, sortStateLabel } from "./App";
import { TEST_RUN_SETTINGS, buildKellyExport, computeKellyCandidates, expectedValueOf, kellyExportFileName, recommendedSettings, stakeSlots, type KellyCandidate, type KellySettings } from "./kelly";
import { formatPoints, formatRoi } from "./marketProfile";
import type { DashboardFixture, DashboardMarketKey, MarketProfile } from "./types";

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

function formatSignedEuro(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} €`;
}

const FRACTION_LABELS: Record<string, string> = {
  "1": "Full Kelly", "0.5": "1/2 Kelly", "0.25": "1/4 Kelly", "0.125": "1/8 Kelly"
};

function fractionLabel(fraction: number): string {
  return FRACTION_LABELS[String(fraction)] ?? `${fraction}× Kelly`;
}

type KellySortKey = "team" | "market" | "odds" | "probability" | "calibrated" | "edge" | "kelly" | "stake";

function sortValue(candidate: KellyCandidate, key: KellySortKey): number | string {
  if (key === "team") return `${candidate.homeTeam} ${candidate.awayTeam}`;
  if (key === "market") return candidate.marketLabel;
  if (key === "odds") return candidate.odds;
  if (key === "probability") return candidate.probability;
  if (key === "calibrated") return candidate.calibratedProbability ?? candidate.probability;
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
  ["bttsNo", "BTTS Nein"],
  ["over15", "Ü1,5"],
  ["under15", "U1,5"],
  ["over25", "Ü2,5"],
  ["under25", "U2,5"],
  ["over35", "Ü3,5"],
  ["under35", "U3,5"],
  ["firstHalfOver05", "HZ Ü0,5"],
  ["firstHalfUnder05", "HZ U0,5"],
  ["firstHalfOver15", "HZ Ü1,5"],
  ["firstHalfUnder15", "HZ U1,5"]
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

/** Die drei Zahlen, wegen derer der Dialog geöffnet wird - lesbar statt im Fließtext. */
/**
 * Erklärt den Einsatzrahmen über das, was er tatsächlich bewirkt. Der Prozentsatz allein
 * verrät nicht, dass er zusammen mit dem Höchsteinsatz die Stückzahl festlegt - und genau
 * diese Wirkung blieb in den Läufen bis zum 15.09.2026 unbemerkt.
 */
function stakeSlotHint(settings: KellySettings): string {
  const { plaetze, hoechstens } = stakeSlots(settings);
  if (!Number.isFinite(plaetze)) return "Ohne Höchsteinsatz und Mindesteinsatz gibt es keine Stückzahlgrenze.";
  return `Einsatzrahmen geteilt durch Höchsteinsatz ergibt die Stückzahl: rund ${plaetze} Wetten`
    + ` passen hinein${hoechstens > plaetze ? `, höchstens ${hoechstens} zum Mindesteinsatz` : ""}.`
    + " Das Budget kürzt sich dabei heraus - für die Stückzahl zählt allein das Verhältnis"
    + " der beiden Prozentsätze.";
}

function MetricCard({ label, value, note, tone, title }: {
  label: string;
  value: string;
  note: string;
  tone?: "good" | "bad";
  title?: string;
}) {
  return <div className="kelly-metric" title={title}>
    <span className="kelly-metric-label">{label}</span>
    <strong className={tone === undefined ? "kelly-metric-value" : `kelly-metric-value kelly-metric-${tone}`}>{value}</strong>
    <span className="kelly-metric-note">{note}</span>
  </div>;
}

/** Ein Textbutton, der einen erklärenden Abschnitt auf- und zuklappt. */
function Disclosure({ open, onToggle, label, openLabel }: {
  open: boolean;
  onToggle(): void;
  label: string;
  openLabel: string;
}) {
  return <button className="kelly-disclosure" aria-expanded={open} onClick={onToggle}>
    {open ? openLabel : label}
  </button>;
}

/**
 * Kopfzeile der Automatik: was gerade gespielt wird und was nicht.
 *
 * Der Abschnitt ist bewusst ausführlich. Eine Liste, die ohne Begründung weniger Wetten
 * zeigt als der manuelle Modus, wirkt kaputt - erst die Zahl dahinter macht sie
 * nachvollziehbar. Die Einordnung, wie belastbar die Korrektur ist, steht dagegen hinter
 * einem Aufklapper: Sie ist beim ersten Blick nicht nötig, beim zweiten aber wichtig.
 */
function AutoSummary({ profile, candidates }: { profile: MarketProfile; candidates: KellyCandidate[] }) {
  const [showDetail, setShowDetail] = useState(false);
  const chosen = new Set<string>(candidates.map((candidate) => candidate.marketKey));
  const active = profile.markets.filter((entry) => chosen.has(entry.marketKey));
  const idle = profile.markets.filter((entry) => !chosen.has(entry.marketKey));

  return <div className="kelly-auto">
    <p className="kelly-auto-lead">
      Die Auswahl rechnet nicht mit der Modellwahrscheinlichkeit, sondern mit dem, was der
      jeweilige Markt in {profile.observations.toLocaleString("de-DE")} abgerechneten Zeilen
      wirklich erreicht hat. Du stellst nur das Budget ein.
    </p>

    {active.length > 0 && <p className="kelly-auto-chips">
      <span className="kelly-auto-label">Gespielt wird</span>
      {active.map((entry) => <span key={entry.marketKey} className="kelly-auto-chip">
        {entry.marketLabel} <small>{formatPoints(entry.metrics.bias)}</small>
      </span>)}
    </p>}

    {idle.length > 0 && <p className="kelly-auto-chips">
      <span className="kelly-auto-label">Nichts gefunden in</span>
      {idle.map((entry) => <span key={entry.marketKey} className="kelly-auto-chip kelly-auto-chip-idle"
        title={`${(entry.metrics.hitRate * 100).toFixed(1)} % eingetreten bei ${(entry.metrics.predicted * 100).toFixed(1)} % Prognose über ${entry.metrics.n} Fälle · Ertrag ${formatRoi(entry.metrics.roi)}`}>
        {entry.marketLabel}
      </span>)}
    </p>}

    <Disclosure open={showDetail} onToggle={() => setShowDetail((value) => !value)}
      label="Wie die Korrektur zustande kommt" openLabel="Weniger anzeigen" />
    {showDetail && <p className="kelly-auto-detail">
      In der Rückrechnung auf Ergebnisse, die die Korrektur nicht kannte, lag diese Auswahl an
      drei Trennstellen bei −0,2 bis +2,6 %, die frühere Vorgabe bei −5,1 bis −7,2 %. Die
      Streuung beträgt dabei rund ±5 Prozentpunkte – der Abstand ist also etwa ein Sigma.
      Ohne den Remis-Markt steht die Auswahl bei −2,5 bis −4,0 %, ihr ganzer Vorsprung hängt
      an diesem einen Markt, und der steht in der Prüfhälfte auf 24 Wetten. Sie ist damit
      messbar weniger verlustreich als vorher, aber nicht als gewinnbringend nachgewiesen.
    </p>}
  </div>;
}

export function KellyDialog({ fixtures, marketFilter, marketLabel, settings, profile, auto, onAutoChange, onSettingsChange, onClose }: {
  fixtures: DashboardFixture[];
  marketFilter: "all" | DashboardMarketKey;
  marketLabel: string;
  settings: KellySettings;
  /** Die gemessene Historie. Fehlt sie, bleibt nur der manuelle Modus. */
  profile: MarketProfile | null;
  auto: boolean;
  onAutoChange(auto: boolean): void;
  onSettingsChange(settings: KellySettings): void;
  onClose(): void;
}) {
  const [sortKey, setSortKey] = useState<KellySortKey>("stake");
  const [sortDirection, setSortDirection] = useState<1 | -1>(-1);
  const [showSettings, setShowSettings] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);

  // Ohne Profil ist die Automatik nicht moeglich - dann bleibt der Dialog manuell, statt eine
  // Empfehlung vorzutaeuschen, hinter der keine Messung steht.
  const automatic = auto && profile !== null;
  const effectiveSettings = automatic ? recommendedSettings(settings) : settings;
  const { candidates, evaluated, scaleFactor, gameRiskLimits, filtered } =
    computeKellyCandidates(fixtures, marketFilter, effectiveSettings, automatic ? profile : null);
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
  const expected = expectedValueOf(sorted);
  const set = <K extends keyof KellySettings>(key: K, value: KellySettings[K]) =>
    onSettingsChange({ ...settings, [key]: value });

  // Exportiert die Liste genau so, wie sie gerade gefiltert und sortiert angezeigt wird.
  const exportList = () => downloadJson(
    kellyExportFileName(marketFilter),
    buildKellyExport({ candidates: sorted, evaluated, scaleFactor, gameRiskLimits },
      { marketFilter, marketLabel, settings: effectiveSettings })
  );

  // Der Einsatzrahmen steht auch in der Automatik in der Kopfzeile, obwohl sie ihn nicht
  // setzt: Er wird aus der manuellen Einstellung geerbt und blieb dadurch unsichtbar - in den
  // Läufen bis zum 15.09.2026 stand er auf 100 % statt der Vorgabe 25 %, ohne dass es
  // irgendwo aufgefallen wäre. Dazu die Zahl der Plätze, weil der Prozentsatz allein seine
  // Wirkung als Stückzahlgrenze nicht verrät.
  const slots = stakeSlots(settings);
  const slotLabel = Number.isFinite(slots.plaetze) ? `≈ ${slots.plaetze} Plätze` : "ohne Grenze";
  const isTestRun = (Object.keys(TEST_RUN_SETTINGS) as Array<keyof typeof TEST_RUN_SETTINGS>)
    .every((key) => settings[key] === TEST_RUN_SETTINGS[key]);
  const settingsSummary = automatic
    ? `Budget ${formatEuro(settings.budget)} · ${fractionLabel(settings.kellyFraction)}`
      + ` · ${formatPercent(settings.maxExposurePercent)} Einsatzrahmen (${slotLabel})`
      + (settings.maxBets === null ? "" : ` · höchstens ${settings.maxBets} Wetten`)
    : `Budget ${formatEuro(settings.budget)} · Quote ab ${formatOdd(settings.minOdds)}`
      + ` · max. ${formatPercent(settings.maxStakePercent)} je Wette`
      + ` · ${formatPercent(settings.maxExposurePercent)} gesamt (${slotLabel})`;

  const notices: string[] = [];
  if (filtered.crossLeague > 0) notices.push(`${filtered.crossLeague} Cross-League-Partien aussortiert`);
  if (filtered.overMaxEdge > 0) notices.push(`${filtered.overMaxEdge} Kandidaten über dem Edge-Deckel aussortiert`);
  if (filtered.belowMinStake > 0) {
    // Maßgeblich ist die Zahl der Plätze am Höchsteinsatz, nicht am Mindesteinsatz: Die
    // meisten Auswahlen sitzen am Deckel. Die frühere Anzeige nannte allein die optimistische
    // Grenze und war damit rund doppelt so groß wie die, die tatsächlich bindet.
    notices.push(`${filtered.belowMinStake} weitere Auswahlen mit Value passten nicht mehr in den Einsatzrahmen`
      + ` – bei ${formatPercent(settings.maxStakePercent)} je Wette und ${formatPercent(settings.maxExposurePercent)}`
      + ` Rahmen passen rund ${slots.plaetze} Wetten hinein`
      + (slots.hoechstens > slots.plaetze
        ? `, höchstens ${slots.hoechstens} zum Mindesteinsatz von ${formatEuro(settings.minStake)}`
        : ""));
  }
  if (scaleFactor < 1) notices.push(`Gesamtrisiko-Limit erreicht – alle Einsätze auf ${(scaleFactor * 100).toFixed(0)} % skaliert`);
  if (limitedGames.length > 0) {
    notices.push(`Game-Risk-Limit ${formatPercent(settings.maxRiskPerGame)}`
      + ` (${formatEuro(limitedGames[0]!.limit)} je Spiel) greift bei ${limitedGames.length}`
      + ` Partie${limitedGames.length === 1 ? "" : "n"}`);
  }

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="kelly-dialog" role="dialog" aria-label="Kelly-Kriterium" onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head kelly-head">
        <strong>Kelly-Kriterium <span className="kelly-head-market">{marketLabel}</span></strong>
        <span className="overlay-head-actions">
          <button aria-label="Liste als JSON exportieren" title="Liste als JSON exportieren"
            disabled={sorted.length === 0} onClick={exportList}><DownloadSimple /></button>
          <button aria-label="Schließen" onClick={onClose}><X /></button>
        </span>
      </div>

      <div className="kelly-body">
        <div className="kelly-mode">
          <div className="kelly-mode-switch" role="group" aria-label="Auswahlmodus">
            <button className={automatic ? "active" : ""} aria-pressed={automatic}
              disabled={profile === null}
              title={profile === null ? "Es sind noch keine Partien abgerechnet" : "Auswahl aus der eigenen Historie"}
              onClick={() => onAutoChange(true)}>Automatik</button>
            <button className={automatic ? "" : "active"} aria-pressed={!automatic}
              onClick={() => onAutoChange(false)}>Manuell</button>
          </div>
          {auto && profile === null && <small className="kelly-mode-note">
            Für die Automatik fehlen abgerechnete Partien – es gilt die manuelle Einstellung.
          </small>}
          {/*
            Ein Knopf statt einer Liste in einem Dokument: Die Messung der alten Kette ist
            daran gescheitert, dass eine einzelne Einstellung im Browser still abwich.
          */}
          <button className="kelly-preset" disabled={isTestRun}
            title={isTestRun
              ? "Die Einstellungen entsprechen bereits dem Testbetrieb."
              : "Budget 100 €, 1/4 Kelly, 2 % je Wette, 70 % Einsatzrahmen, 1 € Mindesteinsatz"
                + " – der Rahmen ist bewusst weit, damit er die Auswahl nicht abschneidet."}
            onClick={() => onSettingsChange({ ...settings, ...TEST_RUN_SETTINGS })}>
            {isTestRun ? "Testbetrieb aktiv" : "Testbetrieb übernehmen"}
          </button>
        </div>

        <div className="kelly-metrics">
          <MetricCard label="Einsatz gesamt" value={formatEuro(totalStake)}
            note={`von ${formatEuro(settings.budget)} Budget`} />
          <MetricCard label="Wetten" value={String(sorted.length)}
            note={`aus ${evaluated} geprüften Spielen`}
            title="Geprüft wird, was die Ansicht gerade zeigt: Zeitraum, Ligaauswahl und der Cross-League-Schalter aus der Seitenleiste gelten auch hier." />
          <MetricCard label="Erwarteter Ertrag" value={formatSignedEuro(expected)}
            tone={expected >= 0 ? "good" : "bad"}
            note={automatic ? "auf Basis der Korrektur" : "auf Basis der Modellwerte"} />
        </div>

        {notices.length > 0 && <ul className="kelly-notices">
          {notices.map((notice) => <li key={notice}>{notice}</li>)}
        </ul>}

        {automatic && profile !== null && <AutoSummary profile={profile} candidates={sorted} />}

        <section className="kelly-panel">
          <button className="kelly-panel-head" aria-expanded={showSettings}
            onClick={() => setShowSettings((value) => !value)}>
            {showSettings ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
            <strong>Einstellungen</strong>
            <span className="kelly-panel-summary">{settingsSummary}</span>
          </button>

          {showSettings && (automatic
            ? <div className="kelly-settings-grid">
                <NumberField label="Budget (€)" value={settings.budget} min={0} step={5}
                  onCommit={(value) => set("budget", value)} />
                <SettingField label="Kelly-Fraktion"
                  hint="Der Anteil des rechnerisch vollen Einsatzes. Ein Viertel ist die Vorgabe, weil auch die korrigierte Wahrscheinlichkeit eine Schätzung bleibt.">
                  <select value={settings.kellyFraction} onChange={(event) => set("kellyFraction", Number(event.target.value))}>
                    <option value={1}>Full Kelly</option>
                    <option value={0.5}>1/2 Kelly</option>
                    <option value={0.25}>1/4 Kelly</option>
                    <option value={0.125}>1/8 Kelly</option>
                  </select>
                </SettingField>
                <NumberField label="Max. Einsatz/Wette (%)" value={settings.maxStakePercent} scale={100} min={0} max={100} step={0.5}
                  hint={stakeSlotHint(settings)}
                  onCommit={(value) => set("maxStakePercent", value)} />
                <NumberField label="Einsatzrahmen (%)" value={settings.maxExposurePercent} scale={100} min={0} max={100} step={5}
                  hint={stakeSlotHint(settings)}
                  onCommit={(value) => set("maxExposurePercent", value)} />
                <NumberField label="Mindesteinsatz (€)" value={settings.minStake} min={0} step={0.5}
                  hint="Der kleinste Betrag, den ein Wettanbieter annimmt. Liegt der rechnerische Einsatz darunter, wird er angehoben."
                  onCommit={(value) => set("minStake", value)} />
                <NumberField label="Höchstens … Wetten" value={settings.maxBets ?? 0} min={0} step={1}
                  hint="0 = keine eigene Grenze; dann zählt allein, wie viele Wetten in den Einsatzrahmen passen."
                  onCommit={(value) => set("maxBets", value <= 0 ? null : Math.round(value))} />
              </div>
            : <div className="kelly-settings-grid">
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
                <NumberField label="Mindesteinsatz (€)" value={settings.minStake} min={0} step={0.5}
                  hint="0 schaltet die Prüfung ab und verteilt den Einsatzrahmen wie früher auf alle Kandidaten – auch wenn dabei Beträge herauskommen, die kein Anbieter annimmt."
                  onCommit={(value) => set("minStake", value)} />
                <NumberField label="Höchstens … Wetten" value={settings.maxBets ?? 0} min={0} step={1}
                  hint="0 = keine eigene Grenze."
                  onCommit={(value) => set("maxBets", value <= 0 ? null : Math.round(value))} />
              </div>)}
        </section>

        <div className="kelly-table-wrap">
          <table className="kelly-table">
            <thead>
              <tr>
                <th><button onClick={() => sort("team")} aria-label={sortStateLabel("Partie", sortKey === "team", sortDirection)}>Partie {arrow("team")}</button></th>
                <th><button onClick={() => sort("market")} aria-label={sortStateLabel("Markt", sortKey === "market", sortDirection)}>Markt {arrow("market")}</button></th>
                <th><button onClick={() => sort("odds")} aria-label={sortStateLabel("Quote", sortKey === "odds", sortDirection)}>Quote {arrow("odds")}</button></th>
                <th><button onClick={() => sort("probability")} aria-label={sortStateLabel("Modell", sortKey === "probability", sortDirection)}>Modell {arrow("probability")}</button></th>
                {automatic && <th><button onClick={() => sort("calibrated")}
                  aria-label={sortStateLabel("Korrigierte Wahrscheinlichkeit", sortKey === "calibrated", sortDirection)}
                  title="Die Modellwahrscheinlichkeit abzüglich der gemessenen Selbstüberschätzung dieses Marktes. Mit diesem Wert rechnet der Einsatz.">
                  Korrigiert {arrow("calibrated")}
                </button></th>}
                <th><button onClick={() => sort("edge")} aria-label={sortStateLabel("Value", sortKey === "edge", sortDirection)}>Value {arrow("edge")}</button></th>
                <th><button onClick={() => sort("kelly")}
                  aria-label={sortStateLabel("Einsatzanteil nach Caps", sortKey === "kelly", sortDirection)}
                  title="Fractional Kelly, begrenzt durch Max-Einsatz/Wette und ggf. Game-Risk- und Gesamtrisiko-Skalierung">
                  Kelly {arrow("kelly")}
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
                {automatic && <td className="kelly-calibrated">
                  <strong>{candidate.calibratedProbability === null ? "–" : formatPercent(candidate.calibratedProbability)}</strong>
                  {candidate.calibrationBias !== null && <small>{formatPoints(candidate.calibrationBias)}</small>}
                </td>}
                <td className="kelly-edge">
                  {automatic && candidate.calibratedEdge !== null
                    ? <><strong>{formatEdge(candidate.calibratedEdge)}</strong><small>roh {formatEdge(candidate.edge)}</small></>
                    : <strong>{formatEdge(candidate.edge)}</strong>}
                </td>
                <td><strong>{formatPercent(candidate.stakePercent)}</strong><small>Full: {formatPercent(candidate.fullKelly)}</small></td>
                <td className="kelly-stake"><strong>{formatEuro(candidate.stake)}</strong>
                  {candidate.gameScaleFactor < 1 && <small>Spiel-Limit: {(candidate.gameScaleFactor * 100).toFixed(0)} %</small>}
                </td>
              </tr>)}
              {sorted.length === 0 && <tr><td className="kelly-empty" colSpan={automatic ? 8 : 7}>Keine Value-Wetten im aktuellen Markt gefunden.</td></tr>}
            </tbody>
          </table>
        </div>

        <Disclosure open={showGlossary} onToggle={() => setShowGlossary((value) => !value)}
          label="Was bedeuten diese Zahlen?" openLabel="Weniger anzeigen" />
        {showGlossary && <dl className="kelly-glossary">
          <div>
            <dt>Kelly</dt>
            <dd>finaler Einsatzanteil nach Fraktion sowie Pro-Wette-, Spiel- und Gesamtrisiko-Deckel;
              „Full" darunter ist der ungedeckelte Wert</dd>
          </div>
          <div>
            <dt>Korrigiert</dt>
            <dd>Modellwahrscheinlichkeit abzüglich des historischen Bias dieses Marktes; gerechnet
              wird mit diesem Wert</dd>
          </div>
          <div>
            <dt>Game-Risk-Limit</dt>
            <dd>deckelt korrelierte Märkte einer Partie gemeinsam, skaliert Einsätze proportional,
              verändert die Kelly-Berechnung nicht</dd>
          </div>
          <div>
            <dt>Grenzen</dt>
            <dd>Kelly setzt kalibrierte Wahrscheinlichkeiten voraus; Modellwerte sind Schätzungen,
              Fractional Kelly senkt das Risiko bei Fehleinschätzungen</dd>
          </div>
        </dl>}
      </div>
    </div>
  </div>;
}
