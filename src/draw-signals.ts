import type { DashboardFixture } from "./dashboard.ts";
import type { RecentMatchSideStats, RecentMatchSummary } from "./types.ts";

/**
 * Der Remis-Score: ein transparenter Punktwert aus einzelnen, benannten Kriterien.
 *
 * ## Was er ist und was nicht
 *
 * Keine Wahrscheinlichkeit. Jedes Kriterium prüft eine nachvollziehbare Größe aus dem Snapshot
 * (Tabelle, Form am Ort, Spielstatistik der Vorspiele, direkte Duelle, Torerwartung) und
 * vergibt dafür bis zu `weight` Punkte. Die Summe ist der Score, die Einzelwerte samt
 * Begründung stehen daneben. Tipico-Quoten und die Remiswahrscheinlichkeit des Modells gehen
 * bewusst **nicht** ein: Der Score soll eigenständig bleiben, damit die Rückrechnung prüfen
 * kann, ob er über `p(Remis)` hinaus etwas weiß (`npm run draw-signals-report`).
 *
 * Neben dem 100-Punkte-System aus `src/draw-criteria.ts` ist dies die zweite und letzte Stelle,
 * an der Remis-Punkte entstehen dürfen (AGENTS.md, Abschnitt „Grenzen").
 *
 * ## Die Gewichte sind gesetzt, nicht gemessen
 *
 * Alle Startwerte in `DRAW_SIGNAL_CONFIG` stammen aus Überlegung, nicht aus einer Messung.
 * Kriterien mit `weight: 0` werden mitgerechnet und in der Rückrechnung gemessen, tragen aber
 * nichts zum Score bei - so lässt sich ein Kandidat prüfen, bevor er Punkte bekommt.
 *
 * ## Datenlage (geprüft am 24.09.2026 über 9.807 Spiele in `fixture_results`)
 *
 * - Schüsse, Schüsse aufs Tor, Ballbesitz: rund 43 % der Spiele. xG: rund 17 %.
 * - Gefährliche Angriffe, Angriffe und Großchancen liefert API-Football **nicht** - es gibt
 *   dafür kein Kriterium, und es darf keins erfunden werden.
 * - Fehlt die Grundlage, ist ein Kriterium **nicht bewertbar**: 0 Punkte, aber ausdrücklich
 *   kein Urteil „unausgeglichen". `evaluableMax` sagt, wie viele Punkte überhaupt zu holen waren.
 *
 * Die Funktion liest nur den Snapshot und ist frei von I/O. App, Quickpicker und Rückrechnung
 * rufen dieselbe Fassung auf - dieselbe Begründung wie bei `autoDecide`.
 */

export type DrawSignalId =
  | "tablePpg"
  | "tableGoalDiff"
  | "venueRecord"
  | "venueForm"
  | "shotShare"
  | "xgShare"
  | "possession"
  | "lowExpectedGoals"
  | "closeGames"
  | "h2hDraws"
  | "h2hLowScoring"
  | "halfTime"
  | "h2hShotShare"
  | "cleanSheets"
  | "lowScoringForm";

export type DrawSignalGroup = "staerke" | "form" | "spielbild" | "tore" | "h2h" | "verlauf";

/**
 * Schwellen eines Kriteriums. `full` gibt die vollen Punkte, `partial` den Anteil `partialLevel`
 * davon. Ob kleiner oder größer besser ist, legt das Kriterium selbst fest (Unterschiede:
 * kleiner; Anteile: größer) - das steht an jeder Regel dabei.
 */
export interface DrawSignalRule {
  weight: number;
  full: number;
  partial: number | null;
  /** Anteil der Punkte bei der zweiten Schwelle, Vorgabe 0,5. */
  partialLevel?: number;
  /** Mindestzahl verwertbarer Spiele je Seite, darunter nicht bewertbar. */
  minSample: number;
}

