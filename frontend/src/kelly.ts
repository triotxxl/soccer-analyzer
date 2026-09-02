import type { DashboardFixture, DashboardMarket, DashboardMarketKey } from "./types";

const STORAGE_KEY = "football-analyzer:kelly-settings";
const VISIBLE_STORAGE_KEY = "football-analyzer:kelly-visible";

export interface KellySettings {
  budget: number;
  minOdds: number;
  kellyFraction: number;
  maxStakePercent: number;
  maxExposurePercent: number;
  minEdge: number;
  allowMultipleMarketsPerGame: boolean;
  enableGameRiskLimit: boolean;
  maxRiskPerGame: number;
}

export const DEFAULT_KELLY_SETTINGS: KellySettings = {
  budget: 100,
  minOdds: 1.5,
  kellyFraction: 0.25,
  maxStakePercent: 0.03,
  maxExposurePercent: 0.25,
  minEdge: 0.02,
  allowMultipleMarketsPerGame: false,
  enableGameRiskLimit: true,
  maxRiskPerGame: 0.05
};

export interface KellyCandidate {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  kickoff: string;
  marketKey: DashboardMarketKey;
  marketLabel: string;
  selection: string;
  odds: number;
  probability: number;
  impliedProbability: number;
  edge: number;
  fullKelly: number;
  stakePercent: number;
  stake: number;
  gameScaleFactor: number;
}

// Risk of a single fixture across all of its markets, measured after the per-bet cap but
// before the portfolio-wide exposure scaling.
export interface GameRiskLimit {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  limit: number;
  stakeBefore: number;
  stakeAfter: number;
  scaleFactor: number;
}

export function impliedProbability(odds: number): number {
  return 1 / odds;
}

// Eine Wahrscheinlichkeit ohne belastbare Basis liefert keinen Value: die Differenz zur
// Quote misst dann nicht den Vorteil gegenüber dem Markt, sondern nur die fehlende
// Klassenkorrektur des Modells.
export function edgeOf(market: DashboardMarket): number | null {
  if (market.odds === null || market.probabilityReliable === false) return null;
  return market.probability - impliedProbability(market.odds);
}

function fullKellyOf(probability: number, odds: number): number {
  return (probability * odds - 1) / (odds - 1);
}

function candidateOf(
  fixture: DashboardFixture,
  market: DashboardMarket,
  settings: KellySettings
): KellyCandidate | null {
  if (market.odds === null || market.odds < settings.minOdds) return null;
  if (market.probabilityReliable === false) return null;
  const edge = market.probability - impliedProbability(market.odds);
  if (edge < settings.minEdge) return null;
  const fullKelly = fullKellyOf(market.probability, market.odds);
  if (fullKelly <= 0) return null;
  const stakePercent = Math.min(fullKelly * settings.kellyFraction, settings.maxStakePercent);
  return {
    fixtureId: fixture.fixtureId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    league: fixture.league,
    country: fixture.country,
    kickoff: fixture.kickoff,
    marketKey: market.key,
    marketLabel: market.label,
    selection: market.selection,
    odds: market.odds,
    probability: market.probability,
    impliedProbability: impliedProbability(market.odds),
    edge,
    fullKelly,
    stakePercent,
    stake: settings.budget * stakePercent,
    gameScaleFactor: 1
  };
}

function marketCandidates(
  fixture: DashboardFixture,
  markets: DashboardMarket[],
  settings: KellySettings
): KellyCandidate[] {
  const candidates: KellyCandidate[] = [];
  let best: KellyCandidate | null = null;
  for (const market of markets) {
    const candidate = candidateOf(fixture, market, settings);
    if (candidate === null) continue;
    if (settings.allowMultipleMarketsPerGame) { candidates.push(candidate); continue; }
    if (best === null || candidate.edge > best.edge) best = candidate;
  }
  if (settings.allowMultipleMarketsPerGame) return candidates;
  return best === null ? [] : [best];
}

// Additional portfolio control after the per-market Kelly stakes are final: markets of the
// same fixture are correlated, so their combined risk is capped and scaled proportionally.
// This never changes the Kelly maths, it only shrinks stakes that are already computed.
function applyGameRiskLimit(
  candidates: KellyCandidate[],
  settings: KellySettings
): { candidates: KellyCandidate[]; games: GameRiskLimit[] } {
  if (!settings.enableGameRiskLimit) return { candidates, games: [] };

  const groups = new Map<number, KellyCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.fixtureId);
    if (group) group.push(candidate);
    else groups.set(candidate.fixtureId, [candidate]);
  }

  const limit = settings.budget * settings.maxRiskPerGame;
  const factors = new Map<number, number>();
  const games: GameRiskLimit[] = [];
  for (const [fixtureId, group] of groups) {
    const stakeBefore = group.reduce((sum, candidate) => sum + candidate.stake, 0);
    const scaleFactor = stakeBefore > limit && stakeBefore > 0 ? limit / stakeBefore : 1;
    factors.set(fixtureId, scaleFactor);
    const first = group[0]!;
    games.push({
      fixtureId,
      homeTeam: first.homeTeam,
      awayTeam: first.awayTeam,
      limit,
      stakeBefore,
      stakeAfter: stakeBefore * scaleFactor,
      scaleFactor
    });
  }

  const scaled = candidates.map((candidate) => {
    const scaleFactor = factors.get(candidate.fixtureId) ?? 1;
    if (scaleFactor === 1) return candidate;
    return {
      ...candidate,
      stakePercent: candidate.stakePercent * scaleFactor,
      stake: candidate.stake * scaleFactor,
      gameScaleFactor: scaleFactor
    };
  });

  return { candidates: scaled, games };
}

