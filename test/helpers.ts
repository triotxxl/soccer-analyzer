import type { ApiFixture } from "../src/types.ts";

export function fixture(options: {
  id: number;
  timestamp: number;
  homeId: number;
  awayId: number;
  homeGoals?: number | null;
  awayGoals?: number | null;
  status?: string;
  leagueId?: number;
  leagueName?: string;
  country?: string;
  season?: number;
}): ApiFixture {
  const status = options.status ?? (options.homeGoals === undefined ? "NS" : "FT");
  const date = new Date(options.timestamp * 1000).toISOString();
  const homeGoals = options.homeGoals ?? null;
  const awayGoals = options.awayGoals ?? null;
  return {
    fixture: {
      id: options.id,
      date,
      timestamp: options.timestamp,
      timezone: "UTC",
      status: { long: status === "FT" ? "Match Finished" : "Not Started", short: status, elapsed: null }
    },
    league: {
      id: options.leagueId ?? 78,
      name: options.leagueName ?? "Bundesliga",
      country: options.country ?? "Germany",
      season: options.season ?? 2026
    },
    teams: {
      home: { id: options.homeId, name: `Team ${options.homeId}` },
      away: { id: options.awayId, name: `Team ${options.awayId}` }
    },
    goals: { home: homeGoals, away: awayGoals },
    score: {
      fulltime: { home: homeGoals, away: awayGoals }
    }
  };
}

export function history(baseTimestamp: number): ApiFixture[] {
  const games: ApiFixture[] = [];
  for (let index = 1; index <= 16; index += 1) {
    const daysAgo = index * 7;
    games.push(fixture({
      id: 100 + index,
      timestamp: baseTimestamp - daysAgo * 86_400,
      homeId: index % 2 ? 1 : 10 + index,
      awayId: index % 2 ? 20 + index : 1,
      homeGoals: index % 2 ? 2 : 1,
      awayGoals: index % 3 ? 1 : 2
    }));
    games.push(fixture({
      id: 200 + index,
      timestamp: baseTimestamp - (daysAgo + 2) * 86_400,
      homeId: index % 2 ? 30 + index : 2,
      awayId: index % 2 ? 2 : 40 + index,
      homeGoals: index % 3 ? 2 : 1,
      awayGoals: index % 2 ? 2 : 1
    }));
  }
  return games;
}
