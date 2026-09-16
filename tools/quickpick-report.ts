/**
 * Rechnet die Strengestufen des Quickpickers gegen die eigenen Ergebnisse zurück und meldet,
 * wenn die im Code hinterlegten Zahlen nicht mehr stimmen.
 *
 * Grundlage sind dieselben zwei Bestände wie beim Edge-Report: die archivierten Snapshots in
 * `output/` und die abgerechneten Ergebnisse in SQLite. Je Partie zählt der jüngste Snapshot -
 * dieselbe Regel wie in `collectSnapshots`. Ausgewertet wird `evaluateFixture` aus
 * `src/quickpick.ts`, also genau die Fassung, die auch die App benutzt; eine zweite Fassung
 * hier würde die Rückrechnung wertlos machen.
 *
 * Maßstab ist die **Trefferquote je Bein**, nicht der ROI einer Einzelwette: Der Quickpicker
 * ist für Kombis gedacht, und eine Kombi multipliziert die Quote je Bein.
 *
 * Aufruf:
 *   npm run quickpick-report            Auswertung anzeigen
 *   npm run quickpick-report -- --write Stand als neue Kalibrierung festhalten
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_FILE, ROOT_DIR } from "../src/config.ts";
import type { DashboardFixture } from "../src/dashboard.ts";
import {
  DEFAULT_QUICKPICK_SETTINGS,
  QUICKPICK_LEVELS,
  applyLevel,
  evaluateFixture,
  type QuickpickLevelId
} from "../src/quickpick.ts";

const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const STATE_FILE = path.join(ROOT_DIR, "docs", "quickpick-kalibrierung.json");

/**
 * Abstand zwischen zwei Kalibrierungen, in neu abgerechneten Partien. 2.000 ist kein
 * Erfahrungswert, sondern eine Rechnung: Bei rund 4,5 Tipps am Tag und etwa 150 abgerechneten
 * Partien am Tag entspricht das ungefähr zwei Wochen und rund 60 neuen Tipps - genug, damit
 * sich die Trefferquote einer Stufe messbar bewegen kann, ohne dass jede Woche eine neue Zahl
 * im Code steht.
 */
const RECALIBRATION_STEP = 2_000;

interface CalibrationState {
  /** Wann zuletzt kalibriert wurde. */
  stand: string;
  /** Abgerechnete Partien zu diesem Zeitpunkt - der Zähler, an dem die Fälligkeit hängt. */
  abgerechnet: number;
  stufen: Record<string, { n: number; proTag: number; trefferquote: number; roi: number }>;
}

interface Bet {
  kickoff: string;
  odds: number;
  hit: boolean;
}

function readOutcomes(): Map<number, { home: number; away: number }> {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error("Es gibt noch keine Datenbank mit abgerechneten Ergebnissen.");
  }
  const database = new DatabaseSync(DB_FILE, { readOnly: true });
  const outcomes = new Map<number, { home: number; away: number }>();
  const rows = database.prepare(`
    SELECT fixture_id, actual_home_goals, actual_away_goals
    FROM goal_line_predictions
    WHERE settled_at IS NOT NULL AND actual_home_goals IS NOT NULL AND actual_away_goals IS NOT NULL
  `).all() as Array<Record<string, number>>;
  for (const row of rows) {
    outcomes.set(row.fixture_id, { home: row.actual_home_goals, away: row.actual_away_goals });
  }
  database.close();
  return outcomes;
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

function betsFor(
  level: QuickpickLevelId,
  fixtures: DashboardFixture[],
  outcomes: Map<number, { home: number; away: number }>
): Bet[] {
  const settings = applyLevel(DEFAULT_QUICKPICK_SETTINGS, level);
  const bets: Bet[] = [];
  for (const fixture of fixtures) {
    const outcome = outcomes.get(fixture.fixtureId);
    if (!outcome) continue;
    const evaluation = evaluateFixture(fixture, settings);
    if (!evaluation.passes || evaluation.side === null || evaluation.odds === null) continue;
    const winner = outcome.home > outcome.away ? "1" : outcome.home < outcome.away ? "2" : "X";
    bets.push({ kickoff: fixture.kickoff, odds: evaluation.odds, hit: winner === evaluation.side });
  }
  return bets.sort((left, right) => left.kickoff.localeCompare(right.kickoff));
}

interface Metrics {
  n: number;
  hitRate: number;
  standardError: number;
  roi: number;
  averageOdds: number;
  firstHalf: number | null;
  secondHalf: number | null;
}

function metricsOf(bets: Bet[]): Metrics | null {
  if (bets.length === 0) return null;
  const n = bets.length;
  const hits = bets.filter((bet) => bet.hit).length;
  const hitRate = hits / n;
  const returned = bets.reduce((sum, bet) => sum + (bet.hit ? bet.odds : 0), 0);
  const middle = Math.floor(n / 2);
  const rateOf = (part: Bet[]) => part.length === 0 ? null : part.filter((bet) => bet.hit).length / part.length;
  return {
    n,
    hitRate,
    standardError: Math.sqrt(hitRate * (1 - hitRate) / n),
    roi: (returned - n) / n,
    averageOdds: bets.reduce((sum, bet) => sum + bet.odds, 0) / n,
    firstHalf: rateOf(bets.slice(0, middle)),
    secondHalf: rateOf(bets.slice(middle))
  };
}

