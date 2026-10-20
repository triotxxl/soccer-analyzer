/**
 * Kombi-Auswahl nach fairem Tipico-Preis: je Spiel der Tipp, den Tipico (ohne Aufschlag) am
 * wahrscheinlichsten hält, unter einer Mindestquote. Aufgerufen von `tools/kombi-tipps.ts`, dort
 * auch die Messung an alten Spielen; Hintergrund in AGENTS.md, „Kombi-Auswahl nach fairem Preis“.
 * Zweiter Aufrufer ist die Quickpick-Voreinstellung „Kombi-Tipps ab 1,60“
 * (`src/quickpick-kombi.ts`): dieselbe Regel mit Mindestquote 1,60 ohne Vorliebe, aber **ohne
 * die Anstoßprüfung**, weil der Snapshot die Tipico-Anstoßzeit nicht trägt (an alten Spielen
 * hätte sie 12 von 3.913 Spielen ausgeschlossen, alle richtig zugeordnet).
 *
 * Herkunft (Prüfer-Agent, 12.10.2026, Davids Auftrag „die 24 besten Tipps bis Mittwoch, Quote ab
 * 1,50, besser 1,60“): Die Regel wurde vor dem ersten Lauf festgelegt und an 3.868 Spielen der
 * archivierten Snapshots (10.09.-11.10.2026, je Spiel der letzte Stand vor Anpfiff) gemessen:
 *
 * - Der faire Preis trifft im Bereich ab 1,50 genau: bester Tipp je Spiel 57,7 % eingetreten gegen
 *   57,4 % fair (+0,3 ± 0,8), Zeithälften +1,1 / −0,6; ab 1,60 allein +0,4 ± 0,8.
 * - **Ertrag je Tipp −7,8 ± 1,3 %** - der Aufschlag. Die Regel findet keinen Vorteil, sie findet die
 *   Tipps mit der höchsten Trefferchance je Quote. Das ist der Maßstab für Kombis.
 * - Das Modell trägt nichts bei: Liegt es ≥ 8 Punkte über oder unter fair, ändert das die
 *   Trefferquote nicht messbar (+2,6 ± 2,0 bzw. −0,0 ± 1,4). Es steht nur zur Anzeige daneben und
 *   ändert keinen sportlichen Tipp des Modells.
 * - Quoten über 24 bzw. 48 Stunden alt waren nicht messbar schlechter (+1,0 ± 1,3; −1,3 ± 2,6).
 * - 1X2-Favoriten mit Quote 1,45-1,90 treffen rund 1,6 ± 0,8 Punkte öfter als proportional fair
 *   (bekannter Favoriteneffekt). Nur Hinweis, nicht in der Rangfolge.
 *
 * Die Regel ist eine nachgelagerte Auswahl über Tipico-Preise: Sie ändert weder Tipp noch
 * Wahrscheinlichkeit des Modells und gehört nicht in die Empfehlungsstufe des Dashboards.
 */
import type { DashboardFixture, DashboardMarketKey } from "./dashboard.ts";
import { fairProbabilityOf } from "./fair-price.ts";

export interface KombiRule {
  /** Pflicht: kein Tipp darunter. */
  minOdds: number;
  /** Bevorzugt: ein Tipp ab dieser Quote gewinnt, solange er nicht deutlich schwächer ist. */
  preferredOdds: number;
  /** „Deutlich schwächer“: faire Chance mehr als so viel unter dem besten Tipp darunter. */
  preferMargin: number;
}

/** Die vorab festgelegte Fassung vom 12.10.2026. Wer sie ändert, misst neu (`--messen`). */
export const KOMBI_RULE: KombiRule = { minOdds: 1.5, preferredOdds: 1.6, preferMargin: 0.03 };

/**
 * Auffällig heißt ausgeschlossen und genannt. Die Grenzen stehen fest, damit die Liste nicht nach
 * Gefühl gekürzt wird: Always Ready - Petrolero zu 1,02 gegen den Tabellenzehnten (12.10.2026)
 * war der Anlass.
 */
export const KOMBI_FLAGS = {
  /** Eine 1X2-Quote bis hierhin ist entweder ein Datenfehler oder ein Spiel, das wir nicht verstehen. */
  maxSuspiciousOdds: 1.05,
  /** Σ 1/Quote des 1X2-Tripels außerhalb dieses Bereichs: Quote vermutlich falsch eingelesen. */
  bookRange: [1.03, 1.2] as const,
  /** Modell und fairer Preis einer 1X2-Seite so weit auseinander: Eines von beiden kennt etwas nicht. */
  modelGap: 0.2,
  /** Anstoß bei Tipico und API so weit auseinander: Zuordnung oder Termin fraglich. */
  kickoffGapMs: 60 * 60 * 1000
};

