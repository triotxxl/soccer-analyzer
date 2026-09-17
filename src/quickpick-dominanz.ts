import type { DashboardFixture } from "./dashboard.ts";
import {
  counterOddsOf,
  h2hDominance,
  oneXTwoMarket,
  superiorityOf,
  venueFormPercent,
  type QuickpickEvaluation,
  type QuickpickLevel,
  type QuickpickMeasurement,
  type QuickpickPreset,
  type QuickpickRejection,
  type QuickpickSuperiority
} from "./quickpick-core.ts";

/**
 * Voreinstellung „Dominanz zum Kombipreis": Eine Mannschaft, die die letzten direkten Duelle
 * gewann, in der Tabelle klar vorn steht und die bessere Siege-plus-Remis-Bilanz hat - und die
 * trotzdem mit 1,80 oder mehr bezahlt wird, damit sich daraus kurze Kombis bauen lassen.
 *
 * **Die „Form" ist hier die Saisonbilanz aus der Ligatabelle, nicht die letzten fünf Spiele am
 * Ort.** Das ist der Kern des Entwurfs und war der Fehler der Vorgängerversion: Die auswärts
 * spielende Seite steht in der Venue-Form strukturell schlechter da. Beide Partien, die diese
 * Voreinstellung finden soll, scheitern an einem Venue-Formvergleich:
 *
 * - Nacional Potosí – Always Ready: Venue-Form 80 % gegen 66,7 %, aber Tabelle 7. gegen 2.,
 *   Siege+Remis 57,9 % gegen 94,7 %, und Always Ready gewann alle fünf Duelle.
 * - Once Caldas – Deportes Tolima: Venue-Form 60 % gegen 40 %, aber Tabelle 12. gegen 3. und
 *   Tolima gewann vier der letzten fünf Duelle.
 *
 * Die Venue-Form bleibt deshalb eine **Spalte** und ist bewusst kein Tor.
 *
 * **Rückrechnung über 56 archivierte Läufe, 5.754 Kandidatenseiten mit Tabelle und echtem
 * Tipico-Quotentripel.** Kern = +0,3 Punkte je Spiel, +3 Plätze, +10 PP Siege+Remis:
 *
 * - Kern, Quote 1,0-1,5: **73,8 % Treffer** (gegen 37,2 % ohne jeden Filter), ROI -3,2 %
 * - Kern, Quote 1,5-1,8: 57,5 %, ROI -6,8 %
 * - Kern, Quote ab 3,0: 17,3 %, ROI -42,0 %
 * - Kern + Serie >= 2 + Modellseite, Quote 1,8-2,5: 48,2 % über 85 Wetten, **ROI -4,1 %**
 * - dieselbe Zelle **ohne** die Serie: -7,8 % - die Serie trägt also rund vier Punkte
 * - dieselbe Zelle mit **beiden Seiten**: 42,1 %, -9,3 %; **nur gegen** das Modell: -24,4 %
 *
 * Zwei Lesarten daraus, und beide gehören in jede Aussage über diese Voreinstellung:
 * **Die Kriterien sagen den Sieger gut vorher - aber der Markt preist das ein.** Die
 * Trefferquote folgt der Quote fast exakt. Und: **Es gibt keine Fassung über null.**
 *
 * **Was die gebaute Regel misst, steht auf den Stufen - und es ist schlechter als die Zellen
 * oben.** Streng -11,7 %, Ausgewogen -11,4 %, Locker -10,6 %, Weit -12,1 %. Die Vorabmessung
 * ist ein anderer Schätzer: Sie las das Quotenband aus dem archivierten Tipico-Tripel, die
 * Regel liest es aus dem Snapshot des Laufs, und beide decken sich nur in 83,6 % der Fälle.
 * Dadurch fallen andere Partien ins Band. Die Streuung beträgt je Stufe rund zehn Punkte,
 * -4,1 % und -11,7 % liegen also innerhalb einer Standardabweichung - trennbar sind die
 * beiden Zahlen nicht, und die Stufen sind untereinander ebenso wenig trennbar. Verbindlich
 * ist, was der Report an der gebauten Regel misst, nicht die Vorabmessung.
 */

