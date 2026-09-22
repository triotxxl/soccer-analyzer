import { goalEventsDetailed, teamMatchStats, type InsightTeamStats } from "./fixture-insights.ts";
import { parseExpectedGoals } from "./xg.ts";
import type {
  ApiFixture,
  ApiFixtureEvent,
  ApiFixtureLineup,
  ApiFixtureStatistic,
  ApiTeamStatistics
} from "./types.ts";

const COMPLETED_STATUSES = new Set(["FT", "AET", "PEN"]);

/** Die drei Abschnitte, in die ein Ereignis fallen kann. */
export type MatchSection = 1 | 2 | 3;

/**
 * Der Abschnitt, in dem ein Ereignis liegt. Die Nachspielzeit zählt zum laufenden Abschnitt,
 * weil API-Football sie getrennt führt: Ein Tor in der 45.+2 kommt als `elapsed: 45, extra: 2`
 * und gehört in die erste Halbzeit, eines in der 90.+3 als `elapsed: 90, extra: 3` in die
 * zweite.
 *
 * Bewusst nicht über `scoringPeriodIndex` (`fixture-insights.ts`): Die presst die Verlängerung
 * absichtlich in die letzte Viertelstunde, weil die Torphasen-Ansicht nur reguläre Spielzeit
 * zeigt. Beim Speichern wäre das eine Verfälschung.
 *
 * Eine unbekannte Minute ergibt null und zählt nirgends mit.
 */
export function sectionOf(elapsed: number | null | undefined): MatchSection | null {
  if (elapsed === null || elapsed === undefined || !Number.isFinite(elapsed)) return null;
  if (elapsed <= 45) return 1;
  if (elapsed <= 90) return 2;
  return 3;
}

/** Ein Ereignis in der Form, in der es gespeichert wird. */
export interface StoredEvent {
  teamId: number;
  minute: number | null;
  extra: number | null;
  section: MatchSection | null;
  detail: string;
  player: string | null;
}

export interface StoredGoal extends StoredEvent {
  /** Die Mannschaft, in deren Reihen der Schütze steht - bei Eigentoren nicht `teamId`. */
  scorerTeamId: number;
  ownGoal: boolean;
  assist: string | null;
}

export interface StoredCard extends StoredEvent {
  /** `secondYellow` zählt als Verwarnung und als Platzverweis zugleich. */
  card: "yellow" | "red" | "secondYellow";
}

export interface StoredSubstitution extends StoredEvent {
  playerIn: string | null;
  playerOut: string | null;
}

/** Ein Zählerpaar je Halbzeit. null heißt unbekannt, 0 heißt "gab es nicht". */
export interface HalfCounts {
  ht1Home: number | null;
  ht1Away: number | null;
  ht2Home: number | null;
  ht2Away: number | null;
}

export interface FixtureResultStats {
  full: InsightTeamStats | null;
  firstHalf: InsightTeamStats | null;
  secondHalf: InsightTeamStats | null;
  /** Kennzahlen außerhalb von `STAT_TYPES`, nur zur Aufbewahrung. */
  extra: Record<string, number | null>;
}

export interface FixtureResult {
  fixtureId: number;
  kickoff: string;
  status: string;
  leagueId: number;
  country: string;
  league: string;
  season: number;
  round: string | null;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: string;
  awayTeam: string;

  finalHomeGoals: number;
  finalAwayGoals: number;
  htHomeGoals: number | null;
  htAwayGoals: number | null;
  ftHomeGoals: number | null;
  ftAwayGoals: number | null;
  shHomeGoals: number | null;
  shAwayGoals: number | null;
  etHomeGoals: number | null;
  etAwayGoals: number | null;
  penHomeGoals: number | null;
  penAwayGoals: number | null;

  goalsHt1Home: number | null;
  goalsHt1Away: number | null;
  goalsHt2Home: number | null;
  goalsHt2Away: number | null;
  goalsEtHome: number | null;
  goalsEtAway: number | null;
  goalsComplete: boolean;

