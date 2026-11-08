import type { DashboardFixture } from "./dashboard.ts";
import {
  h2hDominance,
  oneXTwoMarket,
  superiorityOf,
  venueFormPercent,
  type QuickpickEvaluation,
  type QuickpickLevel,
  type QuickpickMeasurement,
  type QuickpickPreset,
  type QuickpickLevelId,
  type QuickpickPresetId,
  type QuickpickRejection
} from "./quickpick-core.ts";

/**
 * Quickpicker: Voreingestellte Torfolgen über den bereits geladenen Snapshot.
 *
 * Zweck ist die **Kombi**: Gesucht sind klar überlegene Mannschaften, die als Bein einer
 * langen Wette zuverlässig durchkommen. Der Maßstab ist deshalb die Trefferquote je Bein,
 * nicht der Ertrag einer Einzelwette - eine Kombi multipliziert beides, im Guten wie im
 * Schlechten. Bei -10 % je Bein bleibt von einer Sechserkombi im Erwartungswert die Hälfte
 * übrig; bei +3 % je Bein sind es 117 %.
 *
 * Der Quickpicker rechnet **keine eigene Punktzahl**. Das ist die Regel aus AGENTS.md:
 * 1X2-Favoritenpunkte entstehen ausschließlich in `src/favorite-criteria.ts`. Alles hier sind
 * unabhängige Tore mit einer Schwelle, keine gewichtete Summe.
 *
 * Woher die Zahlen kommen:
 * - 70 / 50 / Quote 1,30 sind die Vorgaben von `runVenueFormFilter` (`src/venue-form.ts`).
 * - Die Punkteformel Sieg 3, Remis 1, Niederlage 0 ist die aus `venueFormStats` (ebenda).
 * - 70 Favoritenpunkte ist das Band "stark" aus `rating()` (`src/favorite-criteria.ts`).
 * - Die Tabellenschwellen 0,5 Punkte je Spiel, 0,4 Tordifferenz je Spiel und 3 Plätze sind
 *   **gesetzt, nicht gemessen**: Sie sollen "klar überlegen" abbilden, und ihr messbarer
 *   Beitrag zur Trefferquote ist klein. Sie stehen hier, weil ohne sie Partien durchrutschen,
 *   in denen beide Mannschaften gleich stark sind - der Fall, an dem der erste Entwurf
 *   gescheitert ist (Inter gegen FAS am 16.09.2026: 2,00 zu 2,00 Punkte je Spiel).
 *
 * Rückrechnung, Stand 21.09.2026 über 5.628 abgerechnete Partien: Die Vorgabestufe liefert
 * 191 Tipps, 66,5 % Treffer (±3,4), Quote Ø 1,69, ROI -0,8 %; erste Hälfte 68,4 %, zweite
 * 64,6 %. **Keine der vier Stufen misst einen Gewinn**, die Vorgabe liegt ungefähr bei null,
 * die übrigen zwischen -4,5 und -8,2 %.
 *
 * Die frühere Messung (61 Tipps, 70,5 %, ROI +2,7 %) hielt nur, solange die Stichprobe klein
 * war; auf dem doppelten Bestand ist der Vorsprung verschwunden. Bei ±3,4 Punkten Streuung war
 * er nie belegt, und die Punktegrenze 70 stammt aus einem Durchprobieren der Regler an genau
 * denselben Daten. Wer eine Schwelle anfasst, misst deshalb zuerst neu.
 */

