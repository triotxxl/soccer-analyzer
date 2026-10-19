import type { DashboardFixture } from "./dashboard.ts";
import { KOMBI_RULE, chooseTip, flagsOf, tipsOf, type KombiTip } from "./kombi-tipps.ts";
import type {
  QuickpickEvaluation,
  QuickpickLevel,
  QuickpickMeasurement,
  QuickpickPreset,
  QuickpickRejection
} from "./quickpick-core.ts";

/**
 * Voreinstellung „Kombi-Tipps ab 1,60“: je Spiel der Tipp, dem die Tipico-Quote ohne Aufschlag
 * die höchste Chance gibt, mit Quote mindestens 1,60 (Davids Auftrag vom 14.10.2026: „die
 * sichersten Tipps mit Quote mindestens 1,6“). Maßstab ist die Trefferquote je Tipp - die Tipps
 * sind Beine für Kombis.
 *
 * ## Dieselbe Regel wie `npm run kombi-tipps`
 *
 * `tipsOf`, `chooseTip` und `flagsOf` kommen unverändert aus `src/kombi-tipps.ts`, es gibt keine
 * zweite Fassung. Zwei Abweichungen, beide bewusst:
 * - `chooseTip` läuft mit `preferredOdds = minOdds`. Die Vorliebe „lieber ab 1,60“ des Werkzeugs
 *   (Mindestquote 1,50) entfällt, weil 1,60 hier die Untergrenze ist. Damit gleicht die Stufe
 *   „Weit“ genau `npm run kombi-tipps -- --min-quote 1.6`.
 * - `flagsOf` ohne Tipico-Anstoß: Der Snapshot trägt ihn nicht. Die Prüfung hätte an alten
 *   Spielen 12 von 3.913 Spielen ausgeschlossen, alle richtig zugeordnet (Prüfer, 14.10.2026).
 *
 * Das Modell entscheidet nicht mit. Es weiß über den fairen Preis hinaus nichts (AGENTS.md,
 * „Kelly-Automatik und Marktprofil“), seine Chance steht nur aufgeklappt und ohne Abstand da -
 * neben der Tipico-Chance würde der Abstand als Vorteil gelesen.
 *
 * ## Stufen über eine Höchstquote (Prüfer, 14.10.2026, vorab festgelegt)
 *
 * Bei fester Mindestquote staffelt eine Mindest-Chance fast dasselbe wie eine Höchstquote
 * (fair = 1 / (Quote × Aufschlag), Überschneidung 86-99 %). Die Höchstquote ist verständlicher
 * und hängt nur am gezeigten Preis; die 17 Spiele, die nur die Chance-Fassung hatte, trafen
 * 41,2 ± 11,9 %. Sie gilt für den **gewählten** Tipp, nicht vorher - sonst wäre es eine zweite
 * Fassung der Regel. Vorgabe ist die strengste Stufe mit einem Median von mindestens 12 Tipps je
 * Tag, das ist „Streng“.
 *
 * Gemessen 10.09.-15.10.2026, je Spiel der letzte Stand vor Anpfiff, Snapshot-Preis:
 *
 * | Stufe | Quote | n | /Tag (Median) | Treffer | fair | Ertrag je Tipp | 4er geht auf |
 * |---|---|---|---|---|---|---|---|
 * | Streng | 1,60-1,65 | 2.038 | 59,3 (39) | 57,5 ± 1,1 % | 56,8 % | −6,9 ± 1,8 % | 11,0 % |
 * | Ausgewogen | bis 1,70 | 2.974 | 86,5 (55) | 56,4 ± 0,9 % | 56,1 % | −7,5 ± 1,5 % | 9,9 % |
 * | Locker | bis 1,80 | 3.662 | 106,5 (69) | 55,7 ± 0,8 % | 55,4 % | −7,6 ± 1,4 % | 9,2 % |
 * | Weit | ohne | 3.902 | 113,5 (72) | 54,8 ± 0,8 % | 54,6 % | −7,9 ± 1,3 % | 9,2 % |
 *
 * Alle Stufen treffen so oft wie der faire Preis, in beiden Zeithälften und ab 05.10. Der
 * Verlust je Tipp ist der Aufschlag. **Keine Zusatzbedingung macht einen Tipp nachweislich
 * sicherer:** 1X2-Favorit bis 1,90 +3,0 ± 3,3 Punkte über fair, „Modell ≥ 8 Punkte unter fair“
 * +2,4 ± 2,2 - beide nicht in beiden Zeithälften über zwei Standardfehlern. Nicht einbauen,
 * ohne vorab festgelegt neu zu messen.
 *
 * Nicht in `MODEL_BOUND_PRESETS`: Auswahl und Preis hängen nicht am Modell. Das Modell wirkt nur
 * über den Modellabstand in `flagsOf` und `probabilityReliable` beim 1X2.
 *
 * „Nur die besten N“ (`limit`) steht in `applyQuickpick`, nicht hier: Die Regel bewertet jedes
 * Spiel für sich, die Rückrechnung ruft `evaluateFixture` und misst die Stufen ohne Grenze.
 */