  yellow: HalfCounts;
  red: HalfCounts;
  subs: HalfCounts;

  goals: StoredGoal[];
  cards: StoredCard[];
  substitutions: StoredSubstitution[];

  homeStats: FixtureResultStats;
  awayStats: FixtureResultStats;
  homeXg: number | null;
  awayXg: number | null;

  homeLineup: ApiFixtureLineup | null;
  awayLineup: ApiFixtureLineup | null;
  homePlayers: unknown | null;
  awayPlayers: unknown | null;

  eventsAvailable: boolean;
  statsAvailable: boolean;
  halfStatsAvailable: boolean;
  lineupsAvailable: boolean;
  playersAvailable: boolean;
  source: "cache" | "api";
  fetchedAt: string;
}

/**
 * Kennzahlen, die `STAT_TYPES` bewusst nicht führt. Sie gehören dort nicht hinein, weil der
 * Katalog in `teamMatchStats` entscheidet, ob eine Mannschaft überhaupt Statistik hat: Zwei
 * Zusatzfelder würden Mannschaften, die nur diese führen, plötzlich als "hat Statistik" gelten
 * lassen und damit die Abdeckungsangabe der Detailansicht verschieben.
 */
const EXTRA_STAT_TYPES: Record<string, string> = {
  freeKicks: "freekicks",
  goalsPrevented: "goalsprevented",
  passesPercent: "passes",
  expectedGoals: "expectedgoals"
};

function normalizedType(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z]/g, "");
}

