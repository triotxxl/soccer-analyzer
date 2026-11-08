import { evaluateFixture, QUICKPICK_PRESETS, type QuickpickPresetId } from "../../../src/quickpick.ts";
import { countryFlagCode } from "../../shared/src/countryFlags";
import { competitionCountry, competitionLeague, teamName, type NameSource } from "../../shared/src/names";
import type {
  DashboardDocument, DashboardFixture, DashboardMarket, DashboardMarketKey, FormResult, InsightMatch, TeamElo,
} from "../../shared/src/types";

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

/**
 * Ab wann ein Spiel vorbei ist und aus Neo verschwindet (Davids Wunsch vom 29.10.2026). Der Snapshot kennt
 * keinen Stand nach dem Anpfiff, und Neo fragt nichts live ab - maßgeblich ist deshalb die Uhr. 120 Minuten
 * decken 2 × 45, Pause und Nachspielzeit (die Abrechnung wartet 110, `UNSETTLED_MIN_AGE_MS`); ein Pokalspiel
 * mit Verlängerung verschwindet dabei schon während der Verlängerung.
 */
export const OVER_AFTER_MS = 120 * 60 * 1000;
export const isOver = (fixture: Pick<DashboardFixture, "kickoff">, now: number) =>
  Date.parse(fixture.kickoff) + OVER_AFTER_MS <= now;

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
  /** Chance laut Modell; bei Autoren-Tipps null, wenn das Modell für das Spiel keine belastbare 1X2-Chance hat. */
  probability: number | null;
  odds: number | null;
  /** Nur bei Autoren-Tipps: welcher Filter den Tipp ausgesucht hat. */
  author?: AuthorTipInfo;
}

/** Die Daves-Filter, deren Treffer unter „Autoren“ stehen (Davids Wahl vom 02.11.2026: alle drei, Vorgabe-Stufe). */
export const AUTHOR_FILTERS = ["daves1x2", "dominanz", "remisScore"] as const satisfies readonly QuickpickPresetId[];
export type AuthorFilter = (typeof AUTHOR_FILTERS)[number];

export interface AuthorTipInfo {
  filter: AuthorFilter;
  label: string;
  /** Dominanz: Das Modell tippt die andere Seite. */
  modelAgainst: boolean;
  /** Remis-Score: erreichte Punkte von höchstens möglichen. */
  score: { value: number; max: number } | null;
}

export const authorFilterLabel = (filter: AuthorFilter) => QUICKPICK_PRESETS[filter].label;
export const authorFilterWarning = (filter: AuthorFilter) => QUICKPICK_PRESETS[filter].warnung;

/**
 * Tipps der gewählten Daves-Filter, jeder mit seiner Vorgabe-Stufe - dieselbe Regel (`evaluateFixture`), die
 * Quickpicker und Rückrechnung (`npm run quickpick-report`) benutzen; eine zweite Fassung gibt es nicht. Ein Spiel,
 * das mehrere Filter finden, steht je Filter einmal da. Die Chance ist die des Modells für die gewählte Seite.
 */
export function authorTips(fixtures: readonly DashboardFixture[], filters: readonly AuthorFilter[], source: NameSource): Tip[] {
  const tips: Tip[] = [];
  for (const filter of AUTHOR_FILTERS.filter((f) => filters.includes(f))) {
    const preset = QUICKPICK_PRESETS[filter];
    for (const fixture of fixtures) {
      const evaluation = evaluateFixture(fixture, preset.defaults);
      if (!evaluation.passes) continue;
      const triple = oneXTwo(fixture);
      const draw = evaluation.market === "draw";
      const side = draw ? null : evaluation.side;
      if (!draw && !side) continue;
      tips.push({
        id: `${fixture.fixtureId}:author:${filter}`,
        fixture,
        market: "1x2",
        marketLabel: "Endergebnis",
        pick: draw ? "Unentschieden" : `${teamName(fixture, side === "1" ? "home" : "away", source)} gewinnt`,
        probability: !triple ? null : draw ? triple.draw : side === "1" ? triple.home : triple.away,
        odds: evaluation.odds,
        author: {
          filter, label: preset.label,
          modelAgainst: evaluation.dominanz ? !evaluation.dominanz.modelAgrees : false,
          score: evaluation.remisScore ? { value: evaluation.remisScore.score, max: evaluation.remisScore.max } : null,
        },
      });
    }
  }
  return tips;
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
  const inRange = (t: Tip) => (t.probability ?? 0) * 100 >= min - 1e-9 && (t.probability ?? 0) * 100 <= max + 1e-9;
  const best: Tip[] = [];
  for (const fixture of fixtures) {
    const pool = tipCandidates(fixture, source).filter((t) => markets.includes(t.market));
    const top = pool.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0];
    if (top && inRange(top)) best.push(top);
  }
  return best;
}

