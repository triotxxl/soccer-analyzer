import type { DashboardFixture, DashboardMarket, FormResult } from "./dashboard.ts";

/**
 * Gemeinsames Gerüst des Quickpickers: Typen und Messgrößen, die sich alle Voreinstellungen
 * teilen. Die einzelnen Torfolgen stehen daneben in `quickpick-daves.ts` und
 * `quickpick-underdog.ts`, zusammengeführt werden sie in `quickpick.ts`.
 *
 * Hier steht bewusst keine Regel - nur das, woraus Regeln gebaut werden.
 */

export type QuickpickPresetId = "daves1x2" | "underdog";

export type QuickpickLevelId = "streng" | "ausgewogen" | "locker" | "weit";

/**
 * Was eine Stufe in der Rückrechnung geleistet hat. Bewusst Zahlen und kein Text: Auf den
 * Knöpfen stand früher ein String wie "5,0/Tag · 68,7 %", den die Rückrechnung wieder
 * zerlegen musste, um eine Abweichung zu erkennen. `null` heißt "noch nicht zurückgerechnet"
 * und darf nicht als Null gelesen werden.
 */
export interface QuickpickMeasurement {
  /** Zahl der abgerechneten Wetten, auf denen die Zahlen beruhen. */
  n: number;
  proTag: number;
  trefferquote: number;
  roi: number;
  /** Was kurze Kombis aus dieser Auswahl gebracht hätten. Leer, solange nicht gemessen. */
  kombis?: QuickpickComboMeasurement[];
}

/**
 * Eine Kombi über `beine` Auswahlen desselben Spieltags.
 *
 * `erwartung` ist `(1 + roi je Bein)^beine − 1`, also das, was der Ertrag je Bein verspricht.
 * `roi` ist, was tatsächlich herauskam. Laufen die beiden weit auseinander, ist nicht die
 * Rechnung falsch, sondern die Stichprobe zu klein: Bei einer Trefferquote von 30 % je Bein
 * gewinnt eine Viererkombi nur jede zweihundertste, und ein einziger Treffer mehr oder weniger
 * verschiebt den Ertrag um Dutzende Prozentpunkte. Deshalb stehen beide Spalten nebeneinander.
 */
export interface QuickpickComboMeasurement {
  beine: number;
  /** Zahl der gezogenen Kombis. */
  n: number;
  trefferquote: number;
  /** Durchschnittliche Gesamtquote der Kombi. */
  quote: number;
  roi: number;
  erwartung: number;
}

export interface QuickpickLevel<V> {
  id: QuickpickLevelId;
  label: string;
  hint: string;
  measured: QuickpickMeasurement | null;
  /** Nur die Felder, die diese Stufe setzt - Quote und Zusatzschalter bleiben unberührt. */
  values: V;
}

/**
 * Eine Voreinstellung bringt alles mit, was sie von den anderen unterscheidet: ihre Tore,
 * ihre Vorgaben, ihre Strengestufen, ihren Maßstab und ihre Texte. Die Fassade in
 * `quickpick.ts` kennt nur noch diese Schnittstelle.
 */
export interface QuickpickPreset<S> {
  id: QuickpickPresetId;
  label: string;
  description: string;
  criteria: string[];
  /**
   * Woran die Voreinstellung gemessen wird. `trefferquote` für Kombi-Beine, `roi` für
   * Einzelwetten - das steuert die Kennzahlenkarte und die Toleranz der Abweichungsmeldung.
   */
  massstab: "trefferquote" | "roi";
  /**
   * Was die Kennzahlenkarte trägt - abgeleitet aus der Messung der **eingestellten** Stufe.
   * Früher stand dort eine fest verdrahtete Zahl, die dem Stufenschalter nicht folgte.
   */
  kennzahlOf(measured: QuickpickMeasurement | null): {
    label: string; wert: string; notiz: string; titel: string;
  };
  /** Der Ehrlichkeitsabsatz. Muss zur Messung passen, sonst wirbt die Oberfläche falsch. */
  honesty: string;
  /** Wie Treffer in den Wettschein dürfen. */
  wettschein: { modus: "kombi" | "einzel"; hinweis: string };
  /** Satz für die leere Trefferliste. */
  leerSatz: string;
  defaults: S;
  levels: Array<QuickpickLevel<Partial<S>>>;
  defaultSort: string;
  evaluate(fixture: DashboardFixture, settings: S): QuickpickEvaluation;
  /** Formatiert die Messung für den Knopf. Jede Voreinstellung nennt ihre eigene Größe. */
  noteOf(measured: QuickpickMeasurement | null): string;
}

export type QuickpickRejection =
  | "keinTipp"
  | "venueForm"
  | "seitenkonflikt"
  | "quote"
  | "punkte"
  | "h2hDagegen"
  | "keineTabelle"
  | "tabelle"
  | "serie"
  // Gründe der Voreinstellung "Underdog". Eine gemeinsame Liste, weil die Bilanz im Panel
  // ohnehin nur Gründe mit einem Zähler über null anzeigt.
  | "keineQuote"
  | "keinAussenseiter"
  | "formGegen"
  | "keineDuelle"
  | "modellDagegen";

