import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ApiFootballClient } from "./api.ts";
import { CACHE_DIR } from "./config.ts";
import type { AnalyzerDatabase } from "./database.ts";
import { classifyMatch, CONFEDERATION_OF_COMPETITION, type EloMatch } from "./elo-competitions.ts";
import {
  ELO_COMPETITIONS, ELO_CONFIG, ELO_EXCLUDE_PATTERN, ELO_EXCLUDE_TEAM_PATTERN, ELO_NATIONAL_CATEGORY_COMPETITIONS,
  ELO_SENIOR_RESERVE_TEAMS, ELO_TEAM_MERGES, ELO_WOMEN_CLUB_COMPETITIONS, ELO_YOUTH_PATTERN
} from "./elo-config.ts";
import { calculateHistoricalElo, leagueLevels, summarizeElo } from "./elo.ts";
import type { ApiFixture, ApiLeague } from "./types.ts";

/**
 * Pflege des Team-Elo: Spiele aus dem Cache übernehmen, laufende Saisons nachholen, neu
 * rechnen. Dashboard-Lauf (`src/cli.ts`) und Befehle (`tools/elo.ts`) nutzen diese eine Fassung.
 *
 * Kosten: Der Import aus dem Cache und das Neurechnen kosten keinen Aufruf. Nur die
 * Wochenrunde (`topUpRunningSeasons`) fragt API-Football, je laufender Liga einmal - geschätzt
 * am 26.09.2026 rund 485 Aufrufe, im Januar rund 440, im Juli rund 175.
 */

const FINISHED = new Set(["FT", "AET", "PEN"]);
const DAY_MS = 24 * 60 * 60 * 1000;
/** Eine Liga gehört zur Wochenrunde, wenn sie in diesem Zeitraum im Bestand vorkam. */
const KNOWN_WINDOW_MS = 400 * DAY_MS;
/** Spiele nach dem Saisonende laut API (Nachholtermine, Relegation) noch mitnehmen. */
const SEASON_GRACE_MS = 14 * DAY_MS;
/** So weit zurück wird `elo_history` gespeichert - der Skill qualitative-tipps liest 730 Tage. */
export const HISTORY_KEEP_MS = 731 * DAY_MS;
/** Abstand der Wochenrunde. */
export const TOP_UP_INTERVAL_MS = 7 * DAY_MS;
/**
 * Sicherheitsabstand beim Import „seit dem letzten Mal": Eine Datei, die während des letzten
 * Imports geschrieben wurde, soll nicht durchrutschen. Doppelt gelesen schadet nicht - die
 * Tabelle nimmt jedes Spiel nur einmal auf.
 */
const IMPORT_OVERLAP_MS = 10 * 60 * 1000;

export type EloClient = Pick<ApiFootballClient, "getAllLeagues" | "getSeasonFixtures" | "requestCount">;

/**
 * Ein beendetes Spiel im kompakten Format, sonst `null`. Der Status wird ohne Rücksicht auf die
 * Schreibweise verglichen (Projektregel). Ein Anstoß nach `now` fällt heraus, auch mit Status
 * „FT“: Am 28.10.2026 stand Tunisia - Botswana (1545957) mit Anstoß 28.03.2027 als 2:2 im Bestand.
 */
export function toEloMatch(fixture: ApiFixture, leagueTypes: Map<number, string>, now = Date.now()): EloMatch | null {
  if (!FINISHED.has(String(fixture.fixture?.status?.short ?? "").toUpperCase())) return null;
  if (fixture.fixture.timestamp * 1000 > now) return null;
  const { home, away } = fixture.goals ?? {};
  if (typeof home !== "number" || typeof away !== "number") return null;
  return {
    fixtureId: fixture.fixture.id,
    kickoff: fixture.fixture.timestamp * 1000,
    leagueId: fixture.league.id,
    leagueName: fixture.league.name,
    leagueType: leagueTypes.get(fixture.league.id) ?? null,
    country: fixture.league.country,
    season: fixture.league.season,
    homeId: fixture.teams.home.id,
    homeName: fixture.teams.home.name,
    awayId: fixture.teams.away.id,
    awayName: fixture.teams.away.name,
    homeGoals: home,
    awayGoals: away
  };
}