export interface DrawSignalConfig {
  /** Steht in jedem Ergebnis, damit eine Messung ihrer Gewichtung zugeordnet bleibt. */
  version: string;
  /**
   * Die Form zählt nur, wenn die Gegner beider Seiten ähnlich stark waren: mittlere
   * Tabellenpunkte je Spiel der letzten Gegner, höchstens so weit auseinander.
   */
  opponentStrengthTolerance: number;
  rules: Record<DrawSignalId, DrawSignalRule>;
}

/**
 * Startwerte, **ungemessen**. Summe der Gewichte: 25. Änderungen gehören vorher durch
 * `npm run draw-signals-report -- --config <datei>` geprüft, nicht nach Gefühl übernommen.
 */
export const DRAW_SIGNAL_CONFIG: DrawSignalConfig = {
  version: "1.0.0",
  opponentStrengthTolerance: 0.3,
  rules: {
    // Unterschied Punkte je Spiel in der Saisontabelle - kleiner ist ausgeglichener.
    tablePpg: { weight: 3, full: 0.15, partial: 0.35, minSample: 4 },
    // Unterschied Tordifferenz je Spiel - kleiner ist ausgeglichener.
    tableGoalDiff: { weight: 2, full: 0.25, partial: 0.5, minSample: 4 },
    // Heimbilanz des Heimteams gegen Auswärtsbilanz des Gastes, Punkte je Spiel - kleiner.
    venueRecord: { weight: 2, full: 0.3, partial: 0.6, minSample: 3 },
    // Form am Ort, Punkte je Spiel aus den letzten fünf - kleiner.
    venueForm: { weight: 3, full: 0.4, partial: 0.8, minSample: 4 },
    // Anteil der Schüsse aufs Tor in den eigenen Spielen, Unterschied beider Teams - kleiner.
    shotShare: { weight: 2, full: 0.05, partial: 0.1, minSample: 3 },
    // Anteil am xG, Unterschied beider Teams - kleiner.
    xgShare: { weight: 2, full: 0.05, partial: 0.1, minSample: 3 },
    // Mittlerer Ballbesitz in Prozentpunkten, Unterschied - kleiner.
    possession: { weight: 1, full: 3, partial: 6, minSample: 3 },
    // Erwartete Tore des Spiels laut Modell - kleiner.
    lowExpectedGoals: { weight: 3, full: 2.2, partial: 2.5, minSample: 0 },
    // Anteil knapper Spiele (höchstens ein Tor Abstand) in den letzten beider Teams - größer.
    closeGames: { weight: 2, full: 0.7, partial: 0.5, minSample: 4 },
    // Remis in den letzten drei Duellen ohne Testspiele - größer. 1 Remis gibt ein Drittel.
    h2hDraws: { weight: 3, full: 2, partial: 1, partialLevel: 1 / 3, minSample: 2 },
    // Mittlere Tore in den Duellen - kleiner.
    h2hLowScoring: { weight: 1, full: 2, partial: 2.5, minSample: 3 },
    // Anteil der Spiele mit höchstens einem Tor zur Pause - größer.
    halfTime: { weight: 1, full: 0.7, partial: 0.55, minSample: 4 },
    // Nur gemessen, noch ohne Punkte: Spielbild in den letzten drei Duellen.
    h2hShotShare: { weight: 0, full: 0.1, partial: 0.2, minSample: 2 },
    // Nur gemessen: beide Teams spielen oft zu null.
    cleanSheets: { weight: 0, full: 0.4, partial: 0.3, minSample: 4 },
    // Nur gemessen: wenige Tore in den letzten Spielen beider Teams (Schnitt je Spiel).
    lowScoringForm: { weight: 0, full: 2.2, partial: 2.6, minSample: 4 }
  }
};

export interface DrawSignalCriterion {
  id: DrawSignalId;
  group: DrawSignalGroup;
  label: string;
  weight: number;
  /** 0, der Teilanteil oder 1. Unabhängig vom Gewicht - so misst die Rückrechnung auch Gewicht 0. */
  level: number;
  points: number;
  evaluable: boolean;
  /** Die gemessene Größe, falls bewertbar. */
  value: number | null;
  /** Klartext für die App, ohne die Punktzahl. */
  reason: string;
}