export interface DominanzQuickpickSettings {
  preset: "dominanz";
  /** Untergrenze des Quotenbands der gestützten Seite. */
  minOdds: number;
  /** Obergrenze. 99 heißt: kein Deckel. */
  maxOdds: number;
  /** Vorsprung in Punkten je Spiel aus der Ligatabelle. */
  minPointsPerGame: number;
  /** Vorsprung in Tabellenplätzen. */
  minPositionGap: number;
  /** Vorsprung im Anteil der Spiele ohne Niederlage, in Prozentpunkten. */
  minNonLossGap: number;
  /** Gewonnene direkte Duelle in Folge. 0 schaltet das Tor ab. */
  minStreak: number;
  /** Nur Partien, in denen auch das Modell diese Seite tippt. */
  requireModelSide: boolean;
}

/**
 * Was eine Strengestufe setzt. Die drei Kerntore stehen bewusst **nicht** darin: Sie sind die
 * Identität dieser Voreinstellung und lockern nie - dieselbe Haltung wie bei `minPoints` in
 * „Daves 1x2-Filter".
 */
export type DominanzLevelValues = Pick<DominanzQuickpickSettings,
  "minOdds" | "maxOdds" | "minStreak" | "requireModelSide">;

const LEVELS: Record<"streng" | "ausgewogen" | "locker" | "weit", DominanzLevelValues> = {
  streng: { minOdds: 1.8, maxOdds: 2.5, minStreak: 2, requireModelSide: true },
  ausgewogen: { minOdds: 1.8, maxOdds: 3.5, minStreak: 2, requireModelSide: false },
  locker: { minOdds: 1.5, maxOdds: 99, minStreak: 2, requireModelSide: false },
  weit: { minOdds: 1.5, maxOdds: 99, minStreak: 0, requireModelSide: false }
};

/**
 * Auf den Knöpfen steht der **Ertrag je Bein**, nicht die Trefferquote. Grund: Die
 * Trefferquote folgt hier fast exakt der Quote - 73,8 % zu 1,32 sind je Bein nicht besser als
 * 48,2 % zu 2,00. Eine Trefferquote auf dem Knopf würde die kurzen Quoten schmeichelhaft
 * aussehen lassen. Und für eine Kombi ist ohnehin der Ertrag je Bein die Größe, die sich
 * multipliziert.
 */
export function dominanzNote(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht zurückgerechnet";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  const roi = `${measured.roi >= 0 ? "+" : "−"}${Math.abs(measured.roi * 100).toFixed(1).replace(".", ",")}`;
  return `${proTag}/Tag · ${roi} % ROI`;
}