export interface KombiTip {
  marketKey: DashboardMarketKey;
  selection: string;
  odds: number;
  /** Faire Tipico-Chance (Aufschlag proportional entfernt) - der Maßstab. */
  fair: number;
  /** Modellchance, nur zur Anzeige. */
  model: number;
  confidence: number;
  /** Nur beim 1X2: die Mannschaft des Tipps. Wettschein und Rückrechnung brauchen die Seite. */
  side?: "1" | "2";
}

const usable = (odds: number | null | undefined): odds is number => typeof odds === "number" && odds > 1;

/**
 * Alle Tipps eines Spiels mit echter Gegenquote. Beim 1X2 beide Seiten, weil die faire Chance
 * nicht davon abhängt, welche Seite das Modell tippt. Geschätzte faire Preise (ohne Gegenquote)
 * fallen heraus, ebenso Märkte mit `probabilityReliable: false`.
 */
export function tipsOf(fixture: DashboardFixture): KombiTip[] {
  const tips: KombiTip[] = [];
  const oneXTwo = fixture.markets.find((market) => market.key === "1x2");
  const draw = fixture.markets.find((market) => market.key === "draw");
  const home = oneXTwo?.oddsHome;
  const away = oneXTwo?.oddsAway;
  if (oneXTwo && draw && oneXTwo.pick !== null && oneXTwo.probabilityReliable !== false
    && usable(home) && usable(away) && usable(draw.odds)) {
    const book = 1 / home + 1 / draw.odds + 1 / away;
    const other = 1 - oneXTwo.probability - draw.probability;
    for (const side of ["1", "2"] as const) {
      const odds = side === "1" ? home : away;
      tips.push({
        marketKey: "1x2",
        selection: side === "1" ? `Heimsieg ${fixture.homeTeam}` : `Auswärtssieg ${fixture.awayTeam}`,
        odds,
        fair: 1 / odds / book,
        model: oneXTwo.pick === side ? oneXTwo.probability : other,
        confidence: oneXTwo.confidence,
        side
      });
    }
  }
  for (const market of fixture.markets) {
    if (market.key === "1x2" || market.probabilityReliable === false || !usable(market.odds)) continue;
    const fair = fairProbabilityOf(fixture, market);
    if (fair === null || fair.source !== "quote") continue;
    tips.push({
      marketKey: market.key,
      selection: market.selection,
      odds: market.odds,
      fair: fair.probability,
      model: market.probability,
      confidence: market.confidence
    });
  }
  return tips;
}

/**
 * Ein Grund, ein Spiel auszuschließen, mit den Werten dahinter. Strukturiert statt als Text, weil
 * zwei Leser verschieden formulieren: die Kommandozeile mit Zahlen (`flagText`), die App in
 * einfacher Sprache, ohne Quote und ohne die beiden Prozentzahlen beim Modellabstand - die wären
 * ein Vorteil in Zahlen, und den zeigt die App nur unter „Vorteil & Kelly“. Ein großer Abstand
 * ist laut Messung meist ein Fehler des Modells, nicht des Preises.
 */
export type KombiFlag =
  | { code: "quote"; odds: number }
  | { code: "aufschlag"; book: number }
  | { code: "gleicheQuoten" }
  | { code: "modellAbstand"; side: "1" | "2"; model: number; fair: number }
  | { code: "anstoss"; tipico: string; api: string };

/** Der Grund als Zeile der Kommandozeile, so wie `tools/kombi-tipps.ts` ihn immer gedruckt hat. */
export function flagText(flag: KombiFlag): string {
  switch (flag.code) {
    case "quote": return `1X2-Quote ${flag.odds.toFixed(2)}`;
    case "aufschlag": return `1X2-Aufschlag ${flag.book.toFixed(3)}`;
    case "gleicheQuoten": return "1X2 dreimal dieselbe Quote";
    case "modellAbstand":
      return `1X2 ${flag.side === "1" ? "Heim" : "Gast"}: Modell ${(flag.model * 100).toFixed(0)} % gegen fair ${(flag.fair * 100).toFixed(0)} %`;
    case "anstoss": return `Anstoß Tipico ${flag.tipico} gegen API ${flag.api}`;
  }
}

/**
 * Gründe, ein Spiel auszuschließen; leer = unauffällig. `tipicoKickoff` aus `tipico_fixtures` -
 * der Quickpicker kennt ihn nicht (er liest nur den Snapshot) und prüft den Anstoß deshalb nicht.
 */