export type TipOrder = "chance" | "kickoff";

/** Tipps nach Tagen; innerhalb eines Tages nach Chance (höchste zuerst, ohne Chance zuletzt) oder nach Anstoß. */
export function sortTips(tips: readonly Tip[], order: TipOrder, timezone: string): Tip[] {
  const time = (t: Tip) => Date.parse(t.fixture.kickoff);
  const chance = (t: Tip) => t.probability ?? -1;
  return [...tips].sort((a, b) => dayKey(a.fixture.kickoff, timezone).localeCompare(dayKey(b.fixture.kickoff, timezone))
    || (order === "kickoff" ? time(a) - time(b) || chance(b) - chance(a) : chance(b) - chance(a) || time(a) - time(b)));
}

// ===== Marktchancen (Detailansicht eines Spiels) ===============================

/** „Am ehesten“ im Kopf: je Markt der wahrscheinlichste Tipp, dieselben Kandidaten wie bei den Predictions. */
export function likelyTips(fixture: DashboardFixture, source: NameSource): Tip[] {
  const candidates = tipCandidates(fixture, source);
  return TIP_MARKETS.flatMap(([market]) =>
    candidates.filter((t) => t.market === market).sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0)).slice(0, 1));
}

export const OU_LINES = [0.5, 1.5, 2.5, 3.5, 4.5] as const;
const LINE_MARKETS: Partial<Record<number, [over: DashboardMarketKey, under: DashboardMarketKey]>> = {
  1.5: ["over15", "under15"], 2.5: ["over25", "under25"], 3.5: ["over35", "under35"],
};

/** Anteil der Torzahlen über `line` aus der Verteilung 0 … 5, 6+. */
export const overAt = (dist: readonly number[], line: number) => dist.reduce((sum, p, goals) => (goals > line ? sum + p : sum), 0);

export interface TwoWay { yes: number; no: number; oddsYes: number | null; oddsNo: number | null }

/**
 * Über/Unter einer Linie. 1,5 / 2,5 / 3,5 kommen aus den Märkten (mit Tipico-Quote), 0,5 und 4,5 aus der
 * Torverteilung (`marketDetail`, ab schemaVersion 10, ohne Quote). Beide stehen auf derselben Torerwartung.
 */
export function overUnder(fixture: DashboardFixture, line: number): TwoWay | null {
  const keys = LINE_MARKETS[line];
  const over = keys && marketOf(fixture, keys[0]), under = keys && marketOf(fixture, keys[1]);
  if (over && under) return over.probabilityReliable === false ? null : { yes: over.probability, no: under.probability, oddsYes: over.odds, oddsNo: under.odds };
  const dist = fixture.marketDetail?.totalGoals;
  if (!dist) return null;
  const p = overAt(dist, line);
  return { yes: p, no: 1 - p, oddsYes: null, oddsNo: null };
}

export function bothScore(fixture: DashboardFixture): TwoWay | null {
  const yes = marketOf(fixture, "btts"), no = marketOf(fixture, "bttsNo");
  if (!yes || yes.probabilityReliable === false) return null;
  return { yes: yes.probability, no: no?.probability ?? 1 - yes.probability, oddsYes: yes.odds, oddsNo: no?.odds ?? null };
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
  /** Elo aus einem Spiel des Snapshots (ab schemaVersion 12 mit Liga), null ohne Spiel im Zeitraum. */
  elo: TeamElo | null;
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
  const elos = eloByTeamName(fixtures);
  const tables: LeagueTable[] = [];
  for (const competition of competitions) {
    const withTable = fixtures.find((f) => competitionId(f) === competition.id && f.table?.length);
    if (!withTable?.table) continue;
    const rows = withTable.table.map((r) => ({
      key: `${competition.id}|${r.teamName}`, name: r.teamName, competitionId: competition.id, position: r.position,
      played: r.played, wins: r.wins, draws: r.draws, losses: r.losses, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst,
      points: r.points, crest: crests.get(r.teamName), form: r.form?.length ? r.form : null,
      elo: r.elo ?? elos.get(r.teamName) ?? null,
    }));
    tables.push({ competition, rows, played: Math.max(0, ...rows.map((r) => r.played)) });
  }
  return tables;
}