export const DOMINANZ_LEVELS: Array<QuickpickLevel<DominanzLevelValues>> = [
  {
    id: "streng", label: "Streng",
    measured: {
      n: 95, proTag: 3.4, trefferquote: 0.442, roi: -0.117,
      kombis: [
        { beine: 2, n: 1680, trefferquote: 0.175, quote: 4.05, roi: -0.311, erwartung: -0.221 },
        { beine: 3, n: 1040, trefferquote: 0.064, quote: 8.11, roi: -0.525, erwartung: -0.312 },
        { beine: 4, n: 720, trefferquote: 0.026, quote: 16.41, roi: -0.631, erwartung: -0.393 },
        { beine: 5, n: 520, trefferquote: 0.01, quote: 33.2, roi: -0.709, erwartung: -0.464 },
        { beine: 6, n: 400, trefferquote: 0.015, quote: 64.64, roi: -0.143, erwartung: -0.527 },
        { beine: 7, n: 360, trefferquote: 0, quote: 130.28, roi: -1, erwartung: -0.583 }
      ]
    },
    hint: "Nur Partien, in denen auch das Modell die dominante Seite tippt, Quote 1,80 bis 2,50."
      + " Zurückgerechnet 44,2 % Treffer über 95 Wetten bei -11,7 % Ertrag je Bein. Die"
      + " Streuung ist mit gut zehn Punkten so breit, dass diese Stufe nicht messbar besser"
      + " ist als die Vorgabe - sie ist nur die kleinste Liste.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 139, proTag: 5, trefferquote: 0.403, roi: -0.114,
      kombis: [
        { beine: 2, n: 2640, trefferquote: 0.162, quote: 5.22, roi: -0.211, erwartung: -0.215 },
        { beine: 3, n: 1600, trefferquote: 0.064, quote: 11.86, roi: -0.345, erwartung: -0.305 },
        { beine: 4, n: 1120, trefferquote: 0.025, quote: 27.4, roi: -0.486, erwartung: -0.384 },
        { beine: 5, n: 920, trefferquote: 0.009, quote: 60.53, roi: -0.601, erwartung: -0.454 },
        { beine: 6, n: 680, trefferquote: 0.003, quote: 140.5, roi: -0.74, erwartung: -0.516 },
        { beine: 7, n: 600, trefferquote: 0, quote: 321.88, roi: -1, erwartung: -0.572 }
      ]
    },
    hint: "Auch Partien gegen den Modelltipp, markiert mit einem Abzeichen, Quote bis 3,50."
      + " 40,3 % über 139 Wetten bei -11,4 % Ertrag je Bein - derselbe gemessene Ertrag wie"
      + " „Streng“ bei knapp anderthalbmal so vielen Partien. Die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: {
      n: 271, proTag: 9.4, trefferquote: 0.472, roi: -0.106,
      kombis: [
        { beine: 2, n: 5280, trefferquote: 0.219, quote: 5.07, roi: -0.216, erwartung: -0.2 },
        { beine: 3, n: 3320, trefferquote: 0.095, quote: 11.95, roi: -0.385, erwartung: -0.285 },
        { beine: 4, n: 2480, trefferquote: 0.043, quote: 29.65, roi: -0.503, erwartung: -0.36 },
        { beine: 5, n: 1920, trefferquote: 0.024, quote: 60.07, roi: -0.548, erwartung: -0.428 },
        { beine: 6, n: 1520, trefferquote: 0.004, quote: 137.01, roi: -0.847, erwartung: -0.488 },
        { beine: 7, n: 1320, trefferquote: 0.002, quote: 397.42, roi: -0.868, erwartung: -0.542 }
      ]
    },
    hint: "Quote ab 1,50 und ohne Deckel. Mehr Auswahl und kürzere Quoten: 47,2 % über 271"
      + " Wetten bei -10,6 %. Die Trefferquote steigt mit dem kürzeren Band, der Ertrag je"
      + " Bein bleibt liegen - genau das Muster, das der ganzen Voreinstellung zugrunde liegt.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: {
      n: 1153, proTag: 40.1, trefferquote: 0.427, roi: -0.121,
      kombis: [
        { beine: 2, n: 22880, trefferquote: 0.183, quote: 5.38, roi: -0.228, erwartung: -0.227 },
        { beine: 3, n: 15200, trefferquote: 0.079, quote: 12.5, roi: -0.302, erwartung: -0.32 },
        { beine: 4, n: 11280, trefferquote: 0.033, quote: 29.35, roi: -0.424, erwartung: -0.402 },
        { beine: 5, n: 9000, trefferquote: 0.015, quote: 72.39, roi: -0.458, erwartung: -0.474 },
        { beine: 6, n: 7480, trefferquote: 0.007, quote: 179.22, roi: -0.444, erwartung: -0.538 },
        { beine: 7, n: 6360, trefferquote: 0.003, quote: 403.36, roi: -0.587, erwartung: -0.594 }
      ]
    },
    hint: "Ohne das Tor über die direkten Duelle: 40,1 Partien am Tag statt 5, 42,7 % über"
      + " 1.153 Wetten bei -12,1 %. Die Serie trennt hier also nur noch 0,7 Punkte, und diese"
      + " Stufe taugt vor allem zum Überblick, nicht zum Spielen.",
    values: LEVELS.weit
  }
];