export function flagsOf(fixture: DashboardFixture, tipicoKickoff?: string | null): KombiFlag[] {
  const flags: KombiFlag[] = [];
  const oneXTwo = fixture.markets.find((market) => market.key === "1x2");
  const draw = fixture.markets.find((market) => market.key === "draw");
  const home = oneXTwo?.oddsHome;
  const away = oneXTwo?.oddsAway;
  if (oneXTwo && usable(home) && usable(away) && usable(draw?.odds)) {
    const lowest = Math.min(home, away, draw.odds);
    const book = 1 / home + 1 / draw.odds + 1 / away;
    if (lowest <= KOMBI_FLAGS.maxSuspiciousOdds) flags.push({ code: "quote", odds: lowest });
    if (book < KOMBI_FLAGS.bookRange[0] || book > KOMBI_FLAGS.bookRange[1]) flags.push({ code: "aufschlag", book });
    if (home === away && away === draw.odds) flags.push({ code: "gleicheQuoten" });
    if (oneXTwo.pick !== null && oneXTwo.probabilityReliable !== false) {
      const other = 1 - oneXTwo.probability - draw.probability;
      for (const side of ["1", "2"] as const) {
        const fair = 1 / (side === "1" ? home : away) / book;
        const model = oneXTwo.pick === side ? oneXTwo.probability : other;
        if (Math.abs(model - fair) >= KOMBI_FLAGS.modelGap) flags.push({ code: "modellAbstand", side, model, fair });
      }
    }
  }
  if (tipicoKickoff) {
    const gap = Math.abs(Date.parse(tipicoKickoff) - Date.parse(fixture.kickoff));
    if (gap > KOMBI_FLAGS.kickoffGapMs) flags.push({ code: "anstoss", tipico: tipicoKickoff, api: fixture.kickoff });
  }
  return flags;
}

export interface KombiChoice {
  chosen: KombiTip;
  /** Bester Tipp ab `preferredOdds` - auch wenn er nicht gewählt wurde. */
  preferred: KombiTip | null;
  /** Bester Tipp zwischen `minOdds` und `preferredOdds`. */
  fallback: KombiTip | null;
}

const best = (tips: KombiTip[]): KombiTip | null =>
  tips.reduce<KombiTip | null>((top, tip) => (top === null || tip.fair > top.fair ? tip : top), null);

/** Genau ein Tipp je Spiel - Davids Vorgabe vom 12.10.2026. */
export function chooseTip(tips: KombiTip[], rule: KombiRule = KOMBI_RULE): KombiChoice | null {
  const eligible = tips.filter((tip) => tip.odds >= rule.minOdds);
  const preferred = best(eligible.filter((tip) => tip.odds >= rule.preferredOdds));
  const fallback = best(eligible.filter((tip) => tip.odds < rule.preferredOdds));
  const chosen = preferred === null
    ? fallback
    : fallback !== null && fallback.fair - preferred.fair > rule.preferMargin ? fallback : preferred;
  return chosen === null ? null : { chosen, preferred, fallback };
}

export interface KombiStats {
  odds: number;
  /** Chance, dass alle Tipps aufgehen, aus den fairen Chancen (Spiele als unabhängig gerechnet). */
  fair: number;
  model: number;
  /** Was auf Dauer zurückkommt, zum fairen Preis: Quote × faire Chance − 1. */
  longRun: number;
}

export function comboStats(tips: KombiTip[]): KombiStats {
  const odds = tips.reduce((product, tip) => product * tip.odds, 1);
  const fair = tips.reduce((product, tip) => product * tip.fair, 1);
  const model = tips.reduce((product, tip) => product * tip.model, 1);
  return { odds, fair, model, longRun: odds * fair - 1 };
}

/**
 * Teilt nach Anstoß sortierte Tipps in Kombis zu je `legs` - so wird jede Kombi vor ihrem ersten
 * Anstoß gesetzt, und ein frühes Spiel blockiert keine späte Kombi. Ein Rest unter zwei Tipps
 * hängt an der letzten Kombi.
 */
export function splitIntoCombos<T>(sortedByKickoff: T[], legs: number): T[][] {
  if (legs < 1) throw new Error("Eine Kombi braucht mindestens einen Tipp.");
  const combos: T[][] = [];
  for (let start = 0; start < sortedByKickoff.length; start += legs) {
    combos.push(sortedByKickoff.slice(start, start + legs));
  }
  const last = combos.at(-1);
  if (combos.length > 1 && last !== undefined && last.length < 2) {
    combos.pop();
    combos.at(-1)!.push(...last);
  }
  return combos;
}

/** Millisekunden, um die Berliner Ortszeit zum Zeitpunkt `utcMs` vor UTC liegt. */
function berlinOffsetMs(utcMs: number): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]));
  const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/** „now“, ISO mit Zone, Berliner Ortszeit ohne Zone oder ein Datum (= Ende des Tages). */
export function parseBerlin(spec: string, now = Date.now()): number {
  if (spec === "now" || spec === "jetzt") return now;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(spec)) {
    const value = Date.parse(spec);
    if (Number.isFinite(value)) return value;
  }
  const match = spec.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
  if (!match) throw new Error(`Unbekannte Zeitangabe „${spec}“ (erwartet z. B. 2026-10-14 oder 2026-10-13T09:00).`);
  const [, y, mo, d, h, mi] = match;
  const wall = h === undefined
    ? Date.UTC(+y!, +mo! - 1, +d!, 23, 59, 59)
    : Date.UTC(+y!, +mo! - 1, +d!, +h, +mi!);
  let utc = wall - berlinOffsetMs(wall);
  utc = wall - berlinOffsetMs(utc);
  return utc;
}
