/**
 * Zentrale Parameter des Team-Elo (`src/elo.ts`). Alles, was ein Backtest vergleichen soll,
 * steht hier - im Rechenkern gibt es keine zweite Zahl.
 *
 * **Die Werte sind Ausgangspunkte, nicht gemessen.** Sie folgen Davids Vorgabe vom 24.09.2026
 * und gängigen Fußball-Elo-Varianten (World Football Elo, FiveThirtyEight). Geändert wird erst
 * nach `npm run elo-backtest -- --config <datei.json>`, und dort gegen eine Vergleichsbasis.
 *
 * Getrennt vom Liga-Elo in `src/strength-builder.ts`: Jenes bewertet Ligen und speist den
 * Torfaktor des Modells. Dieses bewertet Mannschaften und berührt weder Tipp noch
 * Wahrscheinlichkeit.
 */

/**
 * Jugend- und Frauen-Nationalteams (seit 29.09.2026, Davids Auftrag): je eine eigene Skala,
 * weil sie nie gegen die A-Teams spielen - eine U21 bei 1500 neben Spanien bei 1900 sagte nichts.
 * Sie rechnen mit denselben Parametern wie die A-Nationalteams (`ELO_CONFIG.national`).
 */
export type NationalCategory = "u23" | "u21" | "u20" | "u19" | "u17" | "women";
export const NATIONAL_CATEGORIES: NationalCategory[] = ["u23", "u21", "u20", "u19", "u17", "women"];
/**
 * `club-women` (seit 29.09.2026): Frauen-Vereine, eigene Skala wie die Frauen-Nationalteams - sie
 * spielen nie gegen Männer-Vereine. Nur Anzeige, wie das Vereins-Elo überhaupt.
 */
export type EloSystem = "club" | "club-women" | "national" | `national-${NationalCategory}`;
export const ELO_SYSTEMS: EloSystem[] = ["club", "club-women", "national", ...NATIONAL_CATEGORIES.map((category) => `national-${category}` as const)];

/** Vereine oder Nationalteams - danach richten sich Parameter, Mitnahme und Vertrauen. */
export function eloFamily(system: EloSystem): "club" | "national" {
  return system === "club" || system === "club-women" ? "club" : "national";
}

export function systemConfigOf(config: EloConfig, system: EloSystem): EloSystemConfig {
  return config[eloFamily(system)];
}

/** Anzeigename einer Skala. */
export function eloSystemLabel(system: EloSystem): string {
  if (system === "club") return "Vereine";
  if (system === "club-women") return "Frauen-Vereine";
  if (system === "national") return "Nationalteams";
  const category = system.slice("national-".length);
  return category === "women" ? "Frauen-Nationalteams" : `${category.toUpperCase()}-Nationalteams`;
}

export type EloCompetitionKind =
  // Vereine
  | "championsLeague"
  | "europaLeague"
  | "conferenceLeague"
  | "continentalTop"
  | "continentalMinor"
  | "clubWorld"
  | "superCup"
  | "leagueTier1"
  | "leagueTier2"
  | "leagueTier3"
  | "domesticCup"
  | "clubFriendly"
  // Nationalteams
  | "worldCup"
  | "continentalFinals"
  | "minorTournament"
  | "qualification"
  | "nationsLeague"
  | "nationalFriendly";

/** Monate seit dem Spiel (bezogen auf den Stichtag) → Anteil des K. Aufsteigend sortiert. */
export type DecayTable = Array<{ untilMonths: number; factor: number }>;

export interface EloSystemConfig {
  startRating: number;
  k: number;
  homeAdvantage: number;
  /** Bei Turnier-Endrunden ist der Platz meist neutral - dort gilt dieser Heimvorteil. */
  neutralHomeAdvantage: number;
  decay: DecayTable;
  /** Faktor für Spiele älter als die letzte Stufe der Tabelle. 0 heißt: sie zählen nicht. */
  decayBeyond: number;
}

