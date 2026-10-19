import path from "node:path";
import type { EloSystem } from "./elo-config.ts";

// Eine Pokalsaison braucht rund 100 bis 150 Aufrufe (einer je teilnehmendem Verein). Mit 25 je
// Analyse blieben Lücken wochenlang offen (29.09.2026: Slowakei ohne Rating, Tschechien bei 2024).
// Seit 19.10.2026 300 an einer Stelle vor der Torlinien-Rechnung statt je 100 in drei Analysen,
// von denen nur die erste die Ligastärke liest - dieselben Höchstkosten je Dashboard-Analyse.
const strengthOnDemandRequestBudget = Number(
  process.env.STRENGTH_ON_DEMAND_REQUEST_BUDGET ?? 300
);
const settleRequestBudget = Number(
  process.env.SETTLE_REQUEST_BUDGET ?? 200
);
const settleConcurrency = Number(
  process.env.SETTLE_CONCURRENCY ?? 1
);
const eloTopUpRequestBudget = Number(
  process.env.ELO_TOPUP_REQUEST_BUDGET ?? 600
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
  // 3.3.0 (28.09.2026): Stärkefaktor aus dem Team-Elo bei Länderspielen, eigene
  // Torkorrektur für Nationalteams, Faktor 1 bei Pokalspielen zweier Teams derselben Liga.
  // 3.4.0 (29.09.2026): dasselbe für U21-Nationalteams (`teamEloSystems`), dazu eigene Pools
  // und die 3-Vereine-Grenze für Frauenwettbewerbe in der Ligastärke.
  // 3.5.0 (05.10.2026): strength.factorDivisor 1500 -> 1200 (Begründung dort).
  // 3.6.0 (19.10.2026): Eine nicht belastbare Liga behält ihr eigenes Rating, nach Duellen und
  // Vereinen zum Pool-Floor gezogen (`ratingFor` in src/strength-factor.ts). Ligaspiele und
  // Spiele zwischen zwei belastbar bewerteten Ligen rechnen wie 3.5.0 (`STRENGTH_COMPARABLE_SINCE`).
  goalLineModelVersion: "3.6.0",
  xgEnrichmentRequestBudget: 250,
  // Torschüsse und Ecken der letzten fünf Partien. Ein Aufruf deckt zwanzig Partien ab, und
  // jede geholte wird gespeichert - ein 48-Stunden-Lauf braucht damit etwa zwanzig Aufrufe,
  // spätere Läufe fast keine mehr.
  recentStatsRequestBudget: 200,
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
  // Der Fit stammt aus Ligapartien. Vereinsspiele zwischen verschiedenen Ligen passen damit
  // (Prüfung vom 28.09.2026, n ≈ 700: 2,97 Tore erwartet, 3,09 gefallen; eine eigene Gerade
  // hätte Steigung 0,77 ± 0,10) und brauchen keinen eigenen Satz. Länderspiele schon, siehe
  // goalLineCalibrationNational.
  goalLineCalibration: {
    intercept: 0.4951,
    slope: 0.8638,
    firstHalfIntercept: 0.3002,
    firstHalfSlope: 0.7984
  },
  // Eigene Torkorrektur für Spiele zweier Nationalteams mit Elo (seit 28.09.2026). Mit dem
  // Liga-Satz erwartete das Modell dort rund 0,3 Tore zu viel (2,93 gegen 2,67), in
  // torreichen Paarungen fast ein Tor. Kleinste Quadrate wie beim Liga-Satz, tatsächliche
  // Torsumme gegen rohe Erwartung mit Elo-Faktor, über 3.763 nachgebaute Länderspiele
  // 01/2023-09/2026; einzeln auf 2023-24 bzw. 2025-26 bestimmt fast gleich (1,124/0,548 und
  // 1,172/0,552). Auf dem jeweils anderen Zeitraum gemessen, Summe der vier Tormärkte
  // (Ü1,5/2,5/3,5, BTTS) je Spiel: -0,050 ± 0,011 und -0,043 ± 0,007 Log-Loss; 1X2
  // +0,002 ± 0,001 bzw. -0,000 ± 0,001, also gleich. BTTS bleibt danach rund 5 Punkte zu hoch -
  // das liegt an der Aufteilung (die schwächere Seite bleibt öfter torlos, 45 % statt 38 %),
  // nicht an der Summe, und ist mit diesem Satz nicht zu beheben.
  // Nur fürs ganze Spiel: Für die erste Halbzeit fehlen historische Pausenstände
  // (live 1,30 erwartet, 1,33 gefallen, n = 66), dort gilt weiter der Liga-Satz.
  goalLineCalibrationNational: {
    intercept: 1.135,
    slope: 0.553
  },
  // Verschiebung der Heim-/Gast-Aufteilung bei Ligaspielen (`shiftHomeAway` in src/model.ts),
  // nach der Summenkorrektur, Summe bleibt gleich. **Ab Werk 0 = aus** (Davids Entscheidung
  // vom 10.10.2026): Eingeschaltet wird nach der vorab festgelegten BTTS-Prüfung
  // (docs/btts-pruefung.md, etwa Mitte November), weil sich BTTS dabei leicht verschiebt.
  // Dann 0.054 setzen und goalLineModelVersion auf 3.7.0 erhöhen (3.6.0 ist seit 19.10.2026
  // die Ligastärke geschätzter Ligen).
  //
  // Gemessen (Prüfung vom 10.10.2026): δ über 74.033 nachgebaute Ligaspiele 0,0539 ± 0,0023,
  // live 0,059 ± 0,010. Zeit-Split, 1X2-Log-Loss gepaart: nachgebaut −0,0036 ± 0,0004 (Test)
  // und −0,0023 ± 0,0004 (Gegenprobe), echte Prognosen ab 3.2.0 −0,0035 ± 0,0013 über 4.038
  // Ligaspiele; Über/Unter unverändert, BTTS −0,0002 ± 0,0001. Gegen Tipico fair schrumpft der
  // Abstand nur um ein Zehntel (+0,039 -> +0,035). Spiele zwischen Ligen wurden schlechter
  // (+0,0086 ± 0,0054, dort fehlt der stärkeren Seite etwas anderes), Länderspiele sind nicht
  // belegt - beide bleiben außen vor. Je Ligaspiel: P(Heim) +3,3, P(Gast) −3,1 Punkte.
  goalLineHomeShift: 0,
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
  // Team-Elo mit jeder Analyse nachziehen (kostenlos) und wöchentlich alle aktiven Ligen
  // holen (rund 530 Aufrufe). ELO_AUTO_UPDATE=0 schaltet beides ab. src/elo-update.ts.
  eloAutoUpdate: process.env.ELO_AUTO_UPDATE !== "0",
  eloTopUpRequestBudget:
    Number.isInteger(eloTopUpRequestBudget) && eloTopUpRequestBudget >= 0
      ? eloTopUpRequestBudget
      : 600,
  strengthOnDemandRequestBudget:
    Number.isInteger(strengthOnDemandRequestBudget) &&
    strengthOnDemandRequestBudget > 0
      ? strengthOnDemandRequestBudget
      : 300,
  strength: {
    // Elo-Differenz zweier Ligen -> Torfaktor je Seite: 10 ** (delta / factorDivisor).
    // Seit dem neutralen Maßstab im Modell trägt dieser Faktor den Klassenunterschied allein.
    // **Jede Änderung in `strength` erhöht `goalLineModelVersion`**: Der Bericht misst die
    // stärkere Seite je Modellversion (`strongerSideByVersion`); in 3.1.0 liefen ohne neue Version
    // nacheinander 1200, 900 und 1500, und die Messung je Teiler war nicht mehr trennbar.
    // Geschichte: 900 (eine Pokalrunde, 21 Partien) -> 1500 ab 31.08.2026 (Commit 02.09.)
    // -> 1200 am 05.10.2026.
    // Die Erhöhung auf 1500 stand auf einem Zählfehler: Von 379 "gemessenen" Partien stammten
    // 309 aus Modellfassungen vor 3.1.0, die gar keinen Faktor rechneten (cohortOf ordnete sie
    // über die Cross-League-Warnung zu). Die 71 Partien mit echtem Faktor lagen bei 900
    // unauffällig (-3,0 ± 5,8 pp). Auch der damalige Remis-Überschuss im Pokal (29,3 statt
    // 23,4 %) kam nur aus diesen Altzeilen; ab 3.1.0 sind es -1,4 ± 2,9 Punkte.
    // Mit 1500 gewann die Seite aus der stärkeren Liga seit 3.2.0 66 % statt der
    // vorhergesagten 48 % (113 Spiele), Tipico gab ihr rund 4 Punkte mehr als das Modell.
    // Prüfung des Prüfer-Agenten vom 05.10.2026, Raster vorab festgelegt, Zeit-Split:
    // - an strength_matches (2.349 Spiele mit belastbaren Ratings, Rating vor Anpfiff, Wahl auf
    //   der Zeit vor 15.10.2025): gewählt 1200, auf der zweiten Hälfte -0,0102 ± 0,0018
    //   1X2-Log-Loss gegen 1500;
    // - an den eigenen Prognosen ab 3.1.0 bestätigt: -0,0235 ± 0,0051 (190 Spiele), in beiden
    //   Zeithälften gleich. 900 war dort etwas besser, aber nicht belegt und am Rand des Rasters.
    // Die Ratings stehen auf der Elo-Skala 400 mit Heimvorteil 50; ein dazu passender Teiler
    // liegt bei 940-1130. Nachmessen nach rund 150 abgerechneten Spielen von 3.5.0 an der Spalte
    // "stärkere Liga gewinnt" in npm run report.
    // Die Grenzen sind so gewählt, dass im gemessenen Feld kein Faktor am Clamp hängt -
    // sonst unterscheidet das Modell große Klassenunterschiede nicht mehr voneinander.
    factorDivisor: 1200,
    factorMin: 0.3,
    factorMax: 3.5,
    // Abschlag auf das schwächste belastbare Rating des Pools für Ligen ohne eigenes
    // Rating. Wer nie in der Elo-Kette auftaucht, ist unterklassig, nicht Mittelfeld. Ein
    // nicht belastbares eigenes Rating wird seit 3.6.0 nach Duellen und Vereinen zu diesem
    // Wert hin gezogen, nicht mehr durch ihn ersetzt (`ratingFor`).
    // Am selben Lauf kalibriert (11 der 22 Partien hatten eine geschätzte Seite). Zwischen
    // 120 und 300 ist die Abweichung praktisch flach; gewählt ist der konservative Rand,
    // damit das Modell eher unter- als überschätzt - Überschätzung schlägt unmittelbar auf
    // die Kelly-Einsätze durch.
    unratedPenalty: 120,
    // Belastbar ist ein Liga-Rating ab so vielen Duellen gegen andere Ligen und so vielen
    // verschiedenen Vereinen - ein einzelner starker Verein soll nicht allein seine Liga
    // bestimmen. Frauenligen erreichen 5 Vereine fast nie (aus jedem Land spielen 2-4 Teams
    // europäisch). Prüfung vom 29.09.2026 an 78 nachgebauten Frauen-Europapokalspielen: mit 3
    // Vereinen 1X2-Log-Loss -0,156 ± 0,060 gegen "ohne Faktor", in beiden Zeithälften; der
    // Gewinn steckt in Spielen großer gegen kleine Liga. Nur für Frauen-Pools: global gesenkt
    // würden fünf Männerligen belastbar, das ist ungemessen.
    reliableMinMatches: 30,
    reliableMinClubs: 5,
    reliableMinClubsWomen: 3,
    // Länderspiele haben keine Heimatliga und damit kein Liga-Rating. Seit 28.09.2026 trägt
    // dort das Team-Elo der Nationalteams (src/elo.ts, System "national") den
    // Klassenunterschied: Torfaktor 10 ** (ΔElo / teamEloDivisor), dieselben Klemmen.
    // Gemessen an nachgebauten Länderspielen (Prüfung vom 28.09.2026, 0 Aufrufe): Teiler auf
    // 2023-24 bestimmt, auf 01.2025-09.2026 getestet, 1X2-Log-Loss -0,083 ± 0,008 gegen das
    // Modell ohne Faktor (n = 1.629); Gegenprobe umgekehrt -0,049 ± 0,008 (n = 2.134). Die
    // Kurve ist zwischen 1200 und 1500 flach. Ohne Faktor gab das Modell dem Favoriten 46 %,
    // er gewann 54 %; mit Faktor 58 zu 58 %.
    // Nur innerhalb eines Kontinentalverbands: Die Verbände spielen fast nur unter sich, ihre
    // Elo-Skalen sind schlecht verbunden (Vietnam vor Italien). Zwischen Verbänden traf der
    // Elo-Favorit 5-11 Punkte seltener als erwartet und der Faktor half nicht messbar.
    teamEloDivisor: 1400,
    // Skalen, deren Elo den Faktor und die Torkorrektur der Länderspiele trägt - beide Teams auf
    // derselben Skala, im selben Verband. U21 seit 29.09.2026 (Davids Entscheidung nach der
    // Prüfung vom selben Tag, derselbe Teiler 1400 vorab festgelegt): 1X2-Log-Loss gegen „ohne
    // Faktor“ -0,129 ± 0,022 (2023-24, n = 288) und -0,136 ± 0,024 (01.2025-09.2026, n = 256);
    // Favorit vorher 45-47 % vorhergesagt gegen 54-59 % eingetreten, mit Faktor 60-63 gegen
    // 62-64 %. Erst mit der Länder-Torkorrektur passt auch die Torsumme (ohne sie bis 0,47 Tore
    // zu viel), und die falschen BTTS-Empfehlungen der U21 verschwinden fast ganz.
    // **U19 und U17** messen ebenfalls klar besser (U19 -0,081/-0,088, U17 -0,050/-0,084), sind
    // aber nicht eingeschaltet, weil Tipico sie seit Beginn der Exporte (11.08.2026) nie führte.
    // Tauchen sie auf, gehören sie hier dazu. U20, U23 und Frauen-Nationalteams: nein (zu wenige
    // Spiele bzw. Favorit weiter deutlich unterschätzt).
    teamEloSystems: ["national", "national-u21"] as EloSystem[]
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
