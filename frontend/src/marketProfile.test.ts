import { describe, expect, it } from "vitest";
import { buildMarketProfile, type MarketObservation } from "../../src/market-profile";
import {
  computeKellyCandidates, DEFAULT_KELLY_SETTINGS, expectedValueOf, recommendedSettings,
  stakeSlots, TEST_RUN_SETTINGS
} from "./kelly";
import type { DashboardFixture, DashboardMarketKey } from "./types";

function observations(marketKey: string, n: number, wins: number, probability: number, odds: number): MarketObservation[] {
  return Array.from({ length: n }, (_unused, index) => ({
    marketKey,
    marketLabel: marketKey,
    kickoff: `2026-03-${String(1 + Math.floor(index / 40)).padStart(2, "0")}T18:00:00+01:00`,
    probability,
    odds,
    edge: probability - 1 / odds,
    hit: ((index * wins) % n < wins ? 1 : 0) as 0 | 1
  }));
}

function fixture(marketKey: DashboardMarketKey, probability: number, odds: number, crossLeague = false): DashboardFixture {
  return {
    fixtureId: 1, kickoff: "2026-09-10T18:00:00+02:00", country: "Deutschland", league: "Bundesliga",
    homeTeam: "A", awayTeam: "B", crossLeague,
    markets: [{
      key: marketKey, label: marketKey, selection: "Auswahl", pick: null, selectionTone: "neutral",
      probability, odds, confidence: 90, score: null,
      recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
    }]
  } as unknown as DashboardFixture;
}

