/**
 * Spiele und Quoten direkt aus API-Football (Quelle "api", seit 09.11.2026).
 *
 * Bis dahin legte Davids Tipico-Export (`data.json`, src/tipico.ts) fest, welche Spiele analysiert
 * werden und welche Quoten neben den Märkten stehen. Den Export gibt es nicht mehr; API-Football
 * führt Tipico (22) zwar noch, liefert aber 0 Spiele. Betano (32) führte am 08.11.2026 762 Spiele
 * und deckte 290 der 299 Spiele des letzten Tipico-Laufs ab; Bet365 (8) brachte 6 dazu.
 *
 * Regeln:
 * - Analysiert wird jedes Spiel, für das ein Anbieter aus `config.oddsBookmakers` Quoten führt
 *   (Davids Entscheidung: alle Betano-Spiele). Ob eine Quote **vorhanden** ist, entscheidet über die
 *   Auswahl; ihr **Preis** nie (AGENTS.md, „Grenzen“).
 * - Ein Spiel bekommt alle Quoten von genau einem Anbieter, in der festen Reihenfolge der Liste -
 *   nie den besseren Preis je Markt. Sonst stünden Quote und Gegenquote verschiedener Anbieter
 *   nebeneinander, und der faire Preis (`src/fair-price.ts`) wäre falsch.
 * - Zeitfenster wie beim Tipico-Import: Anpfiff höchstens `liveCandidateTrailMs` her, der Berliner
 *   Tag des Anpfiffs liegt im Umfang, bei `next48` harte Grenze 48 Stunden.
 * - Die Liga kommt als ID mit (`LeagueSelection.apiLeagueId`), die Spiele als Fixture-IDs
 *   (`AnalysisInput.fixtureIds`) - Aliase und Namensvergleich entfallen auf diesem Weg.
 */
import type { ApiFootballClient } from "./api.ts";
import { config } from "./config.ts";
import type {
  AnalysisInput,
  ApiBookmakerOdds,
  ApiFixtureOdds,
  ApiOddsBet,
  DateRange,
  LeagueSelection,
  MarketOdds
} from "./types.ts";
import { datesForRange, zonedDate } from "./util.ts";

/** Wett-IDs von API-Football, am 08./09.11.2026 bei Betano und Bet365 so geführt. */
const BET_IDS = {
  matchWinner: { id: 1, name: /^match winner$/i },
  goalsOverUnder: { id: 5, name: /^goals over\/under$/i },
  goalsOverUnderFirstHalf: { id: 6, name: /^goals over\/under first half$/i },
  bothTeamsScore: { id: 8, name: /^both teams score$/i }
} as const;

function betOf(bets: ApiOddsBet[], wanted: { id: number; name: RegExp }): ApiOddsBet | undefined {
  // Die ID allein reicht nicht sicher: Wer sie je Anbieter anders vergibt, bekäme still den falschen
  // Markt. Deshalb muss auch der Name passen.
  return bets.find((bet) => bet.id === wanted.id && wanted.name.test(bet.name.trim()));
}

function priceOf(bet: ApiOddsBet | undefined, value: string): number | undefined {
  const entry = bet?.values.find((item) => String(item.value).trim().toLocaleLowerCase() === value.toLocaleLowerCase());
  const odd = entry === undefined ? Number.NaN : Number(entry.odd);
  // Wie bei Tipico: Eine Quote unter oder gleich 1 gibt es nicht, das heißt "keine Quote".
  return Number.isFinite(odd) && odd > 1 ? odd : undefined;
}

