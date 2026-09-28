import type { DashboardFixture } from "./dashboard.ts";
import {
  marketOf,
  type QuickpickEvaluation,
  type QuickpickLevel,
  type QuickpickMeasurement,
  type QuickpickPreset,
  type QuickpickRejection
} from "./quickpick-core.ts";

/**
 * Voreinstellung „Remis-Kandidaten": Partien, die mit der größten Wahrscheinlichkeit
 * unentschieden enden. Gedacht als Beine für Davids 4er- bis 7er-Kombis; der Maßstab ist
 * deshalb die Trefferquote je Bein.
 *
 * ## Warum die Regel nur ein einziges Tor hat
 *
 * Gemessen über 6.341 abgerechnete Partien aus `goal_line_predictions` (je Partie der
 * jüngste Eintrag) und 4.752 Partien mit Remisquote aus den 59 archivierten Läufen.
 * **Basisrate 25,4 %.**
 *
 * Was für sich genommen trennt:
 *
 * - **Modell-`p(Remis)` >= 0,30: 35,7 % über n=283 - +10,3 pp**
 * - erwartete Gesamttore <= 2,2: 31,0 % über n=686 - +5,6 pp
 * - BTTS-Wahrscheinlichkeit <= 0,45: 30,1 % über n=871 - +4,7 pp
 * - drei Remis in den direkten Duellen: 30,4 % über n=500 - +4,8 pp
 * - `scores.draw` >= 50: 30,1 % über n=345 - +4,6 pp
 * - Stärkeparität |p(1)-p(2)| <= 0,05: 27,8 % über n=1.397 - +2,4 pp
 *
 * **Die naheliegenden Zusatztore sind keine.** `Tore <= 2,5`, `BTTS <= 0,50` und
 * `p(Remis) >= 0,28` liefern **exakt dieselben 871 Partien**: Das Poisson-Modell rechnet
 * die Remiswahrscheinlichkeit aus genau diesen Größen, sie tragen keine eigene Information.
 *
 * **Und jedes Tor, das man obendrauf setzt, macht es schlechter.** Auf `p(Remis) >= 0,30`
 * zusätzlich gemessen:
 *
 * | Zusatztor | n | Trefferquote |
 * |---|---:|---:|
 * | ohne (nur `p(Remis) >= 0,30`) | 283 | **35,7 %** |
 * | + `scores.draw >= 40` | 124 | 34,7 % |
 * | + `scores.draw >= 50` | 78 | **30,8 %** |
 * | + Datenvertrauen >= 80 | 208 | 32,2 % |
 * | + ohne Cross-League | 271 | 35,4 % |
 *
 * Auch die direkten Duelle tragen nicht obendrauf: `p(Remis) >= 0,27` zusammen mit drei
 * H2H-Remis liefert 30,3 % - weniger als die Wahrscheinlichkeit allein. Das deckt sich mit
 * AGENTS.md: „H2H-Remisserie-Hinweise sind Auffälligkeiten und kein alleiniger
 * Empfehlungsgrund."
 *
 * Das hauseigene 100-Punkte-System aus `src/draw-criteria.ts` **ordnet** zwar monoton, aber
 * es **feuert kaum**: Im Lauf vom 17.09.2026 erreichen 28 von 835 Partien 60 Punkte und
 * drei erreichen 70. Über alle Läufe bleiben oberhalb von 65 Punkten 55, 34 und 19 Partien.
 * Als Filter ist es unbrauchbar, deshalb ist `scores.draw` hier **Spalte und nicht Tor**.
 * Eine eigene Remis-Gewichtung wäre ohnehin verboten (AGENTS.md, Abschnitt „Grenzen").
 *
 * ## Der Quotendeckel
 *
 * Wie bei den anderen Voreinstellungen folgt die Trefferquote der Quote: Über 4,00 fallen
 * nur noch 16,4 % der Partien remis, unter 3,00 sind es 32,9 %. Ein Deckel bei 3,00 hebt
 * `p(Remis) >= 0,30` von 35,7 auf 38,7 % (n=204). Das ist erlaubt und ausdrücklich
 * dokumentiert: Die Auswahl steht fest, die Quote wählt nur, **welche** Partien erscheinen.
 *
 * ## Was die gebaute Regel misst - und das ist der verbindliche Wert
 *
 * `npm run quickpick-report -- --preset remis`, 4.887 abgerechnete Partien im
 * Snapshot-Bestand, Stand 18.09.2026:
 *
 * | Stufe | n | /Tag | Treffer | Quote | Ertrag je Bein | 1. Hälfte | 2. Hälfte |
 * |---|---|---|---|---|---|---|---|
 * | Streng | 126 | 3,8 | 40,5 % +-4,4 | 2,71 | +9,6 % | 33,3 % | **47,6 %** |
 * | Ausgewogen | 194 | 5,9 | 38,1 % +-3,5 | 2,73 | +3,5 % | 36,1 % | 40,2 % |
 * | Locker | 276 | 8,3 | 36,2 % +-2,9 | 3,20 | +8,4 % | 35,5 % | 37,0 % |
 * | Weit | 453 | 13,6 | 32,9 % +-2,2 | 3,18 | -0,4 % | 35,4 % | 30,4 % |
 *
 * ## Was das für Kombis heißt
 *
 * Bei 38,1 % je Bein geht ein **Vierer in 2,1 %** der Fälle durch, ein Sechser in 0,3 % -
 * einer von 330. Zum Vergleich: „Daves 1x2-Filter" 4er 22,7 %, „Erste Halbzeit" 4er 9,0 %.
 *
 * **Die Ertragsspalte der Kombitabelle ist ab vier Beinen wertlos, und das muss dabeistehen.**
 * In der Stufe `streng` misst der Fünfer +554 % - das sind **drei Treffer aus 720 Ziehungen**
 * bei einer Durchschnittsquote von 147. In der Vorgabestufe misst derselbe Fünfer -57 % bei
 * drei Treffern aus 1.240. Zwei Zahlen, die sich um 600 Punkte unterscheiden und beide
 * nichts bedeuten. Belastbar ist hier allein die **Trefferquote je Bein**; die Spalte
 * `erwartet` daneben sagt, was diese Trefferquote verspräche.
 *
 * Der Ertrag je Bein ist als einziger der drei Märkte positiv, steht aber auf 126 bis 453
 * Wetten bei mehreren Punkten Streuung, und die Schwellen wurden auf denselben Daten
 * gesucht. **Das ist kein nachgewiesener Gewinn.**
 *
 * ## Eine Abhängigkeit, die man im Blick behalten muss
 *
 * Diese Voreinstellung ist **ein einziges Tor auf die Modellwahrscheinlichkeit**. Sie steht
 * und fällt damit, wie gut das Tormodell im Remis-Tail kalibriert ist. Heute ist es gut:
 * bei `p >= 0,30` traten 34,2 % ein bei 32,1 % mittlerer Prognose über 395 Partien. Wird
 * `recalibrateGoals` in `src/config.ts` neu gesetzt, verschiebt sich diese Voreinstellung
 * mit, ohne dass jemand an ihr dreht - dann gehört `npm run quickpick-report` gelaufen,
 * auch wenn die 2.000er-Schwelle noch nicht erreicht ist.
 */

