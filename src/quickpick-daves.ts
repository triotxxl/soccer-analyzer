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
 * Rückrechnung über 56 Snapshots und 4.543 abgerechnete Partien (16.08.-15.09.2026):
 * 61 Tipps, 70,5 % Treffer (±5,8), Quote Ø 2,03, ROI +2,7 %; erste Hälfte 73,3 %, zweite
 * 67,7 %. **Das ist ein Hinweis, kein Beleg** - ein halbes Sigma über null, und die
 * Punktegrenze 70 stammt aus einem Durchprobieren der Regler an genau diesen Daten.
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
  if (measured === null) return "noch nicht zurückgerechnet";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  const quote = (measured.trefferquote * 100).toFixed(1).replace(".", ",");
  return `${proTag}/Tag · ${quote} %`;
}

/**
 * Vier Strengestufen. Die Zahlen daneben sind **gemessen**, nicht geschätzt: Rückrechnung
 * über 56 Snapshots und 4.543 abgerechnete Partien vom 16.08. bis 15.09.2026, je Partie der
 * jüngste Snapshot. "Tipps/Tag" ist der Schnitt über diese 30 Tage.
 *
 * Die Reihenfolge der Stufen ist zugleich die Reihenfolge, in der die Zuverlässigkeit fällt -
 * und bei einer Kombi multipliziert sich das je Bein. Deshalb steht auf jedem Knopf, was er
 * kostet.
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
      n: 61, proTag: 2.4, trefferquote: 0.705, roi: 0.027,
      kombis: [
        { beine: 2, n: 1000, trefferquote: 0.49, quote: 2.2, roi: 0.049, erwartung: 0.054 },
        { beine: 3, n: 480, trefferquote: 0.413, quote: 3.39, roi: 0.365, erwartung: 0.082 },
        { beine: 4, n: 320, trefferquote: 0.275, quote: 5.17, roi: 0.41, erwartung: 0.111 },
        { beine: 5, n: 160, trefferquote: 0, quote: 8.14, roi: -1, erwartung: 0.14 }
      ]
    },
    hint: "Die höchste gemessene Zuverlässigkeit: 70,5 % je Bein über 61 Tipps, ROI +2,7 %."
      + " Dafür bleiben im Schnitt nur zwei Partien am Tag übrig - für eine lange Kombi oft zu wenig.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 134, proTag: 5, trefferquote: 0.687, roi: 0.022,
      kombis: [
        { beine: 2, n: 2400, trefferquote: 0.47, quote: 2.3, roi: 0.055, erwartung: 0.045 },
        { beine: 3, n: 1440, trefferquote: 0.315, quote: 3.5, roi: 0.094, erwartung: 0.068 },
        { beine: 4, n: 1080, trefferquote: 0.216, quote: 5.31, roi: 0.132, erwartung: 0.091 },
        { beine: 5, n: 640, trefferquote: 0.213, quote: 8.19, roi: 0.649, erwartung: 0.115 }
      ]
    },
    hint: "Verdoppelt die Liste und kostet nur 1,8 Punkte Trefferquote: 68,7 % über 134 Tipps,"
      + " ROI +2,2 %, in beiden Zeithälften fast gleich (70,1 und 67,2 %). Die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: {
      n: 181, proTag: 6.7, trefferquote: 0.63, roi: -0.064,
      kombis: [
        { beine: 2, n: 3240, trefferquote: 0.426, quote: 2.3, roi: -0.056, erwartung: -0.124 },
        { beine: 3, n: 2040, trefferquote: 0.264, quote: 3.5, roi: -0.12, erwartung: -0.18 },
        { beine: 4, n: 1360, trefferquote: 0.204, quote: 5.39, roi: 0.025, erwartung: -0.232 },
        { beine: 5, n: 1160, trefferquote: 0.161, quote: 8.18, roi: 0.238, erwartung: -0.281 }
      ]
    },
    hint: "Mehr Auswahl, aber der Ertrag kippt: 63,0 % über 181 Tipps, ROI -6,4 %."
      + " Ab hier überlappen die Formschwellen, das Tor prüft also nur noch, dass die"
      + " getippte Seite nicht schlechter dasteht. Sechs Beine ergeben im Erwartungswert"
      + " 68 % des Einsatzes.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: {
      n: 259, proTag: 9.5, trefferquote: 0.583, roi: -0.11,
      kombis: [
        { beine: 2, n: 4880, trefferquote: 0.335, quote: 2.98, roi: -0.225, erwartung: -0.209 },
        { beine: 3, n: 3000, trefferquote: 0.197, quote: 4.83, roi: -0.306, erwartung: -0.296 },
        { beine: 4, n: 2200, trefferquote: 0.128, quote: 8.71, roi: -0.318, erwartung: -0.374 },
        { beine: 5, n: 1640, trefferquote: 0.08, quote: 13.43, roi: -0.376, erwartung: -0.443 }
      ]
    },
    hint: "Nur für einen Überblick, nicht zum Spielen: 58,3 % über 259 Tipps, ROI -11,0 %."
      + " Diese Stufe senkt als einzige die Favoritenpunkte, und genau dort bricht die"
      + " Trefferquote ein. Sechs Beine ergeben im Erwartungswert 50 % des Einsatzes.",
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
  description: "Klar überlegene Mannschaften als Beine für eine Kombi: Die Tabelle muss den"
    + " Vorsprung zeigen, die Form ihn bestätigen, und die direkten Duelle dürfen nicht"
    + " dagegen sprechen.",
  // Ohne feste Zahlen, weil die Strengestufe sie verschiebt - die eingestellten Werte
  // stehen darunter in den Reglern.
  criteria: [
    "Tabelle: Vorsprung bei Platz, Punkten je Spiel und Tordifferenz",
    "Letzte 5 Spiele: eine Seite deutlich stärker als die andere – Remis zählen als kein Verlust",
    "Direkte Duelle: kein Rückstand und keine Niederlagenserie gegen die gestützte Seite",
    "Favoritenpunkte des Modells über der Schwelle der gewählten Strenge",
    "Quote ab 1,30, und der Tipp muss dem des Modells entsprechen"
  ],
  massstab: "trefferquote",
  kennzahlOf: (measured) => ({
    label: "Treffer je Bein",
    wert: measured === null ? "–" : `${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht zurückgerechnet" : `zurückgerechnet über ${measured.n} Tipps`,
    titel: measured === null
      ? "Für diese Stufe liegt noch keine Rückrechnung vor."
      : `Über die archivierten Läufe traf diese Stufe in ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`
        + ` der Fälle (${measured.n} Tipps). Bei einer Kombi multipliziert sich das:`
        + ` vier Beine ${(measured.trefferquote ** 4 * 100).toFixed(1).replace(".", ",")} %,`
        + ` sechs Beine ${(measured.trefferquote ** 6 * 100).toFixed(1).replace(".", ",")} %.`
  }),
  honesty: "Hinweis, kein Beleg. Über die archivierten Läufe traf diese Torfolge auf der"
    + " Vorgabe in 68,7 % der Fälle (134 Tipps, ±4,0) – rund ein halbes Sigma über null, und"
    + " die Punktegrenze 70 stammt aus einem Durchprobieren an genau diesen Daten. Eine Kombi"
    + " multipliziert den Vorteil je Bein, im Guten wie im Schlechten.",
  wettschein: {
    modus: "kombi",
    hinweis: "Legt den 1X2-Tipp jeder Treffer-Partie in den Wettschein. Dort lassen sich"
      + " daraus Kombis bauen."
  },
  leerSatz: "Keine Partie ist nach diesen Kriterien klar überlegen.",
  defaults: DEFAULT_QUICKPICK_SETTINGS,
  levels: QUICKPICK_LEVELS,
  defaultSort: "tabelle",
  evaluate: (fixture, settings) => evaluateDaves(fixture, settings),
  noteOf: davesNote
};

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
  if (gate !== "ok") return reject(gate);
  if (base.odds === null || base.odds < settings.minOdds) return reject("quote");
  if (base.points === null || base.points < settings.minPoints) return reject("punkte");

  // Ein Rückstand in den Duellen oder zwei Niederlagen in Folge wiegen schwerer als fünf
  // Formspiele. Ohne dieses Veto rutschte Inter gegen FAS durch, wo die letzten drei Duelle
  // an den Gegner gingen.
  const dominance = base.dominance;
  if (dominance !== null && (dominance.losses > dominance.wins || dominance.streakAgainst >= 2)) {
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