/** Die Quoten der Dashboard-Märkte aus den Wetten eines Anbieters. Fehlende Felder bleiben weg. */
export function marketOddsOf(bets: ApiOddsBet[]): MarketOdds {
  const winner = betOf(bets, BET_IDS.matchWinner);
  const totals = betOf(bets, BET_IDS.goalsOverUnder);
  const firstHalf = betOf(bets, BET_IDS.goalsOverUnderFirstHalf);
  const btts = betOf(bets, BET_IDS.bothTeamsScore);
  const entries: Array<[keyof MarketOdds, number | undefined]> = [
    ["home", priceOf(winner, "Home")],
    ["draw", priceOf(winner, "Draw")],
    ["away", priceOf(winner, "Away")],
    ["bttsYes", priceOf(btts, "Yes")],
    ["bttsNo", priceOf(btts, "No")],
    ["over15", priceOf(totals, "Over 1.5")],
    ["under15", priceOf(totals, "Under 1.5")],
    ["over25", priceOf(totals, "Over 2.5")],
    ["under25", priceOf(totals, "Under 2.5")],
    ["over35", priceOf(totals, "Over 3.5")],
    ["under35", priceOf(totals, "Under 3.5")],
    ["firstHalfOver05", priceOf(firstHalf, "Over 0.5")],
    ["firstHalfUnder05", priceOf(firstHalf, "Under 0.5")],
    ["firstHalfOver15", priceOf(firstHalf, "Over 1.5")],
    ["firstHalfUnder15", priceOf(firstHalf, "Under 1.5")]
  ];
  const odds: MarketOdds = {};
  for (const [key, value] of entries) if (value !== undefined) odds[key] = value;
  return odds;
}

function hasAnyOdds(odds: MarketOdds): boolean {
  return Object.keys(odds).length > 0;
}

export interface ApiOddsEvent {
  fixtureId: number;
  leagueId: number;
  country: string;
  league: string;
  season: number;
  kickoff: string;
  bookmakerId: number;
  bookmaker: string;
  /** Wann API-Football die Quoten zuletzt aktualisiert hat; null, wenn die Antwort es nicht sagt. */
  updatedAt: string | null;
  odds: MarketOdds;
}

export interface ApiOddsImportResult {
  input: AnalysisInput;
  events: ApiOddsEvent[];
  /** Spiele je Anbieter (Name), nach der Wahl je Spiel. */
  byBookmaker: Map<string, number>;
  /** Spiele, die ein Anbieter überhaupt führte, vor Zeitfenster und Wahl. */
  listed: number;
  apiRequests: number;
  /** Anbieter, deren Liste nicht geladen werden konnte (nur nach dem ersten, sonst bricht der Import ab). */
  failedBookmakers: Array<{ bookmakerId: number; message: string }>;
}

interface Candidate {
  item: ApiFixtureOdds;
  bookmaker: ApiBookmakerOdds;
  odds: MarketOdds;
  rank: number;
}

