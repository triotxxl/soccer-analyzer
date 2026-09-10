import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, ROOT_DIR } from "./config.ts";
import { teamNameSimilarity } from "./team-resolver.ts";
import type { DefensiveProfile, DrawAnalysisResult, FavoriteAnalysisResult, GoalLineAnalysisResult, GoalLineRow, LeagueStats, LeagueStrengthComparison, RecentMatchSummary, TipicoOdds } from "./types.ts";

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
export type DashboardMarketKey =
  | "1x2" | "draw"
  | "btts" | "bttsNo"
  | "over15" | "under15"
  | "over25" | "under25"
  | "over35" | "under35"
  | "firstHalfOver05" | "firstHalfUnder05"
  | "firstHalfOver15" | "firstHalfUnder15";
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
  /**
   * false, wenn die Wahrscheinlichkeit auf einer Basis steht, die den Klassenunterschied
   * nicht abbilden kann: eine Cross-League-Partie ohne Ligastärke-Vergleich. Der Torfaktor
   * ist dann 1,0, und das heißt nicht "beide Ligen sind gleich stark", sondern "über die
   * Ligen ist nichts bekannt". Value und Kelly setzen darauf nicht auf. Das Feld fehlt in
   * Snapshots vor dieser Änderung und gilt dort als belastbar.
   */
  probabilityReliable?: boolean;
  recommendation: { level: RecommendationLevel; label: string };
  details: string[];
}

/**
 * Deutlicher Klassenunterschied zweier Teams aus verschiedenen Ligen. `rating` stammt aus
 * dem Ligastärke-Vergleich des Modells, `market` aus dem Verhältnis der Tipico-Quoten für
 * 1 und 2 - Letzteres nur, wenn kein Rating existiert. Die Quelle steht bewusst im Feld:
 * eine Markierung aus dem Quotenbild ist eine nachgelagerte Kennzeichnung und ändert weder
 * den sportlichen Tipp noch eine Wahrscheinlichkeit.
 */
export interface ClassGap {
  level: "clear" | "extreme";
  stronger: "home" | "away";
  source: "rating" | "market";
  label: string;
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
  classGap?: ClassGap;
  dataConfidence: number;
  warnings: string[];
  h2hNotice: string | null;
  form: { scope: "venue" | "overall"; home: FormResult[]; away: FormResult[]; homeMatches: RecentMatchSummary[]; awayMatches: RecentMatchSummary[] };
  h2h: {
    outcomes: FormResult[];
    btts: boolean[];
    draws: number;
    consecutiveDraws: number;
    matches: RecentMatchSummary[];
  };
  defense?: { home: DefensiveProfile; away: DefensiveProfile };
  strength?: LeagueStrengthComparison;
  table?: Array<{
    position: number;
    teamName: string;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
  }>;
  expectedGoals: { home: number; away: number; total: number };
  expectedFirstHalfGoals?: { home: number; away: number; total: number };
  scores: { favorite: number | null; draw: number | null };
  markets: DashboardMarket[];
}

export interface DashboardDocument {
  schemaVersion: 1 | 2 | 3 | 4;
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
  leagues: LeagueStats[];
}

/**
 * Schwellen der Empfehlungsampel. Sie steuern allein die Einfaerbung im Dashboard - Kelly
 * rechnet mit Wahrscheinlichkeit und Quote und sieht sie nie.
 *
 * Die Werte der Gegenmaerkte sind nicht aus dem Basismarkt gespiegelt, sondern an der
 * Haeufigkeit des Ereignisses ausgerichtet: Unter 1,5 tritt in etwa jeder vierten Partie ein,
 * eine uebernommene Schwelle von 0,75 waere dort nie erreichbar und der Markt bliebe dauerhaft
 * ohne Empfehlung.
 */
