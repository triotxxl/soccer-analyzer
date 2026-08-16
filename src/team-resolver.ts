import { readFile, writeFile } from "node:fs/promises";
import { TEAM_ALIASES_FILE } from "./config.ts";
import type { ApiFixture } from "./types.ts";
import { normalizeText, similarity } from "./util.ts";

export interface TeamAliasValue {
  tipicoName: string;
  apiTeamId: number;
  apiTeamName: string;
}

export type TeamAliasMap = Record<string, TeamAliasValue>;

const writeQueues = new Map<string, Promise<void>>();

export function teamAliasKey(name: string): string {
  return normalizeText(name);
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
  file = TEAM_ALIASES_FILE
): Promise<void> {
  await saveTeamAliases([{ tipicoName, apiTeam }], file);
}

export async function saveTeamAliases(
  entries: Array<{ tipicoName: string; apiTeam: { id: number; name: string } }>,
  file = TEAM_ALIASES_FILE
): Promise<void> {
  for (const { tipicoName, apiTeam } of entries) {
    if (!teamAliasKey(tipicoName)) throw new Error("Der Tipico-Teamname darf nicht leer sein.");
    if (!Number.isInteger(apiTeam.id) || apiTeam.id <= 0 || !apiTeam.name.trim()) {
      throw new Error("API-Team-ID und API-Teamname sind erforderlich.");
    }
  }
  const queued = (writeQueues.get(file) ?? Promise.resolve()).then(async () => {
    const aliases = await readTeamAliases(file);
    for (const { tipicoName, apiTeam } of entries) {
      aliases[teamAliasKey(tipicoName)] = {
        tipicoName: tipicoName.trim(),
        apiTeamId: apiTeam.id,
        apiTeamName: apiTeam.name.trim()
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

export function teamNameMatches(
  requestedName: string,
  apiTeam: { id: number; name: string },
  aliases: TeamAliasMap
): boolean {
  if (normalizeText(requestedName) === normalizeText(apiTeam.name)) return true;
  return aliases[teamAliasKey(requestedName)]?.apiTeamId === apiTeam.id;
}

export function fixtureMatchesTeamAliases(
  homeTeam: string,
  awayTeam: string,
  fixture: ApiFixture,
  aliases: TeamAliasMap
): boolean {
  return teamNameMatches(homeTeam, fixture.teams.home, aliases) &&
    teamNameMatches(awayTeam, fixture.teams.away, aliases);
}