export interface RemisQuickpickSettings {
  preset: "remis";
  /** Untergrenze des Quotenbands. */
  minOdds: number;
  /** Obergrenze. 99 heißt: kein Deckel. */
  maxOdds: number;
  /**
   * Das Kerntor: Mindestwahrscheinlichkeit des Modells für ein Remis. Staffelt bewusst
   * **nicht unter 0,29** - darunter kippt der Ertrag je Bein ins Minus (0,28 auf -5,7 %,
   * 0,27 auf -5,9 %), und die Trefferquote fällt unter 31 %.
   */
  minDrawProbability: number;
}

export type RemisLevelValues = Pick<RemisQuickpickSettings, "minOdds" | "maxOdds" | "minDrawProbability">;

const LEVELS: Record<"streng" | "ausgewogen" | "locker" | "weit", RemisLevelValues> = {
  streng: { minOdds: 1.3, maxOdds: 3.0, minDrawProbability: 0.31 },
  ausgewogen: { minOdds: 1.3, maxOdds: 3.0, minDrawProbability: 0.3 },
  locker: { minOdds: 1.3, maxOdds: 99, minDrawProbability: 0.3 },
  weit: { minOdds: 1.3, maxOdds: 99, minDrawProbability: 0.29 }
};

/** Auf den Knöpfen steht die Trefferquote je Bein - der Zweck sind Kombis. */
export function remisNote(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht geprüft";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  return `${proTag}/Tag · ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} % Treffer`;
}