export interface DavesQuickpickSettings {
  preset: "daves1x2";
  /** Formwert der stärkeren Seite in Prozent. 70 aus `runVenueFormFilter`. */
  strongMinimum: number;
  /** Höchstwert der schwächeren Seite in Prozent. 50 aus `runVenueFormFilter`. */
  weakMaximum: number;
  /** Mindestquote. 1,30 aus `runVenueFormFilter`. */
  minOdds: number;
  /** Mindestpunkte aus `scores.favorite`. 70 ist das Band "stark" aus `rating()`. */
  minPoints: number;
  /** Vorsprung in Punkten je Spiel, den die Tabelle zeigen muss. */
  minPointsPerGame: number;
  /** Vorsprung in Tordifferenz je Spiel. */
  minGoalDifference: number;
  /** Vorsprung in Tabellenplätzen. */
  minPositionGap: number;
  /** Nur Partien mit mindestens zwei gewonnenen Duellen in Folge auf der gestützten Seite. */
  requireStreak: boolean;
}

/** Die Felder, die eine Strengestufe setzt. Quote und Serie bleiben davon unberührt. */
export type QuickpickLevelValues = Pick<DavesQuickpickSettings,
  "strongMinimum" | "weakMaximum" | "minPoints" | "minPointsPerGame" | "minGoalDifference" | "minPositionGap">;

/**
 * Auf den Knöpfen steht die Menge gegen die Zuverlässigkeit: Tipps je Tag und Trefferquote je
 * Bein. Für eine Kombi ist die Trefferquote der Maßstab, nicht der Ertrag der Einzelwette.
 */
export function davesNote(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht geprüft";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  const quote = (measured.trefferquote * 100).toFixed(1).replace(".", ",");
  return `${proTag}/Tag · ${quote} %`;
}

/**
 * Vier Strengestufen. Die Zahlen daneben sind **gemessen**, nicht geschätzt: Rückrechnung über
 * 12.041 abgerechnete Partien, Stand 04.11.2026, je Partie der jüngste Snapshot.
 *
 * **Die Reihenfolge sagt nichts über die Zuverlässigkeit.** `streng` misst 64,6 % (±2,9) gegen
 * 63,8 % (±2,1) bei `ausgewogen` und kostet dabei die Hälfte der Partien. Der Unterschied liegt
 * weit innerhalb der Streuung; am 21.09.2026 lag `ausgewogen` noch vorn (66,5 gegen 64,2 %), beide
 * Vorsprünge waren Zufall. „Die beste Stufe“ gehört deshalb auf keinen Knopf.
 *
 * Bewusst nicht gestaffelt ist `minPoints`: Unterhalb von 70 bricht die Trefferquote
 * unverhältnismäßig ein (65 -> 59,4 %, 60 -> 54,1 %). Nur die weiteste Stufe fasst es an.
 */
const LEVELS: Record<QuickpickLevelId, QuickpickLevelValues> = {
  streng: { strongMinimum: 70, weakMaximum: 50, minPoints: 70, minPointsPerGame: 0.5, minGoalDifference: 0.4, minPositionGap: 3 },
  ausgewogen: { strongMinimum: 60, weakMaximum: 50, minPoints: 70, minPointsPerGame: 0.2, minGoalDifference: 0, minPositionGap: 1 },
  locker: { strongMinimum: 50, weakMaximum: 67, minPoints: 70, minPointsPerGame: 0.2, minGoalDifference: 0, minPositionGap: 1 },
  weit: { strongMinimum: 50, weakMaximum: 67, minPoints: 65, minPointsPerGame: 0.2, minGoalDifference: 0, minPositionGap: 1 }
};

