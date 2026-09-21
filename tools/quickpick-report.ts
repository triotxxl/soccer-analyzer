/**
 * Rechnet die Strengestufen des Quickpickers gegen die eigenen Ergebnisse zurück und meldet,
 * wenn die im Code hinterlegten Zahlen nicht mehr stimmen.
 *
 * Grundlage sind dieselben Bestände wie beim Edge-Report: die archivierten Snapshots in
 * `output/` und die abgerechneten Ergebnisse in SQLite. Je Partie zählt der jüngste Snapshot.
 * Ausgewertet wird `evaluateFixture` aus `src/quickpick.ts`, also genau die Fassung, die auch
 * die App benutzt; eine zweite Fassung hier würde die Rückrechnung wertlos machen.
 *
 * Jede Voreinstellung hat ihren eigenen Maßstab: „daves1x2" und „hz15" zählen die Trefferquote
 * je Bein, „dominanz" den Ertrag je Bein. Alle drei liefern Beine für Kombis - nur der Maßstab
 * unterscheidet sich, weil bei „dominanz" die Trefferquote fast exakt der Quote folgt.
 *
 * **Zwei Arten von Auswahl:** Die 1X2-Voreinstellungen stützen eine *Seite* und werden über
 * den Sieger abgerechnet. „hz15" stützt eine *Torlinie*; dort entscheidet `decideMarket`
 * anhand des Pausenstands, und eine Partie ohne überlieferten Pausenstand fällt heraus, statt
 * als Niederlage zu zählen.
 *
 * **Grenze der Abrechnung:** `tipico_fixtures` speichert je Partie nur den *letzten* Preis vor
 * Anpfiff. Die Außenseiterquote, zu der hier abgerechnet wird, ist also nicht zwingend die,
 * die die App im Moment des Snapshots gezeigt hätte.
 *
 * Aufruf:
 *   npm run quickpick-report                       alle Voreinstellungen
 *   npm run quickpick-report -- --preset dominanz  nur eine
 *   npm run quickpick-report -- --kombi-tage 3     Kombis über drei Spieltage ziehen
 *   npm run quickpick-report -- --write            Stand als Kalibrierpunkt festhalten
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_FILE, ROOT_DIR } from "../src/config.ts";
import type { DashboardFixture } from "../src/dashboard.ts";
import { decideMarket } from "../src/market-outcome.ts";
import {
  QUICKPICK_PRESETS,
  QUICKPICK_PRESET_LIST,
  applyLevel,
  evaluateFixture,
  type AnyQuickpickPreset,
  type QuickpickLevelId,
  type QuickpickComboMeasurement,
  type QuickpickPresetId,
  type QuickpickSettings
} from "../src/quickpick.ts";

const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const STATE_FILE = path.join(ROOT_DIR, "docs", "quickpick-kalibrierung.json");

/**
 * Abstand zwischen zwei Kalibrierungen, in neu abgerechneten Partien. 2.000 ist kein
 * Erfahrungswert, sondern eine Rechnung: Bei rund 150 abgerechneten Partien am Tag entspricht
 * das ungefähr zwei Wochen - genug, damit sich eine Trefferquote messbar bewegen kann, ohne
 * dass jede Woche eine neue Zahl im Code steht.
 */
const RECALIBRATION_STEP = 2_000;

interface StufenStand { n: number; proTag: number; trefferquote: number; roi: number; kombis?: QuickpickComboMeasurement[] }
interface PresetStand { stand: string; abgerechnet: number; stufen: Record<string, StufenStand> }
interface CalibrationState {
  stand: string;
  abgerechnet: number;
  presets: Record<string, PresetStand>;
  /** Altbestand vor der zweiten Voreinstellung - wird beim Lesen migriert. */
  stufen?: Record<string, StufenStand>;
}

interface Bet { kickoff: string; odds: number; hit: boolean }
interface Triple { home: number; draw: number; away: number }

interface SettledOutcome { home: number; away: number; halfHome: number | null; halfAway: number | null }

/**
 * Die abgerechneten Ergebnisse. Der Pausenstand gehört seit „hz15" dazu: Ohne ihn ließe sich
 * „1. HZ Ü1,5" gar nicht entscheiden.
 */
