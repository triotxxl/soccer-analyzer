import { describe, expect, it } from "vitest";
import { canGenerate, combinedOdds, generateCombos, sizeRange, type CartEntry } from "./betCart";

function entry(id: string, odds: number | null = 2): CartEntry {
  return {
    id, fixtureId: Number(id), homeTeam: `Team ${id}A`, awayTeam: `Team ${id}B`, league: "Liga", country: "Land",
    kickoff: "2026-08-17T18:00:00.000Z", marketKey: "1x2", marketLabel: "1X2", selection: "Heimsieg", pick: "1",
    selectionTone: "home", odds, probability: 0.6, recommendationLevel: "recommended", addedAt: 0
  };
}

describe("sizeRange", () => {
  it("liefert keine Größen für einen Pool unter 2", () => {
    expect(sizeRange(0)).toEqual([]);
    expect(sizeRange(1)).toEqual([]);
  });

  it("liefert 2..poolLength", () => {
    expect(sizeRange(5)).toEqual([2, 3, 4, 5]);
  });
});

describe("canGenerate", () => {
  const pool = [entry("1"), entry("2"), entry("3")];

  it("ist false ohne konfigurierte Größe", () => {
    expect(canGenerate(pool, [], "einmalig")).toBe(false);
    expect(canGenerate(pool, [{ size: 2, count: 0 }], "einmalig")).toBe(false);
  });

  it("einmalig: false wenn die Summe der Slots den Pool übersteigt", () => {
    expect(canGenerate(pool, [{ size: 2, count: 2 }], "einmalig")).toBe(false);
    expect(canGenerate(pool, [{ size: 2, count: 1 }], "einmalig")).toBe(true);
  });

  it("auffüllen: false wenn eine einzelne Größe den Pool übersteigt", () => {
    expect(canGenerate(pool, [{ size: 4, count: 1 }], "auffuellen")).toBe(false);
    expect(canGenerate(pool, [{ size: 3, count: 5 }], "auffuellen")).toBe(true);
  });
});

describe("generateCombos", () => {
  it("erzeugt bei unzureichendem Pool keine Kombis", () => {
    const pool = [entry("1"), entry("2")];
    expect(generateCombos(pool, [{ size: 3, count: 1 }], "einmalig")).toEqual([]);
    expect(generateCombos(pool, [{ size: 3, count: 1 }], "auffuellen")).toEqual([]);
  });

  it("einmalig: jeder Eintrag landet höchstens einmal insgesamt", () => {
    const pool = [entry("1"), entry("2"), entry("3"), entry("4"), entry("5"), entry("6")];
    const combos = generateCombos(pool, [{ size: 2, count: 2 }, { size: 3, count: 0 }], "einmalig");
    expect(combos).toHaveLength(2);
    expect(combos.every((combo) => combo.entries.length === 2)).toBe(true);
    const usedIds = combos.flatMap((combo) => combo.entries.map((item) => item.id));
    expect(new Set(usedIds).size).toBe(usedIds.length);
  });

  it("auffüllen: jede Kombi hat intern verschiedene Einträge, darf sich aber über Kombis hinweg wiederholen", () => {
    const pool = [entry("1"), entry("2"), entry("3")];
    const combos = generateCombos(pool, [{ size: 2, count: 4 }], "auffuellen");
    expect(combos).toHaveLength(4);
    for (const combo of combos) {
      expect(combo.entries).toHaveLength(2);
      expect(new Set(combo.entries.map((item) => item.id)).size).toBe(2);
    }
  });

  /**
   * Der Kern des Auffüllens: Es ist kein freies Ziehen. Jede Wette kommt einmal an die
   * Reihe, bevor sich die erste wiederholt - nur die Plätze, die der Warenkorb nicht mehr
   * deckt, werden aus schon Verwendetem aufgefüllt.
   */
  it("auffüllen: vergibt erst jede Wette einmal, dann erst wiederholt sich etwas", () => {
    const pool = Array.from({ length: 5 }, (_, index) => entry(String(index + 1)));
    for (let versuch = 0; versuch < 30; versuch += 1) {
      const combos = generateCombos(pool, [{ size: 3, count: 2 }], "auffuellen");
      const benutzt = combos.flatMap((combo) => combo.entries.map((item) => item.id));
      expect(benutzt).toHaveLength(6);
      // Sechs Plätze aus fünf Wetten: genau eine Wiederholung, und alle fünf sind dabei.
      expect(new Set(benutzt).size).toBe(5);
      for (const combo of combos) {
        expect(new Set(combo.entries.map((item) => item.id)).size).toBe(3);
      }
    }
  });

  it("auffüllen: lässt mehr Plätze zu als der Warenkorb Wetten hat", () => {
    const pool = [entry("1"), entry("2"), entry("3")];
    expect(canGenerate(pool, [{ size: 2, count: 5 }], "auffuellen")).toBe(true);
    expect(canGenerate(pool, [{ size: 2, count: 5 }], "einmalig")).toBe(false);
    // Eine einzelne Kombi braucht weiterhin genug verschiedene Wetten.
    expect(canGenerate(pool, [{ size: 4, count: 1 }], "auffuellen")).toBe(false);
  });

  it("mischt die Reihenfolge nicht deterministisch, respektiert aber Größe und Anzahl", () => {
    const pool = Array.from({ length: 8 }, (_, index) => entry(String(index + 1)));
    const combos = generateCombos(pool, [{ size: 2, count: 1 }, { size: 3, count: 1 }, { size: 4, count: 0 }], "einmalig");
    expect(combos.map((combo) => combo.entries.length).sort()).toEqual([2, 3]);
  });
});

describe("combinedOdds", () => {
  it("multipliziert vorhandene Quoten", () => {
    expect(combinedOdds([entry("1", 2), entry("2", 1.5)])).toBeCloseTo(3);
  });

  it("ist null sobald eine Quote fehlt", () => {
    expect(combinedOdds([entry("1", 2), entry("2", null)])).toBeNull();
  });

  it("ist null für eine leere Liste", () => {
    expect(combinedOdds([])).toBeNull();
  });
});
