import type { ApiFixture, ApiFixtureEvent, ApiTeamStatistics } from "./types.ts";

const COMPLETED_STATUSES = new Set(["FT", "AET", "PEN"]);

/** Die sechs Viertelstunden der regulären Spielzeit, wie sie die Torphasen-Ansicht zeigt. */
export const SCORING_PERIOD_COUNT = 6;

/**
 * Der Statistikkatalog einer Partie je Mannschaft. Die Feldnamen sind dieselben wie in
 * `teamSnapshot` (`src/live.ts`), damit Live-Board und Detailansicht dieselbe Kennzahl
 * gleich nennen.
 *
 * Die Passquote führt API-Football als eigene Zeile "Passes %", die `normalizedType` zu
 * `passes` verkürzt - zu nah an `totalpasses`, um sie verlässlich auseinanderzuhalten.
 * Sie wird deshalb nicht übernommen, sondern in der Ansicht aus `passesAccurate` und
 * `totalPasses` gerechnet.
 */
export interface InsightTeamStats {
  /** Ballbesitz in Prozent. */
  possession: number | null;
  /** Torschüsse gesamt. */
  shots: number | null;
  shotsOnGoal: number | null;
  shotsOffGoal: number | null;
  blockedShots: number | null;
  shotsInsideBox: number | null;
  shotsOutsideBox: number | null;
  corners: number | null;
  fouls: number | null;
  offsides: number | null;
  yellowCards: number | null;
  redCards: number | null;
  goalkeeperSaves: number | null;
  totalPasses: number | null;
  passesAccurate: number | null;
}

/**
 * Feld der Ansicht zu Statistiktyp von API-Football, bereits normalisiert. Eine einzige
 * Liste, damit ein neues Feld nicht an zwei Stellen nachgetragen werden muss - besonders
 * nicht in der Bedingung, die eine Mannschaft ganz ohne Statistik erkennt.
 */
export const STAT_TYPES: Record<keyof InsightTeamStats, string> = {
  possession: "ballpossession",
  shots: "totalshots",
  shotsOnGoal: "shotsongoal",
  shotsOffGoal: "shotsoffgoal",
  blockedShots: "blockedshots",
  shotsInsideBox: "shotsinsidebox",
  shotsOutsideBox: "shotsoutsidebox",
  corners: "cornerkicks",
  fouls: "fouls",
  offsides: "offsides",
  yellowCards: "yellowcards",
  redCards: "redcards",
  goalkeeperSaves: "goalkeepersaves",
  totalPasses: "totalpasses",
  passesAccurate: "passesaccurate"
};

export interface InsightMatch {
  fixtureId: number;
  date: string;
  leagueId: number;
  league: string;
  country: string;
  season: number;
  home: { id: number; name: string };
  away: { id: number; name: string };
  homeGoals: number;
  awayGoals: number;
  halfTimeHomeGoals: number | null;
  halfTimeAwayGoals: number | null;
  /**
   * Torminuten mit der Mannschaft, der das Tor gutgeschrieben wird. Nur belastbar, wenn
   * `minutesComplete` gilt: ohne Ereignisse ist eine leere Liste "unbekannt", nicht "torlos".
   */
  goals: Array<{ teamId: number; minute: number }>;
  /**
   * true, wenn die Ereignisse jedes Tor des Endstands tragen. Eine Partie mit lückenhafter
   * Ereignisliste bleibt in den Torphasen ganz außen vor, statt dort zu wenige Tore zu zeigen.
   */
  minutesComplete: boolean;
  stats: { home: InsightTeamStats | null; away: InsightTeamStats | null };
}

export interface FixtureInsights {
  fixtureId: number;
  league: { id: number; name: string; country: string; season: number };
  /** `logo` ist die Wappen-URL von API-Football; sie fehlt, wenn die Antwort sie nicht führt. */
  home: { id: number; name: string; logo?: string };
  away: { id: number; name: string; logo?: string };
  /** Letzte abgeschlossene Partien des Heimteams, beide Spielorte, neueste zuerst. */
  homeMatches: InsightMatch[];
  awayMatches: InsightMatch[];
  h2h: InsightMatch[];
  coverage: { matches: number; withMinutes: number; withStats: number };
  fetchedAt: string;
  apiRequests: number;
}

