import { describe, expect, it } from "vitest";
import {
  averageStat, matchStats, outcomeOf, scoringPeriods, selectH2h, statBaselines, trends, venueOf
} from "./insights";
import type { FixtureInsights, InsightMatch, InsightTeamStats } from "./types";

const LEAGUE = { id: 78, name: "Bundesliga", country: "Deutschland", season: 2026 };

/** Statistiken einer Mannschaft; alles, was nicht genannt ist, führt die Partie nicht. */
function stats(values: Partial<InsightTeamStats>): InsightTeamStats {
  return {
    possession: null, shots: null, shotsOnGoal: null, shotsOffGoal: null, blockedShots: null,
    shotsInsideBox: null, shotsOutsideBox: null, corners: null, fouls: null, offsides: null,
    yellowCards: null, redCards: null, goalkeeperSaves: null, totalPasses: null,
    passesAccurate: null,
    ...values
  };
}

function match(overrides: Partial<InsightMatch> & { fixtureId: number }): InsightMatch {
  return {
    date: "2026-08-01T18:00:00.000Z",
    leagueId: LEAGUE.id,
    league: LEAGUE.name,
    country: LEAGUE.country,
    season: LEAGUE.season,
    home: { id: 10, name: "Heim FC" },
    away: { id: 20, name: "Gast FC" },
    homeGoals: 1,
    awayGoals: 0,
    halfTimeHomeGoals: 0,
    halfTimeAwayGoals: 0,
    goals: [],
    minutesComplete: false,
    stats: { home: null, away: null },
    ...overrides
  };
}

describe("scoringPeriods", () => {
  it("verteilt Tore und Gegentore auf die sechs Viertelstunden", () => {
    const periods = scoringPeriods([
      match({
        fixtureId: 1, homeGoals: 2, awayGoals: 1, minutesComplete: true,
        goals: [{ teamId: 10, minute: 3 }, { teamId: 20, minute: 47 }, { teamId: 10, minute: 90 }]
      })
    ], 10);
    expect(periods.scored).toEqual([1, 0, 0, 0, 0, 1]);
    expect(periods.conceded).toEqual([0, 0, 0, 1, 0, 0]);
    expect(periods.scoredTotal).toBe(2);
    expect(periods.concededTotal).toBe(1);
    expect(periods.matches).toBe(1);
  });

  it("lässt Partien ohne lückenlose Ereignisliste ganz aus", () => {
    const periods = scoringPeriods([
      match({ fixtureId: 1, homeGoals: 3, awayGoals: 0, minutesComplete: false, goals: [{ teamId: 10, minute: 20 }] })
    ], 10);
    expect(periods.matches).toBe(0);
    expect(periods.scoredTotal).toBe(0);
  });

  it("filtert auf den Spielort und auf die Liga", () => {
    const matches = [
      match({ fixtureId: 1, minutesComplete: true, goals: [{ teamId: 10, minute: 10 }] }),
      match({
        fixtureId: 2, minutesComplete: true, home: { id: 30, name: "Fremd FC" }, away: { id: 10, name: "Heim FC" },
        homeGoals: 0, awayGoals: 1, goals: [{ teamId: 10, minute: 80 }]
      }),
      match({ fixtureId: 3, minutesComplete: true, leagueId: 81, league: "Pokal", goals: [{ teamId: 10, minute: 40 }] })
    ];
    expect(scoringPeriods(matches, 10, { venue: "home" }).matches).toBe(2);
    expect(scoringPeriods(matches, 10, { venue: "away" }).matches).toBe(1);
    expect(scoringPeriods(matches, 10, { scope: { id: LEAGUE.id, season: LEAGUE.season } }).matches).toBe(2);
  });
});