const thresholds: Record<DashboardMarketKey, { recommended: number; strong: number }> = {
  "1x2": { recommended: 0.60, strong: 0.70 },
  draw: { recommended: 0.28, strong: 0.34 },
  btts: { recommended: 0.62, strong: 0.70 },
  bttsNo: { recommended: 0.55, strong: 0.65 },
  over15: { recommended: 0.75, strong: 0.85 },
  under15: { recommended: 0.35, strong: 0.45 },
  over25: { recommended: 0.60, strong: 0.70 },
  under25: { recommended: 0.55, strong: 0.65 },
  over35: { recommended: 0.35, strong: 0.45 },
  under35: { recommended: 0.65, strong: 0.75 },
  firstHalfOver05: { recommended: 0.70, strong: 0.80 },
  firstHalfUnder05: { recommended: 0.40, strong: 0.50 },
  firstHalfOver15: { recommended: 0.35, strong: 0.45 },
  firstHalfUnder15: { recommended: 0.60, strong: 0.70 }
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

// Torfaktor 1,5 entspricht rund 160 Elo-Punkten Unterschied, 2,2 rund 310.
const CLASS_GAP_RATING = { clear: 1.5, extreme: 2.2 };
// Verhältnis der beiden Quoten für 1 und 2. Ein Zehnfaches wie 1,24 zu 12,00 ist ein
// eindeutiges Klassenbild, ein Vierfaches ein deutliches.
const CLASS_GAP_MARKET = { clear: 4, extreme: 8 };

function classGapOf(
  crossLeague: boolean,
  strength: LeagueStrengthComparison | undefined,
  homeOdds: number | null | undefined,
  awayOdds: number | null | undefined
): ClassGap | undefined {
  if (!crossLeague) return undefined;
  const asOdd = (value: number) => value.toFixed(2).replace(".", ",");
  if (strength) {
    const ratio = Math.max(strength.factor, 1 / strength.factor);
    // Eine geschätzte Seite hat kein eigenes Rating und liegt deshalb am Pool-Floor: Wer in
    // der Elo-Kette aus Pokalbegegnungen nie auftaucht, ist unterklassig. Das allein reicht
    // für die untere Stufe, auch wenn der Abschlag den Faktor noch nicht über 1,5 hebt.
    const estimated = !strength.home.reliable || !strength.away.reliable;
    const level = ratio >= CLASS_GAP_RATING.extreme
      ? "extreme"
      : ratio >= CLASS_GAP_RATING.clear || estimated
        ? "clear"
        : null;
    if (!level) return undefined;
    return {
      level,
      stronger: strength.factor >= 1 ? "home" : "away",
      source: "rating",
      label: `Ligastärke ${Math.round(strength.home.rating)} gegen ${Math.round(strength.away.rating)}`
        + `${estimated ? " (eine Seite geschätzt)" : ""} · Torfaktor ${asOdd(strength.factor)}`
    };
  }
  if (!homeOdds || !awayOdds) return undefined;
  const ratio = Math.max(homeOdds / awayOdds, awayOdds / homeOdds);
  const level = ratio >= CLASS_GAP_MARKET.extreme
    ? "extreme"
    : ratio >= CLASS_GAP_MARKET.clear
      ? "clear"
      : null;
  if (!level) return undefined;
  return {
    level,
    stronger: homeOdds <= awayOdds ? "home" : "away",
    source: "market",
    label: `Quotenbild ${asOdd(homeOdds)} gegen ${asOdd(awayOdds)} · kein Ligastärke-Vergleich vorhanden`
  };
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
    recommendation: result.probabilityReliable === false
      ? { level: "none", label: "Nicht empfehlenswert" }
      : recommendation(result.key, result.probability, result.confidence, result.score ?? undefined, crossLeague)
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
    // Ohne Ligastärke-Vergleich fehlt bei einer Cross-League-Partie genau der Faktor, der
    // den Klassenunterschied trägt. Torsumme und BTTS bleiben davon nahezu unberührt, weil
    // der Faktor die Heimtore multipliziert und die Auswärtstore teilt; die Richtung des
    // Ergebnisses kippt dagegen. Betroffen ist deshalb allein die 1X2-Wahrscheinlichkeit.
    const outcomeUnreliable = crossLeague && !row.strength;
    const classGap = classGapOf(crossLeague, row.strength, tipico?.home, tipico?.away);
    const strengthDetail = row.strength
      ? `Ligastärke: ${row.homeTeam} ${Math.round(row.strength.home.rating)}${row.strength.home.reliable ? "" : " (geschätzt)"}`
        + ` vs. ${row.awayTeam} ${Math.round(row.strength.away.rating)}${row.strength.away.reliable ? "" : " (geschätzt)"}`
        + ` · Torfaktor ${row.strength.factor.toFixed(2)}`
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
        ...(outcomeUnreliable ? { probabilityReliable: false } : {}),
        details: [
          `Sportlicher Tipp: ${selection} · ${selectedTeam}`,
          ...(outcomeUnreliable
            ? ["Ohne Ligastärke-Vergleich keine belastbare Wahrscheinlichkeit; Value und Kelly bleiben aus"]
            : []),
          favorite ? `1X2-Profil: ${favorite.rating} · ${favorite.score} Punkte` : "Kein separates 1X2-Profil verfügbar",
          ...(strengthDetail ? [strengthDetail] : []),
          ...sharedDetails
        ]
      }),
      createMarket({
        key: "draw", label: "Remis", selection: "Unentschieden (X)", pick: null, selectionTone: "draw",
        probability: row.outcomeProbabilities.draw, odds: tipico?.draw ?? null,
        confidence: Math.min(row.dataConfidence, draw?.confidence ?? row.dataConfidence), score: draw?.score ?? null,
        crossLeague,
        details: [draw ? `Remis-Profil: ${draw.rating} · ${draw.score} Punkte` : "Kein separates Remis-Profil verfügbar", ...(h2hNotice ? [h2hNotice] : []), ...sharedDetails]
      }),
      // Jeder Gegenmarkt steht direkt hinter seinem Basismarkt, damit die beiden Seiten in der
      // App beieinanderliegen. Die Unter-Wahrscheinlichkeiten kommen unveraendert aus dem
      // Modell - dort sind sie ohnehin die primaer gerechnete Groesse.
      createMarket({
        key: "btts", label: "BTTS", selection: "Beide Teams treffen: Ja", pick: null, selectionTone: "neutral",
        probability: row.outcomeProbabilities.btts, odds: tipico?.bttsYes ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Datenvertrauen: ${row.dataConfidence} %`, ...sharedDetails]
      }),
      createMarket({
        key: "bttsNo", label: "BTTS Nein", selection: "Beide Teams treffen: Nein", pick: null, selectionTone: "neutral",
        probability: 1 - row.outcomeProbabilities.btts, odds: tipico?.bttsNo ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Datenvertrauen: ${row.dataConfidence} %`, ...sharedDetails]
      }),
      createMarket({
        key: "over15", label: "Über 1,5", selection: "Mindestens 2 Tore", pick: null, selectionTone: "neutral",
        probability: row.probabilities.over15, odds: tipico?.over15 ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore gesamt: ${row.expectedTotalGoals.toFixed(2)}`, ...sharedDetails]
      }),
      createMarket({
        key: "under15", label: "Unter 1,5", selection: "Höchstens 1 Tor", pick: null, selectionTone: "neutral",
        probability: row.probabilities.under15, odds: tipico?.under15 ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore gesamt: ${row.expectedTotalGoals.toFixed(2)}`, ...sharedDetails]
      }),
      createMarket({
        key: "over25", label: "Über 2,5", selection: "Mindestens 3 Tore", pick: null, selectionTone: "neutral",
        probability: row.probabilities.over25, odds: tipico?.over25 ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore gesamt: ${row.expectedTotalGoals.toFixed(2)}`, ...sharedDetails]
      }),
      createMarket({
        key: "under25", label: "Unter 2,5", selection: "Höchstens 2 Tore", pick: null, selectionTone: "neutral",
        probability: row.probabilities.under25, odds: tipico?.under25 ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore gesamt: ${row.expectedTotalGoals.toFixed(2)}`, ...sharedDetails]
      }),
      createMarket({
        key: "over35", label: "Über 3,5", selection: "Mindestens 4 Tore", pick: null, selectionTone: "neutral",
        probability: row.probabilities.over35, odds: tipico?.over35 ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore gesamt: ${row.expectedTotalGoals.toFixed(2)}`, ...sharedDetails]
      }),
      createMarket({
        key: "under35", label: "Unter 3,5", selection: "Höchstens 3 Tore", pick: null, selectionTone: "neutral",
        probability: row.probabilities.under35, odds: tipico?.under35 ?? null, confidence: row.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore gesamt: ${row.expectedTotalGoals.toFixed(2)}`, ...sharedDetails]
      }),
      createMarket({
        key: "firstHalfOver05", label: "1. HZ Ü0,5", selection: "1. Halbzeit: mindestens 1 Tor", pick: null, selectionTone: "neutral",
        probability: row.firstHalf.probabilities.over05, odds: tipico?.firstHalfOver05 ?? null, confidence: row.firstHalf.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore 1. Halbzeit: ${row.firstHalf.expectedTotalGoals.toFixed(2)}`, ...firstHalfDetails]
      }),
      createMarket({
        key: "firstHalfUnder05", label: "1. HZ U0,5", selection: "1. Halbzeit: kein Tor", pick: null, selectionTone: "neutral",
        probability: row.firstHalf.probabilities.under05, odds: tipico?.firstHalfUnder05 ?? null, confidence: row.firstHalf.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore 1. Halbzeit: ${row.firstHalf.expectedTotalGoals.toFixed(2)}`, ...firstHalfDetails]
      }),
      createMarket({
        key: "firstHalfOver15", label: "1. HZ Ü1,5", selection: "1. Halbzeit: mindestens 2 Tore", pick: null, selectionTone: "neutral",
        probability: row.firstHalf.probabilities.over15, odds: tipico?.firstHalfOver15 ?? null, confidence: row.firstHalf.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore 1. Halbzeit: ${row.firstHalf.expectedTotalGoals.toFixed(2)}`, ...firstHalfDetails]
      }),
      createMarket({
        key: "firstHalfUnder15", label: "1. HZ U1,5", selection: "1. Halbzeit: höchstens 1 Tor", pick: null, selectionTone: "neutral",
        probability: row.firstHalf.probabilities.under15, odds: tipico?.firstHalfUnder15 ?? null, confidence: row.firstHalf.dataConfidence,
        score: null, crossLeague, details: [`Erwartete Tore 1. Halbzeit: ${row.firstHalf.expectedTotalGoals.toFixed(2)}`, ...firstHalfDetails]
      })
    ];
    return {
      fixtureId: row.fixtureId, kickoff: row.kickoff, country: row.country, league: row.league,
      homeTeam: row.homeTeam, awayTeam: row.awayTeam, modelVersion: row.modelVersion, crossLeague,
      ...(classGap ? { classGap } : {}),
      dataConfidence: row.dataConfidence, warnings, h2hNotice,
      form: {
        scope: crossLeague ? "overall" : "venue",
        home: draw?.recentHomeResults ?? [],
        away: draw?.recentAwayResults ?? [],
        homeMatches: draw?.recentHomeMatches ?? [],
        awayMatches: draw?.recentAwayMatches ?? []
      },
      h2h: {
        outcomes: h2h?.recentHomeTeamResults ?? [], btts: h2h?.recentBttsResults ?? [], draws: h2h?.draws ?? 0,
        consecutiveDraws: h2h?.consecutiveDraws ?? 0, matches: h2h?.recentMatches ?? []
      },
      ...(row.defense ? { defense: row.defense } : {}),
      ...(row.strength ? { strength: row.strength } : {}),
      ...(row.standings ? { table: row.standings.map((standing) => ({
        position: standing.position, teamName: standing.teamName, played: standing.played,
        wins: standing.wins, draws: standing.draws, losses: standing.played - standing.wins - standing.draws,
        points: standing.points, goalsFor: standing.goalsFor, goalsAgainst: standing.goalsAgainst
      })) } : {}),
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
    schemaVersion: 4,
    meta: {
      createdAt: input.createdAt, timezone: config.timezone, sourceFile: input.sourceFile,
      totalTipicoEvents: input.totalTipicoEvents, selectedTipicoEvents: input.selectedTipicoEvents,
      selectedCompetitions: input.selectedCompetitions, fixtureCount: fixtures.length,
      firstAvailableDate, lastAvailableDate, maximumDays,
      maximumHours: Math.max(1, Math.ceil((latestKickoff - createdAt) / 3_600_000))
    },
    fixtures,
    leagues: input.draw.leagues ?? []
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