export interface DrawSignalResult {
  version: string;
  score: number;
  /** Summe aller Gewichte. */
  max: number;
  /** Summe der Gewichte, deren Kriterium bewertbar war. */
  evaluableMax: number;
  criteria: DrawSignalCriterion[];
}

/** Anzeigename und Gruppe je Kriterium, in der Reihenfolge der Anzeige. */
export const DRAW_SIGNAL_META: Array<{ id: DrawSignalId; group: DrawSignalGroup; label: string }> = [
  { id: "tablePpg", group: "staerke", label: "Punkte je Spiel ähnlich" },
  { id: "tableGoalDiff", group: "staerke", label: "Tordifferenz ähnlich" },
  { id: "venueRecord", group: "staerke", label: "Heimbilanz ≈ Auswärtsbilanz" },
  { id: "venueForm", group: "form", label: "Form am Ort ähnlich" },
  { id: "shotShare", group: "spielbild", label: "Schüsse aufs Tor ähnlich verteilt" },
  { id: "xgShare", group: "spielbild", label: "xG (erwartete Tore aus Chancen) ähnlich" },
  { id: "possession", group: "spielbild", label: "Ballbesitz ähnlich" },
  { id: "lowExpectedGoals", group: "tore", label: "Wenige Tore erwartet" },
  { id: "closeGames", group: "tore", label: "Oft knappe Spiele" },
  { id: "h2hDraws", group: "h2h", label: "Remis in den direkten Duellen (H2H)" },
  { id: "h2hLowScoring", group: "h2h", label: "Torarme direkte Duelle" },
  { id: "halfTime", group: "verlauf", label: "Zur Pause meist eng" },
  { id: "h2hShotShare", group: "h2h", label: "Ausgeglichenes Spielbild im H2H" },
  { id: "cleanSheets", group: "tore", label: "Beide spielen oft zu null" },
  { id: "lowScoringForm", group: "tore", label: "Wenige Tore in den letzten Spielen" }
];

const comma = (value: number, digits = 2) => value.toFixed(digits).replace(".", ",");
const percent = (value: number) => `${Math.round(value * 100)} %`;

/** Kleiner ist besser: volle Punkte bis `full`, Teilpunkte bis `partial`. */
function levelAtMost(value: number, rule: DrawSignalRule): number {
  if (value <= rule.full) return 1;
  if (rule.partial !== null && value <= rule.partial) return rule.partialLevel ?? 0.5;
  return 0;
}

