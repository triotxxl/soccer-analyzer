import type { DashboardFixture } from "./dashboard.ts";
import {
  firstHalfRateOf,
  marketOf,
  type QuickpickEvaluation,
  type QuickpickLevel,
  type QuickpickMeasurement,
  type QuickpickPreset,
  type QuickpickRejection
} from "./quickpick-core.ts";

/**
 * Voreinstellung „Erste Halbzeit: zwei Tore": Partien, in denen schon **zur Pause** mindestens
 * zwei Tore gefallen sein sollen. Gedacht als Beine für Davids 4er- bis 7er-Kombis; der
 * Maßstab ist deshalb die Trefferquote je Bein, nicht der Ertrag einer Einzelwette.
 *
 * ## Was gemessen wurde, bevor diese Regel entstand
 *
 * Grundlage: 6.155 abgerechnete Partien mit überliefertem Pausenstand aus
 * `goal_line_predictions` (je Partie der jüngste Eintrag), dazu 4.397 Partien mit
 * Halbzeithistorie beider Mannschaften aus den 57 archivierten Läufen. **Basisrate 35,4 %.**
 *
 * - erwartete Gesamttore >= 3,4: 48,0 % über n=661 - **+12,5 pp**
 * - Stärkedifferenz |p(1)-p(2)| >= 0,40: 46,2 % über n=461 - +10,8 pp
 * - Remiswahrscheinlichkeit < 0,22: 44,1 % über n=1.218 - +8,7 pp
 * - BTTS-Wahrscheinlichkeit >= 0,60: 42,1 % über n=1.498 - +6,7 pp
 * - Halbzeitbilanz beider Teams >= 0,50: 39,6 % über n=1.282 - +3,9 pp
 * - Abwehrprofile, Summe `relativeToLeague` >= 2,2: 37,9 % über n=738 - +2,5 pp
 * - Datenvertrauen: kein Signal
 *
 * Drei Befunde tragen den Entwurf:
 *
 * 1. **Die Abwehrleistung trägt nicht.** „Beide Abwehren stark" liegt bei 33,1 %, „beide
 *    schwach" bei 36,7 % - 3,6 Punkte bei rund 3 Punkten Streuung. Das Abwehrprofil ist
 *    deshalb weder Tor noch Spalte, obwohl es im Lauf vorliegt.
 * 2. **Das eigens gebaute Halbzeitmodell trennt schlechter als die Gesamttorerwartung.**
 *    `first_half_expected_total_goals >= 1,6` liefert 44,5 % über n=506, `expectedGoals.total
 *    >= 3,2` liefert 44,8 % über n=1.126 - gleiche Trefferquote, doppelte Stichprobe. Dazu
 *    passt, dass `1. HZ Ü1,5` in der Echtgeldkette der schlechteste Markt war (-48,7 % ROI,
 *    Kalibrierbias -28,2 pp). Das Tor steht deshalb auf der **Ganzspiel**-Torerwartung.
 * 3. **Die Liga ist der größte Einzelfaktor** - Argentinien Liga Profesional 14,9 %, Saudi
 *    Pro League 48,3 %. Ein Liga-Tor gibt es trotzdem nicht: Nur 11 Ligen haben n >= 60, und
 *    `evaluate` sieht die Ligastatistik des Laufs gar nicht.
 *
 * ## Warum das Quotenband ein Tor ist
 *
 * Gegen 3.117 archivierte Tipico-Quoten (Median 2,35) ist **keine rein sportliche Variante
 * positiv**; die beste liegt bei -4,7 % +-3,8. Die Trefferquote folgt der Quote fast exakt
 * (Quote 1,76 -> 53,0 %, Quote 2,56 -> 33,4 %) - derselbe Befund wie bei „Dominanz".
 *
 * Weil für eine Kombi die Trefferquote je Bein zählt, ist das Quotenband hier ein Werkzeug:
 *
 * - alle Partien: 38,9 % bei Quote 2,30 - Ertrag je Bein -10,5 %
 * - nur Quote <= 2,00: 50,0 % bei 1,86 - -6,8 %
 * - Tore >= 3,2 und Quote <= 2,00: 53,9 % bei 1,85 - -0,3 %
 * - **Tore >= 3,2, p(Remis) < 0,23, Quote <= 2,00: 54,3 % +-2,8 bei 1,85 - +0,4 %**
 *
 * **Die Einordnung gehört in jede Aussage darüber:** Der Sprung von 38,9 auf 50,0 % kommt aus
 * dem **Quotenband**, also aus der Meinung des Buchmachers; das Modell trägt die Strecke von
 * 50,0 auf 54,3 % bei. Und die beste Zelle wurde aus rund zehn Versuchen auf **denselben
 * Daten** gewählt - bei +-2,8 pp Trefferquote sind das etwa +-5 Punkte Ertrag. **+0,4 % ist
 * nicht von null zu unterscheiden.** Verbindlich ist allein, was `npm run quickpick-report`
 * an der gebauten Regel misst, und dort zählt der Vergleich beider Zeithälften.
 *
 * ## Was die gebaute Regel misst - und das ist der verbindliche Wert
 *
 * `npm run quickpick-report -- --preset hz15`, 4.704 abgerechnete Partien im
 * Snapshot-Bestand, Stand 17.09.2026:
 *
 * | Stufe | n | /Tag | Treffer | Quote | Ertrag je Bein | 1. Hälfte | 2. Hälfte |
 * |---|---|---|---|---|---|---|---|
 * | Streng | 136 | 4,7 | 59,6 % +-4,2 | 1,80 | +7,3 % | 61,8 % | 57,4 % |
 * | Ausgewogen | 277 | 9,2 | 55,6 % +-3,0 | 1,85 | +2,4 % | 57,2 % | 54,0 % |
 * | Locker | 368 | 12,2 | 52,7 % +-2,6 | 1,91 | -0,4 % | 54,3 % | 51,1 % |
 * | Weit | 631 | 20,8 | 47,7 % +-2,0 | 2,05 | -3,9 % | 50,8 % | 44,6 % |
 *
 * Das liegt **über** der Vorabmessung, und der Grund ist kein besserer Filter, sondern ein
 * anderer Abrechnungskurs: Der Report rechnet zum Preis aus dem Lauf ab - dem, den die App
 * gezeigt hätte -, die Vorabmessung zum letzten archivierten Tipico-Preis vor Anpfiff. Für
 * einen Halbzeitmarkt gibt es keinen Ersatzpreis aus dem 1X2-Tripel, also gilt hier
 * ausschließlich der Snapshot-Preis.
 *
 * **Zwei Warnzeichen gehören in jede Aussage darüber.** Erstens fällt die zweite Zeithälfte
 * auf **allen vier** Stufen unter die erste (-4,4 / -3,2 / -3,2 / -6,2 Punkte). Je einzeln
 * liegt das innerhalb der Streuung, aber dass es viermal dasselbe Vorzeichen hat, ist kein
 * Zufallsmuster. Zweitens wurden die Schwellen 3,2 / 0,23 / 2,00 auf **denselben Daten**
 * gesucht, gegen die hier gemessen wird.
 *
 * ## Für Kombis, und das ist der Zweck
 *
 * Aus der Vorgabestufe, gezogen über zwei Spieltage: Zweier 29,8 % Trefferchance bei +0,9 %,
 * Dreier 16,6 % bei +3,4 %, Vierer 9,0 % bei +1,8 % - und dann kippt es: Fünfer 4,7 % bei
 * **-1,8 %**, Sechser 2,2 % bei **-17,6 %**, Siebener 0,5 % bei **-64,4 %**. Die Spalte
 * `erwartung` daneben sagt, was der Ertrag je Bein verspräche (+12,6 / +15,3 / +18,1 %); dass
 * das Gemessene so weit darunter liegt, heißt bei 2,2 % Trefferchance nicht "die Rechnung ist
 * falsch", sondern "die Stichprobe trägt diese Länge nicht". Wer sechs oder sieben Beine
 * spielt, spielt sie hier auf Verdacht.
 *
 * **Diese Kombizahlen schwanken stark mit der Ziehung.** Vor der Umstellung auf einen
 * Zufallsstart je Stufe maß derselbe Bestand für den Vierer +12,5 % statt +1,8 % und für den
 * Siebener -46,7 % statt -64,4 % - allein, weil andere Blöcke gezogen wurden. Bei 0,5 %
 * Trefferchance hängt der Ertrag eines Siebeners an einzelnen Treffern. Belastbar ist hier
 * die **Trefferquote je Bein**, nicht der Kombi-Ertrag.
 *
 * Das Quotenband als Tor widerspricht nicht der Grenze in AGENTS.md („Tipico-Quoten
 * beeinflussen nicht die sportliche Modellauswahl"): Die Auswahl steht hier fest, die Quote
 * wählt nur, **welche** Partien gezeigt werden - genauso wie `minOdds` bei „Daves" und das
 * Band bei „Dominanz".
 */

