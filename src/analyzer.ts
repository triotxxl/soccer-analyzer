import { ApiFootballClient } from "./api.ts";
import { config, TEAM_ALIASES_FILE } from "./config.ts";
import { AnalyzerDatabase } from "./database.ts";
import { scoreCrossLeagueFixture } from "./cross-league-criteria.ts";
import { scoreCrossLeagueDrawFixture } from "./cross-league-draw-criteria.ts";
import { consensusOdds, scoreDrawFixture } from "./draw-criteria.ts";
import { scoreFavoriteFixture } from "./favorite-criteria.ts";
import { strengthPool } from "./league-strength.ts";
import { analyzeFirstHalfGoals, analyzeFixture, buildDefenseRankings, candidatesForFixture, goalLineProbabilities } from "./model.ts";
import { buildLeagueStrength } from "./strength-builder.ts";
import { resolveLeagues, saveAlias } from "./resolver.ts";
import {
  fixtureMatchesTeamAliases,
  readTeamAliases,
  saveTeamAlias,
  teamAliasKey,
  teamNameSimilarity,
  type TeamAliasMap
} from "./team-resolver.ts";
import type {
  AnalysisInput,
  AnalysisResult,
  ApiFixture,
  ApiLeague,
  DrawAnalysisResult,
  FavoriteAnalysisResult,
  GoalLineAnalysisResult,
  ResolutionFailure,
  ResolvedLeague
} from "./types.ts";
import { datesForRange, normalizeText } from "./util.ts";
import { venueFormRow } from "./venue-form.ts";
import { enrichFixtureExpectedGoals } from "./xg.ts";

interface DomesticLeagueReference {
  leagueId: number;
  season: number;
}

interface RequestedFixtureScope {
  fixtures: ApiFixture[];
  aliases: TeamAliasMap;
}

function aliasMatchesApiName(requestedName: string, apiName: string, aliases: TeamAliasMap): boolean {
  if (normalizeText(requestedName) === normalizeText(apiName)) return true;
  const alias = aliases[teamAliasKey(requestedName)];
  return alias !== undefined && normalizeText(alias.apiTeamName) === normalizeText(apiName);
}

function tipicoOddsForTeams(
  input: AnalysisInput,
  homeTeam: string,
  awayTeam: string,
  aliases: TeamAliasMap
) {
  return input.tipicoOdds?.find((item) =>
    aliasMatchesApiName(item.homeTeam, homeTeam, aliases) &&
    aliasMatchesApiName(item.awayTeam, awayTeam, aliases)
  );
}

async function requestedFixtureScope(
  fixtures: ApiFixture[],
  input: AnalysisInput,
  teamAliasFile = TEAM_ALIASES_FILE,
  database?: AnalyzerDatabase
): Promise<RequestedFixtureScope> {
  const aliases = await readTeamAliases(teamAliasFile);
  if (!input.matches || input.matches.length === 0) return { fixtures, aliases };
  const selected: ApiFixture[] = [];
  for (const match of input.matches) {
    const requestedKickoff = match.kickoff ? Date.parse(match.kickoff) : Number.NaN;
    const candidates = Number.isFinite(requestedKickoff)
      ? fixtures.filter((fixture) =>
          Math.abs(fixture.fixture.timestamp * 1000 - requestedKickoff) <= 12 * 60 * 60 * 1000
        )
      : fixtures;
    const direct = candidates.find((fixture) =>
      fixtureMatchesTeamAliases(match.homeTeam, match.awayTeam, fixture, aliases)
    );
    let resolved = direct;
    if (!resolved) {
      const ranked = candidates
        .map((fixture) => ({
          fixture,
          homeScore: teamNameSimilarity(match.homeTeam, fixture.teams.home.name),
          awayScore: teamNameSimilarity(match.awayTeam, fixture.teams.away.name)
        }))
        .map((item) => ({ ...item, score: (item.homeScore + item.awayScore) / 2 }))
        .sort((left, right) => right.score - left.score);
      const best = ranked[0];
      if (
        best && best.score >= 0.65 && best.homeScore >= 0.5 && best.awayScore >= 0.5 &&
        (!ranked[1] || best.score - ranked[1].score >= 0.08)
      ) {
        resolved = best.fixture;
        for (const [tipicoName, apiTeam] of [
          [match.homeTeam, resolved.teams.home],
          [match.awayTeam, resolved.teams.away]
        ] as const) {
          if (normalizeText(tipicoName) === normalizeText(apiTeam.name)) continue;
          await saveTeamAlias(tipicoName, apiTeam, teamAliasFile);
          aliases[teamAliasKey(tipicoName)] = {
            tipicoName,
            apiTeamId: apiTeam.id,
            apiTeamName: apiTeam.name
          };
        }
      }
    }
    if (resolved && !selected.some((fixture) => fixture.fixture.id === resolved.fixture.id)) {
      selected.push(resolved);
      database?.saveTipicoFixtureMapping(match, resolved);
    }
  }
  return { fixtures: selected, aliases };
}

