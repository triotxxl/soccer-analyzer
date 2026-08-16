import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiFootballClient } from "./api.ts";
import { ROOT_DIR } from "./config.ts";
import { AnalysisSnapshotCache } from "./analysis-cache.ts";
import {
  runAnalysis,
  runDrawCriteriaAnalysis,
  runFavoriteAnalysis,
  runGoalLineAnalysis,
  LeagueResolutionError
} from "./analyzer.ts";
import { AnalyzerDatabase } from "./database.ts";
import {
  formatAnalysis,
  formatDrawAnalysis,
  formatFavoriteAnalysis,
  formatGoalLineAnalysis
} from "./output.ts";
import { formatLiveAnalysis } from "./output.ts";
import { runLiveAnalysis } from "./live.ts";
import { saveAlias } from "./resolver.ts";
import { saveTeamAlias } from "./team-resolver.ts";
import { buildLeagueStrength } from "./strength-builder.ts";
import { formatVenueFormResult, runVenueFormFilter } from "./venue-form.ts";
import { importTipicoData } from "./tipico.ts";
import { writeDashboard } from "./dashboard.ts";
import type {
  AnalysisInput,
  AnalysisResult,
  DateRange,
  DrawAnalysisResult,
  FavoriteAnalysisResult,
  GoalLineAnalysisResult,
  LeagueSelection,
  LiveMatchSelection
} from "./types.ts";
import { parseMarkets, percent } from "./util.ts";

interface ParsedArgs {
  positional: string[];
  options: Map<string, string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const [rawKey, inline] = value.slice(2).split("=", 2);
    const next = inline ?? (argv[index + 1] && !argv[index + 1]!.startsWith("--")
      ? argv[++index]
      : "true");
    options.set(rawKey!, [...(options.get(rawKey!) ?? []), next!]);
  }
  return { positional, options };
}

function option(args: ParsedArgs, key: string): string | undefined {
  return args.options.get(key)?.at(-1);
}

function numericOption(args: ParsedArgs, key: string): number | null {
  const value = option(args, key);
  if (value === undefined) return null;
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`--${key} muss eine Zahl sein.`);
  return parsed;
}

function probabilityOption(args: ParsedArgs, key: string): number | null {
  const value = numericOption(args, key);
  if (value === null) return null;
  const normalized = value > 1 ? value / 100 : value;
  if (normalized < 0 || normalized > 1) {
    throw new Error(`--${key} muss zwischen 0 und 1 oder zwischen 0 und 100 liegen.`);
  }
  return normalized;
}

function filterProfileResult<T extends DrawAnalysisResult | FavoriteAnalysisResult>(
  result: T,
  args: ParsedArgs
): T {
  const minimumOdds = numericOption(args, "min-odds");
  const minimumScore = numericOption(args, "min-score");
  const minimumConfidence = numericOption(args, "min-confidence");
  return {
    ...result,
    rows: result.rows.filter((row) =>
      (minimumOdds === null || (row.odds !== null && row.odds >= minimumOdds)) &&
      (minimumScore === null || row.score >= minimumScore) &&
      (minimumConfidence === null || row.confidence >= minimumConfidence)
    )
  };
}

function filterGoalLineResult(
  result: GoalLineAnalysisResult,
  args: ParsedArgs
): GoalLineAnalysisResult {
  const minimumConfidence = numericOption(args, "min-confidence");
  const minimumOver15 = probabilityOption(args, "min-over15");
  const minimumOver25 = probabilityOption(args, "min-over25");
  const minimumOver35 = probabilityOption(args, "min-over35");
  return {
    ...result,
    rows: result.rows.filter((row) =>
      (minimumConfidence === null || row.dataConfidence >= minimumConfidence) &&
      (minimumOver15 === null || row.probabilities.over15 >= minimumOver15) &&
      (minimumOver25 === null || row.probabilities.over25 >= minimumOver25) &&
      (minimumOver35 === null || row.probabilities.over35 >= minimumOver35)
    )
  };
}