describe("Sicht auf ein Team", () => {
  it("erkennt Spielort und Ausgang aus Sicht des Teams", () => {
    const away = match({ fixtureId: 1, homeGoals: 0, awayGoals: 2 });
    expect(venueOf(away, 20)).toBe("away");
    expect(outcomeOf(away, 20)).toBe("win");
    expect(outcomeOf(away, 10)).toBe("loss");
    expect(outcomeOf(match({ fixtureId: 2, homeGoals: 1, awayGoals: 1 }), 10)).toBe("draw");
  });

  it("mittelt nur über die Partien, die den Wert führen", () => {
    const matches = [
      match({ fixtureId: 1, stats: { home: stats({ possession: 60, shots: 10, shotsOnGoal: 4 }), away: null } }),
      match({ fixtureId: 2, stats: { home: stats({ possession: 40 }), away: null } }),
      match({ fixtureId: 3 })
    ];
    expect(averageStat(matches, 10, "possession")).toEqual({ value: 50, matches: 2 });
    expect(averageStat(matches, 10, "shots")).toEqual({ value: 10, matches: 1 });
    expect(averageStat(matches, 20, "possession")).toEqual({ value: null, matches: 0 });
  });
});

describe("trends", () => {
  it("fasst die jüngsten Partien zusammen und begrenzt sie", () => {
    const matches = [
      match({ fixtureId: 1, homeGoals: 2, awayGoals: 0, stats: { home: stats({ possession: 55, shots: 12, shotsOnGoal: 5 }), away: null } }),
      match({ fixtureId: 2, homeGoals: 1, awayGoals: 1, stats: { home: stats({ possession: 45, shots: 8, shotsOnGoal: 2 }), away: null } }),
      match({ fixtureId: 3, homeGoals: 0, awayGoals: 3 })
    ];
    const summary = trends(matches, 10, { limit: 2 });
    expect(summary).toMatchObject({ matches: 2, wins: 1, draws: 1, losses: 0, goalsFor: 3, goalsAgainst: 1 });
    expect(summary.possession.value).toBe(50);
    expect(summary.shots.value).toBe(10);
  });

  it("beschränkt auf die Liga der Partie", () => {
    const matches = [
      match({ fixtureId: 1 }),
      match({ fixtureId: 2, leagueId: 81, league: "Pokal" }),
      match({ fixtureId: 3, season: 2025 })
    ];
    expect(trends(matches, 10, { scope: { id: LEAGUE.id, season: LEAGUE.season } }).matches).toBe(1);
    expect(trends(matches, 10).matches).toBe(3);
  });
});