export const REMIS_LEVELS: Array<QuickpickLevel<RemisLevelValues>> = [
  {
    id: "streng", label: "Streng",
    measured: {
      n: 29, proTag: 1.2, trefferquote: 0.207, roi: -0.448,
      kombis: [
        { beine: 2, n: 480, trefferquote: 0.006, quote: 7.47, roi: -0.959, erwartung: -0.696 },
        { beine: 3, n: 280, trefferquote: 0, quote: 20.46, roi: -1, erwartung: -0.832 },
        { beine: 4, n: 160, trefferquote: 0, quote: 56.5, roi: -1, erwartung: -0.907 },
        { beine: 5, n: 80, trefferquote: 0, quote: 149.71, roi: -1, erwartung: -0.949 },
        { beine: 6, n: 80, trefferquote: 0, quote: 408.4, roi: -1, erwartung: -0.972 },
        { beine: 7, n: 40, trefferquote: 0, quote: 1183.79, roi: -1, erwartung: -0.984 }
      ]
    },
    hint: "Chance auf Unentschieden ab 31 %, Quote höchstens 3,00. Mit dem heutigen Modell"
      + " stimmten nur 2 von 10 Tipps – weniger als ohne Filter. Bei 29 Spielen kann das auch"
      + " Zufall sein. Etwa ein Spiel am Tag.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 61, proTag: 2.6, trefferquote: 0.279, roi: -0.252,
      kombis: [
        { beine: 2, n: 1120, trefferquote: 0.04, quote: 7.45, roi: -0.719, erwartung: -0.44 },
        { beine: 3, n: 640, trefferquote: 0.008, quote: 20.85, roi: -0.857, erwartung: -0.581 },
        { beine: 4, n: 400, trefferquote: 0.003, quote: 56.58, roi: -0.884, erwartung: -0.686 },
        { beine: 5, n: 320, trefferquote: 0, quote: 153.98, roi: -1, erwartung: -0.765 },
        { beine: 6, n: 240, trefferquote: 0, quote: 427.09, roi: -1, erwartung: -0.824 },
        { beine: 7, n: 160, trefferquote: 0, quote: 1126.49, roi: -1, erwartung: -0.869 }
      ]
    },
    hint: "Chance auf Unentschieden ab 30 %, Quote höchstens 3,00. Knapp 3 von 10 Tipps"
      + " stimmen – kaum mehr als ohne Filter. Zwei bis drei Spiele am Tag. Die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: {
      n: 77, proTag: 3.2, trefferquote: 0.325, roi: -0.05,
      kombis: [
        { beine: 2, n: 1400, trefferquote: 0.076, quote: 8.17, roi: -0.377, erwartung: -0.098 },
        { beine: 3, n: 840, trefferquote: 0.014, quote: 23.84, roi: -0.684, erwartung: -0.143 },
        { beine: 4, n: 560, trefferquote: 0, quote: 67.61, roi: -1, erwartung: -0.185 },
        { beine: 5, n: 360, trefferquote: 0, quote: 183.68, roi: -1, erwartung: -0.226 },
        { beine: 6, n: 320, trefferquote: 0, quote: 516.9, roi: -1, erwartung: -0.265 },
        { beine: 7, n: 240, trefferquote: 0, quote: 1494.9, roi: -1, erwartung: -0.302 }
      ]
    },
    hint: "Chance auf Unentschieden ab 30 %, Quote nach oben offen. Gut 3 von 10 Tipps"
      + " stimmen – mit dem heutigen Modell die beste Stufe, aber das kann auch Zufall sein.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: {
      n: 160, proTag: 6.7, trefferquote: 0.281, roi: -0.169,
      kombis: [
        { beine: 2, n: 3040, trefferquote: 0.066, quote: 8.57, roi: -0.425, erwartung: -0.31 },
        { beine: 3, n: 2040, trefferquote: 0.012, quote: 25.13, roi: -0.717, erwartung: -0.427 },
        { beine: 4, n: 1400, trefferquote: 0.005, quote: 72.3, roi: -0.64, erwartung: -0.524 },
        { beine: 5, n: 1080, trefferquote: 0, quote: 214.08, roi: -1, erwartung: -0.605 },
        { beine: 6, n: 880, trefferquote: 0.001, quote: 625.86, roi: -0.5, erwartung: -0.672 },
        { beine: 7, n: 720, trefferquote: 0, quote: 1834.86, roi: -1, erwartung: -0.727 }
      ]
    },
    hint: "Chance auf Unentschieden ab 29 %, Quote offen. Nur zum Überblick: knapp 3 von 10"
      + " Tipps stimmen, unterm Strich ein deutlicher Verlust.",
    values: LEVELS.weit
  }
];

export const DEFAULT_REMIS_SETTINGS: RemisQuickpickSettings = { preset: "remis", ...LEVELS.ausgewogen };

