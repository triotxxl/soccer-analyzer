import type { DashboardFixture } from "./types";

/**
 * Ein Spiel ohne Quote: Es steht in der Angebotsliste von Betano oder Tipico (`offeredBy`), aber
 * API-Football führt dafür keine Quote (seit 10.11.2026 trotzdem analysiert, Davids Wunsch). Ein
 * fehlender Anbieter ohne `offeredBy` heißt dagegen: Snapshot aus der Tipico-data.json.
 */
export const withoutQuotes = (fixture: Pick<DashboardFixture, "bookmaker" | "offeredBy"> | null | undefined): boolean =>
  !!fixture?.offeredBy && !fixture.bookmaker;

/**
 * Wer die Quoten eines Spiels stellt, für sichtbare Texte („Quoten: Betano“). Seit 09.11.2026 kommen
 * Spiele und Quoten aus `/odds` von API-Football, und jedes Spiel trägt seinen Anbieter
 * (`fixture.bookmaker`, schemaVersion 15). Ältere Snapshots stammen aus der Tipico-data.json. Bei einem
 * Spiel ohne Quote steht „API-Football“ da („API-Football führt hierfür keine Quote“).
 */
export function quoteSourceName(fixture: Pick<DashboardFixture, "bookmaker" | "offeredBy"> | null | undefined): string {
  if (withoutQuotes(fixture)) return "API-Football";
  return fixture?.bookmaker ?? "Tipico";
}
