import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, ROOT_DIR } from "./config.ts";
import { teamNameSimilarity } from "./team-resolver.ts";
import type { DefensiveProfile, DrawAnalysisResult, FavoriteAnalysisResult, GoalLineAnalysisResult, GoalLineRow, TipicoOdds } from "./types.ts";

export interface DashboardInput {
  createdAt: string;
  sourceFile: string;
  totalTipicoEvents: number;
  selectedTipicoEvents: number;
  selectedCompetitions: number;
  draw: DrawAnalysisResult;
  favorites: FavoriteAnalysisResult;
  goals: GoalLineAnalysisResult;
  tipicoOdds: TipicoOdds[];
}

export type RecommendationLevel = "none" | "recommended" | "strong";
export type DashboardMarketKey = "1x2" | "draw" | "btts" | "over15" | "over25" | "firstHalfOver05" | "firstHalfOver15";
export type FormResult = "win" | "draw" | "loss";

export interface DashboardMarket {
  key: DashboardMarketKey;
  label: string;
  selection: string;
  pick: "1" | "2" | null;
  selectionTone: "home" | "away" | "draw" | "neutral";
  probability: number;
  odds: number | null;
  confidence: number;
  score: number | null;
  recommendation: { level: RecommendationLevel; label: string };
  details: string[];
}

export interface DashboardFixture {
  fixtureId: number;
  kickoff: string;
  country: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  modelVersion: string;
  crossLeague: boolean;
  dataConfidence: number;
  warnings: string[];
  h2hNotice: string | null;
  form: { scope: "venue" | "overall"; home: FormResult[]; away: FormResult[] };
  h2h: {
    outcomes: FormResult[];
    btts: boolean[];
    draws: number;
    consecutiveDraws: number;
    matches: Array<{
      date: string;
      homeTeam: string;
      awayTeam: string;
      homeGoals: number;
      awayGoals: number;
      halfTimeHomeGoals?: number | null;
      halfTimeAwayGoals?: number | null;
    }>;
  };
  defense?: { home: DefensiveProfile; away: DefensiveProfile };
  expectedGoals: { home: number; away: number; total: number };
  expectedFirstHalfGoals?: { home: number; away: number; total: number };
  scores: { favorite: number | null; draw: number | null };
  markets: DashboardMarket[];
}

export interface DashboardDocument {
  schemaVersion: 1 | 2 | 3;
  meta: {
    createdAt: string;
    timezone: string;
    sourceFile: string;
    totalTipicoEvents: number;
    selectedTipicoEvents: number;
    selectedCompetitions: number;
    fixtureCount: number;
    firstAvailableDate: string | null;
    lastAvailableDate: string | null;
    maximumDays: number;
    maximumHours: number;
  };
  fixtures: DashboardFixture[];
}

const thresholds: Record<DashboardMarketKey, { recommended: number; strong: number }> = {
  "1x2": { recommended: 0.60, strong: 0.70 },
  draw: { recommended: 0.28, strong: 0.34 },
  btts: { recommended: 0.62, strong: 0.70 },
  over15: { recommended: 0.75, strong: 0.85 },
  over25: { recommended: 0.60, strong: 0.70 },
  firstHalfOver05: { recommended: 0.70, strong: 0.80 },
  firstHalfOver15: { recommended: 0.35, strong: 0.45 }
};

function recommendation(
  market: DashboardMarketKey,
  probability: number,
  confidence: number,
  score?: number,
  crossLeague = false
): DashboardMarket["recommendation"] {
  const minimumConfidence = crossLeague ? 70 : 60;
  if (confidence < minimumConfidence || (score !== undefined && score < 60)) {
    return { level: "none", label: "Nicht empfehlenswert" };
  }
  if (confidence >= 80 && probability >= thresholds[market].strong && (score === undefined || score >= 70)) {
    return { level: "strong", label: "Sehr empfehlenswert" };
  }
  if (confidence >= 70 && probability >= thresholds[market].recommended) {
    return { level: "recommended", label: "Empfehlenswert" };
  }
  return { level: "none", label: "Nicht empfehlenswert" };
}

function matchingOdds(row: GoalLineRow, odds: TipicoOdds[]): TipicoOdds | undefined {
  return odds
    .map((item) => ({ item, score: (teamNameSimilarity(row.homeTeam, item.homeTeam) + teamNameSimilarity(row.awayTeam, item.awayTeam)) / 2 }))
    .filter((item) => item.score >= 0.65)
    .sort((left, right) => right.score - left.score)[0]?.item;
}

function berlinDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function createMarket(input: Omit<DashboardMarket, "recommendation"> & { crossLeague: boolean }): DashboardMarket {
  const { crossLeague, ...result } = input;
  return {
    ...result,
    recommendation: recommendation(result.key, result.probability, result.confidence, result.score ?? undefined, crossLeague)
  };
}

export function buildDashboardDocument(input: DashboardInput): DashboardDocument {
  const drawByFixture = new Map(input.draw.rows.map((row) => [row.fixtureId, row]));
  const favoriteByFixture = new Map(input.favorites.rows.map((row) => [row.fixtureId, row]));
  const fixtures: DashboardFixture[] = input.goals.rows.map((row) => {
    const draw = drawByFixture.get(row.fixtureId);
    const favorite = favoriteByFixture.get(row.fixtureId);
    const tipico = matchingOdds(row, input.tipicoOdds);
    const crossLeague = draw?.model === "cross-league" || favorite?.model === "cross-league";
    const selection = favorite?.selection ?? (row.outcomeProbabilities.home >= row.outcomeProbabilities.away ? "1" : "2");
    const selectedTeam = selection === "1" ? row.homeTeam : row.awayTeam;
    const selectionProbability = selection === "1" ? row.outcomeProbabilities.home : row.outcomeProbabilities.away;
    const h2h = draw?.h2hSummary;
    const warnings = [...new Set([...row.warnings, ...(draw?.warnings ?? []), ...(favorite?.warnings ?? [])])];
    const h2hNotice = h2h && (h2h.consecutiveDraws >= 3 || h2h.allDraws)
      ? `Remis auffällig: ${h2h.consecutiveDraws} direkte Duelle in Folge remis${h2h.allDraws ? `; alle ${h2h.matches} verfügbaren H2H endeten remis` : ""}`
      : null;
    const sharedDetails = warnings.length ? warnings : ["Keine zusätzlichen Warnsignale"];
    const firstHalfDetails = row.firstHalf.warnings.length
      ? row.firstHalf.warnings
      : ["Keine zusätzlichen Halbzeit-Warnsignale"];
    const markets: DashboardMarket[] = [
      createMarket({
        key: "1x2", label: "1X2",
        selection: selection === "1" ? `Heimsieg ${row.homeTeam}` : `Auswärtssieg ${row.awayTeam}`,
        pick: selection, selectionTone: selection === "1" ? "home" : "away",
        probability: selectionProbability, odds: (selection === "1" ? tipico?.home : tipico?.away) ?? null,
        confidence: Math.min(row.dataConfidence, favorite?.confidence ?? row.dataConfidence), score: favorite?.score ?? null,
        crossLeague,
        details: [`Sportlicher Tipp: ${selection} · ${selectedTeam}`, favorite ? `1X2-Profil: ${favorite.rating} · ${favorite.score} Punkte` : "Kein separates 1X2-Profil verfügbar", ...sharedDetails]
      }),
      createMarket({
        key: "draw", label: "Remis", selection: "Unentschieden (X)", pick: null, selectionTone: "draw",
        probability: row.outcomeProbabilities.draw, odds: tipico?.draw ?? null,
        confidence: Math.min(row.dataConfidence, draw?.confidence ?? row.dataConfidence), score: draw?.score ?? null,
        crossLeague,
        details: [draw ? `Remis-Profil: ${draw.rating} · ${draw.score} Punkte` : "Kein separates Remis-Profil verfügbar", ...(h2hNotice ? [h2hNotice] : []), ...sharedDetails]
      }),
      createMarket({
        key: "btts", label: "BTTS", selection: "Beide Teams treffen: Ja", pick: null, selectionTone: "neutral",
        probability: row.outcomeProbabilities.btts, odds: tipico?.bttsYes ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Datenvertrauen: ${row.dataConfidence} %`, ...sharedDetails]
      }),
      createMarket({
        key: "over15", label: "Über 1,5", selection: "Mindestens 2 Tore", pick: null, selectionTone: "neutral",
        probability: row.probabilities.over15, odds: tipico?.over15 ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore gesamt: ${row.expectedTotalGoals.toFixed(2)}`, ...sharedDetails]
      }),
      createMarket({
        key: "over25", label: "Über 2,5", selection: "Mindestens 3 Tore", pick: null, selectionTone: "neutral",
        probability: row.probabilities.over25, odds: tipico?.over25 ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore gesamt: ${row.expectedTotalGoals.toFixed(2)}`, ...sharedDetails]
      }),
      createMarket({
        key: "firstHalfOver05", label: "1. HZ Ü0,5", selection: "1. Halbzeit: mindestens 1 Tor", pick: null, selectionTone: "neutral",
        probability: row.firstHalf.probabilities.over05, odds: tipico?.firstHalfOver05 ?? null, confidence: row.firstHalf.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore 1. Halbzeit: ${row.firstHalf.expectedTotalGoals.toFixed(2)}`, ...firstHalfDetails]
      }),
      createMarket({
        key: "firstHalfOver15", label: "1. HZ Ü1,5", selection: "1. Halbzeit: mindestens 2 Tore", pick: null, selectionTone: "neutral",
        probability: row.firstHalf.probabilities.over15, odds: tipico?.firstHalfOver15 ?? null, confidence: row.firstHalf.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore 1. Halbzeit: ${row.firstHalf.expectedTotalGoals.toFixed(2)}`, ...firstHalfDetails]
      })
    ];
    return {
      fixtureId: row.fixtureId, kickoff: row.kickoff, country: row.country, league: row.league,
      homeTeam: row.homeTeam, awayTeam: row.awayTeam, modelVersion: row.modelVersion, crossLeague,
      dataConfidence: row.dataConfidence, warnings, h2hNotice,
      form: { scope: crossLeague ? "overall" : "venue", home: draw?.recentHomeResults ?? [], away: draw?.recentAwayResults ?? [] },
      h2h: {
        outcomes: h2h?.recentHomeTeamResults ?? [], btts: h2h?.recentBttsResults ?? [], draws: h2h?.draws ?? 0,
        consecutiveDraws: h2h?.consecutiveDraws ?? 0, matches: h2h?.recentMatches ?? []
      },
      ...(row.defense ? { defense: row.defense } : {}),
      expectedGoals: { home: row.expectedHomeGoals, away: row.expectedAwayGoals, total: row.expectedTotalGoals },
      expectedFirstHalfGoals: {
        home: row.firstHalf.expectedHomeGoals,
        away: row.firstHalf.expectedAwayGoals,
        total: row.firstHalf.expectedTotalGoals
      },
      scores: { favorite: favorite?.score ?? null, draw: draw?.score ?? null }, markets
    };
  });

  const dates = [...new Set(fixtures.map((fixture) => berlinDate(fixture.kickoff)))].sort();
  const firstAvailableDate = dates[0] ?? null;
  const lastAvailableDate = dates.at(-1) ?? null;
  const maximumDays = firstAvailableDate && lastAvailableDate
    ? Math.max(1, Math.round((Date.parse(`${lastAvailableDate}T00:00:00Z`) - Date.parse(`${firstAvailableDate}T00:00:00Z`)) / 86_400_000) + 1)
    : 1;
  const createdAt = Date.parse(input.createdAt);
  const latestKickoff = fixtures.reduce((latest, fixture) => Math.max(latest, Date.parse(fixture.kickoff)), createdAt);
  return {
    schemaVersion: 3,
    meta: {
      createdAt: input.createdAt, timezone: config.timezone, sourceFile: input.sourceFile,
      totalTipicoEvents: input.totalTipicoEvents, selectedTipicoEvents: input.selectedTipicoEvents,
      selectedCompetitions: input.selectedCompetitions, fixtureCount: fixtures.length,
      firstAvailableDate, lastAvailableDate, maximumDays,
      maximumHours: Math.max(1, Math.ceil((latestKickoff - createdAt) / 3_600_000))
    },
    fixtures
  };
}

async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function writeDashboard(input: DashboardInput, outputDirectory = path.join(ROOT_DIR, "output")): Promise<{ latest: string; snapshot: string }> {
  await mkdir(outputDirectory, { recursive: true });
  const document = buildDashboardDocument(input);
  const stamp = input.createdAt.replaceAll(":", "-").replaceAll(".", "-");
  const latest = path.join(outputDirectory, "dashboard-latest.json");
  const snapshot = path.join(outputDirectory, `dashboard-${stamp}.json`);
  await Promise.all([atomicWriteJson(latest, document), atomicWriteJson(snapshot, document)]);
  return { latest, snapshot };
}
