import { Copy, Info, Minus, Plus, Shuffle, Ticket, X } from "@phosphor-icons/react";
import {
  useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref
} from "react";
import { MARKET_GROUPS, formatOdd, levelGlyph, marketGroupOf } from "./App";
import {
  COMBO_WARNING, canGenerate, cartEntryId, comboCopyText, fixtureCount, generateCombos, isPlayable, requestedTotal,
  selectionLabel, shortTipLabel, toCounterCartEntry,
  type CartChange, type CartEntry, type Combo, type ComboFillMode, type ComboSetup, type ComboSizeConfig
} from "./betCart";
import { FilterCard, FilterSegment, type SegmentOption } from "./FilterMenu";
import { QUICKPICK_PRESETS } from "./quickpick";
import { leagueName, selectionText, teamName, useNames, type NameSource } from "../../shared/src/names";
import type { DashboardFixture, DashboardMarket } from "../../shared/src/types";

/**
 * Schreibt die kopierten Kombis zusätzlich nach `data/tmp/kombis.md` (Endpunkt in
 * `apps/shared/server/endpoints.ts`) und liefert den Dateipfad. Scheitert das - etwa ohne
 * App-Server -, bleibt es still bei der Zwischenablage.
 */
async function saveComboMarkdown(text: string): Promise<string | null> {
  try {
    const response = await fetch("/api/combos/markdown", {
      method: "POST", headers: { "Content-Type": "text/markdown; charset=utf-8" }, body: text
    });
    if (!response.ok) return null;
    const body = await response.json() as { file?: unknown };
    return typeof body.file === "string" ? body.file : null;
  } catch {
    return null;
  }
}

/** Abstand der Liste zum Knopf und zum Fensterrand. */
const MENU_GAP = 6;
const MENU_MARGIN = 8;

interface Box { left: number; top: number; right: number; bottom: number }

/**
 * Wo die Marktliste steht: rechts neben dem Knopf, oben auf Höhe der Zeile. Reicht der Platz
 * nach unten nicht, klappt sie nach oben; reicht er rechts nicht, steht sie links vom Knopf.
 * Eine Liste, die höher als das Fenster ist, beginnt am oberen Rand und scrollt selbst.
 */
export function menuPlacement(
  trigger: Box,
  menu: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  let left = trigger.right + MENU_GAP;
  if (left + menu.width > viewport.width - MENU_MARGIN) {
    left = Math.max(MENU_MARGIN, trigger.left - MENU_GAP - menu.width);
  }
  let top = trigger.top - 4;
  if (top + menu.height > viewport.height - MENU_MARGIN) top = trigger.bottom + 4 - menu.height;
  return { left, top: Math.max(MENU_MARGIN, top) };
}

/** 1X2 nennt die Seite des Tipps, alle anderen Märkte tragen sie schon im Namen. */
function menuLabel(market: DashboardMarket): string {
  if (market.key === "1x2") return `1X2 · ${market.pick === "2" ? "Gast" : "Heim"}`;
  return market.label;
}

/** Ein Eintrag der Liste: ein Markt, beim 1X2 zusätzlich die Seite gegen den Modelltipp. */
interface MenuItem {
  market: DashboardMarket;
  /** Gesetzt nur für die Gegenseite; der Modelltipp trägt seine Seite in `market.pick`. */
  counterSide: "1" | "2" | null;
  label: string;
  /** Nur Anzeige, nach Namens-Einstellung. Hineingelegt wird über `market` und `counterSide`. */
  selection: string;
  odds: number | null;
}

function menuItems(fixture: DashboardFixture, market: DashboardMarket, names: NameSource): MenuItem[] {
  const own: MenuItem = { market, counterSide: null, label: menuLabel(market), selection: selectionText(fixture, market, names), odds: market.odds };
  const counter = toCounterCartEntry(fixture, market);
  if (!counter?.pick) return [own];
  return [own, {
    market,
    counterSide: counter.pick,
    label: `1X2 · ${counter.pick === "2" ? "Gast" : "Heim"}`,
    selection: selectionText(fixture, { key: "1x2", pick: counter.pick, selection: counter.selection }, names),
    odds: counter.odds
  }];
}

/** Was beim Hineinlegen geschah - für die Fußzeile der Liste. */
export interface CartPutFeedback {
  entry: CartEntry;
  replaced: CartEntry[];
}

/**
 * Marktauswahl am „+“-Knopf (seit 30.09.2026 statt des Radialmenüs, Davids Wunsch): eine
 * senkrechte Liste im Leistenstil wie die Marktliste der Werkzeugleiste, gruppiert wie diese.
 * Öffnet per Klick, nicht beim Überfahren - sonst ging beim Weg über die Tabelle ständig etwas
 * auf. Bleibt nach dem Hinzufügen offen, damit mehrere Märkte eines Spiels ohne neues Öffnen
 * gehen; ein Markt im Wettschein trägt den grünen Balken, ein zweiter Klick nimmt ihn heraus.
 * Beim 1X2 steht unter dem Modelltipp auch die andere Seite (seit 06.10.2026, Davids Wunsch).
 * Gegensätze ersetzen einander (seit 11.10.2026); die Fußzeile sagt dann, was ersetzt wurde,
 * und ein Klick auf den alten Markt legt ihn zurück. Nach dem Anpfiff ist der Knopf gesperrt -
 * die Quote stammt von vorher.
 */