export const DEFAULT_DOMINANZ_SETTINGS: DominanzQuickpickSettings = {
  preset: "dominanz",
  // Die Kerntore: gesetzt, nicht gestaffelt.
  minPointsPerGame: 0.3,
  minPositionGap: 3,
  minNonLossGap: 10,
  ...LEVELS.ausgewogen
};

/** Der Vorsprung einer Seite, oder `null`, wenn die Partie keine Tabelle führt. */
function seitenVorsprung(fixture: DashboardFixture, side: "1" | "2"): QuickpickSuperiority | null {
  return superiorityOf(fixture, side);
}

/**
 * Prüft eine Partie gegen die Torfolge. Die Reihenfolge der Tore ist die Reihenfolge der
 * Abweisungsgründe: Es gewinnt das erste greifende, damit jede Partie genau einmal zählt.
 *
 * Die gestützte Seite ergibt sich aus den Kriterien, nicht aus dem Modelltipp: Tabellen- und
 * Serienvorsprung sind antisymmetrisch, es kann also höchstens eine Seite bestehen.
 */
export function evaluateDominanz(
  fixture: DashboardFixture,
  settings: DominanzQuickpickSettings
): QuickpickEvaluation {
  const market = oneXTwoMarket(fixture);
  const pick = market?.pick ?? null;
  const homePercent = venueFormPercent(fixture.form.home);
  const awayPercent = venueFormPercent(fixture.form.away);

  const heim = seitenVorsprung(fixture, "1");
  const gast = seitenVorsprung(fixture, "2");
  // Wer in Punkten je Spiel und in der Tabelle vorn liegt, ist der Kandidat. Beides zugleich
  // kann nur eine Seite erfüllen.
  const kandidat: "1" | "2" | null =
    heim && heim.pointsPerGame >= settings.minPointsPerGame && heim.positionGap >= settings.minPositionGap ? "1"
    : gast && gast.pointsPerGame >= settings.minPointsPerGame && gast.positionGap >= settings.minPositionGap ? "2"
    : null;
  const side = kandidat;
  const superiority = side === null ? heim : side === "1" ? heim : gast;
  const dominance = side === null ? null : h2hDominance(fixture.h2h.outcomes, side);

  /** Der Preis der gestützten Seite: aus dem Lauf, sonst aus Tipp- und Remisquote gerechnet. */
  const preis = (() => {
    if (market === undefined || side === null) return null;
    const gespeichert = side === "1" ? market.oddsHome : market.oddsAway;
    if (typeof gespeichert === "number" && gespeichert > 1) {
      return { odds: gespeichert, source: "snapshot" as const };
    }
    if (side === pick && market.odds !== null && market.odds > 1) {
      return { odds: market.odds, source: "snapshot" as const };
    }
    const counter = counterOddsOf(fixture, market);
    return counter === null ? null : { odds: counter.odds, source: counter.source };
  })();

  const base = {
    fixtureId: fixture.fixtureId,
    side,
    venueSide: null,
    pick,
    homePercent,
    awayPercent,
    venueScope: fixture.form.scope,
    points: fixture.scores.favorite,
    odds: preis?.odds ?? null,
    dominance,
    superiority,
    dominanz: {
      streak: dominance?.streakFor ?? 0,
      nonLossGap: superiority?.nonLossGap ?? 0,
      modelAgrees: side !== null && side === pick,
      oddsSource: preis?.source ?? "snapshot"
    }
  };

  const reject = (rejectedBy: QuickpickRejection): QuickpickEvaluation =>
    ({ ...base, passes: false, rejectedBy });

  if (market === undefined || pick === null) return reject("keinTipp");
  // Ohne Tabelle ist Überlegenheit nicht prüfbar - das trifft jede Cross-League-Partie.
  if (heim === null || gast === null) return reject("keineTabelle");
  if (side === null || superiority === null) return reject("tabelle");
  if (superiority.nonLossGap < settings.minNonLossGap) return reject("bilanz");
  if (preis === null) return reject("keineQuote");
  if (preis.odds < settings.minOdds || preis.odds > settings.maxOdds) return reject("quote");
  if (settings.minStreak > 0) {
    if (dominance === null) return reject("keineDuelle");
    if (dominance.streakFor < settings.minStreak) return reject("serie");
  }
  if (settings.requireModelSide && side !== pick) return reject("modellDagegen");

  return { ...base, passes: true, rejectedBy: null };
}

