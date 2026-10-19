import assert from "node:assert/strict";
import test from "node:test";
import { strengthReloadLines } from "../src/output.ts";
import type { GoalLineRow } from "../src/types.ts";

function row(home: string, away: string, homeReliable: boolean, source?: "league" | "teamElo"): GoalLineRow {
  return {
    homeTeam: home, awayTeam: away, country: "Bulgaria", league: "Cup",
    strength: {
      home: { leagueId: 173, rating: 1513, reliable: homeReliable },
      away: { leagueId: 172, rating: 1663, reliable: true },
      factor: 1, ...(source ? { source } : {})
    }
  } as unknown as GoalLineRow;
}

test("Ausgabe nennt Nachladen, Budget-Stopp und Spiele mit geschätzter Seite", () => {
  const lines = strengthReloadLines({
    rows: [row("Etar", "Spartak Varna", false), row("A", "B", true), row("X", "Y", false, "teamElo")],
    strengthReload: {
      competitions: 6, fixturesStored: 38, apiRequests: 300, budget: 300,
      stoppedAt: { leagueId: 174, competition: "Cup", season: 2025, done: 7, total: 31 }
    }
  });
  assert.deepEqual(lines, [
    "Ligastärke vor der Rechnung: 6 Wettbewerbe, 38 Duelle neu, 300 von 300 Aufrufen - Budget erreicht bei Cup 2025 (7 von 31 Spielen)",
    "Spiele zwischen Ligen mit Ligastärke: 2, davon mit geschätzter Seite 1: Etar - Spartak Varna (Bulgaria · Cup)"
  ]);
});

test("Ohne Nachladen und ohne Spiele zwischen Ligen bleibt die Ausgabe leer", () => {
  assert.deepEqual(strengthReloadLines({ rows: [] }), []);
});
