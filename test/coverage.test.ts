import assert from "node:assert/strict";
import test from "node:test";
import { findCoverageGaps, teamIdOf } from "../src/coverage.ts";
import type { DashboardDocument, DashboardFixture } from "../src/dashboard.ts";
import type { EloMatch } from "../src/elo-competitions.ts";

function fixture(partial: Partial<DashboardFixture>): DashboardFixture {
  return {
    fixtureId: 1, kickoff: "2026-09-29T18:00:00+02:00", country: "World", league: "Friendlies",
    homeTeam: "Heim", awayTeam: "Gast", modelVersion: "3.4.0", crossLeague: true, dataConfidence: 80,
    warnings: [], markets: [{ key: "1x2", probabilityReliable: false }],
    ...partial
  } as unknown as DashboardFixture;
}

const elo = (system: string, confidence = 80) =>
  ({ elo: 1500, confidence, system, asOf: "2026-09-29T00:00:00Z" }) as DashboardFixture["homeElo"];
const doc = (fixtures: DashboardFixture[]) =>
  ({ meta: { createdAt: "2026-09-29T12:00:00Z" }, fixtures }) as unknown as DashboardDocument;

const youthMatch = (leagueId: number, leagueName: string): EloMatch => ({
  fixtureId: 1, kickoff: Date.parse("2026-06-01T00:00:00Z"), leagueId, leagueName, leagueType: "Cup", country: "World",
  season: 2026, homeId: 5, homeName: "Spain U18", awayId: 6, awayName: "France U18", homeGoals: 1, awayGoals: 0
});

test("nennt je Lücke Ursache und Maßnahme, und trennt Gewolltes von Offenem", () => {
  const report = findCoverageGaps(doc([
    // Verschiedene Verbände: bewusst ohne Faktor.
    fixture({ homeTeam: "USA", awayTeam: "Chile", homeTeamId: 1, awayTeamId: 2, homeElo: elo("national"), awayElo: elo("national") }),
    // U19 ist gemessen, aber nicht freigegeben.
    fixture({ homeTeam: "Spain U19", awayTeam: "Italy U19", homeTeamId: 3, awayTeamId: 4, homeElo: elo("national-u19", 20), awayElo: elo("national-u19") }),
    // Ohne Elo: Die Spiele liegen im Bestand, sind aber ausgeschlossen (U18 hat keine Skala).
    fixture({ homeTeam: "Spain U18", awayTeam: "France U18", homeTeamId: 5, awayTeamId: 6, markets: [] as never }),
    // Pokal zweier Vereine ohne belastbare Ligabewertung.
    fixture({ country: "Slovakia", league: "Cup", homeTeam: "Inter Bratislava", awayTeam: "Podbrezová", homeElo: elo("club"), awayElo: elo("club") })
  ]), {
    eloMatches: (teamId) => teamId === 5 || teamId === 6 ? [youthMatch(10, "Friendlies")] : [],
    storedElo: (teamId) => ({ league: teamId === 1 ? "CONCACAF" : "CONMEBOL" }),
    apiLeagueId: (country) => country === "Slovakia" ? 680 : null
  }, Date.parse("2026-09-29T12:00:00Z"));

  const strength = new Map(report.missingStrength.map((gap) => [gap.fixture, gap]));
  assert.equal(strength.get("USA – Chile")?.intended, true);
  assert.match(strength.get("USA – Chile")!.cause, /CONCACAF gegen CONMEBOL/);
  assert.equal(strength.get("Spain U19 – Italy U19")?.intended, true);
  assert.match(strength.get("Spain U19 – Italy U19")!.cause, /U19-Nationalteams/);
  assert.equal(strength.get("Inter Bratislava – Podbrezová")?.intended, false);
  assert.match(strength.get("Inter Bratislava – Podbrezová")!.action, /--competition 680/);

  assert.equal(report.missingElo.length, 2);
  assert.match(report.missingElo[0]!.cause, /alle ausgeschlossen: Friendlies \(10\)/);
  assert.deepEqual(report.lowConfidence.map((entry) => entry.team), ["Spain U19"]);
});

test("Frauen-Vereine gelten nicht als Nationalteams, obwohl beide „… W“ heißen", () => {
  const report = findCoverageGaps(doc([
    fixture({ league: "UEFA Europa Cup - Women", homeTeam: "Häcken W", awayTeam: "Juventus W", homeElo: elo("club-women"), awayElo: elo("club-women") })
  ]), { eloMatches: () => [], storedElo: () => null, apiLeagueId: () => 1191 });
  assert.equal(report.missingStrength[0]?.intended, false);
  assert.match(report.missingStrength[0]!.action, /--competition 1191/);
});

test("ältere Analysen ohne Team-ID: die ID kommt aus dem Wappen-Link", () => {
  assert.equal(teamIdOf(fixture({ homeCrest: "https://media.api-sports.io/football/teams/2384.png" }), "home"), 2384);
  assert.equal(teamIdOf(fixture({ homeTeamId: 7, homeCrest: "https://media.api-sports.io/football/teams/2384.png" }), "home"), 7);
  assert.equal(teamIdOf(fixture({}), "away"), null);
});