describe("Automatik im Kelly-Picker", () => {
  it("rechnet den Einsatz aus der korrigierten, nicht der behaupteten Wahrscheinlichkeit", () => {
    // Der Markt behauptet 60 % und erreicht 45 %. Die Quote 2,0 verlangt 50 %.
    const profile = buildMarketProfile(observations("over25", 200, 90, 0.6, 2));
    const settings = recommendedSettings(DEFAULT_KELLY_SETTINGS);
    const fixtures = [fixture("over25", 0.6, 2)];

    const manual = computeKellyCandidates(fixtures, "all", settings, null);
    const automatic = computeKellyCandidates(fixtures, "all", settings, profile);

    // Ohne Korrektur sieht die Zeile nach 10 Punkten Vorteil aus und wird gesetzt.
    expect(manual.candidates).toHaveLength(1);
    // Mit Korrektur bleibt kein Vorteil - die Wette entfällt.
    expect(automatic.candidates).toHaveLength(0);
  });

  it("behält eine Zeile, die auch nach dem Abschlag trägt, und weist den Abschlag aus", () => {
    const profile = buildMarketProfile(observations("draw", 200, 60, 0.32, 4));
    const automatic = computeKellyCandidates(
      [fixture("draw", 0.32, 5)], "all", recommendedSettings(DEFAULT_KELLY_SETTINGS), profile);

    expect(automatic.candidates).toHaveLength(1);
    const candidate = automatic.candidates[0]!;
    expect(candidate.probability).toBeCloseTo(0.32, 5);
    expect(candidate.calibratedProbability).not.toBeNull();
    expect(candidate.calibratedProbability!).toBeLessThan(candidate.probability);
    expect(candidate.calibrationBias!).toBeLessThan(0);
    expect(candidate.reason).toContain("korrigiert");
    // Der Einsatz folgt der Korrektur, nicht dem Modell.
    const modelKelly = (0.32 * 5 - 1) / (5 - 1);
    expect(candidate.fullKelly).toBeLessThan(modelKelly);
  });

  it("lässt Cross-League-Partien in der Automatik aus", () => {
    const profile = buildMarketProfile(observations("draw", 200, 60, 0.32, 4));
    const result = computeKellyCandidates(
      [fixture("draw", 0.32, 5, true)], "all", recommendedSettings(DEFAULT_KELLY_SETTINGS), profile);
    expect(result.candidates).toHaveLength(0);
  });

  it("arbeitet ohne Profil unverändert wie zuvor", () => {
    const fixtures = [fixture("over25", 0.6, 2)];
    const result = computeKellyCandidates(fixtures, "all", DEFAULT_KELLY_SETTINGS, null);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.calibratedProbability).toBeNull();
    expect(result.candidates[0]!.reason).toBeNull();
  });

  it("räumt in den abgeleiteten Einstellungen nur die Auswahlregler ab", () => {
    const base = {
      ...DEFAULT_KELLY_SETTINGS,
      budget: 250,
      kellyFraction: 0.5,
      maxExposurePercent: 1,
      allowMultipleMarketsPerGame: true
    };
    const derived = recommendedSettings(base);
    expect(derived.budget).toBe(250);
    expect(derived.kellyFraction).toBe(0.5);
    expect(derived.maxStakePercent).toBe(base.maxStakePercent);
    expect(derived.disabledMarkets).toEqual([]);
    expect(derived.maxEdge).toBeNull();
    expect(derived.minEdge).toBe(0);
    expect(derived.excludeCrossLeague).toBe(true);
    // Mehrere Märkte je Partie sind eine Frage der Auswahl und gehören der Automatik ...
    expect(derived.allowMultipleMarketsPerGame).toBe(false);
    // ... der Einsatzrahmen dagegen ist eine Frage des Geldbeutels und bleibt beim Nutzer.
    expect(derived.maxExposurePercent).toBe(1);
  });

  it("rechnet die Stückzahl aus dem Verhältnis der beiden Prozentsätze, nicht aus dem Budget", () => {
    const base = { ...DEFAULT_KELLY_SETTINGS, maxStakePercent: 0.02, maxExposurePercent: 0.7, minStake: 1 };
    // 0,70 / 0,02 = 35 Plätze - unabhängig davon, ob 100 oder 10.000 Euro im Spiel sind.
    expect(stakeSlots({ ...base, budget: 100 }).plaetze).toBe(35);
    expect(stakeSlots({ ...base, budget: 10_000 }).plaetze).toBe(35);
    // Die alte Anzeige nannte allein diese optimistische Grenze und war damit doppelt so groß.
    expect(stakeSlots({ ...base, budget: 100 }).hoechstens).toBe(70);
    // Der enge Rahmen schneidet auf ein Drittel zusammen - das war der unbemerkte Hebel.
    expect(stakeSlots({ ...base, budget: 100, maxExposurePercent: 0.25 }).plaetze).toBe(12);
    // Bei sehr kleinem Budget bindet dagegen der Mindesteinsatz.
    expect(stakeSlots({ ...base, budget: 20 }).plaetze).toBe(14);
  });

  it("setzt mit dem Testbetrieb alle Messeinstellungen in einem Zug", () => {
    const abweichend = {
      ...DEFAULT_KELLY_SETTINGS, budget: 126.26, kellyFraction: 1,
      maxStakePercent: 0.03, maxExposurePercent: 1, minStake: 0, maxBets: 12
    };
    const gesetzt = { ...abweichend, ...TEST_RUN_SETTINGS };
    expect(gesetzt.budget).toBe(100);
    expect(gesetzt.kellyFraction).toBe(0.25);
    expect(gesetzt.maxExposurePercent).toBe(0.7);
    expect(gesetzt.maxBets).toBeNull();
    // Der Rahmen ist weit genug, dass er die typische Auswahl von rund 30 Wetten nicht kappt.
    expect(stakeSlots(gesetzt).plaetze).toBeGreaterThanOrEqual(30);
    // Was die Auswahl betrifft, fasst der Testbetrieb nicht an - das bleibt die Automatik.
    expect(gesetzt.disabledMarkets).toEqual(DEFAULT_KELLY_SETTINGS.disabledMarkets);
  });

  it("wählt je Partie nach dem vollen Kelly-Wert, nicht nach dem rohen Vorteil", () => {
    // Zwei Märkte derselben Partie, bei denen die beiden Maßstäbe auseinanderfallen:
    //   Über 2,5 – 70 % bei Quote 1,60: roher Vorteil 7,5 PP, voller Kelly-Wert 0,200
    //   Remis    – 35 % bei Quote 4,00: roher Vorteil 10,0 PP, voller Kelly-Wert 0,133
    // Der rohe Vorteil spricht für das Remis, der Kelly-Wert für Über 2,5. Weil der Einsatz
    // sich nach dem Kelly-Wert bemisst und ein großer roher Vorteil gemessen das schlechtere
    // Vorzeichen trägt, muss Über 2,5 übrig bleiben.
    const both = {
      fixtureId: 7, kickoff: "2026-09-10T18:00:00+02:00", country: "Deutschland",
      league: "Bundesliga", homeTeam: "A", awayTeam: "B", crossLeague: false,
      markets: [
        {
          key: "over25", label: "Über 2,5", selection: "Auswahl", pick: null, selectionTone: "neutral",
          probability: 0.7, odds: 1.6, confidence: 90, score: null,
          recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
        },
        {
          key: "draw", label: "Remis", selection: "Auswahl", pick: null, selectionTone: "neutral",
          probability: 0.35, odds: 4, confidence: 90, score: null,
          recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
        }
      ]
    } as unknown as DashboardFixture;

    const settings = { ...DEFAULT_KELLY_SETTINGS, allowMultipleMarketsPerGame: false, minStake: 0 };
    const { candidates } = computeKellyCandidates([both], "all", settings, null);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.marketKey).toBe("over25");
  });

  it("rechnet den Erwartungswert aus der korrigierten Wahrscheinlichkeit", () => {
    const profile = buildMarketProfile(observations("draw", 200, 60, 0.32, 4));
    const { candidates } = computeKellyCandidates(
      [fixture("draw", 0.32, 5)], "all", recommendedSettings(DEFAULT_KELLY_SETTINGS), profile);
    const candidate = candidates[0]!;
    expect(expectedValueOf(candidates)).toBeCloseTo(
      candidate.stake * (candidate.calibratedProbability! * candidate.odds - 1), 8);
  });
});

