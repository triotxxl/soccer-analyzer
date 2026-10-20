import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BetSlipWindow, menuPlacement } from "./BetCartUI";
import { COMBO_WARNING, combinedOdds, type CartEntry, type Combo, type ComboSetup } from "./betCart";

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

function slip(cart: CartEntry[], setup: ComboSetup = { counts: {}, mode: "einmalig" }, combos: Combo[] = []) {
  return render(<BetSlipWindow cart={cart} now={NOW} timezone="Europe/Berlin" lastChange={null} setup={setup}
    combos={combos} combosStale={false} onRemove={vi.fn()} onRemoveStarted={vi.fn()} onClear={vi.fn()} onUndo={vi.fn()}
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
    expect(within(dialog).getByRole("button", { name: /Kombis? mischen/ })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: /Kombis? mischen/ })).toBeEnabled();
  });

  /** Davids Wunsch vom 14.10.2026: Kombis per Knopf in die Zwischenablage. */
  describe("Kopieren", () => {
    const combo = (id: string, entries: CartEntry[]): Combo => ({ id, entries, combinedOdds: combinedOdds(entries), transferred: false });
    const ready = combo("a", [tip(1), tip(2, "2026-08-16T19:30:00.000Z", 2)]);
    const running = combo("b", [tip(3, "2026-08-16T11:00:00.000Z"), tip(4)]);

    it("kopiert eine Kombi mit Datum, Spiel, Tipp, Quote und der Warnung, ohne sie als übertragen zu markieren", async () => {
      const user = userEvent.setup();
      const onCombosChange = vi.fn();
      render(<BetSlipWindow cart={[tip(1), tip(2)]} now={NOW} timezone="Europe/Berlin" lastChange={null}
        setup={{ counts: {}, mode: "einmalig" }} combos={[ready]} combosStale={false} onRemove={vi.fn()}
        onRemoveStarted={vi.fn()} onClear={vi.fn()} onUndo={vi.fn()} onSetupChange={vi.fn()} onMix={vi.fn()}
        onCombosChange={onCombosChange} onClose={vi.fn()} />);
      const region = screen.getByRole("region", { name: "Kombi 1" });
      await user.click(within(region).getByRole("button", { name: "Kombi 1 kopieren" }));
      expect(await navigator.clipboard.readText()).toBe([
        "Kombi 1 · 2 Spiele · Quote 3,60",
        "So 16.08. 20:00 | Heim 1 – Gast 1 | Heimsieg Heim 1 | 1,80",
        "So 16.08. 21:30 | Heim 2 – Gast 2 | Heimsieg Heim 2 | 2,00",
        "",
        COMBO_WARNING
      ].join("\n"));
      expect(within(region).getByRole("button", { name: "Kombi 1 kopieren" })).toHaveTextContent("Kopiert");
      expect(screen.getByText("Kombi 1 kopiert (2 Tipps)")).toBeInTheDocument();
      expect(onCombosChange).not.toHaveBeenCalled();
    });

    it("sperrt eine Kombi mit angepfiffenem Spiel und lässt sie bei „Alle kopieren“ aus", async () => {
      const user = userEvent.setup();
      slip([tip(1), tip(2), tip(3, "2026-08-16T11:00:00.000Z"), tip(4)], undefined, [ready, running]);
      expect(within(screen.getByRole("region", { name: "Kombi 2" })).getByRole("button", { name: "Kombi 2 kopieren" })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Alle Kombis kopieren" }));
      const text = await navigator.clipboard.readText();
      expect(text).toMatch(/^Kombi 1 · /);
      expect(text).not.toContain("Kombi 2");
      expect(screen.getByText("1 Kombi kopiert · 1 mit angepfiffenem Spiel ausgelassen")).toBeInTheDocument();
    });

    it("zeigt „Kopiert“ nur kurz", async () => {
      userEvent.setup();
      vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      vi.useFakeTimers();
      try {
        slip([tip(1), tip(2)], undefined, [ready]);
        const button = screen.getByRole("button", { name: "Kombi 1 kopieren" });
        await act(async () => { button.click(); });
        expect(button).toHaveTextContent("Kopiert");
        act(() => { vi.advanceTimersByTime(2000); });
        expect(button).toHaveTextContent("Kopieren");
      } finally {
        vi.useRealTimers();
      }
    });

    it("zeigt den Text markiert zum Kopieren, wenn die Zwischenablage ablehnt", async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("verweigert"));
      slip([tip(1), tip(2)], undefined, [ready]);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Kombi 1 kopieren" }));
      const field = screen.getByRole("textbox", { name: "Text zum Kopieren: Kombi 1" });
      expect((field as HTMLTextAreaElement).value).toContain("Heim 1 – Gast 1 | Heimsieg Heim 1 | 1,80");
      expect(field).toHaveFocus();
      expect(screen.getByText("Kopieren ging nicht. Der Text ist markiert – kopiere ihn mit Strg+C.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Textfeld schließen" }));
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  /**
   * Fehler vom 14.10.2026: Mit einer gewählten 10er-Kombi klappten bei 86 Tipps alle Größen bis 86er
   * auf, und die Kombis samt „Kombis mischen“ verschwanden aus dem Fenster.
   */
  it("zeigt größere Kombis nur einzeln: gewählte und hinzugefügte", async () => {
    const user = userEvent.setup();
    const onSetupChange = vi.fn();
    const cart = Array.from({ length: 20 }, (_, index) => tip(index + 1));
    render(<BetSlipWindow cart={cart} now={NOW} timezone="Europe/Berlin" lastChange={null}
      setup={{ counts: { 10: 2 }, mode: "einmalig" }} combos={[]} combosStale={false} onRemove={vi.fn()}
      onRemoveStarted={vi.fn()} onClear={vi.fn()} onUndo={vi.fn()} onSetupChange={onSetupChange} onMix={vi.fn()}
      onCombosChange={vi.fn()} onClose={vi.fn()} />);
    const sizes = () => screen.getAllByRole("spinbutton", { name: /^Anzahl \d+er-Kombis$/ })
      .map((field) => field.getAttribute("aria-label"));
    expect(sizes()).toEqual([2, 3, 4, 5, 6, 7, 8, 10].map((size) => `Anzahl ${size}er-Kombis`));
    expect(screen.getByRole("button", { name: /Kombis? mischen/ })).toBeEnabled();

    const other = screen.getByRole("spinbutton", { name: "Andere Kombi-Größe, 9 bis 20" });
    const add = screen.getByRole("button", { name: "Kombi-Größe hinzufügen" });
    expect(add).toBeDisabled();
    await user.type(other, "21");
    expect(add).toBeDisabled();
    await user.clear(other);
    await user.type(other, "12{Enter}");
    expect(onSetupChange).toHaveBeenLastCalledWith({ counts: { 10: 2, 12: 1 }, mode: "einmalig" });
    expect(sizes()).toContain("Anzahl 12er-Kombis");
    expect(sizes()).not.toContain("Anzahl 9er-Kombis");
    expect(other).toHaveValue(null);
  });

  it("sagt ohne gemischte Kombis, wie es weitergeht", () => {
    slip([tip(1), tip(2)]);
    expect(screen.getByText("Noch keine Kombis. Wähle oben die Größen und drück „Kombis mischen“.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alle Kombis kopieren" })).not.toBeInTheDocument();
  });

  it("meldet, wenn eine Größe mehr Spiele braucht, als der Wettschein hat", () => {
    slip([tip(1), tip(2), tip(3)], { counts: { 4: 1 }, mode: "einmalig" });
    expect(screen.getByText("Eine 4er-Kombi braucht 4 verschiedene Spiele, im Wettschein sind Tipps aus 3.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kombis? mischen/ })).toBeDisabled();
  });
});