export const QUICKPICK_LEVELS: Array<QuickpickLevel<QuickpickLevelValues>> = [
  {
    id: "streng", label: "Streng",
    measured: {
      n: 280, proTag: 3.8, trefferquote: 0.646, roi: -0.04,
      kombis: [
        { beine: 2, n: 5240, trefferquote: 0.404, quote: 2.31, roi: -0.103, erwartung: -0.078 },
        { beine: 3, n: 3320, trefferquote: 0.267, quote: 3.55, roi: -0.119, erwartung: -0.115 },
        { beine: 4, n: 2240, trefferquote: 0.171, quote: 5.4, roi: -0.143, erwartung: -0.15 },
        { beine: 5, n: 1680, trefferquote: 0.102, quote: 8.09, roi: -0.306, erwartung: -0.184 },
        { beine: 6, n: 1320, trefferquote: 0.046, quote: 12.74, roi: -0.501, erwartung: -0.216 },
        { beine: 7, n: 920, trefferquote: 0.016, quote: 19.18, roi: -0.781, erwartung: -0.247 }
      ]
    },
    hint: "Die engste Auswahl: knapp 2 von 3 Tipps stimmen – praktisch so oft wie bei"
      + " „Ausgewogen“, bei halb so vielen Spielen.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 541, proTag: 7.1, trefferquote: 0.638, roi: -0.046,
      kombis: [
        { beine: 2, n: 10440, trefferquote: 0.403, quote: 2.36, roi: -0.099, erwartung: -0.089 },
        { beine: 3, n: 6720, trefferquote: 0.246, quote: 3.65, roi: -0.167, erwartung: -0.131 },
        { beine: 4, n: 4920, trefferquote: 0.164, quote: 5.59, roi: -0.17, erwartung: -0.17 },
        { beine: 5, n: 3720, trefferquote: 0.104, quote: 8.7, roi: -0.205, erwartung: -0.208 },
        { beine: 6, n: 2880, trefferquote: 0.074, quote: 13.29, roi: -0.186, erwartung: -0.244 },
        { beine: 7, n: 2480, trefferquote: 0.036, quote: 20.8, roi: -0.368, erwartung: -0.279 }
      ]
    },
    hint: "Knapp 2 von 3 Tipps stimmen, bei rund doppelt so vielen Spielen wie bei „Streng“."
      + " Die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: {
      n: 735, proTag: 9.6, trefferquote: 0.633, roi: -0.051,
      kombis: [
        { beine: 2, n: 14360, trefferquote: 0.398, quote: 2.36, roi: -0.106, erwartung: -0.1 },
        { beine: 3, n: 9240, trefferquote: 0.26, quote: 3.64, roi: -0.124, erwartung: -0.147 },
        { beine: 4, n: 6840, trefferquote: 0.169, quote: 5.6, roi: -0.154, erwartung: -0.191 },
        { beine: 5, n: 5280, trefferquote: 0.114, quote: 8.61, roi: -0.144, erwartung: -0.232 },
        { beine: 6, n: 4320, trefferquote: 0.077, quote: 13.22, roi: -0.143, erwartung: -0.272 },
        { beine: 7, n: 3600, trefferquote: 0.042, quote: 20.56, roi: -0.276, erwartung: -0.309 }
      ]
    },
    hint: "Mehr Auswahl: gut 6 von 10 Tipps stimmen, und auf Dauer verlierst du damit"
      + " Geld.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: {
      n: 987, proTag: 12.8, trefferquote: 0.609, roi: -0.067,
      kombis: [
        { beine: 2, n: 19440, trefferquote: 0.371, quote: 2.49, roi: -0.129, erwartung: -0.13 },
        { beine: 3, n: 12440, trefferquote: 0.233, quote: 3.94, roi: -0.163, erwartung: -0.188 },
        { beine: 4, n: 9360, trefferquote: 0.138, quote: 6.24, roi: -0.249, erwartung: -0.243 },
        { beine: 5, n: 7280, trefferquote: 0.085, quote: 9.8, roi: -0.295, erwartung: -0.293 },
        { beine: 6, n: 5880, trefferquote: 0.055, quote: 15.57, roi: -0.295, erwartung: -0.341 },
        { beine: 7, n: 5000, trefferquote: 0.034, quote: 24.59, roi: -0.337, erwartung: -0.385 }
      ]
    },
    hint: "Nur zum Überblick, nicht zum Spielen: rund 6 von 10 Tipps stimmen, und der"
      + " Verlust ist der größte der vier Stufen.",
    values: LEVELS.weit
  }
];