export interface EloConfig {
  version: string;
  club: EloSystemConfig;
  national: EloSystemConfig;
  competition: Record<EloCompetitionKind, number>;
  /**
   * Tordifferenz angelehnt an FiveThirtyEight, aber mit `log2` statt `ln`, damit ein Sieg mit
   * einem Tor Unterschied genau 1 ergibt:
   * `log2(|Tordifferenz| + 1) × autocorrA / (autocorrB × EloDiff_Sieger + autocorrA)`,
   * bei Remis 1, gedeckelt bei `cap`. Mit `enabled: false` gilt immer 1.
   *
   * **Die Bremse reicht nur zur Hälfte** (gemessen am 26.09.2026, Vereinsspiele seit 2023): Der
   * Elo-Favorit erreicht im Schnitt 0,016 weniger als erwartet, mit dem Faktor gewichtet aber nur
   * 0,009 weniger - ab 80 % Erwartung sogar mehr. Favoriten werden also zu schwach
   * zurückgeholt, ein Teil der bekannten Selbstüberschätzung stammt daher. Ohne den Faktor wäre
   * es trotzdem schlechter (gepaarter Log-Loss 2025 +0,0024 ±0,0003, 2026 +0,0020 ±0,0004,
   * Pokal +0,006/+0,011, Nationalteams +0,019/+0,020): Die Tordifferenz trägt mehr, als die
   * Schieflage kostet. Wer die Bremse stärker stellt, misst vorher - kein Wert nach Gefühl.
   */
  mov: { enabled: boolean; autocorrA: number; autocorrB: number; cap: number };
  /** Die ersten `games` Spiele eines Teams zählen mit `multiplier` - schneller Einstieg, danach Ruhe. */
  provisional: { games: number; multiplier: number };
  /**
   * `competitionMean`: Ein neues Team startet beim Mittel der bereits bewerteten Teams seines
   * ersten Ligawettbewerbs (mindestens `minRated` davon), sonst bei `startRating`.
   * `fixed`: immer `startRating`.
   */
  newTeamStart: { mode: "competitionMean" | "fixed"; minRated: number };
  /**
   * Vertrauen 0-100 %, getrennt vom Elo:
   * `100 × s(Σ Decay-Gewichte, games) × (0,5 + 0,5·s(verschiedene Gegner, opponents))
   *        × (0,6 + 0,4·s(gewichtete Spiele gegen andere Ligen, crossLeague))`,
   * `s(x, a) = 1 − e^(−x/a)`. Gezählt wird über die letzten `windowMonths`.
   */
  confidence: { games: number; opponents: number; crossLeague: number; windowMonths: number };
  /**
   * Ebenen der Ligen eines Landes, abgeleitet aus dem mittleren Elo ihrer Teams: nur Ligen mit
   * mindestens `minTeams` belastbar bewerteten Teams, eine Ebene tiefer erst ab `gap` Abstand.
   */
  tiers: { minTeams: number; gap: number };
  /**
   * Liga-Mitnahme: Spielen zwei Teams aus verschiedenen Ligen gegeneinander, bekommt jedes
   * andere Team der eigenen Liga `share` × die Änderung seines Ligakollegen mit. Ohne das
   * behält eine Liga, die fast nur gegen sich selbst spielt, ihren Schnitt bei 1500, und ihr
   * Meister steht weit oben - egal wie stark die Liga ist. Datengetrieben, kein fester Bonus.
   * 0 schaltet es ab.
   *
   * **Gemessen am 24.09.2026** (`npm run elo-backtest`, gepaarter Log-Loss gegen 0, negativ =
   * besser): Test 2025 mit 0,1 Pokal −0,015 ±0,001 / Europapokal −0,018 ±0,002, mit 0,3 Pokal
   * −0,029 ±0,002 / Europapokal −0,028 ±0,005. Gegenprobe auf einem **anderen** Zeitraum
   * (Test 01.01.-23.09.2026, 0,3): Pokal −0,041 ±0,003, Europapokal −0,031 ±0,005, Liga
   * −0,003 ±0,0003. 0,5 wurde nicht als Vorgabe genommen, obwohl die Rangliste damit noch
   * stärker spreizt: Der Wert wäre auf denselben Daten gesucht, gegen die gemessen wird.
   * Nebenwirkung: Die Mitnahme ist nicht nullsummig, die Skala verschiebt sich insgesamt nach
   * oben (Spitze vor dem Nachladen rund 2240 statt 2000, am 26.09.2026 rund 2485). Für
   * Vergleiche zählt der Abstand, nicht die Zahl.
   */
  leaguePropagation: {
    share: number;
    /**
     * Welcher Liga ein Verein für die Mitnahme angehört. `lastLeague`: der Liga seines letzten
     * Ligaspiels. `mainLeague`: ebenso, aber ein **Nebenwettbewerb** zieht ihn nicht ab.
     *
     * API-Football führt auch parallel laufende Wettbewerbe als Liga: die brasilianischen
     * Staatsmeisterschaften (Januar bis April neben Copa do Brasil und Libertadores), den „USL
     * League One Cup" und eigene Play-off-Ligen (Serie C, Liga III, Segunda RFEF). Mit
     * `lastLeague` gingen am 26.09.2026 in Brasilien 37 % der Mitnahmen an die Staatsliga statt
     * an die Serie A bis D, und 56 % der Empfänger waren Vereine ohne nationale Liga.
     *
     * **Gemessen und verworfen am 26.09.2026** (gepaarter Log-Loss `mainLeague` minus
     * `lastLeague`, negativ = besser): Test 2025 alle −0,0000 ±0,0001, Brasilien +0,0000
     * ±0,0009; Test 2026 alle +0,0001 ±0,0001, Brasilien +0,0008 ±0,0011, USA +0,0027 ±0,0011.
     * Die Fehlleitung ist echt, kostet aber keine messbare Vorhersagegüte - Vorgabe bleibt
     * `lastLeague`. Nicht umstellen, ohne neu zu messen.
     */
    membership: "lastLeague" | "mainLeague";
    /**
     * Nebenwettbewerb: Ein Team bestreitet dort in der vollsten Saison im Schnitt weniger als
     * `ratio` × so viele Spiele wie in seiner bisherigen Liga (Staatsliga rund 13 gegen 38 in
     * der Serie A). Der Wechsel unterbleibt nur, solange das letzte Spiel in der bisherigen
     * Liga höchstens `stickyDays` zurückliegt - ein Absteiger in eine kürzere Liga kommt so
     * spätestens danach an. Gezählt werden nur Saisons mit mindestens `minMatches` Spielen.
     * `ratio` 0,5 statt knapper: Der Abstieg aus der Serie B (38) in die Serie C (rund 22)
     * darf nicht als Nebenwettbewerb gelten.
     */
    sideCompetition: { ratio: number; stickyDays: number; minMatches: number };
  };
}

