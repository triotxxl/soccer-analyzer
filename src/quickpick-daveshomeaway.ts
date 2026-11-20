import type { DashboardFixture } from "./dashboard.ts";
import {
  counterOddsOf,
  oneXTwoMarket,
  type QuickpickEvaluation,
  type QuickpickLevel,
  type QuickpickMeasurement,
  type QuickpickPreset,
  type QuickpickRejection
} from "./quickpick-core.ts";
import type { RecentMatchSummary } from "./types.ts";

/**
 * Voreinstellung „Daves Home/Away-Filter" (Davids Auftrag vom 20.11.2026): Spiele, in denen in den letzten 5
 * direkten Duellen **jedes Mal der Spielort gewonnen hat** - die Mannschaft, die in jenem Duell zu Hause spielte,
 * egal welcher Verein. Dann Tipp 1 für das heutige Spiel. Hat in allen 5 jeweils der Gast gewonnen: Tipp 2.
 * Quote ab 1,30 (Davids Wahl). Davids Antwort auf die Rückfrage vom selben Tag: „Spielort gewinnt“, nicht „das
 * heutige Heimteam hat alle Duelle gewonnen“.
 *
 * Duelle aus `h2h.history` (bis 10, ab schemaVersion 11), sonst `h2h.matches` (5). **Testspiele zählen nicht**
 * (`friendly === true`): Auf neutralem Platz oder mit B-Elf sagt der Spielort nichts - und `h2hSummary` filtert
 * sie nicht. In Snapshots mit nur fünf Duellen fehlt dann oft das fünfte Pflichtspiel; das Spiel ist dann nicht
 * prüfbar (`keineDuelle`), statt mit vier Duellen zu bestehen. Ein Remis bricht das Muster. Duelle auf neutralem
 * Platz (Pokalfinale) erkennt der Snapshot nicht; dort steht als Heimteam, wen API-Football so führt.
 *
 * **Vorabmessung des Prüfers (20.11.2026, 0 Aufrufe, Duelle aus dem Cache nachgebaut, 141 Tipps der Vorgabe):**
 * Treffer 48,9 % gegen fair 40,3 %, Treffer − fair +8,7 ± 4,0 (je Anstoßtag ± 4,6), Ertrag +11,5 ± 11,1 %. Das Plus
 * steht fast ganz im September (1. Hälfte +14,7 ± 5,8, 2. Hälfte +2,8 ± 5,6; Regression b(Muster) 0,38 ± 0,18,
 * 2. Hälfte 0,12 ± 0,25). Das Muster kommt nicht öfter vor als p_heim^5 (133 beobachtet, 147-163 erwartet). Locker
 * und Weit liegen bei Treffer − fair +3,0 bzw. +1,1 und klar im Minus. **Kein Beleg** - Nachmessung vorab festgelegt:
 * nur neue Tipps der Vorgabe ab 20.11.2026, bei 150 Tipps bestanden, wenn Treffer − fair (je Anstoßtag gebündelt)
 * über 2 Standardfehlern liegt; sonst „kein Vorteil“ in die Texte.
 *
 * Knopfwerte aus `npm run quickpick-report -- --preset davesHomeAway` an der gebauten Regel (136 Tipps statt 141:
 * alte Snapshots tragen nur fünf Duelle; vor schemaVersion 6 ohne Testspiel-Kennung, dort zählen sie mit). Ältere
 * Snapshots aus dem Cache nachzubauen (`tools/snapshot-history.ts`) hat der Prüfer vorgeschlagen, ist offen.
 */

export interface DavesHomeAwayQuickpickSettings {
  preset: "davesHomeAway";
  /** Quote der getippten Seite ab - Davids Vorgabe 1,30, Identität. */
  minOdds: number;
  /** Obergrenze. 99 heißt: kein Deckel. */
  maxOdds: number;
  /** Wie viele der letzten Pflichtspiel-Duelle zählen. */
  duels: number;
  /** Wie viele davon der Spielort (bzw. der Gast) gewonnen haben muss - Davids Regel: alle. */
  minWins: number;
  /** Bei `minWins < duels`: Darf ein Rest-Duell auch die andere Seite gewonnen haben, oder nur Remis? */
  allowOppositeWin: boolean;
  /** Das älteste der gezählten Duelle höchstens so viele Jahre vor dem Anstoß. 99 heißt: egal. */
  maxAgeYears: number;
  /** Testspiele aus den Duellen nehmen. */
  excludeFriendlies: boolean;
}

export type DavesHomeAwayLevelValues =
  Pick<DavesHomeAwayQuickpickSettings, "minWins" | "allowOppositeWin" | "maxAgeYears" | "maxOdds">;