export interface Hz15QuickpickSettings {
  preset: "hz15";
  /** Untergrenze des Quotenbands. Schützt vor Preisen, die kein Bein mehr lohnen. */
  minOdds: number;
  /** Obergrenze - das wirksamste einzelne Tor dieser Voreinstellung. */
  maxOdds: number;
  /** Erwartete Tore des ganzen Spiels. Der stärkste sportliche Messwert. */
  minExpectedGoals: number;
  /** Höchste zulässige Remiswahrscheinlichkeit des Modells. 1 schaltet das Tor ab. */
  maxDrawProbability: number;
  /**
   * Anteil der jüngsten Partien beider Mannschaften mit mindestens zwei Halbzeittoren.
   * 0 schaltet das Tor ab - es trägt allein nur +3,9 pp.
   */
  minFirstHalfRate: number;
}

/**
 * Was eine Strengestufe setzt. Die beiden Kerntore `minExpectedGoals` und
 * `maxDrawProbability` stehen bewusst **nicht** darin: Sie sind die Identität dieser
 * Voreinstellung - dieselbe Haltung wie bei den Kerntoren der „Dominanz".
 */
export type Hz15LevelValues = Pick<Hz15QuickpickSettings, "minOdds" | "maxOdds" | "minFirstHalfRate">;

