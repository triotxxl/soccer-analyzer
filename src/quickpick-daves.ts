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
 * 5.628 abgerechnete Partien, Stand 21.09.2026, je Partie der jüngste Snapshot.
 *
 * **Die Reihenfolge stimmt nicht mehr mit der Zuverlässigkeit überein.** `streng` misst 64,2 %
 * (±4,9) gegen 66,5 % (±3,4) bei `ausgewogen` und kostet dabei die Hälfte der Partien - die
 * strengere Stufe ist auf diesem Bestand nicht die bessere. Der Unterschied liegt innerhalb der
 * Streuung, taugt also nicht als Beleg für das Gegenteil; als Beleg für "strenger ist besser"
 * taugte er aber nie, und genau das stand bis zum 21.09.2026 auf dem Knopf.
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
      n: 95, proTag: 3.2, trefferquote: 0.642, roi: -0.059,
      kombis: [
        { beine: 2, n: 1760, trefferquote: 0.414, quote: 3.35, roi: -0.129, erwartung: -0.115 },
        { beine: 3, n: 1080, trefferquote: 0.26, quote: 5.23, roi: -0.215, erwartung: -0.168 },
        { beine: 4, n: 720, trefferquote: 0.212, quote: 10.35, roi: -0.081, erwartung: -0.217 },
        { beine: 5, n: 520, trefferquote: 0.129, quote: 22.69, roi: -0.218, erwartung: -0.264 },
        { beine: 6, n: 360, trefferquote: 0.025, quote: 12.65, roi: -0.72, erwartung: -0.307 },
        { beine: 7, n: 280, trefferquote: 0.004, quote: 20.68, roi: -0.942, erwartung: -0.348 }
      ]
    },
    hint: "Die engste Auswahl, aber nicht die beste: knapp 2 von 3 Tipps stimmen – genauso"
      + " viele wie bei „Ausgewogen“, bei halb so vielen Spielen und größerem Verlust.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 191, proTag: 6, trefferquote: 0.665, roi: -0.008,
      kombis: [
        { beine: 2, n: 3680, trefferquote: 0.444, quote: 2.74, roi: -0.01, erwartung: -0.016 },
        { beine: 3, n: 2360, trefferquote: 0.285, quote: 4.15, roi: -0.033, erwartung: -0.024 },
        { beine: 4, n: 1680, trefferquote: 0.202, quote: 7.19, roi: 0.057, erwartung: -0.032 },
        { beine: 5, n: 1360, trefferquote: 0.122, quote: 11.85, roi: -0.064, erwartung: -0.04 },
        { beine: 6, n: 1000, trefferquote: 0.063, quote: 12.64, roi: -0.328, erwartung: -0.048 },
        { beine: 7, n: 880, trefferquote: 0.053, quote: 19.87, roi: 0.008, erwartung: -0.056 }
      ]
    },
    hint: "Die beste der vier Stufen: 2 von 3 Tipps stimmen, und der Verlust ist mit"
      + " rund 1 % am kleinsten. Die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: {
      n: 254, proTag: 7.9, trefferquote: 0.638, roi: -0.045,
      kombis: [
        { beine: 2, n: 4920, trefferquote: 0.418, quote: 2.78, roi: -0.069, erwartung: -0.088 },
        { beine: 3, n: 3320, trefferquote: 0.277, quote: 4.61, roi: -0.085, erwartung: -0.129 },
        { beine: 4, n: 2240, trefferquote: 0.2, quote: 7.69, roi: -0.046, erwartung: -0.168 },
        { beine: 5, n: 1760, trefferquote: 0.149, quote: 12.86, roi: 0.069, erwartung: -0.206 },
        { beine: 6, n: 1520, trefferquote: 0.13, quote: 23.32, roi: 0.355, erwartung: -0.242 },
        { beine: 7, n: 1160, trefferquote: 0.065, quote: 37.26, roi: 0.037, erwartung: -0.276 }
      ]
    },
    hint: "Mehr Auswahl, aber es wird teuer: nur noch gut 6 von 10 Tipps stimmen, und auf"
      + " Dauer verlierst du damit Geld.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: {
      n: 357, proTag: 11.2, trefferquote: 0.599, roi: -0.082,
      kombis: [
        { beine: 2, n: 7000, trefferquote: 0.361, quote: 3.1, roi: -0.158, erwartung: -0.157 },
        { beine: 3, n: 4520, trefferquote: 0.221, quote: 5.4, roi: -0.217, erwartung: -0.226 },
        { beine: 4, n: 3360, trefferquote: 0.134, quote: 9.31, roi: -0.268, erwartung: -0.29 },
        { beine: 5, n: 2560, trefferquote: 0.09, quote: 15.61, roi: -0.26, erwartung: -0.348 },
        { beine: 6, n: 2120, trefferquote: 0.056, quote: 28.15, roi: -0.333, erwartung: -0.401 },
        { beine: 7, n: 1680, trefferquote: 0.033, quote: 45.09, roi: -0.408, erwartung: -0.45 }
      ]
    },
    hint: "Nur zum Überblick, nicht zum Spielen: knapp 6 von 10 Tipps stimmen, und der"
      + " Verlust ist deutlich.",
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
  short: "Daves 1x2",
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
  honesty: "Rechne nicht mit Gewinn. 2 von 3 Tipps stimmten – aber zu den Quoten, die es"
    + " dafür gibt, stand am Ende jede Stufe im Minus: die Vorgabe knapp, die anderen"
    + " deutlich. Dazu wurden die Schwellen an genau den Spielen gesucht, an denen sie jetzt"
    + " gemessen werden. In einer Kombi müssen alle Tipps stimmen: Je mehr Spiele du"
    + " zusammenlegst, desto seltener geht der Schein durch.",
  wettschein: {
    hinweis: "Legt den Sieger-Tipp jedes gefundenen Spiels in den Wettschein. Dort baust du"
      + " dir daraus deine Kombis."
  },
  leerSatz: "Keine Partie ist nach diesen Kriterien klar überlegen.",
  defaults: DEFAULT_QUICKPICK_SETTINGS,
  levels: QUICKPICK_LEVELS,
  defaultSort: "tabelle",
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
  // kommt, dass `h2hSummary` Freundschaftsspiele mitzählt (siehe `src/h2h.ts`), ein solches
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