function readOutcomes(): Map<number, SettledOutcome> {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error("Es gibt noch keine Datenbank mit abgerechneten Ergebnissen.");
  }
  const database = new DatabaseSync(DB_FILE, { readOnly: true });
  const outcomes = new Map<number, SettledOutcome>();
  const rows = database.prepare(`
    SELECT fixture_id, actual_home_goals, actual_away_goals,
           actual_halftime_home_goals, actual_halftime_away_goals
    FROM goal_line_predictions
    WHERE settled_at IS NOT NULL AND actual_home_goals IS NOT NULL AND actual_away_goals IS NOT NULL
  `).all() as Array<Record<string, number | null>>;
  for (const row of rows) {
    outcomes.set(row.fixture_id as number, {
      home: row.actual_home_goals as number,
      away: row.actual_away_goals as number,
      halfHome: row.actual_halftime_home_goals ?? null,
      halfAway: row.actual_halftime_away_goals ?? null
    });
  }
  database.close();
  return outcomes;
}

/**
 * Die vollständigen Tipico-Quoten je Partie. Nur hierüber lässt sich eine Wette auf die Seite
 * abrechnen, die der Snapshot nicht führt. Unplausible Tripel fliegen raus: Ein
 * Buchmacherschnitt außerhalb von 1,0 bis 1,2 deutet auf ein falsch zugeordnetes Ereignis.
 */
function readTipicoOdds(): Map<number, Triple> {
  const database = new DatabaseSync(DB_FILE, { readOnly: true });
  const prices = new Map<number, Triple>();
  const rows = database.prepare(`
    SELECT api_fixture_id AS id,
           json_extract(odds_json,'$.home') AS home,
           json_extract(odds_json,'$.draw') AS draw,
           json_extract(odds_json,'$.away') AS away
    FROM tipico_fixtures WHERE api_fixture_id IS NOT NULL
  `).all() as Array<Record<string, number | null>>;
  for (const row of rows) {
    const home = row.home, draw = row.draw, away = row.away;
    if (!home || !draw || !away || home <= 1 || draw <= 1 || away <= 1) continue;
    const book = 1 / home + 1 / draw + 1 / away;
    if (book < 1 || book > 1.2) continue;
    prices.set(row.id as number, { home, draw, away });
  }
  database.close();
  return prices;
}

/** Je Partie der jüngste Snapshot - Quoten werden bis zum Anpfiff nachgeführt. */
function readFixtures(): DashboardFixture[] {
  const latest = new Map<number, { stamp: string; fixture: DashboardFixture }>();
  const files = fs.existsSync(OUTPUT_DIR)
    ? fs.readdirSync(OUTPUT_DIR).filter((file) => file.startsWith("dashboard-") && file.endsWith(".json"))
    : [];
  for (const file of files) {
    let snapshot: { fixtures?: DashboardFixture[] };
    try {
      snapshot = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), "utf8"));
    } catch {
      continue; // Ein abgebrochener Lauf hinterlässt gelegentlich eine halbe Datei.
    }
    const stamp = file.slice("dashboard-".length, -".json".length);
    for (const fixture of snapshot.fixtures ?? []) {
      const previous = latest.get(fixture.fixtureId);
      if (previous && previous.stamp >= stamp) continue;
      latest.set(fixture.fixtureId, { stamp, fixture });
    }
  }
  return [...latest.values()].map((entry) => entry.fixture);
}

interface BetResult {
  bets: Bet[]; ohnePreis: number; seiteRichtig: number; seiteGesamt: number;
  /** Partien ohne überlieferten Pausenstand. Sie zählen nicht als Niederlage, sondern gar nicht. */
  unentscheidbar: number;
}

