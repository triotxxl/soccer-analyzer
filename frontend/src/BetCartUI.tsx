import { Check, Shuffle, ShoppingCartSimple, Trash, X } from "@phosphor-icons/react";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { formatOdd } from "./App";
import {
  canGenerate, cartEntryId, generateCombos, requestedTotal, sizeRange,
  type CartEntry, type Combo, type ComboFillMode, type ComboSizeConfig
} from "./betCart";
import type { DashboardFixture, DashboardMarket, DashboardMarketKey } from "./types";

/** Zwischen Nabe und Ring liegt eine Lücke ohne Zeiger-Ziel; erst nach dieser Verzögerung
 *  schließt das Menü, damit der Weg dorthin es nicht abreißen lässt. */
const RADIAL_CLOSE_DELAY = 300;
/** Unter diesem Durchmesser wird die Beschriftung unlesbar; dann lieber leicht anschneiden. */
const RADIAL_ITEM_MIN = 34;

interface RadialLayout {
  x: number;
  y: number;
  radius: number;
  item: number;
}

/**
 * Der volle Marktname sprengt einen Kreis von 54 Pixeln.
 *
 * Als Record notiert und nicht als If-Kette: So erzwingt der Compiler bei jedem neuen Markt
 * eine eigene Beschriftung. Zuvor endete die Kette mit einem Rueckfall auf "HZ 1,5", der jeden
 * unbekannten Schluessel stillschweigend falsch beschriftet haette.
 */
const RADIAL_LABELS: Record<DashboardMarketKey, string> = {
  "1x2": "Heim",
  draw: "Remis",
  btts: "BTTS",
  bttsNo: "BTTS ✗",
  over15: "Ü 1,5",
  under15: "U 1,5",
  over25: "Ü 2,5",
  under25: "U 2,5",
  over35: "Ü 3,5",
  under35: "U 3,5",
  firstHalfOver05: "HZ Ü0,5",
  firstHalfUnder05: "HZ U0,5",
  firstHalfOver15: "HZ Ü1,5",
  firstHalfUnder15: "HZ U1,5"
};

function radialLabel(market: DashboardMarket): string {
  if (market.key === "1x2") return market.pick === "2" ? "Gast" : "Heim";
  return RADIAL_LABELS[market.key];
}

/** Die Märkte liegen als geschlossener Ring um die Nabe, beginnend oben im Uhrzeigersinn. */
export function radialAngles(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index * (360 / count) - 90);
}

/** Nachbarkreise liegen 2 * radius * sin(180° / count) auseinander; der Ring wächst so weit,
 *  dass sie sich nicht berühren und die Nabe in der Mitte frei bleibt. */
export function radialRadius(count: number, item: number, hub: number): number {
  const spread = count > 1 ? (item + 6) / (2 * Math.sin(Math.PI / count)) : 0;
  return Math.max(hub / 2 + item / 2 + 10, spread);
}

/**
 * Größter Kreisdurchmesser, mit dem der Ring noch in den freien Platz um die Nabe passt.
 * Aus `radialRadius` aufgelöst: beide Schranken müssen `radius + item / 2 <= room` erfüllen.
 */
export function radialItemSize(count: number, preferred: number, room: number, hub: number): number {
  if (count < 2) return preferred;
  const sine = Math.sin(Math.PI / count);
  const bySpread = (room - 3 / sine) / (1 / (2 * sine) + 0.5);
  const byClearance = room - hub / 2 - 10;
  return Math.max(RADIAL_ITEM_MIN, Math.min(preferred, Math.floor(Math.min(bySpread, byClearance))));
}

/**
 * Der Mittelpunkt liegt immer auf der Nabe - der Ring gehört hinter den Knopf, nicht daneben.
 * Reicht der Platz bis zum Fensterrand nicht, schrumpft der Ring, statt zu wandern.
 */
