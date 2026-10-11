import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BetSlipWindow, menuPlacement } from "./BetCartUI";
import type { CartEntry, ComboSetup } from "./betCart";

/** Ein 26-px-Knopf an der Stelle (left, top). */
function trigger(left: number, top: number) {
  return { left, top, right: left + 26, bottom: top + 26 };
}

const viewport = { width: 1280, height: 800 };
const menu = { width: 260, height: 400 };

describe("menuPlacement", () => {
  it("setzt die Liste rechts neben den Knopf, oben auf Höhe der Zeile", () => {
    expect(menuPlacement(trigger(100, 200), menu, viewport)).toEqual({ left: 132, top: 196 });
  });

  it("klappt nach oben, wenn unten der Platz fehlt", () => {
    const placed = menuPlacement(trigger(100, 700), menu, viewport);
    // Die Unterkante der Liste schließt mit der Unterkante des Knopfs ab.
    expect(placed.top + menu.height).toBe(700 + 26 + 4);
  });

  it("stellt die Liste links vom Knopf, wenn rechts der Platz fehlt", () => {
    const placed = menuPlacement(trigger(1100, 200), menu, viewport);
    expect(placed.left + menu.width).toBeLessThanOrEqual(1100);
  });

  it("beginnt eine zu hohe Liste am oberen Rand, statt sie abzuschneiden", () => {
    expect(menuPlacement(trigger(100, 300), { width: 260, height: 900 }, viewport).top).toBe(8);
  });
});

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

function tip(fixtureId: number, kickoff = "2026-08-16T18:00:00.000Z", odds: number | null = 1.8): CartEntry {
  return {
    id: `${fixtureId}:1x2`, fixtureId, homeTeam: `Heim ${fixtureId}`, awayTeam: `Gast ${fixtureId}`, league: "Liga",
    country: "Land", kickoff, marketKey: "1x2", marketLabel: "1X2", selection: "Heimsieg", pick: "1",
    selectionTone: "home", odds, probability: 0.6, recommendationLevel: "recommended", addedAt: 0
  };
}

function slip(cart: CartEntry[], setup: ComboSetup = { counts: {}, mode: "einmalig" }) {
  return render(<BetSlipWindow cart={cart} now={NOW} timezone="Europe/Berlin" lastChange={null} setup={setup}
    combos={[]} combosStale={false} onRemove={vi.fn()} onRemoveStarted={vi.fn()} onClear={vi.fn()} onUndo={vi.fn()}
    onSetupChange={vi.fn()} onMix={vi.fn()} onCombosChange={vi.fn()} onClose={vi.fn()} />);
}

describe("BetSlipWindow", () => {
  afterEach(cleanup);

  it("erklärt den leeren Wettschein und zeigt trotzdem die Warnung", () => {
    slip([]);
    const dialog = screen.getByRole("dialog", { name: "Wettschein" });
    expect(within(dialog).getByText(/Noch keine Tipps im Wettschein/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Rechne nicht mit Gewinn/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Wettschein leeren" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Kombis mischen/ })).toBeDisabled();
  });

  it("baut mit einem Tipp noch keine Kombi", () => {
    slip([tip(1)]);
    expect(screen.getByText("Ab zwei Tipps aus verschiedenen Spielen lassen sich Kombis bauen.")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("zählt angepfiffene Tipps und Tipps ohne Quote nicht als mischbar", () => {
    slip([tip(1), tip(2), tip(3, "2026-08-16T11:00:00.000Z"), tip(4, undefined, null)], { counts: { 2: 1 }, mode: "einmalig" });
    expect(screen.getByText("1 angepfiffen – kommt in keine Kombi")).toBeInTheDocument();
    expect(screen.getByText("ohne Quote – kommt in keine Kombi")).toBeInTheDocument();
    expect(screen.getByText("1 Kombi · 2 Plätze · 2 Tipps aus 2 Spielen mischbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kombis mischen/ })).toBeEnabled();
  });

  it("meldet, wenn eine Größe mehr Spiele braucht, als der Wettschein hat", () => {
    slip([tip(1), tip(2), tip(3)], { counts: { 4: 1 }, mode: "einmalig" });
    expect(screen.getByText("Eine 4er-Kombi braucht 4 verschiedene Spiele, im Wettschein sind Tipps aus 3.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kombis mischen/ })).toBeDisabled();
  });
});