export function CartAddMenu({ fixture, cart, open, started = false, onOpen, onClose, onSelect, onRemove, compact = false }: {
  fixture: DashboardFixture;
  cart: CartEntry[];
  open: boolean;
  /** Schon angepfiffen: Die Quote gilt nicht mehr, der Knopf ist gesperrt. */
  started?: boolean;
  onOpen(): void;
  onClose(): void;
  /** `counterSide` ist gesetzt, wenn die 1X2-Seite gegen den Modelltipp gewählt wurde. */
  onSelect(market: DashboardMarket, counterSide: "1" | "2" | null): CartPutFeedback | null;
  onRemove(market: DashboardMarket): void;
  /** Für die 34-px-Zeile der Heatmap: ein kleinerer Knopf. */
  compact?: boolean;
}) {
  const hubRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Die Rückrufe kommen als Inline-Funktionen an und wechseln bei jedem Rendern die
  // Identität; über die Referenz bleiben die Fensterlauscher trotzdem stabil.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Vor dem ersten Zeichnen messen, damit die Liste nicht sichtbar an die richtige Stelle springt.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      setNote(null);
      return;
    }
    const measure = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      setPosition(menuPlacement(trigger.getBoundingClientRect(),
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }));
    };
    measure();
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitemcheckbox']")?.focus({ preventScroll: true });
    const closeOnOutside = (event: PointerEvent) => {
      if (!hubRef.current?.contains(event.target as Node)) closeRef.current();
    };
    // Die Liste hängt an festen Fensterkoordinaten, die Zeile darunter scrollt weiter.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    window.addEventListener("pointerdown", closeOnOutside);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [open]);

  // Beim 1X2 entscheidet zusätzlich die Seite: Beide Einträge teilen sich eine Kennung.
  const inCart = ({ market, counterSide }: MenuItem) => cart.some((entry) =>
    entry.id === cartEntryId(fixture.fixtureId, market.key)
    && (market.key !== "1x2" || entry.pick === (counterSide ?? market.pick)));
  const count = fixture.markets.filter((market) => cart.some((entry) => entry.id === cartEntryId(fixture.fixtureId, market.key))).length;
  const names = useNames();
  const partie = `${teamName(fixture, "home", names)} – ${teamName(fixture, "away", names)}`;
  const groups = MARKET_GROUPS
    .map((group) => ({ group, markets: fixture.markets.filter((market) => marketGroupOf(market.key) === group) }))
    .filter((item) => item.markets.length > 0);

  const select = (market: DashboardMarket, counterSide: "1" | "2" | null) => {
    const feedback = onSelect(market, counterSide);
    setNote(feedback && feedback.replaced.length > 0
      ? `${shortTipLabel(feedback.entry, names)} ersetzt ${feedback.replaced.map((entry) => shortTipLabel(entry, names)).join(", ")}`
      : null);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // Sonst schlösse der Escape-Lauscher der App danach noch die aufgeklappte Zeile.
      event.stopPropagation();
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      onClose();
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemcheckbox']") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === "ArrowDown" ? items[(index + 1) % items.length]
      : event.key === "ArrowUp" ? items[(index - 1 + items.length) % items.length]
      : event.key === "Home" ? items[0]
      : event.key === "End" ? items.at(-1)
      : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const footText = note ?? (count > 0 ? `${count} im Wettschein` : "");

  return <div ref={hubRef} className={`cart-add-hub${open ? " open" : ""}${compact ? " compact" : ""}`}>
    <button
      ref={triggerRef}
      type="button"
      className={`cart-add${count > 0 ? " has-entries" : ""}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={count > 0
        ? `In den Wettschein legen: ${partie} (${count} im Wettschein)`
        : `In den Wettschein legen: ${partie}`}
      title={started ? "Schon angepfiffen – die Quote gilt nicht mehr." : "Märkte dieses Spiels in den Wettschein legen"}
      disabled={started && !open}
      onClick={() => open ? onClose() : onOpen()}
    >
      {count > 0 ? count : "+"}
    </button>

    {open && <div
      ref={menuRef}
      className="cart-menu"
      role="menu"
      aria-label={`Markt hinzufügen: ${partie}`}
      // Bis zur ersten Messung unsichtbar, damit nichts an falscher Stelle aufblitzt.
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
      onKeyDown={onMenuKeyDown}
    >
      <div className="cart-menu-head">
        <strong>In den Wettschein</strong>
        <span>{partie}</span>
      </div>
      {groups.map(({ group, markets }) => <div className="cart-menu-group" role="group" aria-label={group} key={group}>
        <div className="cart-menu-group-title" aria-hidden>{group}</div>
        {markets.flatMap((market) => menuItems(fixture, market, names)).map((item) => {
          const { market, counterSide, selection } = item;
          const added = inCart(item);
          // Ohne Quote kein Preis - hinein kommt so ein Tipp nicht, heraus darf er immer.
          const blocked = !added && item.odds === null;
          const level = counterSide === null ? market.recommendation.level : "none";
          const text = counterSide === null
            ? `${item.label} · ${selection}, Quote ${formatOdd(item.odds)}`
            : `${item.label} · ${selection} gegen den Modelltipp, Quote ${formatOdd(item.odds)}`;
          return <button
            type="button"
            key={`${market.key}:${counterSide ?? "tipp"}`}
            role="menuitemcheckbox"
            aria-checked={added}
            aria-disabled={blocked || undefined}
            className={`cart-menu-item ${level}`}
            aria-label={added ? `${text} – aus dem Wettschein nehmen`
              : blocked ? `${text} – keine Quote`
              : `${text} – in den Wettschein`}
            title={blocked ? "Keine Quote – kommt nicht in den Wettschein."
              : counterSide === null ? `${selection} · ${market.recommendation.label}`
              : `${selection} · gegen den Modelltipp`}
            onClick={() => {
              if (added) onRemove(market);
              else if (!blocked) select(market, counterSide);
            }}
          >
            <span className="cart-menu-label">
              {item.label}
              {counterSide !== null && <span className="cart-menu-hint">Modell dagegen</span>}
            </span>
            <span className="level-glyph" aria-hidden>{level === "none" ? "" : levelGlyph(level)}</span>
            <span className="cart-menu-odds">{formatOdd(item.odds)}</span>
          </button>;
        })}
      </div>)}
      <div className="cart-menu-foot" aria-live="polite">{footText}</div>
    </div>}
  </div>;
}

export const CART_WINDOW_ID = "bet-slip";

/**
 * Öffnet den Wettschein - rechts in der Werkzeugleiste, gebaut wie der Filter-Knopf. Immer da,
 * auch leer: Ein Knopf, der erst mit dem ersten Tipp erscheint, findet man nicht. Offen heller
 * ohne Balken - offen ist keine Wahl.
 */
export function CartButton({ count, open, onToggle, buttonRef }: {
  count: number;
  open: boolean;
  onToggle(): void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return <button ref={buttonRef} type="button" className={`filter-trigger cart-trigger${open ? " open" : ""}`}
    aria-label={count > 0 ? `Wettschein öffnen, ${count} ${count === 1 ? "Tipp" : "Tipps"}` : "Wettschein öffnen"}
    aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? CART_WINDOW_ID : undefined}
    onClick={onToggle}>
    <Ticket size={15} weight="bold" aria-hidden /> Wettschein
    {count > 0 && <span className="filter-count" aria-hidden>{count}</span>}
  </button>;
}

/** Bis zu dieser Größe stehen die Kombis offen da; Davids Kombis haben vier bis sieben Spiele. */
const VISIBLE_MAX_SIZE = 8;

const MODE_OPTIONS: ReadonlyArray<SegmentOption<ComboFillMode>> = [
  {
    value: "einmalig", label: "Ohne", ariaLabel: "Ohne Wiederholung",
    title: "Jeder Tipp kommt höchstens einmal vor. Reicht der Wettschein nicht für alle Plätze, entsteht keine Kombi."
  },
  {
    value: "auffuellen", label: "Auffüllen", ariaLabel: "Mit Wiederholung auffüllen",
    title: "Erst kommt jeder Tipp einmal an die Reihe. Ist der Wettschein durch, wird von vorn aufgefüllt"
      + " – die letzte Kombi bekommt dann schon verwendete Tipps dazu."
  }
];

/** So lange zeigt ein Kopier-Knopf „Kopiert“. */
const COPIED_MS = 2000;

/**
 * Nur wenn die Zwischenablage fehlt oder ablehnt (kein sicherer Kontext, etwa Aufruf über eine
 * LAN-Adresse statt localhost): der Text, markiert zum Kopieren mit Strg+C. Im Erfolgsfall steht
 * er nicht im DOM - sonst stünde jeder Tipp doppelt im Wettschein.
 */
function CopyFallback({ label, text, onClose }: { label: string; text: string; onClose(): void }) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [text]);
  return <div className="cart-copy-fallback">
    <p className="filter-note warning">
      <Info size={13} weight="bold" aria-hidden />
      <span>Kopieren ging nicht. Der Text ist markiert – kopiere ihn mit Strg+C.</span>
      <button type="button" className="cart-remove" aria-label="Textfeld schließen" title="Schließen"
        onClick={onClose}><X size={12} weight="bold" aria-hidden /></button>
    </p>
    <textarea ref={fieldRef} readOnly value={text} aria-label={`Text zum Kopieren: ${label}`}
      rows={Math.min(12, text.split("\n").length)} />
  </div>;
}

function tips(count: number): string {
  return `${count} ${count === 1 ? "Tipp" : "Tipps"}`;
}

function feasibilityMessage(pool: CartEntry[], sizes: ComboSizeConfig[], mode: ComboFillMode): string | null {
  const active = sizes.filter((item) => item.count > 0);
  if (active.length === 0 || canGenerate(pool, sizes, mode)) return null;
  const games = fixtureCount(pool);
  const tooBig = Math.max(...active.map((item) => item.size));
  if (tooBig > games) {
    return `Eine ${tooBig}er-Kombi braucht ${tooBig} verschiedene Spiele, im Wettschein sind Tipps aus ${games}.`;
  }
  const needed = requestedTotal(active);
  if (needed > pool.length) {
    return `Dafür braucht es ${needed} Tipps, im Wettschein sind ${pool.length}.`
      + " Mit „Auffüllen“ reicht es auch für mehr Kombis.";
  }
  return "Zu viele Tipps stammen aus denselben Spielen – in eine Kombi kommt je Spiel nur einer."
    + " Mit „Auffüllen“ reicht es.";
}

/** Gruppiert die Tipps je Spiel, nach Anstoß. */
function byGame(cart: CartEntry[]): CartEntry[][] {
  const games = new Map<number, CartEntry[]>();
  for (const entry of cart) games.set(entry.fixtureId, [...(games.get(entry.fixtureId) ?? []), entry]);
  return [...games.values()].sort((left, right) => Date.parse(left[0]!.kickoff) - Date.parse(right[0]!.kickoff));
}

/**
 * Der Wettschein (seit 11.10.2026, Davids Entscheidungen nach zwei Entwürfen des UX-Agenten):
 * ein nicht-modales Fenster unter seinem Knopf rechts in der Werkzeugleiste, im Leistenstil wie
 * Filtermenü und Quickpicker. Seit 14.10.2026 über die ganze Breite der Leiste: oben ein Streifen
 * „Kombis bauen“, darunter links die Tipps je Spiel nach Anstoß, rechts breiter die gemischten
 * Kombis ungekürzt und kopierbar, unten immer die Warnung. Angepfiffene Tipps und Tipps ohne Quote
 * bleiben sichtbar, kommen aber in keine Kombi. Leeren und „Angepfiffene entfernen“ wirken
 * sofort und lassen sich zurücknehmen - statt einer Rückfrage vorher. Öffnen, Schließen und
 * Fokus regelt das Dashboard; die Kombis liegen dort, damit sie das Schließen überstehen.
 */
export function BetSlipWindow({
  cart, now, timezone, lastChange, setup, combos, combosStale, tipicoEventIds,
  onRemove, onRemoveStarted, onClear, onUndo, onSetupChange, onMix, onCombosChange, onClose
}: {
  cart: CartEntry[];
  now: number;
  timezone: string;
  lastChange: CartChange | null;
  setup: ComboSetup;
  combos: Combo[];
  /** Der Wettschein hat sich seit dem Mischen geändert. */
  combosStale: boolean;
  /** Tipico-Ereignis-IDs der geladenen Analyse je Fixture-ID, für die Links in der Kopie. */
  tipicoEventIds?: ReadonlyMap<number, string>;
  onRemove(id: string): void;
  onRemoveStarted(): void;
  onClear(): void;
  onUndo(): void;
  onSetupChange(next: ComboSetup): void;
  onMix(combos: Combo[]): void;
  onCombosChange(combos: Combo[]): void;
  onClose(): void;
}) {
  const names = useNames();
  const windowRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tipsHeadingRef = useRef<HTMLHeadingElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const combosRef = useRef<HTMLDivElement>(null);
  // Wohin der Fokus nach dem nächsten Zeichnen soll: ✕ eines Tipps, „Rückgängig“ oder die Karte.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  // Größere Kombis, die in diesem Fenster hinzugefügt wurden - sie bleiben stehen, auch wenn ihre
  // Anzahl wieder auf 0 geht, damit der Fokus nicht mit dem Feld verschwindet.
  const [addedSizes, setAddedSizes] = useState<number[]>([]);
  const [otherSize, setOtherSize] = useState("");
  const [announcement, setAnnouncement] = useState("");
  // Welcher Kopier-Knopf gerade „Kopiert“ zeigt: die Kennung einer Kombi oder „all“.
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState<{ key: string; label: string; text: string } | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  useEffect(() => { headingRef.current?.focus(); }, []);
  // Die Höhe richtet sich wie beim Quickpicker nach dem tatsächlichen Abstand vom oberen Rand.
  // Die Breite reicht seit 14.10.2026 vom Anfang der Werkzeugleiste bis zum Wettschein-Knopf
  // (Davids Wunsch: „darf gern die ganze Breite nutzen“). Gemessen statt per CSS, weil der Anker
  // sonst seinen Platz über dem abgedunkelten Hintergrund verlöre. In jsdom ist die Breite 0,
  // dann gilt die feste Breite aus dem CSS.
  useLayoutEffect(() => {
    const place = () => {
      const element = windowRef.current;
      if (!element) return;
      element.style.setProperty("--cart-top", `${Math.max(0, element.getBoundingClientRect().top)}px`);
      const row = element.closest(".toolbar-row");
      const anchor = element.parentElement;
      if (!row || !anchor) return;
      const span = anchor.getBoundingClientRect().right - row.getBoundingClientRect().left;
      if (span > 0) element.style.setProperty("--cart-width", `${span}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);
  useEffect(() => {
    if (pendingFocus === null) return;
    if (pendingFocus === "undo") undoRef.current?.focus();
    else if (pendingFocus === "tips") tipsHeadingRef.current?.focus();
    else windowRef.current?.querySelector<HTMLButtonElement>(`[data-remove="${pendingFocus}"]`)?.focus();
    setPendingFocus(null);
  }, [pendingFocus, cart]);

  const time = (value: string) => {
    const date = new Date(value);
    const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "short" }).format(date);
    const clock = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
    return `${weekday} ${clock}`;
  };
  const isStarted = (entry: CartEntry) => Date.parse(entry.kickoff) <= now;

  const games = byGame(cart);
  const ordered = games.flat();
  const startedCount = cart.filter(isStarted).length;
  const playable = cart.filter((entry) => isPlayable(entry, now));
  // Übertragene Kombis bleiben beim Mischen stehen - es sei denn, ein Spiel darin läuft schon.
  const kept = combos.filter((combo) => combo.transferred && !combo.entries.some(isStarted));
  const pool = setup.mode === "einmalig"
    ? playable.filter((entry) => !kept.some((combo) => combo.entries.some((item) => item.id === entry.id)))
    : playable;
  const gameCount = fixtureCount(pool);

  const highestCounted = Math.max(0, ...Object.entries(setup.counts).filter(([, count]) => count > 0).map(([size]) => Number(size)));
  const upper = Math.max(gameCount, highestCounted);
  const visibleSizes = Array.from({ length: Math.max(0, Math.min(VISIBLE_MAX_SIZE, upper) - 1) }, (_, index) => index + 2);
  const largerSizes = upper > VISIBLE_MAX_SIZE
    ? Array.from({ length: upper - VISIBLE_MAX_SIZE }, (_, index) => index + VISIBLE_MAX_SIZE + 1)
    : [];
  // Größere Kombis stehen nur einzeln da: gewählte und in diesem Fenster hinzugefügte. Bis
  // 14.10.2026 klappte eine gewählte 10er-Kombi alle Größen bis zur Zahl der Spiele auf - bei
  // 86 Tipps 77 Zeilen, die Kombis und „Kombis mischen“ aus dem Fenster schoben.
  const shownLarger = largerSizes.filter((size) => (setup.counts[size] ?? 0) > 0 || addedSizes.includes(size));
  const sizeConfig: ComboSizeConfig[] = [...visibleSizes, ...largerSizes].map((size) => ({ size, count: setup.counts[size] ?? 0 }));
  const comboTotal = sizeConfig.reduce((sum, item) => sum + item.count, 0);
  const places = requestedTotal(sizeConfig);
  const canMix = canGenerate(playable, sizeConfig, setup.mode, kept);
  const message = feasibilityMessage(pool, sizeConfig, setup.mode);
  const refill = setup.mode === "auffuellen" ? Math.max(0, places - pool.length) : 0;
  const transferredCount = combos.filter((combo) => combo.transferred).length;

  const setCount = (size: number, value: number) =>
    onSetupChange({ ...setup, counts: { ...setup.counts, [size]: Math.max(0, Math.floor(value) || 0) } });
  const otherValue = Math.floor(Number(otherSize));
  const otherValid = otherValue > VISIBLE_MAX_SIZE && otherValue <= upper;
  const addSize = () => {
    if (!otherValid) return;
    if (!addedSizes.includes(otherValue)) setAddedSizes([...addedSizes, otherValue]);
    if ((setup.counts[otherValue] ?? 0) === 0) setCount(otherValue, 1);
    setOtherSize("");
  };

  const remove = (id: string) => {
    const index = ordered.findIndex((entry) => entry.id === id);
    const next = ordered[index + 1] ?? ordered[index - 1];
    setPendingFocus(next ? next.id : "tips");
    onRemove(id);
  };
  const clear = () => {
    onClear();
    setPendingFocus("undo");
  };
  const mix = () => {
    const next = generateCombos(playable, sizeConfig, setup.mode, kept);
    onMix(next);
    const fresh = next.length - kept.length;
    setAnnouncement(`${fresh} ${fresh === 1 ? "Kombi" : "Kombis"} gemischt`);
    setCopyFallback(null);
    combosRef.current?.scrollTo?.({ top: 0 });
  };

  // Kopiert wird nur, was sich noch setzen lässt: Eine Kombi mit angepfiffenem Spiel trägt eine
  // Quote von vor dem Anpfiff (dieselbe Regel wie `isPlayable`). Kopieren markiert nicht als
  // übertragen - das bleibt ein eigener Klick.
  const numbered = combos.map((combo, index) => ({ combo, number: index + 1 }));
  const copyable = numbered.filter(({ combo }) => !combo.entries.some(isStarted));
  const copy = async (key: string, label: string, items: typeof numbered, done: string) => {
    const text = comboCopyText(items, names, timezone, tipicoEventIds);
    const saved = saveComboMarkdown(text);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Keine Zwischenablage");
      await navigator.clipboard.writeText(text);
      setCopyFallback(null);
      setCopied(key);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
      setAnnouncement(done);
      const file = await saved;
      if (file) setAnnouncement(`${done} · auch in ${file}`);
    } catch {
      setCopied(null);
      setCopyFallback({ key, label, text });
    }
  };
  const copyOne = (combo: Combo, number: number) =>
    copy(combo.id, `Kombi ${number}`, [{ combo, number }], `Kombi ${number} kopiert (${tips(combo.entries.length)})`);
  const copyAll = () => {
    const skipped = combos.length - copyable.length;
    const done = `${copyable.length} ${copyable.length === 1 ? "Kombi" : "Kombis"} kopiert`
      + (skipped > 0 ? ` · ${skipped} mit angepfiffenem Spiel ausgelassen` : "");
    return copy("all", "alle Kombis", copyable, done);
  };
  const fallbackFor = (key: string) => copyFallback?.key === key
    ? <CopyFallback label={copyFallback.label} text={copyFallback.text} onClose={() => setCopyFallback(null)} />
    : null;
  const updateCombo = (id: string, change: Partial<Combo> | null) =>
    onCombosChange(change === null
      ? combos.filter((combo) => combo.id !== id)
      : combos.map((combo) => combo.id === id ? { ...combo, ...change } : combo));

  const sizeRow = (size: number) => {
    const count = setup.counts[size] ?? 0;
    return <div key={size} className={`cart-size${count > 0 ? " active" : ""}`}>
      <span className="cart-size-label">{size}er</span>
      <button type="button" className="cart-step" aria-label={`Eine ${size}er-Kombi weniger`} disabled={count === 0}
        onClick={() => setCount(size, count - 1)}><Minus size={12} weight="bold" aria-hidden /></button>
      <input type="number" min={0} value={count} aria-label={`Anzahl ${size}er-Kombis`}
        onChange={(event) => setCount(size, Number(event.target.value))} />
      <button type="button" className="cart-step" aria-label={`Eine ${size}er-Kombi mehr`}
        onClick={() => setCount(size, count + 1)}><Plus size={12} weight="bold" aria-hidden /></button>
    </div>;
  };

  const changeNote = lastChange && lastChange.kind !== "add"
    ? lastChange.kind === "clear"
      ? `Wettschein geleert (${tips(lastChange.count)})`
      : `${lastChange.count} ${lastChange.count === 1 ? "angepfiffener" : "angepfiffene"} entfernt`
    : null;

  return <div ref={windowRef} className="filter-menu cart-window" id={CART_WINDOW_ID} role="dialog" aria-label="Wettschein">
    <div className="filter-menu-head">
      <h2 ref={headingRef} tabIndex={-1}>Wettschein</h2>
      <p className="filter-menu-count">
        <strong>{cart.length}</strong> {cart.length === 1 ? "Tipp" : "Tipps"}
        {startedCount > 0 && <> · {startedCount} angepfiffen</>}
      </p>
      <button type="button" className="filter-reset" aria-label="Wettschein leeren" disabled={cart.length === 0}
        onClick={clear}>Leeren</button>
      <button type="button" className="filter-menu-close" aria-label="Wettschein schließen" title="Wettschein schließen"
        onClick={onClose}><X size={14} weight="bold" aria-hidden /></button>
    </div>

    {/* Selten geändert und gemerkt - deshalb ein fester Streifen über den Listen statt einer
        Spalte, die die Kombis nach unten schiebt. */}
    <FilterCard title="Kombis bauen" className="cart-setup">
      {gameCount < 2
        ? <p className="filter-note">Ab zwei Tipps aus verschiedenen Spielen lassen sich Kombis bauen.</p>
        : <>
          <div className="cart-setup-row">
            <div className="cart-sizes" role="group" aria-label="Kombi-Größen">
              {visibleSizes.map(sizeRow)}
              {shownLarger.map(sizeRow)}
              {largerSizes.length > 0 && <form className="cart-other-size" onSubmit={(event) => { event.preventDefault(); addSize(); }}>
                <input type="number" min={VISIBLE_MAX_SIZE + 1} max={upper} placeholder={`${VISIBLE_MAX_SIZE + 1}–${upper}`}
                  aria-label={`Andere Kombi-Größe, ${VISIBLE_MAX_SIZE + 1} bis ${upper}`} value={otherSize}
                  onChange={(event) => setOtherSize(event.target.value)} />
                <button type="submit" className="filter-reset" aria-label="Kombi-Größe hinzufügen" disabled={!otherValid}
                  title={`Eine Kombi-Größe von ${VISIBLE_MAX_SIZE + 1} bis ${upper} Spielen hinzufügen`}>
                  <Plus size={12} weight="bold" aria-hidden />Größe
                </button>
              </form>}
            </div>
            <FilterSegment className="toolbar-segment cart-mode" name="combo-mode" legend="Wiederholung" value={setup.mode}
              onChange={(mode) => onSetupChange({ ...setup, mode })} options={MODE_OPTIONS} />
            <p className="filter-note cart-summary">
              {comboTotal === 0
                ? "Wähle, wie viele Kombis welcher Größe du willst."
                : `${comboTotal} ${comboTotal === 1 ? "Kombi" : "Kombis"} · ${places} Plätze · ${tips(pool.length)} aus ${gameCount} Spielen mischbar`}
            </p>
          </div>
          {refill > 0 && <p className="filter-note">
            {refill} von {places} Plätzen {refill === 1 ? "wird" : "werden"} mit schon verwendeten Tipps aufgefüllt.
            {" "}In einer Kombi kommt jeder Tipp nur einmal vor.
          </p>}
          {message && <p className="filter-note warning"><Info size={13} weight="bold" aria-hidden />{message}</p>}
        </>}
    </FilterCard>

    <div className="cart-body">
      <div className="cart-column">
        <div className="filter-card cart-tips">
          <div className="filter-card-head">
            <h4 ref={tipsHeadingRef} tabIndex={-1}>Tipps</h4>
          </div>
          {changeNote && <p className="cart-status" role="status">
            {changeNote} · <button ref={undoRef} type="button" className="cart-link" onClick={onUndo}>Rückgängig</button>
          </p>}
          {cart.length === 0
            ? <p className="filter-note">Noch keine Tipps im Wettschein. Leg sie mit „+“ vor einem Spiel hinein
              oder im Quickpicker mit „Alle in den Wettschein“.</p>
            : <div className="cart-games">
              {games.map((entries) => {
                const first = entries[0]!;
                const partie = `${teamName(first, "home", names)} – ${teamName(first, "away", names)}`;
                const started = isStarted(first);
                return <section key={first.fixtureId} className={`cart-game${started ? " started" : ""}`} aria-label={partie}>
                  <div className="cart-game-head">
                    <small className="cart-game-when" title={started ? "Die Quote stammt von vor dem Anpfiff und gilt nicht mehr." : undefined}>
                      {started ? "angepfiffen" : time(first.kickoff)}
                    </small>
                    <strong>{partie}</strong>
                    <small className="cart-game-league" title={leagueName(first, names)}>{leagueName(first, names)}</small>
                  </div>
                  <ul className="cart-tip-list">
                    {entries.map((entry) => {
                      const label = selectionLabel(entry, names);
                      return <li key={entry.id} className={`cart-tip${isPlayable(entry, now) ? "" : " muted"}`}>
                        <span className="cart-tip-label">
                          <span>{label}</span>
                          {!started && entry.odds === null && <small>ohne Quote – kommt in keine Kombi</small>}
                          {/* Herkunft nur als Anzeige: Gemischt wird über alle Filter zusammen
                              (Davids Entscheidung vom 19.10.2026). */}
                          {entry.source && QUICKPICK_PRESETS[entry.source] && <small className="cart-tip-source">
                            aus {QUICKPICK_PRESETS[entry.source].label}
                          </small>}
                        </span>
                        <span className="level-glyph" aria-hidden>
                          {entry.recommendationLevel === "none" ? "" : levelGlyph(entry.recommendationLevel)}
                        </span>
                        <span className="cart-tip-odds">{formatOdd(entry.odds)}</span>
                        <button type="button" className="cart-remove" data-remove={entry.id}
                          aria-label={`Entfernen: ${partie}, ${label}`} title="Aus dem Wettschein nehmen"
                          onClick={() => remove(entry.id)}><X size={12} weight="bold" aria-hidden /></button>
                      </li>;
                    })}
                  </ul>
                  {entries.length > 1 && <p className="filter-note">
                    {entries.length} Tipps aus einem Spiel – in eine Kombi kommt nur einer.
                  </p>}
                </section>;
              })}
            </div>}
          {startedCount > 0 && <div className="filter-card-rule cart-started">
            <p className="filter-note" title="Die Quote stammt von vor dem Anpfiff und gilt nicht mehr.">
              {startedCount} angepfiffen – {startedCount === 1 ? "kommt" : "kommen"} in keine Kombi
            </p>
            <button type="button" className="filter-reset" aria-label="Angepfiffene Tipps entfernen"
              onClick={() => { onRemoveStarted(); setPendingFocus("undo"); }}>Entfernen</button>
          </div>}
        </div>
      </div>

      <div className="cart-column" ref={combosRef}>
        <div className="filter-card cart-combos">
          <div className="filter-card-head">
            <h4>Kombis{combos.length > 0 ? ` (${combos.length})` : ""}</h4>
            {combos.length > 0 && <button type="button" className="filter-reset cart-copy" aria-label="Alle Kombis kopieren"
              disabled={copyable.length === 0}
              title={copyable.length < combos.length ? "Kombis mit angepfiffenem Spiel werden ausgelassen." : "Alle Kombis als Markdown in die Zwischenablage und nach data/tmp/kombis.md"}
              onClick={() => void copyAll()}>
              <Copy size={13} weight="bold" aria-hidden />{copied === "all" ? "Kopiert" : "Alle kopieren"}
            </button>}
          </div>
          {fallbackFor("all")}
          {combos.length === 0 && <p className="filter-note">
            {gameCount >= 2 ? "Noch keine Kombis. Wähle oben die Größen und drück „Kombis mischen“." : "Noch keine Kombis."}
          </p>}
          {combosStale && <p className="filter-note">Der Wettschein hat sich geändert – „Kombis mischen“ baut neu.</p>}
          {numbered.map(({ combo, number }) => {
            const entries = [...combo.entries].sort((left, right) => Date.parse(left.kickoff) - Date.parse(right.kickoff));
            const started = entries.some(isStarted);
            return <section key={combo.id} className={`cart-combo${combo.transferred ? " transferred" : ""}`} aria-label={`Kombi ${number}`}>
              <div className="cart-combo-head">
                <strong>Kombi {number} · {entries.length} Spiele · ab {time(entries[0]!.kickoff)}</strong>
                <span className="cart-combo-odds">Quote {formatOdd(combo.combinedOdds)}</span>
                <button type="button" className="filter-reset cart-copy" aria-label={`Kombi ${number} kopieren`} disabled={started}
                  title={started ? "Ein Spiel läuft schon – die Quote gilt nicht mehr. Neu mischen." : "Als Markdown in die Zwischenablage und nach data/tmp/kombis.md"}
                  onClick={() => void copyOne(combo, number)}>
                  <Copy size={13} weight="bold" aria-hidden />{copied === combo.id ? "Kopiert" : "Kopieren"}
                </button>
                {combo.transferred
                  ? <span className="cart-combo-state">übertragen · <button type="button" className="cart-link" aria-label={`Kombi ${number}: Übertragen zurücknehmen`}
                    onClick={() => updateCombo(combo.id, { transferred: false })}>Zurücknehmen</button></span>
                  : <button type="button" className="filter-reset" aria-label={`Kombi ${number} als übertragen markieren`}
                    title="Für dich zum Abhaken: Übertragene Kombis bleiben beim Neumischen stehen."
                    onClick={() => updateCombo(combo.id, { transferred: true })}>Als übertragen markieren</button>}
                <button type="button" className="cart-remove" aria-label={`Kombi ${number} verwerfen`} title="Kombi verwerfen"
                  onClick={() => updateCombo(combo.id, null)}><X size={12} weight="bold" aria-hidden /></button>
              </div>
              {started && <p className="cart-combo-started">Spiel angepfiffen – neu mischen</p>}
              {fallbackFor(combo.id)}
              <ul className="cart-combo-list">
                {entries.map((entry) => <li key={entry.id}>
                  <span className="cart-combo-when">{isStarted(entry) ? "angepfiffen" : time(entry.kickoff)}</span>
                  <span className="cart-combo-game">{teamName(entry, "home", names)} – {teamName(entry, "away", names)}</span>
                  <span className="cart-combo-tip">{selectionLabel(entry, names)}</span>
                  <span className="cart-tip-odds">{formatOdd(entry.odds)}</span>
                </li>)}
              </ul>
            </section>;
          })}
          {transferredCount > 0 && <p className="filter-note">{transferredCount} von {combos.length} übertragen</p>}
        </div>
        <p className="visually-hidden" aria-live="polite">{announcement}</p>
      </div>
    </div>

    <div className="quickpick-footer">
      <p className="filter-note warning quickpick-warning">
        <Info size={13} weight="bold" aria-hidden />{COMBO_WARNING}
      </p>
      <button type="button" className="quickpick-cart" disabled={!canMix}
        title={kept.length > 0 ? "Übertragene Kombis bleiben stehen." : undefined} onClick={mix}>
        <Shuffle size={14} weight="bold" aria-hidden />
        {/* Die Zahl nur, wenn sie auch entsteht - gesperrt versprach „7 Kombis mischen“ sonst
            Kombis, die der Wettschein gar nicht hergibt. */}
        {canMix && comboTotal > 0 ? `${comboTotal} ${comboTotal === 1 ? "Kombi" : "Kombis"} mischen` : "Kombis mischen"}
      </button>
    </div>
  </div>;
}