export const ELO_CONFIG: EloConfig = {
  // 1.2.0 (26.09.2026): Spiele zwischen Verein und Nationalteam und doppelt geführte Spiele
  // fallen heraus (`prepare` in src/elo.ts). 1.2.1: `ELO_TEAM_MERGES` führt Team-IDs zusammen.
  version: "1.2.1",
  club: {
    startRating: 1500,
    k: 30,
    homeAdvantage: 60,
    neutralHomeAdvantage: 0,
    // Sanfter Decay seit 1.1.0 (Davids Entscheidung vom 24.09.2026 nach dem Review). Die
    // ursprüngliche Staffel (0-6 M 1,0 · 6-12 0,8 · 12-18 0,6 · 18-24 0,4 · 24-36 0,2 ·
    // 36-60 0,075) gab Spielen vor 2024 so wenig K, dass sie die Skala zwischen den Ligen
    // nicht mit aufbauen konnten - erst 2024 hatte überhaupt ein Team zehn gewichtete Spiele.
    // Gepaarter Log-Loss gegen die alte Staffel (negativ = besser): Test 2026 alle −0,0045
    // ±0,0004, Liga −0,0019 ±0,0003, Pokal −0,025 ±0,002, Europapokal −0,010 ±0,002;
    // Gegenprobe Test 2025 alle −0,0023 ±0,0002, Pokal −0,014 ±0,001, Europapokal −0,007
    // ±0,002. Ganz ohne Decay war 2026 gleich gut insgesamt (−0,0046), besser bei Pokal und
    // Europapokal, schlechter bei Ligaspielen - David wollte, dass ältere Spiele weniger zählen.
    decay: [
      { untilMonths: 12, factor: 1 },
      { untilMonths: 24, factor: 0.8 },
      { untilMonths: 60, factor: 0.6 }
    ],
    decayBeyond: 0
  },
  national: {
    startRating: 1500,
    k: 40,
    homeAdvantage: 60,
    neutralHomeAdvantage: 0,
    // Gestreckt: Nationalteams spielen acht bis zwölf Mal im Jahr. Mit der Vereinstabelle
    // stünde ein Team nach einem Jahr fast ohne gewichtete Spiele da.
    decay: [
      { untilMonths: 12, factor: 1 },
      { untilMonths: 24, factor: 0.8 },
      { untilMonths: 36, factor: 0.6 },
      { untilMonths: 48, factor: 0.4 },
      { untilMonths: 60, factor: 0.25 }
    ],
    decayBeyond: 0
  },
  competition: {
    championsLeague: 1.3,
    europaLeague: 1.2,
    conferenceLeague: 1.1,
    continentalTop: 1.15,
    continentalMinor: 1.0,
    clubWorld: 1.2,
    superCup: 0.8,
    leagueTier1: 1.0,
    leagueTier2: 0.9,
    leagueTier3: 0.8,
    domesticCup: 0.85,
    clubFriendly: 0.5,
    worldCup: 1.3,
    continentalFinals: 1.2,
    minorTournament: 0.9,
    qualification: 1.0,
    nationsLeague: 0.9,
    nationalFriendly: 0.5
  },
  mov: { enabled: true, autocorrA: 2.2, autocorrB: 0.001, cap: 2 },
  provisional: { games: 10, multiplier: 1.5 },
  newTeamStart: { mode: "competitionMean", minRated: 5 },
  confidence: { games: 20, opponents: 15, crossLeague: 6, windowMonths: 24 },
  tiers: { minTeams: 10, gap: 30 },
  leaguePropagation: {
    share: 0.3,
    membership: "lastLeague",
    sideCompetition: { ratio: 0.5, stickyDays: 180, minMatches: 20 }
  }
};

