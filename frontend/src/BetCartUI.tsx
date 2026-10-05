import { Shuffle, ShoppingCartSimple, Trash, X } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MARKET_GROUPS, formatOdd, levelGlyph, marketGroupOf } from "./App";
import {
  canGenerate, cartEntryId, generateCombos, requestedTotal, sizeRange,
  type CartEntry, type Combo, type ComboFillMode, type ComboSizeConfig
} from "./betCart";
import type { DashboardFixture, DashboardMarket } from "./types";

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

/**
 * Marktauswahl am „Add“-Knopf (seit 30.09.2026 statt des Radialmenüs, Davids Wunsch): eine
 * senkrechte Liste im Leistenstil wie die Marktliste der Werkzeugleiste, gruppiert wie diese.
 * Öffnet per Klick, nicht beim Überfahren - sonst ging beim Weg über die Tabelle ständig etwas
 * auf. Bleibt nach dem Hinzufügen offen, damit mehrere Märkte eines Spiels ohne neues Öffnen
 * gehen; ein Markt im Wettschein trägt den grünen Balken, ein zweiter Klick nimmt ihn heraus.
 */
export function CartAddMenu({ fixture, cart, open, onOpen, onClose, onSelect, onRemove, compact = false }: {
  fixture: DashboardFixture;
  cart: CartEntry[];
  open: boolean;
  onOpen(): void;
  onClose(): void;
  onSelect(market: DashboardMarket): void;
  onRemove(market: DashboardMarket): void;
  /** Für die 34-px-Zeile der Heatmap: ein "+" statt des Wortes "Add". */
  compact?: boolean;
}) {
  const hubRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // Die Rückrufe kommen als Inline-Funktionen an und wechseln bei jedem Rendern die
  // Identität; über die Referenz bleiben die Fensterlauscher trotzdem stabil.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Vor dem ersten Zeichnen messen, damit die Liste nicht sichtbar an die richtige Stelle springt.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
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

  const inCart = (market: DashboardMarket) => cart.some((entry) => entry.id === cartEntryId(fixture.fixtureId, market.key));
  const count = fixture.markets.filter(inCart).length;
  const partie = `${fixture.homeTeam} – ${fixture.awayTeam}`;
  const groups = MARKET_GROUPS
    .map((group) => ({ group, markets: fixture.markets.filter((market) => marketGroupOf(market.key) === group) }))
    .filter((item) => item.markets.length > 0);

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

  return <div ref={hubRef} className={`cart-add-hub${open ? " open" : ""}${compact ? " compact" : ""}`}>
    <button
      ref={triggerRef}
      type="button"
      className={`cart-add${count > 0 ? " has-entries" : ""}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={count > 0
        ? `Zum Wett-Baukasten hinzufügen: ${partie} (${count} im Wettschein)`
        : `Zum Wett-Baukasten hinzufügen: ${partie}`}
      title="Märkte dieses Spiels in den Wettschein legen"
      onClick={() => open ? onClose() : onOpen()}
    >
      {count > 0 ? count : compact ? "+" : "Add"}
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
        {markets.map((market) => {
          const added = inCart(market);
          const text = `${menuLabel(market)} · ${market.selection}, Quote ${formatOdd(market.odds)}`;
          return <button
            type="button"
            key={market.key}
            role="menuitemcheckbox"
            aria-checked={added}
            className={`cart-menu-item ${market.recommendation.level}`}
            aria-label={added ? `${text} – aus dem Wettschein nehmen` : `${text} – in den Wettschein`}
            title={`${market.selection} · ${market.recommendation.label}`}
            onClick={() => added ? onRemove(market) : onSelect(market)}
          >
            <span className="cart-menu-label">{menuLabel(market)}</span>
            <span className="level-glyph" aria-hidden>{market.recommendation.level === "none" ? "" : levelGlyph(market.recommendation.level)}</span>
            <span className="cart-menu-odds">{formatOdd(market.odds)}</span>
          </button>;
        })}
      </div>)}
      {count > 0 && <div className="cart-menu-foot">{count} im Wettschein</div>}
    </div>}
  </div>;
}

export function CartBadge({ count, onClick }: { count: number; onClick(): void }) {
  if (count === 0) return null;
  return <button className="bet-cart-badge" onClick={onClick} aria-label={`Wett-Baukasten öffnen (${count} ${count === 1 ? "Wette" : "Wetten"})`}>
    <ShoppingCartSimple size={20} weight="duotone" /><span>{count}</span>
  </button>;
}

function comboFeasibilityMessage(cart: CartEntry[], sizes: ComboSizeConfig[], mode: ComboFillMode): string | null {
  const active = sizes.filter((item) => item.count > 0);
  if (active.length === 0) return null;
  if (canGenerate(cart, sizes, mode)) return null;
  if (mode === "einmalig") {
    return `Benötigt ${requestedTotal(active)} Wetten, Warenkorb hat nur ${cart.length}.`
      + " Mit „Auffüllen“ reicht der Warenkorb auch für mehr Plätze.";
  }
  const maxSize = Math.max(...active.map((item) => item.size));
  return `Mindestens eine gewählte Größe (${maxSize}er) übersteigt die Anzahl deiner Wetten (${cart.length}).`;
}

/** Wie viele Plätze über den Warenkorb hinausgehen und damit aus Wiederverwendung kommen. */
function refillCount(cart: CartEntry[], sizes: ComboSizeConfig[]): number {
  return Math.max(0, requestedTotal(sizes.filter((item) => item.count > 0)) - cart.length);
}

export function BetBuilderDrawer({ cart, onRemove, onClear, onClose }: {
  cart: CartEntry[];
  onRemove(id: string): void;
  onClear(): void;
  onClose(): void;
}) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [mode, setMode] = useState<ComboFillMode>("einmalig");
  const [combos, setCombos] = useState<Combo[]>([]);

  const sizes = sizeRange(cart.length);
  const sizeConfig: ComboSizeConfig[] = sizes.map((size) => ({ size, count: counts[size] ?? 0 }));
  const message = comboFeasibilityMessage(cart, sizeConfig, mode);
  const canShuffle = canGenerate(cart, sizeConfig, mode);
  const aufgefuellt = mode === "auffuellen" ? refillCount(cart, sizeConfig) : 0;

  const setCount = (size: number, value: number) => setCounts((current) => ({ ...current, [size]: Math.max(0, Math.floor(value) || 0) }));
  const shuffleCombos = () => setCombos(generateCombos(cart, sizeConfig, mode));
  const discardCombo = (id: string) => setCombos((current) => current.filter((combo) => combo.id !== id));

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className={`bet-builder-drawer ${combos.length > 0 ? "has-combos" : ""}`} role="dialog" aria-label="Wett-Baukasten" onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head">
        <strong>Wett-Baukasten</strong>
        <button aria-label="Schließen" onClick={onClose}><X /></button>
      </div>

      {cart.length === 0
        ? <p className="bet-builder-empty">Noch keine Wetten im Warenkorb. Zeige auf „Add“ an einer Partie und wähle im Ring einen Markt.</p>
        : <div className="bet-builder-body">
          {combos.length > 0 && <div className="bet-builder-results">
            <h3>Kombis ({combos.length})</h3>
            <div className="combo-list">
              {combos.map((combo, index) => <div className="combo-card" key={combo.id}>
                <div className="combo-card-head">
                  <strong>Kombi {index + 1} · {combo.entries.length}er</strong>
                  <span>{combo.combinedOdds === null ? "–" : formatOdd(combo.combinedOdds)}</span>
                  <button aria-label={`Kombi ${index + 1} verwerfen`} onClick={() => discardCombo(combo.id)}><X size={13} /></button>
                </div>
                <ul>{combo.entries.map((entry) => <li key={entry.id}>{entry.homeTeam} – {entry.awayTeam} · {entry.marketLabel} · {formatOdd(entry.odds)}</li>)}</ul>
              </div>)}
            </div>
          </div>}

          <div className="bet-builder-controls">
            <section className="bet-builder-section">
              <h3>Ausgewählte Wetten ({cart.length})</h3>
              <ul className="cart-entry-list">
                {cart.map((entry) => <li key={entry.id}>
                  <span><strong>{entry.homeTeam} – {entry.awayTeam}</strong><small>{entry.marketLabel} · {entry.selection}</small></span>
                  <span className="cart-entry-odd">{formatOdd(entry.odds)}</span>
                  <button aria-label={`Entfernen: ${entry.homeTeam} – ${entry.awayTeam}, ${entry.marketLabel}`} onClick={() => onRemove(entry.id)}><X size={14} /></button>
                </li>)}
              </ul>
              <button className="ghost-button" onClick={onClear}><Trash size={14} /> Warenkorb leeren</button>
            </section>

            <section className="bet-builder-section">
              <h3>Kombi-Konfiguration</h3>
              <div className="combo-size-list">
                {sizes.map((size) => <label key={size} className="combo-size-row">
                  <span>{size}er</span>
                  <input type="number" min={0} value={counts[size] ?? 0} aria-label={`Anzahl ${size}er-Kombis`} onChange={(event) => setCount(size, Number(event.target.value))} />
                </label>)}
              </div>
              <div className="segmented">
                <button className={mode === "einmalig" ? "active" : ""} aria-pressed={mode === "einmalig"}
                  title="Jede Wette landet höchstens einmal. Reicht der Warenkorb nicht für alle Plätze, entsteht keine Kombi."
                  onClick={() => setMode("einmalig")}>Ohne Wiederholung</button>
                <button className={mode === "auffuellen" ? "active" : ""} aria-pressed={mode === "auffuellen"}
                  title="Erst kommt jede Wette einmal an die Reihe. Erst wenn der Warenkorb durch ist, wird von vorn aufgefüllt – die letzte Kombi bekommt dann schon verwendete Wetten dazu."
                  onClick={() => setMode("auffuellen")}>Auffüllen</button>
              </div>
              {aufgefuellt > 0 && <p className="bet-builder-note">
                {aufgefuellt} von {requestedTotal(sizeConfig.filter((item) => item.count > 0))} Plätzen
                {aufgefuellt === 1 ? " wird" : " werden"} mit bereits verwendeten Wetten aufgefüllt.
                Innerhalb einer Kombi bleibt jede Wette einmalig.
              </p>}
              {message && <p className="bet-builder-warning">{message}</p>}
              <button className="primary-button" disabled={!canShuffle} onClick={shuffleCombos}><Shuffle size={15} weight="bold" /> Kombis mischen</button>
            </section>
          </div>
        </div>}
    </div>
  </div>;
}