const LEVELS: Record<"streng" | "ausgewogen" | "locker" | "weit", Hz15LevelValues> = {
  streng: { minOdds: 1.3, maxOdds: 1.95, minFirstHalfRate: 0.45 },
  ausgewogen: { minOdds: 1.3, maxOdds: 2.0, minFirstHalfRate: 0 },
  locker: { minOdds: 1.3, maxOdds: 2.1, minFirstHalfRate: 0 },
  weit: { minOdds: 1.3, maxOdds: 2.4, minFirstHalfRate: 0 }
};

/**
 * Auf den Knöpfen steht die **Trefferquote je Bein**, nicht der Ertrag: Der Zweck sind Kombis
 * über vier bis sieben Beine, und dort multipliziert sich genau diese Größe.
 */
export function hz15Note(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht geprüft";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  return `${proTag}/Tag · ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} % Treffer`;
}

export const HZ15_LEVELS: Array<QuickpickLevel<Hz15LevelValues>> = [
  {
    id: "streng", label: "Streng",
    measured: {
      n: 136, proTag: 4.7, trefferquote: 0.596, roi: 0.073,
      kombis: [
        { beine: 2, n: 2520, trefferquote: 0.337, quote: 3.23, roi: 0.095, erwartung: 0.152 },
        { beine: 3, n: 1600, trefferquote: 0.159, quote: 5.79, roi: -0.075, erwartung: 0.236 },
        { beine: 4, n: 1160, trefferquote: 0.079, quote: 10.34, roi: -0.175, erwartung: 0.326 },
        { beine: 5, n: 880, trefferquote: 0.031, quote: 18.67, roi: -0.4, erwartung: 0.423 },
        { beine: 6, n: 680, trefferquote: 0.01, quote: 34.13, roi: -0.684, erwartung: 0.527 },
        { beine: 7, n: 480, trefferquote: 0.004, quote: 60.26, roi: -0.783, erwartung: 0.639 }
      ]
    },
    hint: "Quote höchstens 1,95, und bei beiden Mannschaften müssen zuletzt oft zwei Tore"
      + " bis zur Pause gefallen sein. 6 von 10 Tipps stimmen – die beste Stufe, aber nur"
      + " knapp fünf Spiele am Tag.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 277, proTag: 9.2, trefferquote: 0.556, roi: 0.024,
      kombis: [
        { beine: 2, n: 5400, trefferquote: 0.298, quote: 3.43, roi: 0.009, erwartung: 0.049 },
        { beine: 3, n: 3480, trefferquote: 0.166, quote: 6.36, roi: 0.034, erwartung: 0.074 },
        { beine: 4, n: 2520, trefferquote: 0.09, quote: 11.77, roi: 0.018, erwartung: 0.1 },
        { beine: 5, n: 2000, trefferquote: 0.046, quote: 21.88, roi: -0.018, erwartung: 0.126 },
        { beine: 6, n: 1600, trefferquote: 0.022, quote: 40.71, roi: -0.176, erwartung: 0.153 },
        { beine: 7, n: 1360, trefferquote: 0.005, quote: 76.1, roi: -0.644, erwartung: 0.181 }
      ]
    },
    hint: "Quote höchstens 2,00, ohne Blick auf die letzten Halbzeiten. Gut 5 von 10 Tipps"
      + " stimmen, bei doppelt so vielen Spielen wie „Streng“. Die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: {
      n: 368, proTag: 12.2, trefferquote: 0.527, roi: -0.004,
      kombis: [
        { beine: 2, n: 7160, trefferquote: 0.268, quote: 3.64, roi: -0.047, erwartung: -0.007 },
        { beine: 3, n: 4760, trefferquote: 0.143, quote: 6.94, roi: -0.036, erwartung: -0.011 },
        { beine: 4, n: 3440, trefferquote: 0.067, quote: 13.23, roi: -0.158, erwartung: -0.015 },
        { beine: 5, n: 2680, trefferquote: 0.038, quote: 25.29, roi: -0.119, erwartung: -0.019 },
        { beine: 6, n: 2160, trefferquote: 0.018, quote: 48.22, roi: -0.233, erwartung: -0.022 },
        { beine: 7, n: 1760, trefferquote: 0.009, quote: 92.38, roi: -0.349, erwartung: -0.026 }
      ]
    },
    hint: "Quote höchstens 2,10. Mehr Spiele, aber nur noch etwa jeder zweite Tipp stimmt,"
      + " und unterm Strich bleibt nichts übrig.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: {
      n: 631, proTag: 20.8, trefferquote: 0.477, roi: -0.039,
      kombis: [
        { beine: 2, n: 12440, trefferquote: 0.225, quote: 4.21, roi: -0.087, erwartung: -0.076 },
        { beine: 3, n: 8120, trefferquote: 0.109, quote: 8.65, roi: -0.112, erwartung: -0.111 },
        { beine: 4, n: 6080, trefferquote: 0.05, quote: 17.77, roi: -0.195, erwartung: -0.146 },
        { beine: 5, n: 4840, trefferquote: 0.025, quote: 36.5, roi: -0.203, erwartung: -0.178 },
        { beine: 6, n: 3840, trefferquote: 0.011, quote: 75.01, roi: -0.301, erwartung: -0.21 },
        { beine: 7, n: 3400, trefferquote: 0.007, quote: 153.6, roi: -0.137, erwartung: -0.241 }
      ]
    },
    hint: "Quote höchstens 2,40. Nur zum Überblick: Weniger als jeder zweite Tipp stimmt,"
      + " und du verlierst auf Dauer.",
    values: LEVELS.weit
  }
];

