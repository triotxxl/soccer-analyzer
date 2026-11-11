/**
 * Angebotsliste deutscher Anbieter über OddsPapi (seit 10.11.2026, Davids Entscheidung: „Angebotsliste
 * über OddsPapi, Quoten von API-Football“).
 *
 * API-Football sagt nicht, von welcher Betano-Seite seine Quoten stammen, und führt Spiele, die es bei
 * betano.de nicht gibt (U19-EM-Qualifikation, englischer Frauen-Ligapokal, argentinische Reserveliga).
 * OddsPapi führt die deutschen Seiten einzeln (`betano.de`, `tipico` = „Tipico DE“). Gelesen wird nur
 * `/v4/fixtures` mit `hasOdds=true&bookmakers=<slug>`, nie Quoten: Die kosten bei OddsPapi einen Aufruf
 * je Spiel oder je drei Ligen und Anbieter, das Gratis-Kontingent hat 250 Aufrufe im Monat.
 *
 * Kosten: `/v4/fixtures` erlaubt nur unter 48 Stunden je Aufruf. Die Fenster sind deshalb feste
 * Zwei-Tage-Blöcke ab einem geraden UTC-Tag (`offerBlocks`), damit aufeinanderfolgende Analysen
 * dieselben Blöcke aus dem Cache lesen (`config.cacheTtlMs.offerListing`, 3 Stunden). Eine Analyse
 * `next48` braucht 2-3 Blöcke, also höchstens 3 Aufrufe; prepare-analysis und eine Analyse kurz danach
 * teilen sie. Vor jedem Abruf prüft `/v4/account` (zählt nicht) das Kontingent und hält
 * `config.oddsPapiReserve` zurück.
 *
 * Messung vom 10.11.2026 (`src/offer-matching.ts`): von 243 Betano-Spielen bei API-Football 157 direkt
 * zugeordnet, 14 über ihre Liga, 72 weggelassen - alle 26 unsicheren Zuordnungen von Hand geprüft
 * richtig.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { FileCache } from "./cache.ts";
import { config, ODDSPAPI_CACHE_DIR } from "./config.ts";
import type { OfferFixture } from "./offer-matching.ts";

const HOST = "https://api.oddspapi.io";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Pause zwischen zwei Abrufen der Spielliste laut Doku (2000 ms) mit etwas Luft. */
const FIXTURES_COOLDOWN_MS = 2_100;
/**
 * HTTP 429 ohne REQUEST_LIMIT_EXCEEDED ist die Sperrzeit eines Endpunkts, nicht das Monatskontingent: Am
 * 10.11.2026 lehnte `/v4/account` direkt nach einem Abruf der Spielliste so ab, und die Analyse fiel auf die
 * Näherung zurück. Kurz warten und neu versuchen.
 */
const RETRY_AFTER_429_MS = 2_500;
const RETRIES_AFTER_429 = 2;

interface RawOddsPapiFixture {
  fixtureId: string;
  participant1Name: string;
  participant2Name: string;
  startTime: string;
  tournamentName?: string;
  categoryName?: string;
}

export interface OddsPapiQuota {
  requestCount: number;
  requestLimit: number;
}

/** Feste Zwei-Tage-Blöcke (Beginn ein gerader UTC-Tag), die [from, to] abdecken. */
export function offerBlocks(fromMs: number, toMs: number): Array<{ from: number; to: number }> {
  const firstDay = Math.floor(fromMs / DAY_MS);
  let start = (firstDay - (((firstDay % 2) + 2) % 2)) * DAY_MS;
  const blocks: Array<{ from: number; to: number }> = [];
  while (start <= toMs) {
    // „unter 48 Stunden“ verlangt die API; eine Sekunde weniger, der nächste Block beginnt genau danach.
    blocks.push({ from: start, to: start + 2 * DAY_MS - 1000 });
    start += 2 * DAY_MS;
  }
  return blocks;
}

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function oddsPapiKey(): string {
  // Wie requireApiKey frisch aus der Umgebung: .env kann nach dem Import geladen werden.
  return process.env.ODDSPAPI_KEY ?? "";
}

export class OddsPapiClient {
  requestCount = 0;
  private readonly cache: FileCache;
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey: string;
  private readonly pauseMs: number;
  private readonly retryMs: number;
  private lastCall = 0;
  /** Kontostand der ersten Abfrage dieses Laufs; danach zählt der Client selbst (`requestCount`). */
  private quotaAtStart: { quota: OddsPapiQuota | null; requestsBefore: number } | undefined;

  constructor(options: { apiKey?: string; cache?: FileCache; fetchImpl?: typeof fetch; pauseMs?: number; retryMs?: number } = {}) {
    this.apiKey = options.apiKey ?? oddsPapiKey();
    this.cache = options.cache ?? new FileCache(ODDSPAPI_CACHE_DIR);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pauseMs = options.pauseMs ?? FIXTURES_COOLDOWN_MS;
    this.retryMs = options.retryMs ?? RETRY_AFTER_429_MS;
    if (!this.apiKey) throw new Error("ODDSPAPI_KEY fehlt in .env");
  }

