import { describe, expect, it } from "vitest";
import { buildKellyExport, computeKellyCandidates, DEFAULT_KELLY_SETTINGS, edgeOf, impliedProbability, kellyExportFileName, loadKellySettings, type KellySettings } from "./kelly";
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

  it("ist null, wenn die Wahrscheinlichkeit nicht belastbar ist", () => {
    expect(edgeOf({ ...market("1x2", 0.65, 12), probabilityReliable: false })).toBeNull();
  });

  it("bleibt gültig, wenn das Feld fehlt oder true ist", () => {
    expect(edgeOf({ ...market("1x2", 0.65, 12), probabilityReliable: true })).toBeCloseTo(0.65 - 1 / 12);
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

  it("überspringt Märkte ohne belastbare Wahrscheinlichkeit", () => {
    const unreliable = { ...market("1x2", 0.65, 12), probabilityReliable: false };
    const fixtures = [fixture(1, "Alpha", [unreliable])];
    const { candidates, evaluated } = computeKellyCandidates(fixtures, "1x2", settings({ minEdge: 0, maxStakePercent: 1, maxExposurePercent: 1 }));
    expect(evaluated).toBe(1);
    expect(candidates).toHaveLength(0);
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
    const base = { maxStakePercent: 1, maxExposurePercent: 1, minEdge: 0, enableGameRiskLimit: false };
    const full = computeKellyCandidates(fixtures, "btts", settings({ ...base, kellyFraction: 1 })).candidates[0]!;
    const quarter = computeKellyCandidates(fixtures, "btts", settings({ ...base, kellyFraction: 0.25 })).candidates[0]!;
    expect(full.stake).toBeCloseTo(quarter.stake * 4);
  });

  it("unterschiedliche Kelly-Fraktionen bleiben bei maxExposure=100% unterschiedlich", () => {
    const fixtures = [1, 2, 3].map((id) => fixture(id, `Team${id}`, [market("btts", 0.6, 2.2)]));
    const base = { maxStakePercent: 1, maxExposurePercent: 1, minEdge: 0, enableGameRiskLimit: false };
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

describe("Game-Risk-Limit", () => {
  // Basis: Budget 100 €, Limit 5 % => 5 € pro Partie über alle Märkte. Ohne Pro-Wette- und
  // Gesamtrisiko-Cap, damit ausschließlich das Game-Risk-Limit wirkt.
  function gameSettings(overrides: Partial<KellySettings> = {}): KellySettings {
    return settings({
      allowMultipleMarketsPerGame: true,
      enableGameRiskLimit: true,
      maxRiskPerGame: 0.05,
      kellyFraction: 0.25,
      maxStakePercent: 1,
      maxExposurePercent: 1,
      minEdge: 0,
      ...overrides
    });
  }

  function stakeSumOf(candidates: Array<{ fixtureId: number; stake: number }>, fixtureId: number): number {
    return candidates.filter((candidate) => candidate.fixtureId === fixtureId).reduce((sum, candidate) => sum + candidate.stake, 0);
  }

  it("lässt eine Partie mit einem einzigen Markt unter dem Limit unverändert", () => {
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.55, 2.0)])];
    const { candidates, gameRiskLimits } = computeKellyCandidates(fixtures, "all", gameSettings());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.stake).toBeCloseTo(2.5);
    expect(candidates[0]!.gameScaleFactor).toBe(1);
    expect(gameRiskLimits).toHaveLength(1);
    expect(gameRiskLimits[0]!.scaleFactor).toBe(1);
    expect(gameRiskLimits[0]!.stakeAfter).toBeCloseTo(gameRiskLimits[0]!.stakeBefore);
  });

  it("lässt mehrere Märkte einer Partie unterhalb des Limits unverändert", () => {
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.55, 2.0), market("over25", 0.56, 2.0)])];
    const { candidates, gameRiskLimits } = computeKellyCandidates(fixtures, "all", gameSettings({ kellyFraction: 0.125 }));
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.stake).toBeCloseTo(1.25);
    expect(candidates[1]!.stake).toBeCloseTo(1.5);
    expect(candidates.every((candidate) => candidate.gameScaleFactor === 1)).toBe(true);
    expect(gameRiskLimits[0]!.stakeBefore).toBeCloseTo(2.75);
  });

  it("skaliert mehrere Märkte einer Partie proportional auf das Limit", () => {
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.6, 2.2), market("over25", 0.65, 2.0)])];
    const config = gameSettings();
    const { candidates, gameRiskLimits } = computeKellyCandidates(fixtures, "all", config);

    const limit = config.budget * config.maxRiskPerGame;
    expect(stakeSumOf(candidates, 1)).toBeCloseTo(limit);
    // Relative Gewichte bleiben erhalten: 6,6667 € zu 7,50 € vor dem Limit.
    expect(candidates[0]!.stake / candidates[1]!.stake).toBeCloseTo((100 * 0.2 / 3) / 7.5);
    const expectedFactor = limit / (100 * 0.2 / 3 + 7.5);
    expect(candidates[0]!.gameScaleFactor).toBeCloseTo(expectedFactor);
    expect(candidates[1]!.gameScaleFactor).toBeCloseTo(expectedFactor);
    expect(gameRiskLimits).toHaveLength(1);
    expect(gameRiskLimits[0]!.homeTeam).toBe("Alpha");
    expect(gameRiskLimits[0]!.limit).toBeCloseTo(limit);
    expect(gameRiskLimits[0]!.stakeBefore).toBeCloseTo(100 * 0.2 / 3 + 7.5);
    expect(gameRiskLimits[0]!.stakeAfter).toBeCloseTo(limit);
    expect(gameRiskLimits[0]!.scaleFactor).toBeCloseTo(expectedFactor);
  });

  it("gruppiert und begrenzt auch drei Märkte derselben Partie", () => {
    const fixtures = [fixture(1, "Alpha", [
      market("btts", 0.6, 2.2), market("over25", 0.65, 2.0), market("over15", 0.8, 1.6)
    ])];
    const config = gameSettings();
    const { candidates, gameRiskLimits } = computeKellyCandidates(fixtures, "all", config);
    expect(candidates).toHaveLength(3);
    expect(gameRiskLimits).toHaveLength(1);
    expect(gameRiskLimits[0]!.stakeBefore).toBeCloseTo(100 * 0.2 / 3 + 7.5 + 100 * 7 / 60);
    expect(stakeSumOf(candidates, 1)).toBeCloseTo(config.budget * config.maxRiskPerGame);
    expect(candidates.every((candidate) => candidate.gameScaleFactor < 1)).toBe(true);
  });

  it("skaliert das Beispiel aus 126,75 € Bankroll auf 6,34 € je Spiel", () => {
    // Zwei Märkte, beide durch den Pro-Wette-Cap auf exakt 6 € gedeckelt => 12 € vor dem Limit.
    const budget = 126.75;
    const fixtures = [fixture(1, "Dortmund", [market("btts", 0.6, 2.2), market("over25", 0.65, 2.0)])];
    const config = gameSettings({ budget, kellyFraction: 1, maxStakePercent: 6 / budget });
    const { candidates, gameRiskLimits } = computeKellyCandidates(fixtures, "all", config);

    const game = gameRiskLimits[0]!;
    expect(game.stakeBefore).toBeCloseTo(12);
    expect(game.limit).toBeCloseTo(6.3375);
    expect(game.scaleFactor).toBeCloseTo(0.528125);
    expect(game.stakeAfter).toBeCloseTo(6.3375);
    expect(stakeSumOf(candidates, 1)).toBeCloseTo(6.3375);
    expect(candidates[0]!.stake).toBeCloseTo(3.16875);
    expect(candidates[1]!.stake).toBeCloseTo(3.16875);
  });

  it("begrenzt verschiedene Spiele getrennt voneinander", () => {
    const fixtures = [
      fixture(1, "Alpha", [market("btts", 0.6, 2.2), market("over25", 0.65, 2.0)]),
      fixture(2, "Beta", [market("btts", 0.55, 2.0)])
    ];
    const config = gameSettings();
    const { candidates, gameRiskLimits } = computeKellyCandidates(fixtures, "all", config);

    expect(stakeSumOf(candidates, 1)).toBeCloseTo(config.budget * config.maxRiskPerGame);
    expect(stakeSumOf(candidates, 2)).toBeCloseTo(2.5);
    const beta = candidates.find((candidate) => candidate.fixtureId === 2)!;
    expect(beta.gameScaleFactor).toBe(1);
    expect(gameRiskLimits).toHaveLength(2);
    expect(gameRiskLimits.find((game) => game.fixtureId === 2)!.scaleFactor).toBe(1);
  });

  it("wendet danach weiterhin das Gesamtrisiko-Limit an", () => {
    const fixtures = [1, 2, 3].map((id) =>
      fixture(id, `Team${id}`, [market("btts", 0.6, 2.2), market("over25", 0.65, 2.0)]));
    const config = gameSettings({ maxExposurePercent: 0.1 });
    const { candidates, scaleFactor } = computeKellyCandidates(fixtures, "all", config);

    const gameLimit = config.budget * config.maxRiskPerGame;
    const totalStake = candidates.reduce((sum, candidate) => sum + candidate.stake, 0);
    expect(totalStake).toBeCloseTo(config.budget * config.maxExposurePercent);
    // Drei Partien à 5 € nach dem Game-Limit, gedeckelt auf 10 € Gesamtrisiko.
    expect(scaleFactor).toBeCloseTo(10 / 15);
    for (const id of [1, 2, 3]) {
      expect(stakeSumOf(candidates, id)).toBeLessThanOrEqual(gameLimit + 1e-9);
    }
  });

  it("stellt bei deaktiviertem Limit das bisherige Verhalten her", () => {
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.6, 2.2), market("over25", 0.65, 2.0)])];
    const { candidates, gameRiskLimits } = computeKellyCandidates(fixtures, "all", gameSettings({ enableGameRiskLimit: false }));

    expect(gameRiskLimits).toHaveLength(0);
    expect(candidates[0]!.stake).toBeCloseTo(100 * 0.2 / 3);
    expect(candidates[1]!.stake).toBeCloseTo(7.5);
    expect(candidates.every((candidate) => candidate.gameScaleFactor === 1)).toBe(true);
  });

  it("behält ohne Multi-Markt-Schalter einen Kandidaten je Partie", () => {
    const fixtures = [fixture(1, "Alpha", [market("btts", 0.6, 2.2), market("over25", 0.65, 2.0)])];
    const { candidates } = computeKellyCandidates(fixtures, "all", gameSettings({ allowMultipleMarketsPerGame: false }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.marketKey).toBe("over25");
  });

  it("meldet im Export die begrenzten Partien", () => {
    const fixtures = [
      fixture(1, "Alpha", [market("btts", 0.6, 2.2), market("over25", 0.65, 2.0)]),
      fixture(2, "Beta", [market("btts", 0.55, 2.0)])
    ];
    const config = gameSettings();
    const result = computeKellyCandidates(fixtures, "all", config);
    const exported = buildKellyExport(result, { marketFilter: "all", marketLabel: "Alle Märkte", settings: config });
    expect(exported.summary.limitedGames).toBe(1);
    expect(exported.gameRiskLimits).toHaveLength(2);
  });

  it("ergänzt gespeicherte Einstellungen ohne die neuen Felder aus den Defaults", () => {
    window.localStorage.setItem("football-analyzer:kelly-settings", JSON.stringify({
      budget: 126.75, minOdds: 1.4, kellyFraction: 0.5, maxStakePercent: 0.04, maxExposurePercent: 0.3, minEdge: 0.01
    }));
    try {
      const loaded = loadKellySettings();
      expect(loaded.budget).toBe(126.75);
      expect(loaded.kellyFraction).toBe(0.5);
      expect(loaded.allowMultipleMarketsPerGame).toBe(DEFAULT_KELLY_SETTINGS.allowMultipleMarketsPerGame);
      expect(loaded.enableGameRiskLimit).toBe(DEFAULT_KELLY_SETTINGS.enableGameRiskLimit);
      expect(loaded.maxRiskPerGame).toBe(DEFAULT_KELLY_SETTINGS.maxRiskPerGame);
    } finally {
      window.localStorage.removeItem("football-analyzer:kelly-settings");
    }
  });
});