function completedScore(fixture: ApiFixture): [number, number] | null {
  if (!COMPLETED_STATUSES.has(fixture.fixture.status.short)) return null;
  const home = fixture.score.fulltime?.home ?? fixture.goals.home;
  const away = fixture.score.fulltime?.away ?? fixture.goals.away;
  return home === null || away === null ? null : [home, away];
}

/**
 * Die Viertelstunde, in der ein Tor fällt. Nachspielzeit zählt zum laufenden Abschnitt,
 * Verlängerung zur Schlussphase: Ein Tor in der 45.+3 gehört zu 30'-45', eines in der 90.+4
 * oder der 105. zu 75'-90'. Die Ansicht zeigt nur die reguläre Spielzeit.
 */
export function scoringPeriodIndex(minute: number): number {
  const period = Math.ceil(Math.max(minute, 1) / 15);
  return Math.min(Math.max(period, 1), SCORING_PERIOD_COUNT) - 1;
}

/**
 * Tore aus den Ereignissen einer Partie. Ein Eigentor führt API-Football unter der
 * Mannschaft des Schützen; gutgeschrieben wird es dem Gegner. Verschossene Elfmeter
 * stehen ebenfalls als `Goal`-Ereignis und zählen nicht.
 */
export function goalEvents(
  events: ApiFixtureEvent[] | undefined,
  homeTeamId: number,
  awayTeamId: number
): Array<{ teamId: number; minute: number }> {
  return goalEventsDetailed(events, homeTeamId, awayTeamId)
    .map((goal) => ({ teamId: goal.teamId, minute: goal.minute ?? 0 }));
}

export interface DetailedGoal {
  /** Die Mannschaft, der das Tor zählt - bei einem Eigentor also der Gegner des Schützen. */
  teamId: number;
  /** Die Mannschaft, in deren Reihen der Schütze steht. */
  scorerTeamId: number;
  /** Spielminute. null heißt unbekannt und darf nicht als Minute 0 gelesen werden. */
  minute: number | null;
  /** Nachspielzeit, falls die Antwort sie führt: 45+2 kommt als minute 45, extra 2. */
  extra: number | null;
  ownGoal: boolean;
  detail: string;
  player: string | null;
  assist: string | null;
}

/**
 * Dieselben Tore wie `goalEvents`, nur ohne die Verluste: Nachspielzeit, Eigentor-Kennzeichen
 * und Namen bleiben erhalten. `goalEvents` ruft diese Funktion auf, damit die Regel zu
 * Eigentoren und verschossenen Elfmetern nur an einer Stelle steht.
 *
 * Unbekannte Minuten sortieren ans Ende statt als Minute 0 an den Anfang.
 */
export function goalEventsDetailed(
  events: ApiFixtureEvent[] | undefined,
  homeTeamId: number,
  awayTeamId: number
): DetailedGoal[] {
  return (events ?? [])
    .filter((event) => event.type?.toLowerCase() === "goal")
    .filter((event) => !/missed/i.test(event.detail ?? ""))
    .map((event) => {
      const ownGoal = /own goal/i.test(event.detail ?? "");
      const scorerTeamId = event.team.id;
      const teamId = !ownGoal
        ? scorerTeamId
        : scorerTeamId === homeTeamId ? awayTeamId : homeTeamId;
      return {
        teamId,
        scorerTeamId,
        minute: event.time.elapsed ?? null,
        extra: event.time.extra ?? null,
        ownGoal,
        detail: event.detail ?? "",
        player: event.player?.name ?? null,
        assist: event.assist?.name ?? null
      };
    })
    .sort((left, right) =>
      (left.minute ?? Number.MAX_SAFE_INTEGER) - (right.minute ?? Number.MAX_SAFE_INTEGER));
}

