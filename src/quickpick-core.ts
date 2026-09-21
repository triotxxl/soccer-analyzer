import type { DashboardFixture, DashboardMarket, DashboardMarketKey, FormResult } from "./dashboard.ts";
import type { RecentMatchSummary } from "./types.ts";

/**
 * Gemeinsames Gerüst des Quickpickers: Typen und Messgrößen, die sich alle Voreinstellungen
 * teilen. Die einzelnen Torfolgen stehen daneben in `quickpick-daves.ts` und
 * `quickpick-dominanz.ts`, zusammengeführt werden sie in `quickpick.ts`.
 *
 * Hier steht bewusst keine Regel - nur das, woraus Regeln gebaut werden.
 */

export type QuickpickPresetId = "daves1x2" | "dominanz" | "hz15" | "remis";

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
  /** Hinweistext am Sammelknopf. Beide Voreinstellungen liefern Beine für Kombis. */
  wettschein: { hinweis: string };
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
  // Zu wenige Formspiele, um die Formschwelle überhaupt zu prüfen. Bewusst ein eigener Grund:
  // `venueForm` heißt "gemessen und zu schwach", dieser hier heißt "gar nicht gemessen".
  | "formFehlt"
  // Gründe der Voreinstellung "Dominanz". Eine gemeinsame Liste, weil das Panel ohnehin nur
  // Gründe mit einem Zähler über null anzeigt.
  | "keineQuote"
  | "bilanz"
  | "keineDuelle"
  | "modellDagegen"
  // Gründe der Voreinstellung "Erste Halbzeit: zwei Tore". Sie stützt keine Seite, sondern
  // einen festen Markt - ihre Tore fragen nach dem Torumfeld, nicht nach einer Mannschaft.
  | "keinMarkt"
  | "torerwartung"
  | "remisbild"
  | "hzHistorie"
  // Grund der Voreinstellung "Remis-Kandidaten". Bewusst ein eigener Schlüssel: `remisbild`
  // ist vergeben und meint bei "Erste Halbzeit" das Gegenteil - dort weist es eine Partie
  // ab, weil sie zu remisnah ist.
  | "remisChance";

export const REJECTION_LABELS: Record<QuickpickRejection, string> = {
  keinTipp: "für dieses Spiel gibt es keinen Sieger-Tipp",
  venueForm: "keine Mannschaft ist in der Form klar besser",
  seitenkonflikt: "Form und Modell tippen verschiedene Mannschaften",
  quote: "Quote außerhalb des eingestellten Bereichs",
  punkte: "das Modell hält den Favoriten für zu schwach",
  h2hDagegen: "die direkten Duelle sprechen dagegen",
  keineTabelle: "es gibt keine Tabelle – Überlegenheit nicht prüfbar",
  tabelle: "die Tabelle zeigt keinen klaren Vorsprung",
  serie: "keine Siegesserie in den direkten Duellen",
  formFehlt: "zu wenige Spiele, um die Form zu vergleichen",
  keineQuote: "keine brauchbare Quote vorhanden",
  bilanz: "verliert nicht deutlich seltener als der Gegner",
  keineDuelle: "zu wenige direkte Duelle",
  modellDagegen: "das Modell tippt die andere Mannschaft",
  keinMarkt: "diese Wette wird für das Spiel nicht angeboten",
  torerwartung: "es sind zu wenige Tore zu erwarten",
  remisbild: "ein Unentschieden ist zu wahrscheinlich",
  hzHistorie: "in der ersten Halbzeit fallen hier selten zwei Tore",
  remisChance: "die Chance auf ein Unentschieden ist zu klein"
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
  /**
   * Die Zahl der Spiele, auf denen der Vorsprung beruht. Ohne sie sieht ein Vorsprung nach vier
   * Spieltagen aus wie einer nach dreißig, und beide passieren dasselbe Tor. Gemessen beruhen
   * 39 % der Treffer auf einer Seite mit höchstens sechs Spielen - ein Tor darauf gibt die
   * Messung nicht her (71,0 % gegen 64,6 %), die Anzeige schon.
   */
  played: number;
  opponentPlayed: number;
  /**
   * Anteil der Spiele ohne Niederlage, `(Siege + Remis) / Spiele`, über die laufende Saison.
   * Das ist die „Form" im Sinne einer Saisonbilanz - **nicht** die letzten fünf Spiele am Ort.
   * Der Unterschied ist entscheidend: Die auswärts spielende Seite steht in der Venue-Form
   * strukturell schlechter da, und genau daran scheitern die Partien, um die es hier geht.
   */
  nonLossRate: number;
  opponentNonLossRate: number;
  /** Vorsprung darin in **Prozentpunkten** (0-100), passend zu den übrigen PP-Größen. */
  nonLossGap: number;
}

