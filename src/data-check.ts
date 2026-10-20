import { config } from "./config.ts";
import type { EloMatch } from "./elo-competitions.ts";
import { ELO_EXCLUDE_TEAM_PATTERN, type EloTeamMerge } from "./elo-config.ts";
import { mergeTeams } from "./elo.ts";
import { teamNameSimilarity } from "./team-resolver.ts";

/**
 * Datenintegrität für Elo, Ligastärke, Zuordnung und Abrechnung - Fehler, die still verlaufen: Die
 * Analyse läuft durch, rechnet aber mit falschen oder fehlenden Daten. Rein: `tools/data-check.ts`
 * reicht Snapshot und SQLite herein, kein API-Aufruf. Jede Regel stammt aus einem echten Fund:
 *
 * - **Zuordnung** (`mappingIssues`): „National League Nord/Süd“ zeigte auf die eingleisige fünfte
 *   Liga, keine der 22 Partien kam an, und nichts warnte (07.09.2026). Ein Wettbewerb, dessen
 *   Tipico-Spiele fast alle ohne API-Gegenstück blieben, obwohl die API-Liga im selben Zeitraum
 *   spielte, trägt fast immer einen falschen Alias oder fehlende Team-Aliase.
 * - **Geteilte Team-ID** (`sharedTeamIds`): API-Football führte Kenya Police ab Ende 2021 unter
 *   8560, die zugleich Police aus Burkina Faso trägt (20.10.2026). Beweis ist ein Tag mit zwei
 *   Pflichtspielen gegen verschiedene Gegner - das kann eine Mannschaft nicht. Testspiele zählen
 *   nicht: In der Vorbereitung spielen Vereine oft mit zwei Teams am selben Tag.
 * - **Abgerissene Geschichte** (`staleTeams`): Ein Team der Analyse, dessen letztes Spiel im Bestand
 *   über ein Jahr zurückliegt, hat meist eine zweite ID (Kenya Police: Elo-Vertrauen 0 %).
 * - **Elo-Saisonlücken** (`eloSeasonGaps`): Die 80-%-Abkürzung in `tools/elo.ts` verglich am
 *   24.09.2026 mit der vollsten Saison im Cache, bevor eine geladen war; so galten Saisons mit 30
 *   von 300 Spielen als vollständig.
 * - **Ligastärke geschätzt** (`strengthGaps`): Bei Etar fehlten 24 von 31 Duellen (19.10.2026).
 *   Die Regel zeigt, wie weit eine geschätzte Liga von der Belastbarkeit entfernt ist.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Fenster des Elo (5 Jahre) - ältere Spiele zählen nicht, ihre Fehler auch nicht. */
export const DATA_CHECK_WINDOW_MS = 5 * 365.25 * DAY_MS;
/** Ab hier gilt eine Zuordnung als verdächtig: weniger als die Hälfte der Spiele angekommen. */
const MAPPING_MIN_EVENTS = 3;
const MAPPING_MAX_SHARE = 0.5;
/** Ein Doppel-Spieltag kann ein Datenfehler der API sein, zwei sind ein Muster. */
const SHARED_MIN_DAYS = 2;

/**
 * Geteilte IDs, die sich mit `ELO_TEAM_MERGES` nicht trennen lassen: Beide Mannschaften spielen im
 * selben Wettbewerb, oder es sind doppelt geführte Spiele der API. Nachgeprüft am 20.10.2026.
 */
export const KNOWN_SHARED_IDS: Array<{ teamId: number; note: string }> = [
  { teamId: 9064, note: "Wichita: zwei Teams in der USL League Two 2022/23" },
  { teamId: 4057, note: "Kaw Valley: zwei Teams in der USL League Two 2022" },
  { teamId: 8431, note: "BX Brussels: zwei Pokalspiele je Tag 2023, doppelt geführt" },
  { teamId: 2056, note: "Aserri FC: Liga de Ascenso 2026 mit zwei Spielen je Tag, Copa Costa Rica 2025 ebenso" }
];
/** So lange darf das letzte Spiel eines Teams der Analyse zurückliegen, ohne aufzufallen. */
const STALE_AFTER_MS = 365 * DAY_MS;
/** Kandidaten für die zweite ID: aktiv in diesem Zeitraum, Name mindestens so ähnlich. */
const CANDIDATE_ACTIVE_MS = 400 * DAY_MS;
const CANDIDATE_MIN_SIMILARITY = 0.5;
/** Eine Saison gilt als lückenhaft unter diesem Anteil des Medians der übrigen Saisons der Liga. */
const SEASON_MIN_SHARE = 0.6;
const SEASON_MIN_MEDIAN = 40;

