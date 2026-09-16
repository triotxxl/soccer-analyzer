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
  type QuickpickRejection
} from "./quickpick-core.ts";

/**
 * Voreinstellung „Underdog": Partien, in denen der Markt eine Mannschaft deutlich schlechter
 * einschätzt, obwohl Form und direkte Duelle für sie sprechen.
 *
 * **Das ist ein Sucher, keine Tippregel.** Die These wurde vor dem Bau über 4.397 abgerechnete
 * Partien (16.08.-15.09.2026) zurückgerechnet, gewettet zum echten Tipico-Preis des
 * Außenseiters:
 *
 * - jeder Außenseiter: 23,0 % Treffer, Quote Ø 4,60, ROI -14,1 %
 * - nur Formvorsprung ab 20 PP: 26,7 %, ROI -10,6 %
 * - nur H2H-Rate über null: 24,2 %, ROI -17,2 %
 * - beides zusammen: 25,9 % über 143 Wetten, ROI **-18,8 %**
 * - Kontrollgruppe ohne beides: 21,9 %, ROI -13,9 %
 *
 * Die Kriterien heben die Trefferquote also durchaus (21,9 -> 26 %), wählen dabei aber die
 * **kürzer bezahlten** Außenseiter aus: Der Preis fällt stärker, als die Trefferquote steigt.
 * **Keine Variante schlug das blinde Wetten auf Außenseiter.**
 *
 * Der einzige groß gemessene Effekt ist der Favorite-Longshot-Bias: Quoten über 4,00 liefern
 * -20,2 %, das Band 2,50-4,00 nur -9,8 %. Deshalb gibt es ein Quotenband - nicht als Vorteil,
 * sondern als das kleinere Übel.
 *
 * **Nicht eingebaut, obwohl es naheliegt:** Der Modellvorteil auf den Außenseiter
 * (Modellwahrscheinlichkeit gegen Marktwahrscheinlichkeit) zeigt gemessen in die *falsche*
 * Richtung - Zeilen mit „Value" liegen bei -13,9 %, Zeilen ohne bei -11,4 %. Er steht deshalb
 * als Spalte in der Anzeige und ist bewusst kein Tor.
 */

export interface UnderdogQuickpickSettings {
  preset: "underdog";
  /**
   * Wie viel teurer die gestützte Seite mindestens sein muss. Unter 25 % Abstand ist weder
   * von „deutlich schlechter eingeschätzt" die Rede, noch ist die aus Tipp- und Remisquote
   * rekonstruierte Seite sicher genug.
   */
  minPriceRatio: number;
  /** Quotenband des Außenseiters. Siehe Favorite-Longshot-Bias im Modulkopf. */
  minOdds: number;
  maxOdds: number;
  /** Formvorsprung des Außenseiters in Prozentpunkten. Stark negativ = Tor aus. */
  minFormGap: number;
  /** (Siege − Niederlagen)/Duelle aus Sicht des Außenseiters. Kleiner als −1 = Tor aus. */
  minH2hRate: number;
  /** Mindestzahl direkter Duelle. 0 = auch ohne Duelle. */
  minDuels: number;
  /** Tabellenplätze Vorsprung des Außenseiters. `null` = Tor aus. */
  minPositionGap: number | null;
  /** Nur Partien, in denen auch das Modell den Außenseiter tippt. Gemessen ohne Nutzen. */
  requireModelSide: boolean;
}

/** Werte, die eine Strengestufe setzt. Verhältnis und Modellseite bleiben unberührt. */
export type UnderdogLevelValues = Pick<UnderdogQuickpickSettings,
  "minOdds" | "maxOdds" | "minFormGap" | "minH2hRate" | "minDuels" | "minPositionGap">;

/** Weit offen: Ein Wert, den keine Form unterschreitet beziehungsweise keine Rate erreicht. */
const FORM_AUS = -100;
const H2H_AUS = -2;