/**
 * Wettbewerbe nach Liga-ID. **Abgelesen aus `getAllLeagues()` am 24.09.2026**, nicht aus dem
 * Gedächtnis: „Friendlies" (10) sind Länderspiele, „Friendlies Clubs" (667) Vereins-Testspiele,
 * und Afrika-Cup (6) und seine Qualifikation (36) sind zwei Wettbewerbe.
 */
export const ELO_COMPETITIONS: {
  national: Record<number, EloCompetitionKind>;
  club: Record<number, EloCompetitionKind>;
  /** Turnier-Endrunden auf meist neutralem Platz. */
  neutral: number[];
} = {
  national: {
    1: "worldCup",
    4: "continentalFinals", 6: "continentalFinals", 7: "continentalFinals", 9: "continentalFinals",
    22: "continentalFinals", 806: "continentalFinals", 21: "continentalFinals", 913: "continentalFinals",
    19: "minorTournament", 23: "minorTournament", 24: "minorTournament", 25: "minorTournament",
    28: "minorTournament", 535: "minorTournament", 804: "minorTournament", 805: "minorTournament",
    807: "minorTournament", 849: "minorTournament", 859: "minorTournament", 860: "minorTournament",
    1008: "minorTournament",
    29: "qualification", 30: "qualification", 31: "qualification", 32: "qualification",
    33: "qualification", 34: "qualification", 35: "qualification", 36: "qualification",
    37: "qualification", 960: "qualification", 858: "qualification", 808: "qualification",
    1163: "qualification", 1169: "qualification",
    5: "nationsLeague", 536: "nationsLeague",
    10: "nationalFriendly", 916: "nationalFriendly", 766: "nationalFriendly", 1038: "nationalFriendly",
    1222: "nationalFriendly", 1207: "nationalFriendly"
  },
  club: {
    2: "championsLeague", 3: "europaLeague", 848: "conferenceLeague",
    13: "continentalTop", 16: "continentalTop", 17: "continentalTop", 12: "continentalTop",
    27: "continentalTop",
    11: "continentalMinor", 18: "continentalMinor", 20: "continentalMinor", 767: "continentalMinor",
    1132: "continentalMinor", 856: "continentalMinor", 534: "continentalMinor", 1028: "continentalMinor",
    1043: "continentalMinor", 1129: "continentalMinor", 1162: "continentalMinor", 768: "continentalMinor",
    869: "continentalMinor", 772: "continentalMinor", 1214: "continentalMinor",
    15: "clubWorld", 1168: "clubWorld", 1186: "clubWorld",
    531: "superCup", 533: "superCup", 541: "superCup", 885: "superCup", 1024: "superCup",
    1089: "superCup", 1123: "superCup",
    667: "clubFriendly", 26: "clubFriendly", 769: "clubFriendly", 937: "clubFriendly",
    900: "clubFriendly", 1236: "clubFriendly", 1216: "clubFriendly"
  },
  neutral: [
    1, 4, 6, 7, 9, 22, 806, 21, 913, 19, 23, 24, 25, 28, 535, 804, 805, 807, 849, 859, 860, 1008, 15, 1168, 1186,
    // Endrunden der Jugend- und Frauen-Nationalteams
    38, 490, 493, 587, 921, 532, 8, 743, 897, 922, 1057, 926
  ]
};

/**
 * Wettbewerbe der Jugend- und Frauen-Nationalteams, ebenfalls aus `getAllLeagues()` vom
 * 29.09.2026. Welche Skala ein Spiel bekommt, sagen die Teamnamen („Iceland U21", „Spain W"),
 * nicht der Wettbewerb - so landet ein U21-Testspiel unter „Friendlies" (10) richtig.
 * Vereins-Jugend („Premier League 2", „U19 Bundesliga") steht nie unter `World` und bleibt
 * ausgeschlossen.
 */
export const ELO_NATIONAL_CATEGORY_COMPETITIONS: Record<number, EloCompetitionKind> = {
  // U23 (Asien)
  532: "continentalFinals", 952: "qualification",
  // U21 (UEFA)
  38: "continentalFinals", 850: "qualification",
  // U20
  490: "worldCup", 537: "continentalFinals", 538: "continentalFinals", 965: "continentalFinals", 773: "continentalFinals",
  // U19 (UEFA)
  493: "continentalFinals", 893: "qualification",
  // U17
  587: "worldCup", 921: "continentalFinals", 886: "qualification", 1012: "continentalFinals", 970: "continentalFinals",
  963: "continentalFinals", 973: "continentalFinals",
  // Frauen
  8: "worldCup", 743: "continentalFinals", 1083: "qualification", 880: "qualification", 927: "qualification",
  1040: "nationsLeague", 897: "continentalFinals", 894: "qualification", 922: "continentalFinals",
  1057: "continentalFinals", 1046: "qualification", 1206: "nationsLeague", 926: "continentalFinals",
  // Testspiele: „Friendlies" (10) trägt auch U21-, U20-, U19- und U17-Teams, „Friendlies Women" (666) die Frauen
  10: "nationalFriendly", 666: "nationalFriendly"
};

