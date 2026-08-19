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
}

export const DEFAULT_KELLY_SETTINGS: KellySettings = {
  budget: 100,
  minOdds: 1.5,
  kellyFraction: 0.25,
  maxStakePercent: 0.03,
  maxExposurePercent: 0.25,
  minEdge: 0.02
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
}

export function impliedProbability(odds: number): number {
  return 1 / odds;
}

export function edgeOf(market: DashboardMarket): number | null {
  if (market.odds === null) return null;
  return market.probability - impliedProbability(market.odds);
}

function fullKellyOf(probability: number, odds: number): number {
  return (probability * odds - 1) / (odds - 1);
}

function bestMarketCandidate(
  fixture: DashboardFixture,
  markets: DashboardMarket[],
  settings: KellySettings
): KellyCandidate | null {
  let best: KellyCandidate | null = null;
  for (const market of markets) {
    if (market.odds === null || market.odds < settings.minOdds) continue;
    const edge = market.probability - impliedProbability(market.odds);
    if (edge < settings.minEdge) continue;
    const fullKelly = fullKellyOf(market.probability, market.odds);
    if (fullKelly <= 0) continue;
    if (best !== null && edge <= best.edge) continue;
    const stakePercent = Math.min(fullKelly * settings.kellyFraction, settings.maxStakePercent);
    best = {
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
      stake: settings.budget * stakePercent
    };
  }
  return best;
}

export function computeKellyCandidates(
  fixtures: DashboardFixture[],
  marketFilter: "all" | DashboardMarketKey,
  settings: KellySettings
): { candidates: KellyCandidate[]; evaluated: number; scaleFactor: number } {
  const candidates: KellyCandidate[] = [];
  let evaluated = 0;
  for (const fixture of fixtures) {
    const markets = marketFilter === "all" ? fixture.markets : fixture.markets.filter((market) => market.key === marketFilter);
    if (markets.length === 0) continue;
    evaluated += 1;
    const candidate = bestMarketCandidate(fixture, markets, settings);
    if (candidate) candidates.push(candidate);
  }

  const totalStake = candidates.reduce((sum, candidate) => sum + candidate.stake, 0);
  const exposureCap = settings.budget * settings.maxExposurePercent;
  const scaleFactor = totalStake > exposureCap && totalStake > 0 ? exposureCap / totalStake : 1;
  const scaled = scaleFactor === 1
    ? candidates
    : candidates.map((candidate) => ({
        ...candidate,
        stakePercent: candidate.stakePercent * scaleFactor,
        stake: candidate.stake * scaleFactor
      }));

  return { candidates: scaled, evaluated, scaleFactor };
}

function isKellySettings(value: unknown): value is KellySettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KellySettings>;
  return typeof candidate.budget === "number"
    && typeof candidate.minOdds === "number"
    && typeof candidate.kellyFraction === "number"
    && typeof candidate.maxStakePercent === "number"
    && typeof candidate.maxExposurePercent === "number"
    && typeof candidate.minEdge === "number";
}

export function loadKellySettings(): KellySettings {
  if (typeof window === "undefined") return DEFAULT_KELLY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_KELLY_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return isKellySettings(parsed) ? parsed : DEFAULT_KELLY_SETTINGS;
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
