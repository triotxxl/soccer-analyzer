import assert from "node:assert/strict";
import test from "node:test";
import {
  eloSeasonGaps, mappingIssues, sharedTeamIds, staleTeams, strengthGaps, type LeagueSeasonCount
} from "../src/data-check.ts";
import type { EloMatch } from "../src/elo-competitions.ts";
import type { EloTeamMerge } from "../src/elo-config.ts";

const at = (iso: string) => Date.parse(`${iso}T15:00:00Z`);
let nextId = 1;
function match(partial: Partial<EloMatch> & Pick<EloMatch, "homeId" | "awayId">): EloMatch {
  return {
    fixtureId: nextId++, kickoff: at("2022-01-04"), leagueId: 276, leagueName: "FKF Premier League", leagueType: "League",
    country: "Kenya", season: 2021, homeName: `Team ${partial.homeId}`, awayName: `Team ${partial.awayId}`,
    homeGoals: 1, awayGoals: 0, ...partial
  };
}

// Kenya Police (20.10.2026): 2485 bis 2022, danach 8560 „Police“, das auch Police aus Burkina Faso trägt.
const kenya = (homeId: number, day: string, awayId = 2472) =>
  match({ homeId, homeName: homeId === 2485 ? "Kenya Police" : "Police", awayId, kickoff: at(day) });
const burkina = (day: string, awayId: number) =>
  match({ homeId: 8560, homeName: "Police", awayId, kickoff: at(day), leagueId: 245, leagueName: "Ligue 1", country: "Burkina-Faso" });
const kenyaMerge: EloTeamMerge = { from: 8560, to: 2485, countries: ["Kenya", "World"], note: "Test" };

test("geteilte ID: zwei Pflichtspiele gegen verschiedene Gegner am selben Tag, ab zwei Tagen", () => {
  const matches = [
    kenya(8560, "2022-01-04"), burkina("2022-01-04", 13978),
    kenya(8560, "2022-03-20", 2475), burkina("2022-03-20", 8568),
    // Ein einzelner Doppel-Spieltag reicht nicht - das kann ein Datumsfehler der API sein.
    match({ homeId: 1039, homeName: "El Geish", awayId: 1, kickoff: at("2022-07-12"), country: "Egypt" }),
    match({ homeId: 1039, homeName: "El Geish", awayId: 2, kickoff: at("2022-07-12"), country: "Egypt" })
  ];
  const found = sharedTeamIds(matches, [], new Set([8560]));
  assert.deepEqual(found.map((team) => [team.teamId, team.days, team.inAnalysis]), [[8560, 2, true]]);
  assert.deepEqual(found[0].countries.sort(), ["Burkina-Faso", "Kenya"]);
  // Mit der Zusammenführung gehören die kenianischen Spiele zu 2485, und der Konflikt ist weg.
  assert.deepEqual(sharedTeamIds(matches, [kenyaMerge], new Set()), []);
});

test("geteilte ID: Testspiele und Jugendteams zählen nicht", () => {
  const friendly = (awayId: number, day: string) =>
    match({ homeId: 637, homeName: "Sturm Graz", awayId, kickoff: at(day), leagueId: 667, leagueName: "Friendlies Clubs", country: "World" });
  const youth = (awayId: number, day: string) =>
    match({ homeId: 10349, homeName: "Spain U19", awayId, kickoff: at(day), leagueName: "UEFA U19 Championship - Qualification", country: "World", leagueType: "Cup" });
  const matches = [friendly(1, "2022-07-02"), friendly(2, "2022-07-02"), friendly(3, "2022-07-09"), friendly(4, "2022-07-09"),
    youth(1, "2026-03-25"), youth(2, "2026-03-25"), youth(3, "2026-03-28"), youth(4, "2026-03-28")];
  assert.deepEqual(sharedTeamIds(matches, [], new Set()), []);
});

test("abgerissene Geschichte: findet die zweite ID desselben Landes ohne gemeinsamen Spieltag", () => {
  const now = at("2026-10-20");
  const matches = [
    kenya(2485, "2021-10-16"), kenya(2485, "2022-06-12"),
    kenya(8560, "2022-11-20"), kenya(8560, "2026-10-11"),
    // Gleich benannt, aber in Burkina Faso - kein Kandidat für ein kenianisches Team.
    burkina("2026-09-01", 13978),
    // Aktiv in Kenia, aber anders benannt.
    match({ homeId: 2467, homeName: "GOR Mahia", awayId: 2472, kickoff: at("2026-10-01") })
  ];
  const analysis = [{ fixture: "Kenya Police – AFC Leopards", teamId: 2485, name: "Kenya Police" }];
  const [stale] = staleTeams(analysis, matches, [], now);
  assert.equal(stale.teamId, 2485);
  assert.deepEqual(stale.candidates.map((candidate) => candidate.teamId), [8560]);
  // Nach der Zusammenführung reicht die Geschichte bis Oktober 2026.
  assert.deepEqual(staleTeams(analysis, matches, [kenyaMerge], now), []);
});

