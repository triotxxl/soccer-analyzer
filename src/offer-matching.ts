/**
 * Ordnet die Spielliste eines deutschen Anbieters (OddsPapi, `src/oddspapi.ts`) den Fixtures von
 * API-Football zu (seit 10.11.2026, Davids Entscheidung: Angebotsliste über OddsPapi, Quoten weiter
 * von API-Football). Rein, ohne I/O.
 *
 * Warum ein eigener Abgleich und nicht `teamNameSimilarity` allein: OddsPapi schreibt Namen anders
 * als API-Football - mit Rechtsform und Bundesstaat („America FC MG“ gegen „America Mineiro“, „SC
 * Recife PE“ gegen „Sport Recife“), Gründungsjahren („Hebar 1918“), „B“/„Next Gen“ statt „II“/„U23“
 * und Frauenteams ohne „W“. Mit `teamNameSimilarity` ≥ 0,75 für beide Teams fanden sich am 10.11.2026
 * nur 205 von 252 Spielen (81 %). Deshalb:
 * 1. Wortvergleich ohne Rechtsformen, Jahreszahlen und Bundesstaaten; ein Name, dessen Wörter ganz im
 *    anderen stehen, gilt als gleich (Containment), allgemeine Wörter („Real“, „Atletico“) zählen nicht
 *    allein.
 * 2. Gleicher Anstoß ±3 Stunden; die Paarung muss eindeutig sein. Ein Team sehr sicher und das andere
 *    mit einem gemeinsamen Wort genügt nur bei fast gleichem Anstoß (±20 Minuten).
 * 3. Frauen- und zweite Mannschaften müssen auf beiden Seiten gleich markiert sein.
 * 4. Ein Spiel ohne eigenen Treffer zählt als angeboten, wenn ein anderes Spiel seiner API-Liga in
 *    derselben Analyse zugeordnet wurde - Anbieter führen Ligen als Ganzes. Davids Korrekturliste
 *    (`data/angebot-ligen.json`) geht allem vor.
 */
import { normalizeText } from "./util.ts";

/** Ein Spiel der Angebotsliste. */
export interface OfferFixture {
  id: string;
  home: string;
  away: string;
  /** Anstoß in Millisekunden (UTC). */
  kickoff: number;
  tournament: string;
}

/** Ein Spiel von API-Football, wie es die Auswahl kennt. */
export interface AfFixture {
  fixtureId: number;
  leagueId: number;
  home: string;
  away: string;
  kickoff: number;
}

/** Rechtsformen, Vereinskürzel und Füllwörter, die OddsPapi und API-Football verschieden führen. */
const NOISE = new Set([
  "fc", "cf", "sc", "ac", "afc", "fk", "sk", "bk", "if", "cd", "ca", "cs", "ud", "sd", "us", "as", "ssc", "pfc", "pfk",
  "ofc", "sfc", "ec", "cr", "rc", "rcd", "zks", "cwks", "ks", "oks", "msk", "gks", "mfk", "fkm", "nk", "hnk", "gnk",
  "club", "calcio", "clube", "futebol", "football", "sv", "tsv", "vfb", "vfl", "fsv", "bv", "ssv", "sad", "srl",
  "societa", "sportiva", "de", "del", "la", "el", "y", "and", "the", "do", "da", "di", "le", "les", "al", "cp", "ad",
  "csd", "sa", "aa", "fbc", "asd", "sportivo", "esporte", "atletica", "ii"
]);

/** Wörter, die zu vielen Vereinen gehören und allein keine Zuordnung tragen. */
const GENERIC = new Set([
  "real", "atletico", "sporting", "united", "city", "racing", "deportivo", "union", "san", "santa",
  "nacional", "national", "inter", "olympic", "olimpia", "dynamo", "dinamo", "spartak", "lokomotiv", "rangers",
  "athletico", "independiente", "town", "county", "rovers", "wanderers", "academy", "sport", "sports", "juventud",
  "universidad", "central", "sociedad", "esportivo", "estudiantes", "star", "stars", "fortuna", "victoria", "athletic"
]);

/** Brasilianische Bundesstaaten, die OddsPapi an Vereinsnamen hängt („Avai FC SC“). */
const BR_STATES = new Set([
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr", "pe", "pi", "rj",
  "rn", "rs", "ro", "rr", "sc", "sp", "se", "to"
]);

const WOMEN_PATTERN = /\b(w|wfc|lfc|women|womens|ladies|femenino|feminino|feminin|frauen|damen)\b/;
const RESERVE_PATTERN = /\b(b|ii|2|u23|u21|u19|reserves?|next gen|jong)\b/;

