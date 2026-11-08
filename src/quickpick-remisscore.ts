import type { DashboardFixture } from "./dashboard.ts";
import { scoreDrawSignals } from "./draw-signals.ts";
import {
  marketOf,
  type QuickpickEvaluation,
  type QuickpickLevel,
  type QuickpickMeasurement,
  type QuickpickPreset,
  type QuickpickRejection
} from "./quickpick-core.ts";

/**
 * Voreinstellung „Remis-Score": Spiele mit hohem Remis-Score aus `src/draw-signals.ts`.
 *
 * Anders als „Remis-Kandidaten" steht hier **nicht** die Modellwahrscheinlichkeit im Tor,
 * sondern ein Punktwert aus einzelnen, benannten Kriterien - aufgeklappt steht bei jedem Spiel,
 * wofür es Punkte bekam. Das war Davids Vorgabe vom 24.09.2026: nachvollziehbar statt Blackbox.
 *
 * ## Erste Messung (24.09.2026, 5.931 abgerechnete Spiele, Basisrate 25,5 %)
 *
 * Die Gewichte sind gesetzt, nicht gesucht - gemessen wurde danach, nicht davor.
 * `npm run quickpick-report -- --preset remisScore`:
 *
 * | Stufe | n | /Tag | Treffer | Ertrag je Bein | 1. Hälfte | 2. Hälfte |
 * |---|---:|---:|---:|---:|---:|---:|
 * | Streng (ab 16) | 25 | 0,7 | 40,0 % ±9,8 | +18,2 % | 41,7 % | 38,5 % |
 * | Ausgewogen (ab 14) | 83 | 2,4 | 36,1 % ±5,3 | +7,4 % | 41,5 % | 31,0 % |
 * | Locker (ab 12) | 282 | 7,8 | 30,5 % ±2,7 | −7,7 % | 31,9 % | 29,1 % |
 * | Weit (ab 10) | 690 | 18,8 | 28,0 % ±1,7 | −13,1 % | 30,1 % | 25,8 % |
 *
 * **Einordnung:** `p(Remis) >= 0,30` allein trifft auf demselben Bestand 35,5 % über 299
 * Spiele. Die Vorgabestufe trifft also nicht besser als das Modell, nur bei einem Viertel der
 * Menge. Über dem, was das Modell diesen 85 Spielen im Schnitt gab (29,4 %), liegt sie um rund
 * sechs Punkte - bei ±5,3 ist das gut eine Standardabweichung und **kein Beleg**. Die
 * Spielbild-Kriterien sind in der Rückrechnung nur für rund 11 % der Spiele bewertbar, weil
 * alte Läufe die Vorspiele nicht mit Fixture-ID führen; erst neue Läufe füllen sie.
 * Einzelheiten je Kriterium: `npm run draw-signals-report`.
 *
 * ## Warum `minEvaluable`
 *
 * Ohne Tabelle (Pokal, Spiele zwischen Ligen) und ohne Statistik (rund 57 % der Spiele) sind
 * viele Kriterien nicht bewertbar. Ein Mindestscore allein würde solche Spiele stillschweigend
 * benachteiligen, ein Anteil am bewertbaren Maximum würde sie bevorzugen: Drei bewertbare
 * Kriterien voll getroffen wären 100 %. Das zweite Tor verlangt deshalb, dass genug Punkte
 * überhaupt zu holen waren.
 */

export interface RemisScoreQuickpickSettings {
  preset: "remisScore";
  /** Mindestpunktzahl des Remis-Scores. */
  minScore: number;
  /** So viele Punkte müssen bewertbar gewesen sein, sonst fällt das Spiel als „zu wenig Daten". */
  minEvaluable: number;
}

export type RemisScoreLevelValues = Pick<RemisScoreQuickpickSettings, "minScore">;

const LEVELS: Record<"streng" | "ausgewogen" | "locker" | "weit", RemisScoreLevelValues> = {
  streng: { minScore: 16 },
  ausgewogen: { minScore: 14 },
  locker: { minScore: 12 },
  weit: { minScore: 10 }
};

/** Auf den Knöpfen steht die Trefferquote je Tipp - wie beim Remis-Filter. */
export function remisScoreNote(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht geprüft";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  return `${proTag}/Tag · ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} % Treffer`;
}