test("abgerissene Geschichte: ein Kandidat mit gemeinsamem Spieltag ist ein anderer Verein", () => {
  const matches = [kenya(2485, "2022-06-12"), kenya(8560, "2022-06-12", 2475), kenya(8560, "2026-10-11")];
  const [stale] = staleTeams([{ fixture: "x", teamId: 2485, name: "Kenya Police" }], matches, [], at("2026-10-20"));
  assert.deepEqual(stale.candidates, []);
});

test("Zuordnung: unterscheidet falschen Alias, API ohne Spiele und fehlende Liga", () => {
  const base = { first: at("2026-08-22"), last: at("2026-10-17"), apiLeagueName: "x" };
  const issues = mappingIssues([
    // Panama Liga Prom zeigte auf die erste Liga (304), die im selben Zeitraum spielte.
    { ...base, country: "Panama", competition: "Liga Prom, Apertura", apiLeagueId: 304, events: 37, matched: 0 },
    { ...base, country: "Neuseeland", competition: "Northern League", apiLeagueId: 956, events: 12, matched: 0 },
    { ...base, country: "Mosambik", competition: "Mocambola", apiLeagueId: null, apiLeagueName: null, events: 10, matched: 0 },
    // Mehr als die Hälfte angekommen oder zu wenige Spiele: unauffällig.
    { ...base, country: "England", competition: "Premier League", apiLeagueId: 39, events: 20, matched: 19 },
    { ...base, country: "Japan", competition: "We-League", apiLeagueId: 854, events: 2, matched: 0 }
  ], (leagueId, from, to) => {
    assert.ok(from < at("2026-08-22") && to > at("2026-10-17"), "ein Tag Rand auf beiden Seiten");
    return leagueId === 304 ? 47 : 0;
  });
  assert.deepEqual(issues.map((issue) => [issue.competition, issue.verdict]), [
    ["Panama | Liga Prom, Apertura", "falscheLigaOderTeams"],
    ["Neuseeland | Northern League", "apiOhneSpiele"],
    ["Mosambik | Mocambola", "ohneLiga"]
  ]);
});

test("Elo-Saisonlücken: markierte Ligasaison weit unter dem Üblichen, Pokale und bekannte Ausnahmen nicht", () => {
  const before = Date.parse("2026-09-24T19:30:41Z");
  const season = (leagueId: number, year: number, matches: number, extra: Partial<LeagueSeasonCount> = {}): LeagueSeasonCount => ({
    leagueId, leagueName: `Liga ${leagueId}`, leagueType: "League", country: "Italy", season: year, matches, markedAt: before, ...extra
  });
  const gaps = eloSeasonGaps([
    // Serie D 2025: am 24.09.2026 mit 26 von 380 Spielen als vollständig markiert.
    season(426, 2022, 380), season(426, 2023, 380), season(426, 2024, 369), season(426, 2025, 26),
    // Laufende Saison: nicht markiert, also kein Befund.
    season(426, 2026, 40, { markedAt: null }),
    // Seit 20.10.2026 vollständig geladen und trotzdem kurz: bei API-Football wirklich kurz.
    season(118, 2022, 644), season(118, 2023, 895), season(118, 2024, 10, { markedAt: Date.parse("2026-10-20T11:00:00Z") }),
    // Pokal: schwankt von Jahr zu Jahr.
    season(45, 2022, 888, { leagueType: "Cup" }), season(45, 2023, 888, { leagueType: "Cup" }), season(45, 2024, 122, { leagueType: "Cup" }),
    // Ukraine 2021/22 wegen des Kriegs abgebrochen.
    season(333, 2021, 143), season(333, 2022, 240), season(333, 2023, 243), season(333, 2024, 240)
  ], new Set([426]), 2021);
  assert.deepEqual(gaps.map((gap) => [gap.leagueId, gap.season, gap.matches, gap.usual, gap.inAnalysis]), [[426, 2025, 26, 380, true]]);
});

test("Ligastärke: nennt nur die geschätzte Seite und den Abstand zur Belastbarkeit", () => {
  const gaps = strengthGaps([{
    fixture: "Karlovac 1919 – HNK Rijeka", homeTeam: "Karlovac 1919", awayTeam: "HNK Rijeka",
    home: { leagueId: 211, reliable: false }, away: { leagueId: 210, reliable: true }
  }], (leagueId) => (leagueId === 211 ? { matches: 16, clubs: 9, women: false } : null));
  assert.deepEqual(gaps, [{ fixture: "Karlovac 1919 – HNK Rijeka", team: "Karlovac 1919", leagueId: 211, matches: 16, clubs: 9, minClubs: 5 }]);
});
