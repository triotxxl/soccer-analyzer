import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ApiFootballClient, ApiFootballError } from "./api.ts";
import { config, ROOT_DIR } from "./config.ts";
import { chunkIds } from "./live-board.ts";
import {
  coverageOf,
  selectH2h,
  selectHistory,
  toInsightMatch,
  type FixtureInsights,
  type InsightMatch
} from "./fixture-insights.ts";
import type { DashboardDocument } from "./dashboard.ts";
import type { ApiFixture } from "./types.ts";

export type InsightsErrorCode =
  | "dashboard_missing"
  | "fixture_unknown"
  | "api_key_missing"
  | "api_unavailable";

export class InsightsError extends Error {
  readonly code: InsightsErrorCode;
  readonly status: number;

  constructor(code: InsightsErrorCode, message: string, status: number) {
    super(message);
    this.name = "InsightsError";
    this.code = code;
    this.status = status;
  }
}

export interface InsightsServiceOptions {
  client?: ApiFootballClient;
  createClient?: () => ApiFootballClient;
  dashboardFile?: string;
  now?: () => number;
  /** Partien je Team, die in Trends und Torphasen eingehen. */
  historyLimit?: number;
  /** Direkte Duelle, die die Ansicht anbietet. */
  h2hLimit?: number;
}

/**
 * Liefert die Detailkennzahlen einer einzelnen Partie: Torphasen, direkte Duelle und
 * Trends. Der Abruf läuft erst, wenn eine Partie in der App aufgeklappt wird, und er ist
 * bewusst schmal: Team- und H2H-Historien liegen aus dem Dashboard-Lauf bereits im Cache,
 * neu ist allein ein `/fixtures?ids=`-Bündel je 20 Partien. Das trägt Ereignisse und
 * Statistiken in einem Aufruf und wird als beendete Partie einen Monat lang gespeichert -
 * dieselbe Partie kostet also genau einmal etwas.
 */
export class InsightsService {
  private readonly options: InsightsServiceOptions;
  private readonly dashboardFile: string;
  private readonly now: () => number;
  private readonly historyLimit: number;
  private readonly h2hLimit: number;
  private client: ApiFootballClient | null = null;
  private cache = new Map<number, FixtureInsights>();
  private inFlight = new Map<number, Promise<FixtureInsights>>();
  private dashboardCache: { mtimeMs: number; document: DashboardDocument } | null = null;

  constructor(options: InsightsServiceOptions = {}) {
    this.options = options;
    this.dashboardFile = options.dashboardFile ?? path.join(ROOT_DIR, "output", "dashboard-latest.json");
    this.now = options.now ?? Date.now;
    this.historyLimit = options.historyLimit ?? config.insights.historyLimit;
    this.h2hLimit = options.h2hLimit ?? config.insights.h2hLimit;
  }

  private apiClient(): ApiFootballClient {
    if (this.client) return this.client;
    try {
      this.client = this.options.client ?? (this.options.createClient?.() ?? new ApiFootballClient());
    } catch (error) {
      throw new InsightsError(
        "api_key_missing",
        error instanceof Error ? error.message : "API-Football-Schlüssel fehlt.",
        503
      );
    }
    return this.client;
  }

