import type {
  ApiFixture,
  ApiFixtureEvent,
  ApiFixtureLineup,
  ApiFixturePlayers,
  ApiTeamStatistics
} from "../src/types.ts";

export function fixture(options: {
  id: number;
  timestamp: number;
  homeId: number;
  awayId: number;
  homeGoals?: number | null;
  awayGoals?: number | null;
  halfTimeHomeGoals?: number | null;
  halfTimeAwayGoals?: number | null;
  status?: string;
  leagueId?: number;
  leagueName?: string;
  country?: string;
  season?: number;
  round?: string;
  extraTimeHomeGoals?: number | null;
  extraTimeAwayGoals?: number | null;
  penaltyHomeGoals?: number | null;
  penaltyAwayGoals?: number | null;
  // Die vier Zusatzfelder liefert API-Football bei `fixtures?id=` mit. Ohne sie im Helfer
  // ließe sich keine Halbzeit-Aufteilung prüfen.
  events?: ApiFixtureEvent[];
  statistics?: ApiTeamStatistics[];
  lineups?: ApiFixtureLineup[];
  players?: ApiFixturePlayers[];
}): ApiFixture {
  const status = options.status ?? (options.homeGoals === undefined ? "NS" : "FT");
  const date = new Date(options.timestamp * 1000).toISOString();
  const homeGoals = options.homeGoals ?? null;
  const awayGoals = options.awayGoals ?? null;
  const halfTimeHomeGoals = options.halfTimeHomeGoals === undefined
    ? homeGoals === null ? null : Math.min(homeGoals, 1)
    : options.halfTimeHomeGoals;
  const halfTimeAwayGoals = options.halfTimeAwayGoals === undefined
    ? awayGoals === null ? null : Math.min(awayGoals, 1)
    : options.halfTimeAwayGoals;
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
      season: options.season ?? 2026,
      ...(options.round === undefined ? {} : { round: options.round })
    },
    teams: {
      home: { id: options.homeId, name: `Team ${options.homeId}` },
      away: { id: options.awayId, name: `Team ${options.awayId}` }
    },
    goals: { home: homeGoals, away: awayGoals },
    score: {
      halftime: { home: halfTimeHomeGoals, away: halfTimeAwayGoals },
      fulltime: { home: homeGoals, away: awayGoals },
      ...(options.extraTimeHomeGoals === undefined && options.extraTimeAwayGoals === undefined
        ? {}
        : {
          extratime: {
            home: options.extraTimeHomeGoals ?? null,
            away: options.extraTimeAwayGoals ?? null
          }
        }),
      ...(options.penaltyHomeGoals === undefined && options.penaltyAwayGoals === undefined
        ? {}
        : {
          penalty: {
            home: options.penaltyHomeGoals ?? null,
            away: options.penaltyAwayGoals ?? null
          }
        })
    },
    ...(options.events === undefined ? {} : { events: options.events }),
    ...(options.statistics === undefined ? {} : { statistics: options.statistics }),
    ...(options.lineups === undefined ? {} : { lineups: options.lineups }),
    ...(options.players === undefined ? {} : { players: options.players })
  };
}

/** Ein Ereignis, wie API-Football es liefert. Kurzform für die Tests. */
export function event(options: {
  type: string;
  minute: number | null;
  teamId: number;
  detail?: string;
  extra?: number | null;
  player?: string;
  assist?: string;
}): ApiFixtureEvent {
  return {
    time: { elapsed: options.minute, extra: options.extra ?? null },
    team: { id: options.teamId, name: `Team ${options.teamId}` },
    player: { id: null, name: options.player ?? null },
    assist: { id: null, name: options.assist ?? null },
    type: options.type,
    detail: options.detail ?? "Normal Goal"
  };
}

/** Ein Statistikblock je Mannschaft, wahlweise mit Halbzeitwerten. */
export function teamStatistics(options: {
  teamId: number;
  full: Record<string, number | string | null>;
  firstHalf?: Record<string, number | string | null>;
  secondHalf?: Record<string, number | string | null>;
}): ApiTeamStatistics {
  const list = (values: Record<string, number | string | null>) =>
    Object.entries(values).map(([type, value]) => ({ type, value }));
  return {
    team: { id: options.teamId, name: `Team ${options.teamId}` },
    statistics: list(options.full),
    ...(options.firstHalf === undefined ? {} : { statistics_1h: list(options.firstHalf) }),
    ...(options.secondHalf === undefined ? {} : { statistics_2h: list(options.secondHalf) })
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