/** Tage, über die sich die Tipps verteilen - für "Tipps je Tag". */
function spanInDays(bets: Bet[]): number {
  if (bets.length < 2) return 1;
  const first = Date.parse(bets[0]!.kickoff);
  const last = Date.parse(bets.at(-1)!.kickoff);
  return Math.max(1, (last - first) / 86_400_000);
}

const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits).replace(".", ",")} %`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${percent(value)}`;

function readState(): CalibrationState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as CalibrationState;
  } catch {
    return null;
  }
}

function main(): void {
  const write = process.argv.includes("--write");
  const outcomes = readOutcomes();
  const fixtures = readFixtures();
  if (fixtures.length === 0) {
    throw new Error("Im Ordner output/ liegt kein Dashboard-Snapshot.");
  }

  const settled = fixtures.filter((fixture) => outcomes.has(fixture.fixtureId)).length;
  console.log(`Abgerechnete Partien im Snapshot-Bestand: ${settled} (von ${fixtures.length} insgesamt)`);

  const state = readState();
  if (state === null) {
    console.log("Noch keine Kalibrierung festgehalten - dieser Lauf kann die erste sein (--write).");
  } else {
    const seit = settled - state.abgerechnet;
    const faellig = seit >= RECALIBRATION_STEP;
    console.log(`Letzte Kalibrierung: ${state.stand} bei ${state.abgerechnet} abgerechneten Partien`);
    console.log(`Seither ${seit} neue - Nachkalibrierung ${faellig ? "FÄLLIG" : `fällig ab ${RECALIBRATION_STEP}`}`);
  }

  console.log("\nStufen, zurückgerechnet auf die eigenen Ergebnisse");
  console.log(`  ${"Stufe".padEnd(13)}${"n".padStart(6)}${"/Tag".padStart(7)}${"Treffer".padStart(10)}`
    + `${"±".padStart(9)}${"1.H".padStart(8)}${"2.H".padStart(8)}${"4er".padStart(8)}${"6er".padStart(8)}`
    + `${"Quote".padStart(7)}${"ROI".padStart(9)}   im Code`);

  const recorded: CalibrationState["stufen"] = {};
  const abweichungen: string[] = [];

  for (const level of QUICKPICK_LEVELS) {
    const bets = betsFor(level.id, fixtures, outcomes);
    const metrics = metricsOf(bets);
    if (metrics === null) {
      console.log(`  ${level.label.padEnd(13)}${"-".padStart(6)}   keine Tipps im Bestand`);
      continue;
    }
    const perDay = metrics.n / spanInDays(bets);
    recorded[level.id] = {
      n: metrics.n,
      proTag: Math.round(perDay * 10) / 10,
      trefferquote: Math.round(metrics.hitRate * 1000) / 1000,
      roi: Math.round(metrics.roi * 1000) / 1000
    };

    console.log(`  ${level.label.padEnd(13)}${String(metrics.n).padStart(6)}${perDay.toFixed(1).padStart(7)}`
      + `${percent(metrics.hitRate).padStart(10)}${percent(metrics.standardError).padStart(9)}`
      + `${(metrics.firstHalf === null ? "-" : percent(metrics.firstHalf)).padStart(8)}`
      + `${(metrics.secondHalf === null ? "-" : percent(metrics.secondHalf)).padStart(8)}`
      + `${percent(metrics.hitRate ** 4).padStart(8)}${percent(metrics.hitRate ** 6).padStart(8)}`
      + `${metrics.averageOdds.toFixed(2).padStart(7)}${signed(metrics.roi).padStart(9)}`
      + `   ${level.note}`);

    // Der Knopf in der App trägt diese Zahlen. Laufen sie auseinander, wirbt die Oberfläche
    // mit einem Stand, den die Daten nicht mehr hergeben.
    const [proTagText, quoteText] = level.note.split(" · ");
    const proTagCode = Number(proTagText!.replace("/Tag", "").replace(",", "."));
    const quoteCode = Number(quoteText!.replace(" %", "").replace(",", ".")) / 100;
    if (Math.abs(metrics.hitRate - quoteCode) > 0.03) {
      abweichungen.push(`${level.label}: Trefferquote ${percent(metrics.hitRate)} gegen ${percent(quoteCode)} im Code`);
    }
    if (Math.abs(perDay - proTagCode) > 1) {
      abweichungen.push(`${level.label}: ${perDay.toFixed(1)} Tipps/Tag gegen ${proTagCode} im Code`);
    }
  }

  console.log("\nDie Trefferquote je Bein multipliziert sich in einer Kombi - deshalb stehen 4er"
    + " und 6er daneben.\nEin ROI unter null heißt: Auf Dauer kostet jedes Bein Geld, und eine"
    + " lange Kombi verstärkt das.");

  if (abweichungen.length > 0) {
    console.log("\nABWEICHUNG von den Zahlen in src/quickpick.ts:");
    for (const zeile of abweichungen) console.log(`  - ${zeile}`);
    console.log("  Die Knopfbeschriftungen in QUICKPICK_LEVELS gehören auf diesen Stand gebracht.");
  } else {
    console.log("\nDie Zahlen in src/quickpick.ts decken sich mit der Messung.");
  }

  if (write) {
    const next: CalibrationState = {
      stand: new Date().toISOString().slice(0, 10),
      abgerechnet: settled,
      stufen: recorded
    };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    console.log(`\nKalibrierung festgehalten in ${path.relative(ROOT_DIR, STATE_FILE)}.`);
  } else {
    console.log("\nMit --write wird dieser Stand als Kalibrierpunkt festgehalten.");
  }
}

main();