function filterAnalysisResult(result: AnalysisResult, args: ParsedArgs): AnalysisResult {
  const minimumProbability = probabilityOption(args, "min-probability");
  const minimumQuality = numericOption(args, "min-quality");
  return {
    ...result,
    candidates: result.candidates.filter((candidate) =>
      (minimumProbability === null || candidate.probability >= minimumProbability) &&
      (minimumQuality === null || candidate.quality >= minimumQuality)
    )
  };
}

function selectionsFromArgs(args: ParsedArgs): LeagueSelection[] {
  return (args.options.get("select") ?? []).map((value) => {
    const separator = value.indexOf("|");
    if (separator < 1 || separator === value.length - 1) {
      throw new Error(`Ungültige Auswahl "${value}". Erwartet wird "Land|Liga".`);
    }
    return { country: value.slice(0, separator).trim(), league: value.slice(separator + 1).trim() };
  });
}

function matchesFromArgs(args: ParsedArgs): LiveMatchSelection[] {
  return (args.options.get("match") ?? []).map((value) => {
    const separator = value.indexOf("|");
    if (separator < 1 || separator === value.length - 1) {
      throw new Error(`Ungültige Partie "${value}". Erwartet wird "Heimteam|Auswärtsteam".`);
    }
    return { homeTeam: value.slice(0, separator).trim(), awayTeam: value.slice(separator + 1).trim() };
  });
}

async function analysisInput(args: ParsedArgs): Promise<AnalysisInput> {
  const inputFile = option(args, "input");
  if (inputFile) {
    return JSON.parse(await readFile(inputFile, "utf8")) as AnalysisInput;
  }
  const dates = (option(args, "dates") ?? "both") as DateRange;
  if (!["today", "tomorrow", "both", "next48", "three", "five", "seven", "fourteen", "twentyone"].includes(dates)) {
    throw new Error("--dates muss today, tomorrow, both, next48, three, five, seven, fourteen oder twentyone sein.");
  }
  return {
    selections: selectionsFromArgs(args),
    markets: parseMarkets(option(args, "markets")),
    dates,
    matches: matchesFromArgs(args)
  };
}

function printResolutionError(error: LeagueResolutionError): void {
  console.error("Liga-Zuordnung erforderlich:");
  for (const failure of error.failures) {
    console.error(`\n${failure.requested.country} | ${failure.requested.league}`);
    if (failure.candidates.length === 0) console.error("  Keine Kandidaten gefunden.");
    for (const candidate of failure.candidates) {
      console.error(
        `  ID ${candidate.leagueId}: ${candidate.country} | ${candidate.league} (${Math.round(candidate.score * 100)} % Ähnlichkeit)`
      );
    }
  }
  console.error(
    '\nAlias speichern: npm run aliases -- --select "Land|Liga" --id 123 --api-country "Country" --api-league "League"'
  );
}

async function analyze(args: ParsedArgs): Promise<void> {
  const input = await analysisInput(args);
  const snapshots = new AnalysisSnapshotCache();
  const reuse = args.options.has("reuse");
  if (input.markets.length === 1 && input.markets[0] === "draw") {
    let result = reuse
      ? await snapshots.get<DrawAnalysisResult>("draw", input)
      : null;
    if (!result) {
      const database = new AnalyzerDatabase();
      try {
        result = await runDrawCriteriaAnalysis(input, { database });
        await snapshots.set("draw", input, result);
      } finally {
        database.close();
      }
    }
    const filtered = filterProfileResult(result, args);
    if (args.options.has("json")) console.log(JSON.stringify(filtered, null, 2));
    else console.log(formatDrawAnalysis(filtered));
    return;
  }
  if (input.markets.length === 1 && input.markets[0] === "1x2") {
    let result = reuse
      ? await snapshots.get<FavoriteAnalysisResult>("favorites", input)
      : null;
    if (!result) {
      const database = new AnalyzerDatabase();
      try {
        result = await runFavoriteAnalysis(input, { database });
        await snapshots.set("favorites", input, result);
      } finally {
        database.close();
      }
    }
    const filtered = filterProfileResult(result, args);
    if (args.options.has("json")) console.log(JSON.stringify(filtered, null, 2));
    else console.log(formatFavoriteAnalysis(filtered));
    return;
  }
  let result = reuse
    ? await snapshots.get<AnalysisResult>("all", input)
    : null;
  if (!result) {
    result = await runAnalysis(input);
    await snapshots.set("all", input, result);
  }
  const filtered = filterAnalysisResult(result, args);
  if (args.options.has("json")) console.log(JSON.stringify(filtered, null, 2));
  else console.log(formatAnalysis(filtered));
}