/**
 * Internationale Wettbewerbe der Frauen-Vereine (aus `getAllLeagues()` vom 29.09.2026). Nationale
 * Frauenligen und -pokale brauchen keinen Eintrag - sie stehen nicht unter `World`.
 */
export const ELO_WOMEN_CLUB_COMPETITIONS: Record<number, EloCompetitionKind> = {
  525: "championsLeague", 1191: "europaLeague", 1140: "continentalTop", 1164: "continentalTop",
  1217: "clubWorld", 945: "clubFriendly", 667: "clubFriendly"
};

/** Jugend und Reserve - bei Frauen-Vereinen weiter ausgeschlossen. */
export const ELO_YOUTH_PATTERN =
  /\b(u-?1\d|u-?2\d|youth|junior|juvenil|reserves?|primavera|development|academy|olympics?)\b/i;

/** Die Skala zweier Teams aus ihren Namen, oder null, wenn sie nicht zusammenpassen. */
export function nationalCategoryOf(homeName: string, awayName: string): NationalCategory | null {
  const of = (name: string): NationalCategory | "senior" => {
    const age = /\sU-?(\d{2})$/i.exec(name)?.[1];
    if (age) return NATIONAL_CATEGORIES.includes(`u${age}` as NationalCategory) ? `u${age}` as NationalCategory : "senior";
    return /\sW$/.test(name) ? "women" : "senior";
  };
  const home = of(homeName);
  return home !== "senior" && home === of(awayName) ? home : null;
}

/**
 * Ein Verein, den API-Football unter mehreren Team-IDs führt. Das Elo erkennt Mannschaften nur an
 * der ID; ohne Zusammenführung zerfällt die Geschichte eines Vereins in mehrere „Teams", und das
 * jüngste beginnt beim Startwert. Die meisten Umbenennungen behalten ihre ID (York United →
 * Inter Toronto FC, Dépor FC → Atlético FC) und brauchen keinen Eintrag.
 */
export interface EloTeamMerge {
  /** Die alte oder zusätzlich benutzte ID. */
  from: number;
  /**
   * Die ID, unter der API-Football den Verein heute führt. Negativ: eine eigene ID für einen
   * abgetrennten Verein, den API-Football unter der ID eines anderen führt (Trennung statt
   * Zusammenführung, seit 20.10.2026) - dann gehört `name` dazu.
   */
  to: number;
  /** Anzeigename nach dem Umhängen; sonst bliebe der Name des Vereins, dessen ID geteilt ist. */
  name?: string;
  /** Nur Spiele in Wettbewerben dieser Länder; „World" sind Testspiele und internationale Wettbewerbe. */
  countries?: string[];
  /**
   * Nur Spiele dieser Wettbewerbe (Liga-IDs) - für zwei Mannschaften eines Landes unter einer ID,
   * etwa erste und zweite Mannschaft (seit 20.10.2026).
   */
  leagues?: number[];
  /** Nur Spiele ab diesem Zeitpunkt (ISO) - etwa wenn die erste Mannschaft aus der Liga aufstieg. */
  since?: string;
  /** Nur Spiele vor diesem Zeitpunkt (ISO) - etwa wenn die erste Mannschaft später dorthin abstieg. */
  until?: string;
  /** Einzelne Spiele, die trotzdem bei `from` bleiben. */
  exceptFixtures?: number[];
  note: string;
}

