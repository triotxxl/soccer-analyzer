import assert from "node:assert/strict";
import test from "node:test";
import { getEloByTeam, getTeamElo, mergedTeamIds } from "../src/elo-store.ts";

/**
 * Das Lesen folgt `ELO_TEAM_MERGES` (seit Elo 1.5.0): Wests APIA (26874) hängt an APIA Leichhardt
 * Tigers (3764), hat keinen eigenen Eintrag und bekommt deshalb dessen Elo. Ein eigener Eintrag
 * geht vor (geteilte IDs wie Kenya Police 8560).
 */
const row = (teamId: number, elo: number, games: number, system = "club") => ({
  system, team_id: teamId, name: `Team ${teamId}`, elo, games, last_change: 0, change_30: 0, change_90: 0, peak: elo, low: elo,
  trend: "stabil", league: "Liga", league_id: 1, country: "Land", confidence: 50, last_played: 0, as_of: 0, config_version: "1.5.0"
});
const rows = [row(3764, 1770, 160), row(8560, 1400, 20), row(2485, 1600, 80)];
const database = {
  eloRatings(filter: { system?: string; teamId?: number } = {}) {
    return rows.filter((r) => (filter.system === undefined || r.system === filter.system) && (filter.teamId === undefined || r.team_id === filter.teamId));
  }
};

test("Zusammengeführte ID ohne eigenen Eintrag liest das Elo der Ziel-ID", () => {
  assert.deepEqual(mergedTeamIds(26874), [26874, 3764]);
  assert.equal(getTeamElo(database, 26874)?.teamId, 3764);
  assert.equal(getTeamElo(database, 26874)?.elo, 1770);
  assert.equal(getEloByTeam(database).get(26874)?.teamId, 3764);
  assert.equal(getTeamElo(database, 424242), null);
});

test("Ein eigener Eintrag geht der Zusammenführung vor (geteilte ID)", () => {
  // 8560 ist Kenya Police → 2485 nur für Kenia; die ID trägt daneben Police aus Burkina Faso.
  assert.equal(getTeamElo(database, 8560)?.teamId, 8560);
  assert.equal(getEloByTeam(database).get(8560)?.elo, 1400);
});