  private async getJson<T>(pathname: string, params: Record<string, string>): Promise<T> {
    const url = new URL(pathname, HOST);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("apiKey", this.apiKey);
    let response: Response;
    let body: T & { message?: string; code?: string };
    for (let attempt = 0; ; attempt += 1) {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(config.timeoutMs) });
      body = await response.json().catch(() => null) as T & { message?: string; code?: string; error?: { code?: string } };
      const cooldown = response.status === 429 && body?.code !== "REQUEST_LIMIT_EXCEEDED";
      if (!cooldown || attempt >= RETRIES_AFTER_429) break;
      await sleep(this.retryMs * (attempt + 1));
    }
    if (!response.ok) {
      const code = body?.code ?? (body as { error?: { code?: string } } | null)?.error?.code;
      // Die URL trägt den Schlüssel - sie gehört nicht in die Meldung.
      throw Object.assign(new Error(`OddsPapi ${pathname}: HTTP ${response.status}${code ? ` ${code}` : ""}`), { status: response.status, code });
    }
    return body;
  }

  /** Stand nach diesem Lauf, ohne neue Abfrage: erste Abfrage plus die seither selbst gezählten Aufrufe. */
  currentQuota(): OddsPapiQuota | null {
    const start = this.quotaAtStart;
    if (!start?.quota) return null;
    return { ...start.quota, requestCount: start.quota.requestCount + this.requestCount - start.requestsBefore };
  }

  /** Kontostand; `/v4/account` zählt nicht gegen das Kontingent. */
  async quota(): Promise<OddsPapiQuota | null> {
    const account = await this.getJson<{ subscriptions?: Array<{ is_active?: boolean; request_count?: number; request_limit?: number }> }>(
      "/v4/account", {}
    );
    const subscription = account.subscriptions?.find((entry) => entry.is_active !== false) ?? account.subscriptions?.[0];
    if (typeof subscription?.request_count !== "number" || typeof subscription.request_limit !== "number") return null;
    return { requestCount: subscription.request_count, requestLimit: subscription.request_limit };
  }

  /**
   * Alle Spiele mit Quote bei `bookmaker` aus den Zwei-Tage-Blöcken, die [fromMs, toMs] abdecken - ganze Blöcke,
   * also bis zu zwei Tage über `toMs` hinaus (seit 10.11.2026: Bei einem Platzhaltertermin liegt der echte Termin
   * oft dahinter, und der Block ist ohnehin bezahlt). Blöcke aus dem Cache kosten nichts; für die übrigen wird
   * vorher das Kontingent geprüft.
   */
  async offerFixtures(fromMs: number, toMs: number, bookmaker: string): Promise<OfferFixture[]> {
    const blocks = offerBlocks(fromMs, toMs).map((block) => ({
      ...block,
      key: `oddspapi:fixtures:${bookmaker}:${isoSeconds(block.from)}`
    }));
    const lists: RawOddsPapiFixture[][] = [];
    const missing: typeof blocks = [];
    for (const block of blocks) {
      const cached = await this.cache.get<RawOddsPapiFixture[]>(block.key, config.cacheTtlMs.offerListing);
      if (cached) lists.push(cached);
      else missing.push(block);
    }
    if (missing.length > 0) {
      // Einmal je Lauf fragen, danach selbst mitzählen - jede weitere Abfrage riskiert die Sperrzeit.
      this.quotaAtStart ??= { quota: await this.quota(), requestsBefore: this.requestCount };
      const quota = this.currentQuota();
      if (quota && quota.requestLimit - quota.requestCount < missing.length + config.oddsPapiReserve) {
        throw new Error(`OddsPapi-Kontingent fast aufgebraucht (${quota.requestCount} von ${quota.requestLimit}, `
          + `Reserve ${config.oddsPapiReserve})`);
      }
    }
    for (const block of missing) {
      const wait = this.lastCall + this.pauseMs - Date.now();
      if (this.lastCall > 0 && wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      this.requestCount += 1;
      // Ein leerer Block kommt als HTTP 404 FIXTURE_NOT_FOUND (gemessen 11.11.2026) und zählt trotzdem als Aufruf:
      // eine leere Liste, gespeichert wie jede andere - kein Rückfall auf die Näherung.
      const body = await this.getJson<RawOddsPapiFixture[] | { data?: RawOddsPapiFixture[] }>("/v4/fixtures", {
        sportId: "10",
        from: isoSeconds(block.from),
        to: isoSeconds(block.to),
        hasOdds: "true",
        bookmakers: bookmaker
      }).catch((error: Error & { status?: number; code?: string }) => {
        if (error.status === 404 && error.code === "FIXTURE_NOT_FOUND") return [] as RawOddsPapiFixture[];
        throw error;
      });
      const list = Array.isArray(body) ? body : body.data ?? [];
      await this.cache.set(block.key, list);
      lists.push(list);
    }
    const seen = new Set<string>();
    const fixtures: OfferFixture[] = [];
    for (const item of lists.flat()) {
      const kickoff = Date.parse(item.startTime);
      if (seen.has(item.fixtureId) || !Number.isFinite(kickoff)) continue;
      seen.add(item.fixtureId);
      fixtures.push({
        id: item.fixtureId,
        home: item.participant1Name,
        away: item.participant2Name,
        kickoff,
        tournament: [item.categoryName, item.tournamentName].filter(Boolean).join(" | ")
      });
    }
    return fixtures;
  }
}
