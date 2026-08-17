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
    expect(canGenerate(pool, [], false)).toBe(false);
    expect(canGenerate(pool, [{ size: 2, count: 0 }], false)).toBe(false);
  });

  it("ohne Wiederholung: false wenn die Summe der Slots den Pool übersteigt", () => {
    expect(canGenerate(pool, [{ size: 2, count: 2 }], false)).toBe(false);
    expect(canGenerate(pool, [{ size: 2, count: 1 }], false)).toBe(true);
  });

  it("mit Wiederholung: false wenn eine einzelne Größe den Pool übersteigt", () => {
    expect(canGenerate(pool, [{ size: 4, count: 1 }], true)).toBe(false);
    expect(canGenerate(pool, [{ size: 3, count: 5 }], true)).toBe(true);
  });
});

describe("generateCombos", () => {
  it("erzeugt bei unzureichendem Pool keine Kombis", () => {
    const pool = [entry("1"), entry("2")];
    expect(generateCombos(pool, [{ size: 3, count: 1 }], false)).toEqual([]);
    expect(generateCombos(pool, [{ size: 3, count: 1 }], true)).toEqual([]);
  });

  it("ohne Wiederholung: jeder Eintrag landet höchstens einmal insgesamt", () => {
    const pool = [entry("1"), entry("2"), entry("3"), entry("4"), entry("5"), entry("6")];
    const combos = generateCombos(pool, [{ size: 2, count: 2 }, { size: 3, count: 0 }], false);
    expect(combos).toHaveLength(2);
    expect(combos.every((combo) => combo.entries.length === 2)).toBe(true);
    const usedIds = combos.flatMap((combo) => combo.entries.map((item) => item.id));
    expect(new Set(usedIds).size).toBe(usedIds.length);
  });

  it("mit Wiederholung: jede Kombi hat intern verschiedene Einträge, darf sich aber über Kombis hinweg wiederholen", () => {
    const pool = [entry("1"), entry("2"), entry("3")];
    const combos = generateCombos(pool, [{ size: 2, count: 4 }], true);
    expect(combos).toHaveLength(4);
    for (const combo of combos) {
      expect(combo.entries).toHaveLength(2);
      expect(new Set(combo.entries.map((item) => item.id)).size).toBe(2);
    }
  });

  it("mischt die Reihenfolge nicht deterministisch, respektiert aber Größe und Anzahl", () => {
    const pool = Array.from({ length: 8 }, (_, index) => entry(String(index + 1)));
    const combos = generateCombos(pool, [{ size: 2, count: 1 }, { size: 3, count: 1 }, { size: 4, count: 0 }], false);
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
