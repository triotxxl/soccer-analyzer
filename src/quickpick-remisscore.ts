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
    measured: { n: 25, proTag: 0.7, trefferquote: 0.4, roi: 0.182 },
    hint: "Remis-Score ab 16 von 25. 4 von 10 Tipps stimmten, aber nur bei 25 alten Spielen –"
      + " das kann auch Zufall sein. Weniger als ein Spiel am Tag.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 83, proTag: 2.4, trefferquote: 0.361, roi: 0.074,
      kombis: [
        { beine: 2, n: 1480, trefferquote: 0.099, quote: 9.0, roi: -0.095, erwartung: 0.154 },
        { beine: 3, n: 880, trefferquote: 0.018, quote: 27.2, roi: -0.477, erwartung: 0.239 },
        { beine: 4, n: 560, trefferquote: 0.004, quote: 82.2, roi: -0.756, erwartung: 0.331 },
        { beine: 5, n: 400, trefferquote: 0, quote: 247.0, roi: -1, erwartung: 0.43 },
        { beine: 6, n: 320, trefferquote: 0, quote: 789.2, roi: -1, erwartung: 0.536 },
        { beine: 7, n: 200, trefferquote: 0, quote: 2223.9, roi: -1, erwartung: 0.649 }
      ]
    },
    hint: "Remis-Score ab 14 von 25. Gut jedes dritte Spiel endete unentschieden, etwa zwei"
      + " Spiele am Tag. Zuletzt seltener als am Anfang.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: { n: 282, proTag: 7.8, trefferquote: 0.305, roi: -0.077 },
    hint: "Remis-Score ab 12 von 25. Knapp jedes dritte Spiel endete unentschieden – nur wenig"
      + " mehr als ohne Filter. Unterm Strich ein Verlust.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: { n: 690, proTag: 18.8, trefferquote: 0.28, roi: -0.131 },
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
  honesty: "An alten Spielen geprüft endete in der Vorgabe gut jedes dritte Spiel unentschieden –"
    + " genauso oft wie beim Filter „Remis-Kandidaten“, aber bei viel weniger Spielen. Die Punkte"
    + " je Hinweis sind gesetzt, und es waren erst 83 Spiele: Das kann auch Zufall sein. Ein"
    + " Schein mit vier Spielen ging so gut wie nie durch. Rechne nicht mit Gewinn.",
  wettschein: {
    hinweis: "Legt jedes gefundene Spiel als „Unentschieden“ in den Wettschein. Ein"
      + " Sieger-Tipp zum selben Spiel bleibt daneben bestehen."
  },
  leerSatz: "Kein Spiel sammelt genug Hinweise auf ein Unentschieden.",
  defaults: DEFAULT_REMIS_SCORE_SETTINGS,
  levels: REMIS_SCORE_LEVELS,
  defaultSort: "remisscore",
  evaluate: (fixture, settings) => evaluateRemisScore(fixture, settings),
  noteOf: remisScoreNote
};
