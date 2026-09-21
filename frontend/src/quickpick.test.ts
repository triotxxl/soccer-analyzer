import { describe, expect, it } from "vitest";
import { venueFormStats } from "../../src/venue-form.ts";
import {
  DEFAULT_QUICKPICK_SETTINGS,
  QUICKPICK_LEVELS,
  applyLevel,
  applyQuickpick,
  evaluateFixture,
  levelOf,
  loadQuickpickStore,
  saveQuickpickStore,
  settingsOf,
  withSettings,
  DEFAULT_DOMINANZ_SETTINGS,
  h2hDominance,
  h2hStreak,
  loadQuickpickSettings,
  superiorityOf,
  venueFormPercent,
  counterOddsOf,
  DOMINANZ_LEVELS,
  QUICKPICK_PRESETS,
  DEFAULT_HZ15_SETTINGS,
  DEFAULT_REMIS_SETTINGS,
  HZ15_LEVELS,
  REMIS_LEVELS,
  firstHalfRateOf,
  type DavesQuickpickSettings,
  type DominanzQuickpickSettings
} from "./quickpick";
import { cartEntryId, toCartEntry } from "./betCart";
import type { DashboardFixture, FormResult } from "./types";

function settings(overrides: Partial<DavesQuickpickSettings> = {}): DavesQuickpickSettings {
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

  /**
   * Die Zahl der Spiele gehört mitgeliefert: Der Filter lässt einen Vorsprung nach vier
   * Spieltagen durch wie einen nach dreißig, und die Spalte soll das wenigstens zeigen.
   */
  it("nennt, auf wie vielen Spielen der Vorsprung beruht", () => {
    expect(superiorityOf(fixture(), "1")).toMatchObject({ played: 10, opponentPlayed: 10 });
    expect(superiorityOf(fixture(), "2")).toMatchObject({ played: 10, opponentPlayed: 10 });
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
   * Der Fehler, um den es hier geht: `venueFormPercent` gibt für eine leere Liste 0 zurück,
   * damit nicht durch null geteilt wird. Im Tor las sich dieses 0 als "der Gegner ist in
   * miserabler Form" - eine fehlende Grundlage wurde so zum stärksten Argument. Dasselbe in
   * klein bei ein oder zwei Spielen, wo ein Sieg 100 % ergibt.
   */
  it("liest eine fehlende Formliste nicht als schwache Form", () => {
    const ohneForm = fixture({
      form: { scope: "venue", home: ["win", "win", "win", "win", "loss"], away: [], homeMatches: [], awayMatches: [] }
    });
    expect(evaluateFixture(ohneForm, settings()).rejectedBy).toBe("formFehlt");
  });

  it("lehnt auch eine Stichprobe unter drei Spielen ab", () => {
    const duenn = fixture({
      form: { scope: "venue", home: ["win", "win"], away: ["loss", "loss"], homeMatches: [], awayMatches: [] }
    });
    expect(evaluateFixture(duenn, settings()).rejectedBy).toBe("formFehlt");
  });

  it("prüft die Stichprobe nur, solange das Formtor eingeschaltet ist", () => {
    const ohneForm = fixture({
      form: { scope: "venue", home: ["win", "win", "win", "win", "loss"], away: [], homeMatches: [], awayMatches: [] }
    });
    expect(evaluateFixture(ohneForm, settings({ strongMinimum: 0, weakMaximum: 100 })).passes).toBe(true);
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

  /**
   * Ein einziges verlorenes Duell erfüllt `losses > wins` immer - das ist kein Rückstand in
   * einer Serie, sondern ein Spiel, und weil `h2hSummary` Freundschaftsspiele mitzählt, kann
   * es sogar ein Testspiel sein. Ab zwei Duellen greift das Veto unverändert.
   */
  it("kippt eine Partie nicht wegen eines einzigen verlorenen Duells", () => {
    const evaluation = evaluateFixture(fixture({ h2h: h2h(["loss"]) }), settings());
    expect(evaluation.dominance).toMatchObject({ wins: 0, losses: 1, sample: 1 });
    expect(evaluation.passes).toBe(true);
  });

  it("lehnt ab, sobald zwei Duelle vorliegen", () => {
    expect(evaluateFixture(fixture({ h2h: h2h(["loss", "loss"]) }), settings()).rejectedBy)
      .toBe("h2hDagegen");
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

describe("Speicherung je Voreinstellung", () => {
  /**
   * Der Altbestand ist ein flaches Objekt aus der Zeit mit nur einer Voreinstellung. Er
   * beschreibt Daves Regler und muss dorthin wandern, statt verworfen zu werden.
   */
  it("migriert einen flachen Altbestand in den Daves-Zweig", () => {
    window.localStorage.setItem("football-analyzer:quickpick-settings", JSON.stringify({ minOdds: 1.8 }));
    const store = loadQuickpickStore();
    expect(store.aktiv).toBe("daves1x2");
    expect(store.daves1x2.minOdds).toBe(1.8);
    expect(store.daves1x2.strongMinimum).toBe(DEFAULT_QUICKPICK_SETTINGS.strongMinimum);
    expect(store.dominanz).toEqual(DEFAULT_DOMINANZ_SETTINGS);
    window.localStorage.clear();
  });

  it("erbt bei einem Teilzweig die Vorgaben", () => {
    window.localStorage.setItem("football-analyzer:quickpick-settings",
      JSON.stringify({ aktiv: "dominanz", dominanz: { maxOdds: 6 } }));
    const store = loadQuickpickStore();
    expect(store.aktiv).toBe("dominanz");
    expect(store.dominanz.maxOdds).toBe(6);
    expect(store.dominanz.minOdds).toBe(DEFAULT_DOMINANZ_SETTINGS.minOdds);
    window.localStorage.clear();
  });

  /** Eine unbekannte Kennung darf nur die Auswahl zurücksetzen, nicht die Regler. */
  it("verwirft bei unbekannter Voreinstellung nur die Auswahl", () => {
    window.localStorage.setItem("football-analyzer:quickpick-settings",
      JSON.stringify({ aktiv: "gibtesnicht", daves1x2: { minOdds: 2.2 }, dominanz: {} }));
    const store = loadQuickpickStore();
    expect(store.aktiv).toBe("daves1x2");
    expect(store.daves1x2.minOdds).toBe(2.2);
    window.localStorage.clear();
  });

  it("fällt bei unbrauchbarem Inhalt auf die Vorgaben zurück", () => {
    window.localStorage.setItem("football-analyzer:quickpick-settings", "kein json");
    expect(loadQuickpickSettings()).toEqual(DEFAULT_QUICKPICK_SETTINGS);
    window.localStorage.clear();
  });

  /** Der Kern der Trennung: Ein Wechsel darf die Regler der anderen nicht anfassen. */
  it("lässt beim Schreiben den anderen Zweig unberührt", () => {
    const store = withSettings(loadQuickpickStore(), settings({ minOdds: 1.9 }));
    saveQuickpickStore({ ...store, aktiv: "dominanz" });
    const wieder = loadQuickpickStore();
    expect(wieder.daves1x2.minOdds).toBe(1.9);
    expect(settingsOf(wieder).preset).toBe("dominanz");
    window.localStorage.clear();
  });
});

describe("Gegenquote", () => {
  /** Ab schemaVersion 5 stehen beide Preise im Lauf - dann wird nicht gerechnet. */
  it("nimmt den gespeicherten Preis, wenn er vorliegt", () => {
    const withBoth = fixture({ markets: market({ pick: "1", odds: 1.5, oddsHome: 1.5, oddsAway: 6 }) });
    expect(counterOddsOf(withBoth, withBoth.markets[0])).toEqual({ odds: 6, source: "snapshot" });
  });

  /**
   * Ältere Läufe führen nur die getippte Seite. Der Rest wird über den Buchmacherschnitt
   * gerechnet - die Seite stimmt dann zu 97,6 %, der Preis liegt im Median 7,1 % daneben.
   */
  it("rechnet sie aus Tipp- und Remisquote, wenn sie fehlt", () => {
    const withDraw = fixture({
      markets: [
        { ...fixture().markets[0]!, pick: "1", odds: 1.5 },
        { ...fixture().markets[0]!, key: "draw", pick: null, odds: 4 }
      ]
    });
    const counter = counterOddsOf(withDraw, withDraw.markets[0]);
    expect(counter?.source).toBe("geschätzt");
    // 1 / (1,1068 - 1/1,5 - 1/4) = rund 5,2
    expect(counter!.odds).toBeCloseTo(1 / (1.1068 - 1 / 1.5 - 1 / 4), 6);
  });

  it("liefert null, wenn die Remisquote fehlt", () => {
    const withoutDraw = fixture({ markets: market({ pick: "1", odds: 1.5 }) });
    expect(counterOddsOf(withoutDraw, withoutDraw.markets[0])).toBeNull();
  });

  /** Ein Rest nahe null hieße eine astronomische Quote - dann wird nicht geraten. */
  it("liefert null, wenn der Buchmacherschnitt für diese Partie nicht aufgeht", () => {
    const impossible = fixture({
      markets: [
        { ...fixture().markets[0]!, pick: "1", odds: 1.05 },
        { ...fixture().markets[0]!, key: "draw", pick: null, odds: 1.05 }
      ]
    });
    expect(counterOddsOf(impossible, impossible.markets[0])).toBeNull();
  });
});

describe("Dominanz", () => {
  function dom(overrides: Partial<DominanzQuickpickSettings> = {}): DominanzQuickpickSettings {
    return { ...DEFAULT_DOMINANZ_SETTINGS, ...overrides };
  }

  /**
   * Nacional Potosí – Always Ready, 17.09.2026: eines der beiden Beispiele, an denen sich
   * diese Voreinstellung messen lassen muss. Always Ready gewann alle fünf Duelle, steht 2.
   * gegen 7., hat 94,7 % gegen 57,9 % Spiele ohne Niederlage - und wird mit 2,00 bezahlt.
   */
  function alwaysReady(overrides: Partial<DashboardFixture> = {}): DashboardFixture {
    const base = fixture();
    return {
      ...base,
      homeTeam: "Nacional Potosí", awayTeam: "Always Ready",
      form: {
        scope: "venue",
        home: ["win", "win", "win", "win", "loss"],
        away: ["loss", "win", "win", "draw", "win"],
        homeMatches: [], awayMatches: []
      },
      // Aus Heimsicht fünf Niederlagen - also fünf Siege in Folge für Always Ready.
      h2h: h2h(["loss", "loss", "loss", "loss", "loss"]),
      table: [
        { position: 7, teamName: "Nacional Potosí", played: 19, wins: 8, draws: 3, losses: 8, points: 27, goalsFor: 30, goalsAgainst: 24 },
        { position: 2, teamName: "Always Ready", played: 19, wins: 12, draws: 6, losses: 1, points: 42, goalsFor: 43, goalsAgainst: 13 }
      ],
      scores: { favorite: 44, draw: 29 },
      markets: [
        { ...base.markets[0]!, pick: "2", odds: 2, oddsHome: 2.85, oddsAway: 2, probability: 0.494 },
        { ...base.markets[0]!, key: "draw", pick: null, odds: 3.5, probability: 0.26 }
      ],
      ...overrides
    };
  }

  it("findet das Beispiel Always Ready", () => {
    const evaluation = evaluateFixture(alwaysReady(), dom());
    expect(evaluation.passes).toBe(true);
    expect(evaluation.side).toBe("2");
    expect(evaluation.odds).toBe(2);
    expect(evaluation.dominanz?.streak).toBe(5);
    expect(evaluation.dominanz?.modelAgrees).toBe(true);
  });

  /**
   * Der Regressionstest, der den ganzen Umbau begründet: Dieselbe Partie mit einer schlechten
   * Venue-Form der gestützten Seite passiert weiterhin. Die „Form" kommt aus der Saisonbilanz
   * der Tabelle, nicht aus den letzten fünf Spielen am Ort - genau daran scheiterten beide
   * Beispiele in der Vorgängerversion.
   */
  it("hält an der Saisonbilanz fest, auch wenn die Venue-Form dagegen spricht", () => {
    const schwacheForm = alwaysReady({
      form: {
        scope: "venue",
        home: ["win", "win", "win", "win", "win"],
        away: ["loss", "loss", "loss", "loss", "loss"],
        homeMatches: [], awayMatches: []
      }
    });
    expect(evaluateFixture(schwacheForm, dom()).passes).toBe(true);
  });

  /** Das zweite Beispiel: Tolima ist nicht der Modelltipp und trägt deshalb das Abzeichen. */
  it("zeigt eine Partie gegen den Modelltipp mit Abzeichen", () => {
    const base = fixture();
    const tolima: DashboardFixture = {
      ...base,
      homeTeam: "Once Caldas", awayTeam: "Deportes Tolima",
      form: {
        scope: "venue",
        home: ["loss", "win", "loss", "win", "win"],
        away: ["loss", "win", "loss", "win", "loss"],
        homeMatches: [], awayMatches: []
      },
      h2h: h2h(["loss", "loss", "loss", "loss", "draw"]),
      table: [
        { position: 12, teamName: "Once Caldas", played: 8, wins: 2, draws: 3, losses: 3, points: 9, goalsFor: 12, goalsAgainst: 11 },
        { position: 3, teamName: "Deportes Tolima", played: 8, wins: 5, draws: 1, losses: 2, points: 16, goalsFor: 12, goalsAgainst: 9 }
      ],
      scores: { favorite: 3, draw: 38 },
      markets: [
        { ...base.markets[0]!, pick: "1", odds: 2, oddsHome: 2, oddsAway: 3.4, probability: 0.401 },
        { ...base.markets[0]!, key: "draw", pick: null, odds: 3.2, probability: 0.28 }
      ]
    };
    const evaluation = evaluateFixture(tolima, dom());
    expect(evaluation.passes).toBe(true);
    expect(evaluation.side).toBe("2");
    expect(evaluation.odds).toBe(3.4);
    expect(evaluation.dominanz?.modelAgrees).toBe(false);
    // Auf der strengen Stufe fällt diese Klasse weg - dort greift schon der Quotendeckel bei
    // 2,50, und darunter stünde ohnehin das Modellseiten-Tor.
    expect(evaluateFixture(tolima, applyLevel(DEFAULT_DOMINANZ_SETTINGS, "streng")).passes).toBe(false);
    // Ohne den Deckel bleibt der Grund die Modellseite.
    expect(evaluateFixture(tolima, { ...applyLevel(DEFAULT_DOMINANZ_SETTINGS, "streng"), maxOdds: 99 }).rejectedBy)
      .toBe("modellDagegen");
  });

  it("lehnt eine Partie ohne 1X2-Tipp ab", () => {
    expect(evaluateFixture(alwaysReady({ markets: market({ pick: null }) }), dom()).rejectedBy)
      .toBe("keinTipp");
  });

  it("lehnt eine Partie ohne Tabelle ab", () => {
    expect(evaluateFixture(alwaysReady({ table: undefined }), dom()).rejectedBy).toBe("keineTabelle");
  });

  it("lehnt ab, wenn keine Seite den Tabellenvorsprung hat", () => {
    const eng = alwaysReady({
      table: [
        { position: 3, teamName: "Nacional Potosí", played: 19, wins: 10, draws: 4, losses: 5, points: 34, goalsFor: 30, goalsAgainst: 24 },
        { position: 2, teamName: "Always Ready", played: 19, wins: 11, draws: 3, losses: 5, points: 36, goalsFor: 43, goalsAgainst: 13 }
      ]
    });
    expect(evaluateFixture(eng, dom()).rejectedBy).toBe("tabelle");
  });

  /**
   * Die Bilanz muss je Spiel gerechnet werden: Bei ungleicher Spielzahl käme eine Rohzahl auf
   * das falsche Vorzeichen. Hier hat die gestützte Seite absolut mehr Siege+Remis, anteilig
   * aber weniger.
   */
  it("rechnet die Bilanz je Spiel, nicht als Rohzahl", () => {
    // Always Ready hat absolut mehr Spiele ohne Niederlage (14 gegen 9), anteilig aber
    // weniger (60 % gegen 90 %). Punkte je Spiel und Platz reichen trotzdem für den Kandidaten.
    const ungleich = alwaysReady({
      table: [
        { position: 7, teamName: "Nacional Potosí", played: 10, wins: 4, draws: 5, losses: 1, points: 17, goalsFor: 20, goalsAgainst: 18 },
        { position: 2, teamName: "Always Ready", played: 20, wins: 14, draws: 0, losses: 6, points: 42, goalsFor: 43, goalsAgainst: 13 }
      ]
    });
    const evaluation = evaluateFixture(ungleich, dom());
    // 14 von 20 sind 70 %, 9 von 10 sind 90 % - der Vorsprung ist negativ, obwohl die
    // Rohzahl (14 gegen 9) das Gegenteil nahelegt.
    expect(evaluation.superiority!.nonLossGap).toBeLessThan(0);
    expect(evaluation.rejectedBy).toBe("bilanz");
  });

  it("hält sich an das Quotenband", () => {
    const teuer = alwaysReady({
      markets: [
        { ...fixture().markets[0]!, pick: "2", odds: 5, oddsHome: 1.4, oddsAway: 5 },
        { ...fixture().markets[0]!, key: "draw", pick: null, odds: 4 }
      ]
    });
    expect(evaluateFixture(teuer, dom()).rejectedBy).toBe("quote");
    expect(evaluateFixture(alwaysReady(), dom({ minOdds: 2.5 })).rejectedBy).toBe("quote");
  });

  it("verlangt die Serie in den direkten Duellen", () => {
    expect(evaluateFixture(alwaysReady({ h2h: h2h(["loss", "win", "loss"]) }), dom()).rejectedBy)
      .toBe("serie");
    expect(evaluateFixture(alwaysReady({ h2h: h2h([]) }), dom()).rejectedBy).toBe("keineDuelle");
    // Auf der weitesten Stufe ist das Tor aus.
    expect(evaluateFixture(alwaysReady({ h2h: h2h([]) }), applyLevel(DEFAULT_DOMINANZ_SETTINGS, "weit")).passes)
      .toBe(true);
  });

  it("wird von streng nach weit durchlässiger", () => {
    const fixtures = [
      alwaysReady({ fixtureId: 1 }),
      alwaysReady({ fixtureId: 2, h2h: h2h(["loss", "win", "loss"]) })
    ];
    const counts = DOMINANZ_LEVELS.map((level) =>
      applyQuickpick(fixtures, applyLevel(DEFAULT_DOMINANZ_SETTINGS, level.id)).report.passed);
    expect(counts).toEqual([...counts].sort((left, right) => left - right));
  });

  it("beschriftet die Stufen mit dem Ertrag", () => {
    const streng = DOMINANZ_LEVELS.find((level) => level.id === "streng")!;
    expect(QUICKPICK_PRESETS.dominanz.noteOf(streng.measured)).toMatch(/Gewinn$|geprüft$/);
  });
});

/**
 * Die dritte Voreinstellung stützt **keine Seite**, sondern eine Torlinie. Das ist der
 * strukturelle Unterschied zu den beiden anderen, und die Tests halten ihn fest: `side`
 * bleibt null, `market` trägt den Halbzeitmarkt, und der Wettschein muss trotzdem einen
 * Eintrag bekommen.
 */
describe("Erste Halbzeit: zwei Tore", () => {
  /** Eine Partie mit Torumfeld: 3,4 erwartete Tore, Remis 20 %, HZ-Quote 1,85. */
  function torreich(overrides: Partial<DashboardFixture> = {}): DashboardFixture {
    return fixture({
      expectedGoals: { home: 1.9, away: 1.5, total: 3.4 },
      expectedFirstHalfGoals: { home: 0.8, away: 0.7, total: 1.5 },
      markets: [
        { ...fixture().markets[0]! },
        {
          key: "draw", label: "Remis", selection: "Unentschieden", pick: null, selectionTone: "draw",
          probability: 0.2, odds: 4.2, confidence: 80, score: null,
          recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
        },
        {
          key: "firstHalfOver15", label: "1. HZ Ü1,5", selection: "1. HZ Ü1,5", pick: null,
          selectionTone: "neutral", probability: 0.44, odds: 1.85, confidence: 80, score: null,
          recommendation: { level: "recommended", label: "Empfehlenswert" }, details: []
        }
      ],
      ...overrides
    });
  }

  /** Den Halbzeitmarkt gezielt verstellen, alles andere unverändert lassen. */
  function mitQuote(odds: number | null): DashboardFixture {
    const base = torreich();
    return { ...base, markets: base.markets.map((entry) =>
      entry.key === "firstHalfOver15" ? { ...entry, odds } : entry) };
  }

  it("lässt eine torreiche Partie zum Preis im Band durch", () => {
    const evaluation = evaluateFixture(torreich(), DEFAULT_HZ15_SETTINGS);
    expect(evaluation.passes).toBe(true);
    expect(evaluation.rejectedBy).toBe(null);
    expect(evaluation.hz15?.expectedGoals).toBe(3.4);
  });

  /**
   * Das Quotenband ist die **Identität** dieser Voreinstellung: Es trägt den größeren Teil
   * der Trefferquote (bis 2,00 traf die Auswahl in 50 % der Fälle, über alle Preise hinweg
   * nur in 38,9 %). Wer den Deckel entfernt, entfernt die Voreinstellung.
   */
  it("weist dieselbe Partie über dem Quotendeckel ab", () => {
    const evaluation = evaluateFixture(mitQuote(2.6), DEFAULT_HZ15_SETTINGS);
    expect(evaluation.passes).toBe(false);
    expect(evaluation.rejectedBy).toBe("quote");
  });

  it("weist ohne Preis und ohne Markt mit eigenen Gründen ab", () => {
    expect(evaluateFixture(mitQuote(null), DEFAULT_HZ15_SETTINGS).rejectedBy).toBe("keineQuote");
    const ohneMarkt = fixture({ expectedGoals: { home: 1.9, away: 1.5, total: 3.4 } });
    expect(evaluateFixture(ohneMarkt, DEFAULT_HZ15_SETTINGS).rejectedBy).toBe("keinMarkt");
  });

  it("weist zu wenig erwartete Tore und ein zu remisnahes Bild ab", () => {
    const arm = torreich({ expectedGoals: { home: 1.2, away: 1.0, total: 2.2 } });
    expect(evaluateFixture(arm, DEFAULT_HZ15_SETTINGS).rejectedBy).toBe("torerwartung");

    const base = torreich();
    const remisnah = { ...base, markets: base.markets.map((entry) =>
      entry.key === "draw" ? { ...entry, probability: 0.3 } : entry) };
    expect(evaluateFixture(remisnah, DEFAULT_HZ15_SETTINGS).rejectedBy).toBe("remisbild");
  });

  /**
   * Die Halbzeitbilanz trägt allein nur +3,9 Punkte und ist deshalb nur in der strengsten
   * Stufe ein Tor. Auf der Vorgabestufe darf eine fehlende Historie die Partie nicht kosten.
   */
  it("prüft die Halbzeitbilanz nur, wenn die Stufe sie verlangt", () => {
    const ohneHistorie = torreich();
    expect(evaluateFixture(ohneHistorie, DEFAULT_HZ15_SETTINGS).passes).toBe(true);

    const streng = applyLevel(DEFAULT_HZ15_SETTINGS, "streng");
    expect(evaluateFixture(ohneHistorie, streng).rejectedBy).toBe("hzHistorie");

    const torreicheHistorie = Array.from({ length: 5 }, (_, index) => ({
      date: `2026-09-0${index + 1}`, homeTeam: "Alpha", awayTeam: "Gamma",
      homeGoals: 3, awayGoals: 1, halfTimeHomeGoals: 2, halfTimeAwayGoals: 0
    }));
    const mitHistorie = torreich({
      form: { ...torreich().form, homeMatches: torreicheHistorie, awayMatches: torreicheHistorie }
    });
    // Quote 1,85 bleibt unter dem strengen Deckel von 1,95, und die Bilanz trägt jetzt.
    expect(evaluateFixture(mitHistorie, streng).passes).toBe(true);
    expect(evaluateFixture(mitHistorie, streng).hz15?.firstHalfRate).toBe(1);
  });

  it("stützt keine Seite und nennt stattdessen den Markt", () => {
    const evaluation = evaluateFixture(torreich(), DEFAULT_HZ15_SETTINGS);
    expect(evaluation.side).toBe(null);
    expect(evaluation.market).toBe("firstHalfOver15");
    expect(evaluation.selection).toBe("1. HZ Ü1,5");
  });

  /**
   * Der Wettschein darf eine Torlinie nicht als 1X2-Wette ablegen: `cartEntryId` ließe sonst
   * nur eine der beiden Wetten derselben Partie zu, und die zweite verdrängte die erste.
   */
  it("legt die Torlinie neben einer 1X2-Wette derselben Partie ab", () => {
    const partie = torreich();
    const hzMarkt = partie.markets.find((entry) => entry.key === "firstHalfOver15")!;
    const eintrag = toCartEntry(partie, hzMarkt);
    expect(eintrag.marketKey).toBe("firstHalfOver15");
    expect(eintrag.odds).toBe(1.85);
    expect(eintrag.id).not.toBe(cartEntryId(partie.fixtureId, "1x2"));
  });

  it("wird von streng nach weit durchlässiger", () => {
    const fixtures = [1.9, 2.05, 2.3].map((odds, index) =>
      ({ ...mitQuote(odds), fixtureId: index + 1 }));
    const counts = HZ15_LEVELS.map((level) =>
      applyQuickpick(fixtures, applyLevel(DEFAULT_HZ15_SETTINGS, level.id)).report.passed);
    expect(counts).toEqual([...counts].sort((left, right) => left - right));
  });

  it("beschriftet die Stufen mit der Trefferquote", () => {
    const vorgabe = HZ15_LEVELS.find((level) => level.id === "ausgewogen")!;
    expect(QUICKPICK_PRESETS.hz15.noteOf(vorgabe.measured)).toMatch(/Treffer$/);
    expect(QUICKPICK_PRESETS.hz15.massstab).toBe("trefferquote");
  });
});

describe("firstHalfRateOf", () => {
  const partie = (halbzeit: number | null) => ({
    date: "2026-09-01", homeTeam: "A", awayTeam: "B", homeGoals: 2, awayGoals: 1,
    halfTimeHomeGoals: halbzeit, halfTimeAwayGoals: halbzeit === null ? null : 0
  });

  it("zählt nur Partien mit überliefertem Pausenstand", () => {
    const gemischt = [partie(2), partie(2), partie(0), partie(0), partie(null)];
    const ergebnis = firstHalfRateOf(gemischt)!;
    expect(ergebnis.sample).toBe(4);
    expect(ergebnis.rate).toBe(0.5);
  });

  /** Unter vier Partien schwankte der Anteil zwischen 0 und 100 %, ohne etwas zu bedeuten. */
  it("liefert unter vier verwertbaren Partien nichts", () => {
    expect(firstHalfRateOf([partie(2), partie(2), partie(2)])).toBe(null);
  });

  /** Snapshots vor `form.homeMatches` führen die Liste gar nicht - das darf nicht werfen. */
  it("hält eine fehlende Historie aus", () => {
    expect(firstHalfRateOf(undefined)).toBe(null);
  });
});

/**
 * Die vierte Voreinstellung. Ihr Kern ist, dass sie **ein einziges Tor** hat: Alles, was
 * naheliegend dazugehören würde, senkt gemessen die Trefferquote. Die Tests halten genau
 * das fest, damit niemand später ein Tor „nachrüstet".
 */
describe("Remis-Kandidaten", () => {
  /** Eine Partie mit 32 % Remischance zu 2,90 – sie soll durchkommen. */
  function remisnah(overrides: Partial<DashboardFixture> = {}): DashboardFixture {
    return fixture({
      expectedGoals: { home: 1.1, away: 1.0, total: 2.1 },
      scores: { favorite: 40, draw: 55 },
      markets: [
        { ...fixture().markets[0]! },
        {
          key: "draw", label: "Remis", selection: "Unentschieden (X)", pick: null,
          selectionTone: "draw", probability: 0.32, odds: 2.9, confidence: 80, score: 55,
          recommendation: { level: "recommended", label: "Empfehlenswert" }, details: []
        }
      ],
      ...overrides
    });
  }

  /** Den Remismarkt gezielt verstellen, alles andere unverändert lassen. */
  function mitMarkt(patch: Partial<DashboardFixture["markets"][number]>): DashboardFixture {
    const base = remisnah();
    return { ...base, markets: base.markets.map((entry) =>
      entry.key === "draw" ? { ...entry, ...patch } : entry) };
  }

  it("lässt eine remisnahe Partie zum Preis im Band durch", () => {
    const evaluation = evaluateFixture(remisnah(), DEFAULT_REMIS_SETTINGS);
    expect(evaluation.passes).toBe(true);
    expect(evaluation.rejectedBy).toBe(null);
    expect(evaluation.remis?.probability).toBe(0.32);
  });

  it("weist eine zu geringe Remischance mit eigenem Grund ab", () => {
    const evaluation = evaluateFixture(mitMarkt({ probability: 0.26 }), DEFAULT_REMIS_SETTINGS);
    expect(evaluation.passes).toBe(false);
    expect(evaluation.rejectedBy).toBe("remisChance");
  });

  it("weist über dem Quotendeckel und ohne Markt ab", () => {
    expect(evaluateFixture(mitMarkt({ odds: 3.6 }), DEFAULT_REMIS_SETTINGS).rejectedBy).toBe("quote");
    expect(evaluateFixture(mitMarkt({ odds: null }), DEFAULT_REMIS_SETTINGS).rejectedBy).toBe("keineQuote");
    const ohneMarkt = fixture();
    expect(evaluateFixture(ohneMarkt, DEFAULT_REMIS_SETTINGS).rejectedBy).toBe("keinMarkt");
  });

  /**
   * Der wichtigste Test dieser Voreinstellung. Gemessen senkt jedes Zusatztor die
   * Trefferquote: Remis-Punkte ab 40 auf 34,7 %, ab 50 auf 30,8 %, Datenvertrauen ab 80
   * auf 32,2 % – gegenüber 35,7 % ohne. Wer eines davon einbaut, bricht diesen Test.
   */
  it("prüft weder Remis-Punkte noch direkte Duelle noch Datenvertrauen", () => {
    const magerePunkte = remisnah({ scores: { favorite: 40, draw: 3 } });
    expect(evaluateFixture(magerePunkte, DEFAULT_REMIS_SETTINGS).passes).toBe(true);

    const ohneRemisDuelle = remisnah({ h2h: h2h(["win", "win", "loss", "win", "loss"]) });
    expect(evaluateFixture(ohneRemisDuelle, DEFAULT_REMIS_SETTINGS).passes).toBe(true);

    const schwacheDaten = { ...mitMarkt({ confidence: 35 }), dataConfidence: 35 };
    expect(evaluateFixture(schwacheDaten, DEFAULT_REMIS_SETTINGS).passes).toBe(true);

    // Auch ein torreiches Spiel darf nicht am Torumfeld scheitern - das Modell hat die
    // Remischance bereits daraus gerechnet, ein zweites Tor darauf waere doppelt.
    const torreich = remisnah({ expectedGoals: { home: 1.9, away: 1.8, total: 3.7 } });
    expect(evaluateFixture(torreich, DEFAULT_REMIS_SETTINGS).passes).toBe(true);
  });

  it("stützt keine Seite und nennt stattdessen den Markt", () => {
    const evaluation = evaluateFixture(remisnah(), DEFAULT_REMIS_SETTINGS);
    expect(evaluation.side).toBe(null);
    expect(evaluation.market).toBe("draw");
    expect(evaluation.selection).toBe("Unentschieden (X)");
  });

  it("legt das Remis neben einer 1X2-Wette derselben Partie ab", () => {
    const partie = remisnah();
    const markt = partie.markets.find((entry) => entry.key === "draw")!;
    const eintrag = toCartEntry(partie, markt);
    expect(eintrag.marketKey).toBe("draw");
    expect(eintrag.odds).toBe(2.9);
    expect(eintrag.id).not.toBe(cartEntryId(partie.fixtureId, "1x2"));
  });

  it("wird von streng nach weit durchlässiger", () => {
    const fixtures = [
      { ...mitMarkt({ probability: 0.315, odds: 2.9 }), fixtureId: 1 },
      { ...mitMarkt({ probability: 0.305, odds: 2.9 }), fixtureId: 2 },
      { ...mitMarkt({ probability: 0.305, odds: 3.4 }), fixtureId: 3 },
      { ...mitMarkt({ probability: 0.295, odds: 3.4 }), fixtureId: 4 }
    ];
    const counts = REMIS_LEVELS.map((level) =>
      applyQuickpick(fixtures, applyLevel(DEFAULT_REMIS_SETTINGS, level.id)).report.passed);
    expect(counts).toEqual([1, 2, 3, 4]);
  });

  it("beschriftet die Stufen mit der Trefferquote", () => {
    const vorgabe = REMIS_LEVELS.find((level) => level.id === "ausgewogen")!;
    expect(QUICKPICK_PRESETS.remis.noteOf(vorgabe.measured)).toMatch(/Treffer$|geprüft$/);
    expect(QUICKPICK_PRESETS.remis.massstab).toBe("trefferquote");
  });
});