function saveCompetitionMappings(
  input: AnalysisInput,
  resolved: ResolvedLeague[],
  database?: AnalyzerDatabase
): void {
  if (!database) return;
  for (const league of resolved) {
    const tipicoId = league.requested.tipicoCompetitionId;
    if (!tipicoId) continue;
    database.saveTipicoCompetitionMapping(tipicoId, {
      leagueId: league.leagueId,
      country: league.country,
      league: league.league,
      source: league.source
    });
  }
}

export function usesCrossLeagueModel(
  fixture: ApiFixture,
  competition?: ApiLeague
): boolean {
  if (competition) {
    return competition.league.type.toLocaleLowerCase() !== "league";
  }
  return /(cup|pokal|copa|qualification|qualifying|play-?off|supercup|trophy)/i.test(
    `${fixture.league.name} ${fixture.league.round ?? ""}`
  );
}

function domesticLeagueReference(
  fixtures: ApiFixture[],
  teamId: number,
  cutoff: number,
  excludedLeagueId: number,
  competitions: Map<number, ApiLeague>
): DomesticLeagueReference | null {
  const groups = new Map<string, {
    leagueId: number;
    season: number;
    matches: number;
    latest: number;
  }>();
  for (const fixture of fixtures) {
    if (fixture.fixture.timestamp >= cutoff) continue;
    if (!["FT", "AET", "PEN"].includes(fixture.fixture.status.short)) continue;
    if (
      fixture.teams.home.id !== teamId &&
      fixture.teams.away.id !== teamId
    ) continue;
    if (fixture.league.id === excludedLeagueId) continue;
    const competition = competitions.get(fixture.league.id);
    if (!competition || competition.league.type.toLocaleLowerCase() !== "league") continue;
    const key = `${fixture.league.id}:${fixture.league.season}`;
    const existing = groups.get(key);
    groups.set(key, {
      leagueId: fixture.league.id,
      season: fixture.league.season,
      matches: (existing?.matches ?? 0) + 1,
      latest: Math.max(existing?.latest ?? 0, fixture.fixture.timestamp)
    });
  }
  const selected = [...groups.values()].sort(
    (left, right) => right.matches - left.matches || right.latest - left.latest
  )[0];
  return selected
    ? { leagueId: selected.leagueId, season: selected.season }
    : null;
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildMissingLeagueStrength(
  fixtures: ApiFixture[],
  crossLeagueFixtureIds: Set<number>,
  domesticByTeam: Map<number, DomesticLeagueReference>,
  client: ApiFootballClient,
  database: AnalyzerDatabase | undefined,
  now: Date
): Promise<void> {
  if (!database) return;
  const competitionIds = new Set<number>();
  for (const fixture of fixtures) {
    if (!crossLeagueFixtureIds.has(fixture.fixture.id)) continue;
    const homeDomestic = domesticByTeam.get(fixture.teams.home.id);
    const awayDomestic = domesticByTeam.get(fixture.teams.away.id);
    if (
      !homeDomestic ||
      !awayDomestic ||
      homeDomestic.leagueId === awayDomestic.leagueId
    ) continue;
    const pool = strengthPool(fixture);
    const homeStrength = database.getLeagueStrength(
      pool,
      homeDomestic.leagueId,
      homeDomestic.season,
      fixture.fixture.date
    );
    const awayStrength = database.getLeagueStrength(
      pool,
      awayDomestic.leagueId,
      awayDomestic.season,
      fixture.fixture.date
    );
    if (!homeStrength?.reliable || !awayStrength?.reliable) {
      competitionIds.add(fixture.league.id);
    }
  }
  if (competitionIds.size === 0) return;
  await buildLeagueStrength({
    client,
    database,
    seasons: 3,
    requestBudget: config.strengthOnDemandRequestBudget,
    now,
    competitionIds: [...competitionIds]
  });
}

export class LeagueResolutionError extends Error {
  readonly failures: ResolutionFailure[];

  constructor(failures: ResolutionFailure[]) {
    super("Mindestens eine Liga konnte nicht eindeutig zugeordnet werden.");
    this.name = "LeagueResolutionError";
    this.failures = failures;
  }
}

function previousSeason(current: number, league: ResolvedLeague): number | null {
  const prior = league.seasons
    .map((season) => season.year)
    .filter((year) => year < current)
    .sort((a, b) => b - a)[0];
  return prior ?? (current > 1900 ? current - 1 : null);
}

export async function runAnalysis(
  input: AnalysisInput,
  dependencies?: {
    client?: ApiFootballClient;
    database?: AnalyzerDatabase;
    now?: Date;
    teamAliasFile?: string;
  }
): Promise<AnalysisResult> {
  if (input.selections.length === 0) {
    throw new Error("Mindestens eine Auswahl im Format Land|Liga ist erforderlich.");
  }
  const client = dependencies?.client ?? new ApiFootballClient();
  const database = dependencies?.database ?? new AnalyzerDatabase();
  const now = dependencies?.now ?? new Date();
  const leagues = await client.getLeagues();
  const resolution = await resolveLeagues(input.selections, leagues);
  if (resolution.failures.length > 0) {
    throw new LeagueResolutionError(resolution.failures);
  }
  saveCompetitionMappings(input, resolution.resolved, database);
  await Promise.all(
    resolution.resolved
      .filter((league) => league.source === "fuzzy")
      .map((league) =>
        saveAlias(league.requested, {
          leagueId: league.leagueId,
          country: league.country,
          league: league.league
        })
      )
  );
  const dates = datesForRange(input.dates, config.timezone, now);
  const dailyFixtures = (await Promise.all(
    dates.map((date) => client.getFixturesForDate(date, config.timezone))
  )).flat();
  const selectedIds = new Set(resolution.resolved.map((league) => league.leagueId));
  const scope = await requestedFixtureScope(
    dailyFixtures.filter((fixture) => selectedIds.has(fixture.league.id)),
    input,
    dependencies?.teamAliasFile,
    database
  );
  const fixtures = scope.fixtures
    .filter((fixture) => ["NS", "TBD"].includes(fixture.fixture.status.short))
    .sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);

  const leagueById = new Map(resolution.resolved.map((league) => [league.leagueId, league]));
  const history = new Map<string, ApiFixture[]>();
  const keys = new Map<string, { leagueId: number; season: number }>();
  for (const fixture of fixtures) {
    keys.set(`${fixture.league.id}:${fixture.league.season}`, {
      leagueId: fixture.league.id,
      season: fixture.league.season
    });
  }
  await Promise.all(
    [...keys.values()].map(async ({ leagueId, season }) => {
      const league = leagueById.get(leagueId)!;
      const prior = previousSeason(season, league);
      const currentFixtures = await client.getSeasonFixtures(leagueId, season);
      const priorFixtures = prior === null ? [] : await client.getSeasonFixtures(leagueId, prior, true);
      history.set(`${leagueId}:${season}`, [...currentFixtures, ...priorFixtures]);
    })
  );

  const candidates = fixtures.flatMap((fixture) =>
    candidatesForFixture(
      fixture,
      history.get(`${fixture.league.id}:${fixture.league.season}`) ?? [],
      input.markets
    )
  ).map((candidate) => {
    const odds = tipicoOddsForTeams(
      input,
      candidate.homeTeam,
      candidate.awayTeam,
      scope.aliases
    );
    if (!odds) return candidate;
    let tipicoOdds: number | undefined;
    if (candidate.market === "draw") tipicoOdds = odds.draw;
    else if (candidate.market === "btts") tipicoOdds = odds.bttsYes;
    else if (candidate.market === "over25") tipicoOdds = odds.over25;
    else if (candidate.selection.startsWith("Heimsieg")) tipicoOdds = odds.home;
    else if (candidate.selection.startsWith("Auswärtssieg")) tipicoOdds = odds.away;
    else tipicoOdds = odds.draw;
    return tipicoOdds === undefined ? candidate : { ...candidate, tipicoOdds };
  });
  const createdAt = now.toISOString();
  const base: Omit<AnalysisResult, "runId"> = {
    createdAt,
    dates,
    markets: input.markets,
    resolvedLeagues: resolution.resolved,
    fixtureCount: fixtures.length,
    candidates,
    apiRequests: client.requestCount,
    apiRequestsRemaining: client.requestsRemaining
  };
  const runId = database.saveRun(base, candidates);
  return { runId, ...base };
}

