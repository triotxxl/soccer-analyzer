import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DashboardFixture, DashboardMarket } from "../src/dashboard.ts";
import { fairProbabilityOf } from "../src/fair-price.ts";

function market(key: DashboardMarket["key"], odds: number | null, extra: Partial<DashboardMarket> = {}): DashboardMarket {
  return {
    key, label: key, selection: key, pick: null, selectionTone: "neutral", probability: 0.5, odds,
    confidence: 80, score: null, recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: [],
    ...extra
  };
}

function fixture(markets: DashboardMarket[]): DashboardFixture {
  return { fixtureId: 1, markets } as unknown as DashboardFixture;
}

describe("fairProbabilityOf", () => {
  it("entfernt den Aufschlag eines Zweiweg-Marktes über die Gegenquote", () => {
    const btts = market("btts", 1.8);
    const result = fairProbabilityOf(fixture([btts, market("bttsNo", 1.9)]), btts)!;
    assert.equal(result.source, "quote");
    const book = 1 / 1.8 + 1 / 1.9;
    assert.ok(Math.abs(result.probability - (1 / 1.8) / book) < 1e-12);
  });

  it("nimmt bei Remis und 1X2 den Dreiweg aus Heim, Remis und Gast", () => {
    const oneXTwo = market("1x2", 2.1, { pick: "1", oddsHome: 2.1, oddsAway: 3.6 });
    const draw = market("draw", 3.4);
    const book = 1 / 2.1 + 1 / 3.4 + 1 / 3.6;
    const home = fairProbabilityOf(fixture([oneXTwo, draw]), oneXTwo)!;
    const remis = fairProbabilityOf(fixture([oneXTwo, draw]), draw)!;
    assert.equal(home.source, "quote");
    assert.ok(Math.abs(home.probability - (1 / 2.1) / book) < 1e-12);
    assert.ok(Math.abs(remis.probability - (1 / 3.4) / book) < 1e-12);
  });

  it("schätzt den Aufschlag, wenn die Gegenquote fehlt", () => {
    const over = market("over25", 2);
    const result = fairProbabilityOf(fixture([over]), over)!;
    assert.equal(result.source, "geschätzt");
    assert.ok(Math.abs(result.probability - 0.5 / 1.082) < 1e-12);
  });

  it("liefert ohne Quote nichts", () => {
    const over = market("over25", null);
    assert.equal(fairProbabilityOf(fixture([over]), over), null);
  });
});
