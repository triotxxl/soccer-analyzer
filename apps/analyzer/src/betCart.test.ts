import { describe, expect, it } from "vitest";
import {
  COMBO_WARNING, canGenerate, comboCopyText, combinedOdds, generateCombos, isPlayable, putEntriesInto, selectionLabel, shortTipLabel, sizeRange, toCartEntry, toCounterCartEntry,
  toQuickpickCartEntry, quickpickCartEntry, hasTip,
  type CartEntry
} from "./betCart";
import type { DashboardFixture, DashboardMarket } from "../../shared/src/types";

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
   * Reihe, bevor sich die erste wiederholt - nur die Plätze, die der Wettschein nicht mehr
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

  it("auffüllen: lässt mehr Plätze zu als der Wettschein Tipps hat", () => {
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

/**
 * Knopf je Zeile und „Alle n in den Wettschein“ legen über dieselbe Funktion - beide müssen die
 * gestützte Seite bzw. den Markt des Filters treffen und die Herkunft tragen.
 */
describe("quickpickCartEntry", () => {
  const fixture = {
    fixtureId: 9, kickoff: "2026-10-20T18:00:00.000Z", country: "Land", league: "Liga", homeTeam: "Heim FC", awayTeam: "Gast FC",
    markets: [
      { key: "1x2", label: "1X2", selection: "Heim FC", pick: "1", selectionTone: "home", probability: 0.5, odds: 1.8,
        confidence: 80, score: null, recommendation: { level: "none", label: "" }, details: [] },
      { key: "over25", label: "Über 2,5", selection: "Über 2,5 Tore", pick: null, selectionTone: "neutral", probability: 0.6, odds: 1.7,
        confidence: 80, score: null, recommendation: { level: "none", label: "" }, details: [] }
    ]
  } as unknown as DashboardFixture;

  it("legt beim 1X2 die gestützte Seite, auch gegen den Modelltipp", () => {
    const entry = quickpickCartEntry(fixture, { market: "1x2", side: "2", odds: 4.2 }, "dominanz")!;
    expect(entry).toMatchObject({ id: "9:1x2", pick: "2", odds: 4.2, selection: "Auswärtssieg Gast FC", source: "dominanz" });
  });

  it("legt jeden anderen Markt direkt aus dem Snapshot", () => {
    const entry = quickpickCartEntry(fixture, { market: "over25", side: null, odds: 1.7 }, "kombi")!;
    expect(entry).toMatchObject({ id: "9:over25", marketLabel: "Über 2,5", odds: 1.7, source: "kombi" });
  });

  it("liefert nichts ohne Seite oder ohne Markt im Snapshot", () => {
    expect(quickpickCartEntry(fixture, { market: "1x2", side: null, odds: null }, "daves1x2")).toBeNull();
    expect(quickpickCartEntry(fixture, { market: "btts", side: null, odds: 1.9 }, "kombi")).toBeNull();
  });

  it("erkennt mit hasTip nur genau denselben Tipp - beim 1X2 zählt die Seite", () => {
    const home = quickpickCartEntry(fixture, { market: "1x2", side: "1", odds: 1.8 }, "daves1x2")!;
    const away = quickpickCartEntry(fixture, { market: "1x2", side: "2", odds: 4.2 }, "dominanz")!;
    expect(hasTip([home], home)).toBe(true);
    expect(hasTip([home], away)).toBe(false);
  });
});

describe("toCounterCartEntry", () => {
  function market(key: DashboardMarket["key"], probability: number, extra: Partial<DashboardMarket> = {}): DashboardMarket {
    return {
      key, label: key, selection: key, pick: key === "1x2" ? "1" : null, selectionTone: "home", probability,
      odds: 1.8, confidence: 80, score: null, recommendation: { level: "recommended", label: "Empfehlenswert" }, details: [],
      ...extra
    };
  }
  function partie(oneXTwo: Partial<DashboardMarket> = {}, withDraw = true): DashboardFixture {
    return {
      fixtureId: 7, kickoff: "2026-10-06T18:00:00.000Z", country: "Land", league: "Liga", homeTeam: "Heim FC", awayTeam: "Gast FC",
      markets: [market("1x2", 0.55, oneXTwo), ...(withDraw ? [market("draw", 0.25)] : [])]
    } as DashboardFixture;
  }

  it("legt die Seite gegen den Modelltipp mit der Quote aus dem Snapshot an", () => {
    const fixture = partie({ oddsHome: 1.8, oddsAway: 4.5 });
    const entry = toCounterCartEntry(fixture, fixture.markets[0]!)!;
    expect(entry.id).toBe("7:1x2");
    expect(entry.pick).toBe("2");
    expect(entry.selection).toBe("Auswärtssieg Gast FC");
    expect(entry.odds).toBe(4.5);
    expect(entry.probability).toBeCloseTo(0.2);
    expect(entry.recommendationLevel).toBe("none");
  });

  it("schätzt keine Quote, wenn der Snapshot keine führt", () => {
    const fixture = partie();
    expect(toCounterCartEntry(fixture, fixture.markets[0]!)!.odds).toBeNull();
  });

  it("nennt keine Wahrscheinlichkeit, wenn der 1X2-Markt nicht belastbar ist", () => {
    const fixture = partie({ probabilityReliable: false, oddsAway: 4.5 });
    expect(toCounterCartEntry(fixture, fixture.markets[0]!)!.probability).toBe(0);
  });

  it("gibt null ohne Tipp und für andere Märkte", () => {
    const ohneTipp = partie({ pick: null });
    expect(toCounterCartEntry(ohneTipp, ohneTipp.markets[0]!)).toBeNull();
    const fixture = partie();
    expect(toCounterCartEntry(fixture, fixture.markets[1]!)).toBeNull();
  });
});

/** Ein Tipp aus einem bestimmten Spiel und Markt - für die Regeln „ein Spiel je Kombi“ und „Gegensätze ersetzen“. */
function tip(fixtureId: number, marketKey: CartEntry["marketKey"], selection: string, pick: "1" | "2" | null = null): CartEntry {
  return {
    ...entry(String(fixtureId)), id: `${fixtureId}:${marketKey}`, fixtureId, marketKey, marketLabel: marketKey, selection, pick
  };
}

describe("ein Spiel je Kombi", () => {
  // Spiel 1 trägt drei Tipps, die Spiele 2-4 je einen.
  const pool = [
    tip(1, "1x2", "Heimsieg", "1"), tip(1, "over25", "Mindestens 3 Tore"), tip(1, "btts", "Beide Teams treffen: Ja"),
    tip(2, "1x2", "Heimsieg", "1"), tip(3, "1x2", "Heimsieg", "1"), tip(4, "1x2", "Heimsieg", "1")
  ];

  it("ohne Wiederholung: keine Kombi enthält ein Spiel zweimal", () => {
    for (let versuch = 0; versuch < 30; versuch += 1) {
      const combos = generateCombos(pool, [{ size: 2, count: 3 }], "einmalig");
      expect(combos).toHaveLength(3);
      for (const combo of combos) expect(new Set(combo.entries.map((item) => item.fixtureId)).size).toBe(2);
      const used = combos.flatMap((combo) => combo.entries.map((item) => item.id));
      expect(new Set(used).size).toBe(6);
    }
  });

  it("ohne Wiederholung: erkennt, wenn zu viele Tipps aus einem Spiel stammen", () => {
    // Eine 4er-Kombi nimmt jedes Spiel einmal; für die 2er bleiben nur Tipps aus Spiel 1.
    expect(canGenerate(pool, [{ size: 4, count: 1 }, { size: 2, count: 1 }], "einmalig")).toBe(false);
    expect(generateCombos(pool, [{ size: 4, count: 1 }, { size: 2, count: 1 }], "einmalig")).toEqual([]);
    expect(canGenerate(pool, [{ size: 5, count: 1 }], "einmalig")).toBe(false);
  });

  it("auffüllen: jede Kombi aus verschiedenen Spielen, Größe höchstens die Zahl der Spiele", () => {
    expect(canGenerate(pool, [{ size: 5, count: 1 }], "auffuellen")).toBe(false);
    for (let versuch = 0; versuch < 30; versuch += 1) {
      for (const combo of generateCombos(pool, [{ size: 4, count: 3 }], "auffuellen")) {
        expect(new Set(combo.entries.map((item) => item.fixtureId)).size).toBe(4);
      }
    }
  });

  it("behält übertragene Kombis und vergibt ihre Tipps ohne Wiederholung nicht erneut", () => {
    const four = [entry("1"), entry("2"), entry("3"), entry("4")];
    const [first] = generateCombos(four, [{ size: 2, count: 1 }], "einmalig");
    const kept = { ...first!, transferred: true };
    for (let versuch = 0; versuch < 20; versuch += 1) {
      const combos = generateCombos(four, [{ size: 2, count: 1 }], "einmalig", [kept]);
      expect(combos).toHaveLength(2);
      expect(combos[0]).toBe(kept);
      const keptIds = kept.entries.map((item) => item.id);
      for (const item of combos[1]!.entries) expect(keptIds).not.toContain(item.id);
    }
    // Für eine zweite neue 2er reicht der Rest nicht mehr.
    expect(canGenerate(four, [{ size: 2, count: 2 }], "einmalig", [kept])).toBe(false);
  });
});

describe("putEntriesInto", () => {
  it("ersetzt Gegensätze desselben Spiels und lässt verträgliche Tipps stehen", () => {
    const heim = tip(1, "1x2", "Heimsieg Alpha", "1");
    const remis = tip(1, "draw", "Unentschieden (X)");
    const ueber = tip(1, "over25", "Mindestens 3 Tore");
    const unter = tip(1, "under25", "Höchstens 2 Tore");
    let { cart, result } = putEntriesInto([remis, tip(2, "draw", "Unentschieden (X)")], [heim]);
    expect(cart.map((item) => item.id)).toEqual(["2:draw", "1:1x2"]);
    expect(result.replaced).toEqual([{ by: heim, old: [remis] }]);

    ({ cart, result } = putEntriesInto(cart, [ueber]));
    expect(result.added).toEqual([ueber]);
    expect(cart).toHaveLength(3);

    ({ cart, result } = putEntriesInto(cart, [unter]));
    expect(result.replaced).toEqual([{ by: unter, old: [ueber] }]);
    expect(cart.map((item) => item.id)).toEqual(["2:draw", "1:1x2", "1:under25"]);
  });

  it("tauscht die 1X2-Seite an ihrer Stelle und meldet Unverändertes", () => {
    const heim = tip(1, "1x2", "Heimsieg Alpha", "1");
    const gast = tip(1, "1x2", "Auswärtssieg Beta", "2");
    const other = tip(2, "over25", "Mindestens 3 Tore");
    const { cart, result } = putEntriesInto([heim, other], [gast, other]);
    expect(cart).toEqual([gast, other]);
    expect(result.replaced).toEqual([{ by: gast, old: [heim] }]);
    expect(result.unchanged).toEqual([other]);
  });

  it("verdrängt nichts mit einer Auswahl, die es nicht entscheiden kann", () => {
    const fremd = tip(1, "1x2", "Irgendwas", "1");
    const ueber = tip(1, "over25", "Mindestens 3 Tore");
    expect(putEntriesInto([ueber], [{ ...fremd, id: "1:fremd" }]).cart).toHaveLength(2);
  });
});

describe("isPlayable und selectionLabel", () => {
  const now = Date.parse("2026-08-17T12:00:00.000Z");

  it("mischbar nur vor dem Anpfiff und mit Quote", () => {
    expect(isPlayable(entry("1"), now)).toBe(true);
    expect(isPlayable({ ...entry("1"), kickoff: "2026-08-17T11:00:00.000Z" }, now)).toBe(false);
    expect(isPlayable(entry("1", null), now)).toBe(false);
  });

  it("nennt beim 1X2 die Mannschaft, sonst Markt und Auswahl", () => {
    expect(selectionLabel(entry("1"), "tipico")).toBe("Heimsieg Team 1A");
    expect(selectionLabel({ ...entry("1"), pick: "2", selection: "Auswärtssieg" }, "tipico")).toBe("Auswärtssieg Team 1B");
    expect(selectionLabel(tip(1, "over25", "Mindestens 3 Tore"), "tipico")).toBe("over25 · Mindestens 3 Tore");
  });
});

describe("Tipico-Namen im Wettschein", () => {
  const tipico = { homeTeam: "Hapoel Jerusalem", awayTeam: "Maccabi Haifa", country: "Israel", league: "Premier League" };
  const game = {
    fixtureId: 7, homeTeam: "Hapoel Katamon", awayTeam: "Maccabi Haifa", league: "Ligat Ha'al", country: "Israel",
    kickoff: "2026-08-17T18:00:00.000Z", tipico, markets: []
  } as unknown as DashboardFixture;
  const oneXTwo = {
    key: "1x2", label: "1X2", selection: "Heimsieg Hapoel Katamon", pick: "1", selectionTone: "home",
    probability: 0.6, odds: 1.9, confidence: 80, score: 70,
    recommendation: { level: "recommended", label: "Empfehlenswert" }, details: []
  } as DashboardMarket;

  it("zeigt den gewählten Namen, ohne den gespeicherten Tipp-Text zu ändern", () => {
    const fromMenu = toCartEntry(game, oneXTwo);
    expect(fromMenu.selection).toBe("Heimsieg Hapoel Katamon");
    expect(selectionLabel(fromMenu, "tipico")).toBe("Heimsieg Hapoel Jerusalem");
    expect(selectionLabel(fromMenu, "api")).toBe("Heimsieg Hapoel Katamon");
    expect(shortTipLabel(fromMenu, "tipico")).toBe("Heimsieg Hapoel Jerusalem");
  });

  it("ein Eintrag aus der Zeit vor den Tipico-Namen zeigt die Namen von API-Football", () => {
    expect(selectionLabel(entry("1"), "tipico")).toBe("Heimsieg Team 1A");
  });

  it("derselbe Tipp über „+“ und über den Quickpicker bleibt derselbe Tipp", () => {
    // Die Gleichheit hängt an `selection` - beide Wege bauen ihn mit dem Namen von API-Football.
    const fromMenu = toCartEntry(game, oneXTwo);
    const fromQuickpick = toQuickpickCartEntry(game, "1", 1.9, 0.6);
    const { result } = putEntriesInto([fromMenu], [fromQuickpick]);
    expect(result.unchanged).toHaveLength(1);
    expect(result.added).toHaveLength(0);
  });
});

describe("comboCopyText", () => {
  const first = { ...entry("1", 1.6), kickoff: "2026-10-14T19:00:00.000Z" };
  const second = {
    ...entry("2", 1.8), kickoff: "2026-10-15T02:00:00.000Z", marketKey: "over25" as const, marketLabel: "Über/Unter 2,5",
    selection: "Über 2,5", pick: null, tipico: { homeTeam: "T2 Heim", awayTeam: "T2 Gast", league: "T-Liga", country: "Land" }
  };
  const combo = { id: "k", entries: [second, first], combinedOdds: 2.88, transferred: false };

  it("schreibt je Tipp Anstoß mit Datum, Spiel, Tipp und Quote, nach Anstoß sortiert, und endet mit der Warnung", () => {
    expect(comboCopyText([{ combo, number: 1 }], "api", "Europe/Berlin")).toBe([
      "Kombi 1 · 2 Spiele · Quote 2,88",
      "Mi 14.10. 21:00 | Team 1A – Team 1B | Heimsieg Team 1A | 1,60",
      "Do 15.10. 04:00 | Team 2A – Team 2B | Über/Unter 2,5 · Über 2,5 | 1,80",
      "",
      COMBO_WARNING
    ].join("\n"));
  });

  it("folgt der Namens-Einstellung und trennt mehrere Kombis durch eine Leerzeile, die Warnung steht einmal", () => {
    const text = comboCopyText([{ combo, number: 1 }, { combo: { ...combo, id: "m", combinedOdds: null }, number: 3 }], "tipico", "Europe/Berlin");
    expect(text).toContain("| T2 Heim – T2 Gast |");
    expect(text).toContain("\n\nKombi 3 · 2 Spiele · Quote –\n");
    expect(text.split(COMBO_WARNING)).toHaveLength(2);
    expect(text.endsWith(COMBO_WARNING)).toBe(true);
  });

  it("nennt weder Wahrscheinlichkeit noch Stufe oder Einsatz", () => {
    const text = comboCopyText([{ combo, number: 1 }], "api", "Europe/Berlin").replace(COMBO_WARNING, "");
    expect(text).not.toMatch(/%|✓|★|Einsatz|Gewinn|übertragen/);
  });
});