const LEVELS: Record<"weit" | "locker" | "ausgewogen" | "streng", UnderdogLevelValues> = {
  weit: { minOdds: 1.01, maxOdds: 99, minFormGap: FORM_AUS, minH2hRate: H2H_AUS, minDuels: 0, minPositionGap: null },
  locker: { minOdds: 2.5, maxOdds: 4, minFormGap: FORM_AUS, minH2hRate: H2H_AUS, minDuels: 0, minPositionGap: null },
  ausgewogen: { minOdds: 2.5, maxOdds: 4, minFormGap: 20, minH2hRate: H2H_AUS, minDuels: 0, minPositionGap: null },
  streng: { minOdds: 2.5, maxOdds: 4, minFormGap: 20, minH2hRate: 0, minDuels: 0, minPositionGap: null }
};

/**
 * Auf den Knöpfen steht der **Ertrag**, nicht die Trefferquote: Ein Außenseiter wird einzeln
 * gespielt, und 30 % Treffer zu Quote 3,40 sind etwas völlig anderes als 30 % zu 2,50.
 */
export function underdogNote(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht zurückgerechnet";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  const roi = `${measured.roi >= 0 ? "+" : "−"}${Math.abs(measured.roi * 100).toFixed(1).replace(".", ",")}`;
  return `${proTag}/Tag · ${roi} % ROI`;
}

export const UNDERDOG_LEVELS: Array<QuickpickLevel<UnderdogLevelValues>> = [
  {
    id: "streng", label: "Streng",
    measured: {
      n: 115, proTag: 3.8, trefferquote: 0.261, roi: -0.153,
      kombis: [
        { beine: 2, n: 1960, trefferquote: 0.049, quote: 10.86, roi: -0.461, erwartung: -0.283 },
        { beine: 3, n: 1040, trefferquote: 0.007, quote: 36.22, roi: -0.702, erwartung: -0.392 },
        { beine: 4, n: 840, trefferquote: 0, quote: 118.67, roi: -1, erwartung: -0.485 },
        { beine: 5, n: 520, trefferquote: 0, quote: 384.23, roi: -1, erwartung: -0.564 }
      ]
    },
    hint: "Deine Kriterien vollständig: Quotenband, Formvorsprung und direkte Duelle."
      + " Achtung - in der Rückrechnung ist das H2H-Tor die teuerste Bedingung: Es kostete"
      + " rund 20 Punkte Ertrag gegenüber der Stufe darunter.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 291, proTag: 9.6, trefferquote: 0.323, roi: 0.035,
      kombis: [
        { beine: 2, n: 5520, trefferquote: 0.096, quote: 10.96, roi: -0.006, erwartung: 0.071 },
        { beine: 3, n: 3480, trefferquote: 0.023, quote: 36.33, roi: -0.241, erwartung: 0.109 },
        { beine: 4, n: 2600, trefferquote: 0.007, quote: 119.85, roi: -0.264, erwartung: 0.148 },
        { beine: 5, n: 1760, trefferquote: 0.002, quote: 397.37, roi: -0.499, erwartung: 0.188 }
      ]
    },
    hint: "Quotenband und Formvorsprung, ohne das Tor über die direkten Duelle."
      + " Die einzige Stufe, die in der Vorabmessung einen Ertrag über null zeigte - auf"
      + " kleiner Stichprobe und mit negativer zweiter Zeithälfte.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: {
      n: 1824, proTag: 58.9, trefferquote: 0.283, roi: -0.063,
      kombis: [
        { beine: 2, n: 36200, trefferquote: 0.079, quote: 11.4, roi: -0.134, erwartung: -0.121 },
        { beine: 3, n: 23880, trefferquote: 0.022, quote: 38.47, roi: -0.201, erwartung: -0.177 },
        { beine: 4, n: 17720, trefferquote: 0.006, quote: 129.98, roi: -0.242, erwartung: -0.228 },
        { beine: 5, n: 14120, trefferquote: 0.001, quote: 437.97, roi: -0.551, erwartung: -0.277 }
      ]
    },
    hint: "Nur das Quotenband 2,50-4,00. Das ist der Favorite-Longshot-Bias und sonst nichts:"
      + " Außenseiter über 4,00 sind deutlich zu teuer bezahlt.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: {
      n: 3603, proTag: 116.4, trefferquote: 0.214, roi: -0.137,
      kombis: [
        { beine: 2, n: 71720, trefferquote: 0.044, quote: 25.44, roi: -0.287, erwartung: -0.255 },
        { beine: 3, n: 47640, trefferquote: 0.009, quote: 137.44, roi: -0.416, erwartung: -0.357 },
        { beine: 4, n: 35640, trefferquote: 0.002, quote: 792.61, roi: -0.42, erwartung: -0.445 },
        { beine: 5, n: 28320, trefferquote: 0, quote: 5261.78, roi: -0.581, erwartung: -0.521 }
      ]
    },
    hint: "Jeder Außenseiter, den der Markt um mindestens ein Viertel schlechter sieht."
      + " Als Übersicht gedacht, nicht zum Spielen.",
    values: LEVELS.weit
  }
];