function numericStat(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace("%", "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedType(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z]/g, "");
}

export function teamMatchStats(
  statistics: ApiTeamStatistics[] | undefined,
  teamId: number
): InsightTeamStats | null {
  const entry = statistics?.find((item) => item.team.id === teamId);
  if (!entry) return null;
  const value = (type: string) => numericStat(entry.statistics
    .find((item) => normalizedType(item.type) === type)?.value);
  const stats = {} as InsightTeamStats;
  for (const field of Object.keys(STAT_TYPES) as Array<keyof InsightTeamStats>) {
    stats[field] = value(STAT_TYPES[field]);
  }
  // Erst wenn der ganze Katalog leer ist, führt die Antwort zu dieser Mannschaft nichts.
  // Ein einzelner fehlender Wert bleibt null und darf nie als 0 in einen Mittelwert gehen.
  return Object.values(stats).every((item) => item === null) ? null : stats;
}

/**
 * Wandelt eine API-Partie in den Datensatz der Detailansicht. `detail` ist dieselbe Partie
 * aus `/fixtures?ids=`, die Ereignisse und Statistiken mitführt; fehlt sie, bleiben die
 * Zusatzfelder leer und die Ansicht weist die Lücke aus.
 */
export function toInsightMatch(fixture: ApiFixture, detail?: ApiFixture): InsightMatch | null {
  const score = completedScore(fixture);
  if (!score) return null;
  const homeId = fixture.teams.home.id;
  const awayId = fixture.teams.away.id;
  const events = detail?.events;
  const statistics = detail?.statistics;
  const goals = goalEvents(events, homeId, awayId);
  // Nur eine lückenlose Ereignisliste einer regulär beendeten Partie darf in die Torphasen.
  // Verlängerung und Elfmeterschießen führen Endstand und Ereignisliste auseinander.
  const minutesComplete = Array.isArray(events)
    && fixture.fixture.status.short === "FT"
    && goals.filter((goal) => goal.teamId === homeId).length === score[0]
    && goals.filter((goal) => goal.teamId === awayId).length === score[1];
  return {
    fixtureId: fixture.fixture.id,
    date: fixture.fixture.date,
    leagueId: fixture.league.id,
    league: fixture.league.name,
    country: fixture.league.country,
    season: fixture.league.season,
    home: { id: homeId, name: fixture.teams.home.name },
    away: { id: awayId, name: fixture.teams.away.name },
    homeGoals: score[0],
    awayGoals: score[1],
    halfTimeHomeGoals: fixture.score.halftime?.home ?? null,
    halfTimeAwayGoals: fixture.score.halftime?.away ?? null,
    goals,
    minutesComplete,
    stats: { home: teamMatchStats(statistics, homeId), away: teamMatchStats(statistics, awayId) }
  };
}

/**
 * Testspiele bleiben aus beiden Auswahlen heraus. Als gemeinsames Prädikat notiert, damit
 * Teamhistorie und direkte Duelle nicht wieder auseinanderlaufen: Ein Testspiel nur in den
 * Duellen hieße, dass die beiden Modi desselben Panels verschiedene Historien meinen.
 */
function competitive(match: ApiFixture): boolean {
  return !/friendl/i.test(match.league.name);
}

/**
 * Die Partien, die in die Detailansicht eingehen: abgeschlossen, keine Freundschaftsspiele,
 * vor dem Anpfiff der analysierten Partie, neueste zuerst. Dieselbe Abgrenzung wie in der
 * Formbewertung, damit Punkte und Ansicht dieselbe Historie meinen.
 */
export function selectHistory(
  fixtures: ApiFixture[],
  teamId: number,
  cutoff: number,
  limit: number
): ApiFixture[] {
  return [...new Map(fixtures.map((match) => [match.fixture.id, match])).values()]
    .filter((match) => match.fixture.timestamp < cutoff)
    .filter((match) => match.teams.home.id === teamId || match.teams.away.id === teamId)
    .filter(competitive)
    .filter((match) => completedScore(match) !== null)
    .sort((left, right) => right.fixture.timestamp - left.fixture.timestamp)
    .slice(0, limit);
}

/**
 * Die direkten Duelle. `/fixtures/headtohead` liefert ohne `last` die komplette Historie
 * über alle Wettbewerbe - Testspiele eingeschlossen, die hier dieselbe Abgrenzung wie in
 * `selectHistory` erfahren.
 */
export function selectH2h(fixtures: ApiFixture[], cutoff: number, limit: number): ApiFixture[] {
  return [...new Map(fixtures.map((match) => [match.fixture.id, match])).values()]
    .filter((match) => match.fixture.timestamp < cutoff)
    .filter(competitive)
    .filter((match) => completedScore(match) !== null)
    .sort((left, right) => right.fixture.timestamp - left.fixture.timestamp)
    .slice(0, limit);
}

export function coverageOf(matches: InsightMatch[]): FixtureInsights["coverage"] {
  const unique = [...new Map(matches.map((match) => [match.fixtureId, match])).values()];
  return {
    matches: unique.length,
    withMinutes: unique.filter((match) => match.minutesComplete).length,
    withStats: unique.filter((match) => match.stats.home !== null || match.stats.away !== null).length
  };
}