export interface KombiQuickpickSettings {
  preset: "kombi";
  /** Die Identität: kein Tipp darunter. Abweichend ab Werk heißt „eigene Werte“. */
  minOdds: number;
  /** Die Stufe: Höchstquote des gewählten Tipps. 99 heißt: keine Grenze. */
  maxOdds: number;
  /** Nur die besten N nach Chance laut Tipico; `null` = alle. Wirkt in `applyQuickpick`. */
  limit: number | null;
}

export type KombiLevelValues = Pick<KombiQuickpickSettings, "maxOdds">;

const LEVELS: Record<"streng" | "ausgewogen" | "locker" | "weit", KombiLevelValues> = {
  streng: { maxOdds: 1.65 },
  ausgewogen: { maxOdds: 1.7 },
  locker: { maxOdds: 1.8 },
  weit: { maxOdds: 99 }
};

const percent = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;

/** Auf den Knöpfen steht die Trefferquote je Tipp - der Zweck sind Kombis. */
export function kombiNote(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht geprüft";
  return `${measured.proTag.toFixed(1).replace(".", ",")}/Tag · ${percent(measured.trefferquote)} Treffer`;
}

/**
 * Gemessen vom Prüfer am 14.10.2026 (Tabelle oben). „Je Tag“ ist das Mittel über den ganzen
 * Zeitraum; die Wochenenden treiben es, unter der Woche sind es deutlich weniger.
 */
export const KOMBI_LEVELS: Array<QuickpickLevel<KombiLevelValues>> = [
  {
    id: "streng", label: "Streng",
    measured: {
      n: 2038, proTag: 59.3, trefferquote: 0.575, roi: -0.069,
      kombis: [
        { beine: 2, n: 40520, trefferquote: 0.33, quote: 2.6, roi: -0.134, erwartung: -0.133 },
        { beine: 3, n: 26880, trefferquote: 0.187, quote: 4.3, roi: -0.204, erwartung: -0.193 },
        { beine: 4, n: 20080, trefferquote: 0.106, quote: 6.9, roi: -0.27, erwartung: -0.248 },
        { beine: 5, n: 16000, trefferquote: 0.061, quote: 11.2, roi: -0.313, erwartung: -0.3 },
        { beine: 6, n: 13240, trefferquote: 0.035, quote: 18.1, roi: -0.377, erwartung: -0.348 },
        { beine: 7, n: 11320, trefferquote: 0.02, quote: 29.3, roi: -0.398, erwartung: -0.393 }
      ]
    },
    hint: "Quote 1,60 bis 1,65. Knapp 6 von 10 Tipps stimmen – so oft, wie die Quote sagt."
      + " Die Vorgabe.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: { n: 2974, proTag: 86.5, trefferquote: 0.564, roi: -0.075 },
    hint: "Quote 1,60 bis 1,70. Mehr Spiele, ein Tipp stimmt etwas seltener.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: { n: 3662, proTag: 106.5, trefferquote: 0.557, roi: -0.076 },
    hint: "Quote 1,60 bis 1,80. Noch mehr Spiele, gut jeder zweite Tipp stimmt.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: { n: 3902, proTag: 113.5, trefferquote: 0.548, roi: -0.079 },
    hint: "Ohne Grenze nach oben: jedes Spiel mit einem Tipp ab 1,60. Nur zum Überblick.",
    values: LEVELS.weit
  }
];

export const DEFAULT_KOMBI_SETTINGS: KombiQuickpickSettings = {
  preset: "kombi", minOdds: 1.6, limit: null, ...LEVELS.streng
};

/** Der Tipp mit der höchsten Chance laut Tipico unter den übrigen ab der Mindestquote. */
function ersatzOf(tips: KombiTip[], chosen: KombiTip, minOdds: number): KombiTip | null {
  return tips
    .filter((tip) => tip !== chosen && tip.odds >= minOdds)
    .reduce<KombiTip | null>((best, tip) => (best === null || tip.fair > best.fair ? tip : best), null);
}

/**
 * Prüft ein Spiel. Es gewinnt der erste greifende Grund, damit jedes Spiel in der Bilanz genau
 * einmal zählt: kein Tipp ab der Mindestquote, Quote über der Stufe, auffällig.
 */