const LEVELS: Record<"streng" | "ausgewogen" | "locker" | "weit", DavesHomeAwayLevelValues> = {
  streng: { minWins: 5, allowOppositeWin: false, maxAgeYears: 4, maxOdds: 3 },
  ausgewogen: { minWins: 5, allowOppositeWin: false, maxAgeYears: 99, maxOdds: 99 },
  locker: { minWins: 4, allowOppositeWin: false, maxAgeYears: 99, maxOdds: 99 },
  weit: { minWins: 4, allowOppositeWin: true, maxAgeYears: 99, maxOdds: 99 }
};

export interface DavesHomeAwayDetail {
  /** `heim`: in den Duellen gewann jeweils die Heimmannschaft; `gast`: jeweils der Gast. */
  pattern: "heim" | "gast";
  /** Siege des Spielorts bzw. des Gasts in den gezählten Duellen. */
  wins: number;
  /** Die gezählten Duelle, neueste zuerst. */
  duels: RecentMatchSummary[];
  /** Datum des ältesten gezählten Duells. */
  oldest: string;
  oddsSource: "snapshot" | "geschätzt";
}

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** Die gezählten Duelle: Pflichtspiele (wenn gewünscht), neueste zuerst, höchstens `settings.duels`. */
export function homeAwayDuels(fixture: DashboardFixture, settings: DavesHomeAwayQuickpickSettings): RecentMatchSummary[] {
  const source = fixture.h2h?.history?.length ? fixture.h2h.history : fixture.h2h?.matches ?? [];
  return source
    .filter((duel) => !(settings.excludeFriendlies && duel.friendly === true))
    .slice()
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, settings.duels);
}

/** Auf den Knöpfen steht die Trefferquote je Tipp - der Zweck sind Kombis. */
export function davesHomeAwayNote(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht geprüft";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  return `${proTag}/Tag · ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} % Treffer`;
}

export const DAVES_HOME_AWAY_LEVELS: Array<QuickpickLevel<DavesHomeAwayLevelValues>> = [
  {
    id: "streng", label: "Streng", measured: { n: 74, proTag: 0.8, trefferquote: 0.568, roi: 0.169 },
    hint: "Fünfmal gewann der Gastgeber (bzw. fünfmal der Gast), alle Duelle aus den letzten 4 Jahren, Quote 1,30"
      + " bis 3,00. Gut jeder zweite Tipp stimmte – bei nur 74 Tipps kann das auch Zufall sein.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen", measured: { n: 136, proTag: 1.4, trefferquote: 0.485, roi: 0.11 },
    hint: "Daves Regel: In den letzten 5 Pflichtspielen gegeneinander gewann jedes Mal der Gastgeber (bzw. jedes"
      + " Mal der Gast). Quote ab 1,30. Knapp jeder zweite Tipp stimmte, das Plus kam fast nur aus dem September.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker", measured: { n: 579, proTag: 6.1, trefferquote: 0.416, roi: -0.065 },
    hint: "4 Siege des Gastgebers und ein Unentschieden – die andere Seite gewann nie. Mehr Spiele, gut 4 von 10"
      + " Tipps stimmten, unterm Strich ein Verlust.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit", measured: { n: 1097, proTag: 11.5, trefferquote: 0.399, roi: -0.102 },
    hint: "4 von 5 Duellen gewann der Gastgeber, das fünfte ging beliebig aus. Nur zum Überblick: rund 4 von 10"
      + " Tipps stimmten, unterm Strich ein Verlust.",
    values: LEVELS.weit
  }
];

export const DEFAULT_DAVES_HOME_AWAY_SETTINGS: DavesHomeAwayQuickpickSettings = {
  preset: "davesHomeAway", minOdds: 1.3, duels: 5, excludeFriendlies: true, ...LEVELS.ausgewogen
};

