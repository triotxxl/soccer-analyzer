import { readFile, writeFile } from "node:fs/promises";
import { ALIASES_FILE } from "./config.ts";
import type {
  ApiLeague,
  LeagueSelection,
  ResolutionFailure,
  ResolvedLeague
} from "./types.ts";
import { aliasKey, normalizeCountry, normalizeText, similarity } from "./util.ts";

interface AliasValue {
  leagueId: number;
  country: string;
  league: string;
}

type AliasMap = Record<string, AliasValue>;
let aliasWriteQueue: Promise<void> = Promise.resolve();

async function readAliases(): Promise<AliasMap> {
  try {
    return JSON.parse(await readFile(ALIASES_FILE, "utf8")) as AliasMap;
  } catch {
    return {};
  }
}

export function saveAlias(selection: LeagueSelection, value: AliasValue): Promise<void> {
  const write = aliasWriteQueue.then(async () => {
    const aliases = await readAliases();
    aliases[aliasKey(selection.country, selection.league)] = value;
    const sorted = Object.fromEntries(
      Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b))
    );
    await writeFile(ALIASES_FILE, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  });
  aliasWriteQueue = write.catch(() => undefined);
  return write;
}

export async function resolveLeagues(
  selections: LeagueSelection[],
  leagues: ApiLeague[]
): Promise<{ resolved: ResolvedLeague[]; failures: ResolutionFailure[] }> {
  const aliases = await readAliases();
  const resolved: ResolvedLeague[] = [];
  const failures: ResolutionFailure[] = [];

  for (const requested of selections) {
    // Spiele aus den Quoten von API-Football tragen ihre Liga-ID schon mit. Sie gilt vor jedem Alias
    // und nie als Fehler: Fehlt sie in der Ligaliste (nur laufende Saisons, 7 Tage gespeichert),
    // gelten die Namen der Quotenantwort und keine Saisons - `previousSeason` und
    // `usesCrossLeagueModel` im Analyzer kommen ohne sie aus. Sonst bräche eine einzige unbekannte
    // Liga mit Exitcode 2 die ganze Analyse ab.
    if (requested.apiLeagueId !== undefined) {
      const match = leagues.find((item) => item.league.id === requested.apiLeagueId);
      if (!match) {
        console.warn(`Liga ${requested.country} | ${requested.league} (${requested.apiLeagueId}) fehlt in der Ligaliste von API-Football - ohne Saisonangaben weiter.`);
      }
      resolved.push({
        requested,
        leagueId: requested.apiLeagueId,
        country: match?.country.name ?? requested.country,
        league: match?.league.name ?? requested.league,
        seasons: match?.seasons ?? [],
        source: "id"
      });
      continue;
    }
    const stored = aliases[aliasKey(requested.country, requested.league)];
    if (stored) {
      const match = leagues.find((item) => item.league.id === stored.leagueId);
      if (match) {
        resolved.push({
          requested,
          leagueId: match.league.id,
          country: match.country.name,
          league: match.league.name,
          seasons: match.seasons,
          source: "alias"
        });
        continue;
      }
    }

    const country = normalizeCountry(requested.country);
    const inCountry = leagues.filter(
      (item) => normalizeCountry(item.country.name) === country
    );
    const exact = inCountry.find(
      (item) => normalizeText(item.league.name) === normalizeText(requested.league)
    );
    if (exact) {
      resolved.push({
        requested,
        leagueId: exact.league.id,
        country: exact.country.name,
        league: exact.league.name,
        seasons: exact.seasons,
        source: "exact"
      });
      continue;
    }

    const candidates = (inCountry.length > 0 ? inCountry : leagues)
      .map((item) => ({
        leagueId: item.league.id,
        country: item.country.name,
        league: item.league.name,
        score:
          similarity(requested.league, item.league.name) *
          (normalizeCountry(item.country.name) === country ? 1 : 0.65)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const best = candidates[0];
    const second = candidates[1];
    if (best && best.score >= 0.72 && (!second || best.score - second.score >= 0.15)) {
      const match = leagues.find((item) => item.league.id === best.leagueId)!;
      resolved.push({
        requested,
        leagueId: match.league.id,
        country: match.country.name,
        league: match.league.name,
        seasons: match.seasons,
        source: "fuzzy"
      });
    } else {
      failures.push({
        requested,
        candidates,
        reason: best ? "ambiguous" : "not_found"
      });
    }
  }

  return { resolved, failures };
}
