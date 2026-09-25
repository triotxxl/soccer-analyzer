import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ApiFootballClient } from "./api.ts";
import { CACHE_DIR } from "./config.ts";
import type { AnalyzerDatabase } from "./database.ts";
import { classifyMatch, type EloMatch } from "./elo-competitions.ts";
import { ELO_COMPETITIONS, ELO_CONFIG } from "./elo-config.ts";
import { calculateHistoricalElo, summarizeElo } from "./elo.ts";
import type { ApiFixture, ApiLeague } from "./types.ts";

/**
 * Pflege des Team-Elo: Spiele aus dem Cache übernehmen, laufende Saisons nachholen, neu
 * rechnen. Dashboard-Lauf (`src/cli.ts`) und Befehle (`tools/elo.ts`) nutzen diese eine Fassung.
 *
 * Kosten: Der Import aus dem Cache und das Neurechnen kosten keinen Aufruf. Nur die
 * Wochenrunde (`topUpRunningSeasons`) fragt API-Football, je aktiver Liga einmal - gemessen
 * am 24.09.2026 rund 530 Aufrufe.
 */

const FINISHED = new Set(["FT", "AET", "PEN"]);
const DAY_MS = 24 * 60 * 60 * 1000;
/** Wie lange eine Liga ohne Spiel noch als aktiv gilt. */
const ACTIVE_WINDOW_MS = 45 * DAY_MS;
/** Abstand der Wochenrunde. */
export const TOP_UP_INTERVAL_MS = 7 * DAY_MS;
/**
 * Sicherheitsabstand beim Import „seit dem letzten Mal": Eine Datei, die während des letzten
 * Imports geschrieben wurde, soll nicht durchrutschen. Doppelt gelesen schadet nicht - die
 * Tabelle nimmt jedes Spiel nur einmal auf.
 */
const IMPORT_OVERLAP_MS = 10 * 60 * 1000;

export type EloClient = Pick<ApiFootballClient, "getAllLeagues" | "getSeasonFixtures" | "requestCount">;

export function toEloMatch(fixture: ApiFixture, leagueTypes: Map<number, string>): EloMatch | null {
  if (!FINISHED.has(fixture.fixture?.status?.short)) return null;
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
  for (const file of files) {
    const full = path.join(directory, file);
    try {
      if (options.since !== undefined && statSync(full).mtimeMs < options.since) continue;
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
  leagues: number;
  loaded: number;
  apiRequests: number;
  inserted: number;
  budgetReached: boolean;
}

/**
 * Die Wochenrunde: Für jede Liga mit Spielen in den letzten 45 Tagen die laufende Saison frisch
 * holen. So bleiben auch Teams aktuell, deren Ligen gerade in keiner Analyse vorkommen - ohne
 * das verlöre die Skala zwischen den Ligen ihren Anschluss.
 */
export async function topUpRunningSeasons(
  client: EloClient,
  database: Pick<AnalyzerDatabase, "eloActiveLeagues" | "saveEloMatches">,
  leagues: ApiLeague[],
  types: Map<number, string>,
  options: { budget: number; now: number }
): Promise<TopUpResult> {
  const active = database.eloActiveLeagues(options.now - ACTIVE_WINDOW_MS);
  const todo: Array<{ league: ApiLeague; season: number }> = [];
  for (const league of leagues) {
    if (!active.has(league.league.id)) continue;
    const cls = classifyMatch({ leagueId: league.league.id, leagueName: league.league.name, leagueType: league.league.type, country: league.country.name });
    if (cls.excluded) continue;
    const running = league.seasons.find((season) => season.current)
      ?? league.seasons.find((season) => Date.parse(season.start) <= options.now && Date.parse(season.end) >= options.now - ACTIVE_WINDOW_MS);
    if (running) todo.push({ league, season: running.year });
  }
  todo.sort((left, right) => priorityOf(right.league, active) - priorityOf(left.league, active));

  const start = client.requestCount;
  let loaded = 0;
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
    loaded += 1;
  }
  return { leagues: todo.length, loaded, apiRequests: client.requestCount - start, inserted, budgetReached };
}

export interface RebuildResult {
  matches: number;
  used: number;
  teams: number;
  seconds: number;
}

/** Beide Systeme neu rechnen und Historie samt Rangliste ersetzen. Kein Aufruf. */
export function rebuildElo(
  database: Pick<AnalyzerDatabase, "eloMatches" | "replaceEloResults">,
  now: number
): RebuildResult & { state: ReturnType<typeof calculateHistoricalElo> } {
  const started = Date.now();
  const matches = database.eloMatches();
  const state = calculateHistoricalElo(matches, ELO_CONFIG, { asOf: now });
  const ranking = summarizeElo(state);
  database.replaceEloResults(state.history, ranking, ELO_CONFIG.version, now);
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
  const topUp = runTopUp && options.topUpBudget > 0
    ? await topUpRunningSeasons(client, database, leagues, types, { budget: options.topUpBudget, now })
    : null;

  const rebuilt = rebuildElo(database, now);

  database.setEloMeta("lastImport", String(now));
  // Eine Wochenrunde, die am Budget hängen blieb, gilt nicht als erledigt: Die nächste Analyse
  // macht weiter, statt eine Woche mit halbem Stand zu leben.
  if (topUp && !topUp.budgetReached) database.setEloMeta("lastTopUp", String(now));
  const nextTopUp = topUp ? null : Number.isFinite(lastTopUp) ? lastTopUp + TOP_UP_INTERVAL_MS : now;
  const { state: _state, ...summary } = rebuilt;
  return { imported, topUp, nextTopUp, rebuilt: summary };
}