describe("Gegenmärkte im Kelly-Picker", () => {
  it("hebt die Wahrscheinlichkeit eines Unter-Marktes an, wenn er selbst Vorteil hat", () => {
    // Über 2,5 behauptet 60 % und erreicht 45 % - also ist Unter 2,5 um 15 Punkte zu niedrig
    // angesetzt: behauptet 40 %, tatsächlich 55 %. Die Quote 2,6 verlangt 38,5 %, die Zeile
    // hat damit schon roh 1,5 PP Vorteil und die Korrektur legt darauf.
    const profile = buildMarketProfile(observations("over25", 200, 90, 0.6, 1.9));
    const settings = recommendedSettings(DEFAULT_KELLY_SETTINGS);
    const fixtures = [fixture("under25", 0.4, 2.6)];

    const automatic = computeKellyCandidates(fixtures, "all", settings, profile);
    expect(automatic.candidates).toHaveLength(1);
    const candidate = automatic.candidates[0]!;
    expect(candidate.probability).toBeCloseTo(0.4, 5);
    // Nach oben korrigiert, nicht nach unten - das ist der Unterschied zu den Über-Märkten.
    expect(candidate.calibrationBias!).toBeGreaterThan(0);
    expect(candidate.calibratedProbability!).toBeGreaterThan(0.4);
    expect(candidate.calibratedEdge!).toBeGreaterThan(candidate.edge);
  });

  it("lässt einen Gegenmarkt nicht allein durch die Korrektur entstehen", () => {
    // Dieselbe Korrektur, aber bei Quote 2,1 verlangt der Markt 47,6 % und das Modell sagt
    // 40 % - roh also ein Nachteil von 7,6 PP. Angehoben käme die Zeile auf 55 % und sähe
    // nach Vorteil aus; genau diesen Pfad sperrt `AUTO_RULE.minRawEdge`. Der Bias ist an
    // Zeilen mit eigenem Vorteil gemessen und trägt hier nicht.
    const profile = buildMarketProfile(observations("over25", 200, 90, 0.6, 1.9));
    const settings = recommendedSettings(DEFAULT_KELLY_SETTINGS);
    const fixtures = [fixture("under25", 0.4, 2.1)];

    expect(computeKellyCandidates(fixtures, "all", settings, null).candidates).toHaveLength(0);
    expect(computeKellyCandidates(fixtures, "all", settings, profile).candidates).toHaveLength(0);
  });

  it("empfiehlt keinen Gegenmarkt, wenn die Quote den Vorteil auffrisst", () => {
    const profile = buildMarketProfile(observations("over25", 200, 90, 0.6, 1.9));
    // Dieselbe Korrektur, aber eine Quote, die 60 % verlangt.
    const result = computeKellyCandidates(
      [fixture("under25", 0.4, 1.67)], "all", recommendedSettings(DEFAULT_KELLY_SETTINGS), profile);
    expect(result.candidates).toHaveLength(0);
  });

  it("lässt Über 3,5 aus, solange es keinen Spiegelpartner mit Historie gibt", () => {
    const profile = buildMarketProfile(observations("over25", 200, 90, 0.6, 1.9));
    const result = computeKellyCandidates(
      [fixture("over35", 0.35, 3.5)], "all", recommendedSettings(DEFAULT_KELLY_SETTINGS), profile);
    expect(result.candidates).toHaveLength(0);
  });
});