describe("matchStats", () => {
  function insights(overrides: Partial<FixtureInsights> = {}): FixtureInsights {
    return {
      fixtureId: 900,
      league: { id: LEAGUE.id, name: LEAGUE.name, country: LEAGUE.country, season: LEAGUE.season },
      home: { id: 10, name: "Heim FC" },
      away: { id: 20, name: "Gast FC" },
      homeMatches: [],
      awayMatches: [],
      h2h: [],
      coverage: { matches: 0, withMinutes: 0, withStats: 0 },
      fetchedAt: "2026-09-14T10:00:00.000Z",
      apiRequests: 0,
      ...overrides
    };
  }

  const row = (rows: ReturnType<typeof matchStats>, label: string) =>
    rows.find((item) => item.label === label)!;

  it("mittelt nur über die jüngsten Partien der Auswahl", () => {
    const rows = matchStats(insights({
      homeMatches: [
        match({ fixtureId: 1, stats: { home: stats({ corners: 8 }), away: null } }),
        match({ fixtureId: 2, stats: { home: stats({ corners: 4 }), away: null } }),
        // Die dritte Partie liegt außerhalb von limit: 2 und darf den Mittelwert nicht drücken.
        match({ fixtureId: 3, stats: { home: stats({ corners: 0 }), away: null } })
      ]
    }), { source: "recent", limit: 2 });
    expect(row(rows, "Ecken")).toMatchObject({ home: 6, homeMatches: 2, away: null, awayMatches: 0 });
  });

  it("lässt eine Kennzahl ohne Werte auf beiden Seiten leer", () => {
    const rows = matchStats(insights({
      homeMatches: [match({ fixtureId: 1, stats: { home: stats({ corners: 5 }), away: null } })],
      awayMatches: [match({ fixtureId: 2, home: { id: 30, name: "Fremd FC" }, away: { id: 20, name: "Gast FC" }, stats: { home: null, away: stats({ corners: 3 }) } })]
    }), { source: "recent", limit: 5 });
    expect(row(rows, "Abseits")).toMatchObject({ home: null, away: null, homeMatches: 0, awayMatches: 0 });
  });

  it("ordnet im Duellmodus jedem Team seine Seite zu", () => {
    const rows = matchStats(insights({
      h2h: [
        // Heim FC zuhause: 60 % Ballbesitz.
        match({ fixtureId: 1, stats: { home: stats({ possession: 60 }), away: stats({ possession: 40 }) } }),
        // Rückspiel, Heim FC auswärts: 50 %.
        match({
          fixtureId: 2, home: { id: 20, name: "Gast FC" }, away: { id: 10, name: "Heim FC" },
          stats: { home: stats({ possession: 50 }), away: stats({ possession: 50 }) }
        })
      ]
    }), { source: "h2h", limit: 5 });
    expect(row(rows, "Ballbesitz")).toMatchObject({ home: 55, away: 45, homeMatches: 2, awayMatches: 2 });
  });

  it("summiert den Ballbesitz im Duellmodus auf 100 Prozent", () => {
    // Beide Seiten mitteln über dieselbe Partienmenge - nur dann ist die Aufteilung vollständig.
    const rows = matchStats(insights({
      h2h: [
        match({ fixtureId: 1, stats: { home: stats({ possession: 63 }), away: stats({ possession: 37 }) } }),
        match({
          fixtureId: 2, home: { id: 20, name: "Gast FC" }, away: { id: 10, name: "Heim FC" },
          stats: { home: stats({ possession: 44 }), away: stats({ possession: 56 }) }
        }),
        match({ fixtureId: 3, stats: { home: stats({ possession: 51 }), away: stats({ possession: 49 }) } })
      ]
    }), { source: "h2h", limit: 3 });
    const possession = row(rows, "Ballbesitz");
    expect(possession.home! + possession.away!).toBeCloseTo(100, 6);
  });

  it("rechnet die Passquote aus den beiden Rohwerten", () => {
    const rows = matchStats(insights({
      homeMatches: [
        match({ fixtureId: 1, stats: { home: stats({ totalPasses: 400, passesAccurate: 320 }), away: null } }),
        match({ fixtureId: 2, stats: { home: stats({ totalPasses: 600, passesAccurate: 420 }), away: null } })
      ]
    }), { source: "recent", limit: 5 });
    // 740 von 1000 Pässen, nicht der Mittelwert der beiden Einzelquoten.
    expect(row(rows, "Passquote")).toMatchObject({ home: 74, homeMatches: 2, scale: 100, unit: "%" });
  });

  it("lässt die Passquote leer, wenn die Gesamtzahl der Pässe fehlt", () => {
    const rows = matchStats(insights({
      homeMatches: [match({ fixtureId: 1, stats: { home: stats({ passesAccurate: 320 }), away: null } })]
    }), { source: "recent", limit: 5 });
    expect(row(rows, "Passquote")).toMatchObject({ home: null, homeMatches: 0 });
    expect(row(rows, "Erfolgreiche Pässe").home).toBe(320);
  });

  it("stellt mit venueOnly Heimform gegen Auswärtsform", () => {
    const rows = matchStats(insights({
      homeMatches: [
        match({ fixtureId: 1, stats: { home: stats({ corners: 8 }), away: null } }),
        match({
          fixtureId: 2, home: { id: 30, name: "Fremd FC" }, away: { id: 10, name: "Heim FC" },
          stats: { home: null, away: stats({ corners: 2 }) }
        })
      ],
      awayMatches: [
        match({
          fixtureId: 3, home: { id: 30, name: "Fremd FC" }, away: { id: 20, name: "Gast FC" },
          stats: { home: null, away: stats({ corners: 3 }) }
        }),
        match({
          fixtureId: 4, home: { id: 20, name: "Gast FC" }, away: { id: 30, name: "Fremd FC" },
          stats: { home: stats({ corners: 9 }), away: null }
        })
      ]
    }), { source: "recent", limit: 5, venueOnly: true });
    // Heim FC nur zuhause, Gast FC nur auswärts - die jeweils andere Partie fällt heraus.
    expect(row(rows, "Ecken")).toMatchObject({ home: 8, homeMatches: 1, away: 3, awayMatches: 1 });
  });

  it("filtert auf den Spielort, bevor es begrenzt", () => {
    const rows = matchStats(insights({
      homeMatches: [
        match({
          fixtureId: 1, home: { id: 30, name: "Fremd FC" }, away: { id: 10, name: "Heim FC" },
          stats: { home: null, away: stats({ corners: 0 }) }
        }),
        match({ fixtureId: 2, stats: { home: stats({ corners: 8 }), away: null } }),
        match({ fixtureId: 3, stats: { home: stats({ corners: 6 }), away: null } })
      ]
    }), { source: "recent", limit: 2, venueOnly: true });
    // Andersherum blieben von den letzten zwei Partien nur eine übrig und der Schnitt wäre 8.
    expect(row(rows, "Ecken")).toMatchObject({ home: 7, homeMatches: 2 });
  });

  it("behält im Duellmodus nur die Duelle im Stadion des Heimteams", () => {
    const rows = matchStats(insights({
      h2h: [
        match({ fixtureId: 1, stats: { home: stats({ possession: 63, corners: 6 }), away: stats({ possession: 37, corners: 2 }) } }),
        match({
          fixtureId: 2, home: { id: 20, name: "Gast FC" }, away: { id: 10, name: "Heim FC" },
          stats: { home: stats({ possession: 44 }), away: stats({ possession: 56 }) }
        })
      ]
    }), { source: "h2h", limit: 5, venueOnly: true });
    const possession = row(rows, "Ballbesitz");
    expect(row(rows, "Ecken")).toMatchObject({ home: 6, away: 2 });
    // Beide Seiten mitteln weiter über dieselbe Partienmenge, die Aufteilung bleibt vollständig.
    expect(possession.home! + possession.away!).toBeCloseTo(100, 6);
  });

  it("beschränkt auf die Liga der Partie, wenn ein Scope übergeben wird", () => {
    const data = insights({
      homeMatches: [
        match({ fixtureId: 1, stats: { home: stats({ corners: 10 }), away: null } }),
        match({ fixtureId: 2, leagueId: 81, league: "Pokal", stats: { home: stats({ corners: 2 }), away: null } })
      ]
    });
    const scope = { id: LEAGUE.id, season: LEAGUE.season };
    expect(row(matchStats(data, { source: "recent", limit: 5, scope }), "Ecken").home).toBe(10);
    expect(row(matchStats(data, { source: "recent", limit: 5 }), "Ecken").home).toBe(6);
  });
});