async function settle(): Promise<void> {
  const client = new ApiFootballClient();
  const database = new AnalyzerDatabase();
  const fixtureIds = database.unsettledFixtures();
  let settled = 0;
  for (const fixtureId of fixtureIds) {
    const fixture = (await client.getFixture(fixtureId, true))[0];
    if (fixture) settled += database.settleFixture(fixture);
  }
  database.close();
  console.log(`${settled} Kandidaten aus ${fixtureIds.length} fälligen Spielen abgerechnet.`);
}

async function goals(args: ParsedArgs): Promise<void> {
  const input = await analysisInput(args);
  const snapshots = new AnalysisSnapshotCache();
  let result = args.options.has("reuse")
    ? await snapshots.get<GoalLineAnalysisResult>("goals", input)
    : null;
  if (!result) {
    const database = new AnalyzerDatabase();
    try {
      result = await runGoalLineAnalysis(input, { database });
      await snapshots.set("goals", input, result);
    } finally {
      database.close();
    }
  }
  const filtered = filterGoalLineResult(result, args);
  if (args.options.has("json")) console.log(JSON.stringify(filtered, null, 2));
  else console.log(formatGoalLineAnalysis(filtered));
}

function report(): void {
  const database = new AnalyzerDatabase();
  const rows = database.report();
  const profileRows = database.profileReport();
  const baselineRows = database.marketBaseline(1.4);
  const topKRows = database.topKReport(1.4);
  const goalLineRows = database.goalLineReport();
  const outcomeRows = database.outcomeProbabilityReport();
  database.close();
  if (rows.length === 0 && profileRows.length === 0 && goalLineRows.length === 0) {
    console.log("Noch keine abgerechneten Kandidaten vorhanden.");
    return;
  }
  if (goalLineRows.length > 0) {
    console.log("\n## Torlinien-Modell\n");
    console.log("| Modell | Markt | Stichprobe | Treffer | Trefferquote | Ø Wahrscheinlichkeit | Brier Score | 95-%-Intervall |");
    console.log("|---|---|---:|---:|---:|---:|---:|---:|");
    for (const row of goalLineRows) {
      const market = `${row.direction === "over" ? "Über" : "Unter"} ${row.line}`;
      console.log(
        `| ${row.modelVersion} | ${market} | ${row.total} | ${row.hits} | ${percent(row.hitRate)} | ${percent(row.averageProbability)} | ${row.brierScore.toFixed(3)} | ${percent(row.intervalLow)}–${percent(row.intervalHigh)} |`
      );
    }
  }
  if (outcomeRows.length > 0) {
    console.log("\n## Wahrscheinlichkeitsmodell: 1X2, Remis und BTTS\n");
    console.log("| Markt | Stichprobe | Treffer | Trefferquote | Ø Prognose | Brier Score | 95-%-Intervall |");
    console.log("|---|---:|---:|---:|---:|---:|---:|");
    for (const row of outcomeRows) {
      console.log(
        `| ${row.market.toUpperCase()} | ${row.total} | ${row.hits} | ${percent(row.hitRate)} | ${percent(row.averageProbability)} | ${row.brierScore.toFixed(3)} | ${percent(row.intervalLow)}–${percent(row.intervalHigh)} |`
      );
    }
  }
  console.log("# Modellbericht\n");
  for (const row of rows) {
    console.log(
      `- ${row.market}: ${row.hits}/${row.total} Treffer (${percent(row.hitRate)}), ` +
      `Ø Prognose ${percent(row.averageProbability)}, Brier Score ${row.brierScore.toFixed(3)}`
    );
  }
  if (profileRows.length > 0) {
    console.log("\n## Remis- und 1X2-Profile\n");
    console.log("| Modell | Profil | Band | Stichprobe | Treffer | Trefferquote | Abdeckung | 95-%-Intervall |");
    console.log("|---|---|---:|---:|---:|---:|---:|---:|");
    for (const row of profileRows) {
      console.log(
        `| ${row.modelVersion} | ${row.profile} | ${row.band} | ${row.total} | ${row.hits} | ${percent(row.hitRate)} | ${percent(row.coverage)} | ${percent(row.intervalLow)}–${percent(row.intervalHigh)} |`
      );
    }
  }
  if (baselineRows.length > 0) {
    console.log("\n## Marktbaseline (1X2, API-Quote ab 1,40)\n");
    console.log("| Modell | Stichprobe | Treffer | Trefferquote | Abdeckung | 95-%-Intervall |");
    console.log("|---|---:|---:|---:|---:|---:|");
    for (const row of baselineRows) {
      console.log(
        `| ${row.modelVersion} | ${row.total} | ${row.hits} | ${percent(row.hitRate)} | ${percent(row.coverage)} | ${percent(row.intervalLow)}–${percent(row.intervalHigh)} |`
      );
    }
  }
  if (topKRows.length > 0) {
    console.log("\n## Kombi-Ranking je Spieltag (API-Quote ab 1,40)\n");
    console.log("| Modell | Rang | Stichprobe | Treffer | Trefferquote | Abdeckung | 95-%-Intervall |");
    console.log("|---|---:|---:|---:|---:|---:|---:|");
    for (const row of topKRows) {
      console.log(
        `| ${row.modelVersion} | Top ${row.topK} | ${row.total} | ${row.hits} | ${percent(row.hitRate)} | ${percent(row.coverage)} | ${percent(row.intervalLow)}–${percent(row.intervalHigh)} |`
      );
    }
  }
}

