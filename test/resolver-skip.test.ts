import assert from "node:assert/strict";
import test from "node:test";
import { resolveLeagues } from "../src/resolver.ts";
import type { ApiLeague, LeagueSelection } from "../src/types.ts";

function league(id: number, country: string, name: string): ApiLeague {
  return {
    league: { id, name, type: "League" },
    country: { name, code: null, flag: null } as ApiLeague["country"],
    seasons: [{ year: 2026, start: "2026-08-01", end: "2027-05-31", current: true }]
  } as unknown as ApiLeague;
}

// Der Katalog fuehrt 171 Laender, Mosambik gehoert nicht dazu. Ein einziger solcher
// Wettbewerb darf die Auswertung aller uebrigen Partien nicht verhindern.
test("meldet nicht abgedeckte Wettbewerbe als not_found und loest den Rest auf", async () => {
  const catalogue = [
    { ...league(371, "Macedonia", "First League"), country: { name: "Macedonia" } },
    { ...league(211, "Croatia", "First NL"), country: { name: "Croatia" } }
  ] as unknown as ApiLeague[];
  catalogue[0]!.league.name = "First League";
  catalogue[1]!.league.name = "First NL";

  const selections: LeagueSelection[] = [
    { country: "Macedonia", league: "First League" },
    { country: "Mosambik", league: "Mocambola" }
  ];

  const { resolved, failures } = await resolveLeagues(selections, catalogue);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.leagueId, 371);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.requested.league, "Mocambola");

  // Nach dem Ausfiltern bleibt ein vollstaendig aufloesbarer Umfang uebrig.
  const remaining = selections.filter((selection) =>
    !failures.some((failure) =>
      failure.requested.country === selection.country &&
      failure.requested.league === selection.league));
  const second = await resolveLeagues(remaining, catalogue);
  assert.deepEqual(second.failures, []);
  assert.equal(second.resolved.length, 1);
});