function betsFor(
  preset: AnyQuickpickPreset,
  level: QuickpickLevelId,
  fixtures: DashboardFixture[],
  outcomes: Map<number, SettledOutcome>,
  prices: Map<number, Triple>
): BetResult {
  const settings = applyLevel(preset.defaults as QuickpickSettings, level);
  const result: BetResult = { bets: [], ohnePreis: 0, seiteRichtig: 0, seiteGesamt: 0, unentscheidbar: 0 };

  for (const fixture of fixtures) {
    const outcome = outcomes.get(fixture.fixtureId);
    if (!outcome) continue;
    const evaluation = evaluateFixture(fixture, settings);
    if (!evaluation.passes) continue;
    // Eine Voreinstellung ohne Seite setzt auf eine Torlinie. Bei 1X2 bleibt die Abrechnung
    // unverändert über den Sieger - die gemessenen Zahlen auf den Knöpfen der beiden älteren
    // Voreinstellungen dürfen sich durch diese Erweiterung nicht verschieben.
    const einXZwei = evaluation.market === "1x2";
    if (einXZwei && evaluation.side === null) continue;
    const winner = outcome.home > outcome.away ? "1" : outcome.home < outcome.away ? "2" : "X";
    const treffer = einXZwei
      ? winner === evaluation.side
      : decideMarket(evaluation.market, evaluation.selection, {
          homeGoals: outcome.home, awayGoals: outcome.away,
          halftimeHomeGoals: outcome.halfHome, halftimeAwayGoals: outcome.halfAway
        });
    // `null` heißt "nicht entscheidbar" - bei einem Halbzeitmarkt ohne überlieferten
    // Pausenstand. Solche Partien fallen heraus, statt die Trefferquote zu drücken.
    if (treffer === null) { result.unentscheidbar += 1; continue; }
    const triple = prices.get(fixture.fixtureId);

    // Datenqualität: Deckt sich der Preis aus dem Snapshot mit dem archivierten Tripel? Wo
    // die Regel die Gegenseite stützt, stand im Snapshot vor schemaVersion 5 nur eine
    // Schätzung - abgerechnet wird deshalb immer zum echten archivierten Preis.
    // Das archivierte Tripel kennt nur 1X2. Für eine Torlinie gibt es keinen Ersatzpreis -
    // dort gilt ausschließlich der Preis aus dem Lauf.
    const echterPreis = !einXZwei ? null
      : triple ? (evaluation.side === "1" ? triple.home : triple.away) : null;
    if (echterPreis !== null && evaluation.odds !== null) {
      result.seiteGesamt += 1;
      if (Math.abs(echterPreis - evaluation.odds) / echterPreis <= 0.05) result.seiteRichtig += 1;
    }

    // Abgerechnet wird zu dem Preis, den die App gezeigt hätte: dem aus dem Snapshot. Nur wo
    // der Lauf für die gestützte Seite keinen führt und die Regel ihn schätzen musste, tritt
    // der archivierte Preis an seine Stelle - eine Schätzung taugt nicht als Abrechnungskurs.
    const geschaetzt = evaluation.dominanz?.oddsSource === "geschätzt";
    const odds = geschaetzt ? echterPreis : (evaluation.odds ?? echterPreis);
    if (odds === null) { result.ohnePreis += 1; continue; }

    result.bets.push({ kickoff: fixture.kickoff, odds, hit: treffer });
  }
  result.bets.sort((left, right) => left.kickoff.localeCompare(right.kickoff));
  return result;
}

interface Metrics {
  n: number; hitRate: number; standardError: number; roi: number; roiError: number;
  averageOdds: number; firstHalf: number | null; secondHalf: number | null;
  firstRoi: number | null; secondRoi: number | null;
}

function roiOf(bets: Bet[]): number {
  return (bets.reduce((sum, bet) => sum + (bet.hit ? bet.odds : 0), 0) - bets.length) / bets.length;
}

function metricsOf(bets: Bet[]): Metrics | null {
  if (bets.length === 0) return null;
  const n = bets.length;
  const hitRate = bets.filter((bet) => bet.hit).length / n;
  const roi = roiOf(bets);
  const middle = Math.floor(n / 2);
  const rateOf = (part: Bet[]) => part.length === 0 ? null : part.filter((bet) => bet.hit).length / part.length;
  const halfRoi = (part: Bet[]) => part.length === 0 ? null : roiOf(part);
  return {
    n,
    hitRate,
    standardError: Math.sqrt(hitRate * (1 - hitRate) / n),
    roi,
    roiError: Math.sqrt(bets.reduce((sum, bet) => sum + ((bet.hit ? bet.odds - 1 : -1) - roi) ** 2, 0) / (n * n)),
    averageOdds: bets.reduce((sum, bet) => sum + bet.odds, 0) / n,
    firstHalf: rateOf(bets.slice(0, middle)),
    secondHalf: rateOf(bets.slice(middle)),
    firstRoi: halfRoi(bets.slice(0, middle)),
    secondRoi: halfRoi(bets.slice(middle))
  };
}

/**
 * Setzt den Zufall auf einen Startwert zurück, der nur von Voreinstellung und Stufe abhängt.
 *
 * Nötig, weil `seed` über den ganzen Lauf fortgeschrieben wird: Ohne diesen Schnitt zöge
 * `npm run quickpick-report -- --preset hz15` andere Kombis als ein Lauf über alle drei
 * Voreinstellungen, weil vorher unterschiedlich viele Zahlen verbraucht wurden. Genau das
 * soll der feste Startwert verhindern - die gemessenen Kombizahlen im Code müssen zu beiden
 * Aufrufen passen.
 */