export const REMIS_SCORE_LEVELS: Array<QuickpickLevel<RemisScoreLevelValues>> = [
  {
    id: "streng", label: "Streng",
    measured: {
      n: 71, proTag: 0.9, trefferquote: 0.225, roi: -0.338,
      kombis: [
        { beine: 2, n: 1120, trefferquote: 0.021, quote: 9.11, roi: -0.8, erwartung: -0.562 },
        { beine: 3, n: 480, trefferquote: 0, quote: 28.07, roi: -1, erwartung: -0.71 },
        { beine: 4, n: 280, trefferquote: 0, quote: 87.91, roi: -1, erwartung: -0.808 },
        { beine: 5, n: 160, trefferquote: 0, quote: 249.63, roi: -1, erwartung: -0.873 },
        { beine: 6, n: 80, trefferquote: 0, quote: 1026.52, roi: -1, erwartung: -0.916 },
        { beine: 7, n: 40, trefferquote: 0, quote: 4500.24, roi: -1, erwartung: -0.944 }
      ]
    },
    hint: "Remis-Score ab 16 von 25. Nur gut 2 von 10 Tipps stimmten – nicht mehr als ganz"
      + " ohne Filter. Weniger als ein Spiel am Tag.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 260, proTag: 3.4, trefferquote: 0.281, roi: -0.145,
      kombis: [
        { beine: 2, n: 4920, trefferquote: 0.08, quote: 9.76, roi: -0.259, erwartung: -0.268 },
        { beine: 3, n: 3000, trefferquote: 0.023, quote: 30.53, roi: -0.333, erwartung: -0.374 },
        { beine: 4, n: 2120, trefferquote: 0.008, quote: 96.87, roi: -0.276, erwartung: -0.465 },
        { beine: 5, n: 1480, trefferquote: 0.002, quote: 301.69, roi: -0.624, erwartung: -0.542 },
        { beine: 6, n: 1200, trefferquote: 0.001, quote: 940.01, roi: -0.435, erwartung: -0.608 },
        { beine: 7, n: 840, trefferquote: 0, quote: 3007.25, roi: -1, erwartung: -0.665 }
      ]
    },
    hint: "Remis-Score ab 14 von 25. Knapp 3 von 10 Spielen endeten unentschieden, etwa drei"
      + " Spiele am Tag. Zuletzt seltener als am Anfang.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: {
      n: 749, proTag: 9.7, trefferquote: 0.292, roi: -0.083,
      kombis: [
        { beine: 2, n: 14520, trefferquote: 0.082, quote: 10.25, roi: -0.196, erwartung: -0.159 },
        { beine: 3, n: 9400, trefferquote: 0.024, quote: 32.92, roi: -0.248, erwartung: -0.229 },
        { beine: 4, n: 6840, trefferquote: 0.006, quote: 105.83, roi: -0.386, erwartung: -0.293 },
        { beine: 5, n: 5320, trefferquote: 0.001, quote: 339.87, roi: -0.708, erwartung: -0.352 },
        { beine: 6, n: 4280, trefferquote: 0, quote: 1102.09, roi: -0.673, erwartung: -0.406 },
        { beine: 7, n: 3640, trefferquote: 0, quote: 3515.07, roi: -1, erwartung: -0.455 }
      ]
    },
    hint: "Remis-Score ab 12 von 25. Knapp 3 von 10 Spielen endeten unentschieden – nur wenig"
      + " mehr als ohne Filter. Unterm Strich ein Verlust.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: {
      n: 1651, proTag: 21.4, trefferquote: 0.274, roi: -0.12,
      kombis: [
        { beine: 2, n: 32600, trefferquote: 0.073, quote: 10.73, roi: -0.244, erwartung: -0.226 },
        { beine: 3, n: 21400, trefferquote: 0.022, quote: 35.18, roi: -0.257, erwartung: -0.319 },
        { beine: 4, n: 15920, trefferquote: 0.005, quote: 115.62, roi: -0.466, erwartung: -0.401 },
        { beine: 5, n: 12600, trefferquote: 0.002, quote: 379.39, roi: -0.437, erwartung: -0.473 },
        { beine: 6, n: 10320, trefferquote: 0, quote: 1251.42, roi: -0.448, erwartung: -0.536 },
        { beine: 7, n: 8720, trefferquote: 0, quote: 4132.85, roi: -0.787, erwartung: -0.592 }
      ]
    },
    hint: "Remis-Score ab 10 von 25. Nur zum Überblick: kaum mehr Unentschieden als ohne Filter,"
      + " unterm Strich ein deutlicher Verlust.",
    values: LEVELS.weit
  }
];

