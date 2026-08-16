import assert from "node:assert/strict";
import test from "node:test";
import { resolveLeagues } from "../src/resolver.ts";
import type { ApiLeague } from "../src/types.ts";

const leagues: ApiLeague[] = [
  {
    league: { id: 78, name: "Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{ year: 2026, start: "2026-08-01", end: "2027-05-30", current: true }]
  },
  {
    league: { id: 79, name: "2. Bundesliga", type: "League" },
    country: { name: "Germany" },
    seasons: [{ year: 2026, start: "2026-08-01", end: "2027-05-30", current: true }]
  }
];

test("löst Länderübersetzung und exakten Liganamen auf", async () => {
  const result = await resolveLeagues([{ country: "Deutschland", league: "Bundesliga" }], leagues);
  assert.equal(result.failures.length, 0);
  assert.equal(result.resolved[0]?.leagueId, 78);
});

test("meldet mehrdeutige oder unbekannte Ligen mit Kandidaten", async () => {
  const result = await resolveLeagues([{ country: "Deutschland", league: "Liga" }], leagues);
  assert.equal(result.resolved.length, 0);
  assert.equal(result.failures[0]?.reason, "ambiguous");
  assert.ok((result.failures[0]?.candidates.length ?? 0) >= 1);
});