function resetSeed(presetId: string, levelId: string): void {
  let hash = 20260916;
  for (const char of `${presetId}:${levelId}`) hash = (hash * 31 + char.charCodeAt(0)) % 2147483648;
  seed = hash;
}

/**
 * Fester Zufall, damit zwei Läufe dieselben Kombis ziehen und eine gemeldete Abweichung
 * wirklich von den Daten kommt.
 */
let seed = 20260916;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

/**
 * Was kurze Kombis aus dieser Auswahl gebracht hätten: Je Spieltag werden die Treffer gemischt
 * und in Blöcke der gewünschten Größe geschnitten - Wetten desselben Tages, wie man sie auch
 * wirklich zusammenstellen würde. Über mehrere Runden, weil ein einzelner Schnitt zu sehr vom
 * Zufall der Reihenfolge abhinge.
 */
function comboMetrics(
  bets: Bet[],
  beine: number,
  fensterTage: number,
  runden = 40
): QuickpickComboMeasurement | null {
  // Ein Fenster entspricht dem Zeitraum, den ein Lauf abdeckt - nicht einem Kalendertag. Bei
  // wenigen Treffern am Tag käme sonst nie eine Fünfer- oder Siebenerkombi zustande, und
  // genau danach wird gefragt. Die Fenster überlappen nicht, damit dieselbe Wette nicht in
  // einer Runde mehrfach zählt.
  const byWindow = new Map<number, Bet[]>();
  const ersterTag = bets.length === 0 ? 0 : Date.parse(bets[0]!.kickoff.slice(0, 10));
  for (const bet of bets) {
    const tag = Date.parse(bet.kickoff.slice(0, 10));
    const fenster = Math.floor((tag - ersterTag) / 86_400_000 / fensterTage);
    byWindow.set(fenster, [...(byWindow.get(fenster) ?? []), bet]);
  }
  let n = 0, hits = 0, returned = 0, oddsSum = 0;
  for (let runde = 0; runde < runden; runde += 1) {
    for (const day of byWindow.values()) {
      if (day.length < beine) continue;
      const pool = shuffle(day);
      for (let start = 0; start + beine <= pool.length; start += beine) {
        const combo = pool.slice(start, start + beine);
        const odds = combo.reduce((product, bet) => product * bet.odds, 1);
        n += 1;
        oddsSum += odds;
        if (combo.every((bet) => bet.hit)) { hits += 1; returned += odds; }
      }
    }
  }
  if (n < 20) return null;
  const legRoi = roiOf(bets);
  return {
    beine, n,
    trefferquote: hits / n,
    quote: oddsSum / n,
    roi: (returned - n) / n,
    erwartung: (1 + legRoi) ** beine - 1
  };
}

/** Tage, über die sich die Tipps verteilen - für "Tipps je Tag". */
function spanInDays(bets: Bet[]): number {
  if (bets.length < 2) return 1;
  return Math.max(1, (Date.parse(bets.at(-1)!.kickoff) - Date.parse(bets[0]!.kickoff)) / 86_400_000);
}

const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits).replace(".", ",")} %`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${percent(value)}`;

function readState(): CalibrationState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as CalibrationState;
    // Altbestand ohne Voreinstellungs-Ebene: Er beschreibt "daves1x2" und wandert dorthin.
    if (!parsed.presets && parsed.stufen) {
      return {
        stand: parsed.stand, abgerechnet: parsed.abgerechnet,
        presets: { daves1x2: { stand: parsed.stand, abgerechnet: parsed.abgerechnet, stufen: parsed.stufen } }
      };
    }
    return { ...parsed, presets: parsed.presets ?? {} };
  } catch {
    return null;
  }
}

