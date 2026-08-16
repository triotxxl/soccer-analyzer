import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  fixtureMatchesTeamAliases,
  readTeamAliases,
  saveTeamAlias,
  teamAliasKey,
  teamNameSimilarity,
  teamNameMatches
} from "../src/team-resolver.ts";
import { fixture } from "./helpers.ts";

test("speichert Tipico-Teamnamen dauerhaft und aktualisiert vorhandene Zuordnungen", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-team-aliases-"));
  const file = path.join(directory, "team-aliases.json");
  await saveTeamAlias("Paris SG", { id: 85, name: "Paris Saint Germain" }, file);
  await saveTeamAlias("KTP", { id: 204, name: "Kooteepee" }, file);
  await saveTeamAlias("Paris SG", { id: 85, name: "Paris Saint-Germain" }, file);

  const aliases = await readTeamAliases(file);
  assert.equal(Object.keys(aliases).length, 2);
  assert.deepEqual(aliases[teamAliasKey("Paris SG")], {
    tipicoName: "Paris SG",
    apiTeamId: 85,
    apiTeamName: "Paris Saint-Germain"
  });
});

test("erkennt eindeutige Kurzformen konservativ als ähnlich", () => {
  assert.ok(teamNameSimilarity("Paris Saint G.", "Paris Saint Germain") >= 0.8);
  assert.ok(teamNameSimilarity("Wolverhampton", "Blackburn") < 0.5);
});

test("ordnet gespeicherte Aliase anhand stabiler API-Team-IDs zu", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-team-matching-"));
  const file = path.join(directory, "team-aliases.json");
  await saveTeamAlias("Tipico Heim", { id: 1, name: "API Home" }, file);
  await saveTeamAlias("Tipico Gast", { id: 2, name: "API Away" }, file);
  const aliases = await readTeamAliases(file);
  const upcoming = fixture({ id: 900, timestamp: 1_786_000_000, homeId: 1, awayId: 2 });
  upcoming.teams.home.name = "API Home Renamed";
  upcoming.teams.away.name = "API Away Renamed";

  assert.equal(teamNameMatches("Tipico Heim", upcoming.teams.home, aliases), true);
  assert.equal(
    fixtureMatchesTeamAliases("Tipico Heim", "Tipico Gast", upcoming, aliases),
    true
  );
  assert.equal(teamNameMatches("Falsches Team", upcoming.teams.home, aliases), false);
});