export const DEFAULT_REMIS_SCORE_SETTINGS: RemisScoreQuickpickSettings = {
  preset: "remisScore", ...LEVELS.ausgewogen, minEvaluable: 15
};

/**
 * Prüft eine Partie. Wie „Remis-Kandidaten" stützt diese Voreinstellung **keine Seite**:
 * `side` bleibt `null`, `market` trägt `draw`.
 */
export function evaluateRemisScore(
  fixture: DashboardFixture,
  settings: RemisScoreQuickpickSettings
): QuickpickEvaluation {
  const market = marketOf(fixture, "draw");
  const signals = scoreDrawSignals(fixture);

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
    remisScore: signals
  };

  const reject = (rejectedBy: QuickpickRejection): QuickpickEvaluation =>
    ({ ...base, passes: false, rejectedBy });

  if (market === undefined) return reject("keinMarkt");
  if (signals.evaluableMax < settings.minEvaluable) return reject("remisDaten");
  if (signals.score < settings.minScore) return reject("remisScore");

  return { ...base, passes: true, rejectedBy: null };
}

export const REMIS_SCORE_PRESET: QuickpickPreset<RemisScoreQuickpickSettings> = {
  id: "remisScore",
  label: "Remis-Score",
  group: "daves",
  description: "Spiele, in denen beide Mannschaften ähnlich stark auftreten. Jedes Spiel sammelt"
    + " Punkte für einzelne Hinweise auf ein Unentschieden – aufgeklappt steht, wofür.",
  criteria: [
    "Tabelle: ähnlich viele Punkte und Tore je Spiel, Heimbilanz gegen Auswärtsbilanz",
    "Form am Ort ähnlich – zählt nur, wenn beide gegen ähnlich starke Gegner gespielt haben",
    "Spielbild der letzten Spiele: Schüsse aufs Tor, xG (erwartete Tore aus Chancen) und"
      + " Ballbesitz ähnlich verteilt, soweit die Liga diese Zahlen liefert",
    "Wenige Tore erwartet, oft knappe Spiele, zur Pause meist eng",
    "Direkte Duelle (H2H) ohne Testspiele: Remis und wenige Tore",
    "Gefährliche Angriffe und Großchancen fehlen, weil es diese Zahlen nicht gibt"
  ],
  massstab: "trefferquote",
  kennzahlOf: (measured) => ({
    label: "Treffer je Tipp",
    wert: measured === null ? "–" : `${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht geprüft" : `an ${measured.n} alten Wetten geprüft`,
    titel: measured === null
      ? "Diese Stufe wurde noch nicht an alten Spielen geprüft."
      : `So oft endete das Spiel wirklich unentschieden: ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`
        + ` (an ${measured.n} alten Wetten geprüft). Ohne Filter ist es jedes vierte Spiel.`
  }),
  honesty: "An alten Spielen geprüft endeten in der Vorgabe knapp 3 von 10 Spielen"
    + " unentschieden – kaum mehr als ganz ohne Filter, wo es 1 von 4 sind. Zuletzt waren es"
    + " weniger als am Anfang, und die Punkte je Hinweis sind gesetzt, nicht gemessen. Das kann"
    + " auch Zufall sein. Ein Schein"
    + " mit vier Spielen ging so gut wie nie durch. Rechne nicht mit Gewinn.",
  warnung: "Es stimmen kaum mehr Tipps als ganz ohne Filter, und die Punkte je Hinweis sind"
    + " gesetzt, nicht gemessen. Rechne nicht mit Gewinn.",
  wettschein: {
    hinweis: "Legt jedes gefundene Spiel als „Unentschieden“ in den Wettschein. Ein Sieger-Tipp"
      + " zum selben Spiel wird dabei ersetzt – beides zugleich verliert sicher."
  },
  leerSatz: "Kein Spiel sammelt genug Hinweise auf ein Unentschieden.",
  defaults: DEFAULT_REMIS_SCORE_SETTINGS,
  levels: REMIS_SCORE_LEVELS,
  defaultSort: "kickoff",
  evaluate: (fixture, settings) => evaluateRemisScore(fixture, settings),
  noteOf: remisScoreNote
};
