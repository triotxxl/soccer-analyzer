import { describe, expect, it } from "vitest";
import { averageStat, outcomeOf, scoringPeriods, selectH2h, trends, venueOf } from "./insights";
import type { InsightMatch } from "./types";

const LEAGUE = { id: 78, name: "Bundesliga", country: "Deutschland", season: 2026 };

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
      match({ fixtureId: 1, stats: { home: { possession: 60, shots: 10, shotsOnGoal: 4 }, away: null } }),
      match({ fixtureId: 2, stats: { home: { possession: 40, shots: null, shotsOnGoal: null }, away: null } }),
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
      match({ fixtureId: 1, homeGoals: 2, awayGoals: 0, stats: { home: { possession: 55, shots: 12, shotsOnGoal: 5 }, away: null } }),
      match({ fixtureId: 2, homeGoals: 1, awayGoals: 1, stats: { home: { possession: 45, shots: 8, shotsOnGoal: 2 }, away: null } }),
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

  it("liefert für eine leere Auswahl keine Division durch null", () => {
    const empty = selectH2h([], 10);
    expect(empty.goalsForPerGame).toBe(0);
    expect(empty.goalsAgainstPerGame).toBe(0);
  });
});
