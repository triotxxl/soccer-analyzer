import path from "node:path";

const strengthOnDemandRequestBudget = Number(
  process.env.STRENGTH_ON_DEMAND_REQUEST_BUDGET ?? 25
);
const apiRequestsPerMinute = Number(
  process.env.API_REQUESTS_PER_MINUTE ?? 300
);
const apiRequestsPerSecond = Number(
  process.env.API_REQUESTS_PER_SECOND ?? 5
);
const apiDailyReserve = Number(
  process.env.API_DAILY_RESERVE ?? 100
);

export const ROOT_DIR = path.resolve(import.meta.dirname, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const ANALYSIS_CACHE_DIR = path.join(DATA_DIR, "analysis-cache");
export const ALIASES_FILE = path.join(DATA_DIR, "league-aliases.json");
export const TEAM_ALIASES_FILE = path.join(DATA_DIR, "team-aliases.json");
export const DB_FILE = path.join(DATA_DIR, "analyzer.sqlite");

export const config = {
  apiKey: process.env.API_FOOTBALL_KEY ?? "",
  apiBaseUrl: process.env.API_FOOTBALL_BASE_URL ?? "https://v3.football.api-sports.io",
  timezone: process.env.ANALYZER_TIMEZONE ?? "Europe/Berlin",
  timeoutMs: Number(process.env.API_TIMEOUT_MS ?? 15_000),
  apiRequestsPerMinute:
    Number.isInteger(apiRequestsPerMinute) && apiRequestsPerMinute > 0
      ? apiRequestsPerMinute
      : 300,
  apiRequestsPerSecond:
    Number.isFinite(apiRequestsPerSecond) && apiRequestsPerSecond > 0
      ? apiRequestsPerSecond
      : 5,
  apiDailyReserve:
    Number.isInteger(apiDailyReserve) && apiDailyReserve >= 0
      ? apiDailyReserve
      : 100,
  apiRateLimitWindowMs: 60_000,
  apiRateLimitSecondWindowMs: 1_000,
  apiRateLimitRetryMs: 60_000,
  modelVersion: "1.3.0",
  activeProfileVersion: "1.3.0",
  goalLineModelVersion: "2.0.0",
  strengthOnDemandRequestBudget:
    Number.isInteger(strengthOnDemandRequestBudget) &&
    strengthOnDemandRequestBudget > 0
      ? strengthOnDemandRequestBudget
      : 25,
  thresholds: {
    draw: 0.28,
    btts: 0.58,
    over25: 0.60,
    "1x2": 0.60,
    quality: 60
  },
  cacheTtlMs: {
    leagues: 7 * 24 * 60 * 60 * 1000,
    dailyFixtures: 6 * 60 * 60 * 1000,
    seasonFixtures: 24 * 60 * 60 * 1000,
    historicalSeasonFixtures: 10 * 365 * 24 * 60 * 60 * 1000,
    recentTeamFixtures: 24 * 60 * 60 * 1000,
    headToHead: 7 * 24 * 60 * 60 * 1000,
    odds: 6 * 60 * 60 * 1000,
    settledFixtures: 30 * 24 * 60 * 60 * 1000
  }
} as const;

export function requireApiKey(): string {
  if (!config.apiKey) {
    throw new Error(
      "API_FOOTBALL_KEY fehlt. Kopiere .env.example nach .env und trage deinen API-Football-Schlüssel ein."
    );
  }
  return config.apiKey;
}
