import { useEffect, useState } from "react";
import type { FixtureInsights, InsightMatch, InsightTeamStats } from "./types";

export const SCORING_PERIOD_LABELS = ["0'", "15'", "30'", "45'", "60'", "75'", "90'"];
export const H2H_COUNT_OPTIONS = [3, 5, 6, 10] as const;
export const TREND_MATCH_COUNT = 10;
export const MATCH_STAT_COUNT_OPTIONS = [1, 2, 3, 4, 5] as const;

const MESSAGES: Record<string, string> = {
  dashboard_missing: "Noch keine Analyse vorhanden. Starte zuerst einen Dashboard-Lauf im Chat.",
  fixture_unknown: "Diese Partie steht nicht im letzten Dashboard-Lauf.",
  api_key_missing: "API_FOOTBALL_KEY fehlt. Trage den Schlüssel in .env ein und starte die App neu.",
  api_unavailable: "API-Football ist gerade nicht erreichbar."
};

export type InsightsLoadState =
  | { status: "idle" | "loading"; insights: null; message: null }
  | { status: "ready"; insights: FixtureInsights; message: null }
  | { status: "error"; insights: null; message: string };

function isFixtureInsights(value: unknown): value is FixtureInsights {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FixtureInsights>;
  return typeof candidate.fixtureId === "number"
    && !!candidate.league
    && !!candidate.home
    && !!candidate.away
    && Array.isArray(candidate.homeMatches)
    && Array.isArray(candidate.awayMatches)
    && Array.isArray(candidate.h2h);
}