interface TeamKey {
  tokens: string[];
  women: boolean;
  reserve: boolean;
}

/**
 * Buchstaben, die `normalizeText` nicht zerlegt und deshalb zu Leerzeichen macht („Køge“ → „k ge“).
 * OddsPapi schreibt sie ausgeschrieben („Koege“, „Broendby“) - so auch hier (Befund vom 10.11.2026).
 */
const TRANSLITERATE: Array<[RegExp, string]> = [[/[øØ]/g, "oe"], [/[æÆ]/g, "ae"], [/[œŒ]/g, "oe"], [/[łŁ]/g, "l"], [/[đĐ]/g, "d"], [/ı/g, "i"]];

/**
 * Städte, die OddsPapi englisch und API-Football in Landessprache führt („Sparta Prague“ / „Sparta Praha“, 11.11.2026).
 * Abgebildet auf eine Schreibweise; die Ähnlichkeit der Wörter allein reicht dafür nicht.
 */
const CITY_NAMES = new Map<string, string>([
  ["prague", "praha"], ["belgrade", "beograd"], ["moscow", "moskva"], ["lisbon", "lisboa"], ["munich", "munchen"],
  ["cologne", "koln"], ["turin", "torino"], ["milan", "milano"], ["rome", "roma"], ["copenhagen", "kobenhavn"],
  ["bucharest", "bucuresti"], ["kiev", "kyiv"], ["athens", "athina"], ["warsaw", "warszawa"], ["vienna", "wien"]
]);

/** Teamnamen wiederholen sich in jedem Abgleich tausendfach - einmal zerlegt reicht. */
const TEAM_KEYS = new Map<string, TeamKey>();

export function teamKey(name: string): TeamKey {
  const cached = TEAM_KEYS.get(name);
  if (cached) return cached;
  const key = buildTeamKey(name);
  if (TEAM_KEYS.size > 50_000) TEAM_KEYS.clear();
  TEAM_KEYS.set(name, key);
  return key;
}

function buildTeamKey(name: string): TeamKey {
  const text = normalizeText(TRANSLITERATE.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), name));
  const women = WOMEN_PATTERN.test(text);
  const reserve = RESERVE_PATTERN.test(text);
  const raw = text.split(" ").filter(Boolean).map((token) => CITY_NAMES.get(token) ?? token);
  const tokens = raw.filter((token, index) => {
    if (NOISE.has(token)) return false;
    if (/^\d+$/.test(token)) return false;
    if (WOMEN_PATTERN.test(token) || RESERVE_PATTERN.test(token)) return false;
    // Bundesstaat nur als letztes Wort eines mehrteiligen Namens („Cuiaba EC MT“), nie allein.
    if (BR_STATES.has(token) && index === raw.length - 1 && raw.length > 1) return false;
    return true;
  });
  return { tokens, women, reserve };
}

function tokenMatches(left: string, right: string): boolean {
  if (left === right) return true;
  const short = left.length <= right.length ? left : right;
  const long = short === left ? right : left;
  // Abkürzungen und Schreibweisen: „goianiense“/„goianiense“, „gimnasia“/„gimnasia“, „koege“/„koge“.
  if (short.length >= 4 && long.startsWith(short)) return true;
  if (short.length >= 5 && editRatio(short, long) >= 0.8) return true;
  return false;
}