export function evaluateKombi(fixture: DashboardFixture, settings: KombiQuickpickSettings): QuickpickEvaluation {
  const tips = tipsOf(fixture);
  const choice = chooseTip(tips, {
    minOdds: settings.minOdds, preferredOdds: settings.minOdds, preferMargin: KOMBI_RULE.preferMargin
  });
  const chosen = choice?.chosen ?? null;

  const base = {
    fixtureId: fixture.fixtureId,
    market: chosen?.marketKey ?? "1x2",
    selection: chosen?.selection ?? "",
    // Beim 1X2 die Mannschaft des Tipps, nicht `pick`: Die Chance laut Tipico kann die andere
    // Seite vorn sehen. Ohne Seite übersprängen Wettschein und Rückrechnung den Tipp.
    side: chosen?.side ?? null,
    venueSide: null,
    pick: fixture.markets.find((market) => market.key === "1x2")?.pick ?? null,
    homePercent: 0,
    awayPercent: 0,
    venueScope: fixture.form.scope,
    points: fixture.scores.favorite,
    odds: chosen?.odds ?? null,
    dominance: null,
    superiority: null,
    kombi: chosen === null ? null : {
      chosen,
      ersatz: ersatzOf(tips, chosen, settings.minOdds),
      flags: flagsOf(fixture)
    }
  };

  const reject = (rejectedBy: QuickpickRejection): QuickpickEvaluation => ({ ...base, passes: false, rejectedBy });

  if (chosen === null) return reject("keinKombiTipp");
  // Erst die Stufe, dann auffällig: So zählt „n auffällige Spiele weggelassen“ nur, was die
  // gewählte Stufe wirklich verloren hat (Davids Entscheidung vom 14.10.2026). Welche Spiele
  // durchkommen, ändert die Reihenfolge nicht.
  if (chosen.odds > settings.maxOdds) return reject("quote");
  if (base.kombi!.flags.length > 0) return reject("auffaellig");
  return { ...base, passes: true, rejectedBy: null };
}

export const KOMBI_PRESET: QuickpickPreset<KombiQuickpickSettings> = {
  id: "kombi",
  label: "Kombi-Tipps ab 1,60",
  group: "tipico",
  description: "Je Spiel genau ein Tipp aus allen Wettarten: der, dem die Tipico-Quote ohne"
    + " Aufschlag die höchste Chance gibt – Quote ab 1,60. Das Modell entscheidet nicht mit.",
  criteria: [
    "Je Spiel nur ein Tipp – aus Sieg, Remis, BTTS (beide Teams treffen) und allen Torlinien,"
      + " auch der 1. Halbzeit",
    "Maßstab ist die Chance laut Tipico: die Chance, die Tipico dem Tipp selbst gibt, aus der"
      + " Quote ohne Aufschlag gerechnet",
    "Quote ab 1,60. Die Stufen begrenzen die Quote nach oben – je näher an 1,60, desto"
      + " wahrscheinlicher der Tipp",
    "Nur Tipps, bei denen Tipico auch die Gegenseite anbietet – sonst lässt sich der Aufschlag"
      + " nicht herausrechnen",
    "Die wahrscheinlichsten Tipps liegen fast alle knapp über 1,60. Fällt eine Quote in der"
      + " Tipico-App darunter, nimm den Ersatz (aufgeklappt) oder das nächste Spiel der Liste",
    "Auffällige Spiele fallen weg und stehen unter der Liste",
    "Bei Spielen zwischen verschiedenen Ligen ohne Stärkevergleich fällt der Sieger-Tipp weg"
  ],
  massstab: "trefferquote",
  kennzahlOf: (measured) => ({
    label: "Treffer je Tipp",
    wert: measured === null ? "–" : percent(measured.trefferquote),
    notiz: measured === null ? "noch nicht geprüft" : `an ${measured.n} alten Tipps geprüft`,
    titel: measured === null
      ? "Diese Stufe wurde noch nicht an alten Spielen geprüft."
      : `So oft stimmte der Tipp wirklich: ${percent(measured.trefferquote)} (an ${measured.n} alten`
        + " Tipps geprüft). Laut Tipico-Quote war etwa genauso viel zu erwarten – der Filter findet"
        + " die wahrscheinlichsten Tipps, keinen Vorteil."
  }),
  honesty: "Gut 5 von 10 Tipps stimmen – genau so oft, wie die Quote es sagt. Der Filter sucht je"
    + " Spiel den wahrscheinlichsten Tipp ab 1,60, keinen Vorteil. Der Aufschlag von Tipico steckt"
    + " in jedem Tipp: Eine Kombi aus 4 Tipps geht etwa jedes zehnte Mal auf und kostet auf Dauer"
    + " rund ein Viertel des Einsatzes, eine aus 7 rund 40 %. Eine Liste, die gut getroffen hat,"
    + " beweist nichts. Rechne nicht mit Gewinn. Die Quoten sind so alt wie die letzte Analyse –"
    + " prüf jeden Preis vor dem Setzen in der Tipico-App; fällt er unter 1,60, nimm den Ersatz"
    + " oder das nächste Spiel.",
  warnung: "Rechne nicht mit Gewinn, denn der Aufschlag von Tipico steckt in jedem Tipp – und prüf"
    + " jeden Preis vor dem Setzen in der Tipico-App.",
  wettschein: {
    hinweis: "Legt je Spiel den gefundenen Tipp in den Wettschein, egal welche Wettart. Setz jede"
      + " Kombi vor ihrem ersten Anstoß."
  },
  leerSatz: "Kein Spiel hat in dieser Stufe einen passenden Tipp.",
  defaults: DEFAULT_KOMBI_SETTINGS,
  levels: KOMBI_LEVELS,
  defaultSort: "strength",
  evaluate: (fixture, settings) => evaluateKombi(fixture, settings),
  noteOf: kombiNote
};