/**
 * Sammelt abgeschlossene Spiele aus einer Cache-Antwort, gleich im kompakten Format. Dasselbe
 * Spiel liegt oft mehrfach im Cache, auch als früherer Stand vor dem Anpfiff - nur eine
 * abgeschlossene Kopie wird übernommen, und die ganze Antwort wird nicht festgehalten.
 */
export function collectMatches(value: unknown, types: Map<number, string>, into: Map<number, EloMatch>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectMatches(item, types, into);
    return;
  }
  const candidate = value as Partial<ApiFixture>;
  if (candidate.fixture && candidate.teams && candidate.league && candidate.goals && typeof candidate.fixture.id === "number") {
    const match = toEloMatch(candidate as ApiFixture, types);
    if (match) into.set(match.fixtureId, match);
    return;
  }
  for (const entry of Object.values(value)) if (entry && typeof entry === "object") collectMatches(entry, types, into);
}

export function leagueTypeMap(leagues: ApiLeague[]): Map<number, string> {
  return new Map(leagues.map((league) => [league.league.id, league.league.type]));
}

export interface CacheImportResult {
  files: number;
  read: number;
  unreadable: number;
  found: number;
  inserted: number;
}

/**
 * Übernimmt abgeschlossene Spiele aus dem Antwort-Cache. Mit `since` nur aus Dateien, die
 * seitdem geschrieben wurden - nach einer Analyse sind das rund 300 von fast 60.000.
 *
 * Direkt gelesen statt über `FileCache`: Ein beendetes Spiel veraltet nicht, der Zeitstempel
 * des Cache-Eintrags spielt keine Rolle (dieselbe Begründung wie in tools/backfill-results.ts).
 */
export function importFromCache(
  database: Pick<AnalyzerDatabase, "saveEloMatches">,
  types: Map<number, string>,
  options: { since?: number; directory?: string } = {}
): CacheImportResult {
  const directory = options.directory ?? CACHE_DIR;
  const collected = new Map<number, EloMatch>();
  const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
  let read = 0;
  let unreadable = 0;
  // Älteste Datei zuerst: Steht ein Spiel in mehreren Antworten, gilt der zuletzt geholte Stand -
  // seit 1.3.0 übernimmt `saveEloMatches` nachträgliche Korrekturen.
  const dated: Array<{ full: string; mtime: number }> = [];
  for (const file of files) {
    const full = path.join(directory, file);
    try {
      const mtime = statSync(full).mtimeMs;
      if (options.since === undefined || mtime >= options.since) dated.push({ full, mtime });
    } catch {
      unreadable += 1;
    }
  }
  dated.sort((left, right) => left.mtime - right.mtime);
  for (const { full } of dated) {
    try {
      read += 1;
      collectMatches((JSON.parse(readFileSync(full, "utf8")) as { value?: unknown }).value, types, collected);
    } catch {
      unreadable += 1;
    }
  }
  const matches = [...collected.values()];
  return { files: files.length, read, unreadable, found: matches.length, inserted: database.saveEloMatches(matches, "cache") };
}

/** Wettbewerbe, die Ligen und Verbände verbinden, zuerst - dann nach Menge im Bestand. */
function priorityOf(league: ApiLeague, counts: Map<number, number>): number {
  if (ELO_COMPETITIONS.national[league.league.id] || ELO_COMPETITIONS.club[league.league.id]) return 1e9;
  return counts.get(league.league.id) ?? 0;
}

export interface TopUpResult {
  /** Ligen, die in diesem Aufruf noch offen waren. */
  leagues: number;
  /** Ligen, die dieselbe Runde schon bei einer früheren Analyse geladen hatte. */
  alreadyDone: number;
  loaded: number;
  /** IDs der in diesem Aufruf geladenen Ligen - für die Fortsetzung einer unterbrochenen Runde. */
  loadedLeagues: number[];
  apiRequests: number;
  inserted: number;
  budgetReached: boolean;
}

