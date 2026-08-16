import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runLiveAnalysis } from "../src/live.ts";
import { formatLiveAnalysis } from "../src/output.ts";
import type { ApiFixture, ApiFixtureEvent, ApiTeamStatistics } from "../src/types.ts";
import { fixture } from "./helpers.ts";

test("ordnet Screenshot-Partien zu und fasst frische Live-Daten zusammen", async () => {
  const live = fixture({
    id: 77,
    timestamp: 1_786_000_000,
    homeId: 1,
    awayId: 2,
    homeGoals: 1,
    awayGoals: 0,
    status: "2H"
  });
  live.teams.home.name = "FC Köln";
  live.teams.away.name = "Hamburger SV";
  live.fixture.status = { long: "Second Half", short: "2H", elapsed: 63 };
  const events: ApiFixtureEvent[] = [{
    time: { elapsed: 40 }, team: live.teams.home, player: { id: 9, name: "Spieler A" },
    type: "Goal", detail: "Normal Goal"
  }];
  live.events = events;
  const statistics: ApiTeamStatistics[] = [
    { team: live.teams.home, statistics: [
      { type: "Shots on Goal", value: 6 }, { type: "Total Shots", value: 12 },
      { type: "Ball Possession", value: "58%" }, { type: "Corner Kicks", value: 5 }
    ] },
    { team: live.teams.away, statistics: [
      { type: "Shots on Goal", value: 2 }, { type: "Total Shots", value: 6 },
      { type: "Ball Possession", value: "42%" }, { type: "Corner Kicks", value: 1 }
    ] }
  ];
  const client = {
    requestCount: 2,
    requestsRemaining: 97,
    getLiveFixtures: async (): Promise<ApiFixture[]> => [live],
    getFixtureEvents: async (): Promise<ApiFixtureEvent[]> => events,
    getFixtureStatistics: async (): Promise<ApiTeamStatistics[]> => statistics
  };

  const result = await runLiveAnalysis(
    [{ homeTeam: "1. FC Koln", awayTeam: "Hamburg" }],
    client as never,
    path.join(await mkdtemp(path.join(os.tmpdir(), "football-live-aliases-")), "aliases.json")
  );
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.activity, "Heimteam");
  assert.equal(result.matches[0]?.home.possession, 58);
  assert.match(formatLiveAnalysis(result), /63\. Minute/);
  assert.match(formatLiveAnalysis(result), /Spieler A/);
});

test("meldet nicht live gefundene Partien ohne Detailabfragen", async () => {
  let details = 0;
  const client = {
    requestCount: 1,
    requestsRemaining: null,
    getLiveFixtures: async (): Promise<ApiFixture[]> => [],
    getFixtureEvents: async (): Promise<ApiFixtureEvent[]> => { details += 1; return []; },
    getFixtureStatistics: async (): Promise<ApiTeamStatistics[]> => { details += 1; return []; }
  };
  const result = await runLiveAnalysis(
    [{ homeTeam: "Nicht da", awayTeam: "Auch nicht" }],
    client as never
  );
  assert.equal(result.unmatched.length, 1);
  assert.equal(details, 0);
});