/** Prüft eine Partie gegen die Torfolge; es gewinnt das erste greifende Tor. */
export function evaluateDavesHomeAway(
  fixture: DashboardFixture,
  settings: DavesHomeAwayQuickpickSettings
): QuickpickEvaluation {
  const market = oneXTwoMarket(fixture);
  const base = {
    fixtureId: fixture.fixtureId,
    market: "1x2" as const,
    selection: "",
    side: null as "1" | "2" | null,
    venueSide: null,
    pick: market?.pick ?? null,
    homePercent: 0,
    awayPercent: 0,
    venueScope: fixture.form.scope,
    points: fixture.scores.favorite,
    odds: null as number | null,
    dominance: null,
    superiority: null,
    davesHomeAway: null as DavesHomeAwayDetail | null
  };
  const reject = (rejectedBy: QuickpickRejection, extra: Partial<typeof base> = {}): QuickpickEvaluation =>
    ({ ...base, ...extra, passes: false, rejectedBy });

  const duels = homeAwayDuels(fixture, settings);
  if (duels.length < settings.duels) return reject("keineDuelle");
  const oldest = duels.at(-1)!.date;
  if (settings.maxAgeYears < 99 && Date.parse(fixture.kickoff) - Date.parse(oldest) > settings.maxAgeYears * YEAR_MS) {
    return reject("h2hAlt");
  }

  const homeWins = duels.filter((duel) => duel.homeGoals > duel.awayGoals).length;
  const awayWins = duels.filter((duel) => duel.awayGoals > duel.homeGoals).length;
  const holds = (wins: number, other: number) => wins >= settings.minWins && (settings.allowOppositeWin || other === 0);
  const side: "1" | "2" | null = holds(homeWins, awayWins) ? "1" : holds(awayWins, homeWins) ? "2" : null;
  if (side === null) return reject("h2hSpielort");

  // Der Preis der getippten Seite, wie bei „Daves Table-Filter“: gespeichert, wo der Lauf ihn führt; sonst nur für
  // die Gegenseite des Tipps geschätzt (`counterOddsOf`), dann „≈“ und nicht für den Wettschein.
  const stored = market ? (side === "1" ? market.oddsHome : market.oddsAway) : undefined;
  const preis = typeof stored === "number" && stored > 1 ? { odds: stored, source: "snapshot" as const }
    : market && market.pick === side && market.odds !== null && market.odds > 1 ? { odds: market.odds, source: "snapshot" as const }
      : market && market.pick !== null && market.pick !== side ? counterOddsOf(fixture, market) : null;
  const detail: DavesHomeAwayDetail = {
    pattern: side === "1" ? "heim" : "gast",
    wins: side === "1" ? homeWins : awayWins,
    duels,
    oldest,
    oddsSource: preis?.source ?? "snapshot"
  };
  const chosen = {
    side,
    selection: side === "1" ? `Heimsieg ${fixture.homeTeam}` : `Auswärtssieg ${fixture.awayTeam}`,
    odds: preis?.odds ?? null,
    davesHomeAway: detail
  };
  if (preis === null || preis.odds <= 1) return reject("keineQuote", chosen);
  if (preis.odds < settings.minOdds || preis.odds > settings.maxOdds) return reject("quote", chosen);
  return { ...base, ...chosen, passes: true, rejectedBy: null };
}

export const DAVES_HOME_AWAY_PRESET: QuickpickPreset<DavesHomeAwayQuickpickSettings> = {
  id: "davesHomeAway",
  label: "Daves Home/Away-Filter",
  group: "daves",
  description: "Spiele, in denen in den letzten 5 direkten Duellen jedes Mal die Heimmannschaft gewonnen hat –"
    + " oder jedes Mal der Gast. Getippt wird, dass es heute wieder so kommt.",
  criteria: [
    "Die letzten 5 direkten Duelle (H2H) ohne Testspiele",
    "Jedes Mal gewann die Mannschaft, die zu Hause spielte – egal welche → Tipp 1",
    "Oder jedes Mal gewann der Gast → Tipp 2; ein Unentschieden unterbricht die Serie",
    "Quote auf den Tipp ab 1,30"
  ],
  massstab: "trefferquote",
  kennzahlOf: (measured) => ({
    label: "Treffer je Tipp",
    wert: measured === null ? "–" : `${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht geprüft" : `an ${measured.n} alten Wetten geprüft`,
    titel: measured === null
      ? "Diese Stufe wurde noch nicht an alten Spielen geprüft."
      : `So oft kam der Tipp wirklich: ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`
        + ` (an ${measured.n} alten Wetten geprüft). In einer Kombi müssen alle Tipps stimmen.`
  }),
  honesty: "In den alten Spielen gewann die getippte Mannschaft etwas öfter, als die Quote sagte – aber fast nur im"
    + " September; ab Mitte Oktober lag es wieder bei der Quote. Fünf Heimsiege in Folge zwischen zwei Mannschaften"
    + " kommen auch durch reinen Zufall etwa so oft vor, wie wir sie gefunden haben. Viele Tipps sind keine Favoriten,"
    + " in einer Kombi stimmt deshalb selten alles. Rechne nicht mit Gewinn.",
  warnung: "Kommt selten vor, und das Plus der ersten Wochen hat sich danach nicht wiederholt – das kann auch Zufall"
    + " sein. Rechne nicht mit Gewinn.",
  wettschein: {
    hinweis: "Legt jedes gefundene Spiel als Heim- bzw. Auswärtssieg in den Wettschein. Spiele mit geschätzter"
      + " Quote (≈) bleiben draußen."
  },
  leerSatz: "In keinem Spiel hat in den letzten 5 direkten Duellen immer die Heimmannschaft oder immer der Gast gewonnen.",
  defaults: DEFAULT_DAVES_HOME_AWAY_SETTINGS,
  levels: DAVES_HOME_AWAY_LEVELS,
  defaultSort: "kickoff",
  evaluate: (fixture, settings) => evaluateDavesHomeAway(fixture, settings),
  noteOf: davesHomeAwayNote
};
