import { useEffect, useState } from "react";
import type { FixtureInsights, InsightMatch } from "./types";

export const SCORING_PERIOD_LABELS = ["0'", "15'", "30'", "45'", "60'", "75'", "90'"];
export const H2H_COUNT_OPTIONS = [3, 5, 6, 10] as const;
export const TREND_MATCH_COUNT = 10;

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
  season: number;
}

export function inLeague(match: InsightMatch, scope: LeagueScope | null): boolean {
  return scope === null || (match.leagueId === scope.id && match.season === scope.season);
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

/** Mittelwert über die Partien, die den Wert überhaupt führen. `null`, wenn keine ihn führt. */
export function averageStat(
  matches: InsightMatch[],
  teamId: number,
  key: "possession" | "shots" | "shotsOnGoal"
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
    .filter((match) => !options.homeOnly || match.home.id === homeTeamId)
    .slice(0, options.limit ?? matches.length);
  const summary = summarize(selected, homeTeamId);
  return {
    matches: selected,
    summary,
    goalsForPerGame: summary.matches === 0 ? 0 : summary.goalsFor / summary.matches,
    goalsAgainstPerGame: summary.matches === 0 ? 0 : summary.goalsAgainst / summary.matches
  };
}