export const REJECTION_LABELS: Record<QuickpickRejection, string> = {
  keinTipp: "kein 1X2-Tipp im Lauf",
  venueForm: "keine klar stärkere Seite in der Form",
  seitenkonflikt: "Form und Modelltipp meinen verschiedene Seiten",
  quote: "Quote unter der Mindestquote",
  punkte: "zu wenig Favoritenpunkte",
  h2hDagegen: "die direkten Duelle sprechen gegen die Seite",
  keineTabelle: "keine Ligatabelle – Überlegenheit nicht prüfbar",
  tabelle: "die Tabelle zeigt keinen klaren Vorsprung",
  serie: "keine Siegesserie auf der gestützten Seite",
  keineQuote: "keine brauchbare Quote im Lauf",
  keinAussenseiter: "der Markt sieht keine Seite klar schlechter",
  formGegen: "die Form stützt den Außenseiter nicht",
  keineDuelle: "zu wenige direkte Duelle",
  modellDagegen: "das Modell tippt die andere Seite"
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

/** Was nur die Voreinstellung „Underdog" braucht. */
export interface UnderdogDetail {
  /** Quote der Gegenseite zur gestützten. */
  counterOdds: number | null;
  /**
   * `snapshot` heißt: Beide Preise stehen im Lauf (ab schemaVersion 5). `geschätzt` heißt:
   * aus Tipp- und Remisquote gerechnet - die Seite stimmt dann zu 97,6 %, der Preis liegt
   * im Median 7,1 % daneben.
   */
  counterSource: "snapshot" | "geschätzt" | null;
  /** Quote der gestützten Seite geteilt durch die des Favoriten. */
  priceRatio: number | null;
  /** Formvorsprung der gestützten Seite in Prozentpunkten. */
  formGap: number;
  /** Modellwahrscheinlichkeit der gestützten Seite - für die Gegenseite `1 − p(Tipp) − p(Remis)`. */
  probability: number | null;
  /** Marktwahrscheinlichkeit aus der Quote, ohne Bereinigung um den Buchmacherschnitt. */
  implied: number | null;
  /** Ob das Modell dieselbe Seite tippt. Nur Anzeige - als Tor gemessen ohne Nutzen. */
  modelAgrees: boolean;
}

export interface QuickpickEvaluation {
  fixtureId: number;
  /**
   * Die Seite, die der Filter stützt. Bei „daves1x2" immer der Modelltipp; bei „underdog"
   * auch die Gegenseite, denn dort ist der Widerspruch zum Markt der Zweck.
   */
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
  /** Nur bei „underdog" gesetzt. */
  underdog?: UnderdogDetail | null;
  passes: boolean;
  rejectedBy: QuickpickRejection | null;
}

export interface QuickpickFilterReport {
  evaluated: number;
  passed: number;
  rejected: Record<QuickpickRejection, number>;
}

export function emptyRejections(): Record<QuickpickRejection, number> {
  return {
    keinTipp: 0, venueForm: 0, seitenkonflikt: 0, quote: 0, punkte: 0,
    h2hDagegen: 0, keineTabelle: 0, tabelle: 0, serie: 0,
    keineQuote: 0, keinAussenseiter: 0, formGegen: 0, keineDuelle: 0, modellDagegen: 0
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

/** Der 1X2-Markt einer Partie. */
export function oneXTwoMarket(fixture: DashboardFixture): DashboardMarket | undefined {
  return fixture.markets.find((market) => market.key === "1x2");
}

/**
 * Der mittlere Buchmacherschnitt bei Tipico: `1/Heim + 1/Remis + 1/Auswärts`. Gemessen über
 * 6.135 archivierte Ereignisse mit allen drei Preisen - Median 1,1068, p10 1,0708, p90 1,1383.
 * Er ist **nicht** konstant, deshalb ist jede damit gerechnete Quote eine Schätzung.
 */
export const TIPICO_BOOK = 1.1068;

/**
 * Die Quote der Seite, die der Lauf nicht führt.
 *
 * Läufe ab `schemaVersion: 5` speichern beide Seitenquoten am 1X2-Markt; dann ist das Ergebnis
 * exakt. Ältere Läufe führen nur die getippte Seite - dort wird der fehlende Preis aus Tipp-
 * und Remisquote über den Buchmacherschnitt gerechnet.
 *
 * Wie gut das ist, wurde über 4.645 archivierte Partien gemessen: Die **Seite** trifft es zu
 * 97,6 %, der **Preis** liegt im Median 7,1 % daneben (p90 18,4 %). Gut genug, um zu
 * entscheiden, wen der Markt schlechter sieht - nicht gut genug, um als Wettpreis zu gelten.
 * Deshalb trägt das Ergebnis seine Herkunft mit sich, und die Oberfläche kennzeichnet sie.
 */
export function counterOddsOf(
  fixture: DashboardFixture,
  market: DashboardMarket | undefined
): { odds: number; source: "snapshot" | "geschätzt" } | null {
  if (!market || market.pick === null) return null;

  // Ab schemaVersion 5 stehen beide Preise im Lauf.
  const stored = market.pick === "1" ? market.oddsAway : market.oddsHome;
  if (typeof stored === "number" && stored > 1) return { odds: stored, source: "snapshot" };

  const drawOdds = fixture.markets.find((entry) => entry.key === "draw")?.odds ?? null;
  if (market.odds === null || market.odds <= 1 || drawOdds === null || drawOdds <= 1) return null;
  const rest = TIPICO_BOOK - 1 / market.odds - 1 / drawOdds;
  // Ein Rest nahe null hieße eine astronomische Quote - dann ist der Schnitt für diese Partie
  // offensichtlich ein anderer, und geraten wird nicht.
  if (rest <= 0.01) return null;
  return { odds: 1 / rest, source: "geschätzt" };
}