export const DOMINANZ_PRESET: QuickpickPreset<DominanzQuickpickSettings> = {
  id: "dominanz",
  label: "Dominanz zum Kombipreis",
  description: "Eine Mannschaft, die die letzten direkten Duelle gewann, in der Tabelle klar"
    + " vorn steht und die bessere Siege-plus-Remis-Bilanz hat - und die trotzdem ab 1,80"
    + " bezahlt wird. Gedacht als Beine für kurze Kombis.",
  criteria: [
    "Direkte Duelle: mindestens zwei in Folge an die gestützte Seite",
    "Tabelle: Vorsprung bei Punkten je Spiel und bei den Plätzen",
    "Saisonbilanz: deutlich höherer Anteil an Spielen ohne Niederlage als beim Gegner",
    "Quote ab 1,80 – als Bein einer Kombi über fünf bis sieben Partien",
    "Die Form der letzten fünf Spiele ist hier bewusst kein Tor, nur Anzeige"
  ],
  massstab: "roi",
  kennzahlOf: (measured) => ({
    label: "Ertrag je Bein",
    wert: measured === null ? "–"
      : `${measured.roi >= 0 ? "+" : "−"}${Math.abs(measured.roi * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht zurückgerechnet" : `über ${measured.n} Wetten`,
    titel: measured === null
      ? "Für diese Stufe liegt noch keine Rückrechnung vor."
      : `Flacher Einsatz auf die gestützte Seite, gerechnet zum echten Tipico-Preis:`
        + ` ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} % Treffer über`
        + ` ${measured.n} Wetten. Eine Kombi multipliziert diesen Ertrag je Bein - deshalb`
        + ` steht er hier und nicht die Trefferquote.`
  }),
  honesty: "Die Kriterien sagen den Sieger gut vorher – im kurzen Quotenband treffen sie in"
    + " 73,8 % der Fälle gegenüber 37,2 % ohne jeden Filter. Aber der Markt preist das ein:"
    + " Die Trefferquote folgt der Quote fast exakt. Zurückgerechnet über die archivierten"
    + " Läufe verliert diese Voreinstellung auf jeder Stufe rund elf Prozent je Bein, und die"
    + " Stufen unterscheiden sich dabei weniger, als ihre Streuung breit ist. Eine Fünferkombi"
    + " aus der Vorgabestufe ging in 0,9 % der Fälle durch und gab im Erwartungswert 40 % des"
    + " Einsatzes zurück, eine Siebenerkombi in keinem von 600 Fällen. Diese Voreinstellung"
    + " liefert hohe Quoten und klare Begründungen – einen Ertrag liefert sie nicht.",
  wettschein: {
    hinweis: "Legt jeden Treffer mit der Quote der gestützten Seite in den Wettschein. Dort"
      + " lassen sich daraus kurze Kombis bauen – rechne vorher die Kombi-Tabelle durch."
  },
  leerSatz: "Keine Partie zeigt dieses Dominanzbild zum gewünschten Preis.",
  defaults: DEFAULT_DOMINANZ_SETTINGS,
  levels: DOMINANZ_LEVELS,
  defaultSort: "serie",
  evaluate: (fixture, settings) => evaluateDominanz(fixture, settings),
  noteOf: dominanzNote
};