describe("Kelly-Export", () => {
  it("baut den Dateinamen aus Marktfilter und lokalem Datum", () => {
    expect(kellyExportFileName("all", new Date(2026, 7, 23))).toBe("kelly-all-2026-08-23.json");
    expect(kellyExportFileName("btts", new Date(2026, 0, 5))).toBe("kelly-btts-2026-01-05.json");
  });

  it("übernimmt die angezeigte Liste in unveränderter Reihenfolge samt Kontext", () => {
    const fixtures = [
      fixture(1, "Alpha", [market("btts", 0.6, 2.2)]),
      fixture(2, "Beta", [market("btts", 0.55, 2.0)])
    ];
    const config = settings({ minEdge: 0, maxStakePercent: 1, maxExposurePercent: 1, enableGameRiskLimit: false });
    const result = computeKellyCandidates(fixtures, "btts", config);
    const displayed = [...result.candidates].reverse();
    const exported = buildKellyExport({ ...result, candidates: displayed }, {
      marketFilter: "btts",
      marketLabel: "Beide treffen",
      settings: config,
      generatedAt: new Date("2026-08-23T10:00:00.000Z")
    });

    expect(exported.generatedAt).toBe("2026-08-23T10:00:00.000Z");
    expect(exported.marketFilter).toBe("btts");
    expect(exported.marketLabel).toBe("Beide treffen");
    expect(exported.settings).toEqual(config);
    expect(exported.bets.map((bet) => bet.fixtureId)).toEqual([2, 1]);
    expect(exported.bets[0]!.marketLabel).toBe("btts");
    expect(exported.summary.evaluated).toBe(2);
    expect(exported.summary.candidates).toBe(2);
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
  });

  it("rundet Beträge auf Cent und behält die Verhältnisse mit sechs Stellen", () => {
    const budget = 126.75;
    const fixtures = [fixture(1, "Dortmund", [market("btts", 0.6, 2.2), market("over25", 0.65, 2.0)])];
    const config = settings({
      allowMultipleMarketsPerGame: true, enableGameRiskLimit: true, maxRiskPerGame: 0.05,
      budget, kellyFraction: 1, maxStakePercent: 6 / budget, maxExposurePercent: 1, minEdge: 0
    });
    const result = computeKellyCandidates(fixtures, "all", config);
    const exported = buildKellyExport(result, { marketFilter: "all", marketLabel: "Alle Märkte", settings: config });

    expect(exported.bets.map((bet) => bet.stake)).toEqual([3.17, 3.17]);
    expect(exported.summary.totalStake).toBe(6.34);
    const game = exported.gameRiskLimits[0]!;
    expect(game.stakeBefore).toBe(12);
    expect(game.limit).toBe(6.34);
    expect(game.stakeAfter).toBe(6.34);
    expect(game.scaleFactor).toBe(0.528125);
  });
});