/** Größer ist besser. */
function levelAtLeast(value: number, rule: DrawSignalRule): number {
  if (value >= rule.full) return 1;
  if (rule.partial !== null && value >= rule.partial) return rule.partialLevel ?? 0.5;
  return 0;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Ob die betrachtete Mannschaft in dieser Partie zu Hause war. Läufe vor dem 22.09.2026 führen
 * `teamWasHome` nicht - dort entscheidet der Name, und ohne Treffer bleibt es offen.
 */
function wasHome(match: RecentMatchSummary, team: string): boolean | null {
  if (typeof match.teamWasHome === "boolean") return match.teamWasHome;
  if (match.homeTeam === team) return true;
  if (match.awayTeam === team) return false;
  return null;
}

function listOf(matches: RecentMatchSummary[] | undefined): RecentMatchSummary[] {
  // Ein archiviertes JSON hält sich nicht an den Typ: Läufe vor `form.homeMatches` führen die
  // Liste nicht. Die Rückrechnung liest genau solche Läufe mit.
  return Array.isArray(matches) ? matches : [];
}

/** Eigene und gegnerische Statistik einer Mannschaft in einer Partie. */
function sidesOf(match: RecentMatchSummary, team: string): { own: RecentMatchSideStats; other: RecentMatchSideStats } | null {
  const home = wasHome(match, team);
  if (!match.stats || home === null) return null;
  return home
    ? { own: match.stats.home, other: match.stats.away }
    : { own: match.stats.away, other: match.stats.home };
}

/**
 * Der mittlere Anteil einer Mannschaft an einer Größe in ihren Spielen, etwa an den Schüssen
 * aufs Tor. 0,5 heißt: im Schnitt so viel wie der Gegner. Spiele ohne den Wert oder mit einer
 * Summe von null zählen nicht mit.
 */
function shareOf(
  matches: RecentMatchSummary[],
  team: string,
  pick: (side: RecentMatchSideStats) => number | null | undefined
): { share: number; sample: number } | null {
  const shares: number[] = [];
  for (const match of matches) {
    const sides = sidesOf(match, team);
    if (!sides) continue;
    const own = pick(sides.own);
    const other = pick(sides.other);
    if (typeof own !== "number" || typeof other !== "number" || own + other <= 0) continue;
    shares.push(own / (own + other));
  }
  const average = mean(shares);
  return average === null ? null : { share: average, sample: shares.length };
}

/** Punkte je Spiel aus Formergebnissen: Sieg 3, Remis 1, Niederlage 0. */
function formPpg(results: DashboardFixture["form"]["home"]): number | null {
  if (results.length === 0) return null;
  return results.reduce((sum, result) => sum + (result === "win" ? 3 : result === "draw" ? 1 : 0), 0) / results.length;
}

type Table = NonNullable<DashboardFixture["table"]>;

/**
 * Mittlere Tabellenpunkte je Spiel der Gegner in den letzten Spielen einer Mannschaft - der
 * Maßstab dafür, ob ihre Form gegen starke oder schwache Gegner zustande kam. Nur Gegner aus
 * derselben Tabelle zählen; Pokalgegner fehlen dort.
 */
function opponentStrength(matches: RecentMatchSummary[], team: string, table: Table): { ppg: number; sample: number } | null {
  const values: number[] = [];
  for (const match of matches) {
    const home = wasHome(match, team);
    if (home === null) continue;
    const opponent = table.find((row) => row.teamName === (home ? match.awayTeam : match.homeTeam));
    if (opponent && opponent.played > 0) values.push(opponent.points / opponent.played);
  }
  const average = mean(values);
  return average === null ? null : { ppg: average, sample: values.length };
}

/** Anteil der Spiele, in denen eine Bedingung zutrifft, über die Spiele beider Teams. */
function rateOf(
  lists: RecentMatchSummary[][],
  test: (match: RecentMatchSummary) => boolean | null
): { rate: number; smallest: number } | null {
  let hits = 0;
  let total = 0;
  const counts = lists.map((list) => {
    let usable = 0;
    for (const match of list) {
      const outcome = test(match);
      if (outcome === null) continue;
      usable += 1;
      total += 1;
      if (outcome) hits += 1;
    }
    return usable;
  });
  if (total === 0) return null;
  return { rate: hits / total, smallest: Math.min(...counts) };
}

interface Draft {
  evaluable: boolean;
  level: number;
  value: number | null;
  reason: string;
}

const notEvaluable = (reason: string): Draft => ({ evaluable: false, level: 0, value: null, reason });

export function scoreDrawSignals(
  fixture: DashboardFixture,
  config: DrawSignalConfig = DRAW_SIGNAL_CONFIG
): DrawSignalResult {
  const rules = config.rules;
  const table = fixture.table ?? null;
  const homeRow = table?.find((row) => row.teamName === fixture.homeTeam) ?? null;
  const awayRow = table?.find((row) => row.teamName === fixture.awayTeam) ?? null;
  const homeMatches = listOf(fixture.form.homeMatches).slice(0, 5);
  const awayMatches = listOf(fixture.form.awayMatches).slice(0, 5);
  // Testspiele fallen heraus: `h2hSummary` zählt sie mit, und ein 2:2 im Sommer-Testspiel
  // sagt über ein Ligaspiel nichts.
  const duels = listOf(fixture.h2h.matches).filter((match) => match.friendly !== true);

  const drafts: Record<DrawSignalId, () => Draft> = {
    tablePpg: () => {
      const rule = rules.tablePpg;
      if (!homeRow || !awayRow) return notEvaluable("keine Tabelle für dieses Spiel");
      if (Math.min(homeRow.played, awayRow.played) < rule.minSample) return notEvaluable("zu wenige Spieltage");
      const home = homeRow.points / homeRow.played;
      const away = awayRow.points / awayRow.played;
      const gap = Math.abs(home - away);
      return { evaluable: true, level: levelAtMost(gap, rule), value: gap, reason: `${comma(home)} zu ${comma(away)} Punkte je Spiel` };
    },
    tableGoalDiff: () => {
      const rule = rules.tableGoalDiff;
      if (!homeRow || !awayRow) return notEvaluable("keine Tabelle für dieses Spiel");
      if (Math.min(homeRow.played, awayRow.played) < rule.minSample) return notEvaluable("zu wenige Spieltage");
      const home = (homeRow.goalsFor - homeRow.goalsAgainst) / homeRow.played;
      const away = (awayRow.goalsFor - awayRow.goalsAgainst) / awayRow.played;
      const gap = Math.abs(home - away);
      const signed = (value: number) => `${value >= 0 ? "+" : "−"}${comma(Math.abs(value))}`;
      return { evaluable: true, level: levelAtMost(gap, rule), value: gap, reason: `Tordifferenz je Spiel ${signed(home)} zu ${signed(away)}` };
    },
    venueRecord: () => {
      const rule = rules.venueRecord;
      if (!homeRow || !awayRow) return notEvaluable("keine Tabelle für dieses Spiel");
      if (typeof homeRow.homePlayed !== "number" || typeof awayRow.awayPlayed !== "number"
        || typeof homeRow.homePoints !== "number" || typeof awayRow.awayPoints !== "number") {
        return notEvaluable("Heim-/Auswärtsbilanz erst ab der nächsten Analyse");
      }
      if (Math.min(homeRow.homePlayed, awayRow.awayPlayed) < rule.minSample) return notEvaluable("zu wenige Heim- bzw. Auswärtsspiele");
      const home = homeRow.homePoints / homeRow.homePlayed;
      const away = awayRow.awayPoints / awayRow.awayPlayed;
      const gap = Math.abs(home - away);
      return { evaluable: true, level: levelAtMost(gap, rule), value: gap, reason: `zu Hause ${comma(home)}, auswärts ${comma(away)} Punkte je Spiel` };
    },
    venueForm: () => {
      const rule = rules.venueForm;
      const home = formPpg(fixture.form.home);
      const away = formPpg(fixture.form.away);
      if (home === null || away === null || Math.min(fixture.form.home.length, fixture.form.away.length) < rule.minSample) {
        return notEvaluable("zu wenige letzte Spiele");
      }
      const gap = Math.abs(home - away);
      const base = `${comma(home)} zu ${comma(away)} Punkte je Spiel`;
      // Der Wächter aus Davids Vorgabe: Eine ähnliche Form zählt nicht, wenn eine Seite sie
      // gegen deutlich schwächere Gegner geholt hat.
      const homeOpp = table ? opponentStrength(homeMatches, fixture.homeTeam, table) : null;
      const awayOpp = table ? opponentStrength(awayMatches, fixture.awayTeam, table) : null;
      if (homeOpp && awayOpp && homeOpp.sample >= 3 && awayOpp.sample >= 3) {
        const oppGap = Math.abs(homeOpp.ppg - awayOpp.ppg);
        if (oppGap > config.opponentStrengthTolerance) {
          return {
            evaluable: true, level: 0, value: gap,
            reason: `${base} – zählt nicht: Die Gegner waren unterschiedlich stark`
              + ` (${comma(homeOpp.ppg)} zu ${comma(awayOpp.ppg)} Punkte je Spiel)`
          };
        }
        return { evaluable: true, level: levelAtMost(gap, rule), value: gap, reason: `${base}, gegen ähnlich starke Gegner` };
      }
      return { evaluable: true, level: levelAtMost(gap, rule), value: gap, reason: `${base} (Stärke der Gegner nicht prüfbar)` };
    },
    shotShare: () => {
      const rule = rules.shotShare;
      const home = shareOf(homeMatches, fixture.homeTeam, (side) => side.shotsOnGoal);
      const away = shareOf(awayMatches, fixture.awayTeam, (side) => side.shotsOnGoal);
      if (!home || !away || Math.min(home.sample, away.sample) < rule.minSample) return notEvaluable("zu wenige Spiele mit Schussdaten");
      const gap = Math.abs(home.share - away.share);
      return { evaluable: true, level: levelAtMost(gap, rule), value: gap, reason: `Anteil an den Schüssen aufs Tor ${percent(home.share)} zu ${percent(away.share)}` };
    },
    xgShare: () => {
      const rule = rules.xgShare;
      const home = shareOf(homeMatches, fixture.homeTeam, (side) => side.xg);
      const away = shareOf(awayMatches, fixture.awayTeam, (side) => side.xg);
      if (!home || !away || Math.min(home.sample, away.sample) < rule.minSample) return notEvaluable("zu wenige Spiele mit xG");
      const gap = Math.abs(home.share - away.share);
      return { evaluable: true, level: levelAtMost(gap, rule), value: gap, reason: `Anteil am xG ${percent(home.share)} zu ${percent(away.share)}` };
    },
    possession: () => {
      const rule = rules.possession;
      const values = (matches: RecentMatchSummary[], team: string) => matches
        .map((match) => sidesOf(match, team)?.own.possession)
        .filter((value): value is number => typeof value === "number");
      const home = values(homeMatches, fixture.homeTeam);
      const away = values(awayMatches, fixture.awayTeam);
      if (Math.min(home.length, away.length) < rule.minSample) return notEvaluable("zu wenige Spiele mit Ballbesitz");
      const gap = Math.abs(mean(home)! - mean(away)!);
      return { evaluable: true, level: levelAtMost(gap, rule), value: gap, reason: `Ballbesitz ${Math.round(mean(home)!)} % zu ${Math.round(mean(away)!)} %` };
    },
    lowExpectedGoals: () => {
      const rule = rules.lowExpectedGoals;
      const total = fixture.expectedGoals.total;
      if (typeof total !== "number" || !Number.isFinite(total)) return notEvaluable("keine Torerwartung");
      return { evaluable: true, level: levelAtMost(total, rule), value: total, reason: `${comma(total)} Tore erwartet` };
    },
    closeGames: () => {
      const rule = rules.closeGames;
      const rate = rateOf([homeMatches, awayMatches], (match) => Math.abs(match.homeGoals - match.awayGoals) <= 1);
      if (!rate || rate.smallest < rule.minSample) return notEvaluable("zu wenige letzte Spiele");
      return { evaluable: true, level: levelAtLeast(rate.rate, rule), value: rate.rate, reason: `${percent(rate.rate)} der letzten Spiele mit höchstens einem Tor Abstand` };
    },
    h2hDraws: () => {
      const rule = rules.h2hDraws;
      const lastThree = duels.slice(0, 3);
      if (lastThree.length < rule.minSample) return notEvaluable("zu wenige direkte Duelle");
      const draws = lastThree.filter((match) => match.homeGoals === match.awayGoals).length;
      return { evaluable: true, level: levelAtLeast(draws, rule), value: draws, reason: `letzte ${lastThree.length} Duelle: ${draws} Remis` };
    },
    h2hLowScoring: () => {
      const rule = rules.h2hLowScoring;
      if (duels.length < rule.minSample) return notEvaluable("zu wenige direkte Duelle");
      const goals = mean(duels.map((match) => match.homeGoals + match.awayGoals))!;
      return { evaluable: true, level: levelAtMost(goals, rule), value: goals, reason: `${comma(goals, 1)} Tore je Duell (${duels.length} Duelle)` };
    },
    halfTime: () => {
      const rule = rules.halfTime;
      const rate = rateOf([homeMatches, awayMatches], (match) =>
        typeof match.halfTimeHomeGoals === "number" && typeof match.halfTimeAwayGoals === "number"
          ? match.halfTimeHomeGoals + match.halfTimeAwayGoals <= 1
          : null);
      if (!rate || rate.smallest < rule.minSample) return notEvaluable("zu wenige Halbzeitstände");
      return { evaluable: true, level: levelAtLeast(rate.rate, rule), value: rate.rate, reason: `${percent(rate.rate)} der letzten Spiele zur Pause mit höchstens einem Tor` };
    },
    h2hShotShare: () => {
      const rule = rules.h2hShotShare;
      const imbalance: number[] = [];
      for (const match of duels.slice(0, 3)) {
        const own = match.stats?.home.shotsOnGoal;
        const other = match.stats?.away.shotsOnGoal;
        if (typeof own !== "number" || typeof other !== "number" || own + other <= 0) continue;
        imbalance.push(Math.abs(own / (own + other) - 0.5));
      }
      if (imbalance.length < rule.minSample) return notEvaluable("zu wenige Duelle mit Schussdaten");
      const value = mean(imbalance)!;
      return { evaluable: true, level: levelAtMost(value, rule), value, reason: `Schüsse aufs Tor in den Duellen im Schnitt ${percent(0.5 + value)} zu ${percent(0.5 - value)} verteilt` };
    },
    cleanSheets: () => {
      const rule = rules.cleanSheets;
      const rate = (matches: RecentMatchSummary[], team: string) => {
        const usable = matches.filter((match) => wasHome(match, team) !== null);
        if (usable.length === 0) return null;
        return usable.filter((match) => (wasHome(match, team) ? match.awayGoals : match.homeGoals) === 0).length / usable.length;
      };
      const home = rate(homeMatches, fixture.homeTeam);
      const away = rate(awayMatches, fixture.awayTeam);
      if (home === null || away === null || Math.min(homeMatches.length, awayMatches.length) < rule.minSample) {
        return notEvaluable("zu wenige letzte Spiele");
      }
      const lower = Math.min(home, away);
      return { evaluable: true, level: levelAtLeast(lower, rule), value: lower, reason: `zu null in ${percent(home)} und ${percent(away)} der letzten Spiele` };
    },
    lowScoringForm: () => {
      const rule = rules.lowScoringForm;
      const all = [...homeMatches, ...awayMatches];
      if (Math.min(homeMatches.length, awayMatches.length) < rule.minSample) return notEvaluable("zu wenige letzte Spiele");
      const goals = mean(all.map((match) => match.homeGoals + match.awayGoals))!;
      return { evaluable: true, level: levelAtMost(goals, rule), value: goals, reason: `${comma(goals, 1)} Tore je Spiel in den letzten Spielen beider Teams` };
    }
  };

  const criteria: DrawSignalCriterion[] = DRAW_SIGNAL_META.map((meta) => {
    const draft = drafts[meta.id]();
    const weight = rules[meta.id].weight;
    return {
      id: meta.id,
      group: meta.group,
      label: meta.label,
      weight,
      level: draft.level,
      points: draft.level * weight,
      evaluable: draft.evaluable,
      value: draft.value,
      reason: draft.reason
    };
  });

  return {
    version: config.version,
    score: criteria.reduce((sum, criterion) => sum + criterion.points, 0),
    max: criteria.reduce((sum, criterion) => sum + criterion.weight, 0),
    evaluableMax: criteria.reduce((sum, criterion) => sum + (criterion.evaluable ? criterion.weight : 0), 0),
    criteria
  };
}

/** Punkte ohne überflüssige Nachkommastelle: 3 statt 3,0, aber 1,5 bleibt. */
export function formatDrawPoints(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}