function radialLayoutFor(trigger: HTMLElement | null, count: number): RadialLayout | null {
  if (!trigger) return null;
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const rect = trigger.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const room = Math.min(x, viewportWidth - x, y, viewportHeight - y) - 8;
  const item = radialItemSize(count, viewportWidth <= 700 ? 40 : 54, room, rect.width);
  return { x, y, radius: radialRadius(count, item, rect.width), item };
}

export function CartAddRadial({ fixture, cart, open, onOpen, onClose, onSelect }: {
  fixture: DashboardFixture;
  cart: CartEntry[];
  open: boolean;
  onOpen(): void;
  onClose(): void;
  onSelect(market: DashboardMarket): void;
}) {
  const hubRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [layout, setLayout] = useState<RadialLayout | null>(null);
  // Die Rückrufe kommen als Inline-Funktionen an und wechseln bei jedem Rendern die
  // Identität; über die Referenz bleiben die Fensterlauscher trotzdem stabil.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) {
      setLayout(null);
      return;
    }
    const measure = () => setLayout(radialLayoutFor(triggerRef.current, fixture.markets.length));
    // Ohne Zeigegerät bleibt nur der Tipp daneben, um den Ring wieder zu schließen.
    const closeOnOutside = (event: PointerEvent) => {
      if (!hubRef.current?.contains(event.target as Node)) closeRef.current();
    };
    measure();
    // Der Ring hängt an festen Fensterkoordinaten, die Zeile darunter scrollt weiter.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    window.addEventListener("pointerdown", closeOnOutside);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [open, fixture.markets.length]);

  const cancelClose = () => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onClose();
    }, RADIAL_CLOSE_DELAY);
  };
  useEffect(() => cancelClose, []);

  const angles = radialAngles(fixture.markets.length);
  const partie = `${fixture.homeTeam} – ${fixture.awayTeam}`;

  return <div
    ref={hubRef}
    className={`cart-add-hub ${open ? "open" : ""}`}
    onMouseEnter={() => { cancelClose(); onOpen(); }}
    onMouseLeave={scheduleClose}
    onFocus={() => { cancelClose(); onOpen(); }}
    onBlur={scheduleClose}
  >
    <button
      ref={triggerRef}
      className="cart-add"
      aria-haspopup="true"
      aria-expanded={open}
      aria-label={`Zum Wett-Baukasten hinzufügen: ${partie}`}
      title="Zeigen öffnet die Marktauswahl"
      onClick={() => open ? onClose() : onOpen()}
    >
      <span className="cart-add-word">Add</span>
      <span className="cart-add-orbit" aria-hidden><i /><i /><i /></span>
    </button>

    {open && layout && <div
      className="cart-radial"
      role="menu"
      aria-label={`Markt hinzufügen: ${partie}`}
      style={{
        left: layout.x,
        top: layout.y,
        "--radial-radius": `${layout.radius}px`,
        "--radial-item": `${layout.item}px`
      } as CSSProperties}
    >
      {fixture.markets.map((market, index) => {
        const added = cart.some((entry) => entry.id === cartEntryId(fixture.fixtureId, market.key));
        const angle = { "--radial-angle": `${angles[index]}deg`, "--radial-index": index } as CSSProperties;
        return <Fragment key={market.key}>
          <span className="cart-radial-spoke" style={angle} aria-hidden />
          <span className="cart-radial-slot" style={angle}>
            <button
              role="menuitem"
              className={`cart-radial-item ${market.recommendation.level}${added ? " added" : ""}`}
              disabled={added}
              aria-label={added
                ? `${market.label} · ${market.selection} – bereits im Warenkorb`
                : `${market.label} · ${market.selection} hinzufügen`}
              title={`${market.label} · ${market.selection} · ${market.recommendation.label}`}
              onClick={() => onSelect(market)}
            >
              <strong>{radialLabel(market)}</strong>
              {added
                ? <Check size={12} weight="bold" aria-hidden />
                : <small>{formatOdd(market.odds)}</small>}
            </button>
          </span>
        </Fragment>;
      })}
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