export const DEFAULT_QUICKPICK_SETTINGS: DavesQuickpickSettings = {
  preset: "daves1x2",
  minOdds: 1.3,
  // Ausgewogen statt streng: Zwei Tipps am Tag tragen keine lange Kombi, und der Unterschied
  // in der Zuverlässigkeit ist mit 1,8 Punkten kleiner als die Streuung der Messung.
  ...LEVELS.ausgewogen,
  // Aus: Über die Rückrechnung trug die Serie nichts bei (58,3 % gegen 55,6 % ohne sie), und
  // als Pflicht bliebe fast nichts übrig.
  requireStreak: false
};

export const DAVES_PRESET: QuickpickPreset<DavesQuickpickSettings> = {
  id: "daves1x2",
  label: "Daves 1x2-Filter",
  group: "daves",
  description: "Klar überlegene Mannschaften für eine Kombi: Die Tabelle muss den Vorsprung"
    + " zeigen, die Form ihn bestätigen, und die direkten Duelle (H2H) dürfen nicht dagegen"
    + " sprechen.",
  // Ohne feste Zahlen, weil die Strengestufe sie verschiebt - die eingestellten Werte
  // stehen darunter in den Reglern.
  criteria: [
    "Tabelle: mehr Punkte je Spiel, weiter vorn und keine schlechtere Tordifferenz",
    "Letzte Spiele am Ort: die getippte Mannschaft besser als der Gegner – wie deutlich,"
      + " bestimmt die Stufe. Ein Remis zählt nicht als Niederlage",
    "Direkte Duelle: kein Rückstand und keine Niederlagen in Folge, sobald es zwei Duelle gibt",
    "Das Modell hält den Favoriten für stark genug",
    "Quote ab 1,30, und das Modell tippt dieselbe Mannschaft"
  ],
  massstab: "trefferquote",
  kennzahlOf: (measured) => ({
    label: "Treffer je Tipp",
    wert: measured === null ? "–" : `${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht geprüft" : `an ${measured.n} alten Tipps geprüft`,
    titel: measured === null
      ? "Diese Stufe wurde noch nicht an alten Spielen geprüft."
      : `So oft stimmte ein einzelner Tipp: ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`
        + ` (an ${measured.n} alten Tipps geprüft). In einer Kombi müssen alle stimmen, deshalb`
        + ` wird es schnell weniger: vier Tipps ${(measured.trefferquote ** 4 * 100).toFixed(1).replace(".", ",")} %,`
        + ` sechs Tipps ${(measured.trefferquote ** 6 * 100).toFixed(1).replace(".", ",")} %.`
  }),
  honesty: "Rechne nicht mit Gewinn. Knapp 2 von 3 Tipps stimmten – aber zu den Quoten, die es"
    + " dafür gibt, stand am Ende jede Stufe im Minus, auch die Vorgabe. Dazu wurden die"
    + " Schwellen an genau den Spielen gesucht, an denen sie jetzt"
    + " gemessen werden. In einer Kombi müssen alle Tipps stimmen: Je mehr Spiele du"
    + " zusammenlegst, desto seltener geht der Schein durch.",
  warnung: "Jede Stufe lag an alten Spielen im Minus – und je mehr Spiele in der Kombi, desto"
    + " seltener geht der Schein durch. Rechne nicht mit Gewinn.",
  wettschein: {
    hinweis: "Legt den Sieger-Tipp jedes gefundenen Spiels in den Wettschein. Dort baust du"
      + " dir daraus deine Kombis."
  },
  leerSatz: "Kein Spiel ist nach diesen Kriterien klar überlegen.",
  defaults: DEFAULT_QUICKPICK_SETTINGS,
  levels: QUICKPICK_LEVELS,
  defaultSort: "kickoff",
  evaluate: (fixture, settings) => evaluateDaves(fixture, settings),
  noteOf: davesNote
};

/**
 * So viele Ergebnisse muss eine Seite mitbringen, damit ihr Formwert als gemessen gilt.
 *
 * Der Grund ist ein Vorzeichenfehler in der Grundlage, kein Geschmack: `venueFormPercent`
 * gibt für eine leere Liste 0 zurück, weil dort nicht durch null geteilt werden darf. Dieses
 * 0 ist aber nicht "miserable Form", sondern "keine Form" - und im Tor `otherPercent <=
 * weakMaximum` liest es sich als das stärkste denkbare Argument für den Gegner. Eine
 * Mannschaft ohne überlieferte Auswärtsspiele erfüllte damit jede Schwäche-Schwelle.
 *
 * Drei statt fünf, weil ein einzelner Sieg 100 % und eine einzelne Niederlage 0 % ergibt und
 * beides nichts bedeutet. Im archivierten Bestand kostet die Grenze einen einzigen Treffer.
 */
const MIN_FORM_SAMPLE = 3;

/**
 * Die Seite, auf die die Venue-Form zeigt - nur zur Anzeige. `null`, wenn keine Seite die
 * Schwellen allein erfüllt oder beide es tun.
 */
function venueSideOf(home: number, away: number, settings: DavesQuickpickSettings): "1" | "2" | null {
  const homeStronger = home >= settings.strongMinimum && away <= settings.weakMaximum;
  const awayStronger = away >= settings.strongMinimum && home <= settings.weakMaximum;
  if (homeStronger === awayStronger) return null;
  return homeStronger ? "1" : "2";
}

/**
 * Das Formtor, formuliert als **Veto auf den Modelltipp** statt als Seitenwahl: Die getippte
 * Seite muss den starken Wert erreichen, die andere unter dem schwachen bleiben.
 *
 * Diese Formulierung ist gleichbedeutend mit "die Form zeigt auf die getippte Seite", solange
 * sich die Schwellen nicht überlappen - und sie macht den Grenzfall eindeutig, in dem sie es
 * doch tun. Mit `strongMinimum: 0` und `weakMaximum: 100` ist das Tor damit sauber **aus**:
 * Jede Partie erfüllt beide Bedingungen. Die frühere Fassung wählte eine Seite und lieferte in
 * genau diesem Fall "keine Seite eindeutig" - der Filter zeigte dann null Treffer, obwohl der
 * Benutzer ihn abschalten wollte.
 *
 * `seitenkonflikt` bleibt als eigener Grund erhalten, weil er etwas anderes aussagt als
 * "keine Seite klar stärker": Dort zeigt die Form ausdrücklich auf den Gegner.
 */
function venueGate(
  pickPercent: number,
  otherPercent: number,
  settings: DavesQuickpickSettings
): "ok" | "venueForm" | "seitenkonflikt" {
  if (pickPercent >= settings.strongMinimum && otherPercent <= settings.weakMaximum) return "ok";
  if (otherPercent >= settings.strongMinimum && pickPercent <= settings.weakMaximum) return "seitenkonflikt";
  return "venueForm";
}

/**
 * Prüft eine Partie gegen die Torfolge. Die Reihenfolge der Tore ist die Reihenfolge der
 * Abweisungsgründe: Es gewinnt das erste greifende, damit jede Partie in der Bilanz genau
 * einmal gezählt wird.
 */
export function evaluateDaves(
  fixture: DashboardFixture,
  settings: DavesQuickpickSettings
): QuickpickEvaluation {
  const market = oneXTwoMarket(fixture);
  const pick = market?.pick ?? null;
  const homePercent = venueFormPercent(fixture.form.home);
  const awayPercent = venueFormPercent(fixture.form.away);
  const venueSide = venueSideOf(homePercent, awayPercent, settings);
  // Gestützt wird immer die Seite des Modells: Für die Gegenseite führt der Snapshot weder
  // Quote noch Wahrscheinlichkeit, zwei der fünf Kriterien wären dort gar nicht prüfbar.
  // Gemessen lagen solche Zeilen bei 29,5 % Treffern gegen 55,6 % auf der Modellseite.
  const gate = pick === null ? "venueForm" : venueGate(
    pick === "1" ? homePercent : awayPercent,
    pick === "1" ? awayPercent : homePercent,
    settings
  );
  const side = gate === "ok" ? pick : null;
  const reference = pick;

  const base = {
    fixtureId: fixture.fixtureId,
    // Diese Voreinstellung stützt eine Seite des 1X2-Marktes. Markt und Auswahl stehen
    // ausdrücklich dabei, damit Wettschein und Rückrechnung keine Seite voraussetzen müssen.
    market: "1x2" as const,
    selection: side === null ? ""
      : side === "1" ? `Heimsieg ${fixture.homeTeam}` : `Auswärtssieg ${fixture.awayTeam}`,
    side,
    venueSide,
    pick,
    homePercent,
    awayPercent,
    venueScope: fixture.form.scope,
    points: fixture.scores.favorite,
    odds: market?.odds ?? null,
    dominance: reference === null ? null : h2hDominance(fixture.h2h.outcomes, reference),
    superiority: reference === null ? null : superiorityOf(fixture, reference)
  };

  const reject = (rejectedBy: QuickpickRejection): QuickpickEvaluation =>
    ({ ...base, passes: false, rejectedBy });

  if (market === undefined || pick === null) return reject("keinTipp");

  // Nur prüfen, solange das Formtor überhaupt etwas tut: Mit `strongMinimum: 0` und
  // `weakMaximum: 100` hat der Benutzer es ausgeschaltet, und dann darf eine fehlende
  // Formliste die Partie auch nicht über die Hintertür kosten.
  const formGateActive = settings.strongMinimum > 0 || settings.weakMaximum < 100;
  if (formGateActive
    && (fixture.form.home.length < MIN_FORM_SAMPLE || fixture.form.away.length < MIN_FORM_SAMPLE)) {
    return reject("formFehlt");
  }

  if (gate !== "ok") return reject(gate);
  if (base.odds === null || base.odds < settings.minOdds) return reject("quote");
  if (base.points === null || base.points < settings.minPoints) return reject("punkte");

  // Ein Rückstand in den Duellen oder zwei Niederlagen in Folge wiegen schwerer als fünf
  // Formspiele. Ohne dieses Veto rutschte Inter gegen FAS durch, wo die letzten drei Duelle
  // an den Gegner gingen.
  //
  // **Ab zwei Duellen**, und das ist kein Aufweichen: Ein einzelnes verlorenes Duell erfüllt
  // `losses > wins` immer, ist aber kein "Rückstand in der Serie" - es ist ein Spiel. Dazu
  // kommt, dass `h2hSummary` Freundschaftsspiele mitzählt (siehe `src/draw-criteria.ts`), ein solches
  // Veto also auf einem Testspiel stehen kann. Die zweite Bedingung braucht ohnehin zwei
  // Duelle, die Grenze trifft damit nur den Einzelfall.
  const dominance = base.dominance;
  if (dominance !== null && dominance.sample >= 2
    && (dominance.losses > dominance.wins || dominance.streakAgainst >= 2)) {
    return reject("h2hDagegen");
  }

  // Ohne Tabelle ist "klar überlegen" nicht prüfbar. Das trifft jede Cross-League-Partie:
  // Der Lauf führt dort nie eine Tabelle, weshalb Pokal- und Turnierpartien hier immer
  // wegfallen - nicht als Werturteil, sondern mangels Grundlage.
  const superiority = base.superiority;
  if (superiority === null) return reject("keineTabelle");
  if (superiority.pointsPerGame < settings.minPointsPerGame) return reject("tabelle");
  if (superiority.goalDifference < settings.minGoalDifference) return reject("tabelle");
  if (superiority.positionGap < settings.minPositionGap) return reject("tabelle");

  if (settings.requireStreak && (dominance?.streakFor ?? 0) < 2) return reject("serie");

  return { ...base, passes: true, rejectedBy: null };
}
