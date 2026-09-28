import { CaretRight, Info, MagnifyingGlass, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { countryFlagCode } from "./countryFlags";

export type LevelFilter = "all" | "strong" | "recommended";
export type ClassGapFilter = "all" | "only" | "hide";

export const FILTER_MENU_ID = "filter-menu";

/**
 * Öffnet das Filtermenü. Der Zähler ist die Zahl der Schildchen darunter - beide sagen, wie viele
 * Filter gerade Spiele ausblenden oder den Umfang ändern.
 */
export function FilterButton({ open, activeCount, onToggle, buttonRef }: {
  open: boolean;
  activeCount: number;
  onToggle(): void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return <button ref={buttonRef} type="button" className={`filter-trigger${open ? " open" : ""}`}
    aria-label={activeCount > 0 ? `Filter, ${activeCount} aktiv` : "Filter"}
    aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? FILTER_MENU_ID : undefined}
    onClick={onToggle}>
    <SlidersHorizontal size={15} weight="bold" aria-hidden /> Filter
    {activeCount > 0 && <span className="filter-count" aria-hidden>{activeCount}</span>}
  </button>;
}

/**
 * Ein aktiver Filter bei geschlossenem Menü. Der Text öffnet, das ✕ hebt auf - ein Filter, der
 * sich nur über einen Umweg abschalten lässt, bleibt versehentlich an.
 */
export function FilterChip({ label, title, clearLabel, onOpen, onClear }: {
  label: string;
  title?: string;
  clearLabel: string;
  onOpen(): void;
  onClear(): void;
}) {
  return <span className="filter-chip">
    <button type="button" className="filter-chip-label" onClick={onOpen} title={title}>{label}</button>
    <button type="button" className="filter-chip-clear" aria-label={clearLabel} title={clearLabel}
      onClick={onClear}><X size={11} weight="bold" aria-hidden /></button>
  </span>;
}

/**
 * Ein Schalter statt einer Checkbox: "an" heißt im Menü überall "Filter aktiv" oder "Anzeige an".
 * Die Unterzeile steht außerhalb des Labels, damit sie nicht zum Namen des Schalters wird.
 */
export function FilterSwitch({ label, note, warning, checked, onChange }: {
  label: string;
  note?: string;
  /** Die Unterzeile ist eine Warnung und trägt ein Hinweiszeichen. */
  warning?: boolean;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  const noteId = useId();
  return <div className="filter-switch-row">
    <label className="filter-switch">
      <span>{label}</span>
      <input className="visually-hidden" type="checkbox" role="switch" checked={checked}
        aria-describedby={note ? noteId : undefined} onChange={(event) => onChange(event.target.checked)} />
      <span className="filter-switch-track" aria-hidden />
    </label>
    {note && <p className={`filter-note${warning ? " warning" : ""}`} id={noteId}>
      {warning && <Info size={13} weight="bold" aria-hidden />}{note}
    </p>}
  </div>;
}

/**
 * Eine Karte im Stil der Vorlage: kleiner grauer Titel, rechts daneben der wirksame Stand
 * ("bis Di 29.09., 11:00", "Markt: Über 2,5"), darunter die Bedienelemente.
 */
function FilterCard({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return <div className="filter-card">
    {(title || aside) && <div className="filter-card-head">
      {title && <h4>{title}</h4>}
      {aside && <span className="filter-card-aside">{aside}</span>}
    </div>}
    {children}
  </div>;
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Voller Name, wenn die sichtbare Beschriftung verkürzt ist ("Nur mit" → "Nur mit Klassenunterschied"). */
  ariaLabel?: string;
  title?: string;
}

/** Segmentschalter für 2-4 feste Werte, die sich ausschließen - statt einer Auswahlliste. */
export function FilterSegment<T extends string>({ name, legend, options, value, onChange, disabled, note }: {
  name: string;
  legend: string;
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange(value: T): void;
  disabled?: boolean;
  note?: ReactNode;
}) {
  return <fieldset className="filter-field" disabled={disabled}>
    <legend>{legend}</legend>
    <div className="segmented filter-seg">
      {options.map((option) => <label key={option.value} title={option.title}>
        <input className="visually-hidden" type="radio" name={name} value={option.value}
          checked={value === option.value} aria-label={option.ariaLabel} onChange={() => onChange(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>
    {note && <p className="filter-note">{note}</p>}
  </fieldset>;
}

export interface LeagueEntry {
  key: string;
  country: string;
  league: string;
}

const QUICK_SEARCH_LIMIT = 8;

/**
 * Wettbewerbe ohne das große Fenster: tippen, abhaken oder "nur" - für den häufigsten Fall
 * "nur diese eine Liga". Das Fenster mit den Liga-Werten bleibt für die Auswahl nach Zahlen.
 */
function LeagueQuickSearch({ leagues, deselected, selected, hideHits, onToggle, onOnly, onOpenList }: {
  leagues: ReadonlyArray<LeagueEntry>;
  deselected: ReadonlySet<string>;
  selected: { selected: number; total: number };
  /** Während das große Fenster offen ist, trägt es dieselben Häkchen - keine doppelten Namen. */
  hideHits: boolean;
  onToggle(key: string): void;
  onOnly(key: string): void;
  onOpenList(): void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const hits = needle ? leagues.filter((item) => `${item.country} ${item.league}`.toLowerCase().includes(needle)) : [];
  const all = selected.selected === selected.total;
  return <div className="league-quick">
    {/* Ein Feld für eine Sache: links suchen, rechts die ganze Liste mit den Liga-Werten. */}
    <div className="league-field">
      <MagnifyingGlass size={14} weight="bold" aria-hidden />
      <input type="search" className="league-quick-input" placeholder="Wettbewerb suchen…"
        aria-label="Wettbewerb schnell suchen" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" className={`league-filter-trigger${all ? "" : " active"}`}
        aria-label="Wettbewerbe auswählen" aria-haspopup="dialog" onClick={onOpenList}>
        {all ? <>Alle {selected.total}<span className="visually-hidden"> Wettbewerbe</span></>
          : <>{selected.selected} von {selected.total}<span className="visually-hidden"> Wettbewerben</span></>}
        <CaretRight size={12} weight="bold" aria-hidden />
      </button>
    </div>
    {needle && !hideHits && <ul className="league-quick-hits">
      {hits.slice(0, QUICK_SEARCH_LIMIT).map((item) => {
        const name = `${item.country} · ${item.league}`;
        const code = countryFlagCode(item.country);
        return <li key={item.key}>
          <label className="check-row">
            <input type="checkbox" checked={!deselected.has(item.key)} onChange={() => onToggle(item.key)} />
            {code && <span className={`fi fi-${code} country-flag`} aria-hidden />}
            <span className="league-quick-name">{name}</span>
          </label>
          <button type="button" className="league-quick-only" aria-label={`Nur ${name} zeigen`}
            onClick={() => onOnly(item.key)}>nur</button>
        </li>;
      })}
      {hits.length === 0 && <li className="filter-note">Kein Wettbewerb gefunden.</li>}
      {hits.length > QUICK_SEARCH_LIMIT && <li className="filter-note">… und {hits.length - QUICK_SEARCH_LIMIT} weitere – genauer suchen</li>}
    </ul>}
  </div>;
}

export interface FilterMenuValues {
  variant: "prematch" | "live";
  levelFilter: LevelFilter;
  counts: { all: number; strong: number; recommended: number };
  /** Beschriftung des gewählten Marktes, `null` bei "Alle Märkte". */
  marketLabel: string | null;
  classGapFilter: ClassGapFilter;
  showCrossLeague: boolean;
  showPast: boolean;
  showKelly: boolean;
  liveRatedOnly: boolean;
  leagues: { selected: number; total: number };
  leagueList: ReadonlyArray<LeagueEntry>;
  deselectedLeagues: ReadonlySet<string>;
  leagueFilterOpen: boolean;
  watched: { count: number; total: number };
  /** Zahl der Spiele, die die Tabelle gerade zeigt (`filtered`). */
  shown: number;
  /** Wirksamer Zeitraum für den Kartenkopf: "bis Di 29.09., 11:00" oder die gewählten Tage. */
  rangeSummary: string;
  resetDisabled: boolean;
}

export interface FilterMenuActions {
  setLevelFilter(value: LevelFilter): void;
  setClassGapFilter(value: ClassGapFilter): void;
  setShowCrossLeague(value: boolean): void;
  setShowPast(value: boolean): void;
  setShowKelly(value: boolean): void;
  setLiveRatedOnly(value: boolean): void;
  openLeagueFilter(): void;
  toggleLeague(key: string): void;
  /** Wählt alle anderen Wettbewerbe ab. */
  selectOnlyLeague(key: string): void;
  reset(): void;
  close(): void;
}

// Nach Strenge geordnet: Jede Stufe enthält die folgende. Der Zusatz in Klammern steht nur für
// Screenreader im Namen; sichtbar tragen die Kacheln die Stufenzeichen neben der Zahl.
const LEVELS: ReadonlyArray<{ key: LevelFilter; label: string; hint?: string; marks: ReadonlyArray<"green" | "gold"> }> = [
  { key: "all", label: "Alle Spiele", marks: [] },
  { key: "recommended", label: "Empfehlungen", hint: "(✓ und ★)", marks: ["green", "gold"] },
  { key: "strong", label: "Starke Tipps", hint: "(nur ★)", marks: ["gold"] }
];

const CLASS_GAP_OPTIONS: ReadonlyArray<SegmentOption<ClassGapFilter>> = [
  { value: "all", label: "Alle" },
  { value: "only", label: "Nur mit", ariaLabel: "Nur mit Klassenunterschied" },
  { value: "hide", label: "Ohne", ariaLabel: "Ohne Klassenunterschied" }
];

/**
 * Das Filtermenü: ein nicht-modales Fenster über der Tabelle. Es verdrängt nichts, und jede
 * Änderung wirkt sofort - alles rechnet auf dem geladenen Snapshot und kostet kein API-Budget.
 * Zustand und Schließregeln liegen beim Dashboard; hier steht nur die Darstellung.
 *
 * Zwei Spalten in Lesereihenfolge des Datenflusses: links der Umfang (`scopedFixtures`, gilt auch
 * für Kelly und Quickpick), rechts, was nur Tabelle und Heatmap eingrenzt, und die Anzeige. So steht die
 * Ursache "Nur Ligaspiele" vor ihrer Wirkung, dem abgeschalteten Klassenunterschied.
 */
export function FilterMenu({ values, actions, rangeControl, displayControls }: {
  values: FilterMenuValues;
  actions: FilterMenuActions;
  /** Der Zeitraumblock mit den Tageskacheln, fertig aus dem Dashboard. */
  rangeControl?: ReactNode;
  /** Punkte in Form und H2H samt Linie; ihre Kopplung an den Markt bleibt im Dashboard. */
  displayControls?: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const reset = () => {
    actions.reset();
    // Der fokussierte Knopf wird gleich abgeschaltet - der Fokus soll nicht ins Leere fallen.
    headingRef.current?.focus();
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };
  const leagueField = <LeagueQuickSearch leagues={values.leagueList} deselected={values.deselectedLeagues}
    selected={values.leagues} hideHits={values.leagueFilterOpen} onToggle={actions.toggleLeague}
    onOnly={actions.selectOnlyLeague} onOpenList={actions.openLeagueFilter} />;
  const kellyToggle = <FilterSwitch label="Vorteil & Kelly-Einsatz anzeigen" warning
    note="Ein großer Vorteil ist meist ein Fehler des Modells."
    checked={values.showKelly} onChange={actions.setShowKelly} />;
  const live = values.variant === "live";

  return <div className={`filter-menu${live ? " single" : ""}`} id={FILTER_MENU_ID} role="dialog" aria-label="Filter">
    <div className="filter-menu-head">
      <h2 ref={headingRef} tabIndex={-1}>Filter</h2>
      {/* Die Folge jeder Änderung dort, wo man beim Filtern hinschaut - die Statuszeile liegt
          unter dem Menü. Kein aria-live: Die Statuszeile meldet die Zahl schon. */}
      <p className="filter-menu-count">
        {live
          ? <>Beobachtet <strong>{values.watched.count}</strong> von {values.watched.total}</>
          : <><strong>{values.shown}</strong> {values.shown === 1 ? "Spiel" : "Spiele"} angezeigt</>}
      </p>
      {/* Im Kopf statt in einer eigenen Fußzeile: spart die Zeile, die das Menü sonst zum
          Scrollen brachte. */}
      <button type="button" className="filter-reset" aria-label="Alle Filter zurücksetzen"
        title={live ? "Danach werden wieder alle Spiele beobachtet." : undefined}
        disabled={values.resetDisabled} onClick={reset}>Zurücksetzen</button>
      <button type="button" className="filter-menu-close" aria-label="Filter schließen" title="Filter schließen"
        onClick={actions.close}><X size={14} weight="bold" aria-hidden /></button>
    </div>
    <div className="filter-menu-body" ref={bodyRef}>
      {!live ? <>
        <div className="filter-column">
          <section className="filter-group">
            <div className="filter-group-head"><h3>Umfang</h3><span>gilt auch für Kelly und Quickpick</span></div>
            <FilterCard title="Zeitraum" aside={values.rangeSummary}>
              {rangeControl}
              <div className="filter-card-rule">
                <FilterSwitch label="Angepfiffene Spiele zeigen" checked={values.showPast} onChange={actions.setShowPast} />
              </div>
            </FilterCard>
            <FilterCard title="Wettbewerbe">
              {leagueField}
              <div className="filter-card-rule">
                {/* Umgedreht gegenüber der früheren Checkbox: "an" ist der Filter, ab Werk aus. */}
                <FilterSwitch label="Nur Ligaspiele" note="ohne Pokalspiele und Spiele zwischen Ligen"
                  checked={!values.showCrossLeague} onChange={(value) => actions.setShowCrossLeague(!value)} />
              </div>
            </FilterCard>
          </section>
        </div>
        <div className="filter-column">
          <section className="filter-group">
            <div className="filter-group-head"><h3>Nur Tabelle und Heatmap</h3></div>
            <FilterCard title="Bewertung" aside={values.marketLabel ? `Markt: ${values.marketLabel}` : undefined}>
              <fieldset className="filter-tiles">
                <legend className="visually-hidden">Bewertung</legend>
                {LEVELS.map(({ key, label, hint, marks }) => {
                  const checked = values.levelFilter === key;
                  return <label key={key} className={`filter-tile${checked ? " checked" : ""}`}>
                    <input className="visually-hidden" type="radio" name="level-filter" value={key} checked={checked}
                      onChange={() => actions.setLevelFilter(key)} />
                    <span className="filter-tile-label">{label}{hint && <span className="visually-hidden"> {hint}</span>}</span>
                    <span className="filter-tile-value">
                      <strong>{values.counts[key]}</strong>
                      {marks.length > 0 && <span className="filter-tile-marks" aria-hidden>
                        {marks.map((tone) => <span key={tone} className={tone}>{tone === "gold" ? "★" : "✓"}</span>)}
                      </span>}
                    </span>
                  </label>;
                })}
              </fieldset>
              {/* Abgesetzt wie "Nur Ligaspiele" in der Karte Wettbewerbe: kein Teil der Stufenwahl. */}
              <div className="filter-card-rule">
                <FilterSegment name="class-gap" legend="Klassenunterschied" value={values.classGapFilter}
                  onChange={actions.setClassGapFilter} disabled={!values.showCrossLeague}
                  options={CLASS_GAP_OPTIONS}
                  note={values.showCrossLeague ? undefined : "Greift nicht, solange „Nur Ligaspiele“ an ist."} />
              </div>
            </FilterCard>
          </section>
          <section className="filter-group">
            <div className="filter-group-head"><h3>Anzeige</h3></div>
            <FilterCard>
              {displayControls}
              {displayControls ? <div className="filter-card-rule">{kellyToggle}</div> : kellyToggle}
            </FilterCard>
          </section>
        </div>
      </> : <div className="filter-column">
        <section className="filter-group">
          <div className="filter-group-head"><h3>Beobachtete Spiele</h3></div>
          <FilterCard title="Wettbewerbe">
            {leagueField}
            <div className="filter-card-rule">
              <FilterSwitch label="Nur Spiele mit Empfehlung" checked={values.liveRatedOnly} onChange={actions.setLiveRatedOnly} />
              {/* Wie viele beobachtet werden, steht schon im Kopf. */}
              <p className="filter-note">Abgewählte kosten keine API-Aufrufe.</p>
            </div>
          </FilterCard>
        </section>
        <section className="filter-group">
          <div className="filter-group-head"><h3>Anzeige</h3></div>
          <FilterCard>{kellyToggle}</FilterCard>
        </section>
      </div>}
    </div>
  </div>;
}
