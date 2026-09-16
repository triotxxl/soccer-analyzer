import type { DashboardFixture, DashboardMarket, FormResult } from "./dashboard.ts";

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


export type QuickpickPresetId = "daves1x2";

export interface QuickpickSettings {
  preset: QuickpickPresetId;
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
export type QuickpickLevelValues = Pick<QuickpickSettings,
  "strongMinimum" | "weakMaximum" | "minPoints" | "minPointsPerGame" | "minGoalDifference" | "minPositionGap">;

export type QuickpickLevelId = "streng" | "ausgewogen" | "locker" | "weit";

export interface QuickpickLevel {
  id: QuickpickLevelId;
  label: string;
  /** Kurzfassung für den Knopf: Menge gegen Zuverlässigkeit. */
  note: string;
  hint: string;
  values: QuickpickLevelValues;
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

export const QUICKPICK_LEVELS: QuickpickLevel[] = [
  {
    id: "streng", label: "Streng", note: "2,4/Tag · 70,5 %",
    hint: "Die höchste gemessene Zuverlässigkeit: 70,5 % je Bein über 61 Tipps, ROI +2,7 %."
      + " Dafür bleiben im Schnitt nur zwei Partien am Tag übrig - für eine lange Kombi oft zu wenig.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen", note: "5,0/Tag · 68,7 %",
    hint: "Verdoppelt die Liste und kostet nur 1,8 Punkte Trefferquote: 68,7 % über 134 Tipps,"
      + " ROI +2,2 %, in beiden Zeithälften fast gleich (70,1 und 67,2 %). Die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker", note: "6,7/Tag · 63,0 %",
    hint: "Mehr Auswahl, aber der Ertrag kippt: 63,0 % über 181 Tipps, ROI -6,4 %."
      + " Ab hier überlappen die Formschwellen, das Tor prüft also nur noch, dass die"
      + " getippte Seite nicht schlechter dasteht. Sechs Beine ergeben im Erwartungswert"
      + " 68 % des Einsatzes.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit", note: "9,5/Tag · 58,3 %",
    hint: "Nur für einen Überblick, nicht zum Spielen: 58,3 % über 259 Tipps, ROI -11,0 %."
      + " Diese Stufe senkt als einzige die Favoritenpunkte, und genau dort bricht die"
      + " Trefferquote ein. Sechs Beine ergeben im Erwartungswert 50 % des Einsatzes.",
    values: LEVELS.weit
  }
];

/**
 * Welche Stufe eingestellt ist, oder `null` für eigene Werte. Verglichen wird nur, was eine
 * Stufe überhaupt setzt - wer an Quote oder Serie dreht, bleibt auf seiner Stufe.
 */
export function levelOf(settings: QuickpickSettings): QuickpickLevelId | null {
  const match = QUICKPICK_LEVELS.find((level) =>
    (Object.keys(level.values) as Array<keyof QuickpickLevelValues>)
      .every((key) => settings[key] === level.values[key]));
  return match?.id ?? null;
}

export function applyLevel(settings: QuickpickSettings, level: QuickpickLevelId): QuickpickSettings {
  return { ...settings, ...LEVELS[level] };
}

export const DEFAULT_QUICKPICK_SETTINGS: QuickpickSettings = {
  preset: "daves1x2",
  minOdds: 1.3,
  // Ausgewogen statt streng: Zwei Tipps am Tag tragen keine lange Kombi, und der Unterschied
  // in der Zuverlässigkeit ist mit 1,8 Punkten kleiner als die Streuung der Messung.
  ...LEVELS.ausgewogen,
  // Aus: Über die Rückrechnung trug die Serie nichts bei (58,3 % gegen 55,6 % ohne sie), und
  // als Pflicht bliebe fast nichts übrig.
  requireStreak: false
};

export const QUICKPICK_PRESETS: Array<{
  id: QuickpickPresetId;
  label: string;
  description: string;
  criteria: string[];
}> = [
  {
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
    ]
  }
];

export type QuickpickRejection =
  | "keinTipp"
  | "venueForm"
  | "seitenkonflikt"
  | "quote"
  | "punkte"
  | "h2hDagegen"
  | "keineTabelle"
  | "tabelle"
  | "serie";

export const REJECTION_LABELS: Record<QuickpickRejection, string> = {
  keinTipp: "kein 1X2-Tipp im Lauf",
  venueForm: "keine klar stärkere Seite in der Form",
  seitenkonflikt: "Form und Modelltipp meinen verschiedene Seiten",
  quote: "Quote unter der Mindestquote",
  punkte: "zu wenig Favoritenpunkte",
  h2hDagegen: "die direkten Duelle sprechen gegen die Seite",
  keineTabelle: "keine Ligatabelle – Überlegenheit nicht prüfbar",
  tabelle: "die Tabelle zeigt keinen klaren Vorsprung",
  serie: "keine Siegesserie auf der gestützten Seite"
};

export interface QuickpickDominance {
  /** (Siege − Niederlagen) / Duelle, aus Sicht der gestützten Seite. */
  rate: number;
  wins: number;
  draws: number;
  losses: number;
  sample: number;
  /** Zahl der unmittelbar vorangegangenen Niederlagen der gestützten Seite. */
  streakAgainst: number;
  /** Zahl der unmittelbar vorangegangenen Siege der gestützten Seite. */
  streakFor: number;
}

/** Der Vorsprung aus der Ligatabelle, aus Sicht der gestützten Seite. */
export interface QuickpickSuperiority {
  pointsPerGame: number;
  goalDifference: number;
  positionGap: number;
  position: number;
  opponentPosition: number;
}

export interface QuickpickEvaluation {
  fixtureId: number;
  /** Die Seite, die der Filter stützt - immer der Modelltipp oder `null`. */
  side: "1" | "2" | null;
  /** Die Seite, auf die die Venue-Form zeigt. */
  venueSide: "1" | "2" | null;
  pick: "1" | "2" | null;
  homePercent: number;
  awayPercent: number;
  /** `overall` heißt: keine Heim-/Auswärtstrennung. */
  venueScope: "venue" | "overall";
  /** `scores.favorite`, unverändert übernommen. */
  points: number | null;
  odds: number | null;
  dominance: QuickpickDominance | null;
  superiority: QuickpickSuperiority | null;
  passes: boolean;
  rejectedBy: QuickpickRejection | null;
}

export interface QuickpickFilterReport {
  evaluated: number;
  passed: number;
  rejected: Record<QuickpickRejection, number>;
}

function emptyRejections(): Record<QuickpickRejection, number> {
  return {
    keinTipp: 0, venueForm: 0, seitenkonflikt: 0, quote: 0, punkte: 0,
    h2hDagegen: 0, keineTabelle: 0, tabelle: 0, serie: 0
  };
}

/**
 * Formwert nach der Formel aus `venueFormStats` (`src/venue-form.ts`): Sieg 3, Remis 1,
 * Niederlage 0, geteilt durch die erreichbaren Punkte. Genau hier steckt die Vorgabe, dass
 * Remis keine Niederlage sind - sie tragen einen Punkt statt keinen.
 *
 * Der Unterschied zur Serverfassung ist allein die Stichprobe: dort die letzten 10
 * venue-spezifischen Partien, hier die 5, die der Snapshot führt.
 */
export function venueFormPercent(results: FormResult[]): number {
  if (results.length === 0) return 0;
  const points = results.reduce(
    (sum, result) => sum + (result === "win" ? 3 : result === "draw" ? 1 : 0),
    0
  );
  return points / (results.length * 3) * 100;
}

/**
 * Die Siegesserie in den direkten Duellen, vorzeichenbehaftet aus Sicht des aktuellen
 * Heimteams: +n heißt, die letzten n Duelle gingen an das Heimteam, −n an das Auswärtsteam.
 * Ein Remis an der Spitze beendet jede Serie.
 *
 * `outcomes[0]` ist das **jüngste** Duell: `h2hSummary` in `src/draw-criteria.ts` sortiert
 * absteigend nach Zeitstempel. Das ist die einzige Größe des Filters, die es im Backend nicht
 * gibt - `breakdown.headToHead` zählt Siege reihenfolgeblind.
 */
export function h2hStreak(outcomes: FormResult[]): number {
  const latest = outcomes[0];
  if (latest === undefined || latest === "draw") return 0;
  let length = 0;
  for (const outcome of outcomes) {
    if (outcome !== latest) break;
    length += 1;
  }
  return latest === "win" ? length : -length;
}

/**
 * Dominanz als Rate statt als Rohzahl, damit zwei Siege aus zwei Duellen nicht wie zwei Siege
 * aus fünf aussehen. `sample` gehört angezeigt: Der Snapshot führt höchstens fünf Duelle.
 *
 * `side` ist die gestützte Seite; `outcomes` stehen aus Heimsicht und werden für die
 * Auswärtsseite gespiegelt. Achtung: Diese Duelle sind **nicht** von Testspielen bereinigt -
 * `h2hSummary` filtert anders als die Form keine Freundschaftsspiele heraus.
 */
export function h2hDominance(outcomes: FormResult[], side: "1" | "2"): QuickpickDominance | null {
  if (outcomes.length === 0) return null;
  const mine: FormResult[] = side === "1"
    ? outcomes
    : outcomes.map((outcome) => outcome === "win" ? "loss" : outcome === "loss" ? "win" : "draw");
  const wins = mine.filter((outcome) => outcome === "win").length;
  const draws = mine.filter((outcome) => outcome === "draw").length;
  const losses = mine.filter((outcome) => outcome === "loss").length;
  const streak = h2hStreak(mine);
  return {
    rate: (wins - losses) / mine.length,
    wins, draws, losses, sample: mine.length,
    streakAgainst: streak < 0 ? -streak : 0,
    streakFor: streak > 0 ? streak : 0
  };
}

/**
 * Der Tabellenvorsprung der gestützten Seite. `null`, wenn der Lauf keine Tabelle führt
 * (bei Cross-League-Partien immer) oder der Name nicht zugeordnet werden kann - beides ist
 * "nicht prüfbar" und nicht "kein Vorsprung".
 */
export function superiorityOf(fixture: DashboardFixture, side: "1" | "2"): QuickpickSuperiority | null {
  const table = fixture.table;
  if (!table) return null;
  const home = table.find((row) => row.teamName === fixture.homeTeam);
  const away = table.find((row) => row.teamName === fixture.awayTeam);
  if (!home || !away || home.played === 0 || away.played === 0) return null;
  const backed = side === "1" ? home : away;
  const other = side === "1" ? away : home;
  return {
    pointsPerGame: backed.points / backed.played - other.points / other.played,
    goalDifference: (backed.goalsFor - backed.goalsAgainst) / backed.played
      - (other.goalsFor - other.goalsAgainst) / other.played,
    positionGap: other.position - backed.position,
    position: backed.position,
    opponentPosition: other.position
  };
}

function oneXTwoMarket(fixture: DashboardFixture): DashboardMarket | undefined {
  return fixture.markets.find((market) => market.key === "1x2");
}

/**
 * Die Seite, auf die die Venue-Form zeigt - nur zur Anzeige. `null`, wenn keine Seite die
 * Schwellen allein erfüllt oder beide es tun.
 */
function venueSideOf(home: number, away: number, settings: QuickpickSettings): "1" | "2" | null {
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
  settings: QuickpickSettings
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
export function evaluateFixture(
  fixture: DashboardFixture,
  settings: QuickpickSettings
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

/**
 * Wertet eine Liste aus und liefert die Treffer als `Set` der Fixture-IDs. Bewusst kein
 * gefiltertes Array: Der Aufrufer filtert seinen eigenen Bestand und behält dessen
 * Reihenfolge und Identität.
 */
export function applyQuickpick(
  fixtures: DashboardFixture[],
  settings: QuickpickSettings
): {
  passing: Set<number>;
  evaluations: Map<number, QuickpickEvaluation>;
  report: QuickpickFilterReport;
} {
  const passing = new Set<number>();
  const evaluations = new Map<number, QuickpickEvaluation>();
  const report: QuickpickFilterReport = {
    evaluated: fixtures.length,
    passed: 0,
    rejected: emptyRejections()
  };

  for (const fixture of fixtures) {
    const evaluation = evaluateFixture(fixture, settings);
    evaluations.set(fixture.fixtureId, evaluation);
    if (evaluation.passes) {
      passing.add(fixture.fixtureId);
      report.passed += 1;
    } else if (evaluation.rejectedBy !== null) {
      report.rejected[evaluation.rejectedBy] += 1;
    }
  }

  return { passing, evaluations, report };
}
