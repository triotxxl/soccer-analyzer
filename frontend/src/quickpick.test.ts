import { describe, expect, it } from "vitest";
import { venueFormStats } from "../../src/venue-form.ts";
import {
  DEFAULT_QUICKPICK_SETTINGS,
  QUICKPICK_LEVELS,
  applyLevel,
  applyQuickpick,
  evaluateFixture,
  levelOf,
  h2hDominance,
  h2hStreak,
  loadQuickpickSettings,
  superiorityOf,
  venueFormPercent,
  type QuickpickSettings
} from "./quickpick";
import type { DashboardFixture, FormResult } from "./types";

function settings(overrides: Partial<QuickpickSettings> = {}): QuickpickSettings {
  return { ...DEFAULT_QUICKPICK_SETTINGS, ...overrides };
}

/** Eine Tabelle, in der Alpha klar vor Beta liegt: 2,5 gegen 1,0 Punkte je Spiel. */
function table(): NonNullable<DashboardFixture["table"]> {
  return [
    { position: 1, teamName: "Alpha", played: 10, wins: 8, draws: 1, losses: 1, points: 25, goalsFor: 25, goalsAgainst: 8 },
    { position: 8, teamName: "Beta", played: 10, wins: 3, draws: 1, losses: 6, points: 10, goalsFor: 10, goalsAgainst: 18 }
  ];
}

/**
 * Eine Partie, die alle Tore passiert: Alpha ist 7 Plätze voraus, hat 80 % Heimform gegen
 * 7 % Auswärtsform, 70 Favoritenpunkte, Quote 1,75 und führt die direkten Duelle 2:1.
 * Jeder Test verstellt daran genau eine Sache.
 */