/**
 * Saisons, die wirklich kurz waren - nachgeprüft, nicht vermutet. Eine Saison, die nach dem
 * Nachladen weiter kurz ist, gehört mit Grund hierher, sonst meldet die Prüfung sie bei jedem Lauf.
 */
export const KNOWN_SHORT_SEASONS: Array<{ leagueId: number; season: number; note: string }> = [
  { leagueId: 333, season: 2021, note: "Ukraine Premier League 2021/22, im Februar 2022 wegen des Kriegs abgebrochen" }
];

export const isFriendly = (match: Pick<EloMatch, "leagueName">) => /friendlies/i.test(match.leagueName);

// ---------------------------------------------------------------- Zuordnung

export interface TipicoCompetitionStats {
  country: string;
  competition: string;
  apiLeagueId: number | null;
  apiLeagueName: string | null;
  events: number;
  matched: number;
  /** Anstoß des ersten und letzten Spiels in ms. */
  first: number;
  last: number;
}

export interface MappingIssue {
  competition: string;
  apiLeague: string | null;
  events: number;
  matched: number;
  /** Beendete Spiele der API-Liga im selben Zeitraum; null ohne API-Liga. */
  apiMatches: number | null;
  verdict: "falscheLigaOderTeams" | "apiOhneSpiele" | "ohneLiga";
  cause: string;
  action: string;
}

export function mappingIssues(
  stats: TipicoCompetitionStats[],
  apiMatchesBetween: (leagueId: number, from: number, to: number) => number
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  for (const item of stats) {
    if (item.events < MAPPING_MIN_EVENTS || item.matched / item.events >= MAPPING_MAX_SHARE) continue;
    const base = {
      competition: `${item.country} | ${item.competition}`,
      apiLeague: item.apiLeagueId === null ? null : `${item.apiLeagueName ?? "?"} (${item.apiLeagueId})`,
      events: item.events,
      matched: item.matched
    };
    if (item.apiLeagueId === null) {
      issues.push({
        ...base, apiMatches: null, verdict: "ohneLiga",
        cause: "keine API-Liga zugeordnet",
        action: "in getAllLeagues prüfen, ob API-Football den Wettbewerb inzwischen führt; sonst bleibt er draußen"
      });
      continue;
    }
    // Einen Tag Rand: Tipico-Anstoß und API-Anstoß liegen nicht immer am selben Kalendertag.
    const apiMatches = apiMatchesBetween(item.apiLeagueId, item.first - DAY_MS, item.last + DAY_MS);
    issues.push(apiMatches > 0
      ? {
        ...base, apiMatches, verdict: "falscheLigaOderTeams",
        cause: `die API-Liga hatte im selben Zeitraum ${apiMatches} beendete Spiele, angekommen sind ${item.matched} von ${item.events}`,
        action: "Teams beider Seiten vergleichen: andere Teams = falscher Liga-Alias (npm run aliases), gleiche Teams = Team-Aliase (npm run team-aliases)"
      }
      : {
        ...base, apiMatches, verdict: "apiOhneSpiele",
        cause: "die API-Liga hatte im selben Zeitraum keine beendeten Spiele",
        action: "API-Football führt die Spiele nicht oder der Alias zeigt auf eine ruhende Liga - in getAllLeagues gegenprüfen"
      });
  }
  const order = { falscheLigaOderTeams: 0, apiOhneSpiele: 1, ohneLiga: 2 };
  return issues.sort((left, right) => order[left.verdict] - order[right.verdict] || right.events - left.events);
}

// ---------------------------------------------------------------- Team-IDs

export interface SharedTeamId {
  teamId: number;
  name: string;
  /** Tage mit zwei Pflichtspielen gegen verschiedene Gegner. */
  days: number;
  countries: string[];
  competitions: string[];
  example: string;
  inAnalysis: boolean;
}

