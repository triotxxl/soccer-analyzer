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

export type EloSystem = "club" | "national";

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
   * Tordifferenz nach FiveThirtyEight:
   * `ln(|Tordifferenz| + 1) × autocorrA / (autocorrB × EloDiff_Sieger + autocorrA)`,
   * bei Remis 1, gedeckelt bei `cap`. Mit `enabled: false` gilt immer 1.
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
   * oben (Spitze rund 2240 statt 2000). Für Vergleiche zählt der Abstand, nicht die Zahl.
   */
  leaguePropagation: { share: number };
}

export const ELO_CONFIG: EloConfig = {
  version: "1.1.0",
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
  leaguePropagation: { share: 0.3 }
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
  neutral: [1, 4, 6, 7, 9, 22, 806, 21, 913, 19, 23, 24, 25, 28, 535, 804, 805, 807, 849, 859, 860, 1008, 15, 1168, 1186]
};

/**
 * Dasselbe für Teamnamen: Frauenligen heißen nicht immer so („Damallsvenskan"), ihre Teams bei
 * API-Football aber fast immer „Häcken W", „Arsenal W" oder „Bayern Munich U19". Zweite
 * Mannschaften („Borussia Dortmund II", „Jong Ajax") bleiben drin - sie spielen im Männerbetrieb.
 */
export const ELO_EXCLUDE_TEAM_PATTERN = /(\s(W|U-?\d{2})$|\b(women|ladies|femen[ií]n?[oa]?|feminino|femminile|frauen)\b)/i;

/**
 * Frauen-, Jugend-, Reserve- und Olympia-Wettbewerbe. Ihre Teams spielen nie gegen die
 * Männer-Teams und bildeten eigene Inseln bei 1500, die die Rangliste verfälschen.
 */
export const ELO_EXCLUDE_PATTERN =
  /\b(women|woman|femenin[oa]?|feminine|frauen|dames|w[- ]league|u-?1\d|u-?2\d|youth|junior|juvenil|reserves?|primavera|development|academy|premier league 2|olympics?|pre-olympic|games|viareggio|revello|elite league|kings world cup)\b/i;