/**
 * Die Saison, die laut Kalender von API-Football gerade läuft: begonnen und höchstens 14 Tage
 * über ihr Ende hinaus. Bei Überschneidungen die jüngste. `null` in der Sommer- oder Winterpause -
 * dort gibt es nichts zu holen, und `current` zeigte dann oft noch auf die beendete Saison.
 */
export function runningSeason(league: ApiLeague, now: number): ApiLeague["seasons"][number] | null {
  return league.seasons
    .filter((season) => Date.parse(season.start) <= now && Date.parse(season.end) + SEASON_GRACE_MS >= now)
    .sort((left, right) => Date.parse(right.start) - Date.parse(left.start))[0] ?? null;
}

/**
 * Die Wochenrunde: Für jede Liga, die im letzten Jahr im Bestand vorkam und deren Saison gerade
 * läuft, die laufende Saison frisch holen. So bleiben auch Teams aktuell, deren Ligen gerade in
 * keiner Analyse vorkommen - ohne das verlöre die Skala zwischen den Ligen ihren Anschluss.
 *
 * Bis Version 1.1.0 galt eine Liga nur als aktiv, wenn in den letzten 45 Tagen ein Spiel von ihr
 * im Bestand lag. Eine längere Pause warf sie heraus, und ihre neue Saison wurde nie wieder geladen:
 * Am 26.09.2026 fehlten so 49 Ligen, darunter Highland League, Regionalliga Mitte und Botola Pro
 * (im Vorjahr bis dahin 87, 64 und 16 Spiele, 2026 keines). Im Januar wären es 116 gewesen.
 *
 * `done` sind Ligen, die eine unterbrochene Runde schon geladen hat - sie werden übersprungen.
 */
export async function topUpRunningSeasons(
  client: EloClient,
  database: Pick<AnalyzerDatabase, "eloActiveLeagues" | "saveEloMatches">,
  leagues: ApiLeague[],
  types: Map<number, string>,
  options: { budget: number; now: number; done?: ReadonlySet<number> }
): Promise<TopUpResult> {
  const known = database.eloActiveLeagues(options.now - KNOWN_WINDOW_MS);
  const todo: Array<{ league: ApiLeague; season: number }> = [];
  let alreadyDone = 0;
  for (const league of leagues) {
    if (!known.has(league.league.id)) continue;
    // Jugend- und Frauen-Nationalteams erkennt `classifyMatch` erst an den Teamnamen - ihre
    // Wettbewerbe stehen deshalb ausdrücklich in der Liste.
    const category = ELO_NATIONAL_CATEGORY_COMPETITIONS[league.league.id] !== undefined;
    const cls = classifyMatch({ leagueId: league.league.id, leagueName: league.league.name, leagueType: league.league.type, country: league.country.name });
    if (cls.excluded && !category) continue;
    const running = runningSeason(league, options.now);
    if (!running) continue;
    if (options.done?.has(league.league.id)) {
      alreadyDone += 1;
      continue;
    }
    todo.push({ league, season: running.year });
  }
  todo.sort((left, right) => priorityOf(right.league, known) - priorityOf(left.league, known));

  const start = client.requestCount;
  const loadedLeagues: number[] = [];
  let inserted = 0;
  let budgetReached = false;
  for (const item of todo) {
    if (client.requestCount - start >= options.budget) {
      budgetReached = true;
      break;
    }
    // Laufende Saison: bewusst frisch, der Cache hielte sonst den Stand von gestern.
    const fixtures = await client.getSeasonFixtures(item.league.league.id, item.season);
    const matches = fixtures.map((fixture) => toEloMatch(fixture, types)).filter((match): match is EloMatch => match !== null);
    inserted += database.saveEloMatches(matches, "topup");
    loadedLeagues.push(item.league.league.id);
  }
  return {
    leagues: todo.length, alreadyDone, loaded: loadedLeagues.length, loadedLeagues,
    apiRequests: client.requestCount - start, inserted, budgetReached
  };
}

/** Fortschritt einer unterbrochenen Wochenrunde in `elo_meta` (`topUpDone`). */
interface TopUpProgress {
  startedAt: number;
  leagues: number[];
}