function kickoffMs(item: ApiFixtureOdds): number | null {
  if (typeof item.fixture.timestamp === "number") return item.fixture.timestamp * 1000;
  const parsed = item.fixture.date ? Date.parse(item.fixture.date) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Wählt je Spiel den Anbieter. Reine Funktion über die geladenen Listen (in Reihenfolge der
 * Anbieter), damit sie ohne API prüfbar ist.
 */
export function selectApiOddsEvents(
  listings: Array<{ bookmakerId: number; items: ApiFixtureOdds[] }>,
  dates: DateRange,
  now: Date,
  timezone = config.timezone
): { events: ApiOddsEvent[]; listed: number } {
  const requestedDates = new Set(datesForRange(dates, timezone, now));
  const rollingLimit = dates === "next48" ? now.getTime() + 48 * 60 * 60 * 1000 : null;
  const earliestKickoff = now.getTime() - config.liveCandidateTrailMs;
  const chosen = new Map<number, Candidate>();
  const listedIds = new Set<number>();
  listings.forEach(({ bookmakerId, items }, rank) => {
    for (const item of items) {
      listedIds.add(item.fixture.id);
      const bookmaker = item.bookmakers.find((entry) => entry.id === bookmakerId);
      if (!bookmaker || !item.league) continue;
      const kickoff = kickoffMs(item);
      if (kickoff === null) continue;
      if (kickoff <= earliestKickoff) continue;
      if (rollingLimit !== null && kickoff > rollingLimit) continue;
      // Der Berliner Tag des echten Anpfiffs zählt, nicht der Tag, unter dem die Liste geholt wurde.
      if (!requestedDates.has(zonedDate(new Date(kickoff), timezone))) continue;
      const odds = marketOddsOf(bookmaker.bets);
      if (!hasAnyOdds(odds)) continue;
      const existing = chosen.get(item.fixture.id);
      const hasWinner = odds.home !== undefined && odds.away !== undefined;
      const existingHasWinner = existing !== undefined && existing.odds.home !== undefined && existing.odds.away !== undefined;
      // Erster Anbieter der Liste mit 1X2 gewinnt; ohne 1X2 bei irgendwem der erste mit irgendeiner Quote.
      if (existing === undefined || (!existingHasWinner && hasWinner)) {
        chosen.set(item.fixture.id, { item, bookmaker, odds, rank });
      }
    }
  });
  const events = [...chosen.values()]
    .map(({ item, bookmaker, odds }): ApiOddsEvent => ({
      fixtureId: item.fixture.id,
      leagueId: item.league!.id,
      country: item.league!.country,
      league: item.league!.name,
      season: item.league!.season,
      kickoff: new Date(kickoffMs(item)!).toISOString(),
      bookmakerId: bookmaker.id,
      bookmaker: bookmaker.name,
      updatedAt: item.update ?? null,
      odds
    }))
    .sort((left, right) => Date.parse(left.kickoff) - Date.parse(right.kickoff) || left.fixtureId - right.fixtureId);
  return { events, listed: listedIds.size };
}

/** Lädt die Quotenlisten (Tage und Anbieter strikt nacheinander) und baut daraus die Auswahl. */
export async function importApiOdds(
  client: ApiFootballClient,
  dates: DateRange,
  now = new Date(),
  options: { bookmakers?: number[]; timezone?: string } = {}
): Promise<ApiOddsImportResult> {
  const timezone = options.timezone ?? config.timezone;
  const bookmakers = options.bookmakers ?? config.oddsBookmakers;
  const before = client.requestCount;
  const listings: Array<{ bookmakerId: number; items: ApiFixtureOdds[] }> = [];
  const failedBookmakers: ApiOddsImportResult["failedBookmakers"] = [];
  for (const [index, bookmakerId] of bookmakers.entries()) {
    const items: ApiFixtureOdds[] = [];
    try {
      for (const date of datesForRange(dates, timezone, now)) {
        items.push(...await client.getOddsByDate(date, bookmakerId, timezone));
      }
    } catch (error) {
      // Ohne den ersten Anbieter fehlte der Großteil der Spiele - lieber gar kein Dashboard als ein
      // still verkürztes. Ein Ersatzanbieter darf ausfallen.
      if (index === 0) throw error;
      failedBookmakers.push({ bookmakerId, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    listings.push({ bookmakerId, items });
  }
  const { events, listed } = selectApiOddsEvents(listings, dates, now, timezone);
  const selections = new Map<number, LeagueSelection>();
  for (const event of events) {
    if (!selections.has(event.leagueId)) {
      selections.set(event.leagueId, { country: event.country, league: event.league, apiLeagueId: event.leagueId });
    }
  }
  const byBookmaker = new Map<string, number>();
  for (const event of events) byBookmaker.set(event.bookmaker, (byBookmaker.get(event.bookmaker) ?? 0) + 1);
  return {
    input: {
      selections: [...selections.values()],
      markets: ["1x2", "draw", "btts", "over25"],
      dates,
      fixtureIds: events.map((event) => event.fixtureId)
    },
    events,
    byBookmaker,
    listed,
    apiRequests: client.requestCount - before,
    failedBookmakers
  };
}
