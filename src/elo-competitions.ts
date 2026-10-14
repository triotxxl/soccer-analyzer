import {
  ELO_COMPETITIONS, ELO_EXCLUDE_PATTERN, ELO_EXCLUDE_TEAM_PATTERN, ELO_NATIONAL_CATEGORY_COMPETITIONS, ELO_WOMEN_CLUB_COMPETITIONS,
  ELO_SENIOR_RESERVE_TEAMS, ELO_YOUTH_PATTERN, nationalCategoryOf,
  type EloCompetitionKind, type EloSystem
} from "./elo-config.ts";

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

type ClassifiableMatch = Pick<EloMatch, "leagueId" | "leagueName" | "leagueType" | "country">
  & Partial<Pick<EloMatch, "homeId" | "homeName" | "awayId" | "awayName">>;

/**
 * Jugend- und Frauenteams am Namen erkennen. Ausnahme: eine zweite Mannschaft aus
 * `ELO_SENIOR_RESERVE_TEAMS` in einem Ligaspiel gegen ein Team ohne Altersangabe - dort spielt sie
 * im Männerbetrieb wie „Borussia Dortmund II".
 */
function isExcludedTeam(match: ClassifiableMatch, side: "home" | "away"): boolean {
  const name = side === "home" ? match.homeName : match.awayName;
  if (!name || !ELO_EXCLUDE_TEAM_PATTERN.test(name)) return false;
  const id = side === "home" ? match.homeId : match.awayId;
  const opponent = side === "home" ? match.awayName : match.homeName;
  const seniorLeagueGame = id !== undefined && ELO_SENIOR_RESERVE_TEAMS.has(id)
    && match.leagueType?.toLocaleLowerCase() === "league"
    && opponent !== undefined && !ELO_EXCLUDE_TEAM_PATTERN.test(opponent);
  return !seniorLeagueGame;
}

/**
 * Ordnet ein Spiel einem System und einem Wettbewerbstyp zu.
 *
 * Nationalteams und internationale Vereinswettbewerbe stehen als Liste von Liga-IDs in
 * `ELO_COMPETITIONS`. Ein unbekannter Wettbewerb unter `World` wird **ausgeschlossen**, nicht
 * geraten: Er könnte Nationalteams tragen, und ein einziges solches Spiel würde die getrennten
 * Skalen vermischen.
 */
export function classifyMatch(
  match: ClassifiableMatch
): Classification {
  // Jugend- und Frauen-Nationalteams vor dem Ausschluss: Ihre Wettbewerbe und Namen tragen genau
  // die Muster („U21", „Women", „ W"), an denen der Ausschluss sonst greift. Beide Teams müssen
  // zur selben Skala gehören - „Spain U21" gegen „Spain U19" bleibt draußen.
  const categoryKind = ELO_NATIONAL_CATEGORY_COMPETITIONS[match.leagueId];
  const category = categoryKind && match.homeName && match.awayName
    ? nationalCategoryOf(match.homeName, match.awayName)
    : null;
  if (categoryKind && category) {
    return {
      excluded: false, system: `national-${category}`, kind: categoryKind, isLeague: false,
      international: true, neutral: NEUTRAL.has(match.leagueId)
    };
  }
  // Frauen-Vereine: beide Teams „… W“, ein nationaler Wettbewerb oder ein internationaler aus der
  // Liste. Jugend bleibt draußen. Eigene Skala `club-women`, sonst wie Vereine.
  if (
    match.homeName && match.awayName && nationalCategoryOf(match.homeName, match.awayName) === "women"
    && !ELO_YOUTH_PATTERN.test(`${match.leagueName} ${match.homeName} ${match.awayName}`)
    && !ELO_NATIONAL_CATEGORY_COMPETITIONS[match.leagueId]
  ) {
    const international = ELO_WOMEN_CLUB_COMPETITIONS[match.leagueId];
    const base = { excluded: false as const, system: "club-women" as const, neutral: NEUTRAL.has(match.leagueId) };
    if (international) return { ...base, kind: international, isLeague: false, international: international !== "clubFriendly" };
    if (match.country !== "World") {
      if (FRIENDLY_PATTERN.test(match.leagueName)) return { ...base, kind: "clubFriendly", isLeague: false, international: false };
      const type = match.leagueType?.toLocaleLowerCase();
      if (type === "league") return { ...base, kind: "leagueTier1", isLeague: true, international: false };
      if (type === "cup") return { ...base, kind: SUPER_CUP_PATTERN.test(match.leagueName) ? "superCup" : "domesticCup", isLeague: false, international: false };
    }
  }
  if (ELO_EXCLUDE_PATTERN.test(match.leagueName)) return { excluded: true, reason: "jugendFrauen" };
  if (isExcludedTeam(match, "home") || isExcludedTeam(match, "away")) {
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
  33: "OFC", 806: "OFC",
  // Jugend und Frauen
  38: "UEFA", 850: "UEFA", 493: "UEFA", 893: "UEFA", 921: "UEFA", 886: "UEFA", 743: "UEFA", 1083: "UEFA",
  880: "UEFA", 1040: "UEFA",
  773: "CONMEBOL", 970: "CONMEBOL", 1206: "CONMEBOL", 926: "CONMEBOL",
  532: "AFC", 952: "AFC", 965: "AFC", 1012: "AFC", 897: "AFC", 894: "AFC",
  538: "CAF", 973: "CAF", 922: "CAF",
  537: "CONCACAF", 963: "CONCACAF", 927: "CONCACAF", 1057: "CONCACAF", 1046: "CONCACAF"
};