/**
 * Prüft eine Partie gegen die Torfolge. Es gewinnt das erste greifende Tor, damit jede
 * Partie in der Bilanz genau einmal zählt.
 *
 * Wie „Erste Halbzeit" stützt diese Voreinstellung **keine Seite**, sondern einen Markt:
 * `side` bleibt `null`, `market` trägt `draw`.
 */
export function evaluateRemis(
  fixture: DashboardFixture,
  settings: RemisQuickpickSettings
): QuickpickEvaluation {
  const market = marketOf(fixture, "draw");

  const base = {
    fixtureId: fixture.fixtureId,
    market: "draw" as const,
    selection: market?.selection ?? "Unentschieden (X)",
    side: null,
    venueSide: null,
    pick: null,
    homePercent: 0,
    awayPercent: 0,
    venueScope: fixture.form.scope,
    points: null,
    odds: market?.odds ?? null,
    dominance: null,
    superiority: null,
    remis: {
      probability: market?.probability ?? 0,
      punkte: fixture.scores.draw,
      h2hDraws: fixture.h2h.draws,
      h2hSample: fixture.h2h.outcomes.length,
      consecutiveDraws: fixture.h2h.consecutiveDraws,
      expectedGoals: fixture.expectedGoals.total
    }
  };

  const reject = (rejectedBy: QuickpickRejection): QuickpickEvaluation =>
    ({ ...base, passes: false, rejectedBy });

  if (market === undefined) return reject("keinMarkt");
  if (market.odds === null || market.odds <= 1) return reject("keineQuote");
  if (market.odds < settings.minOdds || market.odds > settings.maxOdds) return reject("quote");
  if (market.probability < settings.minDrawProbability) return reject("remisChance");

  return { ...base, passes: true, rejectedBy: null };
}

export const REMIS_PRESET: QuickpickPreset<RemisQuickpickSettings> = {
  id: "remis",
  label: "Remis-Kandidaten",
  group: "modell",
  description: "Spiele, die am ehesten unentschieden enden. Gesucht wird kein Sieger,"
    + " sondern ein geteilter Punkt – zu einer Quote, die sich noch lohnt.",
  criteria: [
    "Das Modell gibt dem Unentschieden mindestens 30 % – die einzige Bedingung",
    "Quote höchstens 3,00 – über 4,00 endet nur noch jedes sechste Spiel unentschieden",
    "Die Remis-Punkte sind bewusst keine Bedingung: Damit stimmen weniger Tipps, nicht mehr",
    "Die direkten Duelle (H2H) sind bewusst keine Bedingung – sie helfen hier nicht",
    "Erwartete Tore und BTTS ebenfalls nicht – das Modell rechnet die Chance schon daraus"
  ],
  massstab: "trefferquote",
  kennzahlOf: (measured) => ({
    label: "Treffer je Tipp",
    wert: measured === null ? "–" : `${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht geprüft" : `an ${measured.n} alten Wetten geprüft`,
    titel: measured === null
      ? "Diese Stufe wurde noch nicht an alten Spielen geprüft."
      : `So oft endete das Spiel wirklich unentschieden: ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`
        + ` (an ${measured.n} alten Wetten geprüft). Ohne Filter sind es nur 25 %. In einer Kombi`
        + ` müssen alle Tipps stimmen – deshalb zählt genau dieser Wert.`
  }),
  honesty: "Mit dem heutigen Modell stimmen nur knapp 3 von 10 Tipps – kaum mehr als ohne"
    + " Filter, wo es 1 von 4 sind. Frühere Modellversionen trafen öfter; die Zahlen hier"
    + " gelten nur für das heutige. Ein Schein mit vier Spielen ging in 3 von 1.000 Fällen"
    + " durch. Rechne nicht mit Gewinn. Und schau dir in der Kombi-Tabelle nur an, wie oft ein"
    + " Schein durchgeht – die Gewinnspalte springt dort ab vier Spielen wild hin und her und"
    + " sagt nichts.",
  wettschein: {
    hinweis: "Legt jedes gefundene Spiel als „Unentschieden“ in den Wettschein. Ein"
      + " Sieger-Tipp zum selben Spiel bleibt daneben bestehen."
  },
  leerSatz: "Kein Spiel endet wahrscheinlich genug unentschieden – jedenfalls nicht zu diesem Preis.",
  defaults: DEFAULT_REMIS_SETTINGS,
  levels: REMIS_LEVELS,
  defaultSort: "remischance",
  evaluate: (fixture, settings) => evaluateRemis(fixture, settings),
  noteOf: remisNote
};