describe("Kein Einsatz auf beide Seiten", () => {
  /** Eine Partie mit zwei Märkten, damit sich ein Gegensatz überhaupt bilden kann. */
  function fixtureWith(markets: Array<[DashboardMarketKey, number, number]>): DashboardFixture {
    return {
      fixtureId: 1, kickoff: "2026-09-10T18:00:00+02:00", country: "Deutschland", league: "Bundesliga",
      homeTeam: "A", awayTeam: "B", crossLeague: false,
      markets: markets.map(([key, probability, odds]) => ({
        key, label: key, selection: "Auswahl", pick: null, selectionTone: "neutral",
        probability, odds, confidence: 90, score: null,
        recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
      }))
    } as unknown as DashboardFixture;
  }

  const mehrfach = (extra: Partial<typeof DEFAULT_KELLY_SETTINGS> = {}) =>
    ({ ...DEFAULT_KELLY_SETTINGS, allowMultipleMarketsPerGame: true, minEdge: 0, maxEdge: null, ...extra });

  it("behält bei einem Gegensatz nur die Seite mit dem besseren Kelly-Wert", () => {
    // Beide Seiten sehen im manuellen Modus nach Vorteil aus - das kann nur passieren, wenn
    // die Wahrscheinlichkeiten nicht mehr exakt komplementär sind.
    const fixtures = [fixtureWith([["btts", 0.62, 1.9], ["bttsNo", 0.5, 2.4]])];
    const result = computeKellyCandidates(fixtures, "all", mehrfach(), null);

    expect(result.candidates).toHaveLength(1);
    // BTTS Nein: (0,5 × 2,4 − 1) / 1,4 = 0,143 schlägt BTTS: (0,62 × 1,9 − 1) / 0,9 = 0,202 nicht.
    expect(result.candidates[0]!.marketKey).toBe("btts");
  });

  it("wirft die schwächere Seite auch dann raus, wenn sie die höhere Quote hat", () => {
    const fixtures = [fixtureWith([["over25", 0.7, 1.6], ["under25", 0.4, 2.3]])];
    const result = computeKellyCandidates(fixtures, "all", mehrfach(), null);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.marketKey).toBe("over25");
  });

  it("lässt vereinbare Märkte derselben Partie nebeneinander stehen", () => {
    // Zwei Tore erfüllen Über 1,5 und Unter 2,5 zugleich - kein Gegensatz.
    const fixtures = [fixtureWith([["over15", 0.8, 1.45], ["under25", 0.45, 2.4]])];
    const result = computeKellyCandidates(fixtures, "all", mehrfach({ minOdds: 1.4 }), null);
    expect(result.candidates.map((c) => c.marketKey).sort()).toEqual(["over15", "under25"]);
  });

  it("greift nicht, solange ohnehin nur ein Markt je Partie erlaubt ist", () => {
    const fixtures = [fixtureWith([["btts", 0.62, 1.9], ["bttsNo", 0.5, 2.4]])];
    const result = computeKellyCandidates(
      fixtures, "all", { ...DEFAULT_KELLY_SETTINGS, minEdge: 0, maxEdge: null }, null);
    expect(result.candidates).toHaveLength(1);
  });
});

