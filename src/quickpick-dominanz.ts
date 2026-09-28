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
 * oben.** Stand 28.09.2026, mit neu gerechneten Tabellen der Läufe bis 03.09. (siehe
 * `tools/snapshot-history.ts`): Streng -16,1 ± 9,0 %, Ausgewogen -15,0 ± 8,3 %, Locker
 * -11,5 ± 5,6 %, Weit -11,0 ± 2,6 %. Die Vorabmessung ist ein anderer Schätzer: Sie las das Quotenband aus
 * dem archivierten Tipico-Tripel, die Regel liest es aus dem Snapshot des Laufs, und beide
 * decken sich nur in rund 89 % der Fälle. Dadurch fallen andere Partien ins Band. Die Stufen
 * sind untereinander nicht trennbar, und -4,1 % aus der Vorabmessung liegt innerhalb der
 * Streuung von Streng. Verbindlich ist, was der Report an der gebauten Regel misst, nicht die
 * Vorabmessung.
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
  if (measured === null) return "noch nicht geprüft";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  const roi = `${measured.roi >= 0 ? "+" : "−"}${Math.abs(measured.roi * 100).toFixed(1).replace(".", ",")}`;
  return `${proTag}/Tag · ${roi} % Gewinn`;
}

export const DOMINANZ_LEVELS: Array<QuickpickLevel<DominanzLevelValues>> = [
  {
    id: "streng", label: "Streng",
    measured: {
      n: 127, proTag: 3.2, trefferquote: 0.409, roi: -0.161,
      kombis: [
        { beine: 2, n: 2280, trefferquote: 0.152, quote: 4.21, roi: -0.373, erwartung: -0.296 },
        { beine: 3, n: 1440, trefferquote: 0.059, quote: 8.67, roi: -0.525, erwartung: -0.41 },
        { beine: 4, n: 920, trefferquote: 0.021, quote: 17.63, roi: -0.658, erwartung: -0.505 },
        { beine: 5, n: 720, trefferquote: 0.021, quote: 35.93, roi: -0.282, erwartung: -0.585 },
        { beine: 6, n: 520, trefferquote: 0.006, quote: 74.28, roi: -0.619, erwartung: -0.652 },
        { beine: 7, n: 440, trefferquote: 0.005, quote: 152.77, roi: -0.347, erwartung: -0.708 }
      ]
    },
    hint: "Nur Spiele, bei denen auch das Modell dieselbe Mannschaft tippt, Quote 1,80 bis"
      + " 2,50. Nicht erkennbar besser als die Vorgabe – nur die kürzeste Liste.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 187, proTag: 4.7, trefferquote: 0.374, roi: -0.15,
      kombis: [
        { beine: 2, n: 3520, trefferquote: 0.135, quote: 5.38, roi: -0.303, erwartung: -0.277 },
        { beine: 3, n: 2200, trefferquote: 0.055, quote: 12.5, roi: -0.365, erwartung: -0.385 },
        { beine: 4, n: 1520, trefferquote: 0.021, quote: 28.58, roi: -0.497, erwartung: -0.477 },
        { beine: 5, n: 1160, trefferquote: 0.004, quote: 65.26, roi: -0.807, erwartung: -0.555 },
        { beine: 6, n: 880, trefferquote: 0.008, quote: 157.59, roi: -0.021, erwartung: -0.622 },
        { beine: 7, n: 760, trefferquote: 0, quote: 355.32, roi: -1, erwartung: -0.678 }
      ]
    },
    hint: "Auch Spiele, bei denen das Modell anders tippt – die sind gekennzeichnet. Quote"
      + " bis 3,50. Gleich gut wie „Streng“, aber deutlich mehr Auswahl. Die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: {
      n: 347, proTag: 8.7, trefferquote: 0.455, roi: -0.115,
      kombis: [
        { beine: 2, n: 6760, trefferquote: 0.196, quote: 5, roi: -0.265, erwartung: -0.216 },
        { beine: 3, n: 4280, trefferquote: 0.089, quote: 11.61, roi: -0.339, erwartung: -0.306 },
        { beine: 4, n: 3200, trefferquote: 0.03, quote: 29.32, roi: -0.558, erwartung: -0.386 },
        { beine: 5, n: 2400, trefferquote: 0.02, quote: 67.11, roi: -0.48, erwartung: -0.456 },
        { beine: 6, n: 1920, trefferquote: 0.003, quote: 131.65, roi: -0.759, erwartung: -0.518 },
        { beine: 7, n: 1680, trefferquote: 0.003, quote: 322.75, roi: -0.745, erwartung: -0.574 }
      ]
    },
    hint: "Quote ab 1,50, nach oben offen. Mehr Auswahl und kürzere Quoten: Es stimmen mehr"
      + " Tipps, aber der Verlust bleibt gleich. Genau darum geht es bei diesem Filter.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: {
      n: 1980, proTag: 49.3, trefferquote: 0.417, roi: -0.11,
      kombis: [
        { beine: 2, n: 39400, trefferquote: 0.174, quote: 5.9, roi: -0.205, erwartung: -0.207 },
        { beine: 3, n: 26080, trefferquote: 0.074, quote: 14.44, roi: -0.278, erwartung: -0.294 },
        { beine: 4, n: 19480, trefferquote: 0.03, quote: 35.69, roi: -0.384, erwartung: -0.372 },
        { beine: 5, n: 15520, trefferquote: 0.013, quote: 89.41, roi: -0.418, erwartung: -0.441 },
        { beine: 6, n: 12880, trefferquote: 0.006, quote: 217.98, roi: -0.506, erwartung: -0.502 },
        { beine: 7, n: 10960, trefferquote: 0.002, quote: 524.39, roi: -0.637, erwartung: -0.557 }
      ]
    },
    hint: "Ohne Bedingung an die direkten Duelle: rund 49 statt 5 Spiele am Tag, bei gleichem"
      + " Verlust. Nur zum Überblick, nicht zum Spielen.",
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
    if (side === pick) {
      // Die gestützte Seite ist der Modelltipp. Hat sie keinen eigenen Preis (Tipico führte
      // dort 0), gibt es keinen: `counterOddsOf` liefert den Preis der Seite GEGENÜBER dem Tipp,
      // also den des Gegners. So ging Chelsea W zu 23,00 als Treffer in die Rückrechnung ein
      // (Prüfung vom 28.09.2026) und wäre mit diesem Preis im Wettschein gelandet.
      return market.odds !== null && market.odds > 1 ? { odds: market.odds, source: "snapshot" as const } : null;
    }
    const counter = counterOddsOf(fixture, market);
    return counter === null ? null : { odds: counter.odds, source: counter.source };
  })();

  const base = {
    fixtureId: fixture.fixtureId,
    // Diese Voreinstellung stützt eine Seite des 1X2-Marktes. Markt und Auswahl stehen
    // ausdrücklich dabei, damit Wettschein und Rückrechnung keine Seite voraussetzen müssen.
    market: "1x2" as const,
    selection: side === null ? ""
      : side === "1" ? `Heimsieg ${fixture.homeTeam}` : `Auswärtssieg ${fixture.awayTeam}`,
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
  group: "daves",
  description: "Eine Mannschaft, die die letzten direkten Duelle gewonnen hat, in der Tabelle"
    + " klar vorn steht und seltener verliert als der Gegner – und für die es trotzdem 1,80"
    + " oder mehr gibt. Gedacht für kurze Kombis.",
  criteria: [
    "Direkte Duelle (H2H): mindestens zwei Siege in Folge",
    "Tabelle: Vorsprung bei Punkten je Spiel und beim Platz",
    "Verliert über die Saison deutlich seltener als der Gegner",
    "Quote ab 1,80 – gedacht für Kombis. Je mehr Spiele in der Kombi, desto größer der Verlust",
    "Die letzten fünf Spiele sind hier bewusst keine Bedingung, sie werden nur angezeigt"
  ],
  massstab: "roi",
  kennzahlOf: (measured) => ({
    label: "Gewinn je Tipp",
    wert: measured === null ? "–"
      : `${measured.roi >= 0 ? "+" : "−"}${Math.abs(measured.roi * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht geprüft" : `an ${measured.n} alten Wetten geprüft`,
    titel: measured === null
      ? "Diese Stufe wurde noch nicht an alten Spielen geprüft."
      : `Was ein einzelner Tipp im Schnitt einbringt, bei gleichem Einsatz auf jedes Spiel.`
        + ` ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} % der Tipps stimmten`
        + ` (an ${measured.n} alten Wetten geprüft). Hier zählt der Gewinn und nicht die`
        + ` Trefferquote, weil bei diesem Filter beides auseinanderläuft.`
  }),
  honesty: "Dieser Filter findet den Sieger gut – aber der Buchmacher weiß das auch und"
    + " rechnet es in die Quote ein. Auf jeder Stufe verlierst du damit auf Dauer zehn bis"
    + " fünfzehn Prozent. Hohe Quoten und gute Begründungen: ja. Gewinn: nein.",
  wettschein: {
    hinweis: "Legt jedes gefundene Spiel mit der Quote der stärkeren Mannschaft in den"
      + " Wettschein. Schau vorher in die Kombi-Tabelle, was daraus wird."
  },
  leerSatz: "Kein Spiel zeigt eine so klar überlegene Mannschaft zu diesem Preis.",
  defaults: DEFAULT_DOMINANZ_SETTINGS,
  levels: DOMINANZ_LEVELS,
  defaultSort: "serie",
  evaluate: (fixture, settings) => evaluateDominanz(fixture, settings),
  noteOf: dominanzNote
};