export function computeKellyCandidates(
  fixtures: DashboardFixture[],
  marketFilter: "all" | DashboardMarketKey,
  settings: KellySettings
): { candidates: KellyCandidate[]; evaluated: number; scaleFactor: number; gameRiskLimits: GameRiskLimit[] } {
  const candidates: KellyCandidate[] = [];
  let evaluated = 0;
  for (const fixture of fixtures) {
    const markets = marketFilter === "all" ? fixture.markets : fixture.markets.filter((market) => market.key === marketFilter);
    if (markets.length === 0) continue;
    evaluated += 1;
    candidates.push(...marketCandidates(fixture, markets, settings));
  }

  const limited = applyGameRiskLimit(candidates, settings);

  const totalStake = limited.candidates.reduce((sum, candidate) => sum + candidate.stake, 0);
  const exposureCap = settings.budget * settings.maxExposurePercent;
  const scaleFactor = totalStake > exposureCap && totalStake > 0 ? exposureCap / totalStake : 1;
  const scaled = scaleFactor === 1
    ? limited.candidates
    : limited.candidates.map((candidate) => ({
        ...candidate,
        stakePercent: candidate.stakePercent * scaleFactor,
        stake: candidate.stake * scaleFactor
      }));

  return { candidates: scaled, evaluated, scaleFactor, gameRiskLimits: limited.games };
}

export interface KellyExport {
  generatedAt: string;
  marketFilter: "all" | DashboardMarketKey;
  marketLabel: string;
  settings: KellySettings;
  summary: {
    evaluated: number;
    candidates: number;
    totalStake: number;
    exposureScaleFactor: number;
    limitedGames: number;
  };
  gameRiskLimits: GameRiskLimit[];
  bets: KellyCandidate[];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function twoDigitPart(value: number): string {
  return String(value).padStart(2, "0");
}

export function kellyExportFileName(marketFilter: "all" | DashboardMarketKey, date = new Date()): string {
  const day = `${date.getFullYear()}-${twoDigitPart(date.getMonth() + 1)}-${twoDigitPart(date.getDate())}`;
  return `kelly-${marketFilter}-${day}.json`;
}

// Snapshot of the list as it is shown in the dialog. Euro amounts are rounded to cents like
// the table does, the remaining ratios keep six digits so float noise stays out of the file.
export function buildKellyExport(
  result: { candidates: KellyCandidate[]; evaluated: number; scaleFactor: number; gameRiskLimits: GameRiskLimit[] },
  context: {
    marketFilter: "all" | DashboardMarketKey;
    marketLabel: string;
    settings: KellySettings;
    generatedAt?: Date;
  }
): KellyExport {
  return {
    generatedAt: (context.generatedAt ?? new Date()).toISOString(),
    marketFilter: context.marketFilter,
    marketLabel: context.marketLabel,
    settings: context.settings,
    summary: {
      evaluated: result.evaluated,
      candidates: result.candidates.length,
      totalStake: round(result.candidates.reduce((sum, candidate) => sum + candidate.stake, 0), 2),
      exposureScaleFactor: round(result.scaleFactor, 6),
      limitedGames: result.gameRiskLimits.filter((game) => game.scaleFactor < 1).length
    },
    gameRiskLimits: result.gameRiskLimits.map((game) => ({
      ...game,
      limit: round(game.limit, 2),
      stakeBefore: round(game.stakeBefore, 2),
      stakeAfter: round(game.stakeAfter, 2),
      scaleFactor: round(game.scaleFactor, 6)
    })),
    bets: result.candidates.map((candidate) => ({
      ...candidate,
      probability: round(candidate.probability, 6),
      impliedProbability: round(candidate.impliedProbability, 6),
      edge: round(candidate.edge, 6),
      fullKelly: round(candidate.fullKelly, 6),
      stakePercent: round(candidate.stakePercent, 6),
      stake: round(candidate.stake, 2),
      gameScaleFactor: round(candidate.gameScaleFactor, 6)
    }))
  };
}

function isOptionalType(value: unknown, type: "number" | "boolean"): boolean {
  return value === undefined || typeof value === type;
}

function isKellySettings(value: unknown): value is Partial<KellySettings> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KellySettings>;
  return typeof candidate.budget === "number"
    && typeof candidate.minOdds === "number"
    && typeof candidate.kellyFraction === "number"
    && typeof candidate.maxStakePercent === "number"
    && typeof candidate.maxExposurePercent === "number"
    && typeof candidate.minEdge === "number"
    // Settings stored before the game risk limit existed lack these keys - they inherit the
    // defaults instead of invalidating the whole stored state.
    && isOptionalType(candidate.allowMultipleMarketsPerGame, "boolean")
    && isOptionalType(candidate.enableGameRiskLimit, "boolean")
    && isOptionalType(candidate.maxRiskPerGame, "number");
}

export function loadKellySettings(): KellySettings {
  if (typeof window === "undefined") return DEFAULT_KELLY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_KELLY_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return isKellySettings(parsed) ? { ...DEFAULT_KELLY_SETTINGS, ...parsed } : DEFAULT_KELLY_SETTINGS;
  } catch {
    return DEFAULT_KELLY_SETTINGS;
  }
}

export function saveKellySettings(settings: KellySettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, quota) - settings just stay in-memory for this session.
  }
}

export function loadKellyVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(VISIBLE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveKellyVisible(visible: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VISIBLE_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    // Storage unavailable - preference just stays in-memory for this session.
  }
}
