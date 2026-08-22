import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiFootballClient, ApiFootballError } from "./api.ts";
import { config, LIVE_SNAPSHOT_DIR, LIVE_USAGE_FILE, ROOT_DIR } from "./config.ts";
import {
  chunkIds,
  isFinishedStatus,
  isLiveStatus,
  liveCandidateIds,
  snapshotKey,
  snapshotLine,
  toBoardMatch,
  type LiveBoardMatch,
  type LiveBoardResponse
} from "./live-board.ts";
import type { DashboardDocument, DashboardFixture } from "./dashboard.ts";
import type { ApiFixture, ApiTeamStatistics } from "./types.ts";

export type LiveErrorCode = "dashboard_missing" | "api_key_missing" | "api_unavailable";

export class LiveError extends Error {
  readonly code: LiveErrorCode;
  readonly status: number;

  constructor(code: LiveErrorCode, message: string, status: number) {
    super(message);
    this.name = "LiveError";
    this.code = code;
    this.status = status;
  }
}

interface UsageRecord {
  date: string;
  used: number;
}

function berlinDay(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface LiveServiceOptions {
  client?: ApiFootballClient;
  createClient?: () => ApiFootballClient;
  dashboardFile?: string;
  snapshotDirectory?: string;
  usageFile?: string;
  now?: () => number;
  writeSnapshots?: boolean;
}

/**
 * Hält den Live-Stand für die App bereit. Ein Abruf kostet einen API-Call je angefangene
 * 20 laufende Partien; zwischen zwei Abrufen liegt mindestens `config.livePollMs`, und
 * parallele Anfragen teilen sich denselben Vorgang.
 */
export class LiveService {
  private readonly options: LiveServiceOptions;
  private readonly dashboardFile: string;
  private readonly snapshotDirectory: string;
  private readonly usageFile: string;
  private readonly now: () => number;
  private client: ApiFootballClient | null = null;
  private board: LiveBoardResponse | null = null;
  private fetchedAt = 0;
  private inFlight: Promise<LiveBoardResponse> | null = null;
  private inFlightKey: string | null = null;
  private scopeKey: string | null = null;
  private statistics = new Map<number, { at: number; statistics: ApiTeamStatistics[] }>();
  private finished = new Set<number>();
  private statisticsFetchedAt = new Map<number, number>();
  private withoutStatistics = new Set<number>();
  private snapshotKeys = new Map<number, string>();
  private usage: UsageRecord | null = null;
  private dashboardCache: { mtimeMs: number; document: DashboardDocument } | null = null;

  constructor(options: LiveServiceOptions = {}) {
    this.options = options;
    this.dashboardFile = options.dashboardFile ?? path.join(ROOT_DIR, "output", "dashboard-latest.json");
    this.snapshotDirectory = options.snapshotDirectory ?? LIVE_SNAPSHOT_DIR;
    this.usageFile = options.usageFile ?? LIVE_USAGE_FILE;
    this.now = options.now ?? Date.now;
  }

  private apiClient(): ApiFootballClient {
    if (this.client) return this.client;
    try {
      this.client = this.options.client ?? (this.options.createClient?.() ?? new ApiFootballClient());
    } catch (error) {
      throw new LiveError(
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
      throw new LiveError(
        "dashboard_missing",
        "Noch keine Analyse vorhanden. Starte zuerst einen Dashboard-Lauf.",
        404
      );
    }
    if (this.dashboardCache?.mtimeMs === mtimeMs) return this.dashboardCache.document;
    const document = JSON.parse(await readFile(this.dashboardFile, "utf8")) as DashboardDocument;
    if (this.dashboardCache) {
      this.finished.clear();
      this.withoutStatistics.clear();
    }
    this.dashboardCache = { mtimeMs, document };
    return document;
  }

  private async readUsage(): Promise<UsageRecord> {
    const today = berlinDay(this.now());
    if (this.usage?.date === today) return this.usage;
    if (!this.usage) {
      try {
        const stored = JSON.parse(await readFile(this.usageFile, "utf8")) as Partial<UsageRecord>;
        if (stored.date === today && Number.isFinite(stored.used)) {
          this.usage = { date: today, used: Number(stored.used) };
          return this.usage;
        }
      } catch {
        // Noch keine Verbrauchsdatei - der Tag startet bei null.
      }
    }
    // Tageswechsel: Zähler, beendete Partien und Snapshot-Merker zurücksetzen.
    this.usage = { date: today, used: 0 };
    this.finished.clear();
    this.snapshotKeys.clear();
    this.withoutStatistics.clear();
    this.statistics.clear();
    return this.usage;
  }

  private async writeUsage(usage: UsageRecord): Promise<void> {
    try {
      await mkdir(path.dirname(this.usageFile), { recursive: true });
      await writeFile(this.usageFile, JSON.stringify(usage) + "\n", "utf8");
    } catch {
      // Der Verbrauch wird weiter im Speicher gezählt, auch wenn die Datei nicht schreibbar ist.
    }
  }

  private async storeSnapshots(matches: LiveBoardMatch[], capturedAt: string): Promise<void> {
    if (this.options.writeSnapshots === false) return;
    const lines: string[] = [];
    for (const match of matches) {
      const key = snapshotKey(match);
      if (this.snapshotKeys.get(match.fixtureId) === key) continue;
      this.snapshotKeys.set(match.fixtureId, key);
      lines.push(snapshotLine(match, capturedAt));
    }
    if (lines.length === 0) return;
    try {
      await mkdir(this.snapshotDirectory, { recursive: true });
      const file = path.join(this.snapshotDirectory, berlinDay(this.now()) + ".jsonl");
      await appendFile(file, lines.join("\n") + "\n", "utf8");
    } catch {
      // Die Mitschrift ist optional und darf die Anzeige nie blockieren.
    }
  }

  /**
   * fixtureIds grenzt die Beobachtung auf die Partien ein, die der Anwender tatsächlich
   * ansieht. Ohne diese Angabe werden alle Partien des Umfangs beobachtet.
   */
  async getBoard(fixtureIds?: number[]): Promise<LiveBoardResponse> {
    const scope = fixtureIds && fixtureIds.length > 0
      ? [...new Set(fixtureIds)].sort((left, right) => left - right)
      : null;
    const key = scope ? scope.join(",") : "";
    if (this.board && this.scopeKey === key && this.now() - this.fetchedAt < config.livePollMs) {
      return this.board;
    }
    if (this.inFlight && this.inFlightKey === key) return this.inFlight;
    const request = this.refresh(scope).finally(() => {
      this.inFlight = null;
      this.inFlightKey = null;
    });
    this.inFlight = request;
    this.inFlightKey = key;
    this.scopeKey = key;
    return request;
  }

  private async refresh(scope: number[] | null): Promise<LiveBoardResponse> {
    const document = await this.readDashboard();
    const usage = await this.readUsage();
    const startedAt = this.now();
    const allowed = scope === null ? null : new Set(scope);
    const candidates = liveCandidateIds(document.fixtures, startedAt, this.finished, allowed);
    const budgetLeft = config.liveDailyRequestBudget - usage.used;
    const strategy = candidates.length > config.liveAllThreshold ? "live-all" : "batch";

    // Läuft gerade keine relevante Partie, wird die API überhaupt nicht angesprochen.
    if (candidates.length === 0 || budgetLeft <= 0) {
      const response = this.compose([], candidates.length, strategy, usage, startedAt,
        candidates.length === 0 ? null : this.budgetMessage(usage));
      this.board = response;
      this.fetchedAt = startedAt;
      return response;
    }

    const client = this.apiClient();
    const before = client.requestCount;
    const byId = new Map(document.fixtures.map((fixture) => [fixture.fixtureId, fixture]));
    let matches: LiveBoardMatch[] = [];
    let message: string | null = null;

    try {
      matches = strategy === "live-all"
        ? await this.collectViaLiveAll(client, candidates, byId, startedAt, before, budgetLeft)
        : await this.collectViaBatches(client, candidates, byId, startedAt, before, budgetLeft);
      if (client.requestCount - before >= budgetLeft) message = this.budgetMessage(usage);
    } catch (error) {
      usage.used += client.requestCount - before;
      await this.writeUsage(usage);
      const detail = error instanceof ApiFootballError || error instanceof Error ? error.message : "";
      if (this.board) {
        // Letzten erfolgreichen Stand behalten, damit ein Aussetzer die Ansicht nicht leert.
        const response: LiveBoardResponse = {
          ...this.board,
          budget: this.budget(usage, client.requestsRemaining),
          message: "Live-Daten konnten nicht aktualisiert werden: " + detail
        };
        this.board = response;
        this.fetchedAt = this.now();
        return response;
      }
      throw new LiveError("api_unavailable", detail || "API-Football ist nicht erreichbar.", 502);
    }

    usage.used += client.requestCount - before;
    await this.writeUsage(usage);
    matches.sort((left, right) =>
      (right.elapsed ?? 0) - (left.elapsed ?? 0) ||
      left.homeTeam.localeCompare(right.homeTeam, "de"));
    await this.storeSnapshots(matches, new Date(this.now()).toISOString());
    const response = this.compose(matches, candidates.length, strategy, usage, this.now(),
      message, client.requestsRemaining);
    this.board = response;
    this.fetchedAt = this.now();
    return response;
  }

  /**
   * Bis zu 20 Fixtures je Anfrage, Statistiken kommen eingebettet mit. Unterhalb der
   * Schwelle ist das der günstigste Weg, weil ein einziger Call alles liefert.
   */
  private async collectViaBatches(
    client: ApiFootballClient,
    candidates: number[],
    byId: Map<number, DashboardFixture>,
    startedAt: number,
    before: number,
    budgetLeft: number
  ): Promise<LiveBoardMatch[]> {
    const returned: ApiFixture[] = [];
    for (const batch of chunkIds(candidates)) {
      if (client.requestCount - before >= budgetLeft) break;
      returned.push(...await client.getFixturesWithStatistics(batch, true));
    }
    const matches: LiveBoardMatch[] = [];
    for (const fixture of returned) {
      const dashboard = byId.get(fixture.fixture.id);
      if (!dashboard || !this.keepRunning(fixture)) continue;
      const embedded = fixture.statistics?.length ? fixture.statistics : undefined;
      if (embedded) this.rememberStatistics(fixture.fixture.id, embedded, startedAt);
      let match = toBoardMatch(fixture, dashboard, this.statisticsFor(fixture.fixture.id));
      // Nachladen nur, wenn der Batch nichts mitgeliefert hat und der zwischengespeicherte
      // Stand veraltet ist - sonst bliebe er fuer immer eingefroren.
      if (!embedded
        && this.statisticsAge(fixture.fixture.id, startedAt) >= config.liveStatisticsRefreshMs
        && this.shouldFetchStatistics(fixture.fixture.id, startedAt)
        && client.requestCount - before < budgetLeft) {
        match = await this.withFetchedStatistics(client, fixture, dashboard, startedAt);
      }
      matches.push(match);
    }
    return matches;
  }

  /**
   * Ein Call liefert Spielstand, Minute und Ereignisse aller laufenden Partien weltweit,
   * unabhängig von deren Anzahl. Statistiken fehlen dort und werden deshalb nur im
   * Minutentakt über 20er-Bündel nachgezogen - sie ändern sich ohnehin nicht schneller.
   */
  private async collectViaLiveAll(
    client: ApiFootballClient,
    candidates: number[],
    byId: Map<number, DashboardFixture>,
    startedAt: number,
    before: number,
    budgetLeft: number
  ): Promise<LiveBoardMatch[]> {
    const wanted = new Set(candidates);
    const live = (await client.getLiveFixtures()).filter((fixture) => wanted.has(fixture.fixture.id));
    const running = live.filter((fixture) => this.keepRunning(fixture));
    const seen = new Set(live.map((fixture) => fixture.fixture.id));

    // Partien, die nicht mehr in der Live-Liste stehen, sind vorbei.
    for (const id of candidates) {
      if (!seen.has(id)) this.finished.add(id);
    }

    const stale = running
      .map((fixture) => fixture.fixture.id)
      .filter((id) => this.statisticsAge(id, startedAt) >= config.liveStatisticsRefreshMs
        && !this.withoutStatistics.has(id));
    for (const batch of chunkIds(stale)) {
      if (client.requestCount - before >= budgetLeft) break;
      for (const fixture of await client.getFixturesWithStatistics(batch, true)) {
        if (fixture.statistics?.length) {
          this.rememberStatistics(fixture.fixture.id, fixture.statistics, startedAt);
        } else {
          // Diese Liga liefert keine Statistiken; nicht erneut anfragen.
          this.withoutStatistics.add(fixture.fixture.id);
          this.statisticsFetchedAt.set(fixture.fixture.id, startedAt);
        }
      }
    }

    const matches: LiveBoardMatch[] = [];
    for (const fixture of running) {
      const dashboard = byId.get(fixture.fixture.id);
      if (!dashboard) continue;
      matches.push(toBoardMatch(fixture, dashboard, this.statisticsFor(fixture.fixture.id)));
    }
    return matches;
  }

  /** true, solange die Partie läuft. Beendete werden für den Rest des Tages ausgesperrt. */
  private keepRunning(fixture: ApiFixture): boolean {
    const short = fixture.fixture.status.short;
    if (isFinishedStatus(short)) {
      this.finished.add(fixture.fixture.id);
      return false;
    }
    return isLiveStatus(short);
  }

  private async withFetchedStatistics(
    client: ApiFootballClient,
    fixture: ApiFixture,
    dashboard: DashboardFixture,
    startedAt: number
  ): Promise<LiveBoardMatch> {
    this.statisticsFetchedAt.set(fixture.fixture.id, startedAt);
    const statistics = await client.getFixtureStatistics(fixture.fixture.id);
    const match = toBoardMatch(fixture, dashboard, statistics);
    // Liefert auch der Einzelabruf nichts, fehlt der Liga die Statistikabdeckung.
    // Ohne diese Merkung würde jede solche Partie dauerhaft einen Call pro Minute kosten.
    if (match.metricsAvailable) this.rememberStatistics(fixture.fixture.id, statistics, startedAt);
    else this.withoutStatistics.add(fixture.fixture.id);
    return match;
  }

  private rememberStatistics(fixtureId: number, statistics: ApiTeamStatistics[], at: number): void {
    this.statistics.set(fixtureId, { at, statistics });
    this.statisticsFetchedAt.set(fixtureId, at);
  }

  private statisticsFor(fixtureId: number): ApiTeamStatistics[] | undefined {
    return this.statistics.get(fixtureId)?.statistics;
  }

  private statisticsAge(fixtureId: number, now: number): number {
    const stored = this.statistics.get(fixtureId);
    return stored === undefined ? Number.POSITIVE_INFINITY : now - stored.at;
  }

  private shouldFetchStatistics(fixtureId: number, now: number): boolean {
    if (this.withoutStatistics.has(fixtureId)) return false;
    const last = this.statisticsFetchedAt.get(fixtureId);
    return last === undefined || now - last >= config.liveStatisticsFallbackTtlMs;
  }

  private budgetMessage(usage: UsageRecord): string {
    return "Tagesbudget für Live-Abrufe erreicht: " + usage.used + " von " + config.liveDailyRequestBudget + " Anfragen.";
  }

  private budget(usage: UsageRecord, apiRequestsRemaining: number | null = null): LiveBoardResponse["budget"] {
    return {
      usedToday: usage.used,
      capToday: config.liveDailyRequestBudget,
      apiRequestsRemaining,
      exhausted: usage.used >= config.liveDailyRequestBudget
    };
  }

  private compose(
    matches: LiveBoardMatch[],
    candidates: number,
    strategy: LiveBoardResponse["strategy"],
    usage: UsageRecord,
    timestamp: number,
    message: string | null = null,
    apiRequestsRemaining: number | null = null
  ): LiveBoardResponse {
    return {
      createdAt: new Date(timestamp).toISOString(),
      pollIntervalMs: config.livePollMs,
      matches,
      candidates,
      strategy,
      budget: this.budget(usage, apiRequestsRemaining),
      message
    };
  }
}

let shared: LiveService | null = null;

export function liveService(): LiveService {
  shared ??= new LiveService();
  return shared;
}
