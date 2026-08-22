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
const livePollMs = Number(process.env.LIVE_POLL_MS ?? 15_000);
const liveDailyRequestBudget = Number(process.env.LIVE_DAILY_REQUEST_BUDGET ?? 2_000);
const liveAllThreshold = Number(process.env.LIVE_ALL_THRESHOLD ?? 25);

export const ROOT_DIR = path.resolve(import.meta.dirname, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const ANALYSIS_CACHE_DIR = path.join(DATA_DIR, "analysis-cache");
export const ALIASES_FILE = path.join(DATA_DIR, "league-aliases.json");
export const TEAM_ALIASES_FILE = path.join(DATA_DIR, "team-aliases.json");
export const DB_FILE = path.join(DATA_DIR, "analyzer.sqlite");
export const LIVE_SNAPSHOT_DIR = path.join(DATA_DIR, "live-snapshots");
export const LIVE_USAGE_FILE = path.join(DATA_DIR, "live-usage.json");

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
  livePollMs:
    Number.isFinite(livePollMs) && livePollMs >= 5_000 ? livePollMs : 15_000,
  liveDailyRequestBudget:
    Number.isInteger(liveDailyRequestBudget) && liveDailyRequestBudget > 0
      ? liveDailyRequestBudget
      : 2_000,
  liveCandidateLeadMs: 5 * 60 * 1000,
  liveCandidateTrailMs: 200 * 60 * 1000,
  liveStatisticsFallbackTtlMs: 60_000,
  // Ab dieser Anzahl gleichzeitig beobachteter Partien lohnt sich /fixtures?live=all:
  // ein Call für Spielstand, Minute und Ereignisse aller Partien statt einem je 20.
  // Darunter ist die reine Bündelung günstiger, weil sie die Statistiken gleich mitliefert.
  liveAllThreshold:
    Number.isInteger(liveAllThreshold) && liveAllThreshold > 0 ? liveAllThreshold : 25,
  // Statistiken ändern sich laut API-Dokumentation nur etwa einmal pro Minute.
  liveStatisticsRefreshMs: 60_000,
  apiRateLimitWindowMs: 60_000,
  apiRateLimitSecondWindowMs: 1_000,
  apiRateLimitRetryMs: 60_000,
  modelVersion: "1.3.0",
  activeProfileVersion: "1.3.0",
  goalLineModelVersion: "3.1.0",
  xgEnrichmentRequestBudget: 250,
  strengthOnDemandRequestBudget:
    Number.isInteger(strengthOnDemandRequestBudget) &&
    strengthOnDemandRequestBudget > 0
      ? strengthOnDemandRequestBudget
      : 25,
  strength: {
    // Elo-Differenz zweier Ligen -> Torfaktor je Seite: 10 ** (delta / factorDivisor).
    // Seit dem neutralen Maßstab im Modell trägt dieser Faktor den Klassenunterschied
    // allein; vorher hat die schiefe Pokal-Torbasis einen Teil davon verdeckt mitgetragen.
    // Kalibriert am DFB-Pokal-Lauf vom 22.08.2026 (21 Partien mit Quote): mittlere
    // absolute Abweichung zur Marktwahrscheinlichkeit 9,6 pp bei einem Bias von -3,5 pp.
    // Der Bias wird bewusst nicht auf null gezogen, weil 1/Quote die Buchmachermarge
    // enthält und die Marktwahrscheinlichkeit dadurch überzeichnet ist.
    // Die Grenzen sind so gewählt, dass im gemessenen Feld kein Faktor am Clamp hängt -
    // sonst unterscheidet das Modell große Klassenunterschiede nicht mehr voneinander.
    // Basis ist eine einzige Pokalrunde; mit abgerechneten Ergebnissen aus `npm run report`
    // gehört das nachgezogen.
    factorDivisor: 900,
    factorMin: 0.3,
    factorMax: 3.5,
    // Abschlag auf das schwächste belastbare Rating des Pools für Ligen ohne eigenes
    // Rating. Wer nie in der Elo-Kette auftaucht, ist unterklassig, nicht Mittelfeld.
    // Am selben Lauf kalibriert (11 der 22 Partien hatten eine geschätzte Seite). Zwischen
    // 120 und 300 ist die Abweichung praktisch flach; gewählt ist der konservative Rand,
    // damit das Modell eher unter- als überschätzt - Überschätzung schlägt unmittelbar auf
    // die Kelly-Einsätze durch.
    unratedPenalty: 120
  },
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
    fixtureExpectedGoals: 24 * 60 * 60 * 1000,
    settledFixtures: 30 * 24 * 60 * 60 * 1000
  }
} as const;

export function requireApiKey(): string {
  // Bewusst bei jedem Aufruf frisch aus der Umgebung gelesen: Die lokale App lädt .env
  // erst beim Start des Vite-Servers, also nach dem Import dieses Moduls. Ein zum
  // Importzeitpunkt eingefrorener Wert wäre dort immer leer.
  const apiKey = process.env.API_FOOTBALL_KEY || config.apiKey;
  if (!apiKey) {
    throw new Error(
      "API_FOOTBALL_KEY fehlt. Kopiere .env.example nach .env und trage deinen API-Football-Schlüssel ein."
    );
  }
  return apiKey;
}
