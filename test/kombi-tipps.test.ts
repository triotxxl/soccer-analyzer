import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DashboardFixture, DashboardMarket } from "../src/dashboard.ts";
import { KOMBI_RULE, chooseTip, comboStats, flagText, flagsOf, parseBerlin, splitIntoCombos, tipsOf, type KombiTip } from "../src/kombi-tipps.ts";

function market(key: DashboardMarket["key"], odds: number | null, extra: Partial<DashboardMarket> = {}): DashboardMarket {
  return {
    key, label: key, selection: key, pick: null, selectionTone: "neutral", probability: 0.5, odds,
    confidence: 80, score: null, recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: [],
    ...extra
  };
}

function fixture(markets: DashboardMarket[], extra: Partial<DashboardFixture> = {}): DashboardFixture {
  return {
    fixtureId: 1, kickoff: "2026-10-13T19:00:00+02:00", homeTeam: "Heim", awayTeam: "Gast", markets, warnings: [],
    ...extra
  } as unknown as DashboardFixture;
}

const tip = (odds: number, fair: number, marketKey: KombiTip["marketKey"] = "btts"): KombiTip =>
  ({ marketKey, selection: marketKey, odds, fair, model: fair, confidence: 80 });

describe("tipsOf", () => {
  it("bewertet beide 1X2-Seiten über das Tripel und die Gegenseite des Modells als Rest", () => {
    const tips = tipsOf(fixture([
      market("1x2", 1.6, { pick: "1", probability: 0.55, oddsHome: 1.6, oddsAway: 5.5 }),
      market("draw", 4, { probability: 0.25 })
    ]));
    const book = 1 / 1.6 + 1 / 4 + 1 / 5.5;
    const home = tips.find((entry) => entry.selection === "Heimsieg Heim")!;
    const away = tips.find((entry) => entry.selection === "Auswärtssieg Gast")!;
    assert.ok(Math.abs(home.fair - (1 / 1.6) / book) < 1e-12);
    assert.ok(Math.abs(away.model - 0.2) < 1e-12);
    assert.ok(tips.some((entry) => entry.marketKey === "draw"));
  });

  it("lässt Märkte ohne Gegenquote und ohne belastbare Wahrscheinlichkeit weg", () => {
    const tips = tipsOf(fixture([
      market("over25", 1.7),
      market("btts", 1.6, { probabilityReliable: false }), market("bttsNo", 2.2)
    ]));
    assert.deepEqual(tips.map((entry) => entry.marketKey), ["bttsNo"]);
  });
});

describe("chooseTip", () => {
  it("nimmt den besten Tipp ab 1,60, solange der darunter nicht mehr als 3 Punkte besser ist", () => {
    const preferred = tip(1.62, 0.58);
    assert.equal(chooseTip([tip(1.5, 0.6), preferred])!.chosen, preferred);
  });

  it("nimmt den Tipp unter 1,60, wenn er mehr als 3 Punkte besser ist", () => {
    const fallback = tip(1.5, 0.615);
    assert.equal(chooseTip([fallback, tip(1.6, 0.584)])!.chosen, fallback);
  });

  it("nie unter der Mindestquote, und ohne Kandidaten nichts", () => {
    assert.equal(chooseTip([tip(1.45, 0.66)]), null);
    assert.equal(chooseTip([tip(1.45, 0.66), tip(1.55, 0.6)])!.chosen.odds, 1.55);
    assert.equal(KOMBI_RULE.minOdds, 1.5);
  });
});

describe("flagsOf", () => {
  it("meldet eine 1X2-Quote bis 1,05 und einen großen Abstand zwischen Modell und Preis", () => {
    const flags = flagsOf(fixture([
      market("1x2", 1.02, { pick: "1", probability: 0.65, oddsHome: 1.02, oddsAway: 19 }),
      market("draw", 9.5, { probability: 0.2 })
    ]));
    assert.deepEqual(flags.find((flag) => flag.code === "quote"), { code: "quote", odds: 1.02 });
    const gap = flags.find((flag) => flag.code === "modellAbstand");
    assert.ok(gap && gap.code === "modellAbstand" && gap.side === "1" && gap.model === 0.65);
    // Die Kommandozeile druckt dieselben Zeilen wie vor der Umstellung auf Codes.
    const texts = flags.map(flagText);
    assert.ok(texts.includes("1X2-Quote 1.02"));
    assert.ok(texts.some((text) => text.startsWith("1X2 Heim: Modell 65 % gegen fair ")));
  });

  it("formuliert jeden Grund für die Kommandozeile wie bisher", () => {
    assert.equal(flagText({ code: "aufschlag", book: 1.2345 }), "1X2-Aufschlag 1.234");
    assert.equal(flagText({ code: "gleicheQuoten" }), "1X2 dreimal dieselbe Quote");
    assert.equal(flagText({ code: "modellAbstand", side: "2", model: 0.1, fair: 0.42 }), "1X2 Gast: Modell 10 % gegen fair 42 %");
    assert.equal(flagText({ code: "anstoss", tipico: "A", api: "B" }), "Anstoß Tipico A gegen API B");
  });

  it("meldet einen Anstoß, der bei Tipico über eine Stunde abweicht", () => {
    assert.equal(flagsOf(fixture([]), "2026-10-13T17:30:00Z").length, 0);
    assert.equal(flagsOf(fixture([]), "2026-10-13T19:30:00Z").length, 1);
  });
});

describe("Kombis", () => {
  it("multipliziert Quoten und faire Chancen", () => {
    const stats = comboStats([tip(1.5, 0.6), tip(2, 0.45)]);
    assert.ok(Math.abs(stats.odds - 3) < 1e-12);
    assert.ok(Math.abs(stats.fair - 0.27) < 1e-12);
    assert.ok(Math.abs(stats.longRun - (3 * 0.27 - 1)) < 1e-12);
  });

  it("teilt nach Reihenfolge und hängt einen einzelnen Rest an die letzte Kombi", () => {
    assert.deepEqual(splitIntoCombos([1, 2, 3, 4, 5, 6, 7, 8], 4), [[1, 2, 3, 4], [5, 6, 7, 8]]);
    assert.deepEqual(splitIntoCombos([1, 2, 3, 4, 5], 4), [[1, 2, 3, 4, 5]]);
    assert.deepEqual(splitIntoCombos([1, 2, 3, 4, 5, 6], 4), [[1, 2, 3, 4], [5, 6]]);
  });
});

describe("parseBerlin", () => {
  it("liest Datum als Tagesende und Ortszeit ohne Zone als Berliner Zeit, auch über die Zeitumstellung", () => {
    assert.equal(new Date(parseBerlin("2026-10-14")).toISOString(), "2026-10-14T21:59:59.000Z");
    assert.equal(new Date(parseBerlin("2026-10-13T09:00")).toISOString(), "2026-10-13T07:00:00.000Z");
    assert.equal(new Date(parseBerlin("2026-11-02T09:00")).toISOString(), "2026-11-02T08:00:00.000Z");
    assert.equal(parseBerlin("2026-10-13T09:00:00+02:00"), Date.parse("2026-10-13T07:00:00Z"));
    assert.equal(parseBerlin("now", 42), 42);
  });
});