export const DEFAULT_UNDERDOG_SETTINGS: UnderdogQuickpickSettings = {
  preset: "underdog",
  minPriceRatio: 1.25,
  // Vorgabe ist „ausgewogen", nicht „streng": Das H2H-Tor kostet gemessen rund 19 Punkte
  // Ertrag je Bein (−15,3 % gegen +3,5 %), und für kurze Kombis zählt genau dieser Wert - er
  // multipliziert sich mit jedem Bein. Die strenge Stufe bleibt einen Klick entfernt.
  ...LEVELS.ausgewogen,
  requireModelSide: false
};

/**
 * Prüft eine Partie gegen die Torfolge. Die Reihenfolge der Tore ist die Reihenfolge der
 * Abweisungsgründe: Es gewinnt das erste greifende, damit jede Partie genau einmal zählt.
 */
export function evaluateUnderdog(
  fixture: DashboardFixture,
  settings: UnderdogQuickpickSettings
): QuickpickEvaluation {
  const market = oneXTwoMarket(fixture);
  const pick = market?.pick ?? null;
  const counter = counterOddsOf(fixture, market);
  const homePercent = venueFormPercent(fixture.form.home);
  const awayPercent = venueFormPercent(fixture.form.away);

  // Gestützt wird die teurere der beiden Seiten - hier darf die Auswahl erstmals vom
  // Modelltipp abweichen, denn der Widerspruch zum Markt ist der Zweck.
  const ownOdds = market?.odds ?? null;
  const dogIsCounter = counter !== null && ownOdds !== null && counter.odds > ownOdds;
  const side: "1" | "2" | null = pick === null ? null : dogIsCounter ? (pick === "1" ? "2" : "1") : pick;
  const dogOdds = dogIsCounter ? counter?.odds ?? null : ownOdds;
  const favouriteOdds = dogIsCounter ? ownOdds : counter?.odds ?? null;

  const drawProbability = fixture.markets.find((entry) => entry.key === "draw")?.probability ?? null;
  const probability = side === null || market === undefined ? null
    : side === pick ? market.probability
    : drawProbability === null ? null : 1 - market.probability - drawProbability;

  const dominance = side === null ? null : h2hDominance(fixture.h2h.outcomes, side);
  const formGap = side === null ? 0
    : side === "1" ? homePercent - awayPercent : awayPercent - homePercent;

  const base = {
    fixtureId: fixture.fixtureId,
    side,
    venueSide: null,
    pick,
    homePercent,
    awayPercent,
    venueScope: fixture.form.scope,
    // `scores.favorite` gilt für die Modellseite. Bei einem Widerspruch gehört der Wert nicht
    // zur gestützten Seite, deshalb führt die Voreinstellung keine Punktespalte.
    points: fixture.scores.favorite,
    odds: dogOdds,
    dominance,
    superiority: side === null ? null : superiorityOf(fixture, side),
    underdog: {
      counterOdds: counter?.odds ?? null,
      counterSource: counter?.source ?? null,
      priceRatio: dogOdds !== null && favouriteOdds !== null && favouriteOdds > 0
        ? dogOdds / favouriteOdds
        : null,
      formGap,
      probability,
      implied: dogOdds === null ? null : 1 / dogOdds,
      modelAgrees: side !== null && side === pick
    }
  };

  const reject = (rejectedBy: QuickpickRejection): QuickpickEvaluation =>
    ({ ...base, passes: false, rejectedBy });

  if (market === undefined || pick === null || dogOdds === null || counter === null) {
    return reject("keineQuote");
  }
  const ratio = base.underdog.priceRatio;
  if (ratio === null || ratio < settings.minPriceRatio) return reject("keinAussenseiter");
  if (dogOdds < settings.minOdds || dogOdds > settings.maxOdds) return reject("quote");
  if (formGap < settings.minFormGap) return reject("formGegen");
  // Ohne Duelle greift das Rate-Tor nicht - "keine Grundlage" ist etwas anderes als "dagegen".
  if (dominance !== null && dominance.rate <= settings.minH2hRate) return reject("h2hDagegen");
  if (settings.minDuels > 0 && (dominance === null || dominance.sample < settings.minDuels)) {
    return reject("keineDuelle");
  }
  if (settings.minPositionGap !== null) {
    if (base.superiority === null) return reject("keineTabelle");
    if (base.superiority.positionGap < settings.minPositionGap) return reject("tabelle");
  }
  if (settings.requireModelSide && !base.underdog.modelAgrees) return reject("modellDagegen");

  return { ...base, passes: true, rejectedBy: null };
}