export async function fetchInsights(fixtureId: number, signal?: AbortSignal): Promise<FixtureInsights> {
  const response = await fetch(`/api/fixture/insights?fixture=${fixtureId}`, { cache: "no-store", signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as { error?: string; message?: string } | null;
    throw new Error(MESSAGES[error?.error ?? ""] ?? error?.message ?? "Die Detailkennzahlen sind nicht verfügbar.");
  }
  if (!isFixtureInsights(body)) throw new Error("Die Detailkennzahlen kamen unlesbar zurück.");
  return body;
}

/**
 * Lädt die Detailkennzahlen genau einer Partie und nur, solange sie aufgeklappt ist.
 * Ohne aufgeklappte Partie entsteht kein Aufruf; der Dienst hält den Stand danach vor.
 */
export function useFixtureInsights(fixtureId: number | null): InsightsLoadState {
  // Der Stand traegt die Partie, zu der er gehoert. Ohne diese Zuordnung zeigt der erste
  // Render nach dem Aufklappen noch den Stand der zuvor geoeffneten Partie, weil der
  // Effekt erst danach laeuft - sichtbar als kurzes Aufblitzen alter Kennzahlen.
  const [state, setState] = useState<{ loaded: number | null; value: InsightsLoadState }>({
    loaded: null,
    value: { status: "idle", insights: null, message: null }
  });
  useEffect(() => {
    if (fixtureId === null) {
      setState({ loaded: null, value: { status: "idle", insights: null, message: null } });
      return;
    }
    const controller = new AbortController();
    setState({ loaded: fixtureId, value: { status: "loading", insights: null, message: null } });
    fetchInsights(fixtureId, controller.signal)
      .then((insights) => {
        if (controller.signal.aborted) return;
        setState({ loaded: fixtureId, value: { status: "ready", insights, message: null } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error as DOMException).name === "AbortError") return;
        setState({ loaded: fixtureId, value: { status: "error", insights: null, message: (error as Error).message } });
      });
    return () => controller.abort();
  }, [fixtureId]);
  if (fixtureId === null) return { status: "idle", insights: null, message: null };
  if (state.loaded !== fixtureId) return { status: "loading", insights: null, message: null };
  return state.value;
}

export interface LeagueScope {
  id: number;
  /**
   * Ohne Saison zählt allein die Liga. Für Torphasen und Trends gehört sie dazu - dort geht
   * es um die laufende Spielzeit. Direkte Duelle laufen dagegen über mehrere Spielzeiten:
   * Mit Saison bliebe dort höchstens das Rückspiel übrig, vor der Winterpause gar nichts.
   */
  season?: number;
}

export function inLeague(match: InsightMatch, scope: LeagueScope | null): boolean {
  if (scope === null) return true;
  if (match.leagueId !== scope.id) return false;
  return scope.season === undefined || match.season === scope.season;
}

export function venueOf(match: InsightMatch, teamId: number): "home" | "away" {
  return match.home.id === teamId ? "home" : "away";
}

export function goalsOf(match: InsightMatch, teamId: number): { scored: number; conceded: number } {
  return venueOf(match, teamId) === "home"
    ? { scored: match.homeGoals, conceded: match.awayGoals }
    : { scored: match.awayGoals, conceded: match.homeGoals };
}

export function outcomeOf(match: InsightMatch, teamId: number): "win" | "draw" | "loss" {
  const { scored, conceded } = goalsOf(match, teamId);
  return scored > conceded ? "win" : scored === conceded ? "draw" : "loss";
}

export interface ScoringPeriods {
  scored: number[];
  conceded: number[];
  scoredTotal: number;
  concededTotal: number;
  /** Partien, die mit lückenloser Ereignisliste in die Verteilung eingehen. */
  matches: number;
}

/**
 * Tore und Gegentore je Viertelstunde. Es zählen nur Partien mit lückenloser
 * Ereignisliste - eine unvollständige würde die Verteilung nach unten verzerren, ohne
 * dass man es der Zeile ansieht.
 */
export function scoringPeriods(
  matches: InsightMatch[],
  teamId: number,
  options: { venue?: "home" | "away"; scope?: LeagueScope | null } = {}
): ScoringPeriods {
  const scored = Array.from({ length: 6 }, () => 0);
  const conceded = Array.from({ length: 6 }, () => 0);
  let used = 0;
  for (const match of matches) {
    if (!match.minutesComplete) continue;
    if (!inLeague(match, options.scope ?? null)) continue;
    if (options.venue && venueOf(match, teamId) !== options.venue) continue;
    used += 1;
    for (const goal of match.goals) {
      const period = Math.min(Math.max(Math.ceil(Math.max(goal.minute, 1) / 15), 1), 6) - 1;
      (goal.teamId === teamId ? scored : conceded)[period] += 1;
    }
  }
  return {
    scored,
    conceded,
    scoredTotal: scored.reduce((sum, value) => sum + value, 0),
    concededTotal: conceded.reduce((sum, value) => sum + value, 0),
    matches: used
  };
}

export interface RecordSummary {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export function summarize(matches: InsightMatch[], teamId: number): RecordSummary {
  const summary: RecordSummary = { matches: matches.length, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  for (const match of matches) {
    const { scored, conceded } = goalsOf(match, teamId);
    summary.goalsFor += scored;
    summary.goalsAgainst += conceded;
    const outcome = outcomeOf(match, teamId);
    if (outcome === "win") summary.wins += 1;
    else if (outcome === "draw") summary.draws += 1;
    else summary.losses += 1;
  }
  return summary;
}

/**
 * Die numerischen Kennzahlen einer Mannschaft, abgeleitet statt aufgezählt: Ein neues Feld
 * in `InsightTeamStats` ist damit sofort über `averageStat` nutzbar.
 */
export type InsightStatKey = {
  [Key in keyof InsightTeamStats]-?: NonNullable<InsightTeamStats[Key]> extends number ? Key : never
}[keyof InsightTeamStats];

/** Mittelwert über die Partien, die den Wert überhaupt führen. `null`, wenn keine ihn führt. */
export function averageStat(
  matches: InsightMatch[],
  teamId: number,
  key: InsightStatKey
): { value: number | null; matches: number } {
  const values = matches
    .map((match) => match.stats[venueOf(match, teamId)]?.[key])
    .filter((value): value is number => typeof value === "number");
  return {
    value: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    matches: values.length
  };
}

export interface TrendSummary extends RecordSummary {
  possession: { value: number | null; matches: number };
  shots: { value: number | null; matches: number };
}

export function trends(
  matches: InsightMatch[],
  teamId: number,
  options: { scope?: LeagueScope | null; limit?: number } = {}
): TrendSummary {
  const selected = matches
    .filter((match) => inLeague(match, options.scope ?? null))
    .slice(0, options.limit ?? TREND_MATCH_COUNT);
  return {
    ...summarize(selected, teamId),
    possession: averageStat(selected, teamId, "possession"),
    shots: averageStat(selected, teamId, "shots")
  };
}

/** Offensive und defensive Kennzahlen stehen im Panel in getrennten Blöcken. */
export type StatGroup = "off" | "def";

/**
 * Welche Richtung als überlegen gilt. `null` bei Kennzahlen, bei denen weder hoch noch
 * niedrig eindeutig besser ist - dort bleibt die Zeile ohne Bewertung.
 */
export type StatBetter = "higher" | "lower" | null;

export interface MatchStatRow {
  key: string;
  label: string;
  /** 100 bei Prozentkennzahlen; sie stehen als Ring über der Liste statt als Spur. */
  scale: number | null;
  digits: number;
  unit?: string;
  group: StatGroup;
  better: StatBetter;
  home: number | null;
  away: number | null;
  /** Partien, die den Wert führen - Heim und Auswärts getrennt. */
  homeMatches: number;
  awayMatches: number;
}

interface MatchStatDefinition {
  key: InsightStatKey;
  label: string;
  scale: number | null;
  digits: number;
  unit?: string;
  group: StatGroup;
  better: StatBetter;
}

/**
 * Beschriftung wie im Live-Board, damit dieselbe Kennzahl gleich heißt. Die Reihenfolge ist
 * zugleich die Anzeigereihenfolge innerhalb der beiden Blöcke - das Panel filtert nur auf
 * `group` und behält die Folge bei.
 */
const MATCH_STAT_DEFINITIONS: MatchStatDefinition[] = [
  { key: "possession", label: "Ballbesitz", scale: 100, digits: 0, unit: "%", group: "off", better: null },
  { key: "shots", label: "Schüsse insgesamt", scale: null, digits: 1, group: "off", better: "higher" },
  { key: "shotsOnGoal", label: "Schüsse aufs Tor", scale: null, digits: 1, group: "off", better: "higher" },
  { key: "shotsOffGoal", label: "Schüsse daneben", scale: null, digits: 1, group: "off", better: "lower" },
  { key: "shotsInsideBox", label: "Schüsse im Strafraum", scale: null, digits: 1, group: "off", better: "higher" },
  { key: "shotsOutsideBox", label: "Schüsse außerhalb", scale: null, digits: 1, group: "off", better: null },
  { key: "corners", label: "Ecken", scale: null, digits: 1, group: "off", better: "higher" },
  { key: "offsides", label: "Abseits", scale: null, digits: 1, group: "off", better: "lower" },
  { key: "totalPasses", label: "Pässe", scale: null, digits: 0, group: "off", better: "higher" },
  { key: "passesAccurate", label: "Erfolgreiche Pässe", scale: null, digits: 0, group: "off", better: "higher" },
  { key: "blockedShots", label: "Geblockte Schüsse", scale: null, digits: 1, group: "def", better: "higher" },
  { key: "goalkeeperSaves", label: "Torwartparaden", scale: null, digits: 1, group: "def", better: null },
  { key: "fouls", label: "Fouls", scale: null, digits: 1, group: "def", better: "lower" },
  { key: "yellowCards", label: "Gelbe Karten", scale: null, digits: 1, group: "def", better: "lower" },
  { key: "redCards", label: "Rote Karten", scale: null, digits: 2, group: "def", better: "lower" }
];

/**
 * Passquote aus den beiden Rohwerten statt aus der API-Zeile "Passes %": deren Typ
 * normalisiert zu `passes` und liegt damit zu nah an `totalpasses`.
 *
 * Gerechnet wird über die Summen der Partien, die **beide** Werte führen. Eine Partie mit
 * nur einem der beiden Werte würde sonst entweder als 0 einfließen oder Zähler und Nenner
 * über verschiedene Partienmengen bilden.
 */
function passAccuracy(
  matches: InsightMatch[],
  teamId: number
): { value: number | null; matches: number } {
  let accurate = 0;
  let total = 0;
  let used = 0;
  for (const match of matches) {
    const stats = match.stats[venueOf(match, teamId)];
    if (typeof stats?.passesAccurate !== "number" || typeof stats.totalPasses !== "number") continue;
    if (stats.totalPasses <= 0) continue;
    accurate += stats.passesAccurate;
    total += stats.totalPasses;
    used += 1;
  }
  return { value: total === 0 ? null : (accurate / total) * 100, matches: used };
}

/**
 * Die Durchschnittswerte beider Teams als Zeilen für die Gegenüberstellung.
 *
 * `h2h` legt **beiden** Seiten dieselbe Partienmenge zugrunde; welche Seite ein Team darin
 * hatte, entscheidet `venueOf` in `averageStat`. Nur deshalb summiert sich der Ballbesitz
 * in diesem Modus auf 100 %. Bei `recent` stammen die Werte aus verschiedenen Partien gegen
 * verschiedene Gegner - die Summe ist dann nicht 100 und wird bewusst nicht normiert.
 *
 * venueOnly stellt Heimform gegen Auswärtsform: das Heimteam nur zuhause, das Auswärtsteam
 * nur auswärts. Im Duellmodus bleibt damit genau ein Filter übrig - die Duelle im Stadion des
 * Heimteams -, und weil beide Seiten weiter dieselbe Partienmenge mitteln, bleibt auch die
 * Aufteilung des Ballbesitzes vollständig.
 */
export function matchStats(
  insights: FixtureInsights,
  options: { source: "recent" | "h2h"; limit: number; scope?: LeagueScope | null; venueOnly?: boolean }
): MatchStatRow[] {
  const scope = options.scope ?? null;
  // Der Ortsfilter greift vor der Begrenzung: Sonst wären es die Heimspiele unter den letzten
  // N Partien statt der letzten N Heimspiele - bei limit 5 oft nur zwei oder drei.
  const select = (matches: InsightMatch[], teamId: number, venue: "home" | "away") => matches
    .filter((match) => inLeague(match, scope))
    .filter((match) => !options.venueOnly || venueOf(match, teamId) === venue)
    .slice(0, options.limit);
  const duels = select(insights.h2h, insights.home.id, "home");
  const homeMatches = options.source === "h2h" ? duels : select(insights.homeMatches, insights.home.id, "home");
  const awayMatches = options.source === "h2h" ? duels : select(insights.awayMatches, insights.away.id, "away");

  const rows: MatchStatRow[] = MATCH_STAT_DEFINITIONS.map((definition) => {
    const home = averageStat(homeMatches, insights.home.id, definition.key);
    const away = averageStat(awayMatches, insights.away.id, definition.key);
    return {
      key: definition.key,
      label: definition.label,
      scale: definition.scale,
      digits: definition.digits,
      ...(definition.unit === undefined ? {} : { unit: definition.unit }),
      group: definition.group,
      better: definition.better,
      home: home.value,
      away: away.value,
      homeMatches: home.matches,
      awayMatches: away.matches
    };
  });

  const homeAccuracy = passAccuracy(homeMatches, insights.home.id);
  const awayAccuracy = passAccuracy(awayMatches, insights.away.id);
  rows.push({
    key: "passAccuracy",
    label: "Passquote",
    scale: 100,
    digits: 1,
    unit: "%",
    group: "off",
    better: null,
    home: homeAccuracy.value,
    away: awayAccuracy.value,
    homeMatches: homeAccuracy.matches,
    awayMatches: awayAccuracy.matches
  });
  return rows;
}

/**
 * Vergleichsschnitt je Kennzahl, gebildet aus dem bereits geladenen Bestand: Mittelwert über
 * **beide** Seiten aller Partien beider Teams und aller direkten Duelle, also einschließlich
 * der Gegner. Fehlende Werte bleiben außen vor und zählen nie als 0.
 *
 * Das ist kein Ligaschnitt, sondern der Schnitt des betrachteten Umfelds - die Ansicht
 * beschriftet ihn deshalb als "Ø Vergleich". Liefert das Backend später echte
 * Ligadurchschnitte, tauscht nur diese Funktion ihre Quelle; die Ansicht bleibt gleich.
 */
export function statBaselines(insights: FixtureInsights): Record<string, number | null> {
  // Ein Ligaduell der beiden Teams steht in allen drei Listen. Ohne Deduplizierung ginge es
  // dreifach ein und zöge den Schnitt ausgerechnet zu den Mannschaften, gegen die er misst.
  // Dieselbe Vereinigung dedupliziert `coverageOf` im Backend genauso.
  const sides = [...new Map([...insights.homeMatches, ...insights.awayMatches, ...insights.h2h]
    .map((match) => [match.fixtureId, match])).values()]
    .flatMap((match) => [match.stats.home, match.stats.away]);
  const baselines: Record<string, number | null> = {};
  for (const definition of MATCH_STAT_DEFINITIONS) {
    const values = sides
      .map((side) => side?.[definition.key])
      .filter((value): value is number => typeof value === "number");
    baselines[definition.key] = values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  // Die Passquote ist auch hier die Quote der Summen, nicht der Mittelwert der Einzelquoten.
  let accurate = 0;
  let total = 0;
  for (const side of sides) {
    if (typeof side?.passesAccurate !== "number" || typeof side.totalPasses !== "number") continue;
    if (side.totalPasses <= 0) continue;
    accurate += side.passesAccurate;
    total += side.totalPasses;
  }
  baselines.passAccuracy = total === 0 ? null : (accurate / total) * 100;
  return baselines;
}

export interface H2hSelection {
  matches: InsightMatch[];
  summary: RecordSummary;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
}

/**
 * Die direkten Duelle aus Sicht des Heimteams der analysierten Partie. `homeOnly` behält
 * nur Duelle, in denen dieses Team auch damals zu Hause war - der Filter aus dem Screenshot.
 */
export function selectH2h(
  matches: InsightMatch[],
  homeTeamId: number,
  options: { homeOnly?: boolean; scope?: LeagueScope | null; limit?: number } = {}
): H2hSelection {
  const selected = matches
    .filter((match) => inLeague(match, options.scope ?? null))
    .filter((match) => !options.homeOnly || venueOf(match, homeTeamId) === "home")
    .slice(0, options.limit ?? matches.length);
  const summary = summarize(selected, homeTeamId);
  return {
    matches: selected,
    summary,
    goalsForPerGame: summary.matches === 0 ? 0 : summary.goalsFor / summary.matches,
    goalsAgainstPerGame: summary.matches === 0 ? 0 : summary.goalsAgainst / summary.matches
  };
}
