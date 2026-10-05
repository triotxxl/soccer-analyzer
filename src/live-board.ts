import { config } from "./config.ts";
import { teamSnapshot } from "./live.ts";
import { clockOf, isShortMatch, liveChances, type LiveChances } from "./live-model.ts";
import { marketStandNow, type MarketStand } from "./market-outcome.ts";
import { isFinishedStatus, isLiveStatus } from "./util.ts";
import type { DashboardFixture, DashboardMarket, DashboardMarketKey } from "./dashboard.ts";
import type {
  ApiFixture,
  ApiFixtureEvent,
  ApiTeamStatistics,
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

export interface LiveCardCount {
  yellow: number;
  red: number;
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
  /**
   * Liefert die Liga laut `coverage` Live-Statistik? null, wenn der Snapshot es nicht weiß
   * (vor schemaVersion 7). false erlaubt der App den Satz „Diese Liga liefert keine
   * Live-Statistik.“ statt eines stummen „–“.
   */
  statisticsCoverage: boolean | null;
  /**
   * Karten je Team, gezählt aus den Ereignissen (Gelb-Rot zählt als Rot, eine per VAR
   * zurückgenommene Rote nur dann ab, wenn sie noch in der Liste steht). null heißt
   * „keine Kartendaten“: Die Liga trägt keine Karten ein, oder es gibt weder Ereignisse noch
   * Statistik. Bis zum 29.09.2026 las die App Rot nur aus der Statistik, die in rund 70 % der
   * laufenden Spiele fehlt.
   */
  cards: { home: LiveCardCount; away: LiveCardCount } | null;
  /** Live-Chancen aus `src/live-model.ts`; die App rechnet nichts davon selbst. */
  live: LiveChances;
  /** Was der Stand über die Ganzspiel-Torlinien und BTTS schon sicher sagt. */
  marketStands: Partial<Record<DashboardMarketKey, MarketStand>>;
  events: LiveBoardEvent[];
  prematch: {
    crossLeague: boolean;
    dataConfidence: number;
    expectedGoals: { home: number; away: number; total: number };
    markets: DashboardMarket[];
  };
}

/** Märkte, für die der Stand eine Tatsache hergibt (`marketStandNow`). */
const STAND_MARKETS: DashboardMarketKey[] = [
  "over15", "under15", "over25", "under25", "over35", "under35", "btts", "bttsNo"
];

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

/** Die Team-IDs der Live-Antwort in der Ausrichtung des Dashboards (siehe `toBoardMatch`). */
interface Orientation { homeId: number; awayId: number; swapped: boolean }

function orientationOf(fixture: ApiFixture, dashboard: DashboardFixture): Orientation {
  const swapped = dashboard.homeTeamId !== undefined && dashboard.awayTeamId !== undefined
    && fixture.teams.home.id === dashboard.awayTeamId && fixture.teams.away.id === dashboard.homeTeamId;
  return swapped
    ? { homeId: fixture.teams.away.id, awayId: fixture.teams.home.id, swapped }
    : { homeId: fixture.teams.home.id, awayId: fixture.teams.away.id, swapped };
}

function sideOf(teamId: number, orientation: Orientation): LiveTeamSide | null {
  return teamId === orientation.homeId ? "home" : teamId === orientation.awayId ? "away" : null;
}

function boardEvents(fixture: ApiFixture, orientation: Orientation): LiveBoardEvent[] {
  return (fixture.events ?? [])
    .filter((event) => RELEVANT_EVENT_TYPES.has(event.type.toLocaleLowerCase()))
    .map((event: ApiFixtureEvent): LiveBoardEvent => ({
      // Ein Ereignis ohne Minute sortiert ans Ende der Tafel, statt als Minute 0 nach oben.
      minute: event.time.elapsed ?? 0,
      extra: event.time.extra ?? null,
      side: sideOf(event.team.id, orientation),
      type: event.type,
      detail: event.detail,
      player: event.player?.name ?? null
    }))
    .sort((left, right) => (left.minute + (left.extra ?? 0)) - (right.minute + (right.extra ?? 0)));
}

/**
 * Karten aus den Ereignissen. API-Football führt Gelb-Rot als „Red Card“ und eine per VAR
 * hochgestufte Karte meist mit eigenem „Red Card“ (409 von 464 Fällen im Cache am 29.09.2026) -
 * „Card upgrade“ zählt deshalb nicht extra. Eine zurückgenommene Rote („Red card cancelled“)
 * löscht die API meist selbst (in 83 von 86 Fällen stand keine Rote mehr in der Liste); sie
 * zieht deshalb nur ab, wenn für denselben Spieler noch eine Rote dasteht.
 */
export function cardsFromEvents(events: ApiFixtureEvent[], orientation: { homeId: number; awayId: number }): { home: LiveCardCount; away: LiveCardCount } {
  const cards = { home: { yellow: 0, red: 0 }, away: { yellow: 0, red: 0 } };
  const reds: Array<{ side: LiveTeamSide; player: string | null }> = [];
  const playerKey = (event: ApiFixtureEvent) => event.player?.id != null ? `#${event.player.id}` : event.player?.name ?? null;
  const ordered = [...events].sort((left, right) =>
    ((left.time.elapsed ?? 0) + (left.time.extra ?? 0) / 100) - ((right.time.elapsed ?? 0) + (right.time.extra ?? 0) / 100));
  for (const event of ordered) {
    const side = sideOf(event.team.id, { ...orientation, swapped: false });
    if (!side) continue;
    const type = event.type.toLocaleLowerCase();
    const detail = event.detail.toLocaleLowerCase();
    if (type === "card") {
      if (/second\s*yellow/.test(detail) || detail.includes("red")) {
        cards[side].red += 1;
        reds.push({ side, player: playerKey(event) });
      } else if (detail.includes("yellow")) {
        cards[side].yellow += 1;
      }
    } else if (type === "var" && detail === "red card cancelled") {
      const index = reds.findIndex((red) => red.side === side && red.player !== null && red.player === playerKey(event));
      if (index >= 0) {
        reds.splice(index, 1);
        cards[side].red -= 1;
      }
    }
  }
  return cards;
}

function boardCards(
  fixture: ApiFixture,
  dashboard: DashboardFixture,
  orientation: Orientation,
  metrics: { home: LiveTeamSnapshot; away: LiveTeamSnapshot },
  metricsAvailable: boolean
): LiveBoardMatch["cards"] {
  // Die Liga trägt keine Karten ein: „0“ hieße dort nicht „keine Karte“, sondern „unbekannt“.
  if (dashboard.cardData === false || dashboard.liveCoverage?.events === false) return null;
  if (Array.isArray(fixture.events)) return cardsFromEvents(fixture.events, orientation);
  if (!metricsAvailable) return null;
  return {
    home: { yellow: metrics.home.yellowCards ?? 0, red: metrics.home.redCards ?? 0 },
    away: { yellow: metrics.away.yellowCards ?? 0, red: metrics.away.redCards ?? 0 }
  };
}

/**
 * Verbindet den Live-Stand der API mit dem gespeicherten Pre-Match-Ergebnis. Die Markttafel
 * stammt unverändert aus dem Dashboard-Lauf; neu gerechnet werden nur die Live-Chancen
 * (`src/live-model.ts`) aus der Torerwartung vor dem Anpfiff, Uhr, Stand und Roten Karten.
 *
 * Dreht API-Football nachträglich Heim und Gast (bekannt seit dem 26.09.2026, siehe
 * `settleFixture`), wird die Live-Antwort in die Ausrichtung des Dashboards gespiegelt - sonst
 * stünden Stand, Karten und Statistik beim falschen Team und die Live-Chancen rechneten mit
 * vertauschter Torerwartung. Ohne Team-IDs im Snapshot bleibt alles, wie die API es liefert.
 */
export function toBoardMatch(
  fixture: ApiFixture,
  dashboard: DashboardFixture,
  statistics?: ApiTeamStatistics[]
): LiveBoardMatch {
  const orientation = orientationOf(fixture, dashboard);
  const flip = <T>(pair: { home: T; away: T }): { home: T; away: T } =>
    orientation.swapped ? { home: pair.away, away: pair.home } : pair;
  const values = statistics ?? fixture.statistics ?? [];
  const home = teamSnapshot(values.find((item) => item.team.id === orientation.homeId));
  const away = teamSnapshot(values.find((item) => item.team.id === orientation.awayId));
  const metricsAvailable = hasValue(home) || hasValue(away);
  const goals = flip({ home: fixture.goals.home, away: fixture.goals.away });
  const halfTime = flip({ home: fixture.score.halftime?.home ?? null, away: fixture.score.halftime?.away ?? null });
  const cards = boardCards(fixture, dashboard, orientation, { home, away }, metricsAvailable);
  const status = fixture.fixture.status;
  const oneXTwo = dashboard.markets.find((market) => market.key === "1x2");
  const live = liveChances({
    lambdaHome: dashboard.expectedGoals.home,
    lambdaAway: dashboard.expectedGoals.away,
    clock: clockOf(status.short, status.elapsed, status.extra ?? null),
    goalsHome: goals.home ?? 0,
    goalsAway: goals.away ?? 0,
    // Ohne Kartendaten zählt die Statistik; fehlt auch die, rechnet das Modell ohne Rot.
    redHome: cards?.home.red ?? home.redCards ?? 0,
    redAway: cards?.away.red ?? away.redCards ?? 0,
    sideReliable: oneXTwo?.probabilityReliable !== false,
    shortMatch: isShortMatch(dashboard.homeTeam, dashboard.awayTeam)
  });
  const marketStands: LiveBoardMatch["marketStands"] = {};
  if (goals.home !== null && goals.away !== null) {
    for (const key of STAND_MARKETS) {
      const stand = marketStandNow(key, "", goals.home, goals.away);
      if (stand) marketStands[key] = stand;
    }
  }
  return {
    fixtureId: fixture.fixture.id,
    kickoff: dashboard.kickoff,
    country: dashboard.country,
    league: dashboard.league,
    homeTeam: dashboard.homeTeam,
    awayTeam: dashboard.awayTeam,
    status: { short: status.short, long: status.long },
    elapsed: status.elapsed,
    extra: status.extra ?? null,
    goals,
    halfTime,
    metrics: { home, away },
    metricsAvailable,
    statisticsCoverage: dashboard.liveCoverage?.statistics ?? null,
    cards,
    live,
    marketStands,
    events: boardEvents(fixture, orientation),
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
    match.goals.home, match.goals.away, match.metrics.home, match.metrics.away, match.cards
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
    cards: match.cards,
    // Was die App gezeigt hat - damit sich später prüfen lässt, ob die gezeigten Chancen
    // hielten, ohne sie aus Minute und Stand nachzubauen.
    live: {
      modelVersion: match.live.modelVersion, state: match.live.state,
      remainingGoals: match.live.remainingGoals, anotherGoal: match.live.anotherGoal,
      nextGoal: match.live.nextGoal, result: match.live.result
    },
    prematchOdds: odds
  });
}