/** Was nur die Voreinstellung „Dominanz" braucht. */
export interface DominanzDetail {
  /** Gewonnene direkte Duelle in Folge auf der gestützten Seite. */
  streak: number;
  /** Vorsprung im Anteil der Spiele ohne Niederlage, in Prozentpunkten. */
  nonLossGap: number;
  /** Ob das Modell dieselbe Seite tippt. Nur Anzeige - als Tor ist es eine eigene Stufe. */
  modelAgrees: boolean;
  /**
   * `snapshot` heißt: Der Preis steht im Lauf (ab schemaVersion 5 stehen beide Seiten drin).
   * `geschätzt` heißt: aus Tipp- und Remisquote gerechnet, im Median 7,1 % daneben.
   */
  oddsSource: "snapshot" | "geschätzt";
}

/** Was nur die Voreinstellung „Erste Halbzeit: zwei Tore" braucht. */
export interface Hz15Detail {
  /** Erwartete Tore des **ganzen** Spiels. Sie trennt besser als die Halbzeiterwartung. */
  expectedGoals: number;
  /** Erwartete Tore der ersten Halbzeit, falls der Lauf sie führt - nur Anzeige. */
  expectedFirstHalfGoals: number | null;
  /** Modellwahrscheinlichkeit für ein Remis. Je kleiner, desto offener die Partie. */
  drawProbability: number | null;
  /**
   * Anteil der Partien mit mindestens zwei Halbzeittoren, gemittelt über die jüngsten
   * Spiele beider Mannschaften. `null` heißt "nicht prüfbar" - der Lauf führt für diese
   * Partie zu wenige Halbzeitstände -, nicht "schlecht".
   */
  firstHalfRate: number | null;
  /** Wie viele Partien der Anteil trägt, je Mannschaft die kleinere Zahl. */
  firstHalfSample: number;
  /** Modellwahrscheinlichkeit des Marktes selbst. */
  probability: number;
}

/** Was nur die Voreinstellung „Remis-Kandidaten" braucht. */
export interface RemisDetail {
  /** Modellwahrscheinlichkeit für ein Remis - das einzige Tor dieser Voreinstellung. */
  probability: number;
  /**
   * Die Remis-Punkte aus `src/draw-criteria.ts`, unverändert aus `scores.draw`. **Nur
   * Anzeige.** Ein Tor darauf senkt die Trefferquote messbar (>= 40 Punkte auf 34,7 %,
   * >= 50 auf 30,8 % gegenüber 35,7 % ohne) - siehe Kopfkommentar der Voreinstellung.
   */
  punkte: number | null;
  /** Remis unter den überlieferten direkten Duellen, und die Serie ab dem jüngsten. */
  h2hDraws: number;
  h2hSample: number;
  consecutiveDraws: number;
  /** Erwartete Tore des ganzen Spiels - nur Einordnung, kein Tor. */
  expectedGoals: number;
}