function readProgress(raw: string | null): TopUpProgress | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TopUpProgress>;
    return typeof parsed.startedAt === "number" && Array.isArray(parsed.leagues)
      ? { startedAt: parsed.startedAt, leagues: parsed.leagues.filter((id): id is number => typeof id === "number") }
      : null;
  } catch {
    return null;
  }
}

export interface RebuildResult {
  matches: number;
  used: number;
  teams: number;
  seconds: number;
}

/**
 * Prüfsumme aller Regeln, die das Elo bestimmen: Parameter (ohne die Versionsnummer selbst),
 * Wettbewerbslisten, Ausschlussmuster, Zusammenführungen, Reserve-Teams, Verbände. Ändert sich
 * eine davon, muss `ELO_CONFIG.version` steigen - das erzwingt `test/elo-version.test.ts`. Den
 * Rechenkern in `src/elo.ts` erfasst sie nicht; eine Änderung dort erhöht die Version von Hand.
 */
export function eloRulesFingerprint(): string {
  const { version: _version, ...config } = ELO_CONFIG;
  const rules = {
    config, competitions: ELO_COMPETITIONS, nationalCategories: ELO_NATIONAL_CATEGORY_COMPETITIONS,
    womenClubs: ELO_WOMEN_CLUB_COMPETITIONS, merges: ELO_TEAM_MERGES, seniorReserves: [...ELO_SENIOR_RESERVE_TEAMS].sort((a, b) => a - b),
    youth: ELO_YOUTH_PATTERN, excludeTeam: ELO_EXCLUDE_TEAM_PATTERN, exclude: ELO_EXCLUDE_PATTERN,
    confederations: CONFEDERATION_OF_COMPETITION
  };
  const text = JSON.stringify(rules, (_key, value: unknown) => value instanceof RegExp ? `${value.source}/${value.flags}` : value);
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/**
 * Stempel des letzten Aufbaus in `elo_meta` (`build`): Regelversion, Prüfsumme der Regeln,
 * Datenstand (Spiele, höchste Fixture-ID, jüngster Anstoß) und Stichtag. Damit ist jederzeit
 * zu sagen, aus welchem Stand ein angezeigtes Rating stammt (Davids Auftrag vom 28.10.2026, §6).
 */
export interface EloBuildStamp {
  version: string;
  rules: string;
  asOf: number;
  matches: number;
  used: number;
  maxFixtureId: number;
  latestKickoff: number;
}

/** Beide Systeme neu rechnen und Historie samt Rangliste ersetzen. Kein Aufruf. */
export function rebuildElo(
  database: Pick<AnalyzerDatabase, "eloMatches" | "replaceEloResults" | "setEloMeta">,
  now: number
): RebuildResult & { state: ReturnType<typeof calculateHistoricalElo> } {
  const started = Date.now();
  const matches = database.eloMatches();
  const state = calculateHistoricalElo(matches, ELO_CONFIG, { asOf: now });
  const ranking = summarizeElo(state);
  // Die Historie wird nur für `npm run elo -- team` und die qualitativen Tipps gelesen (730 Tage).
  // Bis 1.4.0 standen alle fünf Jahre darin: 684.000 Zeilen, rund 140 MB je Datenbank und
  // Sicherung, bei jeder Analyse neu geschrieben (Davids Entscheidung vom 28.10.2026).
  // Gerechnet wird weiter aus allen Spielen - gekürzt ist nur, was gespeichert wird.
  const historySince = now - HISTORY_KEEP_MS;
  const history = state.history.filter((row) => row.kickoff >= historySince);
  database.replaceEloResults(history, ranking, ELO_CONFIG.version, now, leagueLevels(state));
  let maxFixtureId = 0;
  let latestKickoff = 0;
  for (const match of matches) {
    if (match.kickoff >= now) continue;
    maxFixtureId = Math.max(maxFixtureId, match.fixtureId);
    latestKickoff = Math.max(latestKickoff, match.kickoff);
  }
  database.setEloMeta("build", JSON.stringify({
    version: ELO_CONFIG.version, rules: eloRulesFingerprint(), asOf: now, matches: matches.length,
    used: state.counts.used, maxFixtureId, latestKickoff
  } satisfies EloBuildStamp));
  return { matches: matches.length, used: state.counts.used, teams: ranking.length, seconds: (Date.now() - started) / 1000, state };
}

export interface AutoUpdateResult {
  imported: CacheImportResult;
  topUp: TopUpResult | null;
  /** Wann die nächste Wochenrunde fällig ist, falls diesmal keine lief. */
  nextTopUp: number | null;
  rebuilt: RebuildResult;
}

/**
 * Der Ablauf für den Dashboard-Lauf und `npm run elo -- update`:
 * 1. Import seit dem letzten Import (beim allerersten Mal alles),
 * 2. Wochenrunde, wenn die letzte älter als 7 Tage ist (`topUp` erzwingt oder verbietet sie),
 * 3. neu rechnen,
 * 4. Zeitpunkte merken - erst ganz am Ende, damit ein abgebrochener Lauf nichts überspringt.
 *
 * Eine Wochenrunde, die am Deckel hängen bleibt, **setzt fort**: Die schon geladenen Ligen stehen
 * in `topUpDone`, die nächste Analyse überspringt sie. Bis Version 1.1.0 begann sie von vorn -
 * weil laufende Saisons immer frisch geholt werden, zahlte sie dann für dieselben Ligen erneut
 * und erreichte das Ende der Liste nie. Ein Fortschritt, der älter als eine Woche ist, verfällt.
 */
export async function autoUpdateElo(
  client: EloClient,
  database: Pick<AnalyzerDatabase, "getEloMeta" | "setEloMeta" | "saveEloMatches" | "eloActiveLeagues" | "eloMatches" | "replaceEloResults">,
  options: { now?: number; topUpBudget: number; topUp?: boolean; directory?: string }
): Promise<AutoUpdateResult> {
  const now = options.now ?? Date.now();
  const leagues = await client.getAllLeagues();
  const types = leagueTypeMap(leagues);

  const lastImport = Number(database.getEloMeta("lastImport") ?? NaN);
  const imported = importFromCache(database, types, {
    since: Number.isFinite(lastImport) ? lastImport - IMPORT_OVERLAP_MS : undefined,
    directory: options.directory
  });

  const lastTopUp = Number(database.getEloMeta("lastTopUp") ?? NaN);
  const due = !Number.isFinite(lastTopUp) || now - lastTopUp >= TOP_UP_INTERVAL_MS;
  const runTopUp = options.topUp ?? due;
  const stored = readProgress(database.getEloMeta("topUpDone"));
  const progress = stored && (!Number.isFinite(lastTopUp) || stored.startedAt > lastTopUp)
    && now - stored.startedAt < TOP_UP_INTERVAL_MS ? stored : null;
  const topUp = runTopUp && options.topUpBudget > 0
    ? await topUpRunningSeasons(client, database, leagues, types, {
      budget: options.topUpBudget, now, done: new Set(progress?.leagues ?? [])
    })
    : null;

  const rebuilt = rebuildElo(database, now);

  database.setEloMeta("lastImport", String(now));
  // Eine Wochenrunde, die am Budget hängen blieb, gilt nicht als erledigt: Die nächste Analyse
  // macht dort weiter, statt eine Woche mit halbem Stand zu leben.
  if (topUp?.budgetReached) {
    database.setEloMeta("topUpDone", JSON.stringify({
      startedAt: progress?.startedAt ?? now, leagues: [...(progress?.leagues ?? []), ...topUp.loadedLeagues]
    } satisfies TopUpProgress));
  } else if (topUp) {
    database.setEloMeta("lastTopUp", String(now));
    database.setEloMeta("topUpDone", "");
  }
  const nextTopUp = topUp ? null : Number.isFinite(lastTopUp) ? lastTopUp + TOP_UP_INTERVAL_MS : now;
  const { state: _state, ...summary } = rebuilt;
  return { imported, topUp, nextTopUp, rebuilt: summary };
}