function editRatio(a: string, b: string): number {
  let prior = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(next[j - 1]! + 1, prior[j]! + 1, prior[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prior = next;
  }
  return 1 - prior[b.length]! / Math.max(a.length, b.length);
}

/**
 * Ähnlichkeit zweier Teamnamen, 0 bis 1. 1 heißt: Die Wörter des kürzeren Namens stehen alle im
 * längeren, und darunter ist mindestens ein nicht allgemeines Wort. Verschiedene Markierung als
 * Frauen- oder zweite Mannschaft ergibt 0.
 */
export function offerTeamSimilarity(left: string, right: string): number {
  const a = teamKey(left);
  const b = teamKey(right);
  if (a.women !== b.women || a.reserve !== b.reserve) return 0;
  if (a.tokens.length === 0 || b.tokens.length === 0) return 0;
  const [shorter, longer] = a.tokens.length <= b.tokens.length ? [a.tokens, b.tokens] : [b.tokens, a.tokens];
  const shared = shorter.filter((token) => longer.some((other) => tokenMatches(token, other)));
  if (shared.length === 0) {
    // Zusammengeschriebene Namen („CRB“ gegen „CR Brasil“ fällt hier heraus; „Chapecoense-sc“ nicht).
    const joinedA = a.tokens.join("");
    const joinedB = b.tokens.join("");
    return joinedA.length >= 5 && joinedA === joinedB ? 1 : 0;
  }
  // Nur allgemeine Wörter gemeinsam („Real“): schwach - außer der kürzere Name besteht aus zwei oder
  // mehr davon und steht ganz im anderen („Real Sociedad“).
  if (shared.every((token) => GENERIC.has(token))) return shared.length >= 2 && shared.length === shorter.length ? 1 : 0.4;
  return shared.length / shorter.length;
}

export interface OfferMatch {
  offer: OfferFixture;
  /** Heim und Gast stehen bei API-Football vertauscht. */
  swapped: boolean;
  score: number;
}

const NEAR_MS = 3 * 60 * 60 * 1000;
const SAME_KICKOFF_MS = 20 * 60 * 1000;
const SHIFTED_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * OddsPapi führt Frauenteams ohne „W“ („Juventus Turin“ in „UEFA Champions League Women“) und Jugend-Nationalteams
 * ohne Altersangabe („Iceland“ in „U21 UEFA European Championship, Qualification“, 11.11.2026); die Markierung kommt
 * dann aus dem Wettbewerb.
 */
function offerSide(name: string, tournament: string): string {
  const event = normalizeText(tournament);
  const own = normalizeText(name);
  let side = name;
  if (WOMEN_PATTERN.test(event) && !WOMEN_PATTERN.test(own)) side = `${side} Women`;
  const age = /\bu(\d{2})\b/.exec(event)?.[1];
  if (age && !/\bu\d{2}\b/.test(own)) side = `${side} U${age}`;
  return side;
}

/**
 * Das Spiel von API-Football zu einem Angebotsspiel auf einem Platzhaltertermin außerhalb des Zeitraums (seit
 * 11.11.2026: Ponte Preta – Operário bei Betano am 12.11., bei API-Football am 14.11.), bis ±4 Tage, eindeutig: beide
 * Teams sicher, sonst ein Team sicher und das andere mit gemeinsamem Wort („Athletic Club Sjdr MG“ / „Athletic Club“ -
 * „Athletic“ allein trägt keine Zuordnung). Sonst null.
 */
export function findShiftedFixture(offer: OfferFixture, fixtures: AfFixture[]): AfFixture | null {
  const near = fixtures
    .filter((fixture) => Math.abs(fixture.kickoff - offer.kickoff) <= SHIFTED_MS)
    .map((fixture) => ({ fixture, ...pairScore(fixture, offer) }));
  const sure = near.filter((entry) => entry.low >= 0.75);
  if (sure.length > 0) return sure.length === 1 ? sure[0]!.fixture : null;
  const loose = near.filter((entry) => entry.high >= 1 && entry.low >= 0.4);
  return loose.length === 1 ? loose[0]!.fixture : null;
}

/**
 * Kennt API-Football dieses Angebotsspiel überhaupt (seit 10.11.2026)? Großzügiger als `matchOfferFixture`, weil
 * hier ein falsches „unbekannt“ schlimmer wäre als ein übersehenes: beide Teams passen (bis ±4 Tage), oder ein
 * Team passt sicher bei fast gleichem Anstoß („CR Brasil AL“ gegen „CRB“, Ceará passt). Die Tagesliste trägt dafür
 * jedes Spiel, auch beendete und verlegte.
 */
export function offerKnown(offer: OfferFixture, fixtures: AfFixture[]): boolean {
  const home = offerSide(offer.home, offer.tournament);
  const away = offerSide(offer.away, offer.tournament);
  return fixtures.some((fixture) => {
    const dt = Math.abs(fixture.kickoff - offer.kickoff);
    if (dt > SHIFTED_MS) return false;
    const sims = [offerTeamSimilarity(fixture.home, home), offerTeamSimilarity(fixture.away, away),
      offerTeamSimilarity(fixture.home, away), offerTeamSimilarity(fixture.away, home)];
    if (Math.max(Math.min(sims[0]!, sims[1]!), Math.min(sims[2]!, sims[3]!)) >= 0.75) return true;
    return dt <= NEAR_MS && Math.max(...sims) >= 1;
  });
}

function pairScore(fixture: AfFixture, offer: OfferFixture): { score: number; swapped: boolean; low: number; high: number } {
  const home = offerSide(offer.home, offer.tournament);
  const away = offerSide(offer.away, offer.tournament);
  const straight = [offerTeamSimilarity(fixture.home, home), offerTeamSimilarity(fixture.away, away)] as const;
  const swapped = [offerTeamSimilarity(fixture.home, away), offerTeamSimilarity(fixture.away, home)] as const;
  const s = straight[0] + straight[1];
  const w = swapped[0] + swapped[1];
  const use = w > s ? swapped : straight;
  return { score: (use[0] + use[1]) / 2, swapped: w > s, low: Math.min(...use), high: Math.max(...use) };
}

/**
 * Sucht für ein Spiel von API-Football das Spiel der Angebotsliste. Gibt null zurück, wenn keines
 * sicher und eindeutig passt.
 */
export function matchOfferFixture(fixture: AfFixture, offers: OfferFixture[]): OfferMatch | null {
  const scored = offers
    .map((offer) => ({ offer, dt: Math.abs(offer.kickoff - fixture.kickoff), ...pairScore(fixture, offer) }))
    .filter((entry) => entry.high > 0);
  const accept = (entry: (typeof scored)[number], window: number): boolean => entry.dt <= window && (
    (entry.low >= 0.75) ||
    // Ein Team sicher, das andere mit gemeinsamem Wort: nur bei fast gleichem Anstoß.
    (entry.high >= 1 && entry.low >= 0.4 && entry.dt <= SAME_KICKOFF_MS)
  );
  for (const window of [NEAR_MS, SHIFTED_MS]) {
    const candidates = scored
      .filter((entry) => window === NEAR_MS ? accept(entry, window) : entry.dt <= window && entry.low >= 1)
      .sort((left, right) => right.score - left.score || left.dt - right.dt);
    const best = candidates[0];
    if (!best) continue;
    const runnerUp = candidates[1];
    // Zwei gleich gute Kandidaten: lieber keine Zuordnung als die falsche.
    if (runnerUp && runnerUp.score >= best.score - 0.1 && Math.abs(runnerUp.dt - best.dt) < SAME_KICKOFF_MS) return null;
    return { offer: best.offer, swapped: best.swapped, score: best.score };
  }
  return null;
}

export interface OfferDecision {
  /** Spiele, die es beim Anbieter gibt (direkt zugeordnet, über die Liga oder über `include`). */
  allowed: Set<number>;
  matched: Map<number, OfferMatch>;
  /** Ohne eigenen Treffer, aber ein anderes Spiel derselben Liga wurde zugeordnet. */
  viaLeague: Set<number>;
  /** Spiele, die nicht im Angebot stehen. */
  dropped: Set<number>;
  /** API-Ligen mit mindestens einem direkt zugeordneten Spiel. */
  offeredLeagues: Set<number>;
}

/**
 * Entscheidet je Spiel, ob es im Angebot steht. `include`/`exclude` sind API-Liga-IDs aus Davids
 * Korrekturliste und gehen vor.
 */
export function decideOffer(
  fixtures: AfFixture[],
  offers: OfferFixture[],
  corrections: { include: Set<number>; exclude: Set<number> }
): OfferDecision {
  const matched = new Map<number, OfferMatch>();
  const used = new Map<string, number>();
  for (const fixture of fixtures) {
    const match = matchOfferFixture(fixture, offers);
    if (!match) continue;
    // Ein Angebotsspiel gehört höchstens zu einem Fixture; beim zweiten Anspruch gewinnt der bessere.
    const previous = used.get(match.offer.id);
    if (previous !== undefined) {
      if ((matched.get(previous)?.score ?? 0) >= match.score) continue;
      matched.delete(previous);
    }
    used.set(match.offer.id, fixture.fixtureId);
    matched.set(fixture.fixtureId, match);
  }
  const offeredLeagues = new Set(fixtures.filter((fixture) => matched.has(fixture.fixtureId)).map((fixture) => fixture.leagueId));
  const allowed = new Set<number>();
  const viaLeague = new Set<number>();
  const dropped = new Set<number>();
  for (const fixture of fixtures) {
    if (corrections.exclude.has(fixture.leagueId)) dropped.add(fixture.fixtureId);
    else if (matched.has(fixture.fixtureId) || corrections.include.has(fixture.leagueId)) allowed.add(fixture.fixtureId);
    else if (offeredLeagues.has(fixture.leagueId)) {
      allowed.add(fixture.fixtureId);
      viaLeague.add(fixture.fixtureId);
    } else dropped.add(fixture.fixtureId);
  }
  return { allowed, matched, viaLeague, dropped, offeredLeagues };
}
