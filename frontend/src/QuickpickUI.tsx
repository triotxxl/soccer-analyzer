import { CaretDown, CaretRight, Funnel, ShoppingCartSimple, X } from "@phosphor-icons/react";
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
  type DominanzQuickpickSettings,
  type Hz15QuickpickSettings,
  type RemisQuickpickSettings
} from "./quickpick";
import { QUICKPICK_COLUMNS, type QuickpickRow } from "./quickpickColumns";
import type { DashboardFixture } from "./types";

const formatPercent = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const formatSigned = (value: number) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1).replace(".", ",")} %`;


export function QuickpickButton({ active, onOpen }: { active: boolean; onOpen(): void }) {
  return <button className="kelly-trigger quickpick-trigger" aria-pressed={active}
    aria-label="Quickpicker öffnen" title="Quickpicker: Spiele nach einem fertigen Filter aussuchen"
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
  fixtures, settings, active, onSettingsChange, onPresetChange, onActiveChange, onAddAll, onClose
}: {
  fixtures: DashboardFixture[];
  settings: QuickpickSettings;
  active: boolean;
  onSettingsChange(settings: QuickpickSettings): void;
  onPresetChange(preset: QuickpickPresetId): void;
  onActiveChange(active: boolean): void;
  onAddAll(rows: QuickpickRow[]): void;
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
  const setDominanz = <K extends keyof DominanzQuickpickSettings>(key: K, value: DominanzQuickpickSettings[K]) => {
    if (settings.preset !== "dominanz") return;
    onSettingsChange({ ...settings, [key]: value });
  };
  const setHz15 = <K extends keyof Hz15QuickpickSettings>(key: K, value: Hz15QuickpickSettings[K]) => {
    if (settings.preset !== "hz15") return;
    onSettingsChange({ ...settings, [key]: value });
  };
  const setRemis = <K extends keyof RemisQuickpickSettings>(key: K, value: RemisQuickpickSettings[K]) => {
    if (settings.preset !== "remis") return;
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
  /** Eine gerechnete Quote ist kein Preis und darf nicht in den Wettschein. */
  const estimated = (row: QuickpickRow) => row.evaluation.dominanz?.oddsSource === "geschätzt";
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
        <div className="quickpick-presets" role="group" aria-label="Filter">
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

        <section className="quickpick-preset" aria-label="Filter">
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
            <span className="kelly-metric-note">von {report.evaluated} geprüften Spielen</span>
          </div>
          <div className="kelly-metric" title={kennzahl.titel}>
            <span className="kelly-metric-label">{kennzahl.label}</span>
            <strong className="kelly-metric-value">{kennzahl.wert}</strong>
            <span className="kelly-metric-note">{kennzahl.notiz}</span>
          </div>
          <div className="kelly-metric" title="Die Quote, wenn du alle gefundenen Spiele in einen einzigen Schein legst. Alle Quoten miteinander multipliziert.">
            <span className="kelly-metric-label">Alle in einem Schein</span>
            <strong className="kelly-metric-value">{withOdds.length === 0 ? "–" : formatOdd(comboOdds)}</strong>
            <span className="kelly-metric-note">{withOdds.length} Spiele · Ø {averageOdds === null ? "–" : formatOdd(averageOdds)}</span>
          </div>
        </div>

        <div className="quickpick-actions">
          <button className="quickpick-cart" disabled={spielbar.length === 0}
            title={preset.wettschein.hinweis}
            onClick={() => onAddAll(spielbar)}>
            <ShoppingCartSimple size={14} weight="bold" aria-hidden />
            {spielbar.length === 0 ? "Keine Treffer" : `Alle ${spielbar.length} in den Wettschein`}
          </button>
          {uebersprungen > 0 && <small className="quickpick-cart-note">
            {uebersprungen} {uebersprungen === 1 ? "Spiel bleibt" : "Spiele bleiben"} draußen –
            {" "}dort ist die Quote nur geschätzt. Nach der nächsten Analyse fällt das weg.
          </small>}
        </div>

        {/*
          Die Kombi-Tabelle steht bewusst vor dem Ehrlichkeitsabsatz: Sie ist die Antwort auf
          die Frage, die eine hohe Quote aufwirft - und die Spalte „erwartet" zeigt, dass eine
          Kombi den Ertrag je Bein multipliziert, nicht die Quote.
        */}
        {kombis.length > 0 && <section className="quickpick-kombis" aria-label="Kurze Kombis">
          <strong>Was Kombis aus dieser Stufe gebracht hätten</strong>
          <table>
            <thead>
              <tr>
                <th>Spiele</th><th>Quote Ø</th><th>geht durch</th><th>Gewinn</th>
                <th title="Was bei diesem Gewinn je Tipp eigentlich herauskommen müsste.">erwartet</th>
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
            An alten Spielen geprüft: je Spieltag zufällig Scheine aus den Treffern gebildet.
            {" "}Liegen „Gewinn" und „erwartet" weit auseinander, waren es zu wenige Scheine –
            {" "}bei {formatPercent(measured?.trefferquote ?? 0)} richtigen Tipps geht ein Schein
            {" "}mit vier Spielen selten durch, und ein Treffer mehr oder weniger dreht die
            {" "}Gewinnspalte komplett. Verlass dich auf „geht durch".
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
                : settings.preset === "hz15"
                ? ` · Quote bis ${formatOdd(settings.maxOdds)} · Tore ab ${settings.minExpectedGoals.toFixed(1).replace(".", ",")}`
                : settings.preset === "remis"
                ? ` · Quote bis ${formatOdd(settings.maxOdds)} · Remis ab ${(settings.minDrawProbability * 100).toFixed(0)} %`
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
                ? "Alle Zahlen sind an alten Spielen geprüft. Ein Gewinn unter null heißt: Auf Dauer kostet dich diese Auswahl Geld."
                : settings.preset === "hz15"
                ? "Alle Zahlen sind an alten Spielen geprüft. Ohne Filter fallen nur in 35 von 100 Spielen zwei Tore bis zur Pause. In einer Kombi müssen alle Tipps stimmen: vier Spiele gehen in 9 von 100 Fällen durch, sechs Spiele in 2 von 100."
                : settings.preset === "remis"
                ? "Alle Zahlen sind an alten Spielen geprüft. Ohne Filter endet nur jedes vierte Spiel unentschieden. In einer Kombi müssen alle Tipps stimmen: vier Spiele gehen in 2 von 100 Fällen durch, sechs Spiele in 3 von 1.000."
                : "Alle Zahlen sind an alten Spielen geprüft. In einer Kombi müssen alle Tipps stimmen: Bei 69 von 100 richtigen Tipps geht ein Schein mit vier Spielen in 22 von 100 Fällen durch, bei 58 von 100 nur noch in 12."}
            </p>
          </div>}

          {showSettings && settings.preset === "daves1x2" && <div className="kelly-settings-grid">
            <NumberField label="Punkte je Spiel mehr" value={settings.minPointsPerGame} min={0} step={0.1}
              hint="Wie viele Punkte je Spiel die getippte Mannschaft mehr holt. Soll verhindern, dass zwei gleich starke Teams als überlegen gelten."
              onCommit={(value) => setDaves("minPointsPerGame", value)} />
            <NumberField label="Torverhältnis besser" value={settings.minGoalDifference} min={0} step={0.1}
              hint="Wie viel besser ihr Torverhältnis je Spiel ist, ebenfalls aus der Tabelle."
              onCommit={(value) => setDaves("minGoalDifference", value)} />
            <NumberField label="Plätze vorn" value={settings.minPositionGap} min={0} step={1}
              hint="Wie viele Plätze sie in der Tabelle vorn liegt."
              onCommit={(value) => setDaves("minPositionGap", value)} />
            <NumberField label="Getippte Mannschaft ab (%)" value={settings.strongMinimum} min={0} max={100} step={5}
              hint="Wie stark die getippte Mannschaft zuletzt war, aus den letzten fünf Spielen: Sieg zählt 3, Remis 1, Niederlage 0. Mit 0 hier und 100 nebenan ist diese Bedingung aus."
              onCommit={(value) => setDaves("strongMinimum", value)} />
            <NumberField label="Gegner höchstens (%)" value={settings.weakMaximum} min={0} max={100} step={5}
              hint="Wie schwach der Gegner höchstens sein darf, gleiche Rechnung. 100 schaltet diese Hälfte ab."
              onCommit={(value) => setDaves("weakMaximum", value)} />
            <NumberField label="Mindestquote" value={settings.minOdds} min={1} step={0.05}
              hint="Mindestquote. Eine Untergrenze, kein Ziel – für eine Kombi zählt, dass der Tipp durchkommt."
              onCommit={(value) => setDaves("minOdds", value)} />
            <NumberField label="Modell sieht Favoriten ab" value={settings.minPoints} min={0} max={100} step={5}
              hint="Wie stark das Modell den Favoriten sieht, von 0 bis 100. Grob: 50 schwach, 60 interessant, 70 stark, 80 sehr stark. Die wichtigste Bedingung – unter 70 stimmen deutlich weniger Tipps."
              onCommit={(value) => setDaves("minPoints", value)} />
            <SettingField label="Nur mit Siegesserie"
              hint="Verlangt mindestens zwei gewonnene direkte Duelle in Folge. Bringt geprüft nichts, deshalb ist es aus."
              children={<input type="checkbox" checked={settings.requireStreak}
                onChange={(event) => setDaves("requireStreak", event.target.checked)} />} />
          </div>}

          {showSettings && settings.preset === "dominanz" && <div className="kelly-settings-grid">
            <NumberField label="Quote ab" value={settings.minOdds} min={1} step={0.1}
              hint="Ab welcher Quote ein Spiel gezeigt wird. Erst ab etwa 1,80 lohnt es sich für eine Kombi."
              onCommit={(value) => setDominanz("minOdds", value)} />
            <NumberField label="Quote bis" value={settings.maxOdds} min={1} step={0.5}
              hint="Bis zu welcher Quote. 99 heißt: keine Grenze. Je höher die Quote, desto seltener stimmt der Tipp – über 3,00 nur noch bei jedem sechsten Spiel."
              onCommit={(value) => setDominanz("maxOdds", value)} />
            <NumberField label="Punkte je Spiel mehr" value={settings.minPointsPerGame} min={0} step={0.1}
              hint="Wie viele Punkte je Spiel die stärkere Mannschaft mehr holt. Eine der drei festen Bedingungen – die Stufen ändern sie nicht."
              onCommit={(value) => setDominanz("minPointsPerGame", value)} />
            <NumberField label="Plätze vorn" value={settings.minPositionGap} min={0} step={1}
              hint="Wie viele Plätze sie in der Tabelle vorn liegt. Pokalspiele und Spiele zwischen verschiedenen Ligen fallen weg, weil es dort keine Tabelle gibt."
              onCommit={(value) => setDominanz("minPositionGap", value)} />
            <NumberField label="Verliert seltener (Punkte)" value={settings.minNonLossGap} min={0} max={100} step={5}
              hint="Um wie viel seltener sie über die ganze Saison verliert als der Gegner – nicht nur in den letzten fünf Spielen."
              onCommit={(value) => setDominanz("minNonLossGap", value)} />
            <NumberField label="Siege in Folge im Duell" value={settings.minStreak} min={0} max={5} step={1}
              hint="Gewonnene direkte Duelle in Folge. 0 schaltet die Bedingung aus. Sie bringt geprüft etwa vier Prozent mehr."
              onCommit={(value) => setDominanz("minStreak", value)} />
            <SettingField label="Nur wenn das Modell zustimmt"
              hint="Verlangt, dass auch das Modell diese Mannschaft tippt. Der stärkste einzelne Hebel dieses Filters."
              children={<input type="checkbox" checked={settings.requireModelSide}
                onChange={(event) => setDominanz("requireModelSide", event.target.checked)} />} />
          </div>}

          {showSettings && settings.preset === "hz15" && <div className="kelly-settings-grid">
            <NumberField label="Quote ab" value={settings.minOdds} min={1} step={0.05}
              hint="Mindestquote. Eine Untergrenze, kein Ziel."
              onCommit={(value) => setHz15("minOdds", value)} />
            <NumberField label="Quote bis" value={settings.maxOdds} min={1} step={0.05}
              hint="Höchstquote – die wirkungsvollste Bedingung. Bis 2,00 stimmt jeder zweite Tipp, über alle Quoten hinweg nur gut jeder dritte. Dieser Teil kommt vom Buchmacher, nicht vom Modell."
              onCommit={(value) => setHz15("maxOdds", value)} />
            <NumberField label="Erwartete Tore ab" value={settings.minExpectedGoals} min={0} step={0.1}
              hint="Wie viele Tore im ganzen Spiel erwartet werden. Das wichtigste sportliche Merkmal: Ab 3,4 fielen in fast der Hälfte der Spiele zwei Tore bis zur Pause. Feste Bedingung, die Stufen ändern sie nicht."
              onCommit={(value) => setHz15("minExpectedGoals", value)} />
            <NumberField label="Unentschieden höchstens" value={settings.maxDrawProbability} min={0} max={1} step={0.01}
              hint="Wie wahrscheinlich ein Unentschieden höchstens sein darf. Offene Spiele liefern früher Tore. 1 schaltet die Bedingung aus."
              onCommit={(value) => setHz15("maxDrawProbability", value)} />
            <NumberField label="Zuletzt zwei Tore bis zur Pause ab" value={settings.minFirstHalfRate} min={0} max={1} step={0.05}
              hint="Wie oft bei beiden Mannschaften zuletzt zwei Tore bis zur Pause fielen. Bringt allein wenig, deshalb nur in der strengsten Stufe an. 0 schaltet es aus."
              onCommit={(value) => setHz15("minFirstHalfRate", value)} />
          </div>}

          {showSettings && settings.preset === "remis" && <div className="kelly-settings-grid">
            <NumberField label="Chance auf Unentschieden ab" value={settings.minDrawProbability} min={0} max={1} step={0.01}
              hint="Wie hoch das Modell die Chance auf ein Unentschieden mindestens sehen muss – die einzige Bedingung. Ab 30 % endete gut jedes dritte Spiel unentschieden statt jedes vierten. Unter 29 % wird es Verlust."
              onCommit={(value) => setRemis("minDrawProbability", value)} />
            <NumberField label="Quote ab" value={settings.minOdds} min={1} step={0.05}
              hint="Mindestquote. Für eine Kombi zählt, dass der Tipp durchkommt."
              onCommit={(value) => setRemis("minOdds", value)} />
            <NumberField label="Quote bis" value={settings.maxOdds} min={1} step={0.1}
              hint="Höchstquote. 99 heißt: keine Grenze. Je höher die Quote, desto seltener stimmt es – über 4,00 endet nur noch jedes sechste Spiel unentschieden."
              onCommit={(value) => setRemis("maxOdds", value)} />
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
              </tr>)}
              {sorted.length === 0 && <tr>
                <td className="kelly-empty" colSpan={columns.length}>
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
