import { Plus, Shuffle, ShoppingCartSimple, Trash, X } from "@phosphor-icons/react";
import { useState } from "react";
import { formatOdd, formatPercent } from "./App";
import {
  canGenerate, cartEntryId, generateCombos, requestedTotal, sizeRange,
  type CartEntry, type Combo, type ComboSizeConfig
} from "./betCart";
import type { DashboardFixture, DashboardMarket } from "./types";

function levelGlyph(level: DashboardMarket["recommendation"]["level"]): string {
  return level === "strong" ? "★" : level === "recommended" ? "✓" : "·";
}

export function CartAddButton({ fixture, onOpen }: { fixture: DashboardFixture; onOpen(): void }) {
  return <button className="cart-add" aria-label={`Zum Wett-Baukasten hinzufügen: ${fixture.homeTeam} – ${fixture.awayTeam}`} title="Zum Wett-Baukasten hinzufügen" onClick={onOpen}>
    <Plus size={14} weight="bold" />
  </button>;
}

export function MarketPickerModal({ fixture, cart, onSelect, onClose }: {
  fixture: DashboardFixture;
  cart: CartEntry[];
  onSelect(market: DashboardMarket): void;
  onClose(): void;
}) {
  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="market-picker-modal" role="dialog" aria-label={`Markt wählen: ${fixture.homeTeam} – ${fixture.awayTeam}`} onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head">
        <strong>{fixture.homeTeam} – {fixture.awayTeam}</strong>
        <button aria-label="Schließen" onClick={onClose}><X /></button>
      </div>
      <div className="market-picker-list">
        {fixture.markets.map((market) => {
          const added = cart.some((entry) => entry.id === cartEntryId(fixture.fixtureId, market.key));
          return <button key={market.key} className={`market-picker-row ${market.recommendation.level}`} disabled={added} onClick={() => onSelect(market)}>
            <span className="level-glyph">{levelGlyph(market.recommendation.level)}</span>
            <span className="market-picker-label"><strong>{market.label}</strong><small>{market.selection}</small></span>
            <span className="market-picker-stats"><span>{formatPercent(market.probability)}</span><strong>{formatOdd(market.odds)}</strong></span>
            {added && <span className="market-picker-added">Im Warenkorb</span>}
          </button>;
        })}
      </div>
    </div>
  </div>;
}

export function CartBadge({ count, onClick }: { count: number; onClick(): void }) {
  if (count === 0) return null;
  return <button className="bet-cart-badge" onClick={onClick} aria-label={`Wett-Baukasten öffnen (${count} ${count === 1 ? "Wette" : "Wetten"})`}>
    <ShoppingCartSimple size={20} weight="duotone" /><span>{count}</span>
  </button>;
}

function comboFeasibilityMessage(cart: CartEntry[], sizes: ComboSizeConfig[], withRepetition: boolean): string | null {
  const active = sizes.filter((item) => item.count > 0);
  if (active.length === 0) return null;
  if (canGenerate(cart, sizes, withRepetition)) return null;
  if (!withRepetition) {
    return `Benötigt ${requestedTotal(active)} Wetten, Warenkorb hat nur ${cart.length}.`;
  }
  const maxSize = Math.max(...active.map((item) => item.size));
  return `Mindestens eine gewählte Größe (${maxSize}er) übersteigt die Anzahl deiner Wetten (${cart.length}).`;
}

export function BetBuilderDrawer({ cart, onRemove, onClear, onClose }: {
  cart: CartEntry[];
  onRemove(id: string): void;
  onClear(): void;
  onClose(): void;
}) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [withRepetition, setWithRepetition] = useState(false);
  const [combos, setCombos] = useState<Combo[]>([]);

  const sizes = sizeRange(cart.length);
  const sizeConfig: ComboSizeConfig[] = sizes.map((size) => ({ size, count: counts[size] ?? 0 }));
  const message = comboFeasibilityMessage(cart, sizeConfig, withRepetition);
  const canShuffle = canGenerate(cart, sizeConfig, withRepetition);

  const setCount = (size: number, value: number) => setCounts((current) => ({ ...current, [size]: Math.max(0, Math.floor(value) || 0) }));
  const shuffleCombos = () => setCombos(generateCombos(cart, sizeConfig, withRepetition));
  const discardCombo = (id: string) => setCombos((current) => current.filter((combo) => combo.id !== id));

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="bet-builder-drawer" role="dialog" aria-label="Wett-Baukasten" onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head">
        <strong>Wett-Baukasten</strong>
        <button aria-label="Schließen" onClick={onClose}><X /></button>
      </div>

      {cart.length === 0
        ? <p className="bet-builder-empty">Noch keine Wetten im Warenkorb. Füge über das "+" an einer Partie einen Markt hinzu.</p>
        : <>
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
              <button className={!withRepetition ? "active" : ""} aria-pressed={!withRepetition} onClick={() => setWithRepetition(false)}>Ohne Wiederholung</button>
              <button className={withRepetition ? "active" : ""} aria-pressed={withRepetition} onClick={() => setWithRepetition(true)}>Mit Wiederholung</button>
            </div>
            {message && <p className="bet-builder-warning">{message}</p>}
            <button className="primary-button" disabled={!canShuffle} onClick={shuffleCombos}><Shuffle size={15} weight="bold" /> Kombis mischen</button>
          </section>

          {combos.length > 0 && <section className="bet-builder-section">
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
          </section>}
        </>}
    </div>
  </div>;
}
