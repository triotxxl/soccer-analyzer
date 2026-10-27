import { countryFlagCode } from "../../shared/src/countryFlags";
import { competitionCountry, competitionLeague, teamName, type NameSource } from "../../shared/src/names";
import type { DashboardDocument, DashboardFixture, DashboardMarket, DashboardMarketKey, FormResult } from "../../shared/src/types";

/**
 * Alles, was Neo aus dem Snapshot ableitet - rein, ohne React und ohne Netz. Aufbau und Regeln
 * folgen der freigegebenen Referenz `docs/neo-referenz.html` (dort mit Mockdaten); hier stehen
 * dieselben Ansichten auf den echten Feldern von `output/dashboard-latest.json`.
 */

// ===== Kalendertage (in der Zeitzone des Snapshots) ===========================

/** YYYY-MM-DD eines Zeitpunkts in `timezone`. */
export function dayKey(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const parseDay = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y!, m! - 1, d!)); };
const toDay = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => { const d = parseDay(day); d.setUTCDate(d.getUTCDate() + n); return toDay(d); };
/** 0 = Montag … 6 = Sonntag */
export const weekdayIndex = (day: string) => (parseDay(day).getUTCDay() + 6) % 7;

export function formatDay(day: string, style: "short" | "long" = "short"): string {
  return parseDay(day).toLocaleDateString("de-DE", style === "long"
    ? { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }
    : { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
}

export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Zeitraum (von–bis) oder einzelne Tage, wie im Date-Picker der Referenz. */
export type DayScope = { mode: "range"; from: string; to: string } | { mode: "days"; days: string[] };

export const inScope = (scope: DayScope, day: string) =>
  scope.mode === "days" ? scope.days.includes(day) : day >= scope.from && day <= scope.to;

export function scopeLabel(scope: DayScope): string {
  if (scope.mode === "days") {
    const d = scope.days;
    if (!d.length) return "Keine Tage gewählt";
    if (d.length === 1) return formatDay(d[0]!);
    if (d.length === 2) return `${formatDay(d[0]!)} + ${formatDay(d[1]!)}`;
    return `${d.length} Tage · ${formatDay(d[0]!)} …`;
  }
  return scope.from === scope.to ? formatDay(scope.from) : `${formatDay(scope.from)} – ${formatDay(scope.to)}`;
}

/** „am …“ / „im Zeitraum …“ / „an den gewählten Tagen …“ für Leerzustände. */
export function scopePhrase(scope: DayScope): string {
  if (scope.mode === "days") return (scope.days.length === 1 ? "am " : "an den gewählten Tagen ") + scopeLabel(scope);
  return (scope.from === scope.to ? "am " : "im Zeitraum ") + scopeLabel(scope);
}

/**
 * Schnellwahl des Date-Pickers, gerechnet ab dem echten heutigen Tag. Die Referenz hatte feste
 * Mock-Daten; „Pokal-Woche“ ist hier Dienstag bis Donnerstag der laufenden Woche (danach der
 * nächsten), „Wochenende“ Freitag bis Sonntag.
 */
export function datePresets(today: string, firstDay: string, lastDay: string): Array<[label: string, from: string, to: string]> {
  const wd = weekdayIndex(today);
  const friday = wd <= 4 ? addDays(today, 4 - wd) : addDays(today, -(wd - 4));
  const weekendFrom = wd >= 4 ? today : friday;
  const weekendTo = addDays(friday, 2);
  const cupFrom = wd <= 3 ? addDays(today, Math.max(0, 1 - wd)) : addDays(today, 8 - wd);
  const cupTo = wd <= 3 ? addDays(today, 3 - wd) : addDays(cupFrom, 2);
  return [
    ["Heute", today, today],
    ["Nächste 7 Tage", today, addDays(today, 6)],
    ["Wochenende", weekendFrom, weekendTo],
    ["Pokal-Woche", cupFrom, cupTo],
    ["Nächstes WE", addDays(weekendTo, 5), addDays(weekendTo, 7)],
    ["Alle", firstDay, lastDay],
  ];
}

// ===== Wettbewerbe =============================================================

export interface Competition {
  id: string;
  country: string;
  league: string;
  tipicoCountries: string[];
  tipicoLeagues: string[];
  cup: boolean;
  code: string;
}

export interface CountryGroup {
  id: string;
  code: string;
  competitions: Competition[];
}

export const competitionId = (fixture: Pick<DashboardFixture, "country" | "league">) => `${fixture.country}|${fixture.league}`;

/** Länderkürzel wie in der Referenz („DE“, „ENG“), aus dem API-Land. */
export function countryCode(country: string): string {
  const code = countryFlagCode(country);
  if (code.startsWith("gb-")) return code.slice(3).toUpperCase();
  if (code) return code.toUpperCase();
  return country === "World" ? "INT" : country.slice(0, 3).toUpperCase();
}

const CUP_PATTERN = /cup|pokal|copa|coupe|coppa|taça|taca|kupa|beker|trophy|shield|super ?cup|supercopa/i;

/** Ein Pokal ist nicht gesondert im Snapshot vermerkt: Name, Spiele zwischen Ligen oder fehlende Tabelle. */
export function isCup(fixtures: readonly DashboardFixture[]): boolean {
  const first = fixtures[0];
  if (!first) return false;
  return CUP_PATTERN.test(first.league) || fixtures.every((f) => f.crossLeague || !f.table?.length);
}

export function competitionsOf(fixtures: readonly DashboardFixture[]): Competition[] {
  const byId = new Map<string, DashboardFixture[]>();
  for (const fixture of fixtures) {
    const id = competitionId(fixture);
    byId.set(id, [...(byId.get(id) ?? []), fixture]);
  }
  return [...byId.entries()].map(([id, list]) => ({
    id,
    country: list[0]!.country,
    league: list[0]!.league,
    tipicoCountries: list.flatMap((f) => (f.tipico ? [f.tipico.country] : [])),
    tipicoLeagues: list.flatMap((f) => (f.tipico ? [f.tipico.league] : [])),
    cup: isCup(list),
    code: countryCode(list[0]!.country),
  }));
}

/** Land > Wettbewerb, alphabetisch in der gewählten Namensquelle, Ligen vor Pokalen. */
export function competitionTree(competitions: readonly Competition[], source: NameSource): CountryGroup[] {
  const byCountry = new Map<string, Competition[]>();
  for (const c of competitions) byCountry.set(c.country, [...(byCountry.get(c.country) ?? []), c]);
  const name = (c: Competition) => competitionLeague(c, source);
  return [...byCountry.entries()]
    .map(([id, list]) => ({
      id,
      code: list[0]!.code,
      competitions: [...list].sort((a, b) => Number(a.cup) - Number(b.cup) || name(a).localeCompare(name(b), "de")),
    }))
    .sort((a, b) => countryLabel(a, source).localeCompare(countryLabel(b, source), "de"));
}

export const countryLabel = (group: CountryGroup, source: NameSource) => competitionCountry(group.competitions[0]!, source);

// ===== Märkte ==================================================================

export const marketOf = (fixture: Pick<DashboardFixture, "markets">, key: DashboardMarketKey): DashboardMarket | undefined =>
  fixture.markets.find((m) => m.key === key);

export interface OneXTwo { home: number; draw: number; away: number }

/**
 * Heimsieg, Remis, Auswärtssieg laut Modell. Der Snapshot trägt die Chance der `pick`-Seite und
 * das Remis; die Gegenseite ist der Rest (wie `src/kombi-tipps.ts`). **`null`, wenn das 1X2 nicht
 * belastbar ist** (Spiele zwischen Ligen ohne Stärkevergleich) - dann gibt es keine Chance zu zeigen.
 */
export function oneXTwo(fixture: Pick<DashboardFixture, "markets">): OneXTwo | null {
  const winner = marketOf(fixture, "1x2"), draw = marketOf(fixture, "draw");
  if (!winner || !draw || winner.probabilityReliable === false || !winner.pick) return null;
  const pick = winner.probability, other = Math.max(0, 1 - winner.probability - draw.probability);
  return winner.pick === "1"
    ? { home: pick, draw: draw.probability, away: other }
    : { home: other, draw: draw.probability, away: pick };
}

/** Tipico-Quoten für 1, X und 2 - nur Anzeige, sie ändern keinen Tipp. */
export function oddsTriple(fixture: Pick<DashboardFixture, "markets">): [number | null, number | null, number | null] {
  const winner = marketOf(fixture, "1x2"), draw = marketOf(fixture, "draw");
  return [winner?.oddsHome ?? null, draw?.odds ?? null, winner?.oddsAway ?? null];
}

// ===== Modell-Tipps (Ansicht „Predictions“) ====================================

export type TipMarket = "1x2" | "ou" | "btts";
export const TIP_MARKETS: Array<[key: TipMarket, label: string, sub: string]> = [
  ["1x2", "1X2", "Endergebnis"],
  ["ou", "Über/Unter 2,5", "Tore gesamt"],
  ["btts", "BTTS", "Beide treffen"],
];

export interface Tip {
  id: string;
  fixture: DashboardFixture;
  market: TipMarket;
  marketLabel: string;
  pick: string;
  probability: number;
  odds: number | null;
}

/** Alle Kandidaten eines Spiels; ohne Chance (nicht belastbar) kein Kandidat. */
export function tipCandidates(fixture: DashboardFixture, source: NameSource): Tip[] {
  const tips: Tip[] = [];
  const add = (market: TipMarket, marketLabel: string, pick: string, probability: number, odds: number | null, side: string) =>
    tips.push({ id: `${fixture.fixtureId}:${market}:${side}`, fixture, market, marketLabel, pick, probability, odds });
  const triple = oneXTwo(fixture), [o1, ox, o2] = oddsTriple(fixture);
  if (triple) {
    add("1x2", "Endergebnis", `${teamName(fixture, "home", source)} gewinnt`, triple.home, o1, "1");
    add("1x2", "Endergebnis", "Unentschieden", triple.draw, ox, "x");
    add("1x2", "Endergebnis", `${teamName(fixture, "away", source)} gewinnt`, triple.away, o2, "2");
  }
  for (const [key, market, label, pick] of [
    ["over25", "ou", "Über / Unter", "Über 2,5 Tore"], ["under25", "ou", "Über / Unter", "Unter 2,5 Tore"],
    ["btts", "btts", "Beide treffen", "Ja"], ["bttsNo", "btts", "Beide treffen", "Nein"],
  ] as const) {
    const m = marketOf(fixture, key);
    if (m && m.probabilityReliable !== false) add(market, label, pick, m.probability, m.odds, key);
  }
  return tips;
}

/** Modell: je Spiel der wahrscheinlichste Tipp aus den gewählten Märkten, im Wahrscheinlichkeitsbereich. */
export function modelTips(fixtures: readonly DashboardFixture[], markets: readonly TipMarket[], min: number, max: number, source: NameSource): Tip[] {
  const inRange = (t: Tip) => t.probability * 100 >= min - 1e-9 && t.probability * 100 <= max + 1e-9;
  const best: Tip[] = [];
  for (const fixture of fixtures) {
    const pool = tipCandidates(fixture, source).filter((t) => markets.includes(t.market));
    const top = pool.sort((a, b) => b.probability - a.probability)[0];
    if (top && inRange(top)) best.push(top);
  }
  return best;
}

// ===== Teams ===================================================================

export interface TeamRow {
  key: string;
  name: string;
  competitionId: string;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  crest?: string;
  form: FormResult[] | null;
}

export interface LeagueTable { competition: Competition; rows: TeamRow[]; played: number }

/** Sortiername: angezeigter Name ohne Rechtsform am Anfang („1. FC Köln“ unter K, „Werder Bremen“ unter W). */
export const sortName = (name: string) => name.replace(/^(1\. FC |1\. FSV |FC |SC |SSC |AS |AC |VfB |VfL |TSG |RB |CF |CD |CA |SV )/, "");

/**
 * Ligatabellen der gewählten Wettbewerbe, je Liga einmal (jedes Spiel trägt die ganze Tabelle).
 * Die Form ist die der Tabellenzeile (letzte fünf Ligaspiele, ab schemaVersion 9) - nicht
 * `form.home`/`form.away` der Spiele, die nur am Spielort zählt. Wappen kennt der Snapshot nur für
 * Teams mit einem Spiel darin.
 */
export function leagueTables(fixtures: readonly DashboardFixture[], competitions: readonly Competition[]): LeagueTable[] {
  const crests = new Map<string, string>();
  for (const f of fixtures) {
    if (f.homeCrest) crests.set(f.homeTeam, f.homeCrest);
    if (f.awayCrest) crests.set(f.awayTeam, f.awayCrest);
  }
  const tables: LeagueTable[] = [];
  for (const competition of competitions) {
    const withTable = fixtures.find((f) => competitionId(f) === competition.id && f.table?.length);
    if (!withTable?.table) continue;
    const rows = withTable.table.map((r) => ({
      key: `${competition.id}|${r.teamName}`, name: r.teamName, competitionId: competition.id, position: r.position,
      played: r.played, wins: r.wins, draws: r.draws, losses: r.losses, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst,
      points: r.points, crest: crests.get(r.teamName), form: r.form?.length ? r.form : null,
    }));
    tables.push({ competition, rows, played: Math.max(0, ...rows.map((r) => r.played)) });
  }
  return tables;
}

// ===== Saison und Stand ========================================================

/** „Saison 26/27“ aus dem Analysedatum: ab Juli beginnt die neue Saison. */
export function seasonLabel(createdAt: string): string {
  const d = new Date(createdAt), y = d.getUTCFullYear() % 100, start = d.getUTCMonth() >= 6 ? y : y - 1;
  return `Saison ${String(start).padStart(2, "0")}/${String((start + 1) % 100).padStart(2, "0")}`;
}

export const percent = (p: number) => `${Math.round(p * 100)} %`;
export const oddsFormat = (o: number | null) => (o == null ? "–" : o.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const goalsFormat = (g: number) => g.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Alle Tage mit Spielen, aufsteigend. */
export function daysWithGames(document: DashboardDocument): string[] {
  const tz = document.meta.timezone;
  return [...new Set(document.fixtures.map((f) => dayKey(f.kickoff, tz)))].sort();
}