describe("Mindesteinsatz und Wettanzahl", () => {
  /** Viele gleichwertige Partien, damit der Einsatzrahmen zur bindenden Grenze wird. */
  function manyFixtures(count: number): DashboardFixture[] {
    return Array.from({ length: count }, (_unused, index) => ({
      fixtureId: index + 1, kickoff: "2026-09-10T18:00:00+02:00",
      country: "Deutschland", league: "Bundesliga",
      homeTeam: `H${index}`, awayTeam: `A${index}`, crossLeague: false,
      markets: [{
        key: "over25", label: "Über 2,5", selection: "Mindestens 3 Tore", pick: null, selectionTone: "neutral",
        // Der Vorteil sinkt leicht mit dem Index, damit eine klare Rangfolge entsteht.
        probability: 0.62 - index * 0.002, odds: 2.0, confidence: 90, score: null,
        recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
      }]
    } as unknown as DashboardFixture));
  }

  const base = { ...DEFAULT_KELLY_SETTINGS, minEdge: 0, maxEdge: null, budget: 100, maxExposurePercent: 0.25 };

  it("setzt keinen Betrag an, den kein Anbieter annimmt", () => {
    const result = computeKellyCandidates(manyFixtures(100), "all", { ...base, minStake: 1 }, null);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) expect(candidate.stake).toBeGreaterThanOrEqual(1);
  });

  it("hält den Einsatzrahmen über die Auswahl statt über kleinere Beträge ein", () => {
    const result = computeKellyCandidates(manyFixtures(100), "all", { ...base, minStake: 1 }, null);
    const summe = result.candidates.reduce((total, candidate) => total + candidate.stake, 0);
    expect(summe).toBeLessThanOrEqual(25.000001);
    // 25 Euro Rahmen bei 1 Euro Mindesteinsatz: höchstens 25 Wetten.
    expect(result.candidates.length).toBeLessThanOrEqual(25);
    expect(result.filtered.belowMinStake).toBeGreaterThan(0);
  });

  it("behält die aussichtsreichsten Auswahlen, nicht die ersten der Liste", () => {
    const result = computeKellyCandidates(manyFixtures(100), "all", { ...base, minStake: 1 }, null);
    // Der Vorteil fällt mit dem Index, also dürfen nur die vordersten Partien übrig bleiben.
    const groessteId = Math.max(...result.candidates.map((candidate) => candidate.fixtureId));
    expect(groessteId).toBeLessThanOrEqual(result.candidates.length);
  });

  it("beachtet eine eigene Obergrenze für die Wettanzahl", () => {
    const result = computeKellyCandidates(manyFixtures(100), "all", { ...base, minStake: 1, maxBets: 8 }, null);
    expect(result.candidates).toHaveLength(8);
  });

  it("stellt bei abgeschaltetem Mindesteinsatz das frühere Verhalten her", () => {
    const result = computeKellyCandidates(manyFixtures(100), "all", { ...base, minStake: 0 }, null);
    expect(result.candidates.length).toBeGreaterThan(25);
    expect(result.scaleFactor).toBeLessThan(1);
    expect(result.candidates.some((candidate) => candidate.stake < 1)).toBe(true);
  });

  it("lässt kleine Auswahlen unangetastet, wenn der Rahmen reicht", () => {
    const result = computeKellyCandidates(manyFixtures(3), "all", { ...base, minStake: 1 }, null);
    expect(result.candidates).toHaveLength(3);
    expect(result.filtered.belowMinStake).toBe(0);
  });
});

describe("Wettanzahl steuert auch die Einsatzhöhe", () => {
  function manyFixtures(count: number): DashboardFixture[] {
    return Array.from({ length: count }, (_unused, index) => ({
      fixtureId: index + 1, kickoff: "2026-09-10T18:00:00+02:00",
      country: "Deutschland", league: "Bundesliga",
      homeTeam: `H${index}`, awayTeam: `A${index}`, crossLeague: false,
      markets: [{
        key: "over25", label: "Über 2,5", selection: "Mindestens 3 Tore", pick: null, selectionTone: "neutral",
        probability: 0.62 - index * 0.002, odds: 2.0, confidence: 90, score: null,
        recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
      }]
    } as unknown as DashboardFixture));
  }

  const base = {
    ...DEFAULT_KELLY_SETTINGS, minEdge: 0, maxEdge: null,
    budget: 100, maxExposurePercent: 0.25, maxStakePercent: 0.03, minStake: 1
  };

  it("liefert ohne Vorgabe so viele Wetten, wie der Höchsteinsatz zulässt", () => {
    // 25 Euro Rahmen bei höchstens 3 Euro je Wette: acht Stück.
    const result = computeKellyCandidates(manyFixtures(60), "all", base, null);
    expect(result.candidates).toHaveLength(8);
    expect(result.candidates.every((candidate) => candidate.stake === 3)).toBe(true);
  });

  it("verteilt den Rahmen auf die gewünschte Anzahl, statt sie zu ignorieren", () => {
    const result = computeKellyCandidates(manyFixtures(60), "all", { ...base, maxBets: 20 }, null);
    expect(result.candidates).toHaveLength(20);
    // 25 Euro auf 20 Wetten: höchstens 1,25 Euro je Stück.
    expect(Math.max(...result.candidates.map((candidate) => candidate.stake))).toBeCloseTo(1.25);
    const summe = result.candidates.reduce((total, candidate) => total + candidate.stake, 0);
    expect(summe).toBeLessThanOrEqual(25.000001);
  });

  it("erzwingt keine Wetten, für die es keine Kandidaten gibt", () => {
    const result = computeKellyCandidates(manyFixtures(5), "all", { ...base, maxBets: 20 }, null);
    expect(result.candidates).toHaveLength(5);
  });

  it("überschreitet den Mindesteinsatz nicht nach unten, auch bei hoher Wunschzahl", () => {
    // 25 Euro auf 50 Wetten wären 50 Cent - darunter greift der Mindesteinsatz, und es
    // passen entsprechend weniger Wetten in den Rahmen.
    const result = computeKellyCandidates(manyFixtures(60), "all", { ...base, maxBets: 50 }, null);
    expect(result.candidates.every((candidate) => candidate.stake >= 1)).toBe(true);
    expect(result.candidates).toHaveLength(25);
  });
});