export async function runGoalLineAnalysis(
  input: AnalysisInput,
  dependencies?: {
    client?: ApiFootballClient;
    database?: AnalyzerDatabase;
    now?: Date;
    teamAliasFile?: string;
  }
): Promise<GoalLineAnalysisResult> {
  if (input.selections.length === 0) {
    throw new Error("Mindestens eine Auswahl im Format Land|Liga ist erforderlich.");
  }
  const client = dependencies?.client ?? new ApiFootballClient();
  const database = dependencies?.database ?? new AnalyzerDatabase();
  const ownsDatabase = dependencies?.database === undefined;
  const now = dependencies?.now ?? new Date();
  try {
    const leagues = await client.getLeagues();
    const resolution = await resolveLeagues(input.selections, leagues);
    if (resolution.failures.length > 0) {
      throw new LeagueResolutionError(resolution.failures);
    }
    saveCompetitionMappings(input, resolution.resolved, database);
    await Promise.all(
      resolution.resolved
        .filter((league) => league.source === "fuzzy")
        .map((league) =>
          saveAlias(league.requested, {
            leagueId: league.leagueId,
            country: league.country,
            league: league.league
          })
        )
    );
    const dates = datesForRange(input.dates, config.timezone, now);
    const dailyFixtures = (await Promise.all(
      dates.map((date) => client.getFixturesForDate(date, config.timezone))
    )).flat();
    const selectedIds = new Set(resolution.resolved.map((league) => league.leagueId));
    const scope = await requestedFixtureScope(
      dailyFixtures.filter((fixture) => selectedIds.has(fixture.league.id)),
      input,
      dependencies?.teamAliasFile,
      database
    );
    const fixtures = scope.fixtures
      .filter((fixture) => ["NS", "TBD"].includes(fixture.fixture.status.short))
      .sort((left, right) =>
        left.fixture.timestamp - right.fixture.timestamp ||
        left.teams.home.name.localeCompare(right.teams.home.name)
      );

    const competitionsById = new Map(leagues.map((league) => [league.league.id, league]));
    const resolvedById = new Map(
      resolution.resolved.map((league) => [league.leagueId, league])
    );
    const crossLeagueFixtureIds = new Set(
      fixtures
        .filter((fixture) => usesCrossLeagueModel(
          fixture,
          competitionsById.get(fixture.league.id)
        ))
        .map((fixture) => fixture.fixture.id)
    );
    const seasonKeys = new Map<string, { leagueId: number; season: number }>();
    for (const fixture of fixtures) {
      seasonKeys.set(`${fixture.league.id}:${fixture.league.season}`, {
        leagueId: fixture.league.id,
        season: fixture.league.season
      });
    }
    const seasonEntries = await mapLimit(
      [...seasonKeys.values()],
      2,
      async ({ leagueId, season }) => {
        const resolved = resolvedById.get(leagueId);
        const prior = resolved ? previousSeason(season, resolved) : season - 1;
        const [current, previous] = await Promise.all([
          client.getSeasonFixtures(leagueId, season),
          prior === null ? Promise.resolve([]) : client.getSeasonFixtures(leagueId, prior, true)
        ]);
        return {
          key: `${leagueId}:${season}`,
          fixtures: [...current, ...previous]
        };
      }
    );
    const competitionHistory = new Map(
      seasonEntries.map((entry) => [entry.key, entry.fixtures])
    );

    const crossTeamIds = [...new Set(fixtures
      .filter((fixture) => crossLeagueFixtureIds.has(fixture.fixture.id))
      .flatMap((fixture) => [fixture.teams.home.id, fixture.teams.away.id]))];
    const recentEntries = await mapLimit(crossTeamIds, 2, async (teamId) => ({
      teamId,
      fixtures: await client.getTeamRecentFixtures(teamId, 20)
    }));
    const recentByTeam = new Map(
      recentEntries.map((entry) => [entry.teamId, entry.fixtures])
    );
    const domesticByTeam = new Map<number, DomesticLeagueReference>();
    for (const fixture of fixtures.filter((item) => crossLeagueFixtureIds.has(item.fixture.id))) {
      for (const teamId of [fixture.teams.home.id, fixture.teams.away.id]) {
        if (domesticByTeam.has(teamId)) continue;
        const reference = domesticLeagueReference(recentByTeam.get(teamId) ?? [], teamId,
          fixture.fixture.timestamp, fixture.league.id, competitionsById);
        if (reference) domesticByTeam.set(teamId, reference);
      }
    }
    const domesticKeys = [...new Map([...domesticByTeam.values()].map((reference) => [`${reference.leagueId}:${reference.season}`, reference])).values()];
    const domesticEntries = await mapLimit(domesticKeys, 2, async ({ leagueId, season }) => {
      const prior = season > 1900 ? season - 1 : null;
      const [current, previous] = await Promise.all([
        client.getSeasonFixtures(leagueId, season),
        prior === null ? Promise.resolve([]) : client.getSeasonFixtures(leagueId, prior, true)
      ]);
      return { key: `${leagueId}:${season}`, fixtures: [...current, ...previous] };
    });
    const domesticHistory = new Map(domesticEntries.map((entry) => [entry.key, entry.fixtures]));
    const allHistory = [...new Map([
      ...[...competitionHistory.values()].flat(),
      ...[...recentByTeam.values()].flat(),
      ...[...domesticHistory.values()].flat()
    ].map((item) => [item.fixture.id, item])).values()];
    const enriched = await enrichFixtureExpectedGoals(allHistory, client, database, {
      maxRequests: config.xgEnrichmentRequestBudget,
      now
    });
    const rankingsByCompetition = new Map<string, ReturnType<typeof buildDefenseRankings>>();
    for (const [key, history] of competitionHistory) {
      const targetTimestamp = Math.min(
        ...fixtures.filter((fixture) => `${fixture.league.id}:${fixture.league.season}` === key).map((fixture) => fixture.fixture.timestamp)
      );
      if (Number.isFinite(targetTimestamp)) {
        rankingsByCompetition.set(key, buildDefenseRankings(history, enriched.values, targetTimestamp));
      }
    }
    for (const [key, history] of domesticHistory) {
      rankingsByCompetition.set(key, buildDefenseRankings(history, enriched.values,
        Math.min(...fixtures.map((fixture) => fixture.fixture.timestamp))));
    }

    const rows = fixtures.map((fixture) => {
      const competitionKey = `${fixture.league.id}:${fixture.league.season}`;
      const history = competitionHistory.get(competitionKey) ?? [];
      const crossLeague = crossLeagueFixtureIds.has(fixture.fixture.id);
      const teamHistory = crossLeague
        ? [...new Map([
            ...history,
            ...(recentByTeam.get(fixture.teams.home.id) ?? []),
            ...(recentByTeam.get(fixture.teams.away.id) ?? [])
          ].map((item) => [item.fixture.id, item])).values()]
        : history;
      const rankings = crossLeague ? (() => {
        const homeRef = domesticByTeam.get(fixture.teams.home.id);
        const awayRef = domesticByTeam.get(fixture.teams.away.id);
        if (!homeRef || !awayRef) return undefined;
        const homeRanks = rankingsByCompetition.get(`${homeRef.leagueId}:${homeRef.season}`);
        const awayRanks = rankingsByCompetition.get(`${awayRef.leagueId}:${awayRef.season}`);
        if (!homeRanks || !awayRanks) return undefined;
        return { home: homeRanks.home, away: awayRanks.away };
      })() : rankingsByCompetition.get(competitionKey);
      const model = analyzeFixture(fixture, history, teamHistory, {
        expectedGoals: enriched.values,
        rankings
      });
      const firstHalfModel = analyzeFirstHalfGoals(fixture, history, teamHistory);
      const warnings: string[] = [];
      if (model.quality < 60) {
        warnings.push("Schwache Datenlage; Wahrscheinlichkeiten nicht als Empfehlung verwenden");
      } else if (model.quality < 75) {
        warnings.push("Nur mittleres Datenvertrauen");
      }
      if (Math.min(model.homeMetrics.homeMatches, model.awayMetrics.awayMatches) < 6) {
        warnings.push("Kleine Heim-/Auswärtsstichprobe");
      }
      if (model.sample.leagueMatches < 10) {
        warnings.push("Dünne Wettbewerbshistorie");
      }
      if (crossLeague) {
        warnings.push("Cross-League: Teamform aus Pflichtspielen verschiedener Wettbewerbe");
      }
      const firstHalfWarnings: string[] = [];
      if (firstHalfModel.quality < 60) {
        firstHalfWarnings.push("Schwache Halbzeit-Datenlage; Wahrscheinlichkeiten vorsichtig einordnen");
      } else if (firstHalfModel.quality < 75) {
        firstHalfWarnings.push("Nur mittleres Halbzeit-Datenvertrauen");
      }
      if (Math.min(firstHalfModel.homeMetrics.homeMatches, firstHalfModel.awayMetrics.awayMatches) < 6) {
        firstHalfWarnings.push("Kleine Heim-/Auswärtsstichprobe für Halbzeitstände");
      }
      if (firstHalfModel.sample.leagueMatches < 10) {
        firstHalfWarnings.push("Dünne Wettbewerbshistorie mit vollständigen Halbzeitständen");
      }
      if (firstHalfModel.sample.coverage < 0.8) {
        firstHalfWarnings.push(`Nur ${Math.round(firstHalfModel.sample.coverage * 100)} % der historischen Spiele enthalten vollständige Halbzeitstände`);
      }
      if (firstHalfModel.usedFallback) {
        firstHalfWarnings.push("Keine Wettbewerbshistorie mit Halbzeitständen; 45-%-Prior aus Gesamtspieltoren verwendet");
      }
      if (crossLeague) {
        firstHalfWarnings.push("Cross-League: Halbzeit-Teamform aus Pflichtspielen verschiedener Wettbewerbe");
      }
      return {
        fixtureId: fixture.fixture.id,
        kickoff: fixture.fixture.date,
        country: fixture.league.country,
        league: fixture.league.name,
        homeTeam: fixture.teams.home.name,
        awayTeam: fixture.teams.away.name,
        modelVersion: config.goalLineModelVersion,
        expectedHomeGoals: model.expectedHomeGoals,
        expectedAwayGoals: model.expectedAwayGoals,
        expectedTotalGoals: model.expectedHomeGoals + model.expectedAwayGoals,
        dataConfidence: model.quality,
        outcomeProbabilities: model.probabilities,
        defense: model.defense,
        probabilities: goalLineProbabilities(
          model.expectedHomeGoals,
          model.expectedAwayGoals
        ),
        firstHalf: {
          expectedHomeGoals: firstHalfModel.expectedHomeGoals,
          expectedAwayGoals: firstHalfModel.expectedAwayGoals,
          expectedTotalGoals: firstHalfModel.expectedHomeGoals + firstHalfModel.expectedAwayGoals,
          dataConfidence: firstHalfModel.quality,
          probabilities: firstHalfModel.probabilities,
          warnings: firstHalfWarnings
        },
        warnings
      };
    });
    const createdAt = now.toISOString();
    database.saveGoalLinePredictions(createdAt, rows, {
      dates,
      selections: input.selections,
      matches: input.matches ?? []
    });
    return {
      createdAt,
      dates,
      rows,
      apiRequests: client.requestCount,
      apiRequestsRemaining: client.requestsRemaining
    };
  } finally {
    if (ownsDatabase) database.close();
  }
}

