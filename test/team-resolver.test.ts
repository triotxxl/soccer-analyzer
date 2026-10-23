import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  fixtureMatchesTeamAliases,
  learnTeamAlias,
  readTeamAliases,
  saveTeamAlias,
  teamAliasFor,
  teamAliasesFor,
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

test("ein Alias je Wettbewerb geht dem allgemeinen vor (San Antonio FC: USL und Ecuador)", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-team-alias-league-"));
  const file = path.join(directory, "team-aliases.json");
  await saveTeamAlias("San Antonio FC", { id: 4017, name: "San Antonio" }, file);
  await saveTeamAlias("San Antonio FC", { id: 23310, name: "San Antonio" }, file, 243);
  const aliases = await readTeamAliases(file);

  assert.equal(aliases[teamAliasKey("San Antonio FC")]?.apiTeamId, 4017);
  assert.deepEqual(aliases[teamAliasKey("San Antonio FC", 243)], {
    tipicoName: "San Antonio FC",
    apiTeamId: 23310,
    apiTeamName: "San Antonio",
    leagueId: 243
  });
  const usl = fixture({ id: 1, timestamp: 1_786_000_000, homeId: 4017, awayId: 7, leagueId: 255 });
  const ecuador = fixture({ id: 2, timestamp: 1_786_000_000, homeId: 23310, awayId: 8, leagueId: 243 });
  usl.teams.home.name = "San Antonio USL";
  ecuador.teams.home.name = "San Antonio ECU";
  assert.equal(teamNameMatches("San Antonio FC", usl.teams.home, aliases, 255), true);
  assert.equal(teamNameMatches("San Antonio FC", ecuador.teams.home, aliases, 243), true);
  assert.equal(teamNameMatches("San Antonio FC", ecuador.teams.home, aliases, 255), false);
  assert.equal(teamNameMatches("San Antonio FC", usl.teams.home, aliases, 243), false);
  assert.equal(teamAliasFor(aliases, "San Antonio FC", 917)?.apiTeamId, 4017);
  assert.equal(teamAliasesFor(aliases, "San Antonio FC").length, 2);
});

test("eine gelernte Zuordnung überschreibt einen Alias auf ein anderes Team nicht", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "football-team-alias-learn-"));
  const file = path.join(directory, "team-aliases.json");
  await saveTeamAlias("San Antonio FC", { id: 4017, name: "San Antonio" }, file);
  const aliases = await readTeamAliases(file);

  await learnTeamAlias(aliases, "San Antonio FC", { id: 23310, name: "San Antonio" }, 243, file);
  await learnTeamAlias(aliases, "San Antonio FC", { id: 4017, name: "San Antonio Renamed" }, 255, file);
  await learnTeamAlias(aliases, "Neues Team", { id: 99, name: "New Team" }, 255, file);
  await learnTeamAlias(aliases, "Same Name", { id: 100, name: "Same Name" }, 255, file);
  const stored = await readTeamAliases(file);

  assert.deepEqual(stored, aliases);
  assert.equal(stored[teamAliasKey("San Antonio FC")]?.apiTeamId, 4017);
  assert.equal(stored[teamAliasKey("San Antonio FC")]?.apiTeamName, "San Antonio Renamed");
  assert.equal(stored[teamAliasKey("San Antonio FC", 243)]?.apiTeamId, 23310);
  assert.equal(stored[teamAliasKey("San Antonio FC", 255)], undefined);
  assert.equal(stored[teamAliasKey("Neues Team")]?.leagueId, undefined);
  assert.equal(stored[teamAliasKey("Same Name")], undefined);
});