describe("statBaselines", () => {
  function insights(overrides: Partial<FixtureInsights> = {}): FixtureInsights {
    return {
      fixtureId: 900,
      league: { id: LEAGUE.id, name: LEAGUE.name, country: LEAGUE.country, season: LEAGUE.season },
      home: { id: 10, name: "Heim FC" },
      away: { id: 20, name: "Gast FC" },
      homeMatches: [],
      awayMatches: [],
      h2h: [],
      coverage: { matches: 0, withMinutes: 0, withStats: 0 },
      fetchedAt: "2026-09-14T10:00:00.000Z",
      apiRequests: 0,
      ...overrides
    };
  }

  it("mittelt über beide Seiten aller geladenen Partien", () => {
    // Auch die Gegner zählen: Der Schnitt beschreibt das Umfeld, nicht die beiden Teams.
    const baselines = statBaselines(insights({
      homeMatches: [match({ fixtureId: 1, stats: { home: stats({ corners: 8 }), away: stats({ corners: 2 }) } })],
      awayMatches: [match({ fixtureId: 2, stats: { home: stats({ corners: 6 }), away: stats({ corners: 4 }) } })],
      h2h: [match({ fixtureId: 3, stats: { home: stats({ corners: 5 }), away: stats({ corners: 5 }) } })]
    }));
    expect(baselines.corners).toBe(5);
  });

  it("lässt fehlende Werte aus, statt sie als Null zu mitteln", () => {
    const baselines = statBaselines(insights({
      homeMatches: [
        match({ fixtureId: 1, stats: { home: stats({ corners: 8 }), away: null } }),
        match({ fixtureId: 2, stats: { home: stats({ fouls: 12 }), away: null } })
      ]
    }));
    // 8 aus einer Partie - die zweite führt den Wert nicht und darf ihn nicht halbieren.
    expect(baselines.corners).toBe(8);
    expect(baselines.fouls).toBe(12);
  });

  it("liefert null, wenn eine Kennzahl nirgends geführt wird", () => {
    const baselines = statBaselines(insights({
      homeMatches: [match({ fixtureId: 1, stats: { home: stats({ corners: 8 }), away: null } })]
    }));
    expect(baselines.offsides).toBeNull();
    expect(baselines.passAccuracy).toBeNull();
  });

  it("zählt eine Partie einmal, auch wenn sie in mehreren Listen steht", () => {
    // Ein Ligaduell der beiden Teams steht in der Historie beider und unter den Duellen.
    const duel = match({
      fixtureId: 7, stats: { home: stats({ corners: 10 }), away: stats({ corners: 10 }) }
    });
    const baselines = statBaselines(insights({
      homeMatches: [duel, match({ fixtureId: 8, stats: { home: stats({ corners: 2 }), away: stats({ corners: 2 }) } })],
      awayMatches: [duel],
      h2h: [duel]
    }));
    // Dreifach gezählt läge der Schnitt bei 8, einfach gezählt bei 6.
    expect(baselines.corners).toBe(6);
  });

  it("bildet die Passquote aus den Summen beider Seiten", () => {
    const baselines = statBaselines(insights({
      h2h: [match({
        fixtureId: 1,
        stats: {
          home: stats({ totalPasses: 400, passesAccurate: 320 }),
          away: stats({ totalPasses: 600, passesAccurate: 420 })
        }
      })]
    }));
    // 740 von 1000 Pässen, nicht der Mittelwert aus 80 % und 70 %.
    expect(baselines.passAccuracy).toBe(74);
  });
});

