import { readFile, writeFile } from "node:fs/promises";
import { TEAM_ALIASES_FILE } from "./config.ts";
import type { ApiFixture } from "./types.ts";
import { normalizeText, similarity } from "./util.ts";

export interface TeamAliasValue {
  tipicoName: string;
  apiTeamId: number;
  apiTeamName: string;
  /** Nur in diesem API-Wettbewerb gültig; Schlüssel dann „<name>@<leagueId>“. */
  leagueId?: number;
}

export type TeamAliasMap = Record<string, TeamAliasValue>;

const writeQueues = new Map<string, Promise<void>>();

/**
 * Tipico führt manche Namen für zwei Vereine (San Antonio FC: USL 4017 und Ecuador 23310). Ein
 * Alias je Name sprang deshalb mit jeder Analyse zwischen beiden hin und her (21. und
 * 23.10.2026). Ein Alias mit `leagueId` gilt nur in diesem Wettbewerb und geht dem allgemeinen vor.
 */
export function teamAliasKey(name: string, leagueId?: number): string {
  const key = normalizeText(name);
  return leagueId === undefined ? key : `${key}@${leagueId}`;
}

export function teamAliasFor(
  aliases: TeamAliasMap,
  name: string,
  leagueId?: number
): TeamAliasValue | undefined {
  return (leagueId === undefined ? undefined : aliases[teamAliasKey(name, leagueId)]) ??
    aliases[teamAliasKey(name)];
}

/** Alle Aliase eines Namens, der allgemeine und die je Wettbewerb. */
export function teamAliasesFor(aliases: TeamAliasMap, name: string): TeamAliasValue[] {
  const key = teamAliasKey(name);
  return Object.entries(aliases)
    .filter(([entryKey]) => entryKey === key || entryKey.startsWith(`${key}@`))
    .map(([, alias]) => alias);
}

function compactTeamName(value: string): string {
  return normalizeText(value)
    .replace(/\b(fc|cf|ac|sc|afc|fk|sk|bk|if|club|calcio|city|united|deportivo|sporting)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function teamNameSimilarity(left: string, right: string): number {
  const a = compactTeamName(left);
  const b = compactTeamName(right);
  if (a === b && a.length > 0) return 1;
  if (!a || !b) return similarity(left, right);
  let prior = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(
        next[j - 1]! + 1,
        prior[j]! + 1,
        prior[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prior = next;
  }
  const editScore = 1 - prior[b.length]! / Math.max(a.length, b.length);
  const containsScore = a.includes(b) || b.includes(a) ? 0.88 : 0;
  return Math.max(similarity(left, right), editScore, containsScore);
}

export async function readTeamAliases(file = TEAM_ALIASES_FILE): Promise<TeamAliasMap> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as TeamAliasMap;
  } catch {
    return {};
  }
}

export async function saveTeamAlias(
  tipicoName: string,
  apiTeam: { id: number; name: string },
  file = TEAM_ALIASES_FILE,
  leagueId?: number
): Promise<void> {
  await saveTeamAliases([{ tipicoName, apiTeam, ...(leagueId === undefined ? {} : { leagueId }) }], file);
}

export async function saveTeamAliases(
  entries: Array<{ tipicoName: string; apiTeam: { id: number; name: string }; leagueId?: number }>,
  file = TEAM_ALIASES_FILE
): Promise<void> {
  for (const { tipicoName, apiTeam, leagueId } of entries) {
    if (!teamAliasKey(tipicoName)) throw new Error("Der Tipico-Teamname darf nicht leer sein.");
    if (!Number.isInteger(apiTeam.id) || apiTeam.id <= 0 || !apiTeam.name.trim()) {
      throw new Error("API-Team-ID und API-Teamname sind erforderlich.");
    }
    if (leagueId !== undefined && (!Number.isInteger(leagueId) || leagueId <= 0)) {
      throw new Error("Die API-Liga-ID muss eine positive ganze Zahl sein.");
    }
  }
  const queued = (writeQueues.get(file) ?? Promise.resolve()).then(async () => {
    const aliases = await readTeamAliases(file);
    for (const { tipicoName, apiTeam, leagueId } of entries) {
      aliases[teamAliasKey(tipicoName, leagueId)] = {
        tipicoName: tipicoName.trim(),
        apiTeamId: apiTeam.id,
        apiTeamName: apiTeam.name.trim(),
        ...(leagueId === undefined ? {} : { leagueId })
      };
    }
    const sorted = Object.fromEntries(
      Object.entries(aliases).sort(([left], [right]) => left.localeCompare(right))
    );
    await writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  });
  writeQueues.set(file, queued.catch(() => undefined));
  await queued;
}

/**
 * Merkt sich eine Zuordnung, die über die Namensähnlichkeit gefunden wurde. Zeigt der Name schon
 * auf ein anderes Team, gilt die neue Zuordnung nur in diesem Wettbewerb - der bestehende Alias
 * bleibt, statt bei jeder Analyse umzuspringen.
 */
export async function learnTeamAlias(
  aliases: TeamAliasMap,
  tipicoName: string,
  apiTeam: { id: number; name: string },
  leagueId: number,
  file = TEAM_ALIASES_FILE
): Promise<void> {
  if (normalizeText(tipicoName) === normalizeText(apiTeam.name)) return;
  const current = teamAliasFor(aliases, tipicoName, leagueId);
  const scope = current && current.apiTeamId !== apiTeam.id ? leagueId : current?.leagueId;
  await saveTeamAlias(tipicoName, apiTeam, file, scope);
  aliases[teamAliasKey(tipicoName, scope)] = {
    tipicoName,
    apiTeamId: apiTeam.id,
    apiTeamName: apiTeam.name,
    ...(scope === undefined ? {} : { leagueId: scope })
  };
}

export function teamNameMatches(
  requestedName: string,
  apiTeam: { id: number; name: string },
  aliases: TeamAliasMap,
  leagueId?: number
): boolean {
  if (normalizeText(requestedName) === normalizeText(apiTeam.name)) return true;
  return teamAliasFor(aliases, requestedName, leagueId)?.apiTeamId === apiTeam.id;
}

export function fixtureMatchesTeamAliases(
  homeTeam: string,
  awayTeam: string,
  fixture: ApiFixture,
  aliases: TeamAliasMap
): boolean {
  return teamNameMatches(homeTeam, fixture.teams.home, aliases, fixture.league.id) &&
    teamNameMatches(awayTeam, fixture.teams.away, aliases, fixture.league.id);
}
