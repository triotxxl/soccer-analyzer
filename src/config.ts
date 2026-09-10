import path from "node:path";

const strengthOnDemandRequestBudget = Number(
  process.env.STRENGTH_ON_DEMAND_REQUEST_BUDGET ?? 25
);
const settleRequestBudget = Number(
  process.env.SETTLE_REQUEST_BUDGET ?? 200
);
const settleConcurrency = Number(
  process.env.SETTLE_CONCURRENCY ?? 1
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
const insightsHistoryLimit = Number(process.env.INSIGHTS_HISTORY_LIMIT ?? 20);
const insightsH2hLimit = Number(process.env.INSIGHTS_H2H_LIMIT ?? 10);

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
  // Wiederholungen bei Verbindungsfehlern und Timeouts. Ein Lauf macht mehrere tausend
  // Anfragen; ohne Wiederholung reicht ein einzelner Aussetzer, um alles abzubrechen.
  apiTransportRetries: 3,
  apiTransportRetryMs: 1_000,
  modelVersion: "1.3.0",
  activeProfileVersion: "1.3.0",
  goalLineModelVersion: "3.2.0",
  xgEnrichmentRequestBudget: 250,
  // Rekalibrierung der Torerwartung: tatsächliche Torsumme = intercept + slope * erwartete.
  // Kleinste Quadrate über 1306 abgerechnete Ligapartien der Version 3.1.0 (02.08.-29.08.2026),
  // geprüft auf 560 später angepfiffenen Partien, die nicht im Fit stecken.
  //
  // Zwei Fehler stecken in derselben Zahl. Der Pegel: 3.1.0 erwartet im Mittel 2,70 Tore,
  // gefallen sind 2,83. Die Spreizung: die Steigung unter 1 heißt, das Modell trennt zu
  // scharf - bei erwarteten 2,0 Toren fielen 2,2, bei erwarteten 3,6 nur 3,55. Ein reiner
  // Skalenfaktor von 1,048 heilt nur den Pegel, die Gerade beides.
  //
  // Out-of-Sample-Wirkung auf die Kalibrierung (Abweichung Eintritt minus Prognose):
  //   Über 1,5   +3,3 pp -> +0,7 pp     1. HZ Über 0,5  +1,4 pp -> -0,7 pp
  //   Über 2,5   +3,2 pp -> +0,0 pp     1. HZ Über 1,5  +1,0 pp -> -1,1 pp
  //   Über 3,5   +3,1 pp -> +0,5 pp     BTTS            +4,7 pp -> +2,2 pp
  // Mittlerer Brier-Score über alle Tormärkte 0.2142 -> 0.2130.
  //
  // Der Preis steht bewusst hier: Remis wird schlechter (+2,3 -> +3,1 pp Unterschätzung),
  // weil mehr Tore weniger Remis bedeuten, und der 1X2-Brier bewegt sich um +0.0003.
  // Beides ist gegen sechs deutlich besser kalibrierte Tormärkte abgewogen.
  //
  // Der Fit stammt aus Ligapartien; Cross-League-Partien lagen mit 188 Stück zu dünn für
  // einen eigenen Wert und laufen vorerst über denselben. Bei genügend abgerechneten
  // Cross-League-Partien gehört das getrennt nachgezogen.
  goalLineCalibration: {
    intercept: 0.4951,
    slope: 0.8638,
    firstHalfIntercept: 0.3002,
    firstHalfSlope: 0.7984
  },
  // Abrechnung fälliger Prognosen am Ende jedes Dashboard-Laufs. Klein gehalten, weil im
  // laufenden Betrieb pro Tag nur Dutzende Partien anfallen; ein Rückstand wird über
  // mehrere Läufe abgetragen. 0 schaltet die automatische Abrechnung ab.
  settleRequestBudget:
    Number.isInteger(settleRequestBudget) && settleRequestBudget >= 0
      ? settleRequestBudget
      : 200,
  // Gleichzeitig abgefragte Partien bei der Abrechnung. Standard 1 (sequenziell): mehrere
  // frisch geöffnete Verbindungen zur API laufen in diesem Netz reihenweise in einen
  // Connect-Timeout und reißen den ganzen Lauf mit. Siehe Kommentar in settle.ts.
  settleConcurrency:
    Number.isInteger(settleConcurrency) && settleConcurrency > 0
      ? settleConcurrency
      : 1,
  strengthOnDemandRequestBudget:
    Number.isInteger(strengthOnDemandRequestBudget) &&
    strengthOnDemandRequestBudget > 0
      ? strengthOnDemandRequestBudget
      : 25,
  strength: {
    // Elo-Differenz zweier Ligen -> Torfaktor je Seite: 10 ** (delta / factorDivisor).
    // Seit dem neutralen Maßstab im Modell trägt dieser Faktor den Klassenunterschied
    // allein; vorher hat die schiefe Pokal-Torbasis einen Teil davon verdeckt mitgetragen.
    // Am 31.08.2026 auf 379 abgerechnete Cross-League-Partien mit gemessener Ligastärke
    // nachgezogen (vorher 900, kalibriert an einer einzigen Pokalrunde mit 21 Partien).
    // Der Favorit traf dort 36,4 % statt der prognostizierten 49,3 %, und der Fehler wächst
    // mit der Spreizung: -3,8 pp bei ausgeglichenen Partien, -13,9 und -17,3 pp in der Mitte,
    // -27,1 pp im schiefsten Viertel. Diese Dosis-Wirkung ist die Signatur zu scharfer
    // Klassentrennung und gehört genau hierher.
    // Eine Poisson-Simulation über dieselben Partien senkt mit 1500 die mittlere
    // Favoritenwahrscheinlichkeit von 49,3 auf 44,6 % und den Brier-Score von 0.684 auf 0.664.
    // Stärkere Stauchung bringt kaum noch etwas (0.657 bei 3000), kostet aber die
    // Trennschärfe zwischen großen und kleinen Klassenunterschieden - das schiefste Viertel
    // trifft mit 48,6 % weiterhin deutlich häufiger als ausgeglichene Partien mit 35,6 %.
    // Die Simulation staucht die gesamte Spreizung, also auch den Formanteil; 1500 ist damit
    // die Untergrenze des passenden Bereichs und bewusst die konservative Wahl, weil
    // Überschätzung unmittelbar auf die Kelly-Einsätze durchschlägt.
    // Rund 4,5 pp der Lücke überleben auch extreme Stauchung: Cross-League-Partien enden
    // häufiger remis (29,3 % statt prognostizierter 23,4 %) und die Heimseite gewinnt seltener
    // (34,3 % statt 41,2 %). Das ist kein Klassenthema und nicht über diesen Wert zu heilen.
    // Die Grenzen sind so gewählt, dass im gemessenen Feld kein Faktor am Clamp hängt -
    // sonst unterscheidet das Modell große Klassenunterschiede nicht mehr voneinander.
    factorDivisor: 1500,
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
  // Detailansicht einer aufgeklappten Partie. Die Grenzen bestimmen unmittelbar die Kosten:
  // Team- und H2H-Historien liegen aus dem Lauf bereits im Cache, neu sind nur die Bündel
  // aus `/fixtures?ids=` zu je 20 Partien. Mit 20 Partien je Team und 10 direkten Duellen
  // bleiben es höchstens drei Bündel, also drei Anfragen je Partie - einmalig, danach
  // einen Monat lang aus dem Cache.
  insights: {
    historyLimit:
      Number.isInteger(insightsHistoryLimit) && insightsHistoryLimit > 0
        ? insightsHistoryLimit
        : 20,
    h2hLimit:
      Number.isInteger(insightsH2hLimit) && insightsH2hLimit > 0
        ? insightsH2hLimit
        : 10
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
