import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ApiFootballClient } from "../src/api.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import { toFixtureResult } from "../src/fixture-result.ts";
import {
  collectRecentStats, recentAverage, shouldRetryStats, type MatchSideStats
} from "../src/recent-stats.ts";
import type { RecentMatchSummary } from "../src/types.ts";
import { fixture, teamStatistics } from "./helpers.ts";

const KICKOFF = 1_767_222_000;

function summary(fixtureId: number, teamWasHome: boolean): RecentMatchSummary {
  return {
    fixtureId, teamWasHome,
    date: "2026-09-01T12:00:00.000Z",
    homeTeam: "Heim", awayTeam: "Gast",
    homeGoals: 1, awayGoals: 0,
    halfTimeHomeGoals: 0, halfTimeAwayGoals: 0
  };
}

function side(shotsOnGoal: number | null, corners: number | null): MatchSideStats {
  return { shotsOnGoal, corners };
}

test("der Schnitt mittelt nur über Partien, die den Wert führen", () => {
  // Eine Partie ohne Statistik als 0 mitzuzählen würde den Schnitt nach unten ziehen und aus
  // "unbekannt" ein "schwach" machen.
  const werte = new Map([
    [1, { home: side(6, 4), away: side(2, 1) }],
    [2, { home: side(4, 2), away: side(3, 5) }]
  ]);
  const ergebnis = recentAverage(
    [summary(1, true), summary(2, true), summary(3, true)],
    werte
  );
  assert.equal(ergebnis.shotsOnGoal, 5);
  assert.equal(ergebnis.corners, 3);
  assert.equal(ergebnis.matches, 2, "die dritte Partie fehlt und zählt nicht mit");
});

test("die Seite richtet sich danach, wo die Mannschaft gespielt hat", () => {
  const werte = new Map([[1, { home: side(9, 7), away: side(1, 0) }]]);
  assert.equal(recentAverage([summary(1, true)], werte).shotsOnGoal, 9);
  assert.equal(recentAverage([summary(1, false)], werte).shotsOnGoal, 1);
});

test("ohne jede Zahl bleibt der Schnitt leer statt null", () => {
  const leer = recentAverage([summary(1, true)], new Map());
  assert.equal(leer.shotsOnGoal, null);
  assert.equal(leer.corners, null);
  assert.equal(leer.matches, 0);
});

test("es zählen nur die jüngsten fünf Partien", () => {
  const werte = new Map(Array.from({ length: 6 }, (_, index) =>
    [index + 1, { home: side(index + 1, 0), away: side(0, 0) }] as const));
  const ergebnis = recentAverage(
    Array.from({ length: 6 }, (_, index) => summary(index + 1, true)),
    werte
  );
  // 1 bis 5, die sechste bleibt draußen.
  assert.equal(ergebnis.shotsOnGoal, 3);
});

test("ein fehlender Einzelwert zieht den anderen nicht mit herunter", () => {
  const werte = new Map([
    [1, { home: side(6, null), away: side(0, 0) }],
    [2, { home: side(4, 3), away: side(0, 0) }]
  ]);
  const ergebnis = recentAverage([summary(1, true), summary(2, true)], werte);
  assert.equal(ergebnis.shotsOnGoal, 5);
  assert.equal(ergebnis.corners, 3, "die Ecken mitteln nur über die eine Partie, die sie hat");
});

test("was in der Datenbank steht, kostet keinen Aufruf", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-recent-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  try {
    const gespeichert = toFixtureResult(fixture({
      id: 4242, timestamp: KICKOFF, homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0,
      statistics: [
        teamStatistics({ teamId: 1, full: { "Shots on Goal": 7, "Corner Kicks": 5 } }),
        teamStatistics({ teamId: 2, full: { "Shots on Goal": 2, "Corner Kicks": 1 } })
      ]
    }));
    assert.ok(gespeichert);
    database.saveFixtureResults([gespeichert]);

    let aufrufe = 0;
    const client = {
      getFixturesWithStatistics: async () => { aufrufe += 1; return []; }
    } as unknown as ApiFootballClient;

    const ergebnis = await collectRecentStats([4242], client, database);
    assert.equal(ergebnis.apiRequests, 0);
    assert.equal(aufrufe, 0, "eine bekannte Partie wird nicht erneut geholt");
    assert.equal(ergebnis.values.get(4242)?.home.shotsOnGoal, 7);
    assert.equal(ergebnis.values.get(4242)?.away.corners, 1);
  } finally {
    database.close();
  }
});