export async function runDrawCriteriaAnalysis(
  input: AnalysisInput,
  dependencies?: {
    client?: ApiFootballClient;
    database?: AnalyzerDatabase;
    now?: Date;
    teamAliasFile?: string;
  }
): Promise<DrawAnalysisResult> {
  if (input.selections.length === 0) {
    throw new Error("Mindestens eine Auswahl im Format Land|Liga ist erforderlich.");
  }
  const client = dependencies?.client ?? new ApiFootballClient();
  const now = dependencies?.now ?? new Date();
  const leagues = await client.getLeagues();
  const resolution = await resolveLeagues(input.selections, leagues);
  if (resolution.failures.length > 0) {
    throw new LeagueResolutionError(resolution.failures);
  }
  saveCompetitionMappings(input, resolution.resolved, dependencies?.database);
  await Promise.all(
    resolution.resolved
      .filter((league) => league.source === "fuzzy")
      .map((league) =>
        saveAlias(league.requested, {
          leagueId: league.leagueId,
          country: league.country,
          league: league.league
        })
      )
  );
  const dates = datesForRange(input.dates, config.timezone, now);
  const dailyFixtures = (await Promise.all(
    dates.map((date) => client.getFixturesForDate(date, config.timezone))
  )).flat();
  const selectedIds = new Set(resolution.resolved.map((league) => league.leagueId));
  const scope = await requestedFixtureScope(
    dailyFixtures.filter((fixture) => selectedIds.has(fixture.league.id)),
    input,
    dependencies?.teamAliasFile,
    dependencies?.database
  );
  const fixtures = scope.fixtures
    .filter((fixture) => ["NS", "TBD"].includes(fixture.fixture.status.short))
    .sort((left, right) => left.fixture.timestamp - right.fixture.timestamp);
  const competitionsById = new Map(leagues.map((league) => [league.league.id, league]));
  const crossLeagueFixtureIds = new Set(
    fixtures
      .filter((fixture) => usesCrossLeagueModel(
        fixture,
        competitionsById.get(fixture.league.id)
      ))
      .map((fixture) => fixture.fixture.id)
  );
  const seasonKeys = new Map<string, { leagueId: number; season: number }>();
  for (const fixture of fixtures) {
    if (crossLeagueFixtureIds.has(fixture.fixture.id)) continue;
    seasonKeys.set(`${fixture.league.id}:${fixture.league.season}`, {
      leagueId: fixture.league.id,
      season: fixture.league.season
    });
  }
  const seasonEntries = await mapLimit([...seasonKeys.values()], 2, async ({ leagueId, season }) => {
    return {
      key: `${leagueId}:${season}`,
      fixtures: await client.getSeasonFixtures(leagueId, season)
    };
  });
  const seasonFixtures = new Map(
    seasonEntries.map((entry) => [entry.key, entry.fixtures])
  );

  const teamIds = [...new Set(fixtures.flatMap((fixture) => [
    fixture.teams.home.id,
    fixture.teams.away.id
  ]))];
  const recentEntries = await mapLimit(teamIds, 2, async (teamId) => ({
    teamId,
    fixtures: await client.getTeamRecentFixtures(teamId, 40)
  }));
  const recentFixtures = new Map(
    recentEntries.map((entry) => [entry.teamId, entry.fixtures])
  );
  const domesticByTeam = new Map<number, DomesticLeagueReference>();
  for (const fixture of fixtures) {
    if (!crossLeagueFixtureIds.has(fixture.fixture.id)) continue;
    for (const teamId of [fixture.teams.home.id, fixture.teams.away.id]) {
      if (domesticByTeam.has(teamId)) continue;
      const reference = domesticLeagueReference(
        recentFixtures.get(teamId) ?? [],
        teamId,
        fixture.fixture.timestamp,
        fixture.league.id,
        competitionsById
      );
      if (reference) domesticByTeam.set(teamId, reference);
    }
  }
  const domesticKeys = new Map<string, DomesticLeagueReference>();
  for (const reference of domesticByTeam.values()) {
    domesticKeys.set(`${reference.leagueId}:${reference.season}`, reference);
  }
  const domesticEntries = await mapLimit(
    [...domesticKeys.values()],
    2,
    async ({ leagueId, season }) => {
      return {
        key: `${leagueId}:${season}`,
        fixtures: await client.getSeasonFixtures(leagueId, season)
      };
    }
  );
  const domesticFixtures = new Map(
    domesticEntries.map((entry) => [entry.key, entry.fixtures])
  );
  await buildMissingLeagueStrength(
    fixtures,
    crossLeagueFixtureIds,
    domesticByTeam,
    client,
    dependencies?.database,
    now
  );
  const supplemental = await mapLimit(fixtures, 2, async (fixture) => ({
    fixtureId: fixture.fixture.id,
    headToHead: await client.getHeadToHead(
      fixture.teams.home.id,
      fixture.teams.away.id,
      undefined
    ),
    odds: await client.getFixtureOdds(fixture.fixture.id)
  }));
  const supplementalByFixture = new Map(
    supplemental.map((entry) => [entry.fixtureId, entry])
  );
  const resolvedById = new Map(
    resolution.resolved.map((league) => [league.leagueId, league])
  );
  const rows = fixtures.map((fixture) => {
    const resolved = resolvedById.get(fixture.league.id);
    const season = resolved?.seasons.find((item) => item.year === fixture.league.season);
    const standingsAvailable = season?.coverage?.standings === true;
    const tipicoOdds = tipicoOddsForTeams(
      input,
      fixture.teams.home.name,
      fixture.teams.away.name,
      scope.aliases
    );
    const extra = supplementalByFixture.get(fixture.fixture.id);
    if (crossLeagueFixtureIds.has(fixture.fixture.id)) {
      const homeDomestic = domesticByTeam.get(fixture.teams.home.id);
      const awayDomestic = domesticByTeam.get(fixture.teams.away.id);
      return scoreCrossLeagueDrawFixture({
        fixture,
        homeRecent: recentFixtures.get(fixture.teams.home.id) ?? [],
        awayRecent: recentFixtures.get(fixture.teams.away.id) ?? [],
        homeDomesticFixtures: homeDomestic
          ? domesticFixtures.get(`${homeDomestic.leagueId}:${homeDomestic.season}`) ?? []
          : [],
        awayDomesticFixtures: awayDomestic
          ? domesticFixtures.get(`${awayDomestic.leagueId}:${awayDomestic.season}`) ?? []
          : [],
        headToHead: extra?.headToHead ?? [],
        odds: extra?.odds ?? [],
        tipicoOdds
      });
    }
    return scoreDrawFixture({
      fixture,
      seasonFixtures:
        seasonFixtures.get(`${fixture.league.id}:${fixture.league.season}`) ?? [],
      homeRecent: recentFixtures.get(fixture.teams.home.id) ?? [],
      awayRecent: recentFixtures.get(fixture.teams.away.id) ?? [],
      headToHead: extra?.headToHead ?? [],
      odds: extra?.odds ?? [],
      standingsAvailable,
      tipicoOdds
    });
  }).sort((left, right) =>
    right.score - left.score ||
    left.kickoff.localeCompare(right.kickoff) ||
    left.homeTeam.localeCompare(right.homeTeam)
  );
  const createdAt = now.toISOString();
  const oddsByFixture = new Map(supplemental.map((entry) => [
    entry.fixtureId,
    consensusOdds(entry.odds)
  ]));
  dependencies?.database?.saveProfilePredictions(
    createdAt,
    "draw",
    rows,
    { dates, selections: input.selections, matches: input.matches ?? [], oddsByFixture }
  );
  const validation = dependencies?.database?.drawValidationStatus();
  return {
    createdAt,
    dates,
    rows,
    apiRequests: client.requestCount,
    apiRequestsRemaining: client.requestsRemaining,
    ...(validation ? { validation } : {})
  };
}