export const DEFAULT_HZ15_SETTINGS: Hz15QuickpickSettings = {
  preset: "hz15",
  // Die Kerntore: gesetzt, nicht gestaffelt.
  minExpectedGoals: 3.2,
  maxDrawProbability: 0.23,
  ...LEVELS.ausgewogen
};

/**
 * Prüft eine Partie gegen die Torfolge. Die Reihenfolge der Tore ist die Reihenfolge der
 * Abweisungsgründe: Es gewinnt das erste greifende, damit jede Partie genau einmal zählt.
 *
 * Anders als die beiden 1X2-Voreinstellungen stützt diese keine **Seite**, sondern eine feste
 * Torlinie. `side` bleibt deshalb `null`, und `market` trägt `firstHalfOver15`.
 */
export function evaluateHz15(
  fixture: DashboardFixture,
  settings: Hz15QuickpickSettings
): QuickpickEvaluation {
  const market = marketOf(fixture, "firstHalfOver15");
  const draw = marketOf(fixture, "draw");
  const heim = firstHalfRateOf(fixture.form.homeMatches);
  const gast = firstHalfRateOf(fixture.form.awayMatches);
  // Nur wenn beide Seiten eine Grundlage haben, ist der Mittelwert eine Aussage. Sonst stünde
  // die Bilanz einer Mannschaft für die ganze Partie - das wäre keine Halbzeitbilanz.
  const hzRate = heim && gast ? (heim.rate + gast.rate) / 2 : null;

  const base = {
    fixtureId: fixture.fixtureId,
    market: "firstHalfOver15" as const,
    selection: market?.selection ?? "1. HZ Ü1,5",
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
    hz15: {
      expectedGoals: fixture.expectedGoals.total,
      expectedFirstHalfGoals: fixture.expectedFirstHalfGoals?.total ?? null,
      drawProbability: draw?.probability ?? null,
      firstHalfRate: hzRate,
      firstHalfSample: heim && gast ? Math.min(heim.sample, gast.sample) : 0,
      probability: market?.probability ?? 0
    }
  };

  const reject = (rejectedBy: QuickpickRejection): QuickpickEvaluation =>
    ({ ...base, passes: false, rejectedBy });

  if (market === undefined) return reject("keinMarkt");
  if (market.odds === null || market.odds <= 1) return reject("keineQuote");
  if (market.odds < settings.minOdds || market.odds > settings.maxOdds) return reject("quote");
  if (fixture.expectedGoals.total < settings.minExpectedGoals) return reject("torerwartung");
  // Führt der Lauf keinen Remismarkt, wird das Tor übersprungen statt als erfüllt gewertet:
  // Die Remiswahrscheinlichkeit ist ein Zusatztor, die Torerwartung trägt die Auswahl.
  if (settings.maxDrawProbability < 1 && draw !== undefined
    && draw.probability >= settings.maxDrawProbability) return reject("remisbild");
  if (settings.minFirstHalfRate > 0 && (hzRate === null || hzRate < settings.minFirstHalfRate)) {
    return reject("hzHistorie");
  }

  return { ...base, passes: true, rejectedBy: null };
}

