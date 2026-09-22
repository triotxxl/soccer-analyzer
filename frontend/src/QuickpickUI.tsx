import { CaretRight, Funnel, Info, ShoppingCartSimple, X } from "@phosphor-icons/react";
import { useState } from "react";
import {
  QUICKPICK_PRESET_LIST,
  REJECTION_LABELS,
  applyLevel,
  applyQuickpick,
  levelOf,
  presetOf,
  settingsOf,
  type QuickpickLevelId,
  type QuickpickPresetId,
  type QuickpickRejection,
  type QuickpickSettings,
  type QuickpickStore
} from "./quickpick";
import {
  factColumns,
  oddsColumn,
  pickColumn,
  strengthOf,
  type QuickpickRow
} from "./quickpickColumns";
import {
  QUICKPICK_PARAMS,
  QUICKPICK_TOGGLES,
  displayValue,
  storedValue,
  type QuickpickParam
} from "./quickpickParams";
import type { DashboardFixture } from "./types";

const formatPercent = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const formatSigned = (value: number) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1).replace(".", ",")} %`;

/** Die Schubladen über der Fußzeile. Immer höchstens eine, sonst frisst sie die Liste auf. */
type Drawer = "kombi" | "strenge" | "abgewiesen" | null;

/** Wonach die Trefferliste sortiert wird. Bewusst wenige Möglichkeiten - es ist eine Liste. */
type SortKey = "kickoff" | "odds" | "strength";

const SORT_LABELS: Record<SortKey, string> = {
  kickoff: "Anstoß",
  odds: "Quote",
  strength: "Stärke"
};

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

/**
 * Ein Regler der Schublade „Strenge": Schieber und Zahlenfeld auf denselben Wert.
 *
 * Weicht der Wert von der Stufenvorgabe ab, wird das Zahlenfeld blau umrandet. Das ist der
 * einzige Hinweis darauf, dass die gemessenen Zahlen auf den Stufenknöpfen dann **nicht mehr
 * gelten** - ohne ihn liest man eine Trefferquote ab, die zu anderen Werten gehört.
 */
function ParamRow({ param, value, changed, onChange }: {
  param: QuickpickParam;
  value: number;
  changed: boolean;
  onChange(next: number): void;
}) {
  const shown = displayValue(param, value);
  const commit = (raw: string) => {
    // Ein leeres Feld ist kein Wert, sondern ein halb getippter: `Number("")` wäre 0, und der
    // Filter spränge beim Löschen kurz auf die weiteste Einstellung.
    if (raw.trim() === "") return;
    const parsed = Number(raw.replace(",", "."));
    if (Number.isNaN(parsed)) return;
    onChange(storedValue(param, Math.min(param.max, Math.max(param.min, parsed))));
  };
  const inputId = `quickpick-param-${param.id}`;
  return <div className="quickpick-param">
    <label htmlFor={inputId} title={param.title}>{param.label}</label>
    {/* Das Zahlenfeld trägt die Beschriftung. Wäre der Schieber zusätzlich beschriftet,
        hätte derselbe Wert zwei Bedienelemente mit identischem Namen - die Vorlesehilfe
        läse ihn doppelt vor, und jede Suche nach der Beschriftung fände zwei Felder. */}
    <input type="range" aria-hidden tabIndex={-1}
      min={param.min} max={param.sliderMax ?? param.max} step={param.step}
      value={Math.min(shown, param.sliderMax ?? param.max)}
      onChange={(event) => commit(event.target.value)} />
    <input id={inputId} type="number" className={changed ? "changed" : ""}
      min={param.min} max={param.max} step={param.step} value={shown}
      onChange={(event) => commit(event.target.value)} />
  </div>;
}

export function QuickpickDialog({
  fixtures, store, active, timezone, onSettingsChange, onPresetChange, onActiveChange, onAddAll, onClose
}: {
  fixtures: DashboardFixture[];
  store: QuickpickStore;
  active: boolean;
  timezone: string;
  onSettingsChange(settings: QuickpickSettings): void;
  onPresetChange(preset: QuickpickPresetId): void;
  onActiveChange(active: boolean): void;
  onAddAll(rows: QuickpickRow[]): void;
  onClose(): void;
}) {
  const settings = settingsOf(store);
  const preset = presetOf(settings);
  const [info, setInfo] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [sortKey, setSortKey] = useState<SortKey>("kickoff");
  // Welche Stufe die Regler zuletzt gesetzt hat. Sobald ein Regler abweicht, liefert
  // `levelOf` null - ohne dieses Gedächtnis wüsste „Auf Stufe zurücksetzen" nicht, wohin.
  const [levelMemory, setLevelMemory] = useState<Partial<Record<QuickpickPresetId, QuickpickLevelId>>>({});

  const exactLevel = levelOf(settings);
  const baseLevel = exactLevel ?? levelMemory[preset.id] ?? levelOf(preset.defaults) ?? preset.levels[1]!.id;
  const baseEntry = preset.levels.find((entry) => entry.id === baseLevel) ?? preset.levels[1]!;
  const measured = baseEntry.measured;
  const kennzahl = preset.kennzahlOf(exactLevel === null ? null : measured);

  // Wie im Kelly-Dialog: bei jedem Render neu gerechnet, kein Zwischenspeicher. Die Liste
  // kann dadurch nicht von dem abweichen, was die Tabelle zeigt.
  const { evaluations, report } = applyQuickpick(fixtures, settings);

  const rows: QuickpickRow[] = fixtures
    .map((fixture) => ({ fixture, evaluation: evaluations.get(fixture.fixtureId)! }))
    .filter((row) => row.evaluation.passes);

  const sortValue = (row: QuickpickRow): number => {
    if (sortKey === "odds") return row.evaluation.odds ?? -1;
    if (sortKey === "strength") return strengthOf(preset.id, row)?.percent ?? -1;
    return -Date.parse(row.fixture.kickoff);
  };
  const sorted = [...rows].sort((left, right) =>
    sortValue(right) - sortValue(left)
    || Date.parse(left.fixture.kickoff) - Date.parse(right.fixture.kickoff));

  const rejections = (Object.entries(report.rejected) as Array<[QuickpickRejection, number]>)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);

  /** Eine gerechnete Quote ist kein Preis und darf nicht in den Wettschein. */
  const estimated = (row: QuickpickRow) => row.evaluation.dominanz?.oddsSource === "geschätzt";
  const spielbar = sorted.filter((row) => !estimated(row));
  const uebersprungen = sorted.length - spielbar.length;
  const kombis = measured?.kombis ?? [];

  const params = QUICKPICK_PARAMS[preset.id];
  const toggles = QUICKPICK_TOGGLES[preset.id];
  const levelValues = baseEntry.values as Record<string, number | boolean | undefined>;
  const current = settings as unknown as Record<string, number | boolean>;
  const changedParam = (param: QuickpickParam) =>
    levelValues[param.id] !== undefined && current[param.id] !== levelValues[param.id];
  const custom = params.some(changedParam);

  const setParam = (param: QuickpickParam, next: number) =>
    onSettingsChange({ ...settings, [param.id]: next } as QuickpickSettings);

  const openDrawer = (next: Exclude<Drawer, null>) =>
    setDrawer((value) => (value === next ? null : next));

  const kickoff = (value: string) => {
    const date = new Date(value);
    const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "short" }).format(date);
    const clock = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
    return `${weekday} ${clock}`;
  };

  const pick = pickColumn(preset.id);
  const odds = oddsColumn(preset.id);
  const facts = factColumns(preset.id);

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="kelly-dialog quickpick-dialog" role="dialog" aria-label="Quickpicker"
      onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head quickpick-head">
        <strong>Quickpicker</strong>
        <span className="overlay-head-actions">
          <button aria-label="Schließen" onClick={onClose}><X /></button>
        </span>
      </div>

      <div className="quickpick-tabs" role="tablist" aria-label="Filter">
        {QUICKPICK_PRESET_LIST.map((entry) => {
          const treffer = applyQuickpick(fixtures, store[entry.id]).report.passed;
          return <button key={entry.id} role="tab"
            className={entry.id === preset.id ? "active" : ""}
            aria-selected={entry.id === preset.id}
            aria-label={entry.label}
            title={entry.description}
            onClick={() => {
              onPresetChange(entry.id);
              onActiveChange(true);
              setOpenRow(null);
              setInfo(false);
            }}>
            <span>{entry.short}</span>
            <span className="quickpick-tab-count">{treffer}</span>
          </button>;
        })}
      </div>

      <div className="quickpick-context">
        <strong>{preset.label}</strong>
        <span className="quickpick-context-note">
          {report.passed} von {report.evaluated} Spielen{" · "}
          <span title={kennzahl.titel}>{kennzahl.label}</span> {kennzahl.wert}
          {" · "}{exactLevel === null ? "eigene Werte" : baseEntry.label}
        </span>
        <label className="quickpick-sort">
          <span>Sortiert nach</span>
          <select value={sortKey} aria-label="Sortierung"
            onChange={(event) => setSortKey(event.target.value as SortKey)}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) =>
              <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
          </select>
        </label>
        <button className={info ? "quickpick-info-toggle active" : "quickpick-info-toggle"}
          aria-expanded={info} aria-label="Worauf dieser Filter achtet"
          title="Worauf dieser Filter achtet" onClick={() => setInfo((value) => !value)}>
          <Info size={13} weight="bold" />
        </button>

        {info && <div className="quickpick-info">
          <p>{preset.description}</p>
          <ul className="quickpick-criteria">
            {preset.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
          </ul>
          <p className="quickpick-honesty">{preset.honesty}</p>
        </div>}
      </div>

      <div className="quickpick-list">
        {sorted.map((row) => {
          const open = openRow === row.fixture.fixtureId;
          const strength = strengthOf(preset.id, row);
          const pickCell = pick.cell(row);
          const oddsCell = odds.cell(row);
          return <div key={row.fixture.fixtureId} className="quickpick-entry">
            <button className={open ? "quickpick-row open" : "quickpick-row"}
              aria-expanded={open}
              onClick={() => setOpenRow(open ? null : row.fixture.fixtureId)}>
              <span className="quickpick-when">
                <small>{kickoff(row.fixture.kickoff)}</small>
                <small className="quickpick-league">{row.fixture.league}</small>
              </span>
              <span className="quickpick-match">
                <strong>{row.fixture.homeTeam} – {row.fixture.awayTeam}</strong>
                <span className="quickpick-pick" title={pickCell.mainTitle}>{pickCell.main}</span>
                {pickCell.note === undefined ? null
                  : <small className="quickpick-pick-note">{pickCell.note}</small>}
              </span>
              <span className="quickpick-strength" title={strength?.title}>
                <small>{strength === null ? "–" : strength.label}</small>
                <span className="quickpick-bar">
                  {strength !== null && <span
                    className={strength.percent >= strength.gut ? "gut"
                      : strength.percent >= strength.mittel ? "mittel" : "schwach"}
                    style={{ width: `${Math.max(0, Math.min(100, strength.percent))}%` }} />}
                </span>
              </span>
              <strong className="quickpick-odds" title={oddsCell.mainTitle}>{oddsCell.main}</strong>
              <CaretRight size={11} weight="bold" className="quickpick-chevron" aria-hidden />
            </button>
            {open && <div className="quickpick-facts">
              {facts.map((column) => {
                const cell = column.cell(row);
                return <span key={column.key} className="quickpick-fact">
                  <small title={column.ariaLabel}>{column.label}</small>
                  <span title={cell.mainTitle}>{cell.main}</span>
                  {cell.note === undefined ? null
                    : <small className="quickpick-fact-note" title={cell.title}>{cell.note}</small>}
                </span>;
              })}
            </div>}
          </div>;
        })}
        {sorted.length === 0 && <p className="quickpick-empty">{preset.leerSatz}</p>}
      </div>

      {drawer !== null && <div className="quickpick-drawer">
        {/*
          Die Kombi-Tabelle: Sie ist die Antwort auf die Frage, die eine hohe Quote aufwirft -
          und die Spalte „erwartet" zeigt, dass eine Kombi den Ertrag je Tipp multipliziert,
          nicht die Quote.
        */}
        {drawer === "kombi" && <section aria-label="Kombi-Chancen" className="quickpick-kombis">
          <strong>Was Kombis aus dieser Stufe gebracht hätten</strong>
          {kombis.length === 0
            ? <small>Für diese Stufe wurde noch nichts an alten Spielen geprüft.</small>
            : <>
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
            </>}
        </section>}

        {drawer === "strenge" && <section aria-label="Strenge" className="quickpick-setup">
          <div className="quickpick-levels" role="group" aria-label="Strengestufe">
            {preset.levels.map((level) => <button key={level.id}
              className={exactLevel === level.id ? "active" : ""}
              aria-pressed={exactLevel === level.id}
              title={level.hint}
              onClick={() => {
                setLevelMemory((value) => ({ ...value, [preset.id]: level.id }));
                onSettingsChange(applyLevel(settings, level.id));
              }}>
              <strong>{level.label}</strong>
              <small>{preset.noteOf(level.measured)}</small>
            </button>)}
          </div>

          <div className="quickpick-setup-head">
            <strong>Werte</strong>
            <span>{custom
              ? "geändert – die Zahlen auf den Stufen gelten dann nicht mehr"
              : `Vorgabe der Stufe ${baseEntry.label}`}</span>
            <button className={custom ? "quickpick-reset active" : "quickpick-reset"}
              disabled={!custom}
              onClick={() => onSettingsChange(applyLevel(settings, baseLevel))}>
              Auf Stufe zurücksetzen
            </button>
          </div>

          <div className="quickpick-params">
            {params.map((param) => <ParamRow key={param.id} param={param}
              value={current[param.id] as number}
              changed={changedParam(param)}
              onChange={(next) => setParam(param, next)} />)}
            {toggles.map((toggle) => <label key={toggle.id} className="quickpick-toggle" title={toggle.title}>
              <input type="checkbox" checked={current[toggle.id] as boolean}
                onChange={(event) => onSettingsChange(
                  { ...settings, [toggle.id]: event.target.checked } as QuickpickSettings)} />
              <span>{toggle.label}</span>
            </label>)}
          </div>
        </section>}

        {drawer === "abgewiesen" && <section aria-label="Abgewiesen" className="quickpick-rejections">
          <strong>Woran die übrigen {report.evaluated - report.passed} Partien scheitern</strong>
          <ul>
            {rejections.map(([reason, count]) => <li key={reason}>
              <span className="quickpick-rejection-count">{count}</span> {REJECTION_LABELS[reason]}
            </li>)}
            {rejections.length === 0 && <li>Keine Partie ist durchgefallen.</li>}
          </ul>
        </section>}
      </div>}

      <div className="quickpick-footer">
        <button className={drawer === "kombi" ? "active" : ""} aria-pressed={drawer === "kombi"}
          title="Was Kombis aus dieser Stufe gebracht hätten"
          onClick={() => openDrawer("kombi")}>Kombi-Chancen</button>
        <button className={drawer === "strenge" ? "active" : ""} aria-pressed={drawer === "strenge"}
          title={baseEntry.hint}
          onClick={() => openDrawer("strenge")}>
          Strenge: {exactLevel === null ? "eigene Werte" : baseEntry.label}
        </button>
        <button className={drawer === "abgewiesen" ? "active" : ""} aria-pressed={drawer === "abgewiesen"}
          title="Woran die übrigen Partien scheitern"
          onClick={() => openDrawer("abgewiesen")}>
          Abgewiesen {report.evaluated - report.passed}
        </button>

        <span className="quickpick-footer-gap" />

        {uebersprungen > 0 && <small className="quickpick-cart-note"
          title="Für diese Spiele ist die Quote nur gerechnet, nicht gespeichert. Nach der nächsten Analyse fällt das weg.">
          {uebersprungen} ohne echte Quote
        </small>}
        <button className={active ? "quickpick-apply active" : "quickpick-apply"}
          aria-pressed={active} onClick={() => onActiveChange(!active)}>
          {active ? "Filter aufheben" : "Filter anwenden"}
        </button>
        <button className="quickpick-cart" disabled={spielbar.length === 0}
          title={preset.wettschein.hinweis}
          onClick={() => onAddAll(spielbar)}>
          <ShoppingCartSimple size={14} weight="bold" aria-hidden />
          {spielbar.length === 0 ? "Keine Treffer" : `Alle ${spielbar.length} in den Wettschein`}
        </button>
      </div>
    </div>
  </div>;
}