export function sharedTeamIds(
  matches: EloMatch[],
  merges: EloTeamMerge[],
  analysisTeamIds: Set<number>
): SharedTeamId[] {
  const byTeamDay = new Map<string, EloMatch[]>();
  for (const raw of matches) {
    if (isFriendly(raw)) continue;
    const match = mergeTeams(raw, merges);
    const day = new Date(match.kickoff).toISOString().slice(0, 10);
    for (const id of [match.homeId, match.awayId]) {
      const key = `${id}|${day}`;
      const list = byTeamDay.get(key);
      if (list) list.push(match); else byTeamDay.set(key, [match]);
    }
  }
  const teams = new Map<number, SharedTeamId>();
  for (const [key, list] of byTeamDay) {
    if (list.length < 2) continue;
    const [idText, day] = key.split("|");
    const id = Number(idText);
    const opponent = (match: EloMatch) => (match.homeId === id ? match.awayId : match.homeId);
    if (new Set(list.map(opponent)).size < 2) continue;
    const nameOf = (match: EloMatch) => (match.homeId === id ? match.homeName : match.awayName);
    // Jugend- und Frauenteams: Dort ist es ein falsches Datum der API, keine geteilte ID (alle
    // U19-Teams der EM-Qualifikation am 25.03.2026 mit zwei Gegnern am selben Tag).
    if (ELO_EXCLUDE_TEAM_PATTERN.test(nameOf(list[0]))) continue;
    const entry = teams.get(id) ?? {
      teamId: id, name: nameOf(list[0]), days: 0, countries: [], competitions: [],
      example: `${day}: ` + list.map((match) =>
        `${match.leagueName} (${match.country}) gegen ${match.homeId === id ? match.awayName : match.homeName}`).join(" / "),
      inAnalysis: analysisTeamIds.has(id)
    };
    entry.days += 1;
    for (const match of list) {
      if (!entry.countries.includes(match.country)) entry.countries.push(match.country);
      if (!entry.competitions.includes(match.leagueName)) entry.competitions.push(match.leagueName);
    }
    teams.set(id, entry);
  }
  return [...teams.values()]
    .filter((team) => team.days >= SHARED_MIN_DAYS && !KNOWN_SHARED_IDS.some((known) => known.teamId === team.teamId))
    .sort((left, right) => Number(right.inAnalysis) - Number(left.inAnalysis) || right.days - left.days);
}

export interface StaleTeam {
  fixture: string;
  teamId: number;
  name: string;
  lastPlayed: number;
  /** Andere IDs desselben Landes mit ähnlichem Namen, aktiv und ohne gemeinsamen Spieltag. */
  candidates: Array<{ teamId: number; name: string; lastPlayed: number; matches: number; similarity: number }>;
}

export function staleTeams(
  analysisTeams: Array<{ fixture: string; teamId: number; name: string }>,
  matches: EloMatch[],
  merges: EloTeamMerge[],
  now: number
): StaleTeam[] {
  interface Seen { name: string; last: number; matches: number; countries: Set<string>; days: Set<string> }
  const teams = new Map<number, Seen>();
  for (const raw of matches) {
    const match = mergeTeams(raw, merges);
    const day = new Date(match.kickoff).toISOString().slice(0, 10);
    for (const [id, name] of [[match.homeId, match.homeName], [match.awayId, match.awayName]] as const) {
      const seen = teams.get(id) ?? { name, last: 0, matches: 0, countries: new Set(), days: new Set() };
      seen.matches += 1;
      if (match.kickoff >= seen.last) { seen.last = match.kickoff; seen.name = name; }
      if (match.country !== "World") seen.countries.add(match.country);
      seen.days.add(day);
      teams.set(id, seen);
    }
  }
  const result: StaleTeam[] = [];
  const done = new Set<number>();
  for (const team of analysisTeams) {
    const seen = teams.get(team.teamId);
    // Ganz ohne Spiele meldet `npm run coverage` („Ohne Elo“); hier geht es um abgerissene Geschichte.
    if (!seen || now - seen.last <= STALE_AFTER_MS || done.has(team.teamId)) continue;
    done.add(team.teamId);
    const candidates: StaleTeam["candidates"] = [];
    for (const [id, other] of teams) {
      if (id === team.teamId || now - other.last > CANDIDATE_ACTIVE_MS) continue;
      if (![...other.countries].some((country) => seen.countries.has(country))) continue;
      const similarity = Math.max(teamNameSimilarity(team.name, other.name), teamNameSimilarity(seen.name, other.name));
      if (similarity < CANDIDATE_MIN_SIMILARITY) continue;
      if ([...seen.days].some((day) => other.days.has(day))) continue;
      candidates.push({ teamId: id, name: other.name, lastPlayed: other.last, matches: other.matches, similarity });
    }
    candidates.sort((left, right) => right.similarity - left.similarity || right.matches - left.matches);
    result.push({ fixture: team.fixture, teamId: team.teamId, name: team.name, lastPlayed: seen.last, candidates: candidates.slice(0, 3) });
  }
  return result;
}

