import { config } from "./config.ts";
import { activity, teamSnapshot } from "./live.ts";
import { isFinishedStatus, isLiveStatus } from "./util.ts";
import type { DashboardFixture, DashboardMarket } from "./dashboard.ts";
import type {
  ApiFixture,
  ApiFixtureEvent,
  ApiTeamStatistics,
  LiveMatchSnapshot,
  LiveTeamSnapshot
} from "./types.ts";

const RELEVANT_EVENT_TYPES = new Set(["goal", "card", "subst", "var"]);

export type LiveTeamSide = "home" | "away";

export interface LiveBoardEvent {
  minute: number;
  extra: number | null;
  side: LiveTeamSide | null;
  type: string;
  detail: string;
  player: string | null;
}

export interface LiveBoardMatch {
  fixtureId: number;
  kickoff: string;
  country: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  status: { short: string; long: string };
  elapsed: number | null;
  extra: number | null;
  goals: { home: number | null; away: number | null };
  halfTime: { home: number | null; away: number | null };
  metrics: { home: LiveTeamSnapshot; away: LiveTeamSnapshot };
  metricsAvailable: boolean;
  activity: LiveMatchSnapshot["activity"];
  events: LiveBoardEvent[];
  prematch: {
    crossLeague: boolean;
    dataConfidence: number;
    expectedGoals: { home: number; away: number; total: number };
    markets: DashboardMarket[];
  };
}

export interface LiveBoardBudget {
  usedToday: number;
  capToday: number;
  apiRequestsRemaining: number | null;
  exhausted: boolean;
}

export interface LiveBoardResponse {
  createdAt: string;
  pollIntervalMs: number;
  matches: LiveBoardMatch[];
  candidates: number;
  /** "batch" = /fixtures?ids in 20er-Buendeln, "live-all" = /fixtures?live=all plus Statistik-Takt. */
  strategy: "batch" | "live-all";
  budget: LiveBoardBudget;
  message: string | null;
}

/**
 * Fixtures, die zum Zeitpunkt `now` überhaupt laufen können. Das Zeitfenster deckt
 * Verlängerung, Elfmeterschießen und verspätete Anstöße ab; alles außerhalb wird gar
 * nicht erst abgefragt und kostet damit keinen einzigen API-Call.
 */
export { isFinishedStatus, isLiveStatus };

export function liveCandidateIds(
  fixtures: DashboardFixture[],
  now: number,
  excluded: ReadonlySet<number> = new Set(),
  allowed: ReadonlySet<number> | null = null
): number[] {
  const earliest = now - config.liveCandidateTrailMs;
  const latest = now + config.liveCandidateLeadMs;
  const ids = new Set<number>();
  for (const fixture of fixtures) {
    if (excluded.has(fixture.fixtureId)) continue;
    // Der Anwender beobachtet nur einen Teil der Partien; alles andere wird gar nicht
    // erst abgefragt und kostet damit keinen Call.
    if (allowed && !allowed.has(fixture.fixtureId)) continue;
    const kickoff = Date.parse(fixture.kickoff);
    if (!Number.isFinite(kickoff)) continue;
    if (kickoff < earliest || kickoff > latest) continue;
    ids.add(fixture.fixtureId);
  }
  return [...ids].sort((left, right) => left - right);
}

/** Der `ids`-Endpoint akzeptiert höchstens 20 Fixtures pro Anfrage. */
export function chunkIds(ids: number[], size = 20): number[][] {
  if (size < 1) throw new Error("Batchgröße muss mindestens 1 sein.");
  const batches: number[][] = [];
  for (let offset = 0; offset < ids.length; offset += size) {
    batches.push(ids.slice(offset, offset + size));
  }
  return batches;
}

function hasValue(snapshot: LiveTeamSnapshot): boolean {
  return Object.values(snapshot).some((value) => value !== null);
}

function boardEvents(fixture: ApiFixture): LiveBoardEvent[] {
  return (fixture.events ?? [])
    .filter((event) => RELEVANT_EVENT_TYPES.has(event.type.toLocaleLowerCase()))
    .map((event: ApiFixtureEvent): LiveBoardEvent => ({
      minute: event.time.elapsed,
      extra: event.time.extra ?? null,
      side: event.team.id === fixture.teams.home.id
        ? "home"
        : event.team.id === fixture.teams.away.id ? "away" : null,
      type: event.type,
      detail: event.detail,
      player: event.player?.name ?? null
    }))
    .sort((left, right) => (left.minute + (left.extra ?? 0)) - (right.minute + (right.extra ?? 0)));
}

/**
 * Verbindet den Live-Stand der API mit dem gespeicherten Pre-Match-Ergebnis. Es wird kein
 * Modellwert neu berechnet - die Markttafel stammt unverändert aus dem Dashboard-Lauf.
 */
export function toBoardMatch(
  fixture: ApiFixture,
  dashboard: DashboardFixture,
  statistics?: ApiTeamStatistics[]
): LiveBoardMatch {
  const values = statistics ?? fixture.statistics ?? [];
  const home = teamSnapshot(values.find((item) => item.team.id === fixture.teams.home.id));
  const away = teamSnapshot(values.find((item) => item.team.id === fixture.teams.away.id));
  return {
    fixtureId: fixture.fixture.id,
    kickoff: dashboard.kickoff,
    country: dashboard.country,
    league: dashboard.league,
    homeTeam: dashboard.homeTeam,
    awayTeam: dashboard.awayTeam,
    status: { short: fixture.fixture.status.short, long: fixture.fixture.status.long },
    elapsed: fixture.fixture.status.elapsed,
    extra: fixture.fixture.status.extra ?? null,
    goals: { home: fixture.goals.home, away: fixture.goals.away },
    halfTime: {
      home: fixture.score.halftime?.home ?? null,
      away: fixture.score.halftime?.away ?? null
    },
    metrics: { home, away },
    metricsAvailable: hasValue(home) || hasValue(away),
    activity: activity(home, away),
    events: boardEvents(fixture),
    prematch: {
      crossLeague: dashboard.crossLeague,
      dataConfidence: dashboard.dataConfidence,
      expectedGoals: dashboard.expectedGoals,
      markets: dashboard.markets
    }
  };
}

/**
 * Kennzeichnet einen inhaltlichen Stand. Solange sich Minute, Spielstand und Statistiken
 * nicht ändern, wird keine neue Snapshot-Zeile geschrieben.
 */
export function snapshotKey(match: LiveBoardMatch): string {
  return JSON.stringify([
    match.fixtureId, match.status.short, match.elapsed, match.extra,
    match.goals.home, match.goals.away, match.metrics.home, match.metrics.away
  ]);
}

/** Eine JSONL-Zeile je Partie im Format aus dem Live-Konzept, Abschnitt 20. */
export function snapshotLine(match: LiveBoardMatch, capturedAt: string): string {
  const odds: Record<string, number> = {};
  for (const market of match.prematch.markets) {
    if (market.odds !== null) odds[market.key] = market.odds;
  }
  return JSON.stringify({
    capturedAt,
    fixtureId: match.fixtureId,
    country: match.country,
    league: match.league,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    status: match.status.short,
    minute: match.elapsed,
    extra: match.extra,
    score: { home: match.goals.home, away: match.goals.away },
    halfTime: match.halfTime,
    statistics: { home: match.metrics.home, away: match.metrics.away },
    prematchOdds: odds
  });
}