/** Gefunden über gleiche Liga, gleiche Gegner und nahtlos anschließende Spielpläne - nicht geraten. */
export const ELO_TEAM_MERGES: EloTeamMerge[] = [
  {
    from: 21435, to: 27669,
    note: "Ariana FC Malmö 2023-2025 (Ettan Södra), seit der Umbenennung vom 31.05.2025 AFC Malmö unter 27669"
  },
  {
    // Dieselbe ID trägt seit Oktober 2023 auch AS Ariana aus Tunesien (Ligue 2, Pokal, ein
    // Testspiel gegen Club Africain). Nur die schwedischen Spiele und Testspiele gehören zu Malmö.
    from: 10598, to: 27669, countries: ["Sweden", "World"], exceptFixtures: [1501344],
    note: "Ariana FC Malmö 2022 (Division 2) und Vorbereitungsspiele bis März 2026"
  },
  {
    // 8560 „Police" trägt auch Police aus Burkina Faso (Ligue 1) sowie 2021 einen AFC- und einen
    // CAF-Teilnehmer. Kenya Police lief in der FKF Premier League bis Juni 2022 unter 2485, ab
    // Dezember 2021 nahtlos und ohne gemeinsamen Spieltag unter 8560, die Ansetzungen ab
    // 20.10.2026 wieder unter 2485. Dazu CAF Confederation Cup 2024, CECAFA Club Cup 2025.
    from: 8560, to: 2485, countries: ["Kenya", "World"], exceptFixtures: [663747, 773191, 773192], name: "Kenya Police",
    note: "Kenya Police: FKF Premier League und Shield Cup 2021-2026, CAF/CECAFA 2024-2025 (20.10.2026)"
  },
  {
    // API-Football hat Al Shorta (Bagdad) zwischen 05.10. und 21.10.2026 rückwirkend umnummeriert:
    // dieselben Fixtures (Al Zawra'a - Al Shorta 1628014, Al Shorta - Al Karkh 18.10., AFC Champions
    // League Two) tragen im Cache vom 05.10. die 5242, ab 21.10. die 28571. Den sudanesischen Teil
    // von 5242 trennt der Eintrag weiter unten ab; „World" sind bei 5242 nur AFC-Wettbewerbe.
    from: 5242, to: 28571, countries: ["Iraq", "World"],
    note: "Al Shorta (Irak): Iraqi League und AFC 2020-2026, seit Oktober 2026 unter 28571 (22.10.2026)"
  },
  {
    // Dasselbe bei Kerry FC (Irland): Die Fixtures der First Division 2025 (1324339, 1324343,
    // 1324473 ...) stehen in elo_matches unter 11328, im Cache vom 23.10.2026 unter 28562; Kerry -
    // Cork City vom 16.10.2026 liegt im Cache unter beiden IDs. 11328 trägt nur Kerry FC (First
    // Division, FAI Cup, Vereins-Testspiele 2023-2026).
    from: 11328, to: 28562, countries: ["Ireland", "World"],
    note: "Kerry FC (Irland): First Division und FAI Cup 2023-2026, seit Oktober 2026 unter 28562 (23.10.2026)"
  },
  {
    // Trennung: 687 ist Flora Tallinn (Meistriliiga, Europapokal, Testspiele). API-Football legte
    // 2023 die 24 Spiele eines Vereins der zweiten Liga Surinams unter dieselbe ID, an vier Tagen
    // zeitgleich mit Spielen in Estland (`npm run data-check`, 20.10.2026).
    from: 687, to: -687, countries: ["Suriname"], name: "Flora (Suriname)",
    note: "Eerste Divisie Suriname 2023 unter der ID von Flora Tallinn (20.10.2026)"
  },
  // Trennungen vom 20.10.2026 (`npm run data-check`): Jede ID hatte an mindestens zwei Tagen zwei
  // Pflichtspiele gegen verschiedene Gegner. Abgetrennt wird der Teil, der nicht zum Verein der
  // heutigen Ansetzungen gehört - fremdes Land über `countries`, zweite Mannschaft oder
  // gleichnamiger Klub im selben Land über `leagues`. Namen in Klammern, wo der Verein unbekannt ist.
  // Fremdes Land (Doppel-Spieltage zwischen der Heimatliga und der fremden Liga):
  ...([
    [5242, "Sudan", "Al Shorta (Sudan)", "Sudani Premier League 2022-2026, 14 Doppel-Spieltage mit der Iraqi League"],
    [1057, "El-Salvador", "Platense (El Salvador)", "Primera División 2021/22, 11 Tage mit der Liga Nacional Honduras"],
    [8114, "Australia", "Vipers (Australien)", "South Australia State League 1 2023-2025, 11 Tage mit Uganda und CAF"],
    [8086, "Benin", "Etoile Filante (Benin)", "Championnat National 2023-2025, 10 Tage mit der Ligue 1 Burkina Faso"],
    [8379, "Spain", "San Miguel (Spanien)", "Tercera RFEF Gruppe 12 2024/25, 9 Tage mit der Primera Nacional"],
    [9855, "Guatemala", "San Juan (Guatemala)", "Primera División 2022/23, 7 Tage mit der Segunda RFEF"],
    [12452, "Norway", "Express (Norwegen)", "3. Division und NM Cupen 2021-2024, 6 Tage mit der Premier League Uganda"],
    [3702, "Venezuela", "Bolívar (Venezuela)", "Segunda División 2021/22, 5 Tage mit der Primera División Bolivien"],
    [1051, "Peru", "Olimpia (Peru)", "Copa Perú 2023, 5 Tage mit der Liga Nacional Honduras"],
    [13134, "USA", "Capital (USA)", "USL League Two 2022-2024, 4 Tage mit der Serie D"],
    [2056, "Northern-Ireland", "Aserri (Nordirland)", "Irish Cup 2022-2024 unter der ID eines Klubs aus Costa Rica"],
    [2373, "New-Zealand", "Miramar (Neuseeland)", "National League und Chatham Cup 2025/26, 4 Tage mit Uruguay"],
    [10217, "Mongolia", "Lions (Mongolei)", "Premier League 2021/22, 3 Tage mit der Queensland NPL"],
    [437, "Brazil", "Rosario Central (Brasilien)", "Sergipano 2 2024, 3 Tage mit der Liga Profesional"],
    [22782, "Rwanda", "Vision (Ruanda)", "National Soccer League 2024/25, 3 Tage mit der Premier League Ghana"],
    [9678, "Dominican-Republic", "San Cristóbal (Dominikanische Republik)", "Liga Mayor 2022, 2 Tage mit der Tercera RFEF"],
    [12601, "Uzbekistan", "Olympic (Usbekistan)", "Cup und Super League 2021-2023, 2 Tage mit der Ettan Södra"],
    [1140, "Brazil", "Patriotas (Brasilien)", "Paranaense 2 2025, 2 Tage mit der Primera B Kolumbien"],
    [135, "El-Salvador", "Cruzeiro (El Salvador)", "Copa Presidente 2026, 2 Tage mit der Serie A"],
    [4310, "Costa-Rica", "Águila (Costa Rica)", "Copa Costa Rica 2024, 2 Tage mit El Salvador und CONCACAF"],
    [12457, "Lesotho", "SC Villa (Lesotho)", "Premier League Lesotho 2026, 2 Tage mit der Premier League Uganda"]
  ] as const).map(([id, country, name, note]): EloTeamMerge => ({ from: id, to: -id, countries: [country], name, note })),
  // Zweites fremdes Land derselben ID (je ein Spiel, ohne Doppel-Spieltag, aber eindeutig fremd).
  { from: 8379, to: -83791, countries: ["Paraguay"], name: "San Miguel (Paraguay)", note: "Copa Paraguay 2024" },
  { from: 1140, to: -11401, countries: ["Paraguay"], name: "Patriotas (Paraguay)", note: "Copa Paraguay 2024" },
  // Selbes Land, eine Liga gehört einer zweiten Mannschaft oder einem gleichnamigen Klub:
  ...([
    [4459, 381, "Rangers (HKFA 1st Division)", "1st Division 2021-2023, 14 Tage mit der Premier League"],
    [10566, 289, "Royal AM (1st Division)", "1st Division 2021/22, 8 Tage mit der Premier Soccer League"],
    [4496, 496, "Hapoel Iksal (Liga Alef)", "Liga Alef 2021/22, 7 Tage mit der Liga Leumit"],
    [3475, 325, "Goa (Santosh Trophy)", "Landesauswahl der Santosh Trophy, 7 Tage mit ISL und AFC"],
    [7177, 325, "Odisha (Santosh Trophy)", "Landesauswahl der Santosh Trophy, 4 Tage mit der ISL"],
    [1031, 889, "Al Masry (Second League)", "Second League Gruppe C 2021/22, 5 Tage mit Premier League und League Cup"],
    [4040, 256, "Chicago Fire (USL League Two)", "USL League Two 2022, 5 Tage mit der MLS Next Pro"],
    [1599, 1118, "Philadelphia Union (NPSL)", "NPSL 2024/25, 5 Tage mit MLS und US Open Cup"],
    [3672, 637, "Ho Chi Minh (V.League 2)", "V.League 2 2025/26, 5 Tage mit der V.League 1"],
    [13192, 1118, "Virginia Beach City (NPSL)", "NPSL 2025, 4 Tage mit der USL League Two"],
    [9037, 256, "West Chester United (USL League Two)", "USL League Two 2025/26, 4 Tage mit der NPSL"],
    [10013, 503, "Cusco (Copa Perú)", "Copa Perú 2022, 2 Tage mit der Segunda División"],
    [132, 1036, "Chapecoense (Copa Santa Catarina)", "Copa Santa Catarina 2023-2025, 2 Tage mit der Serie B"]
  ] as const).map(([id, league, name, note]): EloTeamMerge => ({ from: id, to: -id, leagues: [league], name, note })),
  {
    // Die erste Mannschaft stieg zur Saison 2024/25 in die Regionalliga Mitte auf; die Landesliga
    // danach ist die zweite Mannschaft (7 Doppel-Spieltage ab August 2025).
    from: 4979, to: -4979, leagues: [227], since: "2024-07-01T00:00:00Z", name: "Oedt II",
    note: "Landesliga Oberösterreich ab 2024/25"
  },
  {
    // Die erste Mannschaft spielte 2021/22 selbst in der Tercera Gruppe 10 (Abstieg 2021); die
    // zweite Mannschaft erst ab 2025/26 (24 Doppel-Spieltage mit der Segunda RFEF).
    from: 9410, to: -9410, leagues: [448], since: "2025-07-01T00:00:00Z", name: "Recreativo Huelva II",
    note: "Tercera RFEF Gruppe 10 ab 2025/26"
  },
  {
    // Nur 2022/23 liefen Primera RFEF Gruppe 1 und Segunda RFEF Gruppe 5 nebeneinander (21 Tage);
    // 2023-2025 und 2026/27 spielt die erste Mannschaft selbst in der Segunda RFEF Gruppe 5.
    from: 5253, to: -5253, leagues: [879], since: "2022-07-01T00:00:00Z", until: "2023-07-01T00:00:00Z",
    name: "Talavera (Segunda RFEF 2022/23)", note: "Segunda RFEF Gruppe 5 2022/23"
  },
  {
    // Die Queensland Premier League gehörte 2021-2023 einer zweiten Mannschaft (15 Tage mit der NPL);
    // 2026 spielt die erste Mannschaft nach dem Abstieg selbst dort.
    from: 10223, to: -10223, leagues: [833], until: "2024-01-01T00:00:00Z",
    name: "SC Wanderers (Queensland Premier League)", note: "Queensland Premier League 2021-2023"
  }
];