// ===== H2H (direkte Duelle) =====================================================

/** Seit 03.11.2026 in apps/shared/src/duels.ts, weil auch die Live-Ansicht der alten App die Duelle zeigt. */
export { duelsOf, duelStats, H2H_FEW, type Duel, type DuelStats } from "../../shared/src/duels";

/** Seit 02.11.2026 in apps/shared/src/perf.ts, weil auch die alte App den Tabellenverlauf zeigt. */
export { tableEntryOf } from "../../shared/src/perf";

/** Die Viertelstunde eines Tors (wie `scoringPeriodIndex` in src/fixture-insights.ts). */
export const periodOf = (minute: number) => Math.min(Math.max(Math.ceil(Math.max(minute, 1) / 15), 1), 6) - 1;
export const PERIOD_LABELS = ["0'", "15'", "30'", "45'", "60'", "75'", "90'"];

export interface PhaseCounts { games: number; scored: number[]; conceded: number[] }

/** Tore je Viertelstunde aus Spielen mit vollständigen Torminuten; Spiele mit Lücken bleiben draußen. */
export function phaseCounts(matches: readonly InsightMatch[], teamId: number): PhaseCounts {
  const scored = [0, 0, 0, 0, 0, 0], conceded = [0, 0, 0, 0, 0, 0];
  const complete = matches.filter((m) => m.minutesComplete);
  for (const m of complete) for (const g of m.goals) (g.teamId === teamId ? scored : conceded)[periodOf(g.minute)]! += 1;
  return { games: complete.length, scored, conceded };
}

export { seasonMatches } from "../../shared/src/seasonView";

/** Formpunkte: Sieg 3, Remis 1. */
export const formPoints = (list: readonly FormResult[]) => list.reduce((s, r) => s + (r === "win" ? 3 : r === "draw" ? 1 : 0), 0);

// ===== Saison und Stand ========================================================

/** „Saison 26/27“ aus dem Analysedatum: ab Juli beginnt die neue Saison. */
export function seasonLabel(createdAt: string): string {
  const d = new Date(createdAt), y = d.getUTCFullYear() % 100, start = d.getUTCMonth() >= 6 ? y : y - 1;
  return `Saison ${String(start).padStart(2, "0")}/${String((start + 1) % 100).padStart(2, "0")}`;
}

