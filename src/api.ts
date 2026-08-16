import { config, requireApiKey } from "./config.ts";
import { FileCache } from "./cache.ts";
import type {
  ApiEnvelope,
  ApiFixture,
  ApiFixtureEvent,
  ApiFixtureOdds,
  ApiLeague,
  ApiTeamStatistics
} from "./types.ts";

type FetchLike = typeof fetch;
type SleepLike = (milliseconds: number) => Promise<void>;
type NowLike = () => number;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ApiFootballError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiFootballError";
    this.status = status;
  }
}

export class ApiFootballClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cache: FileCache;
  private readonly fetchFn: FetchLike;
  private readonly sleepFn: SleepLike;
  private readonly nowFn: NowLike;
  private readonly requestsPerMinute: number;
  private readonly requestsPerSecond: number;
  private readonly rateLimitWindowMs: number;
  private readonly rateLimitSecondWindowMs: number;
  private readonly rateLimitRetryMs: number;
  private requestTimestamps: number[] = [];
  private secondRequestTimestamps: number[] = [];
  private readonly seasonRequests = new Map<string, Promise<ApiFixture[]>>();
  private rateLimitQueue: Promise<void> = Promise.resolve();
  requestCount = 0;
  requestsRemaining: number | null = null;
  requestsRemainingThisMinute: number | null = null;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    timeoutMs?: number;
    cache?: FileCache;
    fetchFn?: FetchLike;
    sleepFn?: SleepLike;
    nowFn?: NowLike;
    requestsPerMinute?: number;
    requestsPerSecond?: number;
    rateLimitWindowMs?: number;
    rateLimitSecondWindowMs?: number;
    rateLimitRetryMs?: number;
  }) {
    this.apiKey = options?.apiKey ?? requireApiKey();
    this.baseUrl = options?.baseUrl ?? config.apiBaseUrl;
    this.timeoutMs = options?.timeoutMs ?? config.timeoutMs;
    this.cache = options?.cache ?? new FileCache();
    this.fetchFn = options?.fetchFn ?? fetch;
    this.sleepFn = options?.sleepFn ?? delay;
    this.nowFn = options?.nowFn ?? Date.now;
    this.requestsPerMinute = options?.requestsPerMinute ?? config.apiRequestsPerMinute;
    this.requestsPerSecond = options?.requestsPerSecond ?? config.apiRequestsPerSecond;
    this.rateLimitWindowMs = options?.rateLimitWindowMs ?? config.apiRateLimitWindowMs;
    this.rateLimitSecondWindowMs = options?.rateLimitSecondWindowMs ?? config.apiRateLimitSecondWindowMs;
    this.rateLimitRetryMs = options?.rateLimitRetryMs ?? config.apiRateLimitRetryMs;
  }

  private waitForRequestSlot(): Promise<void> {
    const scheduled = this.rateLimitQueue.then(async () => {
      while (true) {
        let now = this.nowFn();
        this.requestTimestamps = this.requestTimestamps.filter(
          (timestamp) => now - timestamp < this.rateLimitWindowMs
        );
        this.secondRequestTimestamps = this.secondRequestTimestamps.filter(
          (timestamp) => now - timestamp < this.rateLimitSecondWindowMs
        );
        const minuteWait = this.requestTimestamps.length >= this.requestsPerMinute
          ? this.requestTimestamps[0]! + this.rateLimitWindowMs - now
          : 0;
        const secondWait = this.secondRequestTimestamps.length >= this.requestsPerSecond
          ? this.secondRequestTimestamps[0]! + this.rateLimitSecondWindowMs - now
          : 0;
        const waitMs = Math.max(0, minuteWait, secondWait);
        if (waitMs <= 0) {
          this.requestTimestamps.push(now);
          this.secondRequestTimestamps.push(now);
          break;
        }
        await this.sleepFn(waitMs);
      }
    });
    this.rateLimitQueue = scheduled.catch(() => undefined);
    return scheduled;
  }

  private async get<T>(
    endpoint: string,
    params: Record<string, string | number>,
    ttlMs: number,
    bypassCache = false,
    attempt = 0
  ): Promise<T> {
    if (attempt > 5) {
      throw new ApiFootballError("API-Football blieb nach mehreren Warteversuchen im Rate-Limit.", 429);
    }
    const entries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
    const query = new URLSearchParams(entries.map(([key, value]) => [key, String(value)]));
    const cacheKey = `${endpoint}?${query.toString()}`;
    if (!bypassCache) {
      const cached = await this.cache.get<T>(cacheKey, ttlMs);
      if (cached !== null) return cached;
    }

    await this.waitForRequestSlot();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      this.requestCount += 1;
      response = await this.fetchFn(`${this.baseUrl}/${endpoint}?${query}`, {
        headers: { "x-apisports-key": this.apiKey },
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiFootballError(`API-Football antwortete nicht innerhalb von ${this.timeoutMs} ms.`);
      }
      throw new ApiFootballError(
        `API-Football ist nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timer);
    }

    const remaining = response.headers.get("x-ratelimit-requests-remaining");
    if (remaining !== null && Number.isFinite(Number(remaining))) {
      this.requestsRemaining = Number(remaining);
    }
    const minuteRemaining = response.headers.get("x-ratelimit-remaining");
    if (minuteRemaining !== null && Number.isFinite(Number(minuteRemaining))) {
      this.requestsRemainingThisMinute = Number(minuteRemaining);
    }
    if (response.status === 429) {
      await this.sleepFn(this.rateLimitRetryMs * 2 ** attempt);
      return this.get<T>(endpoint, params, ttlMs, bypassCache, attempt + 1);
    }
    if (!response.ok) {
      throw new ApiFootballError(
        `API-Football meldet HTTP ${response.status} ${response.statusText}.`,
        response.status
      );
    }

    let envelope: ApiEnvelope<T>;
    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
      throw new ApiFootballError("API-Football lieferte keine gültige JSON-Antwort.", response.status);
    }
    const errors = Array.isArray(envelope.errors)
      ? envelope.errors
      : Object.values(envelope.errors ?? {});
    if (errors.length > 0) {
      if (errors.some((error) => error.toLocaleLowerCase().includes("too many requests"))) {
        await this.sleepFn(this.rateLimitRetryMs * 2 ** attempt);
        return this.get<T>(endpoint, params, ttlMs, bypassCache, attempt + 1);
      }
      throw new ApiFootballError(`API-Football-Fehler: ${errors.join("; ")}`, response.status);
    }
    await this.cache.set(cacheKey, envelope.response);
    if (
      this.requestsRemaining !== null &&
      this.requestsRemaining <= config.apiDailyReserve
    ) {
      throw new ApiFootballError(
        `API-Tagesreserve erreicht: ${this.requestsRemaining} Anfragen verbleiben.`,
        429
      );
    }
    return envelope.response;
  }

  getLeagues(): Promise<ApiLeague[]> {
    return this.get<ApiLeague[]>("leagues", { current: "true" }, config.cacheTtlMs.leagues);
  }

  getAllLeagues(): Promise<ApiLeague[]> {
    return this.get<ApiLeague[]>("leagues", {}, config.cacheTtlMs.leagues);
  }

  getLeagueDetails(leagueId: number): Promise<ApiLeague[]> {
    return this.get<ApiLeague[]>("leagues", { id: leagueId }, config.cacheTtlMs.leagues);
  }

  getFixturesForDate(date: string, timezone: string): Promise<ApiFixture[]> {
    return this.get<ApiFixture[]>(
      "fixtures",
      { date, timezone },
      config.cacheTtlMs.dailyFixtures
    );
  }

  getLiveFixtures(): Promise<ApiFixture[]> {
    return this.get<ApiFixture[]>("fixtures", { live: "all" }, 0, true);
  }

  getFixtureEvents(fixtureId: number): Promise<ApiFixtureEvent[]> {
    return this.get<ApiFixtureEvent[]>("fixtures/events", { fixture: fixtureId }, 0, true);
  }

  getFixtureStatistics(fixtureId: number): Promise<ApiTeamStatistics[]> {
    return this.get<ApiTeamStatistics[]>("fixtures/statistics", { fixture: fixtureId }, 0, true);
  }

  getSeasonFixtures(
    leagueId: number,
    season: number,
    historical = false
  ): Promise<ApiFixture[]> {
    const key = `${leagueId}:${season}:${historical ? "historical" : "current"}`;
    const existing = this.seasonRequests.get(key);
    if (existing) return existing;
    const request = this.get<ApiFixture[]>(
      "fixtures",
      { league: leagueId, season },
      historical
        ? config.cacheTtlMs.historicalSeasonFixtures
        : 0,
      !historical
    );
    this.seasonRequests.set(key, request);
    request.catch(() => this.seasonRequests.delete(key));
    return request;
  }

  getFixture(fixtureId: number, fresh = false): Promise<ApiFixture[]> {
    return this.get<ApiFixture[]>(
      "fixtures",
      { id: fixtureId },
      fresh ? 0 : config.cacheTtlMs.settledFixtures,
      fresh
    );
  }

  async getTeamRecentFixtures(teamId: number, last = 5): Promise<ApiFixture[]> {
    const cachedHistorySize = Math.max(40, last);
    const fixtures = await this.get<ApiFixture[]>(
      "fixtures",
      { team: teamId, last: cachedHistorySize },
      config.cacheTtlMs.recentTeamFixtures
    );
    return fixtures
      .sort((left, right) => right.fixture.timestamp - left.fixture.timestamp)
      .slice(0, last);
  }

  getTeamSeasonFixtures(teamId: number, season: number): Promise<ApiFixture[]> {
    return this.get<ApiFixture[]>(
      "fixtures",
      { team: teamId, season },
      config.cacheTtlMs.seasonFixtures
    );
  }

  getHeadToHead(homeTeamId: number, awayTeamId: number, last?: number): Promise<ApiFixture[]> {
    return this.get<ApiFixture[]>(
      "fixtures/headtohead",
      {
        h2h: `${homeTeamId}-${awayTeamId}`,
        ...(last === undefined ? {} : { last })
      },
      config.cacheTtlMs.headToHead
    );
  }

  getFixtureOdds(fixtureId: number): Promise<ApiFixtureOdds[]> {
    return this.get<ApiFixtureOdds[]>(
      "odds",
      { fixture: fixtureId },
      config.cacheTtlMs.odds
    );
  }

  async smoke(): Promise<{ accountReachable: boolean; leagues: number; requestsRemaining: number | null }> {
    const leagues = await this.getLeagues();
    return {
      accountReachable: true,
      leagues: leagues.length,
      requestsRemaining: this.requestsRemaining
    };
  }
}
