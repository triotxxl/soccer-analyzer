import { CaretDown, CaretRight, Funnel, Plus, ShoppingCartSimple, X } from "@phosphor-icons/react";
import { useState } from "react";
import { formatOdd, sortStateLabel } from "./App";
import { NumberField, SettingField } from "./KellyUI";
import {
  QUICKPICK_PRESET_LIST,
  REJECTION_LABELS,
  applyLevel,
  applyQuickpick,
  levelOf,
  presetOf,
  type DavesQuickpickSettings,
  type QuickpickPresetId,
  type QuickpickRejection,
  type QuickpickSettings,
  type UnderdogQuickpickSettings
} from "./quickpick";
import { QUICKPICK_COLUMNS, type QuickpickRow } from "./quickpickColumns";
import type { DashboardFixture } from "./types";

const formatPercent = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const formatSigned = (value: number) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1).replace(".", ",")} %`;


export function QuickpickButton({ active, onOpen }: { active: boolean; onOpen(): void }) {
  return <button className="kelly-trigger quickpick-trigger" aria-pressed={active}
    aria-label="Quickpicker öffnen" title="Quickpicker: Partien nach einer Voreinstellung filtern"
    onClick={onOpen}>
    <Funnel size={15} weight="bold" /> Quickpick
  </button>;
}

/**
 * Zeigt, dass gefiltert wird, und nimmt es mit einem Klick zurück. Ohne diesen Streifen wäre
 * eine stark gekürzte Tabelle von einer leeren Ansetzungsliste nicht zu unterscheiden.
 */
export function QuickpickChip({ label, passed, evaluated, onOpen, onClear }: {
  label: string;
  passed: number;
  evaluated: number;
  onOpen(): void;
  onClear(): void;
}) {
  return <span className="quickpick-chip">
    <button className="quickpick-chip-label" onClick={onOpen}
      title="Quickpicker öffnen">{label} · {passed} von {evaluated}</button>
    <button className="quickpick-chip-clear" aria-label="Quickpick-Filter aufheben"
      title="Filter aufheben" onClick={onClear}><X size={11} weight="bold" /></button>
  </span>;
}

export function QuickpickDialog({
  fixtures, settings, active, onSettingsChange, onPresetChange, onActiveChange, onAddAll, onAddOne, onClose
}: {
  fixtures: DashboardFixture[];
  settings: QuickpickSettings;
  active: boolean;
  onSettingsChange(settings: QuickpickSettings): void;
  onPresetChange(preset: QuickpickPresetId): void;
  onActiveChange(active: boolean): void;
  onAddAll(fixtures: DashboardFixture[]): void;
  onAddOne(row: QuickpickRow): void;
  onClose(): void;
}) {
  const preset = presetOf(settings);
  const columns = QUICKPICK_COLUMNS[preset.id];
  const [sortKey, setSortKey] = useState<string>(preset.defaultSort);
  const [sortDirection, setSortDirection] = useState<1 | -1>(-1);
  const [showSettings, setShowSettings] = useState(false);

  const activeLevel = levelOf(settings);
  const measured = preset.levels.find((entry) => entry.id === activeLevel)?.measured ?? null;
  const kennzahl = preset.kennzahlOf(measured);
  // Ein Schlüssel aus der anderen Voreinstellung darf nicht stehen bleiben.
  const sorter = columns.find((column) => column.key === sortKey)
    ?? columns.find((column) => column.key === preset.defaultSort)
    ?? columns[0]!;

  // Wie im Kelly-Dialog: bei jedem Render neu gerechnet, kein Zwischenspeicher. Die Liste
  // kann dadurch nicht von dem abweichen, was die Tabelle zeigt.
  const { evaluations, report } = applyQuickpick(fixtures, settings);

  const rows: QuickpickRow[] = fixtures
    .map((fixture) => ({ fixture, evaluation: evaluations.get(fixture.fixtureId)! }))
    .filter((row) => row.evaluation.passes);

  const sorted = [...rows].sort((left, right) => {
    const a = sorter.value?.(left) ?? 0;
    const b = sorter.value?.(right) ?? 0;
    const comparison = typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b, "de")
      : Number(a) - Number(b);
    return comparison * sortDirection
      || Date.parse(left.fixture.kickoff) - Date.parse(right.fixture.kickoff);
  });

  const sort = (key: string) => {
    if (key === sortKey) setSortDirection((value) => (value === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDirection(key === "team" ? 1 : -1);
    }
  };
  const arrow = (key: string) => (sortKey === key ? (sortDirection === 1 ? "▲" : "▼") : "");

  // Zwei Setzer statt einem: Auf einer Union ist nur der Durchschnitt der Felder erlaubt,
  // und genau das soll so sein - keine Voreinstellung darf einen Regler der anderen schreiben.
  const setDaves = <K extends keyof DavesQuickpickSettings>(key: K, value: DavesQuickpickSettings[K]) => {
    if (settings.preset !== "daves1x2") return;
    onSettingsChange({ ...settings, [key]: value });
  };
  const setUnderdog = <K extends keyof UnderdogQuickpickSettings>(key: K, value: UnderdogQuickpickSettings[K]) => {
    if (settings.preset !== "underdog") return;
    onSettingsChange({ ...settings, [key]: value });
  };

  const rejections = (Object.entries(report.rejected) as Array<[QuickpickRejection, number]>)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);

  const withOdds = sorted.filter((row) => row.evaluation.odds !== null);
  const comboOdds = withOdds.reduce((product, row) => product * (row.evaluation.odds ?? 1), 1);
  const averageOdds = withOdds.length === 0 ? null
    : withOdds.reduce((sum, row) => sum + (row.evaluation.odds ?? 0), 0) / withOdds.length;

  /** Eine geschätzte Quote darf nicht in den Wettschein - sie ist kein Preis. */
  const estimated = (row: QuickpickRow) => row.evaluation.underdog?.counterSource === "geschätzt"
    && row.evaluation.underdog.counterOdds === row.evaluation.odds;
  const spielbar = sorted.filter((row) => !estimated(row));
  const uebersprungen = sorted.length - spielbar.length;
  const kombis = measured?.kombis ?? [];

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="kelly-dialog quickpick-dialog" role="dialog" aria-label="Quickpicker"
      onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head">
        <strong>Quickpicker</strong>
        <span className="overlay-head-actions">
          <button aria-label="Schließen" onClick={onClose}><X /></button>
        </span>
      </div>

      <div className="kelly-body">
        <div className="quickpick-presets" role="group" aria-label="Voreinstellung">
          {QUICKPICK_PRESET_LIST.map((entry) => <button key={entry.id}
            className={entry.id === preset.id ? "active" : ""}
            aria-pressed={entry.id === preset.id}
            title={entry.description}
            onClick={() => {
              onPresetChange(entry.id);
              setSortKey(entry.defaultSort);
              setSortDirection(-1);
              setShowSettings(false);
            }}>
            <strong>{entry.label}</strong>
          </button>)}
        </div>

        <section className="quickpick-preset" aria-label="Voreinstellung">
          <div className="quickpick-preset-head">
            <div>
              <strong>{preset.label}</strong>
              <p>{preset.description}</p>
            </div>
            <button className={active ? "quickpick-apply active" : "quickpick-apply"}
              aria-pressed={active} onClick={() => onActiveChange(!active)}>
              {active ? "Filter aufheben" : "Filter anwenden"}
            </button>
          </div>
          <ul className="quickpick-criteria">
            {preset.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
          </ul>
        </section>

        <div className="kelly-metrics">
          <div className="kelly-metric">
            <span className="kelly-metric-label">Treffer</span>
            <strong className="kelly-metric-value">{report.passed}</strong>
            <span className="kelly-metric-note">von {report.evaluated} geprüften Partien</span>
          </div>
          <div className="kelly-metric" title={kennzahl.titel}>
            <span className="kelly-metric-label">{kennzahl.label}</span>
            <strong className="kelly-metric-value">{kennzahl.wert}</strong>
            <span className="kelly-metric-note">{kennzahl.notiz}</span>
          </div>
          {preset.wettschein.modus === "kombi"
            ? <div className="kelly-metric" title="Das Produkt aller Quoten in dieser Liste - also die Kombi über sämtliche Treffer.">
                <span className="kelly-metric-label">Kombi aus allen</span>
                <strong className="kelly-metric-value">{withOdds.length === 0 ? "–" : formatOdd(comboOdds)}</strong>
                <span className="kelly-metric-note">{withOdds.length} Beine</span>
              </div>
            : <div className="kelly-metric" title="Durchschnitt der Quoten in dieser Liste.">
                <span className="kelly-metric-label">Quote Ø</span>
                <strong className="kelly-metric-value">{averageOdds === null ? "–" : formatOdd(averageOdds)}</strong>
                <span className="kelly-metric-note">{withOdds.length} Partien</span>
              </div>}
        </div>

        <div className="quickpick-actions">
          {preset.wettschein.modus === "kombi"
            ? <button className="quickpick-cart" disabled={spielbar.length === 0}
                title={preset.wettschein.hinweis}
                onClick={() => onAddAll(spielbar.map((row) => row.fixture))}>
                <ShoppingCartSimple size={14} weight="bold" aria-hidden />
                {spielbar.length === 0 ? "Keine Treffer" : `Alle ${spielbar.length} in den Wettschein`}
              </button>
            : <p className="quickpick-cart-note">{preset.wettschein.hinweis}</p>}
          {uebersprungen > 0 && <small className="quickpick-cart-note">
            {uebersprungen} {uebersprungen === 1 ? "Zeile bleibt" : "Zeilen bleiben"} draußen –
            {" "}gerechnete Quote, kein Preis. Nach dem nächsten Dashboard-Lauf fällt das weg.
          </small>}
        </div>

        {/*
          Die Kombi-Tabelle steht bewusst vor dem Ehrlichkeitsabsatz: Sie ist die Antwort auf
          die Frage, die eine hohe Quote aufwirft - und die Spalte „erwartet" zeigt, dass eine
          Kombi den Ertrag je Bein multipliziert, nicht die Quote.
        */}
        {kombis.length > 0 && <section className="quickpick-kombis" aria-label="Kurze Kombis">
          <strong>Was kurze Kombis aus dieser Stufe gebracht hätten</strong>
          <table>
            <thead>
              <tr>
                <th>Beine</th><th>Quote Ø</th><th>Treffer</th><th>Ertrag</th>
                <th title="Was der Ertrag je Bein verspricht: (1 + Ertrag)^Beine − 1.">erwartet</th>
              </tr>
            </thead>
            <tbody>
              {kombis.map((kombi) => <tr key={kombi.beine}>
                <td>{kombi.beine}</td>
                <td>{kombi.quote.toFixed(1).replace(".", ",")}</td>
                <td>{formatPercent(kombi.trefferquote)}</td>
                <td className={kombi.roi >= 0 ? "gut" : "schlecht"}>{formatSigned(kombi.roi)}</td>
                <td className="erwartet">{formatSigned(kombi.erwartung)}</td>
              </tr>)}
            </tbody>
          </table>
          <small>
            Je Spieltag aus den Treffern gezogen, über die archivierten Läufe.
            {" "}Weichen „Ertrag" und „erwartet" weit voneinander ab, ist nicht die Rechnung
            falsch, sondern die Stichprobe zu dünn: Bei {formatPercent(measured?.trefferquote ?? 0)}
            {" "}Treffern je Bein gewinnt eine Viererkombi nur selten, und ein Treffer mehr oder
            weniger verschiebt den Ertrag um Dutzende Punkte.
          </small>
        </section>}

        <p className="quickpick-honesty">{preset.honesty}</p>

        <section className="kelly-panel">
          <button className="kelly-panel-head" aria-expanded={showSettings}
            onClick={() => setShowSettings((value) => !value)}>
            {showSettings ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
            <strong>Einstellungen</strong>
            <span className="kelly-panel-summary">
              {activeLevel === null
                ? "Eigene Werte"
                : preset.levels.find((entry) => entry.id === activeLevel)!.label}
              {settings.preset === "daves1x2"
                ? ` · Form ${settings.strongMinimum}/${settings.weakMaximum} · Punkte ab ${settings.minPoints}`
                : ` · Quote ${formatOdd(settings.minOdds)}–${formatOdd(settings.maxOdds)}`}
            </span>
          </button>

          {showSettings && <div className="quickpick-levels" role="group" aria-label="Strenge">
            {preset.levels.map((level) => <button key={level.id}
              className={activeLevel === level.id ? "active" : ""}
              aria-pressed={activeLevel === level.id}
              title={level.hint}
              onClick={() => onSettingsChange(applyLevel(settings, level.id))}>
              <strong>{level.label}</strong>
              <small>{preset.noteOf(level.measured)}</small>
            </button>)}
            <p className="quickpick-levels-note">
              {preset.massstab === "roi"
                ? "Tipps je Tag und Ertrag je Wette sind über die archivierten Läufe zurückgerechnet, zum echten Tipico-Preis des Außenseiters. Ein Ertrag unter null heißt: Auf Dauer kostet diese Auswahl Geld."
                : "Tipps je Tag und Trefferquote je Bein sind über die archivierten Läufe zurückgerechnet. Eine Kombi multipliziert die Trefferquote je Bein – vier Beine zu 68,7 % gehen in 22 % der Fälle durch, zu 58,3 % nur noch in 12 %."}
            </p>
          </div>}

          {showSettings && settings.preset === "daves1x2" && <div className="kelly-settings-grid">
            <NumberField label="Punkte je Spiel voraus" value={settings.minPointsPerGame} min={0} step={0.1}
              hint="Vorsprung in der Ligatabelle. Gesetzt, nicht gemessen: Das Tor soll verhindern, dass zwei gleich starke Mannschaften als überlegen gelten."
              onCommit={(value) => setDaves("minPointsPerGame", value)} />
            <NumberField label="Tordifferenz voraus" value={settings.minGoalDifference} min={0} step={0.1}
              hint="Vorsprung in der Tordifferenz je Spiel, ebenfalls aus der Ligatabelle."
              onCommit={(value) => setDaves("minGoalDifference", value)} />
            <NumberField label="Plätze voraus" value={settings.minPositionGap} min={0} step={1}
              hint="Abstand in der Ligatabelle. Zusammen mit den beiden anderen Toren bildet er „klar überlegen“ ab."
              onCommit={(value) => setDaves("minPositionGap", value)} />
            <NumberField label="Starke Seite (%)" value={settings.strongMinimum} min={0} max={100} step={5}
              hint="Formwert der getippten Seite aus Sieg 3, Remis 1, Niederlage 0 über die letzten fünf Spiele. 70 stammt aus npm run venue-form, dort über zehn Spiele gemessen. Mit 0 hier und 100 nebenan ist das Formtor aus."
              onCommit={(value) => setDaves("strongMinimum", value)} />
            <NumberField label="Schwache Seite (%)" value={settings.weakMaximum} min={0} max={100} step={5}
              hint="Höchstwert der Gegenseite. 50 stammt aus npm run venue-form. 100 schaltet diese Hälfte des Tores ab."
              onCommit={(value) => setDaves("weakMaximum", value)} />
            <NumberField label="Mindestquote" value={settings.minOdds} min={1} step={0.05}
              hint="Untergrenze, kein Ziel: Für eine Kombi zählt, dass das Bein durchkommt."
              onCommit={(value) => setDaves("minOdds", value)} />
            <NumberField label="Mindestpunkte" value={settings.minPoints} min={0} max={100} step={5}
              hint="Favoritenpunkte des Modells (0-100). Bänder: 50 schwach, 60 interessant, 70 stark, 80 sehr stark. Das stärkste einzelne Tor der Rückrechnung – 61,4 % Treffer allein gegenüber 47,2 % ohne jeden Filter."
              onCommit={(value) => setDaves("minPoints", value)} />
            <SettingField label="Nur mit Siegesserie"
              hint="Verlangt mindestens zwei gewonnene direkte Duelle in Folge. In der Rückrechnung trug die Serie nichts bei (58,3 % gegen 55,6 % ohne sie), deshalb ist sie aus."
              children={<input type="checkbox" checked={settings.requireStreak}
                onChange={(event) => setDaves("requireStreak", event.target.checked)} />} />
          </div>}

          {showSettings && settings.preset === "underdog" && <div className="kelly-settings-grid">
            <NumberField label="Quotenverhältnis" value={settings.minPriceRatio} min={1} step={0.05}
              hint="Wie viel teurer der Außenseiter mindestens sein muss. Unter 1,25 ist weder von „deutlich schlechter eingeschätzt“ die Rede, noch ist die aus Tipp- und Remisquote rekonstruierte Seite sicher genug."
              onCommit={(value) => setUnderdog("minPriceRatio", value)} />
            <NumberField label="Quote ab" value={settings.minOdds} min={1} step={0.1}
              hint="Untergrenze des Quotenbands."
              onCommit={(value) => setUnderdog("minOdds", value)} />
            <NumberField label="Quote bis" value={settings.maxOdds} min={1} step={0.5}
              hint="Obergrenze des Quotenbands. Gemessener Favorite-Longshot-Bias: Außenseiter über 4,00 liefern −20,2 % Ertrag, das Band 2,50–4,00 nur −9,8 %. Das Band ist kein Vorteil, sondern das kleinere Übel."
              onCommit={(value) => setUnderdog("maxOdds", value)} />
            <NumberField label="Formvorsprung (PP)" value={settings.minFormGap} min={-100} max={100} step={5}
              hint="Wie viele Prozentpunkte der Außenseiter in der Form vor dem Favoriten liegen muss. −100 schaltet das Tor ab."
              onCommit={(value) => setUnderdog("minFormGap", value)} />
            <NumberField label="H2H-Rate über" value={settings.minH2hRate} min={-2} max={1} step={0.1}
              hint="(Siege − Niederlagen) geteilt durch die Duelle, aus Sicht des Außenseiters. −2 schaltet das Tor ab. Achtung: In der Rückrechnung ist das die teuerste Bedingung – sie kostet rund 20 Punkte Ertrag."
              onCommit={(value) => setUnderdog("minH2hRate", value)} />
            <NumberField label="Mindestens … Duelle" value={settings.minDuels} min={0} max={5} step={1}
              hint="0 heißt: auch Partien ohne jedes direkte Duell. Fehlende Duelle sind keine Grundlage, aber auch kein Gegenargument."
              onCommit={(value) => setUnderdog("minDuels", value)} />
            <NumberField label="Plätze voraus" value={settings.minPositionGap ?? 0} min={0} step={1}
              hint="Tabellenvorsprung des Außenseiters. 0 schaltet das Tor ab; Cross-League-Partien fallen damit ohnehin weg, weil ihnen die Tabelle fehlt."
              onCommit={(value) => setUnderdog("minPositionGap", value <= 0 ? null : value)} />
            <SettingField label="Nur wenn das Modell zustimmt"
              hint="Verlangt, dass auch das Modell den Außenseiter tippt. Gemessen ohne Nutzen: Die Einschränkung ließ nur 268 Partien in 30 Tagen übrig, bei −13,3 % Ertrag."
              children={<input type="checkbox" checked={settings.requireModelSide}
                onChange={(event) => setUnderdog("requireModelSide", event.target.checked)} />} />
          </div>}
        </section>

        <div className="kelly-table-wrap">
          <table className="kelly-table quickpick-table">
            <thead>
              <tr>
                {columns.map((column) => <th key={column.key}>
                  {column.sortable
                    ? <button onClick={() => sort(column.key)}
                        aria-label={sortStateLabel(column.ariaLabel ?? column.label, sortKey === column.key, sortDirection)}>
                        {column.label} {arrow(column.key)}
                      </button>
                    : column.label}
                </th>)}
                {preset.wettschein.modus === "einzel" && <th aria-label="In den Wettschein" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => <tr key={row.fixture.fixtureId}>
                {columns.map((column) => {
                  const cell = column.cell(row);
                  return <td key={column.key} className={column.className}>
                    <strong title={cell.mainTitle}>{cell.main}</strong>
                    {cell.note === undefined ? null : <small title={cell.title}>{cell.note}</small>}
                  </td>;
                })}
                {preset.wettschein.modus === "einzel" && <td className="quickpick-add">
                  <button aria-label={`In den Wettschein: ${row.fixture.homeTeam} – ${row.fixture.awayTeam}`}
                    disabled={estimated(row)}
                    title={estimated(row)
                      ? "Die Quote ist gerechnet, nicht gespeichert – nach dem nächsten Dashboard-Lauf steht sie exakt im Snapshot."
                      : "Diese Wette in den Wettschein legen"}
                    onClick={() => onAddOne(row)}><Plus size={13} weight="bold" /></button>
                </td>}
              </tr>)}
              {sorted.length === 0 && <tr>
                <td className="kelly-empty" colSpan={columns.length + (preset.wettschein.modus === "einzel" ? 1 : 0)}>
                  {preset.leerSatz}
                </td>
              </tr>}
            </tbody>
          </table>
        </div>

        {rejections.length > 0 && <section className="quickpick-rejections" aria-label="Abweisungen">
          <strong>Woran die übrigen {report.evaluated - report.passed} Partien scheitern</strong>
          <ul>
            {rejections.map(([reason, count]) => <li key={reason}>
              <span className="quickpick-rejection-count">{count}</span> {REJECTION_LABELS[reason]}
            </li>)}
          </ul>
        </section>}
      </div>
    </div>
  </div>;
}