// ---------------------------------------------------------------- Elo-Saisons

export interface LeagueSeasonCount {
  leagueId: number;
  leagueName: string;
  leagueType: string | null;
  country: string;
  season: number;
  matches: number;
  /** Zeitpunkt der Markierung „vollständig“ in `elo_league_seasons` (ms); null = nicht markiert. */
  markedAt: number | null;
}

/**
 * Ab hier markiert `tools/elo.ts` nur noch nach vollständigem Laden (80-%-Abkürzung entfernt, offene
 * Ansetzungen halten die Saison offen). Was danach noch kurz ist, ist bei API-Football kurz.
 */
export const ELO_FULL_LOAD_SINCE = Date.parse("2026-10-20T00:00:00Z");

export interface EloSeasonGap {
  leagueId: number;
  league: string;
  season: number;
  matches: number;
  usual: number;
  inAnalysis: boolean;
}

/**
 * Vor `ELO_FULL_LOAD_SINCE` als vollständig markierte Ligasaisons mit deutlich weniger Spielen als
 * üblich. Nur Ligen: Pokale und Testspiele schwanken von Jahr zu Jahr.
 */
export function eloSeasonGaps(counts: LeagueSeasonCount[], analysisLeagueIds: Set<number>, minSeason: number): EloSeasonGap[] {
  const byLeague = new Map<number, LeagueSeasonCount[]>();
  for (const row of counts) {
    if (row.leagueType !== "League" || row.country === "World") continue;
    const list = byLeague.get(row.leagueId);
    if (list) list.push(row); else byLeague.set(row.leagueId, [row]);
  }
  const gaps: EloSeasonGap[] = [];
  for (const [leagueId, list] of byLeague) {
    for (const row of list) {
      if (row.markedAt === null || row.markedAt >= ELO_FULL_LOAD_SINCE || row.season < minSeason) continue;
      if (KNOWN_SHORT_SEASONS.some((known) => known.leagueId === leagueId && known.season === row.season)) continue;
      const others = list.filter((other) => other.season !== row.season && other.season >= minSeason - 2)
        .map((other) => other.matches).sort((left, right) => left - right);
      if (others.length < 2) continue;
      const usual = others[Math.floor(others.length / 2)];
      if (usual < SEASON_MIN_MEDIAN || row.matches >= SEASON_MIN_SHARE * usual) continue;
      gaps.push({
        leagueId, league: `${row.country} | ${row.leagueName}`, season: row.season,
        matches: row.matches, usual, inAnalysis: analysisLeagueIds.has(leagueId)
      });
    }
  }
  return gaps.sort((left, right) =>
    Number(right.inAnalysis) - Number(left.inAnalysis) || (right.usual - right.matches) - (left.usual - left.matches));
}

// ---------------------------------------------------------------- Ligastärke

export interface StrengthGap {
  fixture: string;
  team: string;
  leagueId: number;
  /** Stand der Liga im Pool, aus dem sie bewertet wurde; null ohne eigenen Stand. */
  matches: number | null;
  clubs: number | null;
  minClubs: number;
}

export function strengthGaps(
  fixtures: Array<{ fixture: string; homeTeam: string; awayTeam: string; home: { leagueId: number; reliable: boolean }; away: { leagueId: number; reliable: boolean } }>,
  snapshotOf: (leagueId: number) => { matches: number; clubs: number; women: boolean } | null
): StrengthGap[] {
  const gaps: StrengthGap[] = [];
  for (const item of fixtures) {
    for (const [side, team] of [[item.home, item.homeTeam], [item.away, item.awayTeam]] as const) {
      if (side.reliable) continue;
      const snapshot = snapshotOf(side.leagueId);
      gaps.push({
        fixture: item.fixture, team, leagueId: side.leagueId,
        matches: snapshot?.matches ?? null, clubs: snapshot?.clubs ?? null,
        minClubs: snapshot?.women ? config.strength.reliableMinClubsWomen : config.strength.reliableMinClubs
      });
    }
  }
  return gaps;
}
