import { CaretRight, Funnel, Info, Ticket, X } from "@phosphor-icons/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from "react";
import { FilterCard, FilterChip, FilterSegment, FilterSwitch, type SegmentOption } from "./FilterMenu";
import {
  QUICKPICK_GROUPS,
  QUICKPICK_PRESET_LIST,
  REJECTION_LABELS,
  applyLevel,
  applyQuickpick,
  levelOf,
  oddsEstimated,
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
import { selectionLabel, shortTipLabel, type CartEntry } from "./betCart";
import { leagueName, teamName, useNames, type NameSource } from "./names";
import type { DashboardFixture } from "./types";

/** Was „Alle n in den Wettschein“ getan hat; der Fuß meldet es, statt den Wettschein zu öffnen. */
export interface QuickpickCartFeedback {
  added: number;
  unchanged: number;
  replaced: Array<{ by: CartEntry; old: CartEntry[] }>;
  /** Kennung der Änderung für „Rückgängig“; `null`, wenn sich nichts geändert hat. */
  changeId: number | null;
}

/** „5 neu im Wettschein · 1 ersetzt · 2 schon drin“ - Teile mit 0 fallen weg. */
function feedbackParts(feedback: QuickpickCartFeedback, names: NameSource): Array<{ count: number; label: string; title?: string }> {
  const parts: Array<{ count: number; label: string; title?: string }> = [];
  if (feedback.added > 0) parts.push({ count: feedback.added, label: "neu im Wettschein" });
  if (feedback.replaced.length > 0) {
    parts.push({
      count: feedback.replaced.length,
      label: "ersetzt",
      title: feedback.replaced
        .map(({ by, old }) => `${teamName(by, "home", names)} – ${teamName(by, "away", names)}: ${old.map((entry) => shortTipLabel(entry, names)).join(", ")} durch ${selectionLabel(by, names)} ersetzt`)
        .join("\n")
    });
  }
  if (feedback.unchanged > 0) parts.push({ count: feedback.unchanged, label: "schon drin" });
  return parts;
}

const formatPercent = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const formatSigned = (value: number) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1).replace(".", ",")} %`;
const formatDecimal = (value: number) => value.toFixed(1).replace(".", ",");

const spieleWort = (count: number) => (count === 1 ? "Spiel" : "Spiele");

/** Wonach die Trefferliste sortiert wird. Bewusst wenige Möglichkeiten - es ist eine Liste. */
type SortKey = "kickoff" | "odds" | "strength";

const SORT_OPTIONS: ReadonlyArray<SegmentOption<SortKey>> = [
  { value: "kickoff", label: "Anstoß" },
  { value: "odds", label: "Quote" },
  { value: "strength", label: "Stärke" }
];

/**
 * Öffnet den Quickpicker. Gebaut wie der Filter-Knopf daneben: offen heller ohne Balken, aktiv
 * mit dem grünen Balken einer Wahl. Ob der Filter wirkt, sagt die Beschreibung statt
 * `aria-pressed` - sonst läse der Screenreader „Umschalter, gedrückt, erweitert“.
 */
export function QuickpickButton({ active, open, onToggle, buttonRef }: {
  active: boolean;
  open: boolean;
  onToggle(): void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const stateId = useId();
  return <button ref={buttonRef} type="button"
    className={`kelly-trigger quickpick-trigger${open ? " open" : ""}${active ? " active" : ""}`}
    aria-label="Quickpicker öffnen" aria-haspopup="dialog" aria-expanded={open}
    aria-describedby={active ? stateId : undefined}
    title="Quickpicker: Spiele nach einem fertigen Filter aussuchen"
    onClick={onToggle}>
    <Funnel size={15} weight="bold" aria-hidden /> Quickpick
    {active && <span id={stateId} className="visually-hidden">Filter aktiv</span>}
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
  // Öffnet den Quickpicker, nicht das Filtermenü: Dort stehen Regler und Pflichttexte.
  return <FilterChip label={`${label} · ${passed} von ${evaluated}`} title="Quickpicker öffnen"
    clearLabel="Quickpick-Filter aufheben" onOpen={onOpen} onClear={onClear} />;
}

/**
 * Ein Regler unter „Werte anpassen“: Schieber und Zahlenfeld auf denselben Wert.
 *
 * Weicht der Wert von der Stufe ab, wird das Zahlenfeld hell umrandet und der Wert der Stufe
 * steht daneben. Zusammen mit „eigene Werte“ im Kartenkopf sagt das, dass die gemessenen Zahlen
 * der Stufen dann **nicht mehr gelten** - ohne den Hinweis liest man eine Trefferquote ab, die
 * zu anderen Werten gehört.
 */
function ParamRow({ param, value, base, changed, onChange }: {
  param: QuickpickParam;
  value: number;
  /** Der Wert der Stufe bzw. die Vorgabe, gegen den `changed` geprüft wurde. */
  base: number | undefined;
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
    {changed && base !== undefined && <small className="quickpick-param-base">
      Stufe: {String(displayValue(param, base)).replace(".", ",")}
    </small>}
  </div>;
}

/** Ein Aufklapper: Textknopf mit Pfeil, der Inhalt steht direkt darunter. */
function Disclosure({ label, title, open, onToggle }: {
  label: string;
  title?: string;
  open: boolean;
  onToggle(): void;
}) {
  return <button type="button" className={`quickpick-disclosure${open ? " open" : ""}`}
    aria-expanded={open} title={title} onClick={onToggle}>
    {label}<CaretRight size={11} weight="bold" aria-hidden />
  </button>;
}

/**
 * Der Quickpicker: ein nicht-modales Fenster unter seinem Knopf wie das Filtermenü
 * (Davids Entscheidung vom 10.10.2026). Links wählen - Filter, dann Stufe -, rechts die
 * gefundenen Spiele, unten immer der Haken und der Wettschein. Jede Wahl wirkt sofort und
 * schaltet „Tabelle filtern“ ein; Sortieren und Aufklappen schalten nichts. Öffnen, Schließen
 * und Fokus regelt das Dashboard.
 */
export function QuickpickDialog({
  fixtures, store, active, timezone, now = Date.now(), shownInTable,
  onSettingsChange, onPresetChange, onActiveChange, onAddAll, onClose,
  cartFeedback = null, canUndoCart = false, onUndoCart, onOpenCart
}: {
  fixtures: DashboardFixture[];
  store: QuickpickStore;
  active: boolean;
  timezone: string;
  /** Ab hier gilt ein Spiel als angepfiffen; seine Quote ist dann veraltet. */
  now?: number;
  /** Wie viele Spiele die Tabelle gerade zeigt - Bewertung und Klassenfilter grenzen weiter ein. */
  shownInTable?: number;
  onSettingsChange(settings: QuickpickSettings): void;
  onPresetChange(preset: QuickpickPresetId): void;
  onActiveChange(active: boolean): void;
  onAddAll(rows: QuickpickRow[]): void;
  onClose(): void;
  cartFeedback?: QuickpickCartFeedback | null;
  /** Nimmt „Rückgängig“ noch genau diesen Schritt zurück? Jede spätere Änderung verwirft es. */
  canUndoCart?: boolean;
  onUndoCart?(): void;
  onOpenCart?(): void;
}) {
  const settings = settingsOf(store);
  const preset = presetOf(settings);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  // Die Höhe richtet sich nach dem tatsächlichen Abstand vom oberen Rand: Mit dem Hinweisbanner
  // über der Leiste rutschte ein fest gerechnetes Fenster samt Wettschein-Knopf aus dem Bild.
  useLayoutEffect(() => {
    const place = () => {
      const menu = menuRef.current;
      if (menu) menu.style.setProperty("--quickpick-top", `${Math.max(0, menu.getBoundingClientRect().top)}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  const [info, setInfo] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [kombiOpen, setKombiOpen] = useState(false);
  const [rejectionsOpen, setRejectionsOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("kickoff");
  // Welche Stufe die Regler zuletzt gesetzt hat. Sobald ein Regler abweicht, liefert
  // `levelOf` null - ohne dieses Gedächtnis wüsste „Auf Stufe zurücksetzen" nicht, wohin.
  const [levelMemory, setLevelMemory] = useState<Partial<Record<QuickpickPresetId, QuickpickLevelId>>>({});

  /** Ein Wechsel meint „zeig mir diese Auswahl" - also greift der Filter sofort. */
  const choose = (id: QuickpickPresetId) => {
    if (id !== preset.id) {
      onPresetChange(id);
      setOpenRow(null);
    }
    // Auch beim schon gewählten Filter: Ein Klick darauf heißt „filtern“.
    onActiveChange(true);
  };

  const exactLevel = levelOf(settings);
  const baseLevel = exactLevel ?? levelMemory[preset.id] ?? levelOf(preset.defaults) ?? preset.levels[1]!.id;
  const baseEntry = preset.levels.find((entry) => entry.id === baseLevel) ?? preset.levels[1]!;
  const measured = baseEntry.measured;

  const params = QUICKPICK_PARAMS[preset.id];
  const toggles = QUICKPICK_TOGGLES[preset.id];
  const levelValues = baseEntry.values as Record<string, number | boolean | undefined>;
  const defaults = preset.defaults as unknown as Record<string, number | boolean>;
  const current = settings as unknown as Record<string, number | boolean>;
  // Verglichen wird mit der Stufe und, wo die Stufe nichts setzt, mit der Vorgabe des Filters:
  // Auch eine geänderte Quotengrenze oder Torerwartung wurde nie gemessen.
  const baseOf = (param: QuickpickParam) => (levelValues[param.id] ?? defaults[param.id]) as number | undefined;
  const changedParam = (param: QuickpickParam) => {
    const base = baseOf(param);
    return base !== undefined && current[param.id] !== base;
  };
  const custom = exactLevel === null || params.some(changedParam);

  const [paramsOpen, setParamsOpen] = useState(custom);
  // Eigene Werte bleiben sichtbar: Sobald etwas abweicht, geht „Werte anpassen“ auf.
  useEffect(() => { if (custom) setParamsOpen(true); }, [custom]);

  const activate = (next: QuickpickSettings) => {
    onSettingsChange(next);
    onActiveChange(true);
  };
  const chooseLevel = (level: QuickpickLevelId) => {
    setLevelMemory((value) => ({ ...value, [preset.id]: level }));
    activate(applyLevel(settings, level));
  };
  const resetToLevel = () => {
    const kern = Object.fromEntries(params
      .filter((param) => levelValues[param.id] === undefined && defaults[param.id] !== undefined)
      .map((param) => [param.id, defaults[param.id]]));
    activate({ ...applyLevel(settings, baseLevel), ...kern } as QuickpickSettings);
  };
  const setParam = (param: QuickpickParam, next: number) =>
    activate({ ...settings, [param.id]: next } as QuickpickSettings);

  // Wie im Kelly-Dialog: bei jedem Render neu gerechnet, kein Zwischenspeicher. Die Liste
  // kann dadurch nicht von dem abweichen, was die Tabelle zeigt.
  const { evaluations, report } = applyQuickpick(fixtures, settings);
  const names = useNames();
  // Die Zahl hinter jedem Filter: wie viele Spiele er mit **seinen** Einstellungen findet,
  // damit der Wechsel nicht blind geschieht.
  const passedOf = (id: QuickpickPresetId) =>
    id === preset.id ? report.passed : applyQuickpick(fixtures, store[id]).report.passed;

  const rows: QuickpickRow[] = fixtures
    .map((fixture) => ({ fixture, evaluation: evaluations.get(fixture.fixtureId)!, names }))
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
  const rejectedCount = report.evaluated - report.passed;

  /** Eine gerechnete Quote ist kein Preis und darf nicht in den Wettschein. */
  const estimated = (row: QuickpickRow) => oddsEstimated(row.evaluation);
  /** Angepfiffen: Die Quote stammt von vor dem Anpfiff - wie bei Kelly nicht in den Wettschein. */
  const started = (row: QuickpickRow) => Date.parse(row.fixture.kickoff) <= now;
  const spielbar = sorted.filter((row) => !estimated(row) && !started(row));
  const estimatedCount = sorted.filter(estimated).length;
  const startedCount = sorted.filter((row) => !estimated(row) && started(row)).length;
  const kombis = measured?.kombis ?? [];

  const cartLabel = sorted.length === 0 ? "Kein Spiel gefunden"
    : spielbar.length > 0 ? `Alle ${spielbar.length} in den Wettschein`
    : startedCount === 0 ? "Keins mit echter Quote"
    : estimatedCount === 0 ? "Alle schon angepfiffen"
    : "Keins spielbar";

  const kickoff = (value: string) => {
    const date = new Date(value);
    const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "short" }).format(date);
    const clock = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
    return `${weekday} ${clock}`;
  };

  const pick = pickColumn(preset.id);
  const odds = oddsColumn(preset.id);
  const facts = factColumns(preset.id);
  const kennzahlLabel = preset.kennzahlOf(null).label;
  const tableDiffers = active && shownInTable !== undefined && shownInTable !== report.passed;

  const rejectionList = (limit?: number) => <ul className="quickpick-rejections">
    {rejections.slice(0, limit).map(([reason, count]) => <li key={reason}>
      <span className="quickpick-rejection-count">{count}</span> {REJECTION_LABELS[reason]}
    </li>)}
    {rejections.length === 0 && <li>Kein Spiel ist durchgefallen.</li>}
  </ul>;

  return <div ref={menuRef} className="filter-menu quickpick-menu" role="dialog" aria-label="Quickpicker">
    <div className="filter-menu-head">
      <h2 ref={headingRef} tabIndex={-1}>Quickpicker</h2>
      <p className="filter-menu-count">
        <strong>{report.passed}</strong> von {report.evaluated} Spielen passen
        {tableDiffers && <span title="Bewertung oder Klassenunterschied im Filtermenü grenzen die Tabelle weiter ein.">
          {" · "}Tabelle zeigt {shownInTable}
        </span>}
      </p>
      <FilterSwitch label="Tabelle filtern" checked={active} onChange={onActiveChange} />
      <button type="button" className="filter-menu-close" aria-label="Quickpicker schließen"
        title="Quickpicker schließen" onClick={onClose}><X size={14} weight="bold" aria-hidden /></button>
    </div>

    <div className="quickpick-body">
      <div className="quickpick-left">
        <FilterCard title="Filter">
          {QUICKPICK_GROUPS.map((group) => <fieldset key={group.id} className="quickpick-options">
            <legend title={group.title}>{group.label}</legend>
            {QUICKPICK_PRESET_LIST.filter((entry) => entry.group === group.id).map((entry) => {
              const checked = entry.id === preset.id;
              const count = passedOf(entry.id);
              return <label key={entry.id} className={`quickpick-option${checked ? " checked" : ""}`}
                title={entry.description}>
                {/* onClick statt onChange: Ein Klick auf den schon gewählten Filter löst kein
                    change aus, soll aber genauso einschalten. Pfeiltasten lösen click aus. */}
                {/* Der Name steht ausgeschrieben im aria-label: Aus den Spalten der Zeile
                    setzte der Browser „Daves 1x2-Filter4“ zusammen. */}
                <input className="visually-hidden" type="radio" name="quickpick-preset" value={entry.id}
                  aria-label={`${entry.label}, ${count} ${spieleWort(count)}`}
                  checked={checked} readOnly onClick={() => choose(entry.id)} />
                <span className="quickpick-option-label">{entry.label}</span>
                <span className={`quickpick-option-value${count === 0 ? " zero" : ""}`}>{count}</span>
              </label>;
            })}
          </fieldset>)}
          <div className="filter-card-rule">
            <Disclosure label="Worauf dieser Filter achtet" open={info} onToggle={() => setInfo((value) => !value)} />
            {info && <div className="quickpick-info">
              <p>{preset.description}</p>
              <ul className="quickpick-criteria">
                {preset.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
              </ul>
              <p className="filter-note warning quickpick-honesty">
                <Info size={13} weight="bold" aria-hidden />{preset.honesty}
              </p>
            </div>}
          </div>
        </FilterCard>

        <FilterCard title="Stufe" aside={custom ? "eigene Werte – die Zahlen gelten nicht" : undefined}>
          <fieldset className="quickpick-options quickpick-levels">
            <legend className="visually-hidden">Strengestufe</legend>
            <div className="quickpick-level-head" aria-hidden>
              <span />
              <span>{kennzahlLabel}</span>
              <span>je Tag</span>
            </div>
            {preset.levels.map((level) => {
              const checked = exactLevel === level.id;
              const kennzahl = preset.kennzahlOf(level.measured);
              const proTag = level.measured === null ? "–" : formatDecimal(level.measured.proTag);
              return <label key={level.id} className={`quickpick-option quickpick-level${checked ? " checked" : ""}`}
                title={kennzahl.titel}>
                <input className="visually-hidden" type="radio" name="quickpick-level" value={level.id}
                  aria-label={`${level.label}: ${kennzahlLabel} ${kennzahl.wert}, ${proTag} Spiele je Tag`}
                  checked={checked} readOnly onClick={() => chooseLevel(level.id)} />
                <span className="quickpick-option-label">{level.label}</span>
                <span className="quickpick-level-value">{kennzahl.wert}</span>
                <span className="quickpick-level-value">{proTag}</span>
              </label>;
            })}
          </fieldset>
          <p className="filter-note">{baseEntry.hint}</p>
          <div className="filter-card-rule">
            <div className="quickpick-disclosures">
              <Disclosure label="Kombi-Chancen" title="Was Kombis aus dieser Stufe gebracht hätten"
                open={kombiOpen} onToggle={() => setKombiOpen((value) => !value)} />
              <Disclosure label="Werte anpassen" open={paramsOpen}
                onToggle={() => setParamsOpen((value) => !value)} />
            </div>

            {/*
              Die Kombi-Tabelle: Sie ist die Antwort auf die Frage, die eine hohe Quote aufwirft -
              und die Spalte „erwartet" zeigt, dass eine Kombi den Ertrag je Tipp multipliziert,
              nicht die Quote. „geht durch“ steht vorn: Nur diese Zahl ist belastbar.
            */}
            {kombiOpen && <section aria-label="Kombi-Chancen" className="quickpick-kombis">
              <strong>Was Kombis aus dieser Stufe gebracht hätten</strong>
              {kombis.length === 0
                ? <small>Für diese Stufe wurde noch nichts an alten Spielen geprüft.</small>
                : <>
                  <table>
                    <thead>
                      <tr>
                        <th>Spiele</th><th>geht durch</th><th>Quote Ø</th><th>Gewinn</th>
                        <th title="Was bei diesem Gewinn je Tipp eigentlich herauskommen müsste.">erwartet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kombis.map((kombi) => <tr key={kombi.beine}>
                        <td>{kombi.beine}</td>
                        <td className="durch">{formatPercent(kombi.trefferquote)}</td>
                        <td>{kombi.quote.toFixed(1).replace(".", ",")}</td>
                        <td>{formatSigned(kombi.roi)}</td>
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

            {paramsOpen && <section aria-label="Werte" className="quickpick-setup">
              <div className="quickpick-setup-head">
                <span>{custom
                  ? "Geändert – die Zahlen auf den Stufen gelten dann nicht mehr."
                  : `Werte der Stufe ${baseEntry.label}`}</span>
                <button type="button" className="filter-reset quickpick-reset" disabled={!custom}
                  onClick={resetToLevel}>
                  Auf Stufe zurücksetzen
                </button>
              </div>
              <div className="quickpick-params">
                {params.map((param) => <ParamRow key={param.id} param={param}
                  value={current[param.id] as number}
                  base={baseOf(param)}
                  changed={changedParam(param)}
                  onChange={(next) => setParam(param, next)} />)}
              </div>
              {toggles.length > 0 && <div className="quickpick-toggles">
                {toggles.map((toggle) => <FilterSwitch key={toggle.id} label={toggle.label}
                  note={toggle.title} checked={current[toggle.id] as boolean}
                  onChange={(value) => activate({ ...settings, [toggle.id]: value } as QuickpickSettings)} />)}
              </div>}
            </section>}
          </div>
        </FilterCard>
      </div>

      <FilterCard title="Gefundene Spiele" className="quickpick-results"
        aside={<FilterSegment<SortKey> name="quickpick-sort" legend="Sortiert nach" className="quickpick-sort"
          value={sortKey} onChange={setSortKey} options={SORT_OPTIONS} />}>
        <div className="quickpick-list">
          {sorted.map((row) => {
            const open = openRow === row.fixture.fixtureId;
            const strength = strengthOf(preset.id, row);
            const pickCell = pick.cell(row);
            const oddsCell = odds.cell(row);
            return <div key={row.fixture.fixtureId} className="quickpick-entry">
              <button type="button" className={open ? "quickpick-row open" : "quickpick-row"}
                aria-expanded={open}
                onClick={() => setOpenRow(open ? null : row.fixture.fixtureId)}>
                <span className="quickpick-when">
                  <small>{kickoff(row.fixture.kickoff)}</small>
                  <small className="quickpick-league">{leagueName(row.fixture, names)}</small>
                </span>
                <span className="quickpick-match">
                  <strong>{teamName(row.fixture, "home", names)} – {teamName(row.fixture, "away", names)}</strong>
                  <span className="quickpick-pick" title={pickCell.mainTitle}>{pickCell.main}</span>
                  {pickCell.note === undefined ? null
                    : <small className="quickpick-pick-note">{pickCell.note}</small>}
                </span>
                <small className="quickpick-strength" title={strength?.title}>
                  {strength === null ? "–" : strength.label}
                </small>
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
          {sorted.length === 0 && <div className="quickpick-empty">
            <p>{preset.leerSatz}</p>
            {rejections.length > 0 && <>
              <small>Woran es am häufigsten scheitert:</small>
              {rejectionList(3)}
            </>}
          </div>}
        </div>
        {sorted.length > 0 && <div className="filter-card-rule">
          <Disclosure label={rejectedCount === 1
            ? "Woran das übrige Spiel scheitert"
            : `Woran die übrigen ${rejectedCount} Spiele scheitern`}
            open={rejectionsOpen} onToggle={() => setRejectionsOpen((value) => !value)} />
          {rejectionsOpen && rejectionList()}
        </div>}
      </FilterCard>
    </div>

    <div className="quickpick-footer">
      <p className="filter-note warning quickpick-warning">
        <Info size={13} weight="bold" aria-hidden />{preset.warnung}
      </p>
      {estimatedCount > 0 && <small className="quickpick-cart-note"
        title="Für diese Spiele ist die Quote nur gerechnet, nicht gespeichert. Nach der nächsten Analyse fällt das weg.">
        {estimatedCount} ohne echte Quote
      </small>}
      {startedCount > 0 && <small className="quickpick-cart-note"
        title="Die Quote stammt von vor dem Anpfiff und gilt nicht mehr.">
        {startedCount} schon angepfiffen
      </small>}
      {cartFeedback && <p className="quickpick-cart-feedback" role="status">
        {feedbackParts(cartFeedback, names).map((part, index) => <span key={part.label} title={part.title}>
          {index > 0 && " · "}<strong>{part.count}</strong> {part.label}
        </span>)}
        {canUndoCart && onUndoCart && <> · <button type="button" className="cart-link" onClick={onUndoCart}>Rückgängig</button></>}
        {onOpenCart && <> · <button type="button" className="cart-link" onClick={onOpenCart}>
          Wettschein öffnen<span aria-hidden> ›</span>
        </button></>}
      </p>}
      <button type="button" className="quickpick-cart" disabled={spielbar.length === 0}
        title={preset.wettschein.hinweis}
        onClick={() => onAddAll(spielbar)}>
        <Ticket size={14} weight="bold" aria-hidden />
        {cartLabel}
      </button>
    </div>
  </div>;
}