function main(): void {
  const write = process.argv.includes("--write");
  // Wie lang der analysierte Zeitraum ist, aus dem eine Kombi gebaut wird. Zwei Tage sind der
  // Umfang eines typischen next48- oder tomorrow2-Laufs.
  const fensterArg = process.argv.indexOf("--kombi-tage");
  const fensterTage = fensterArg >= 0 ? Math.max(1, Number(process.argv[fensterArg + 1]) || 2) : 2;
  const wanted = process.argv.indexOf("--preset");
  const only = wanted >= 0 ? process.argv[wanted + 1] as QuickpickPresetId | undefined : undefined;
  if (only !== undefined && !(only in QUICKPICK_PRESETS)) {
    throw new Error(`Unbekannte Voreinstellung "${only}". Möglich: ${Object.keys(QUICKPICK_PRESETS).join(", ")}`);
  }
  const presets = only ? [QUICKPICK_PRESETS[only]] : QUICKPICK_PRESET_LIST;

  const outcomes = readOutcomes();
  const prices = readTipicoOdds();
  const fixtures = readFixtures();
  if (fixtures.length === 0) throw new Error("Im Ordner output/ liegt kein Dashboard-Snapshot.");

  const settled = fixtures.filter((fixture) => outcomes.has(fixture.fixtureId)).length;
  console.log(`Abgerechnete Partien im Snapshot-Bestand: ${settled} (von ${fixtures.length} insgesamt)`);
  console.log(`Vollständige Tipico-Quotentripel: ${prices.size}`);

  const state = readState();
  const abweichungen: string[] = [];
  // Nur bekannte Voreinstellungen werden übernommen: Eine abgeschaffte - wie die frühere
  // „underdog" - verschwindet damit beim nächsten --write von selbst aus dem Kalibrierstand,
  // statt dort für immer eine Regel zu beschreiben, die es nicht mehr gibt.
  const recorded: Record<string, PresetStand> = {};
  for (const id of Object.keys(QUICKPICK_PRESETS) as QuickpickPresetId[]) {
    const vorher = state?.presets?.[id];
    if (vorher) recorded[id] = vorher;
  }

  for (const preset of presets) {
    const vorher = state?.presets?.[preset.id];
    console.log(`\n=== ${preset.label} · Maßstab ${preset.massstab === "roi" ? "Ertrag je Wette" : "Trefferquote je Bein"} ===`);
    if (vorher) {
      const seit = settled - vorher.abgerechnet;
      console.log(`Letzte Kalibrierung ${vorher.stand} bei ${vorher.abgerechnet} abgerechneten Partien`
        + ` · seither ${seit} neue - Nachkalibrierung ${seit >= RECALIBRATION_STEP ? "FÄLLIG" : `fällig ab ${RECALIBRATION_STEP}`}`);
    } else {
      console.log("Noch keine Kalibrierung festgehalten - dieser Lauf kann die erste sein (--write).");
    }

    console.log(`  ${"Stufe".padEnd(13)}${"n".padStart(6)}${"/Tag".padStart(7)}${"Treffer".padStart(10)}`
      + `${"Quote".padStart(8)}${"ROI".padStart(10)}${"±".padStart(9)}${"1.H".padStart(9)}${"2.H".padStart(9)}   im Code`);

    const stufen: Record<string, StufenStand> = {};
    let qualitaet = { richtig: 0, gesamt: 0, ohnePreis: 0, unentscheidbar: 0 };

    for (const level of preset.levels) {
      const { bets, ohnePreis, seiteRichtig, seiteGesamt, unentscheidbar } =
        betsFor(preset, level.id, fixtures, outcomes, prices);
      qualitaet = {
        richtig: qualitaet.richtig + seiteRichtig,
        gesamt: qualitaet.gesamt + seiteGesamt,
        ohnePreis: qualitaet.ohnePreis + ohnePreis,
        unentscheidbar: qualitaet.unentscheidbar + unentscheidbar
      };
      const metrics = metricsOf(bets);
      if (metrics === null) {
        console.log(`  ${level.label.padEnd(13)}${"-".padStart(6)}   keine Wetten im Bestand`);
        continue;
      }
      const perDay = metrics.n / spanInDays(bets);
      resetSeed(preset.id, level.id);
      const kombis = [2, 3, 4, 5, 6, 7]
        .map((beine) => comboMetrics(bets, beine, fensterTage))
        .filter((entry): entry is QuickpickComboMeasurement => entry !== null);
      stufen[level.id] = {
        kombis,
        n: metrics.n,
        proTag: Math.round(perDay * 10) / 10,
        trefferquote: Math.round(metrics.hitRate * 1000) / 1000,
        roi: Math.round(metrics.roi * 1000) / 1000
      };

      // Bei einer Kombi zählt die Trefferquote je Bein, bei einer Einzelwette der Ertrag -
      // deshalb steht in den beiden Halbzeitspalten je nach Maßstab etwas anderes.
      const halb = preset.massstab === "roi"
        ? [metrics.firstRoi === null ? "-" : signed(metrics.firstRoi), metrics.secondRoi === null ? "-" : signed(metrics.secondRoi)]
        : [metrics.firstHalf === null ? "-" : percent(metrics.firstHalf), metrics.secondHalf === null ? "-" : percent(metrics.secondHalf)];

      console.log(`  ${level.label.padEnd(13)}${String(metrics.n).padStart(6)}${perDay.toFixed(1).padStart(7)}`
        + `${percent(metrics.hitRate).padStart(10)}${metrics.averageOdds.toFixed(2).padStart(8)}`
        + `${signed(metrics.roi).padStart(10)}${percent(preset.massstab === "roi" ? metrics.roiError : metrics.standardError).padStart(9)}`
        + `${halb[0]!.padStart(9)}${halb[1]!.padStart(9)}   ${preset.noteOf(level.measured)}`);

      // Die Knöpfe in der App tragen diese Zahlen. Laufen sie auseinander, wirbt die
      // Oberfläche mit einem Stand, den die Daten nicht mehr hergeben.
      if (level.measured !== null) {
        const toleranz = preset.massstab === "roi" ? 0.05 : 0.03;
        const gemessen = preset.massstab === "roi" ? metrics.roi : metrics.hitRate;
        const imCode = preset.massstab === "roi" ? level.measured.roi : level.measured.trefferquote;
        if (Math.abs(gemessen - imCode) > toleranz) {
          abweichungen.push(`${preset.label} / ${level.label}: ${percent(gemessen)} gegen ${percent(imCode)} im Code`);
        }
        if (Math.abs(perDay - level.measured.proTag) > 1) {
          abweichungen.push(`${preset.label} / ${level.label}: ${perDay.toFixed(1)} Tipps/Tag gegen ${level.measured.proTag} im Code`);
        }
      }
    }

    // Kurze Kombis aus den Treffern derselben Stufe. Die Spalte "erwartet" ist das, was der
    // Ertrag je Bein verspricht - läuft sie weit von "Ertrag" weg, ist die Stichprobe zu klein.
    const beste = stufen.ausgewogen?.kombis ?? Object.values(stufen)[0]?.kombis;
    if (beste && beste.length > 0) {
      console.log(`  Kurze Kombis aus der Stufe „Ausgewogen“, gezogen über ${fensterTage} Spieltage:`);
      console.log(`    ${"Beine".padEnd(7)}${"Kombis".padStart(8)}${"Treffer".padStart(10)}${"Quote Ø".padStart(10)}${"Ertrag".padStart(10)}${"erwartet".padStart(11)}`);
      for (const kombi of beste) {
        console.log(`    ${String(kombi.beine).padEnd(7)}${String(kombi.n).padStart(8)}`
          + `${percent(kombi.trefferquote).padStart(10)}${kombi.quote.toFixed(1).padStart(10)}`
          + `${signed(kombi.roi).padStart(10)}${signed(kombi.erwartung).padStart(11)}`);
      }
    }

    if (qualitaet.unentscheidbar > 0) {
      console.log(`  ${qualitaet.unentscheidbar} Zeilen ohne überlieferten Pausenstand - sie`
        + " fallen heraus und zählen nicht als Niederlage.");
    }
    if (qualitaet.gesamt > 0 && qualitaet.richtig < qualitaet.gesamt) {
      console.log(`  Datenqualität: Der Preis aus dem Snapshot deckte sich in`
        + ` ${percent(qualitaet.richtig / qualitaet.gesamt)} der Fälle mit dem archivierten`
        + ` Tripel (5 % Toleranz); ${qualitaet.ohnePreis} Zeilen ohne archivierten Preis.`);
      console.log("  Abgerechnet wird zum letzten Tipico-Preis vor Anpfiff - nicht zwingend der,"
        + " den die App im Moment des Snapshots zeigte.");
    }

    recorded[preset.id] = { stand: new Date().toISOString().slice(0, 10), abgerechnet: settled, stufen };
  }

  if (abweichungen.length > 0) {
    console.log("\nABWEICHUNG von den Zahlen im Code:");
    for (const zeile of abweichungen) console.log(`  - ${zeile}`);
    console.log("  Die Messwerte in QUICKPICK_LEVELS bzw. DOMINANZ_LEVELS gehören auf diesen Stand gebracht.");
  } else {
    console.log("\nDie Zahlen im Code decken sich mit der Messung.");
  }

  if (write) {
    const next: CalibrationState = {
      stand: new Date().toISOString().slice(0, 10),
      abgerechnet: settled,
      presets: recorded
    };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    console.log(`\nKalibrierung festgehalten in ${path.relative(ROOT_DIR, STATE_FILE)}.`);
  } else {
    console.log("\nMit --write wird dieser Stand als Kalibrierpunkt festgehalten.");
  }
}

main();
