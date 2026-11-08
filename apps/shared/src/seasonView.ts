import { useState } from "react";
import type { TableEntry } from "./perf";
import type { InsightMatch } from "./types";

/**
 * Saisonwahl für Tabellen- und Tordifferenz-Verlauf, in beiden Apps gleich (seit 04.11.2026, Davids Vorgabe, gilt
 * auch für Turniere): Gezeigt wird immer die laufende Saison oder Ausgabe. Die letzte muss bewusst gewählt werden und
 * ersetzt dann die Ansicht, statt sich mit ihr zu mischen. Die Wahl gilt nur für das geöffnete Spiel und wird nicht
 * gemerkt. Die Torphasen zeigen nur die laufende Saison (`seasonMatches`, Davids Entscheidung vom selben Tag).
 */
export function useSeasonChoice(fixtureId: number): [boolean, (previous: boolean) => void] {
  const [chosenFor, setChosenFor] = useState<number | null>(null);
  return [chosenFor === fixtureId, (previous) => setChosenFor(previous ? fixtureId : null)];
}

/** Die Werte eines Verlaufs für die gewählte Saison; `undefined`, wenn das Team dort keine hat. */
export function seasonList(entry: { row: TableEntry } | null | undefined, kind: "positions" | "goalDiffs", previous: boolean):
  Array<number | null> | undefined {
  const row = entry?.row;
  const list = kind === "positions" ? (previous ? row?.previousPositions : row?.positions)
    : (previous ? row?.previousGoalDiffs : row?.goalDiffs);
  return list?.length ? list : undefined;
}

/** Text, wenn eine Liga keine Torminuten führt - in beiden Apps gleich. */
export const NO_GOAL_MINUTES = "Für diese Liga gibt es keine Torminuten. Der Datenanbieter führt hier nur die Endstände.";

export interface MinuteCover {
  /** Spiele, die die Heatmap zählen könnte. */
  total: number;
  /** Davon mit vollständigen Torminuten. */
  counted: number;
  /** Kein Spiel mit Toren trägt Torminuten: Die Heatmap hätte nichts zu zeigen. */
  none: boolean;
}

/**
 * Wie viel die Torphasen tragen (seit 06.11.2026, Davids Wunsch). `minutesComplete` gilt auch für ein 0:0 ohne
 * Ereignisliste, weil dort kein Tor fehlt. In einer Liga ohne Torminuten (Sambia, bei beiden Teams 0 von 3 Spielen
 * mit Toren) stand so die Heatmap mit lauter Nullen und „1 Partie“ da, als hätten die Teams nie getroffen.
 * `season` ist die ganze Saison des Teams, `shown` die gezeigten Spiele: Heim- oder Auswärtsspiele allein könnten
 * nur aus einem 0:0 bestehen und verrieten die Lücke nicht.
 */
export function minuteCover(season: readonly InsightMatch[], shown: readonly InsightMatch[]): MinuteCover {
  const withGoals = season.filter((m) => m.homeGoals + m.awayGoals > 0);
  return {
    total: shown.length,
    counted: shown.filter((m) => m.minutesComplete).length,
    none: withGoals.length > 0 && !withGoals.some((m) => m.minutesComplete)
  };
}

/** Warum einem Team die letzte Saison fehlt: In der Liga ist es meist ein Aufsteiger, im Turnier war es nicht dabei. */
export function noLastSeasonText(names: readonly string[], crossLeague: boolean): string {
  return `${names.join(" und ")}: ${crossLeague ? "in der letzten Saison nicht dabei." : "letzte Saison nicht in dieser Liga, zum Beispiel Aufsteiger."}`;
}

/**
 * Die Spiele der laufenden Saison eines Teams für die Torphasen: die des Wettbewerbs dieses Spiels, im Turnier
 * also die Turnierspiele. Hat das Team dort noch keins, die häufigste Liga seiner jüngsten Saison - nie Spiele
 * aus zwei Saisons. Erst die jüngste Saison, darin der häufigste Wettbewerb: Früh in der Saison stehen unter den
 * letzten Spielen mehr aus der Vorsaison, das häufigste Paar insgesamt wäre dann die Vorsaison.
 */
export function seasonMatches(matches: readonly InsightMatch[], teamId: number, venue: "home" | "away" | null,
  league?: { id: number; season: number }): InsightMatch[] {
  const own = league ? matches.filter((m) => m.leagueId === league.id && m.season === league.season) : [];
  const latest = Math.max(...matches.map((m) => m.season));
  const count = new Map<number, number>();
  for (const m of matches) if (m.season === latest) count.set(m.leagueId, (count.get(m.leagueId) ?? 0) + 1);
  const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const list = own.length > 0 ? own : matches.filter((m) => m.season === latest && m.leagueId === main);
  return list.filter((m) => venue === null || (venue === "home" ? m.home.id === teamId : m.away.id === teamId));
}