export interface QuickpickEvaluation {
  fixtureId: number;
  /**
   * Der Markt, auf den die Voreinstellung setzt. Die beiden 1X2-Voreinstellungen stützen eine
   * **Seite**, „Erste Halbzeit" stützt eine **Torlinie** - dort bleibt `side` null. Rückrechnung
   * und Wettschein lesen dieses Feld, statt eine Seite vorauszusetzen.
   */
  market: DashboardMarketKey;
  /** Die Auswahl im Klartext, so wie sie im Wettschein und in `decideMarket` steht. */
  selection: string;
  /**
   * Die Seite, die der Filter stützt. Bei „daves1x2" immer der Modelltipp; bei „dominanz"
   * die Seite mit dem Tabellen- und Serienvorsprung - das kann auch die Gegenseite sein.
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
  /** Nur bei „dominanz" gesetzt. */
  dominanz?: DominanzDetail | null;
  /** Nur bei „hz15" gesetzt. */
  hz15?: Hz15Detail | null;
  /** Nur bei „remis" gesetzt. */
  remis?: RemisDetail | null;
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
    h2hDagegen: 0, keineTabelle: 0, tabelle: 0, serie: 0, formFehlt: 0,
    keineQuote: 0, bilanz: 0, keineDuelle: 0, modellDagegen: 0,
    keinMarkt: 0, torerwartung: 0, remisbild: 0, hzHistorie: 0,
    remisChance: 0
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
  const nonLossRate = (backed.wins + backed.draws) / backed.played;
  const opponentNonLossRate = (other.wins + other.draws) / other.played;
  return {
    nonLossRate,
    opponentNonLossRate,
    nonLossGap: (nonLossRate - opponentNonLossRate) * 100,
    pointsPerGame: backed.points / backed.played - other.points / other.played,
    goalDifference: (backed.goalsFor - backed.goalsAgainst) / backed.played
      - (other.goalsFor - other.goalsAgainst) / other.played,
    positionGap: other.position - backed.position,
    position: backed.position,
    opponentPosition: other.position,
    played: backed.played,
    opponentPlayed: other.played
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

/** Ein bestimmter Markt einer Partie. */
export function marketOf(fixture: DashboardFixture, key: DashboardMarketKey): DashboardMarket | undefined {
  return fixture.markets.find((market) => market.key === key);
}

/**
 * Wie oft in den überlieferten Partien einer Mannschaft **zur Pause** schon zwei Tore
 * gefallen waren, und wie viele Tore es im Mittel waren.
 *
 * Gezählt werden nur Partien, die beide Halbzeitstände führen: Ein fehlender Pausenstand ist
 * keine torlose Halbzeit. Unter vier verwertbaren Partien wird nichts zurückgegeben - der
 * Anteil schwankte dort zwischen 0 und 100 %, ohne etwas zu bedeuten.
 *
 * Die Liste selbst darf fehlen: Snapshots aus der Zeit vor `form.homeMatches` führen sie
 * nicht, und die Rückrechnung liest genau solche Läufe mit. Der Typ verspricht sie zwar, ein
 * archiviertes JSON hält sich daran aber nicht - deshalb die Prüfung zur Laufzeit.
 *
 * Gemessen über 4.397 abgerechnete Partien aus den archivierten Läufen: Der Anteil trennt für
 * sich genommen nur schwach (>= 0,50 im Mittel beider Mannschaften: 39,6 % gegenüber 35,7 %
 * Basisrate). Er steht deshalb im Filter nur als zuschaltbares Tor, nicht als Kerntor.
 */
export function firstHalfRateOf(
  matches: RecentMatchSummary[] | undefined
): { rate: number; goals: number; sample: number } | null {
  if (!Array.isArray(matches)) return null;
  const valid = matches.filter((match) =>
    typeof match.halfTimeHomeGoals === "number" && typeof match.halfTimeAwayGoals === "number");
  if (valid.length < 4) return null;
  const totals = valid.map((match) => (match.halfTimeHomeGoals ?? 0) + (match.halfTimeAwayGoals ?? 0));
  return {
    rate: totals.filter((total) => total >= 2).length / totals.length,
    goals: totals.reduce((sum, total) => sum + total, 0) / totals.length,
    sample: valid.length
  };
}