async function aliases(args: ParsedArgs): Promise<void> {
  const selection = selectionsFromArgs(args)[0];
  const leagueId = Number(option(args, "id"));
  const country = option(args, "api-country");
  const league = option(args, "api-league");
  if (!selection || !Number.isInteger(leagueId) || !country || !league) {
    throw new Error(
      'Erforderlich: --select "Land|Liga" --id 123 --api-country "Country" --api-league "League"'
    );
  }
  await saveAlias(selection, { leagueId, country, league });
  console.log(`Alias gespeichert: ${selection.country} | ${selection.league} → ${country} | ${league} (${leagueId})`);
}

async function teamAliases(args: ParsedArgs): Promise<void> {
  const tipicoName = option(args, "tipico");
  const teamId = Number(option(args, "id"));
  const apiTeamName = option(args, "api-team");
  if (!tipicoName || !Number.isInteger(teamId) || teamId <= 0 || !apiTeamName) {
    throw new Error(
      'Erforderlich: --tipico "Tipico-Teamname" --id 123 --api-team "API-Teamname"'
    );
  }
  await saveTeamAlias(tipicoName, { id: teamId, name: apiTeamName });
  console.log(`Team-Alias gespeichert: ${tipicoName} → ${apiTeamName} (${teamId})`);
}

async function smoke(): Promise<void> {
  const result = await new ApiFootballClient().smoke();
  console.log(JSON.stringify(result, null, 2));
}

async function live(args: ParsedArgs): Promise<void> {
  const selections = matchesFromArgs(args);
  if (selections.length === 0) {
    throw new Error('Mindestens eine sichtbare Partie ist erforderlich: --match "Heimteam|Auswärtsteam"');
  }
  const result = await runLiveAnalysis(selections);
  if (args.options.has("json")) console.log(JSON.stringify(result, null, 2));
  else console.log(formatLiveAnalysis(result));
}

async function strength(args: ParsedArgs): Promise<void> {
  const seasons = Number(option(args, "seasons") ?? 3);
  const requestBudget = Number(option(args, "request-budget") ?? 100);
  if (!Number.isInteger(seasons) || seasons < 1 || seasons > 10) {
    throw new Error("--seasons muss eine ganze Zahl zwischen 1 und 10 sein.");
  }
  if (!Number.isInteger(requestBudget) || requestBudget < 1) {
    throw new Error("--request-budget muss eine positive ganze Zahl sein.");
  }
  const result = await buildLeagueStrength({ seasons, requestBudget });
  console.log(JSON.stringify(result, null, 2));
}