function fixture(overrides: Partial<DashboardFixture> = {}): DashboardFixture {
  return {
    fixtureId: 1, kickoff: "2026-09-20T18:00:00.000Z", country: "Land", league: "Liga",
    homeTeam: "Alpha", awayTeam: "Beta", modelVersion: "test", crossLeague: false,
    dataConfidence: 85, warnings: [], h2hNotice: null,
    form: {
      scope: "venue",
      home: ["win", "win", "win", "win", "loss"],
      away: ["loss", "loss", "loss", "draw", "loss"],
      homeMatches: [], awayMatches: []
    },
    h2h: { outcomes: ["win", "win", "loss"], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    table: table(),
    expectedGoals: { home: 1.8, away: 0.9, total: 2.7 },
    scores: { favorite: 70, draw: 20 },
    markets: [{
      key: "1x2", label: "1X2", selection: "Alpha", pick: "1", selectionTone: "home",
      probability: 0.62, odds: 1.75, confidence: 82, score: 70,
      recommendation: { level: "recommended", label: "Empfehlenswert" }, details: []
    }],
    ...overrides
  };
}

/** Der 1X2-Markt der Vorlage mit gezielt geänderten Feldern. */
function market(overrides: Partial<DashboardFixture["markets"][number]>): DashboardFixture["markets"] {
  return [{ ...fixture().markets[0]!, ...overrides }];
}

function h2h(outcomes: FormResult[]): DashboardFixture["h2h"] {
  return { outcomes, btts: [], draws: 0, consecutiveDraws: 0, matches: [] };
}

describe("venueFormPercent", () => {
  it("rechnet Sieg 3, Remis 1, Niederlage 0 auf die erreichbaren Punkte", () => {
    expect(venueFormPercent(["win", "win", "win", "draw", "loss"])).toBeCloseTo(66.67, 2);
    expect(venueFormPercent(["win", "win", "win", "win", "win"])).toBe(100);
    expect(venueFormPercent(["loss", "loss"])).toBe(0);
  });

  it("liefert ohne Spiele 0 statt einer Division durch null", () => {
    expect(venueFormPercent([])).toBe(0);
  });

  /**
   * Wächter gegen zwei auseinanderlaufende Formeln: `venueFormStats` in src/venue-form.ts
   * ist die Vorlage, hier zählt allein die kleinere Stichprobe.
   */
  it("stimmt mit venueFormStats aus dem Backend überein", () => {
    const results: FormResult[] = ["win", "draw", "loss", "win", "draw"];
    const matches = results.map((result, index) => ({
      fixture: { id: index, timestamp: 1_000 + index, status: { short: "FT" } },
      league: { name: "Liga" },
      teams: { home: { id: 7 }, away: { id: 8 } },
      goals: { home: result === "win" ? 2 : result === "draw" ? 1 : 0, away: 1 },
      score: { halftime: { home: 0, away: 0 } }
    })) as unknown as Parameters<typeof venueFormStats>[0];

    const backend = venueFormStats(matches, 7, "home", 2_000);
    expect(backend.matches).toBe(results.length);
    expect(venueFormPercent(results)).toBeCloseTo(backend.percentage, 10);
  });
});

describe("h2hStreak", () => {
  /**
   * Der eigentliche Wächter dieser Datei: `outcomes[0]` ist das JÜNGSTE Duell, weil
   * `h2hSummary` in src/draw-criteria.ts absteigend nach Zeitstempel sortiert. Dreht sich
   * die Reihenfolge, misst die Serie das Gegenteil, ohne dass sonst etwas auffiele.
   */
  it("zählt vom jüngsten Duell aus", () => {
    expect(h2hStreak(["win", "win", "loss"])).toBe(2);
    expect(h2hStreak(["loss", "loss", "loss"])).toBe(-3);
  });

  it("bricht bei einem Remis an der Spitze ab", () => {
    expect(h2hStreak(["draw", "win", "win"])).toBe(0);
  });

  it("liefert ohne Duelle 0", () => {
    expect(h2hStreak([])).toBe(0);
  });
});

describe("h2hDominance", () => {
  it("misst eine Rate statt einer Rohzahl", () => {
    expect(h2hDominance(["win", "win", "win"], "1")?.rate).toBe(1);
    expect(h2hDominance(["win", "win", "win", "loss", "loss"], "1")?.rate).toBeCloseTo(0.2, 10);
  });

  /** Die Ergebnisse stehen aus Heimsicht - für einen Auswärtstipp müssen sie kippen. */
  it("spiegelt die Ergebnisse für einen Auswärtstipp", () => {
    const home = h2hDominance(["win", "win", "loss"], "1")!;
    const away = h2hDominance(["win", "win", "loss"], "2")!;
    expect(home.wins).toBe(2);
    expect(away.wins).toBe(1);
    expect(away.losses).toBe(2);
    expect(away.rate).toBeCloseTo(-home.rate, 10);
  });

  it("trennt die Serie für und gegen die getippte Seite", () => {
    expect(h2hDominance(["win", "win", "loss"], "1")).toMatchObject({ streakFor: 2, streakAgainst: 0 });
    expect(h2hDominance(["win", "win", "loss"], "2")).toMatchObject({ streakFor: 0, streakAgainst: 2 });
  });

  it("nennt ohne Duelle keine Grundlage statt einer Null", () => {
    expect(h2hDominance([], "1")).toBeNull();
  });
});

describe("superiorityOf", () => {
  it("rechnet Vorsprung je Spiel statt Rohsummen", () => {
    const value = superiorityOf(fixture(), "1")!;
    expect(value.pointsPerGame).toBeCloseTo(1.5, 10);
    expect(value.goalDifference).toBeCloseTo(2.5, 10);
    expect(value.positionGap).toBe(7);
  });

  it("dreht das Vorzeichen für die Auswärtsseite", () => {
    const value = superiorityOf(fixture(), "2")!;
    expect(value.pointsPerGame).toBeCloseTo(-1.5, 10);
    expect(value.positionGap).toBe(-7);
  });

  /** Ohne Tabelle ist Überlegenheit nicht prüfbar - das ist etwas anderes als "kein Vorsprung". */
  it("liefert null ohne Tabelle und bei einem fehlgeschlagenen Namensabgleich", () => {
    expect(superiorityOf(fixture({ table: undefined }), "1")).toBeNull();
    expect(superiorityOf(fixture({ homeTeam: "Alpha FC" }), "1")).toBeNull();
  });
});

describe("evaluateFixture", () => {
  it("nimmt eine klar überlegene Mannschaft an", () => {
    const evaluation = evaluateFixture(fixture(), settings());
    expect(evaluation.passes).toBe(true);
    expect(evaluation.side).toBe("1");
    expect(evaluation.rejectedBy).toBeNull();
  });

  it("lehnt eine Partie ohne 1X2-Tipp ab", () => {
    expect(evaluateFixture(fixture({ markets: market({ pick: null }) }), settings()).rejectedBy)
      .toBe("keinTipp");
  });

  /**
   * Der Grenzfall, an dem die frühere Fassung scheiterte: Mit 0 und 100 wollte der Benutzer
   * das Formtor abschalten und bekam null Treffer, weil "keine Seite eindeutig stärker" galt.
   */
  it("lässt sich mit 0 und 100 sauber abschalten", () => {
    const flat = fixture({
      form: {
        scope: "venue",
        home: ["draw", "draw", "draw", "draw", "draw"],
        away: ["draw", "draw", "draw", "draw", "draw"],
        homeMatches: [], awayMatches: []
      }
    });
    expect(evaluateFixture(flat, settings()).rejectedBy).toBe("venueForm");
    expect(evaluateFixture(flat, settings({ strongMinimum: 0, weakMaximum: 100 })).passes).toBe(true);
  });

  it("lehnt ab, wenn keine Seite klar stärker in Form ist", () => {
    const balanced = fixture({
      form: {
        scope: "venue",
        home: ["win", "win", "win", "win", "loss"],
        away: ["win", "win", "win", "win", "loss"],
        homeMatches: [], awayMatches: []
      }
    });
    expect(evaluateFixture(balanced, settings()).rejectedBy).toBe("venueForm");
  });

  /**
   * Gestützt wird nur die Modellseite. Für die Gegenseite führt der Lauf weder Quote noch
   * Wahrscheinlichkeit - gemessen lagen solche Zeilen bei 29,5 % Treffern.
   */
  it("lehnt ab, wenn Form und Modelltipp verschiedene Seiten meinen", () => {
    expect(evaluateFixture(fixture({ markets: market({ pick: "2" }) }), settings()).rejectedBy)
      .toBe("seitenkonflikt");
  });

  it("lehnt eine fehlende oder zu kurze Quote ab", () => {
    expect(evaluateFixture(fixture({ markets: market({ odds: null }) }), settings()).rejectedBy)
      .toBe("quote");
    expect(evaluateFixture(fixture({ markets: market({ odds: 1.25 }) }), settings()).rejectedBy)
      .toBe("quote");
  });

  it("lehnt zu wenige Favoritenpunkte ab", () => {
    expect(evaluateFixture(fixture({ scores: { favorite: 65, draw: 20 } }), settings()).rejectedBy)
      .toBe("punkte");
  });
});

describe("Veto aus den direkten Duellen", () => {
  /**
   * Der Fall, an dem der erste Entwurf gescheitert ist: Inter gegen FAS am 16.09.2026 hatte
   * 87 % gegen 40 % Form - und die letzten drei Duelle gingen an den Gegner.
   */
  it("lehnt ab, wenn die Gegenseite die Duelle gewinnt", () => {
    expect(evaluateFixture(fixture({ h2h: h2h(["loss", "loss", "win"]) }), settings()).rejectedBy)
      .toBe("h2hDagegen");
  });

  it("lehnt eine Niederlagenserie ab, auch wenn die Bilanz insgesamt passt", () => {
    const evaluation = evaluateFixture(fixture({ h2h: h2h(["loss", "loss", "win", "win", "win"]) }), settings());
    expect(evaluation.dominance).toMatchObject({ wins: 3, losses: 2, streakAgainst: 2 });
    expect(evaluation.rejectedBy).toBe("h2hDagegen");
  });

  it("lässt eine Partie ohne jedes Duell zu, statt sie zu bestrafen", () => {
    expect(evaluateFixture(fixture({ h2h: h2h([]) }), settings()).passes).toBe(true);
  });

  it("verlangt die Siegesserie nur, wenn sie eingeschaltet ist", () => {
    const single = fixture({ h2h: h2h(["win", "loss"]) });
    expect(evaluateFixture(single, settings()).passes).toBe(true);
    expect(evaluateFixture(single, settings({ requireStreak: true })).rejectedBy).toBe("serie");
    expect(evaluateFixture(fixture(), settings({ requireStreak: true })).passes).toBe(true);
  });
});

describe("Tabellenvorsprung", () => {
  it("lehnt zwei gleich starke Mannschaften ab", () => {
    // Inter gegen FAS: 2,00 zu 2,00 Punkte je Spiel, Tordifferenz +8 zu +7.
    const level = fixture({
      table: [
        { position: 2, teamName: "Alpha", played: 9, wins: 5, draws: 3, losses: 1, points: 18, goalsFor: 14, goalsAgainst: 6 },
        { position: 4, teamName: "Beta", played: 8, wins: 5, draws: 1, losses: 2, points: 16, goalsFor: 14, goalsAgainst: 7 }
      ]
    });
    expect(evaluateFixture(level, settings()).rejectedBy).toBe("tabelle");
  });

  it("lehnt einen zu kleinen Abstand in der Tabelle ab", () => {
    const close = fixture({
      table: [
        { position: 1, teamName: "Alpha", played: 10, wins: 8, draws: 1, losses: 1, points: 25, goalsFor: 25, goalsAgainst: 8 },
        { position: 3, teamName: "Beta", played: 10, wins: 3, draws: 1, losses: 6, points: 10, goalsFor: 10, goalsAgainst: 18 }
      ]
    });
    // Zwei Plätze Abstand: Auf der Vorgabe genügt das, auf der strengen Stufe nicht.
    expect(evaluateFixture(close, settings()).passes).toBe(true);
    expect(evaluateFixture(close, settings({ minPositionGap: 3 })).rejectedBy).toBe("tabelle");
  });

  /**
   * Ohne Tabelle fehlt die Grundlage für "klar überlegen". Das trifft jede
   * Cross-League-Partie, denn der Lauf führt dort nie eine.
   */
  it("lehnt eine Partie ohne Tabelle ab", () => {
    expect(evaluateFixture(fixture({ table: undefined }), settings()).rejectedBy).toBe("keineTabelle");
    expect(evaluateFixture(fixture({ table: undefined, crossLeague: true }), settings()).rejectedBy)
      .toBe("keineTabelle");
  });
});

describe("applyQuickpick", () => {
  it("zählt jede Partie genau einmal - als Treffer oder mit genau einem Grund", () => {
    const fixtures = [
      fixture({ fixtureId: 1 }),
      fixture({ fixtureId: 2, markets: market({ odds: 1.1 }) }),
      fixture({ fixtureId: 3, scores: { favorite: 30, draw: 10 } }),
      fixture({ fixtureId: 4, table: undefined })
    ];
    const { passing, report } = applyQuickpick(fixtures, settings());

    expect(passing).toEqual(new Set([1]));
    expect(report.evaluated).toBe(4);
    expect(report.passed).toBe(1);
    const rejected = Object.values(report.rejected).reduce((sum, count) => sum + count, 0);
    expect(report.passed + rejected).toBe(report.evaluated);
    expect(report.rejected.quote).toBe(1);
    expect(report.rejected.punkte).toBe(1);
    expect(report.rejected.keineTabelle).toBe(1);
  });

  it("liefert für eine leere Liste ein leeres Ergebnis", () => {
    const { passing, report } = applyQuickpick([], settings());
    expect(passing.size).toBe(0);
    expect(report.evaluated).toBe(0);
  });
});

describe("Strengestufen", () => {
  it("erkennt die eingestellte Stufe und meldet eigene Werte als solche", () => {
    expect(levelOf(DEFAULT_QUICKPICK_SETTINGS)).toBe("ausgewogen");
    expect(levelOf(applyLevel(DEFAULT_QUICKPICK_SETTINGS, "streng"))).toBe("streng");
    expect(levelOf(settings({ strongMinimum: 63 }))).toBeNull();
  });

  /** Quote und Serie gehören keiner Stufe - wer daran dreht, bleibt auf seiner Stufe. */
  it("lässt Quote und Serie unangetastet", () => {
    const eigen = settings({ minOdds: 1.8, requireStreak: true });
    const streng = applyLevel(eigen, "streng");
    expect(streng.minOdds).toBe(1.8);
    expect(streng.requireStreak).toBe(true);
    expect(levelOf(streng)).toBe("streng");
  });

  it("wird von streng nach weit durchgehend durchlässiger", () => {
    const fixtures = [
      fixture({ fixtureId: 1 }),
      // Nur knapp voraus und in mäßiger Form: fällt streng, passiert locker.
      fixture({
        fixtureId: 2,
        form: {
          scope: "venue",
          home: ["win", "win", "draw", "draw", "loss"],
          away: ["win", "loss", "loss", "draw", "loss"],
          homeMatches: [], awayMatches: []
        },
        table: [
          { position: 3, teamName: "Alpha", played: 10, wins: 6, draws: 2, losses: 2, points: 20, goalsFor: 18, goalsAgainst: 12 },
          { position: 5, teamName: "Beta", played: 10, wins: 5, draws: 2, losses: 3, points: 17, goalsFor: 15, goalsAgainst: 13 }
        ]
      })
    ];
    const counts = QUICKPICK_LEVELS.map((level) =>
      applyQuickpick(fixtures, applyLevel(DEFAULT_QUICKPICK_SETTINGS, level.id)).report.passed);
    expect(counts).toEqual([...counts].sort((left, right) => left - right));
    expect(counts.at(-1)!).toBeGreaterThan(counts[0]!);
  });

  it("senkt die Favoritenpunkte nur auf der weitesten Stufe", () => {
    const points = QUICKPICK_LEVELS.map((level) => level.values.minPoints);
    expect(points.slice(0, 3)).toEqual([70, 70, 70]);
    expect(points.at(-1)).toBe(65);
  });
});

describe("loadQuickpickSettings", () => {
  it("erbt bei einem Teilobjekt aus einer älteren Fassung die Vorgaben", () => {
    window.localStorage.setItem("football-analyzer:quickpick-settings", JSON.stringify({ minOdds: 1.8 }));
    const loaded = loadQuickpickSettings();
    expect(loaded.minOdds).toBe(1.8);
    expect(loaded.strongMinimum).toBe(DEFAULT_QUICKPICK_SETTINGS.strongMinimum);
    expect(loaded.minPointsPerGame).toBe(DEFAULT_QUICKPICK_SETTINGS.minPointsPerGame);
    window.localStorage.clear();
  });

  it("fällt bei unbrauchbarem Inhalt auf die Vorgaben zurück", () => {
    window.localStorage.setItem("football-analyzer:quickpick-settings", "kein json");
    expect(loadQuickpickSettings()).toEqual(DEFAULT_QUICKPICK_SETTINGS);
    window.localStorage.clear();
  });
});