function numericStat(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number"
    ? value
    : Number(String(value).replace("%", "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function extraStats(statistics: ApiFixtureStatistic[] | undefined): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const [field, type] of Object.entries(EXTRA_STAT_TYPES)) {
    result[field] = numericStat(
      statistics?.find((item) => normalizedType(item.type) === type)?.value
    );
  }
  return result;
}

/**
 * Der Statistikkatalog einer Mannschaft für das ganze Spiel und beide Halbzeiten.
 * `statistics_1h` und `statistics_2h` tragen dieselben `type`-Strings wie `statistics`, also
 * liest sie dieselbe Funktion - sie bekommt die Liste nur in einen Team-Eintrag verpackt.
 */
function statsFor(entry: ApiTeamStatistics | undefined): FixtureResultStats {
  const half = (list: ApiFixtureStatistic[] | undefined) =>
    entry && list ? teamMatchStats([{ team: entry.team, statistics: list }], entry.team.id) : null;
  return {
    full: entry ? teamMatchStats([entry], entry.team.id) : null,
    firstHalf: half(entry?.statistics_1h),
    secondHalf: half(entry?.statistics_2h),
    extra: extraStats(entry?.statistics)
  };
}

function storedEvent(event: ApiFixtureEvent): StoredEvent {
  const minute = event.time.elapsed ?? null;
  return {
    teamId: event.team.id,
    minute,
    extra: event.time.extra ?? null,
    section: sectionOf(minute),
    detail: event.detail ?? "",
    player: event.player?.name ?? null
  };
}

function cardKind(detail: string): StoredCard["card"] | null {
  if (/second\s*yellow/i.test(detail)) return "secondYellow";
  if (/yellow/i.test(detail)) return "yellow";
  if (/red/i.test(detail)) return "red";
  return null;
}

/**
 * Zählt Ereignisse je Halbzeit und Seite. Ohne Ereignisliste bleiben alle vier Werte null:
 * Eine fehlende Liste heißt "unbekannt", nicht "gab es nicht". Genau diese Verwechslung hat im
 * Projekt schon einmal einen Filter umgedreht, als eine leere Formliste 0 Prozent ergab und
 * das als miserable Form des Gegners gelesen wurde.
 */
function countHalves(
  events: Array<{ teamId: number; section: MatchSection | null }> | null,
  homeTeamId: number,
  awayTeamId: number
): HalfCounts {
  if (!events) return { ht1Home: null, ht1Away: null, ht2Home: null, ht2Away: null };
  const count = (section: MatchSection, teamId: number) =>
    events.filter((event) => event.section === section && event.teamId === teamId).length;
  return {
    ht1Home: count(1, homeTeamId),
    ht1Away: count(1, awayTeamId),
    ht2Home: count(2, homeTeamId),
    ht2Away: count(2, awayTeamId)
  };
}

/**
 * Wandelt eine beendete Partie in den Datensatz, der dauerhaft gespeichert wird. Reine
 * Funktion: kein Netz, keine Datenbank.
 *
 * `statistics` ist die Antwort von `/fixtures/statistics`; sie ersetzt den in der Partie
 * eingebetteten Block, weil nur sie mit `half=true` die Halbzeitwerte trägt.
 */
export function toFixtureResult(
  fixture: ApiFixture,
  options: {
    statistics?: ApiTeamStatistics[];
    source?: "cache" | "api";
    fetchedAt?: string;
  } = {}
): FixtureResult | null {
  const status = fixture.fixture.status.short;
  if (!COMPLETED_STATUSES.has(status)) return null;
  const finalHome = fixture.score.fulltime?.home ?? fixture.goals.home;
  const finalAway = fixture.score.fulltime?.away ?? fixture.goals.away;
  if (finalHome === null || finalHome === undefined) return null;
  if (finalAway === null || finalAway === undefined) return null;

  const homeTeamId = fixture.teams.home.id;
  const awayTeamId = fixture.teams.away.id;
  const rawEvents = Array.isArray(fixture.events) ? fixture.events : null;

  const goals: StoredGoal[] = (rawEvents ? goalEventsDetailed(rawEvents, homeTeamId, awayTeamId) : [])
    .map((goal) => ({
      teamId: goal.teamId,
      scorerTeamId: goal.scorerTeamId,
      minute: goal.minute,
      extra: goal.extra,
      section: sectionOf(goal.minute),
      ownGoal: goal.ownGoal,
      detail: goal.detail,
      player: goal.player,
      assist: goal.assist
    }));

  // Das Elfmeterschießen steht ebenfalls als Tor-Ereignis, meist mit Minute 120. Ohne diese
  // Ausnahme landete es in der Verlängerung und der Endstand ginge nicht mehr auf. Der Stand
  // des Schießens kommt ausschließlich aus `score.penalty`.
  const countedGoals = status === "PEN"
    ? goals.filter((goal) => (goal.minute ?? 0) < 120)
    : goals;

  const cards: StoredCard[] = (rawEvents ?? [])
    .filter((event) => event.type?.toLowerCase() === "card")
    .flatMap((event) => {
      const base = storedEvent(event);
      const card = cardKind(base.detail);
      return card ? [{ ...base, card }] : [];
    });

  const substitutions: StoredSubstitution[] = (rawEvents ?? [])
    .filter((event) => event.type?.toLowerCase() === "subst")
    .map((event) => ({
      ...storedEvent(event),
      playerIn: event.player?.name ?? null,
      playerOut: event.assist?.name ?? null
    }));

  const sectionGoals = (section: MatchSection, teamId: number) =>
    countedGoals.filter((goal) => goal.section === section && goal.teamId === teamId).length;

  // Eine zweite Gelbe ist beides: die zweite Verwarnung und der Platzverweis. Sie kommt im
  // Bestand vom 22.09.2026 kein einziges Mal vor, die Behandlung steht hier nur, damit ein
  // späteres Auftauchen die Zahlen nicht still verschiebt.
  const yellow = countHalves(
    rawEvents ? cards.filter((card) => card.card !== "red") : null, homeTeamId, awayTeamId);
  const red = countHalves(
    rawEvents ? cards.filter((card) => card.card !== "yellow") : null, homeTeamId, awayTeamId);
  const subs = countHalves(rawEvents ? substitutions : null, homeTeamId, awayTeamId);

  // Belastbar sind die Torminuten nur, wenn die Liste jedes Tor des Endstands trägt und keine
  // Minute fehlt. Anders als `minutesComplete` in `fixture-insights.ts` darf das hier auch für
  // AET und PEN gelten: Die Verlängerung ist ein eigener Abschnitt, und das Schießen ist oben
  // bereits herausgefiltert.
  const goalsComplete = rawEvents !== null
    && countedGoals.every((goal) => goal.section !== null)
    && countedGoals.filter((goal) => goal.teamId === homeTeamId).length === finalHome
    && countedGoals.filter((goal) => goal.teamId === awayTeamId).length === finalAway;

  const statistics = options.statistics ?? fixture.statistics;
  const homeStats = statsFor(statistics?.find((entry) => entry.team.id === homeTeamId));
  const awayStats = statsFor(statistics?.find((entry) => entry.team.id === awayTeamId));
  const xg = parseExpectedGoals(statistics, homeTeamId, awayTeamId);

  const homeLineup = fixture.lineups?.find((entry) => entry.team?.id === homeTeamId) ?? null;
  const awayLineup = fixture.lineups?.find((entry) => entry.team?.id === awayTeamId) ?? null;
  const homePlayers = fixture.players?.find((entry) => entry.team?.id === homeTeamId)?.players ?? null;
  const awayPlayers = fixture.players?.find((entry) => entry.team?.id === awayTeamId)?.players ?? null;

  const halftime = fixture.score.halftime;
  const subtract = (whole: number, half: number | null | undefined) =>
    half === null || half === undefined ? null : whole - half;

  return {
    fixtureId: fixture.fixture.id,
    kickoff: fixture.fixture.date,
    status,
    leagueId: fixture.league.id,
    country: fixture.league.country,
    league: fixture.league.name,
    season: fixture.league.season,
    round: fixture.league.round ?? null,
    homeTeamId,
    awayTeamId,
    homeTeam: fixture.teams.home.name,
    awayTeam: fixture.teams.away.name,

    finalHomeGoals: finalHome,
    finalAwayGoals: finalAway,
    htHomeGoals: halftime?.home ?? null,
    htAwayGoals: halftime?.away ?? null,
    ftHomeGoals: fixture.score.fulltime?.home ?? null,
    ftAwayGoals: fixture.score.fulltime?.away ?? null,
    shHomeGoals: subtract(finalHome, halftime?.home),
    shAwayGoals: subtract(finalAway, halftime?.away),
    // Verlängerung und Elfmeterschießen werden nur weitergereicht, nie verrechnet:
    // API-Football führt `extratime` je nach Wettbewerb mal als Gesamtstand, mal als Zuwachs.
    etHomeGoals: fixture.score.extratime?.home ?? null,
    etAwayGoals: fixture.score.extratime?.away ?? null,
    penHomeGoals: fixture.score.penalty?.home ?? null,
    penAwayGoals: fixture.score.penalty?.away ?? null,

    goalsHt1Home: rawEvents ? sectionGoals(1, homeTeamId) : null,
    goalsHt1Away: rawEvents ? sectionGoals(1, awayTeamId) : null,
    goalsHt2Home: rawEvents ? sectionGoals(2, homeTeamId) : null,
    goalsHt2Away: rawEvents ? sectionGoals(2, awayTeamId) : null,
    goalsEtHome: rawEvents ? sectionGoals(3, homeTeamId) : null,
    goalsEtAway: rawEvents ? sectionGoals(3, awayTeamId) : null,
    goalsComplete,

    yellow,
    red,
    subs,

    goals,
    cards,
    substitutions,

    homeStats,
    awayStats,
    homeXg: xg.home,
    awayXg: xg.away,

    homeLineup,
    awayLineup,
    homePlayers,
    awayPlayers,

    eventsAvailable: rawEvents !== null && rawEvents.length > 0,
    statsAvailable: homeStats.full !== null || awayStats.full !== null,
    halfStatsAvailable: homeStats.firstHalf !== null || awayStats.firstHalf !== null,
    lineupsAvailable: homeLineup !== null || awayLineup !== null,
    playersAvailable: homePlayers !== null || awayPlayers !== null,
    source: options.source ?? "cache",
    fetchedAt: options.fetchedAt ?? new Date().toISOString()
  };
}