async function venueForm(args: ParsedArgs): Promise<void> {
  const strongMinimum = numericOption(args, "strong-form") ?? 70;
  const weakMaximum = numericOption(args, "weak-form") ?? 50;
  const minimumOdds = numericOption(args, "min-odds") ?? 1.3;
  if (strongMinimum < 0 || strongMinimum > 100) {
    throw new Error("--strong-form muss zwischen 0 und 100 liegen.");
  }
  if (weakMaximum < 0 || weakMaximum > 100) {
    throw new Error("--weak-form muss zwischen 0 und 100 liegen.");
  }
  if (minimumOdds <= 1) throw new Error("--min-odds muss größer als 1 sein.");
  const result = await runVenueFormFilter({
    strongMinimum,
    weakMaximum,
    minimumOdds
  });
  if (args.options.has("json")) console.log(JSON.stringify(result, null, 2));
  else console.log(formatVenueFormResult(result));
}

async function dashboard(args: ParsedArgs): Promise<void> {
  const sourceFile = path.resolve(option(args, "input") ?? path.join(ROOT_DIR, "data.json"));
  const dates = (option(args, "dates") ?? "next48") as DateRange;
  if (!["today", "tomorrow", "both", "next48", "three", "five", "seven", "fourteen", "twentyone"].includes(dates)) {
    throw new Error("--dates muss today, tomorrow, both, next48, three, five, seven, fourteen oder twentyone sein.");
  }
  const imported = await importTipicoData(sourceFile, dates);
  const database = new AnalyzerDatabase();
  try {
    database.saveTipicoImport({
      sourceFile,
      dateRange: dates,
      totalEvents: imported.totalEvents,
      selectedEvents: imported.selectedEvents,
      selectedCompetitions: imported.selectedCompetitions,
      events: imported.events
    });
    const client = imported.selectedEvents > 0 ? new ApiFootballClient() : null;
    const emptyBase = {
      createdAt: new Date().toISOString(),
      dates: [],
      rows: [],
      apiRequests: 0,
      apiRequestsRemaining: null
    };
    const goalsResult = client
      ? await runGoalLineAnalysis(imported.input, { client, database })
      : emptyBase;
    const drawResult = client
      ? await runDrawCriteriaAnalysis(imported.input, { client, database })
      : emptyBase;
    const favoriteResult = client
      ? await runFavoriteAnalysis(imported.input, { client, database })
      : emptyBase;
    const files = await writeDashboard({
      createdAt: goalsResult.createdAt,
      sourceFile,
      totalTipicoEvents: imported.totalEvents,
      selectedTipicoEvents: imported.selectedEvents,
      selectedCompetitions: imported.selectedCompetitions,
      draw: drawResult,
      favorites: favoriteResult,
      goals: goalsResult,
      tipicoOdds: imported.input.tipicoOdds ?? []
    });
    console.log(`Dashboard-Daten erstellt: ${files.latest}`);
    console.log(`JSON-Snapshot gespeichert: ${files.snapshot}`);
    console.log(`Tipico: ${imported.selectedEvents}/${imported.totalEvents} Events · ${imported.selectedCompetitions} Wettbewerbe`);
    if (client) {
      console.log(`API-Aufrufe: ${client.requestCount}${client.requestsRemaining === null ? "" : ` · heute verbleibend: ${client.requestsRemaining}`}`);
    }
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0] ?? "analyze";
  if (command === "analyze") await analyze(args);
  else if (command === "dashboard") await dashboard(args);
  else if (command === "goals") await goals(args);
  else if (command === "settle") await settle();
  else if (command === "report") report();
  else if (command === "aliases") await aliases(args);
  else if (command === "team-aliases") await teamAliases(args);
  else if (command === "smoke") await smoke();
  else if (command === "strength") await strength(args);
  else if (command === "venue-form") await venueForm(args);
  else if (command === "live") await live(args);
  else throw new Error(`Unbekannter Befehl "${command}".`);
}

main().catch((error: unknown) => {
  if (error instanceof LeagueResolutionError) {
    printResolutionError(error);
    process.exitCode = 2;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