/**
 * Dasselbe für Teamnamen: Frauenligen heißen nicht immer so („Damallsvenskan"), ihre Teams bei
 * API-Football aber fast immer „Häcken W", „Arsenal W" oder „Bayern Munich U19". Zweite
 * Mannschaften („Borussia Dortmund II", „Jong Ajax") bleiben drin - sie spielen im Männerbetrieb.
 */
export const ELO_EXCLUDE_TEAM_PATTERN = /(\s(W|U-?\d{2})$|\b(women|ladies|femen[ií]n?[oa]?|feminino|femminile|frauen)\b)/i;

/**
 * Zweite Mannschaften, die API-Football mit Altersangabe führt („Juventus U23", „Jong PSV U21"),
 * aber eine ganze Saison in einer Männerliga spielen. Sie sind dieselbe Art Team wie „Borussia
 * Dortmund II" und fielen nur über den Namen heraus (Davids Entscheidung vom 11.10.2026). Gewertet
 * werden ausschließlich ihre **Ligaspiele gegen Männer-Teams** (`classifyMatch`); Premier League 2,
 * EFL Trophy, Testspiele und Jugendpokale bleiben draußen. Ausgewählt am 11.10.2026 aus
 * `elo_matches` (Ligaspiele seit 2021 gegen Gegner ohne Altersangabe). Bewusst nicht dabei:
 * Auswahlteams von Verbänden (Qatar U23, HK U23 - sie können Nationalteam-IDs tragen) und
 * Teams mit nur einzelnen Ligaspielen (Feyenoord U21, Groningen U21).
 */