export async function runFavoriteAnalysis(
  input: AnalysisInput,
  dependencies?: {
    client?: ApiFootballClient;
    database?: AnalyzerDatabase;
    now?: Date;
    teamAliasFile?: string;
  }
): Promise<FavoriteAnalysisResult> {
  if (input.selections.length === 0) {
    throw new Error("Mindestens eine Auswahl im Format Land|Liga ist erforderlich.");
  }
  const client = dependencies?.client ?? new ApiFootballClient();
  const now = dependencies?.now ?? new Date();
  const leagues = await client.getLeagues();
  const resolution = await resolveLeagues(input.selections, leagues);
  if (resolution.failures.length > 0) {
    throw new LeagueResolutionError(resolution.failures);
  }
  saveCompetitionMappings(input, resolution.resolved, dependencies?.database);
  await Promise.all(
    resolution.resolved
      .filter((league) => league.source === "fuzzy")
      .map((league) =>
        saveAlias(league.requested, {
          leagueId: league.leagueId,
          country: league.country,
          league: league.league
        })
      )
  );
  const dates = datesForRange(input.dates, config.timezone, now);
  const dailyFixtures = (await Promise.all(
    dates.map((date) => client.getFixturesForDate(date, config.timezone))
  )).flat();
  const selectedIds = new Set(resolution.resolved.map((league) => league.leagueId));
  const scope = await requestedFixtureScope(
    dailyFixtures.filter((fixture) => selectedIds.has(fixture.league.id)),
    input,
    dependencies?.teamAliasFile,
    dependencies?.database
  );
  const fixtures = scope.fixtures
    .filter((fixture) => ["NS", "TBD"].includes(fixture.fixture.status.short))
    .sort((left, right) => left.fixture.timestamp - right.fixture.timestamp);
  const competitionsById = new Map(leagues.map((league) => [league.league.id, league]));
  const crossLeagueFixtureIds = new Set(
    fixtures
      .filter((fixture) => usesCrossLeagueModel(
        fixture,
        competitionsById.get(fixture.league.id)
      ))
      .map((fixture) => fixture.fixture.id)
  );

  const seasonKeys = new Map<string, { leagueId: number; season: number }>();
  for (const fixture of fixtures) {
    if (crossLeagueFixtureIds.has(fixture.fixture.id)) continue;
    seasonKeys.set(`${fixture.league.id}:${fixture.league.season}`, {
      leagueId: fixture.league.id,
      season: fixture.league.season
    });
  }
  const seasonEntries = await mapLimit([...seasonKeys.values()], 2, async ({ leagueId, season }) => {
    return {
      key: `${leagueId}:${season}`,
      fixtures: await client.getSeasonFixtures(leagueId, season)
    };
  });
  const seasonFixtures = new Map(
    seasonEntries.map((entry) => [entry.key, entry.fixtures])
  );
  const teamIds = [...new Set(fixtures.flatMap((fixture) => [
    fixture.teams.home.id,
    fixture.teams.away.id
  ]))];
  const recentEntries = await mapLimit(teamIds, 2, async (teamId) => ({
    teamId,
    fixtures: await client.getTeamRecentFixtures(teamId, 40)
  }));
  const recentFixtures = new Map(
    recentEntries.map((entry) => [entry.teamId, entry.fixtures])
  );
  const domesticByTeam = new Map<number, DomesticLeagueReference>();
  for (const fixture of fixtures) {
    if (!crossLeagueFixtureIds.has(fixture.fixture.id)) continue;
    for (const teamId of [fixture.teams.home.id, fixture.teams.away.id]) {
      if (domesticByTeam.has(teamId)) continue;
      const reference = domesticLeagueReference(
        recentFixtures.get(teamId) ?? [],
        teamId,
        fixture.fixture.timestamp,
        fixture.league.id,
        competitionsById
      );
      if (reference) domesticByTeam.set(teamId, reference);
    }
  }
  const domesticKeys = new Map<string, DomesticLeagueReference>();
  for (const reference of domesticByTeam.values()) {
    domesticKeys.set(`${reference.leagueId}:${reference.season}`, reference);
  }
  const domesticEntries = await mapLimit(
    [...domesticKeys.values()],
    2,
    async ({ leagueId, season }) => {
      return {
        key: `${leagueId}:${season}`,
        fixtures: await client.getSeasonFixtures(leagueId, season)
      };
    }
  );
  const domesticFixtures = new Map(
    domesticEntries.map((entry) => [entry.key, entry.fixtures])
  );
  await buildMissingLeagueStrength(
    fixtures,
    crossLeagueFixtureIds,
    domesticByTeam,
    client,
    dependencies?.database,
    now
  );
  const supplemental = await mapLimit(fixtures, 2, async (fixture) => ({
    fixtureId: fixture.fixture.id,
    headToHead: await client.getHeadToHead(
      fixture.teams.home.id,
      fixture.teams.away.id,
      undefined
    ),
    odds: await client.getFixtureOdds(fixture.fixture.id)
  }));
  const supplementalByFixture = new Map(
    supplemental.map((entry) => [entry.fixtureId, entry])
  );
  const resolvedById = new Map(
    resolution.resolved.map((league) => [league.leagueId, league])
  );
  const rows = fixtures.map((fixture) => {
    const resolved = resolvedById.get(fixture.league.id);
    const season = resolved?.seasons.find((item) => item.year === fixture.league.season);
    const tipicoOdds = tipicoOddsForTeams(
      input,
      fixture.teams.home.name,
      fixture.teams.away.name,
      scope.aliases
    );
    const extra = supplementalByFixture.get(fixture.fixture.id);
    if (crossLeagueFixtureIds.has(fixture.fixture.id)) {
      const homeDomestic = domesticByTeam.get(fixture.teams.home.id);
      const awayDomestic = domesticByTeam.get(fixture.teams.away.id);
      return scoreCrossLeagueFixture({
        fixture,
        homeRecent: recentFixtures.get(fixture.teams.home.id) ?? [],
        awayRecent: recentFixtures.get(fixture.teams.away.id) ?? [],
        homeDomesticFixtures: homeDomestic
          ? domesticFixtures.get(`${homeDomestic.leagueId}:${homeDomestic.season}`) ?? []
          : [],
        awayDomesticFixtures: awayDomestic
          ? domesticFixtures.get(`${awayDomestic.leagueId}:${awayDomestic.season}`) ?? []
          : [],
        odds: extra?.odds ?? [],
        tipicoOdds
      });
    }
    return scoreFavoriteFixture({
      fixture,
      seasonFixtures:
        seasonFixtures.get(`${fixture.league.id}:${fixture.league.season}`) ?? [],
      homeRecent: recentFixtures.get(fixture.teams.home.id) ?? [],
      awayRecent: recentFixtures.get(fixture.teams.away.id) ?? [],
      headToHead: extra?.headToHead ?? [],
      odds: extra?.odds ?? [],
      standingsAvailable: season?.coverage?.standings === true,
      tipicoOdds
    });
  }).sort((left, right) =>
    right.score - left.score ||
    left.kickoff.localeCompare(right.kickoff) ||
    left.homeTeam.localeCompare(right.homeTeam)
  );
  const createdAt = now.toISOString();
  const oddsByFixture = new Map(supplemental.map((entry) => [
    entry.fixtureId,
    consensusOdds(entry.odds)
  ]));
  const scoredByFixture = new Map(rows.map((row) => [row.fixtureId, row]));
  const venueFormRows = fixtures
    .map((fixture) => {
      const scored = scoredByFixture.get(fixture.fixture.id);
      const odds = oddsByFixture.get(fixture.fixture.id);
      if (!scored || !odds) return null;
      return venueFormRow(
        {
          fixtureId: scored.fixtureId,
          kickoff: scored.kickoff,
          homeTeam: scored.homeTeam,
          awayTeam: scored.awayTeam,
          oddsHome: odds.home,
          oddsAway: odds.away
        },
        fixture,
        recentFixtures.get(fixture.teams.home.id) ?? [],
        recentFixtures.get(fixture.teams.away.id) ?? [],
        { strongMinimum: 70, weakMaximum: 50, minimumOdds: 1.3 }
      );
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) =>
      Math.max(right.homeForm.percentage, right.awayForm.percentage) -
        Math.max(left.homeForm.percentage, left.awayForm.percentage) ||
      left.kickoff.localeCompare(right.kickoff)
    );
  dependencies?.database?.saveProfilePredictions(
    createdAt,
    "1x2",
    rows,
    { dates, selections: input.selections, matches: input.matches ?? [], oddsByFixture }
  );
  return {
    createdAt,
    dates,
    rows,
    venueFormRows,
    apiRequests: client.requestCount,
    apiRequestsRemaining: client.requestsRemaining
  };
}