export const HZ15_PRESET: QuickpickPreset<Hz15QuickpickSettings> = {
  id: "hz15",
  label: "Erste Halbzeit: zwei Tore",
  short: "1. HZ 2 Tore",
  description: "Spiele, in denen schon bis zur Pause mindestens zwei Tore fallen sollen."
    + " Gesucht wird keine Mannschaft, sondern ein torreiches Spiel: viele erwartete Tore,"
    + " wenig Chance auf ein Unentschieden, und eine Quote, die sich noch lohnt.",
  criteria: [
    "Mindestens 3,2 erwartete Tore im ganzen Spiel – das wichtigste Merkmal",
    "Höchstens 23 % Chance auf ein Unentschieden – offene Spiele statt abwartender",
    "Quote höchstens 2,00 – wirkt am stärksten, weil auch der Buchmacher Tore erwartet",
    "Die letzten Halbzeiten beider Mannschaften zählen nur in der strengsten Stufe",
    "Abwehrwerte spielen bewusst keine Rolle – sie helfen hier nachweislich nicht"
  ],
  massstab: "trefferquote",
  kennzahlOf: (measured) => ({
    label: "Treffer je Tipp",
    wert: measured === null ? "–" : `${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht geprüft" : `an ${measured.n} alten Wetten geprüft`,
    titel: measured === null
      ? "Diese Stufe wurde noch nicht an alten Spielen geprüft."
      : `So oft fielen bis zur Pause wirklich zwei Tore: ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`
        + ` (an ${measured.n} alten Wetten geprüft). Ohne Filter sind es nur 35 %. In einer Kombi`
        + ` müssen alle Tipps stimmen – deshalb zählt genau dieser Wert.`
  }),
  honesty: "Der Filter hilft deutlich: Statt 35 von 100 Spielen stimmen gut 55. Aber der"
    + " größere Teil davon kommt aus der Quotengrenze, also aus der Meinung des Buchmachers –"
    + " das Modell steuert nur wenig bei. Und für Kombis bleibt es schwierig: Ein Schein mit"
    + " vier Spielen geht in 9 von 100 Fällen durch, mit sechs Spielen in 2 von 100.",
  wettschein: {
    hinweis: "Legt jedes gefundene Spiel als „1. Halbzeit über 1,5 Tore“ in den Wettschein."
      + " Ein Sieger-Tipp zum selben Spiel bleibt daneben bestehen."
  },
  leerSatz: "Kein Spiel verspricht genug Tore zu diesem Preis.",
  defaults: DEFAULT_HZ15_SETTINGS,
  levels: HZ15_LEVELS,
  defaultSort: "torerwartung",
  evaluate: (fixture, settings) => evaluateHz15(fixture, settings),
  noteOf: hz15Note
};
