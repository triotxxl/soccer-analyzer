import { createContext, useContext } from "react";
import type { DashboardFixture, DashboardMarket } from "./types";

/**
 * Welche Namen die App zeigt (Einstellungen, seit 11.10.2026, Davids Wunsch): ab Werk die von
 * Tipico, weil David die Tipps dort per Hand wiederfindet, umschaltbar auf API-Football.
 *
 * **Nur Anzeige.** Die API-Felder des Snapshots (`homeTeam`, `awayTeam`, `country`, `league`)
 * werden nie überschrieben: an ihnen hängen Vergleiche (H2H-Richtung, Tabellenzeile),
 * `leagueKey` und die gemerkte Wettbewerbe-Abwahl, die Flaggen, die Gleichheit zweier Tipps im
 * Wettschein (`selection`) und der Kelly-Export. Fehlt der Tipico-Name (Snapshot vor
 * schemaVersion 8, Spiel ohne Tipico-Ereignis), steht der von API-Football da.
 */
export type NameSource = "tipico" | "api";

const STORAGE_KEY = "football-analyzer:name-source";

export function loadNameSource(): NameSource {
  if (typeof window === "undefined") return "tipico";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "api" ? "api" : "tipico";
  } catch {
    return "tipico";
  }
}

export function saveNameSource(source: NameSource): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // Storage unavailable - preference just stays in-memory for this session.
  }
}

/** Ab Werk Tipico; `App` setzt den gewählten Wert. */
export const NamesContext = createContext<NameSource>("tipico");

export function useNames(): NameSource {
  return useContext(NamesContext);
}

/** Was ein Name braucht - ein Spiel des Snapshots, ein Wettschein-Eintrag, eine Kelly-Wette. */
export type Named = Pick<DashboardFixture, "homeTeam" | "awayTeam" | "country" | "league" | "tipico">;

export function teamName(item: Pick<Named, "homeTeam" | "awayTeam" | "tipico">, side: "home" | "away", source: NameSource): string {
  if (source === "tipico" && item.tipico) return side === "home" ? item.tipico.homeTeam : item.tipico.awayTeam;
  return side === "home" ? item.homeTeam : item.awayTeam;
}

export function countryName(item: Pick<Named, "country" | "tipico">, source: NameSource): string {
  return source === "tipico" && item.tipico ? item.tipico.country : item.country;
}

export function leagueName(item: Pick<Named, "league" | "tipico">, source: NameSource): string {
  return source === "tipico" && item.tipico ? item.tipico.league : item.league;
}

/**
 * Ein API-Teamname aus Detailansicht, H2H oder Ligatabelle: nur die beiden Mannschaften dieses
 * Spiels bekommen den gewählten Namen (Davids Entscheidung vom 11.10.2026), alle übrigen Teams
 * kennt nur API-Football.
 */
export function displayTeam(apiName: string, fixture: Pick<Named, "homeTeam" | "awayTeam" | "tipico">, source: NameSource): string {
  if (apiName === fixture.homeTeam) return teamName(fixture, "home", source);
  if (apiName === fixture.awayTeam) return teamName(fixture, "away", source);
  return apiName;
}

/**
 * Der Tipp als Text. Beim 1X2 steht der Teamname im Text des Backends („Heimsieg Hapoel
 * Katamon“) - er wird aus `pick` neu gebaut. `market.selection` selbst bleibt unangetastet.
 */
export function selectionText(
  fixture: Pick<Named, "homeTeam" | "awayTeam" | "tipico">,
  market: Pick<DashboardMarket, "key" | "pick" | "selection">,
  source: NameSource
): string {
  if (market.key === "1x2" && market.pick === "1") return `Heimsieg ${teamName(fixture, "home", source)}`;
  if (market.key === "1x2" && market.pick === "2") return `Auswärtssieg ${teamName(fixture, "away", source)}`;
  return market.selection;
}

/**
 * Eine Zeile der Liste „Wettbewerbe“ steht für eine API-Liga, Tipico kann sie in mehrere
 * Bezeichnungen aufteilen („Primera Division, Apertura, Gruppe A“ / „…, Gruppe B“). Angezeigt wird
 * der gemeinsame Anfang (ganze, durch „, “ getrennte Abschnitte); ohne gemeinsamen Anfang die
 * häufigste Bezeichnung mit „u. a.“ (Davids Entscheidungen vom 11.10.2026).
 */
export function competitionLabel(labels: readonly string[]): string {
  const distinct = [...new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0))];
  if (distinct.length === 0) return "";
  if (distinct.length === 1) return distinct[0]!;
  const parts = distinct.map((label) => label.split(",").map((part) => part.trim()));
  const common: string[] = [];
  for (let index = 0; index < parts[0]!.length; index += 1) {
    const part = parts[0]![index]!;
    if (!parts.every((other) => other[index] === part)) break;
    common.push(part);
  }
  if (common.length > 0) return common.join(", ");
  const counts = new Map<string, number>();
  for (const label of labels.map((item) => item.trim()).filter((item) => item.length > 0)) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const [mostCommon] = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "de"))[0]!;
  return `${mostCommon} u. a.`;
}

/** Eine Zeile der Liste „Wettbewerbe“: eine API-Liga samt aller Tipico-Bezeichnungen ihrer Spiele. */
export interface CompetitionNames {
  country: string;
  league: string;
  tipicoCountries?: readonly string[];
  tipicoLeagues?: readonly string[];
}

export function competitionCountry(entry: CompetitionNames, source: NameSource): string {
  return source === "tipico" && entry.tipicoCountries?.length ? competitionLabel(entry.tipicoCountries) : entry.country;
}

export function competitionLeague(entry: CompetitionNames, source: NameSource): string {
  return source === "tipico" && entry.tipicoLeagues?.length ? competitionLabel(entry.tipicoLeagues) : entry.league;
}

/** Die einzelnen Tipico-Bezeichnungen, wenn die Zeile sie zusammenfasst - für den Hinweis beim Überfahren. */
export function competitionVariants(entry: CompetitionNames, source: NameSource): string | undefined {
  if (source !== "tipico") return undefined;
  const distinct = [...new Set(entry.tipicoLeagues ?? [])].sort((left, right) => left.localeCompare(right, "de"));
  return distinct.length > 1 ? distinct.join("\n") : undefined;
}

/** Die Suche findet einen Wettbewerb unter beiden Namen, gleich wie der Schalter steht. */
export function competitionMatches(entry: CompetitionNames, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  const countries = [entry.country, ...(entry.tipicoCountries ?? [])];
  const leagues = [entry.league, ...(entry.tipicoLeagues ?? [])];
  return countries.some((country) => leagues.some((league) => `${country} ${league}`.toLowerCase().includes(query)))
    || [...countries, ...leagues].some((name) => name.toLowerCase().includes(query));
}