export const UNDERDOG_PRESET: QuickpickPreset<UnderdogQuickpickSettings> = {
  id: "underdog",
  label: "Underdog",
  description: "Partien, in denen der Markt eine Mannschaft deutlich schlechter einschätzt,"
    + " obwohl Form und direkte Duelle für sie sprechen. Zum Finden und Anschauen gedacht -"
    + " die Rückrechnung stützt das Wetten darauf nicht.",
  criteria: [
    "Der Markt bezahlt die gestützte Seite deutlich höher als den Gegner",
    "Die Quote liegt im Band, in dem Außenseiter am wenigsten schlecht bezahlt sind",
    "Letzte 5 Spiele: Formvorsprung für den Außenseiter",
    "Direkte Duelle: kein Rückstand gegen den Außenseiter",
    "Getippt wird die Seite des Marktes-Außenseiters, nicht die des Modells"
  ],
  massstab: "roi",
  kennzahlOf: (measured) => ({
    label: "Ertrag je Wette",
    wert: measured === null ? "–"
      : `${measured.roi >= 0 ? "+" : "−"}${Math.abs(measured.roi * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht zurückgerechnet" : `über ${measured.n} Wetten`,
    titel: measured === null
      ? "Für diese Stufe liegt noch keine Rückrechnung vor."
      : `Flacher Einsatz auf den Außenseiter, gerechnet zum echten Tipico-Preis:`
        + ` ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} % Treffer über`
        + ` ${measured.n} Wetten. Ein Außenseiter wird einzeln gespielt - deshalb zählt hier`
        + ` der Ertrag und nicht die Trefferquote.`
  }),
  honesty: "Sucher, keine Tippregel. Über 4.397 abgerechnete Partien schlug keine Variante"
    + " dieser Kriterien das blinde Wetten auf Außenseiter. Für kurze Kombis gilt zusätzlich:"
    + " Eine Kombi multipliziert den Ertrag je Bein, nicht die Quote - eine hohe Gesamtquote"
    + " macht den Gewinn seltener, nicht größer. Bei rund 32 % Treffern je Bein geht eine"
    + " Viererkombi nur in 0,7 % der Fälle durch; die gemessenen Kombi-Erträge unten liegen"
    + " deshalb weit unter dem, was der Ertrag je Bein verspricht.",
  wettschein: {
    modus: "kombi",
    hinweis: "Legt jeden Treffer mit exakter Quote in den Wettschein. Dort lassen sich daraus"
      + " kurze Kombis bauen – rechne vorher die Kombi-Tabelle unten durch."
  },
  leerSatz: "Keine Partie passt zu diesem Außenseiter-Bild.",
  defaults: DEFAULT_UNDERDOG_SETTINGS,
  levels: UNDERDOG_LEVELS,
  defaultSort: "quote",
  evaluate: (fixture, settings) => evaluateUnderdog(fixture, settings),
  noteOf: underdogNote
};
