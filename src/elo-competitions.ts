import { ELO_COMPETITIONS, ELO_EXCLUDE_PATTERN, ELO_EXCLUDE_TEAM_PATTERN, type EloCompetitionKind, type EloSystem } from "./elo-config.ts";

/**
 * Ein abgeschlossenes Spiel, so wie es in `elo_matches` steht. `goals` ist der Endstand nach
 * Verlängerung, ohne Elfmeterschießen - ein Spiel, das im Elfmeterschießen entschieden wurde,
 * steht damit als Remis da. Genau so soll es ins Elo eingehen.
 */
export interface EloMatch {
  fixtureId: number;
  /** Anstoß in Millisekunden seit 1970. */
  kickoff: number;
  leagueId: number;
  leagueName: string;
  /** `League` oder `Cup` aus `getAllLeagues()`; null, wenn der Wettbewerb dort fehlt. */
  leagueType: string | null;
  country: string;
  season: number;
  homeId: number;
  homeName: string;
  awayId: number;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
}

export type Classification =
  | { excluded: true; reason: "jugendFrauen" | "unbekannt" }
  | {
      excluded: false;
      system: EloSystem;
      /** Bei Ligen der Platzhalter `leagueTier1`; die Ebene setzt erst `leagueTier`. */
      kind: EloCompetitionKind;
      /** Ligaspiel, dessen Ebene aus den Daten abgeleitet wird. */
      isLeague: boolean;
      /** Internationaler Wettbewerb: verbindet Ligen bzw. Kontinentalverbände. */
      international: boolean;
      neutral: boolean;
    };

const FRIENDLY_PATTERN = /\b(friendl(?:y|ies)|freundschaft(?:sspiel)?|testimonial|all[- ]star)\b/i;
const SUPER_CUP_PATTERN = /\b(super ?cup|supercopa|supercoppa|super ?coupe|troph[ée]e des champions|community shield|supercupa|superpuchar|supertaça|supercup)\b/i;
const NEUTRAL = new Set(ELO_COMPETITIONS.neutral);

/**
 * Ordnet ein Spiel einem System und einem Wettbewerbstyp zu.
 *
 * Nationalteams und internationale Vereinswettbewerbe stehen als Liste von Liga-IDs in
 * `ELO_COMPETITIONS`. Ein unbekannter Wettbewerb unter `World` wird **ausgeschlossen**, nicht
 * geraten: Er könnte Nationalteams tragen, und ein einziges solches Spiel würde die getrennten
 * Skalen vermischen.
 */
export function classifyMatch(
  match: Pick<EloMatch, "leagueId" | "leagueName" | "leagueType" | "country"> & Partial<Pick<EloMatch, "homeName" | "awayName">>
): Classification {
  if (ELO_EXCLUDE_PATTERN.test(match.leagueName)) return { excluded: true, reason: "jugendFrauen" };
  if ((match.homeName && ELO_EXCLUDE_TEAM_PATTERN.test(match.homeName)) || (match.awayName && ELO_EXCLUDE_TEAM_PATTERN.test(match.awayName))) {
    return { excluded: true, reason: "jugendFrauen" };
  }

  const national = ELO_COMPETITIONS.national[match.leagueId];
  if (national) {
    return { excluded: false, system: "national", kind: national, isLeague: false, international: true, neutral: NEUTRAL.has(match.leagueId) };
  }
  const club = ELO_COMPETITIONS.club[match.leagueId];
  if (club) {
    return {
      excluded: false, system: "club", kind: club, isLeague: false,
      international: club !== "clubFriendly", neutral: NEUTRAL.has(match.leagueId)
    };
  }
  if (match.country === "World") return { excluded: true, reason: "unbekannt" };

  const base = { excluded: false as const, system: "club" as const, international: false, neutral: false };
  if (FRIENDLY_PATTERN.test(match.leagueName)) return { ...base, kind: "clubFriendly", isLeague: false };
  const type = match.leagueType?.toLocaleLowerCase();
  if (type === "league") return { ...base, kind: "leagueTier1", isLeague: true };
  if (type === "cup") {
    return { ...base, kind: SUPER_CUP_PATTERN.test(match.leagueName) ? "superCup" : "domesticCup", isLeague: false };
  }
  return { excluded: true, reason: "unbekannt" };
}

/**
 * Der Kontinentalverband eines Nationalteams, abgeleitet aus den Wettbewerben, in denen es
 * spielt. Nur für das Vertrauen: Ein Spiel gegen einen anderen Verband verbindet zwei Skalen.
 */
export const CONFEDERATION_OF_COMPETITION: Record<number, string> = {
  4: "UEFA", 5: "UEFA", 32: "UEFA", 960: "UEFA", 849: "UEFA",
  9: "CONMEBOL", 34: "CONMEBOL",
  7: "AFC", 23: "AFC", 24: "AFC", 25: "AFC", 28: "AFC", 30: "AFC", 35: "AFC", 807: "AFC", 1008: "AFC", 1169: "AFC",
  6: "CAF", 19: "CAF", 29: "CAF", 36: "CAF", 535: "CAF", 859: "CAF", 1163: "CAF",
  22: "CONCACAF", 31: "CONCACAF", 536: "CONCACAF", 804: "CONCACAF", 805: "CONCACAF", 808: "CONCACAF", 858: "CONCACAF",
  33: "OFC", 806: "OFC"
};
