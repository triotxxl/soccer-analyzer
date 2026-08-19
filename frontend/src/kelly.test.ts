import { describe, expect, it } from "vitest";
import { computeKellyCandidates, DEFAULT_KELLY_SETTINGS, edgeOf, impliedProbability, type KellySettings } from "./kelly";
import type { DashboardFixture, DashboardMarket, DashboardMarketKey } from "./types";

function market(key: DashboardMarketKey, probability: number, odds: number | null): DashboardMarket {
  return {
    key, label: key, selection: `Auswahl ${key}`, pick: null, selectionTone: "neutral",
    probability, odds, confidence: 85, score: null,
    recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
  };
}

function fixture(id: number, homeTeam: string, markets: DashboardMarket[]): DashboardFixture {
  return {
    fixtureId: id, kickoff: "2026-08-20T18:00:00.000Z", country: "Land", league: "Liga",
    homeTeam, awayTeam: `Gast ${id}`, modelVersion: "test", crossLeague: false, dataConfidence: 85,
    warnings: [], h2hNotice: null,
    form: { scope: "venue", home: [], away: [], homeMatches: [], awayMatches: [] },
    h2h: { outcomes: [], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    expectedGoals: { home: 1.4, away: 1.1, total: 2.5 }, scores: { favorite: null, draw: null },
    markets
  };
}

function settings(overrides: Partial<KellySettings> = {}): KellySettings {
  return { ...DEFAULT_KELLY_SETTINGS, ...overrides };
}

describe("impliedProbability", () => {
  it("ist der Kehrwert der Quote", () => {
    expect(impliedProbability(2)).toBeCloseTo(0.5);
    expect(impliedProbability(2.5)).toBeCloseTo(0.4);
  });
});

describe("edgeOf", () => {
  it("ist Modellwahrscheinlichkeit minus implizierte Wahrscheinlichkeit", () => {
    const btts = market("btts", 0.6, 1.9);
    expect(edgeOf(btts)).toBeCloseTo(0.6 - 1 / 1.9);
  });

  it("ist null ohne Quote", () => {
    expect(edgeOf(market("btts", 0.6, null))).toBeNull();
  });
});

describe("computeKellyCandidates", () => {
  it("nimmt Wetten mit positivem Value und positivem Full Kelly auf", () => {
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.6, 1.9)])];
    const { candidates, evaluated } = computeKellyCandidates(fixtures, "btts", settings({ minEdge: 0, maxStakePercent: 1, maxExposurePercent: 1 }));
    expect(evaluated).toBe(1);
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.edge).toBeCloseTo(0.6 - 1 / 1.9);
    expect(candidate.fullKelly).toBeCloseTo((0.6 * 1.9 - 1) / (1.9 - 1));
    expect(candidate.stakePercent).toBeCloseTo(candidate.fullKelly * DEFAULT_KELLY_SETTINGS.kellyFraction);
    expect(candidate.stake).toBeCloseTo(settings().budget * candidate.stakePercent);
  });

  it("schließt Wetten ohne Value aus (NO BET)", () => {
    // Modellwahrscheinlichkeit 48% bei Quote 2.00 -> negativer Kelly, keine Wette
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.48, 2.0)])];
    const { candidates, evaluated } = computeKellyCandidates(fixtures, "btts", settings({ minEdge: -1 }));
    expect(evaluated).toBe(1);
    expect(candidates).toHaveLength(0);
  });

  it("schließt Märkte ohne Quote aus", () => {
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.8, null)])];
    const { candidates } = computeKellyCandidates(fixtures, "btts", settings());
    expect(candidates).toHaveLength(0);
  });

  it("filtert nach Mindestquote und Mindest-Edge", () => {
    const highEdgeLowOdds = market("btts", 0.9, 1.2);
    const lowEdgeHighOdds = market("over15", 0.55, 2.2);
    const fixtures = [fixture(1, "Alpha", [highEdgeLowOdds]), fixture(2, "Beta", [lowEdgeHighOdds])];

    const filteredByOdds = computeKellyCandidates(fixtures, "btts", settings({ minOdds: 1.5, minEdge: 0 }));
    expect(filteredByOdds.candidates).toHaveLength(0);

    const filteredByEdge = computeKellyCandidates(fixtures, "over15", settings({ minEdge: 0.5 }));
    expect(filteredByEdge.candidates).toHaveLength(0);
  });

  it("skaliert Einsätze proportional herunter, wenn das Gesamtrisiko-Limit überschritten wird", () => {
    const fixtures = [
      fixture(1, "Alpha", [market("btts", 0.9, 3)]),
      fixture(2, "Beta", [market("btts", 0.9, 3)]),
      fixture(3, "Gamma", [market("btts", 0.9, 3)])
    ];
    const config = settings({ kellyFraction: 1, maxStakePercent: 1, maxExposurePercent: 0.1, minEdge: 0 });
    const { candidates, scaleFactor } = computeKellyCandidates(fixtures, "btts", config);
    expect(candidates).toHaveLength(3);
    expect(scaleFactor).toBeLessThan(1);
    const totalStake = candidates.reduce((sum, candidate) => sum + candidate.stake, 0);
    expect(totalStake).toBeCloseTo(config.budget * config.maxExposurePercent);
  });

  it("behält bei 'all' pro Spiel nur den Markt mit dem höchsten Value", () => {
    const weakPick = market("btts", 0.55, 2.0);
    const strongPick = market("over25", 0.65, 2.0);
    const fixtures = [fixture(1, "Alpha", [weakPick, strongPick])];
    const { candidates } = computeKellyCandidates(fixtures, "all", settings({ minEdge: 0 }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.marketKey).toBe("over25");
  });

  it("skaliert nicht, solange die Kelly-Summe unter dem Gesamtrisiko-Limit bleibt", () => {
    const fixtures = [1, 2, 3, 4, 5].map((id) => fixture(id, `Team${id}`, [market("btts", 0.55, 2.2)]));
    const config = settings({ kellyFraction: 0.25, maxStakePercent: 1, maxExposurePercent: 1, minEdge: 0 });
    const { candidates, scaleFactor } = computeKellyCandidates(fixtures, "btts", config);
    expect(scaleFactor).toBe(1);
    const totalStake = candidates.reduce((sum, candidate) => sum + candidate.stake, 0);
    expect(totalStake).toBeLessThan(config.budget * config.maxExposurePercent);
  });

  it("Full Kelly liefert ohne Caps den vierfachen Einsatz von 1/4 Kelly", () => {
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.6, 2.2)])];
    const base = { maxStakePercent: 1, maxExposurePercent: 1, minEdge: 0 };
    const full = computeKellyCandidates(fixtures, "btts", settings({ ...base, kellyFraction: 1 })).candidates[0]!;
    const quarter = computeKellyCandidates(fixtures, "btts", settings({ ...base, kellyFraction: 0.25 })).candidates[0]!;
    expect(full.stake).toBeCloseTo(quarter.stake * 4);
  });

  it("unterschiedliche Kelly-Fraktionen bleiben bei maxExposure=100% unterschiedlich", () => {
    const fixtures = [1, 2, 3].map((id) => fixture(id, `Team${id}`, [market("btts", 0.6, 2.2)]));
    const base = { maxStakePercent: 1, maxExposurePercent: 1, minEdge: 0 };
    const sums = [1, 0.5, 0.25, 0.125].map((kellyFraction) => {
      const { candidates, scaleFactor } = computeKellyCandidates(fixtures, "btts", settings({ ...base, kellyFraction }));
      expect(scaleFactor).toBe(1);
      return candidates.reduce((sum, candidate) => sum + candidate.stake, 0);
    });
    expect(new Set(sums.map((sum) => sum.toFixed(6))).size).toBe(sums.length);
  });

  it("deckelt den Einsatz pro Wette, ohne die Kelly-Empfehlung zu erhöhen", () => {
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.65, 2.3)])];
    const config = settings({ kellyFraction: 1, maxStakePercent: 0.03, maxExposurePercent: 1, minEdge: 0 });
    const [candidate] = computeKellyCandidates(fixtures, "btts", config).candidates;
    expect(candidate!.fullKelly).toBeGreaterThan(0.03);
    expect(candidate!.stakePercent).toBeCloseTo(0.03);
  });

  it("finalStake übersteigt nie fullKelly * Fraktion * Budget, auch nach Exposure-Scaling", () => {
    const fixtures = Array.from({ length: 8 }, (_, index) =>
      fixture(index + 1, `Team${index}`, [market("btts", 0.6 + index * 0.01, 2 + index * 0.05)]));
    const config = settings({ kellyFraction: 0.25, maxStakePercent: 0.03, maxExposurePercent: 0.1, minEdge: 0 });
    const { candidates } = computeKellyCandidates(fixtures, "btts", config);
    for (const candidate of candidates) {
      const theoretical = candidate.fullKelly * config.kellyFraction * config.budget;
      expect(candidate.stake).toBeLessThanOrEqual(theoretical + 1e-9);
    }
  });
});