export const ELO_SENIOR_RESERVE_TEAMS: ReadonlySet<number> = new Set([
  1715, // Juventus U23 - Serie C
  26355, // Inter U23 - Serie C
  411, // Jong PSV U21 - Eerste Divisie
  6771, // Hearts U21 - Lowland League
  6779, // Rangers U21 - Lowland League
  22416, // Dinamo Zagreb U21 - Prva NL
  24236, // Narva U21 - Esiliiga B
  25403, // Pärnu JK Vaprus U21 - Esiliiga B
  3773, // Sydney FC U23 - NPL New South Wales
  14025, // Western Sydney Wanderers U23 - NPL New South Wales
  27474, // Western Sydney Wanderers U21 - NPL New South Wales
  23508, // Devonport U21 - Tasmania Northern Championship
  23509, // Launceston U21 - Tasmania Northern Championship
  23510, // Launceston United U21 - Tasmania Northern Championship
  23512, // Riverside Olympic U21 - Tasmania Northern Championship
  27750, // Ulverstone U21 - Tasmania Northern Championship
  23522, // Glenorchy Knights U21 - Tasmania Southern Championship
  23526, // South East Utd. U21 - Tasmania Southern Championship
  25952 // BFF Academy U20 - Bhutan Premier League
]);

/**
 * Frauen-, Jugend-, Reserve- und Olympia-Wettbewerbe. Ihre Teams spielen nie gegen die
 * Männer-Teams und bildeten eigene Inseln bei 1500, die die Rangliste verfälschen.
 */
export const ELO_EXCLUDE_PATTERN =
  /\b(women|woman|femenin[oa]?|feminine|frauen|dames|w[- ]league|u-?1\d|u-?2\d|youth|junior|juvenil|reserves?|primavera|development|academy|premier league 2|olympics?|pre-olympic|games|viareggio|revello|elite league|kings world cup)\b/i;
