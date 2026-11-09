import type { DashboardFixture } from "./types";

/**
 * Wer die Quoten eines Spiels stellt, für sichtbare Texte („Quoten: Betano“). Seit 09.11.2026 kommen
 * Spiele und Quoten aus `/odds` von API-Football, und jedes Spiel trägt seinen Anbieter
 * (`fixture.bookmaker`, schemaVersion 15). Ältere Snapshots stammen aus der Tipico-data.json.
 */
export function quoteSourceName(fixture: Pick<DashboardFixture, "bookmaker"> | null | undefined): string {
  return fixture?.bookmaker ?? "Tipico";
}