describe("selectH2h", () => {
  const duels = [
    match({ fixtureId: 1, homeGoals: 2, awayGoals: 0 }),
    match({ fixtureId: 2, home: { id: 20, name: "Gast FC" }, away: { id: 10, name: "Heim FC" }, homeGoals: 1, awayGoals: 1 }),
    match({ fixtureId: 3, leagueId: 81, league: "Pokal", homeGoals: 0, awayGoals: 1 })
  ];

  it("rechnet die Bilanz aus Sicht des Heimteams", () => {
    const selection = selectH2h(duels, 10);
    expect(selection.summary).toMatchObject({ matches: 3, wins: 1, draws: 1, losses: 1, goalsFor: 3, goalsAgainst: 2 });
    expect(selection.goalsForPerGame).toBe(1);
  });

  it("filtert auf Heimspiele des Heimteams, auf die Liga und auf die Anzahl", () => {
    expect(selectH2h(duels, 10, { homeOnly: true }).matches.map((item) => item.fixtureId)).toEqual([1, 3]);
    expect(selectH2h(duels, 10, { scope: { id: LEAGUE.id, season: LEAGUE.season } }).matches.map((item) => item.fixtureId)).toEqual([1, 2]);
    expect(selectH2h(duels, 10, { limit: 1 }).matches.map((item) => item.fixtureId)).toEqual([1]);
  });

  it("filtert bei den Duellen auf die Liga, ohne die Saison zu verlangen", () => {
    const seasons = [
      match({ fixtureId: 1 }),
      match({ fixtureId: 2, season: 2025 }),
      match({ fixtureId: 3, leagueId: 81, league: "Pokal", season: 2025 })
    ];
    const ids = (selection: ReturnType<typeof selectH2h>) => selection.matches.map((item) => item.fixtureId);
    // Duelle laufen über Spielzeiten hinweg - die Vorsaison gehört zu "Diese Liga" dazu.
    expect(ids(selectH2h(seasons, 10, { scope: { id: LEAGUE.id } }))).toEqual([1, 2]);
    // Mit Saison bleibt es beim engeren Filter, den Torphasen und Trends brauchen.
    expect(ids(selectH2h(seasons, 10, { scope: { id: LEAGUE.id, season: LEAGUE.season } }))).toEqual([1]);
  });

  it("liefert für eine leere Auswahl keine Division durch null", () => {
    const empty = selectH2h([], 10);
    expect(empty.goalsForPerGame).toBe(0);
    expect(empty.goalsAgainstPerGame).toBe(0);
  });
});