  private async readDashboard(): Promise<DashboardDocument> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(this.dashboardFile)).mtimeMs;
    } catch {
      throw new InsightsError(
        "dashboard_missing",
        "Noch keine Analyse vorhanden. Starte zuerst einen Dashboard-Lauf.",
        404
      );
    }
    if (this.dashboardCache?.mtimeMs === mtimeMs) return this.dashboardCache.document;
    const document = JSON.parse(await readFile(this.dashboardFile, "utf8")) as DashboardDocument;
    // Ein neuer Lauf kann Anstoßzeiten verschieben; die Auswahl der Historie hängt daran.
    this.cache.clear();
    this.dashboardCache = { mtimeMs, document };
    return document;
  }

  async get(fixtureId: number): Promise<FixtureInsights> {
    const cached = this.cache.get(fixtureId);
    if (cached) return cached;
    const running = this.inFlight.get(fixtureId);
    if (running) return running;
    const request = this.load(fixtureId).finally(() => this.inFlight.delete(fixtureId));
    this.inFlight.set(fixtureId, request);
    return request;
  }

  private async load(fixtureId: number): Promise<FixtureInsights> {
    const document = await this.readDashboard();
    const entry = document.fixtures.find((item) => item.fixtureId === fixtureId);
    if (!entry) {
      throw new InsightsError(
        "fixture_unknown",
        "Diese Partie steht nicht im letzten Dashboard-Lauf.",
        404
      );
    }
    const client = this.apiClient();
    // Nur echte Netzaufrufe zählen; der Client erhöht den Zähler erst vor dem Absenden,
    // ein Treffer im Dateicache bleibt damit sichtbar bei null.
    const requestsBefore = client.requestCount;
    try {
      // Das Dashboard führt nur Teamnamen. Die IDs kommen aus der Partie selbst; sie liegt
      // nach dem Lauf im Cache und kostet dort nichts.
      const [subject] = await client.getFixture(fixtureId);
      if (!subject) {
        throw new InsightsError("fixture_unknown", "API-Football kennt diese Partie nicht.", 404);
      }
      const homeId = subject.teams.home.id;
      const awayId = subject.teams.away.id;
      const cutoff = subject.fixture.timestamp;
      const [homeRecent, awayRecent, h2hRaw] = await Promise.all([
        client.getTeamRecentFixtures(homeId, 40),
        client.getTeamRecentFixtures(awayId, 40),
        client.getHeadToHead(homeId, awayId)
      ]);

      const homeHistory = selectHistory(homeRecent, homeId, cutoff, this.historyLimit);
      const awayHistory = selectHistory(awayRecent, awayId, cutoff, this.historyLimit);
      const h2hHistory = selectH2h(h2hRaw, cutoff, this.h2hLimit);
      const pool = [...new Map([...homeHistory, ...awayHistory, ...h2hHistory]
        .map((match) => [match.fixture.id, match])).values()];

      const details = new Map<number, ApiFixture>();
      for (const batch of chunkIds(pool.map((match) => match.fixture.id))) {
        const returned = await client.getFixturesWithStatistics(batch);
        for (const match of returned) details.set(match.fixture.id, match);
      }

      const build = (fixtures: ApiFixture[]): InsightMatch[] => fixtures
        .map((match) => toInsightMatch(match, details.get(match.fixture.id)))
        .filter((match): match is InsightMatch => match !== null);
      const homeMatches = build(homeHistory);
      const awayMatches = build(awayHistory);
      const h2h = build(h2hHistory);

      const insights: FixtureInsights = {
        fixtureId,
        league: {
          id: subject.league.id,
          name: subject.league.name,
          country: subject.league.country,
          season: subject.league.season
        },
        home: { id: homeId, name: subject.teams.home.name, logo: subject.teams.home.logo },
        away: { id: awayId, name: subject.teams.away.name, logo: subject.teams.away.logo },
        homeMatches,
        awayMatches,
        h2h,
        coverage: coverageOf([...homeMatches, ...awayMatches, ...h2h]),
        fetchedAt: new Date(this.now()).toISOString(),
        apiRequests: client.requestCount - requestsBefore
      };
      this.cache.set(fixtureId, insights);
      return insights;
    } catch (error) {
      if (error instanceof InsightsError) throw error;
      if (error instanceof ApiFootballError) {
        throw new InsightsError("api_unavailable", error.message, error.status ?? 502);
      }
      throw error;
    }
  }
}

let shared: InsightsService | null = null;

export function insightsService(options?: InsightsServiceOptions): InsightsService {
  if (options) return new InsightsService(options);
  shared ??= new InsightsService();
  return shared;
}
