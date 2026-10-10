import { CaretDown, CaretRight, Calculator, DownloadSimple, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { formatOdd, formatPercent, sortStateLabel } from "./App";
import { TEST_RUN_SETTINGS, buildKellyExport, kellyExportFileName, stakeSlots, type KellyCandidate, type KellySelection, type KellySettings } from "./kelly";
import { formatPoints, formatRoi, type MarketProfileState } from "./marketProfile";
import type { DashboardMarketKey, MarketProfile } from "./types";

export function KellyButton({ onOpen }: { onOpen(): void }) {
  // Heißt wie der Dialog, den er öffnet.
  return <button className="kelly-trigger" aria-label="Kelly-Auswahl öffnen" title="Kelly-Auswahl" onClick={onOpen}>
    <Calculator size={15} weight="bold" /> Kelly-Auswahl
  </button>;
}

export function formatEuro(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

export function formatSignedEuro(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} €`;
}

const FRACTION_LABELS: Record<string, string> = {
  "1": "Full Kelly", "0.5": "1/2 Kelly", "0.25": "1/4 Kelly", "0.125": "1/8 Kelly"
};

export function fractionLabel(fraction: number): string {
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
// Exportiert, weil der Quickpicker dieselbe Zeile braucht: Zwei Kopien wären der Anfang
// zweier auseinanderlaufender Hausstile.
export function SettingField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
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
export function NumberField({ label, hint, value, scale = 1, min, max, step, disabled, onCommit }: {
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
  if (!Number.isFinite(plaetze)) return "Ohne Höchst- und Mindesteinsatz gibt es keine Grenze für die Zahl der Wetten.";
  // Das Budget kürzt sich nur heraus, solange der Höchsteinsatz je Wette über dem Mindesteinsatz
  // liegt. Darunter (ab Werk unter rund 32 €) begrenzt der Mindesteinsatz die Zahl.
  const budgetMatters = settings.minStake > 0 && settings.budget * settings.maxStakePercent < settings.minStake;
  return `So viele Wetten passen in deinen Rahmen: rund ${plaetze}`
    + `${hoechstens > plaetze ? `, höchstens ${hoechstens} beim kleinsten Einsatz` : ""}.`
    + (budgetMatters
      ? " Bei deinem Budget begrenzt der Mindesteinsatz die Zahl."
      : " Wie groß dein Budget ist, spielt dafür keine Rolle – nur das Verhältnis der beiden"
        + " Prozentwerte.");
}

/**
 * Die Korrektur, die bei den gewählten Wetten eines Marktes tatsächlich angewandt wurde - als
 * Wert oder Spanne. Bis 06.10.2026 stand hier die Abweichung des ganzen Marktes: Bei BTTS Nein
 * „−3,7“, während die gewählten Wetten um +2,8 Punkte angehoben wurden.
 */
function appliedCorrection(candidates: KellyCandidate[], marketKey: string): string | null {
  const biases = candidates
    .filter((candidate) => candidate.marketKey === marketKey && candidate.calibrationBias !== null)
    .map((candidate) => candidate.calibrationBias!);
  if (biases.length === 0) return null;
  const low = Math.min(...biases);
  const high = Math.max(...biases);
  return Math.abs(high - low) < 0.0005 ? formatPoints(low) : `${formatPoints(low)} bis ${formatPoints(high)}`;
}

/**
 * Fast die ganze Liste aus einem Markt, dessen Chancen nach oben korrigiert wurden: Ein
 * gemeinsamer Fehler des Modells träfe dann fast alle Wetten zugleich. Davids Entscheidung vom
 * 06.10.2026: nur benennen, die Auswahl nicht ändern.
 */
export function concentrationNotice(candidates: KellyCandidate[]): string | null {
  if (candidates.length < 4) return null;
  const counts = new Map<string, KellyCandidate[]>();
  for (const candidate of candidates) {
    counts.set(candidate.marketKey, [...(counts.get(candidate.marketKey) ?? []), candidate]);
  }
  const [, largest] = [...counts].sort((left, right) => right[1].length - left[1].length)[0]!;
  if (largest.length * 2 <= candidates.length) return null;
  const raised = largest.filter((candidate) => (candidate.calibrationBias ?? 0) > 0).length;
  if (raised * 2 <= largest.length) return null;
  return `${largest.length} von ${candidates.length} Wetten sind ${largest[0]!.marketLabel}, und ihre Chance`
    + " wurde nach oben korrigiert. Liegt das Modell dort falsch, trifft es fast alle Wetten zugleich.";
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
    {/* Die Grundmenge ist `playable`: Nur Spiele mit Vorteil gehen in die Korrektur ein. Bis
        06.10.2026 stand hier `observations`, rund das Viereinhalbfache. */}
    <p className="kelly-auto-lead">
      Die Auswahl rechnet nicht mit dem, was das Modell verspricht, sondern mit dem, was in
      {" "}{profile.playable.toLocaleString("de-DE")} alten Spielen mit Vorteil wirklich
      eingetreten ist. Du stellst nur dein Budget und die Wettarten ein.
    </p>

    {active.length > 0 && <p className="kelly-auto-chips">
      <span className="kelly-auto-label">Gespielt wird</span>
      {active.map((entry) => {
        const applied = appliedCorrection(candidates, entry.marketKey);
        return <span key={entry.marketKey} className="kelly-auto-chip"
          title="So weit wurde die Chance bei diesen Wetten verschoben">
          {entry.marketLabel}{applied !== null && <> <small>{applied}</small></>}
        </span>;
      })}
    </p>}

    {idle.length > 0 && <p className="kelly-auto-chips">
      <span className="kelly-auto-label">Nichts gefunden in</span>
      {idle.map((entry) => <span key={entry.marketKey} className="kelly-auto-chip kelly-auto-chip-idle"
        title={`Eingetreten: ${(entry.metrics.hitRate * 100).toFixed(1)} %, vorhergesagt: ${(entry.metrics.predicted * 100).toFixed(1)} %, aus ${entry.metrics.n} alten Spielen mit Vorteil · Gewinn ${formatRoi(entry.metrics.roi)}`}>
        {entry.marketLabel}
      </span>)}
    </p>}

    <Disclosure open={showDetail} onToggle={() => setShowDetail((value) => !value)}
      label="Woher die Korrektur kommt" openLabel="Weniger anzeigen" />
    {showDetail && <p className="kelly-auto-detail">
      An alten Spielen geprüft, die die Korrektur nicht kannte, liegt diese Auswahl im Minus –
      rechne nicht mit Gewinn. Ihre Wetten trafen nur so oft, wie die Tipico-Quote ohne Aufschlag
      es erwarten ließ. Die Korrektur senkt die Chancen zwar, aber nicht genug: Wer gezielt die
      Spiele nimmt, bei denen das Modell mehr sieht als die Quote, erwischt gerade seine
      Ausrutscher. Auf Dauer kostet das etwa den Aufschlag.
    </p>}
  </div>;
}

/**
 * Warum die Automatik gerade nicht rechnet. Drei Fälle, weil sie Verschiedenes bedeuten: Beim
 * Laden kommt sie gleich, ein Fehler hat einen Grund, und ohne abgerechnete Spiele gibt es
 * schlicht nichts zu messen. Früher sahen alle drei gleich aus.
 */
export function kellyProfileNote(auto: boolean, profileState: MarketProfileState): string | null {
  if (!auto || profileState.profile !== null) return null;
  if (profileState.status === "loading" || profileState.status === "idle") return "Automatik wird geladen …";
  if (profileState.message) return `Manuell – ${profileState.message}`;
  return "Manuell – für die Automatik fehlen abgerechnete Spiele.";
}

export function KellyDialog({ selection, profileState, marketFilter, marketLabel, settings, auto, onAutoChange, onSettingsChange, onClose }: {
  /** Die Auswahl aus dem Dashboard - dieselbe Rechnung, die die Kelly-Zeile zählt. */
  selection: KellySelection;
  /** Die gemessene Historie. Fehlt sie, bleibt nur der manuelle Modus. */
  profileState: MarketProfileState;
  marketFilter: "all" | DashboardMarketKey;
  marketLabel: string;
  settings: KellySettings;
  auto: boolean;
  onAutoChange(auto: boolean): void;
  onSettingsChange(settings: KellySettings): void;
  onClose(): void;
}) {
  const [sortKey, setSortKey] = useState<KellySortKey>("stake");
  const [sortDirection, setSortDirection] = useState<1 | -1>(-1);
  const [showSettings, setShowSettings] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);

  const profile = profileState.profile;
  const { automatic, effectiveSettings, candidates, evaluated, scaleFactor, gameRiskLimits, filtered } = selection;
  const profileNote = kellyProfileNote(auto, profileState);
  // Solange das Marktprofil lädt, stünden sonst kurz manuelle Beträge da, die gleich umspringen.
  const loading = auto && profile === null && (profileState.status === "loading" || profileState.status === "idle");
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
  const sortHead = (key: KellySortKey, label: string, title?: string) =>
    <button onClick={() => sort(key)} title={title} aria-label={sortStateLabel(label, sortKey === key, sortDirection)}>
      {label} {arrow(key)}
    </button>;

  const { totalStake, expected, slots } = selection;
  const set = <K extends keyof KellySettings>(key: K, value: KellySettings[K]) =>
    onSettingsChange({ ...settings, [key]: value });
  const marketToggles = <SettingField label="Märkte"
    hint="Abgewählte Wettarten kommen gar nicht erst in die Auswahl. Der Sieger-Tipp (1X2) schnitt geprüft am schlechtesten ab.">
    <span className="kelly-market-toggles">
      {MARKET_TOGGLES.map(([key, label]) => <label key={key}>
        <input type="checkbox" checked={!settings.disabledMarkets.includes(key)}
          onChange={(event) => set("disabledMarkets", event.target.checked
            ? settings.disabledMarkets.filter((entry) => entry !== key)
            : [...settings.disabledMarkets, key])} />
        {label}
      </label>)}
    </span>
  </SettingField>;

  // Exportiert die ganze Auswahl in der Reihenfolge des Dashboards - immer über den Umfang,
  // nie über die Zeilen, die ein Tabellenfilter übrig lässt: Der Testbetrieb verlangt, dass
  // nichts von Hand aussortiert ist (docs/kelly-testbetrieb.md).
  const exportList = () => downloadJson(
    kellyExportFileName(marketFilter),
    buildKellyExport({ candidates, evaluated, scaleFactor, gameRiskLimits },
      { marketFilter, marketLabel, settings: effectiveSettings })
  );

  // Der Einsatzrahmen steht auch in der Automatik in der Kopfzeile, obwohl sie ihn nicht
  // setzt: Er wird aus der manuellen Einstellung geerbt und blieb dadurch unsichtbar - in den
  // Läufen bis zum 15.09.2026 stand er auf 100 % statt der Vorgabe 25 %, ohne dass es
  // irgendwo aufgefallen wäre. Dazu die Zahl der Plätze, weil der Prozentsatz allein seine
  // Wirkung als Stückzahlgrenze nicht verrät.
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
  if (filtered.crossLeague > 0) notices.push(`${filtered.crossLeague} Spiele zwischen verschiedenen Ligen aussortiert`);
  if (filtered.overMaxEdge > 0) notices.push(`${filtered.overMaxEdge} Auswahlen über dem höchsten Vorteil (Edge) aussortiert`);
  if (filtered.belowMinStake > 0) {
    // Maßgeblich ist die Zahl der Plätze am Höchsteinsatz, nicht am Mindesteinsatz: Die
    // meisten Auswahlen sitzen am Deckel. Die frühere Anzeige nannte allein die optimistische
    // Grenze und war damit rund doppelt so groß wie die, die tatsächlich bindet.
    notices.push(`${filtered.belowMinStake} weitere Auswahlen mit Vorteil passten nicht mehr in den Einsatzrahmen`
      + ` – bei ${formatPercent(settings.maxStakePercent)} je Wette und ${formatPercent(settings.maxExposurePercent)}`
      + ` Rahmen passen rund ${slots.plaetze} Wetten hinein`
      + (slots.hoechstens > slots.plaetze
        ? `, höchstens ${slots.hoechstens} zum Mindesteinsatz von ${formatEuro(settings.minStake)}`
        : ""));
  }
  if (filtered.overGameLimit > 0) {
    notices.push(`${filtered.overGameLimit} weitere Auswahlen hätten zum Mindesteinsatz von`
      + ` ${formatEuro(settings.minStake)} die Grenze je Spiel überschritten und fallen weg`);
  }
  if (scaleFactor < 1) notices.push(`Gesamtrisiko-Limit erreicht – alle Einsätze auf ${(scaleFactor * 100).toFixed(0)} % skaliert`);
  if (limitedGames.length > 0) {
    notices.push(`Grenze je Spiel ${formatPercent(settings.maxRiskPerGame)}`
      + ` (${formatEuro(limitedGames[0]!.limit)}) greift bei ${limitedGames.length}`
      + ` Spiel${limitedGames.length === 1 ? "" : "en"}`);
  }
  const concentration = automatic ? concentrationNotice(candidates) : null;
  if (concentration !== null) notices.push(concentration);
  const partlyEstimated = candidates.some((candidate) => candidate.fairSource === "geschätzt");

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="kelly-dialog" role="dialog" aria-label="Kelly-Auswahl" onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head kelly-head">
        <strong>Kelly-Auswahl <span className="kelly-head-market">{marketLabel}</span></strong>
        <span className="overlay-head-actions">
          <button aria-label="Auswahl als JSON exportieren" title="Auswahl als JSON exportieren"
            disabled={candidates.length === 0} onClick={exportList}><DownloadSimple /></button>
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
          {profileNote && <small className="kelly-mode-note">{profileNote}</small>}
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
          <MetricCard label="Wetten" value={String(candidates.length)}
            note={`aus ${evaluated} geprüften Spielen`}
            title={"Geprüft werden die Spiele aus Zeitraum und Wettbewerben im Filter, samt „Nur"
              + " Ligaspiele“, und der gewählte Markt. Angepfiffene Spiele zählen nie mit. Bewertung und"
              + " Klassenunterschied grenzen nur die Tabelle ein."} />
          {/* Zum fairen Tipico-Preis statt zur Modellchance (seit 06.10.2026, Davids
              Entscheidung): Die gewählten Wetten trafen nachgespielt genau so oft wie dieser
              Preis, die Modellchance versprach rund +10 % bei rund -6 % eingetreten. Neutral,
              nicht grün und nicht rot - es ist eine Rechnung, keine Messung. */}
          <MetricCard label="Auf Dauer" value={formatSignedEuro(expected)}
            title="Gerechnet mit der Chance, die die Tipico-Quote ohne ihren Aufschlag behauptet. Fehlt die Gegenquote, ist der Aufschlag geschätzt."
            note={`zur Tipico-Quote ohne Aufschlag${partlyEstimated ? ", teils geschätzt" : ""}.`
              + " Das Modell trifft geprüft nicht öfter als die Quote."} />
        </div>

        {notices.length > 0 && <ul className="kelly-notices">
          {notices.map((notice) => <li key={notice}>{notice}</li>)}
        </ul>}

        {automatic && profile !== null && <AutoSummary profile={profile} candidates={candidates} />}

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
                <SettingField label="Kelly-Anteil"
                  hint="Wie viel vom rechnerisch vollen Einsatz du tatsächlich setzt. Ein Viertel ist die Vorgabe, weil auch die korrigierte Wahrscheinlichkeit nur eine Schätzung ist.">
                  <select value={settings.kellyFraction} onChange={(event) => set("kellyFraction", Number(event.target.value))}>
                    <option value={1}>Full Kelly</option>
                    <option value={0.5}>1/2 Kelly</option>
                    <option value={0.25}>1/4 Kelly</option>
                    <option value={0.125}>1/8 Kelly</option>
                  </select>
                </SettingField>
                <NumberField label="Höchster Einsatz je Wette (%)" value={settings.maxStakePercent} scale={100} min={0} max={100} step={0.5}
                  hint={stakeSlotHint(settings)}
                  onCommit={(value) => set("maxStakePercent", value)} />
                <NumberField label="Einsatzrahmen (% vom Budget)" value={settings.maxExposurePercent} scale={100} min={0} max={100} step={5}
                  hint={stakeSlotHint(settings)}
                  onCommit={(value) => set("maxExposurePercent", value)} />
                <NumberField label="Mindesteinsatz (€)" value={settings.minStake} min={0} step={0.5}
                  hint="Der kleinste Betrag, den dein Anbieter annimmt. Wäre der berechnete Einsatz kleiner, wird er auf diesen Wert angehoben."
                  onCommit={(value) => set("minStake", value)} />
                <NumberField label="Höchstens … Wetten" value={settings.maxBets ?? 0} min={0} step={1}
                  hint="0 heißt: keine eigene Grenze. Dann zählt nur, wie viele Wetten in deinen Rahmen passen."
                  onCommit={(value) => set("maxBets", value <= 0 ? null : Math.round(value))} />
                {/* Seit 06.10.2026 auch in der Automatik (Davids Entscheidung): Welche Wettarten
                    gespielt werden, ist keine Messgröße. */}
                {marketToggles}
              </div>
            : <div className="kelly-settings-grid">
                <NumberField label="Budget (€)" value={settings.budget} min={0} step={5}
                  onCommit={(value) => set("budget", value)} />
                <NumberField label="Mindestquote" value={settings.minOdds} min={1.01} step={0.05}
                  onCommit={(value) => set("minOdds", value)} />
                <SettingField label="Kelly-Anteil">
                  <select value={settings.kellyFraction} onChange={(event) => set("kellyFraction", Number(event.target.value))}>
                    <option value={1}>Full Kelly</option>
                    <option value={0.5}>1/2 Kelly</option>
                    <option value={0.25}>1/4 Kelly</option>
                    <option value={0.125}>1/8 Kelly</option>
                  </select>
                </SettingField>
                <NumberField label="Höchster Einsatz je Wette (%)" value={settings.maxStakePercent} scale={100} min={0} max={100} step={0.5}
                  onCommit={(value) => set("maxStakePercent", value)} />
                <NumberField label="Einsatzrahmen (% vom Budget)" value={settings.maxExposurePercent} scale={100} min={0} max={100} step={1}
                  onCommit={(value) => set("maxExposurePercent", value)} />
                <NumberField label="Mindest-Vorteil (Edge, Prozentpunkte)" value={settings.minEdge} scale={100} min={0} step={0.5}
                  onCommit={(value) => set("minEdge", value)} />
                <SettingField label="Vorteil begrenzen"
                  hint="Begrenzt, wie viel Vorteil (Edge) eine Wette höchstens behaupten darf. Geprüft gilt: Je größer der behauptete Vorteil, desto stärker überschätzt sich das Modell. Ein sehr hoher Wert ist ein Warnzeichen, kein guter Fund.">
                  <input type="checkbox" checked={settings.maxEdge !== null}
                    aria-label="Vorteil begrenzen aktiv"
                    onChange={(event) => set("maxEdge", event.target.checked ? 0.12 : null)} />
                </SettingField>
                <NumberField label="Höchster Vorteil (Edge, Prozentpunkte)" value={settings.maxEdge ?? 0.12} scale={100} min={0} step={0.5}
                  disabled={settings.maxEdge === null}
                  onCommit={(value) => set("maxEdge", value)} />
                <NumberField label="Mindest-Datenvertrauen (%)" value={settings.minConfidence} min={0} max={100} step={5}
                  hint="Wie verlässlich die Daten zu einem Spiel mindestens sein müssen. 0 schaltet es aus. Nur ab 95 % war das Ergebnis nicht durchgehend negativ."
                  onCommit={(value) => set("minConfidence", value)} />
                <SettingField label="Spiele zwischen Ligen weglassen"
                  hint="Spiele zwischen Mannschaften aus verschiedenen Ligen, etwa im Pokal oder in Europa. Die liefen geprüft deutlich schlechter als Spiele innerhalb einer Liga.">
                  <input type="checkbox" checked={settings.excludeCrossLeague}
                    onChange={(event) => set("excludeCrossLeague", event.target.checked)} />
                </SettingField>
                {marketToggles}
                <SettingField label="Mehrere Märkte je Spiel">
                  <input type="checkbox" checked={settings.allowMultipleMarketsPerGame}
                    onChange={(event) => set("allowMultipleMarketsPerGame", event.target.checked)} />
                </SettingField>
                <SettingField label="Grenze je Spiel"
                  hint="Begrenzt, wie viel Geld insgesamt auf ein einzelnes Spiel läuft, wenn dort mehrere Wetten liegen.">
                  <input type="checkbox" checked={settings.enableGameRiskLimit}
                    onChange={(event) => set("enableGameRiskLimit", event.target.checked)} />
                </SettingField>
                <NumberField label="Grenze je Spiel (% vom Budget)" value={settings.maxRiskPerGame} scale={100} min={0} max={100} step={0.5}
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

        {/* Die Wetten stehen hier und nicht in der Übersicht (Davids Entscheidung vom 29.09.2026):
            Die Tabelle bleibt zum Finden da, die Einsatzplanung hat ihr eigenes Fenster. */}
        <div className="kelly-table-wrap">
          <table className="kelly-table">
            <thead>
              <tr>
                <th>{sortHead("team", "Spiel")}</th>
                <th>{sortHead("market", "Markt")}</th>
                <th>{sortHead("odds", "Quote")}</th>
                <th>{sortHead("probability", "Modell", "Wahrscheinlichkeit laut Modell")}</th>
                {automatic && <th>{sortHead("calibrated", "Korrigiert",
                  "Die Chance laut Modell, verschoben um das, worum es sich bei dieser Wettart und diesem Vorteil bisher verschätzt hat – meist nach unten, manchmal nach oben. Mit diesem Wert rechnet der Einsatz.")}</th>}
                <th>{sortHead("edge", "Vorteil",
                  "Vorteil (Value): wie viel höher das Modell die Chance sieht, als die Quote hergibt, in Prozentpunkten. Je größer, desto eher ein Fehler des Modells.")}</th>
                <th>{sortHead("kelly", "Kelly", "Anteil vom Budget nach allen deinen Grenzen; darunter der Wert ohne Grenzen")}</th>
                <th>{sortHead("stake", "Einsatz")}</th>
              </tr>
            </thead>
            <tbody>
              {!loading && sorted.map((candidate) => <tr key={`${candidate.fixtureId}:${candidate.marketKey}`}>
                <td><strong>{candidate.homeTeam} – {candidate.awayTeam}</strong><small>{candidate.country} · {candidate.league}</small></td>
                <td><strong>{candidate.marketLabel}</strong><small>{candidate.selection}</small></td>
                <td>{formatOdd(candidate.odds)}</td>
                <td>{formatPercent(candidate.probability)}</td>
                {automatic && <td className="kelly-calibrated">
                  <strong>{candidate.calibratedProbability === null ? "–" : formatPercent(candidate.calibratedProbability)}</strong>
                  {candidate.calibrationBias !== null && <small>{formatPoints(candidate.calibrationBias)}</small>}
                </td>}
                <td className="kelly-edge">
                  <strong>{formatPoints(candidate.edge)}</strong>
                  {automatic && candidate.calibratedEdge !== null && <small>nach Korr. {formatPoints(candidate.calibratedEdge)}</small>}
                </td>
                <td><strong>{formatPercent(candidate.stakePercent)}</strong><small>ohne Grenzen: {formatPercent(candidate.fullKelly)}</small></td>
                <td className="kelly-stake"><strong>{formatEuro(candidate.stake)}</strong>
                  {candidate.gameScaleFactor < 1 && <small>Grenze je Spiel: {(candidate.gameScaleFactor * 100).toFixed(0)} %</small>}
                </td>
              </tr>)}
              {(loading || sorted.length === 0) && <tr><td className="kelly-empty" colSpan={automatic ? 8 : 7}>
                {loading ? "Automatik wird geladen …" : "Keine Wette in der Auswahl für diesen Markt."}
              </td></tr>}
            </tbody>
          </table>
        </div>

        <Disclosure open={showGlossary} onToggle={() => setShowGlossary((value) => !value)}
          label="Was bedeuten diese Zahlen?" openLabel="Weniger anzeigen" />
        {showGlossary && <dl className="kelly-glossary">
          <div>
            <dt>Kelly</dt>
            <dd>ein Rechenweg, der aus Quote und Trefferchance den passenden Einsatz bestimmt.
              In der Liste steht der Einsatz, der nach allen deinen Grenzen übrig bleibt;
              „ohne Grenzen“ darunter ist der Wert ohne sie</dd>
          </div>
          <div>
            <dt>Korrigiert</dt>
            <dd>die Chance, die das Modell nennt, verschoben um das, worum es sich bei dieser
              Wettart und diesem Vorteil bisher verschätzt hat – meist nach unten, manchmal nach
              oben. Gerechnet wird mit diesem Wert</dd>
          </div>
          <div>
            <dt>Auf Dauer</dt>
            <dd>was die Liste im Schnitt einbringt, wenn die Tipico-Quote ohne ihren Aufschlag
              die richtige Chance nennt. An alten Spielen geprüft trafen die gewählten Wetten
              genau so oft – deshalb steht hier fast immer ein Minus</dd>
          </div>
          <div>
            <dt>Grenze je Spiel</dt>
            <dd>begrenzt, wie viel Geld insgesamt auf ein einzelnes Spiel läuft, wenn du dort
              mehrere Wetten hast. Verkleinert nur die Einsätze, ändert nichts an der Rechnung</dd>
          </div>
          <div>
            <dt>Grenzen</dt>
            <dd>die Rechnung setzt voraus, dass die Chancen stimmen. Sie sind aber nur
              geschätzt – deshalb setzt du nur einen Teil des errechneten Einsatzes</dd>
          </div>
        </dl>}
      </div>
    </div>
  </div>;
}