export const percent = (p: number) => (p < 0.005 ? "< 1 %" : `${Math.round(p * 100)} %`);
export const oddsFormat = (o: number | null) => (o == null ? "–" : o.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const goalsFormat = (g: number) => g.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Alle Tage mit Spielen, aufsteigend. */
export function daysWithGames(document: DashboardDocument): string[] {
  const tz = document.meta.timezone;
  return [...new Set(document.fixtures.map((f) => dayKey(f.kickoff, tz)))].sort();
}

// ===== Elo (Spielstärke) =========================================================

/**
 * Elo-Abstand zweier Teams derselben Skala, ab dem eine Seite „etwas“ bzw. „klar“ stärker heißt. Ohne
 * Heimvorteil gerechnet. 50 Punkte sind gut eine halbe Stufe auf der Elo-Erwartung (rund 57 zu 43), 150 rund
 * 70 zu 30. Nur Anzeige: Die Chancen kommen aus dem Modell, nie aus diesem Abstand (Davids Auftrag 28.10.2026).
 */
export const ELO_TEAM_STEPS = { slight: 50, clear: 150 } as const;
/**
 * Abstand der Liga-Niveaus (mittleres Elo der Vereine einer Liga). 75 ist ein Torfaktor von rund 1,15;
 * 211 und 411 sind beim Teiler 1200 genau die Faktoren 1,5 und 2,2 der Markierung „Klasse“ (`classGap`).
 */
export const ELO_LEAGUE_STEPS = { slight: 75, clear: 211, extreme: 411 } as const;
/** Unter so viel Vertrauen steht ein Elo-Wert auf wenig Grundlage (wie `npm run coverage`). */
export const ELO_THIN = 30;

export interface StrengthSide {
  elo: TeamElo | null;
  name: string;
}

export interface StrengthView {
  home: StrengthSide;
  away: StrengthSide;
  /** Beide Werte auf derselben Skala - sonst gibt es keinen Vergleich (Verein gegen Nationalteam, U21 gegen A). */
  comparable: boolean;
  /** Die deutlich stärkere Seite (ab `ELO_TEAM_STEPS.slight`), sonst null. */
  stronger: "home" | "away" | null;
  /** Urteil in Worten, null ohne Vergleich. */
  verdict: string | null;
  /** Nur bei Spielen zwischen verschiedenen Ligen mit Liga-Niveau auf beiden Seiten. */
  league: {
    home: { name: string; level: number };
    away: { name: string; level: number };
    stronger: "home" | "away" | null;
    /** Klassenunterschied ab `ELO_LEAGUE_STEPS.clear` bzw. `extreme` - dieselben Stufen wie „Klasse“. */
    gap: "clear" | "extreme" | null;
    verdict: string;
  } | null;
}

export const eloFormat = (elo: number) => String(Math.round(elo));
export const eloThin = (elo: TeamElo) => elo.confidence < ELO_THIN;

/** Elo beider Teams eines Spiels und was ihr Abstand heißt (Spielzeile und Detailansicht). */
export function strengthOf(fixture: DashboardFixture, source: NameSource = "api"): StrengthView {
  const homeName = teamName(fixture, "home", source), awayName = teamName(fixture, "away", source);
  const home = fixture.homeElo ?? null, away = fixture.awayElo ?? null;
  const comparable = home !== null && away !== null && home.system === away.system;
  let stronger: StrengthView["stronger"] = null, verdict: string | null = null;
  if (comparable) {
    const diff = home.elo - away.elo, size = Math.abs(diff), name = diff > 0 ? homeName : awayName;
    if (size >= ELO_TEAM_STEPS.slight) stronger = diff > 0 ? "home" : "away";
    verdict = size < ELO_TEAM_STEPS.slight ? "etwa gleich stark"
      : size < ELO_TEAM_STEPS.clear ? `${name} etwas stärker` : `${name} klar stärker`;
  }
  let league: StrengthView["league"] = null;
  const hl = home?.leagueLevel, al = away?.leagueLevel;
  if (fixture.crossLeague && comparable && home.system === "club" && hl != null && al != null && home.league && away.league
    && home.league !== away.league) {
    const diff = hl - al, size = Math.abs(diff), name = diff > 0 ? homeName : awayName;
    league = {
      home: { name: home.league, level: hl }, away: { name: away.league, level: al },
      stronger: size >= ELO_LEAGUE_STEPS.slight ? (diff > 0 ? "home" : "away") : null,
      gap: size >= ELO_LEAGUE_STEPS.extreme ? "extreme" : size >= ELO_LEAGUE_STEPS.clear ? "clear" : null,
      verdict: size < ELO_LEAGUE_STEPS.slight ? "Ligen etwa gleich stark"
        : size < ELO_LEAGUE_STEPS.clear ? `Liga von ${name} etwas stärker`
          : size < ELO_LEAGUE_STEPS.extreme ? `Klassenunterschied zugunsten von ${name}`
            : `deutlicher Klassenunterschied zugunsten von ${name}`,
    };
  }
  return { home: { elo: home, name: homeName }, away: { elo: away, name: awayName }, comparable, stronger, verdict, league };
}

/**
 * Das Schild „Klasse“ einer Spielzeile. Gibt es auf beiden Seiten ein Liga-Niveau, entscheidet es - so sagen
 * Liste und Detailansicht dasselbe. Sonst gilt die Markierung der Analyse (`classGap`: Ligastärke, Team-Elo
 * oder Tipico-Quoten).
 */
export function classBadge(fixture: DashboardFixture, strength: StrengthView):
  { level: "clear" | "extreme"; stronger: "home" | "away"; basis: string } | null {
  if (strength.league) {
    const { gap, stronger } = strength.league;
    return gap && stronger ? { level: gap, stronger, basis: "laut Liga-Niveau (Elo)" } : null;
  }
  const g = fixture.classGap;
  if (!g) return null;
  return { level: g.level, stronger: g.stronger, basis: g.source === "market" ? "laut Tipico-Quoten" : g.source === "elo" ? "laut Elo" : "laut Ligastärke" };
}

/** Elo je Teamname aus den Spielen des Snapshots - für die Tabellen unter „Teams“. */
export function eloByTeamName(fixtures: readonly DashboardFixture[]): Map<string, TeamElo> {
  const byName = new Map<string, TeamElo>();
  for (const f of fixtures) {
    if (f.homeElo) byName.set(f.homeTeam, f.homeElo);
    if (f.awayElo) byName.set(f.awayTeam, f.awayElo);
  }
  return byName;
}