test("Lücken werden in Bündeln geholt und danach gespeichert", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-recent-fetch-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  try {
    const buendel: number[][] = [];
    const client = {
      getFixturesWithStatistics: async (ids: number[]) => {
        buendel.push(ids);
        return ids.map((id) => fixture({
          id, timestamp: KICKOFF, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 1,
          statistics: [
            teamStatistics({ teamId: 1, full: { "Shots on Goal": 8, "Corner Kicks": 6 } }),
            teamStatistics({ teamId: 2, full: { "Shots on Goal": 3, "Corner Kicks": 2 } })
          ]
        }));
      }
    } as unknown as ApiFootballClient;

    const ids = Array.from({ length: 25 }, (_, index) => 5000 + index);
    const ergebnis = await collectRecentStats(ids, client, database);
    assert.equal(ergebnis.apiRequests, 2, "25 Partien passen in zwei Bündel zu je 20");
    assert.deepEqual(buendel.map((b) => b.length), [20, 5]);
    assert.equal(ergebnis.values.size, 25);
    assert.equal(ergebnis.missing, 0);

    // Der zweite Lauf findet alles in der Datenbank wieder.
    const nochmal = await collectRecentStats(ids, client, database);
    assert.equal(nochmal.apiRequests, 0);
    assert.equal(nochmal.values.size, 25);
  } finally {
    database.close();
  }
});

test("das Budget bricht ab und meldet, was offen blieb", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-recent-budget-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  try {
    const client = {
      getFixturesWithStatistics: async (ids: number[]) => ids.map((id) => fixture({
        id, timestamp: KICKOFF, homeId: 1, awayId: 2, homeGoals: 0, awayGoals: 0,
        statistics: [teamStatistics({ teamId: 1, full: { "Shots on Goal": 1, "Corner Kicks": 1 } })]
      }))
    } as unknown as ApiFootballClient;

    const ids = Array.from({ length: 60 }, (_, index) => 6000 + index);
    const ergebnis = await collectRecentStats(ids, client, database, { maxRequests: 1 });
    assert.equal(ergebnis.apiRequests, 1);
    assert.equal(ergebnis.values.size, 20);
    assert.equal(ergebnis.missing, 40);
  } finally {
    database.close();
  }
});

test("eine geprüfte Partie ohne Zahlen wird nicht bei jedem Lauf erneut geholt", async () => {
  // Ohne diese Regel kosteten dieselben statistiklosen Ligen dauerhaft Aufrufe: Am 22.09.2026
  // waren das 147 von 391 Vorspielen, also acht verschenkte Aufrufe je Lauf.
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-recent-retry-"));
  const database = new AnalyzerDatabase(path.join(directory, "test.sqlite"));
  try {
    let aufrufe = 0;
    const client = {
      getFixturesWithStatistics: async (ids: number[]) => {
        aufrufe += 1;
        // Diese Liga führt keine Statistik - die Antwort kommt ohne Zahlen zurück.
        return ids.map((id) => fixture({
          id, timestamp: KICKOFF, homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0
        }));
      }
    } as unknown as ApiFootballClient;

    const alsDieDatenKamen = new Date("2026-09-22T20:00:00.000Z");
    const erst = await collectRecentStats([8100], client, database, { now: alsDieDatenKamen });
    assert.equal(erst.apiRequests, 1);
    assert.equal(erst.missing, 1, "geholt, aber die Liga führt nichts");

    // Am nächsten Tag: die Partie ist alt, da kommt nichts mehr nach.
    const späterAmSelbenTag = new Date("2026-09-22T23:00:00.000Z");
    const zweit = await collectRecentStats([8100], client, database, { now: späterAmSelbenTag });
    assert.equal(zweit.apiRequests, 0, "kein zweiter Aufruf für dieselbe leere Partie");
    assert.equal(aufrufe, 1);
  } finally {
    database.close();
  }
});

test("eine junge Partie ohne Zahlen wird am nächsten Tag noch einmal gefragt", () => {
  // API-Football trägt Zahlen manchmal erst nach Abpfiff nach.
  const jung = {
    home: { shotsOnGoal: null, corners: null },
    away: { shotsOnGoal: null, corners: null },
    statsAvailable: false,
    kickoff: "2026-09-21T18:00:00.000Z",
    fetchedAt: "2026-09-21T20:00:00.000Z"
  };
  assert.equal(shouldRetryStats(jung, new Date("2026-09-21T23:00:00.000Z")), false);
  assert.equal(shouldRetryStats(jung, new Date("2026-09-22T21:00:00.000Z")), true);

  const alt = { ...jung, kickoff: "2026-05-01T18:00:00.000Z", fetchedAt: "2026-09-21T20:00:00.000Z" };
  assert.equal(shouldRetryStats(alt, new Date("2026-09-30T20:00:00.000Z")), false,
    "eine alte Partie bekommt keine Zahlen mehr");

  const mitZahlen = { ...jung, statsAvailable: true };
  assert.equal(shouldRetryStats(mitZahlen, new Date("2030-01-01T00:00:00.000Z")), false);
});
