/**
 * Messung des Live-Modells (`src/live-model.ts`) an alten Spielen. Kostet kein API-Budget.
 *
 * Grundlage: je Spiel die letzte Prognose vor dem Anstoß aus `goal_line_predictions` (λ je
 * Team) und das Ergebnis aus `fixture_results` (FT, `goals_complete`, Torminuten und Rote
 * Karten). An den Prüfpunkten t = 15 … 88 wird der Stand bis t nachgestellt und
 * **dieselbe** `liveChances` aufgerufen, die auch die App rechnet. Vergleich ist eine
 * gleichmäßige Uhr (λ · (90 − t) / 90, ohne Rot) durch dieselbe Poisson-Rechnung.
 *
 * Aufruf:
 *   npm run live-model-report                          Messung über alle Spiele
 *   npm run live-model-report -- --since 2026-09-30    Nachmessung ab Stichtag mit Urteil
 *   npm run live-model-report -- --min-model 3.4.0     nur Prognosen ab dieser Modellversion
 *   npm run live-model-report -- --derive              Konstanten aus den Daten ableiten
 *
 * **Vorab festgelegte Kriterien der Nachmessung** (Prüfer-Agent, 29.09.2026). Sie gelten für
 * Spiele mit Anstoß nach dem Stichtag; Ziel sind rund 1.500 Spiele des laufenden Modells.
 *   1. Brier „noch ein Tor" und Log-Loss der Resttore besser als die gleichmäßige Uhr, mit
 *      mindestens 2 Standardfehlern (gepaart je Spiel).
 *   2. In jedem 10-PP-Band mit mindestens 300 Prüfpunkten liegt die Vorhersage höchstens
 *      4 Punkte neben dem Eingetretenen - für „noch ein Tor", „nächstes Tor" und „1X2 nach 90".
 *   3. Beobachtete durch erwartete Resttore bei t = 45 und t = 75 liegt in [0,93; 1,07].
 *   4. Spiele zwischen verschiedenen Ligen und Länderspiele nur, wenn ihre Gruppe mindestens
 *      200 Spiele hat; sonst dort verbergen.
 * Die Prüfpunkte eines Spiels sind korreliert; die Standardfehler der gepaarten Vergleiche
 * sind deshalb je Spiel gerechnet, die Bandtabellen zählen Prüfpunkte.
 *
 * `--derive` schätzt die Minutentabelle und die Rot-Faktoren gemeinsam (iteratives Anpassen
 * beobachteter an erwartete Tore je Zelle) und die Nachspielzeit-Reste aus den Toren seit dem
 * 15.09.2026. Die Ausgabe wird von Hand nach `src/live-model.ts` übernommen - bewusst nicht
 * automatisch, damit eine Konstantenänderung als Diff sichtbar bleibt und
 * `LIVE_MODEL_VERSION` steigt.
 */
import { DatabaseSync } from "node:sqlite";
import { DB_FILE } from "../src/config.ts";
import {
  binOfMinute,
  chancesFromMeans,
  liveChances,
  LIVE_MODEL_VERSION,
  poissonCdf,
  type LiveChances
} from "../src/live-model.ts";

const args = process.argv.slice(2);
const option = (name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
};
const derive = args.includes("--derive");
const since = option("--since");
const until = option("--until");
const minModel = option("--min-model");

/** API-Football setzt `extra` erst seit etwa diesem Tag verlässlich (Prüfung vom 29.09.2026). */
const STOPPAGE_SINCE = "2026-09-15";
const CHECKPOINTS = [15, 30, 45, 60, 70, 75, 80, 85, 88];
const BINS = 20;

interface Side { minute: number; side: 0 | 1 }
interface Match {
  id: number;
  kickoff: string;
  lambdaHome: number;
  lambdaAway: number;
  modelVersion: string;
  warnings: string;
  goals: Side[];
  reds: Side[];
}

function compareVersion(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Minute im Sinne der Tabelle: 45+x zählt zur 45, 90+x zur 90. */
function slotOf(minute: number | null): number | null {
  if (minute === null || !Number.isFinite(minute)) return null;
  return Math.min(90, Math.max(1, minute));
}

const db = new DatabaseSync(DB_FILE, { readOnly: true });

function loadMatches(): Match[] {
  const predictions = new Map<number, { eh: number; ea: number; mv: string; w: string | null }>();
  for (const row of db.prepare(`SELECT fixture_id, expected_home_goals eh, expected_away_goals ea,
      model_version mv, warnings_json w FROM goal_line_predictions
      WHERE julianday(snapshot_at) <= julianday(kickoff) ORDER BY snapshot_at`).all() as Array<Record<string, unknown>>) {
    predictions.set(Number(row.fixture_id), {
      eh: Number(row.eh), ea: Number(row.ea), mv: String(row.mv), w: (row.w as string | null) ?? null
    });
  }
  const matches: Match[] = [];
  for (const row of db.prepare(`SELECT fixture_id, kickoff, home_team_id hid, away_team_id aid,
      goal_events_json g, card_events_json c FROM fixture_results
      WHERE status = 'FT' AND goals_complete = 1 ORDER BY kickoff`).all() as Array<Record<string, unknown>>) {
    const prediction = predictions.get(Number(row.fixture_id));
    if (!prediction) continue;
    const kickoff = String(row.kickoff);
    if (since && kickoff < since) continue;
    if (until && kickoff >= until) continue;
    if (minModel && compareVersion(prediction.mv, minModel) < 0) continue;
    const homeId = Number(row.hid);
    const awayId = Number(row.aid);
    const sideOf = (teamId: number): 0 | 1 | null => teamId === homeId ? 0 : teamId === awayId ? 1 : null;
    const goals: Side[] = [];
    let complete = true;
    for (const goal of JSON.parse(String(row.g ?? "[]")) as Array<{ teamId: number; minute: number | null }>) {
      const slot = slotOf(goal.minute);
      const side = sideOf(goal.teamId);
      if (slot === null || side === null) { complete = false; break; }
      goals.push({ minute: slot, side });
    }
    if (!complete) continue;
    const reds: Side[] = [];
    for (const card of JSON.parse(String(row.c ?? "[]")) as Array<{ teamId: number; minute: number | null; card: string }>) {
      if (card.card === "yellow") continue;
      const slot = slotOf(card.minute);
      const side = sideOf(card.teamId);
      if (slot !== null && side !== null) reds.push({ minute: slot, side });
    }
    matches.push({
      id: Number(row.fixture_id), kickoff, lambdaHome: prediction.eh, lambdaAway: prediction.ea,
      modelVersion: prediction.mv, warnings: prediction.w ?? "", goals, reds
    });
  }
  return matches;
}

const fmt = (value: number, digits = 3) => value.toFixed(digits).replace(".", ",");
const signed = (value: number, digits = 4) => `${value >= 0 ? "+" : "−"}${fmt(Math.abs(value), digits)}`;
const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;

// ---------------------------------------------------------------------------------------------
// --derive
// ---------------------------------------------------------------------------------------------

function deriveConstants(matches: Match[]): void {
  interface Cell { bin: number; own: 0 | 1; opponent: 0 | 1; lambda: number; goals: number }
  const cells: Cell[] = [];
  for (const match of matches) {
    const goalsBy = new Map<number, [number, number]>();
    for (const goal of match.goals) {
      const entry = goalsBy.get(goal.minute) ?? [0, 0];
      entry[goal.side] += 1;
      goalsBy.set(goal.minute, entry);
    }
    let redHome = 0;
    let redAway = 0;
    for (let minute = 1; minute <= 90; minute += 1) {
      const scored = goalsBy.get(minute) ?? [0, 0];
      const bin = binOfMinute(minute);
      cells.push({ bin, own: redHome > 0 ? 1 : 0, opponent: redAway > 0 ? 1 : 0, lambda: match.lambdaHome, goals: scored[0] });
      cells.push({ bin, own: redAway > 0 ? 1 : 0, opponent: redHome > 0 ? 1 : 0, lambda: match.lambdaAway, goals: scored[1] });
      // Eine Rote in Minute m wirkt ab m+1 - dieselbe Zeitordnung wie im Live-Stand.
      for (const red of match.reds) if (red.minute === minute) { if (red.side === 0) redHome += 1; else redAway += 1; }
    }
  }
  const rate = new Array<number>(BINS).fill(1 / 90);
  const own = [1, 1];
  const opponent = [1, 1];
  const expected = (cell: Cell) => cell.lambda * rate[cell.bin]! * own[cell.own]! * opponent[cell.opponent]!;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    for (const [key, factors, size] of [["bin", rate, BINS], ["own", own, 2], ["opponent", opponent, 2]] as const) {
      const observed = new Array<number>(size).fill(0);
      const predicted = new Array<number>(size).fill(0);
      for (const cell of cells) {
        observed[cell[key]] += cell.goals;
        predicted[cell[key]] += expected(cell);
      }
      for (let index = 0; index < size; index += 1) if (predicted[index]! > 0) factors[index]! *= observed[index]! / predicted[index]!;
    }
  }
  for (const factors of [own, opponent]) {
    const base = factors[0]!;
    for (let index = 0; index < BINS; index += 1) rate[index]! *= base;
    factors[1]! /= base;
    factors[0] = 1;
  }
  const observedRed = [0, 0];
  for (const cell of cells) { if (cell.own) observedRed[0] += cell.goals; if (cell.opponent) observedRed[1] += cell.goals; }

  console.log(`Konstanten aus ${matches.length} Spielen (Zeit und Rot gemeinsam geschätzt):\n`);
  const values = rate.map((value) => Number((value * 90).toFixed(2)));
  console.log("export const GOAL_RATE_BY_BIN: readonly number[] = [");
  console.log(`  ${values.slice(0, 10).join(", ")},`);
  console.log(`  ${values.slice(10).join(", ")}`);
  console.log("];");
  console.log(`export const RED_CARD_OWN = ${own[1]!.toFixed(3)};        // ± ${(own[1]! / Math.sqrt(observedRed[0]!)).toFixed(3)}, ${observedRed[0]} Tore`);
  console.log(`export const RED_CARD_OPPONENT = ${opponent[1]!.toFixed(3)};   // ± ${(opponent[1]! / Math.sqrt(observedRed[1]!)).toFixed(3)}, ${observedRed[1]} Tore`);

  // Nachspielzeit-Reste aus allen vollständigen Spielen seit STOPPAGE_SINCE, nicht nur den
  // prognostizierten: Die Verteilung der Nachspielminuten hängt nicht an λ.
  const stoppage = { 45: new Map<number, number>(), 90: new Map<number, number>() };
  let fixtures = 0;
  for (const row of db.prepare(`SELECT goal_events_json g FROM fixture_results
      WHERE status = 'FT' AND goals_complete = 1 AND kickoff >= ?`).all(STOPPAGE_SINCE) as Array<Record<string, unknown>>) {
    fixtures += 1;
    for (const goal of JSON.parse(String(row.g ?? "[]")) as Array<{ minute: number | null; extra: number | null }>) {
      if (goal.minute !== 45 && goal.minute !== 90) continue;
      const table = stoppage[goal.minute];
      const extra = goal.extra ?? 0;
      table.set(extra, (table.get(extra) ?? 0) + 1);
    }
  }
  const remaining = (table: Map<number, number>): number[] => {
    const total = [...table.values()].reduce((sum, value) => sum + value, 0);
    const result: number[] = [];
    for (let k = 0; k <= 10; k += 1) {
      let open = 0;
      for (const [extra, count] of table) {
        if (extra > k) open += count;
        else if (extra === k) open += 0.5 * count;
      }
      result.push(Number((open / total).toFixed(2)));
      if (open / total < 0.03) break;
    }
    return result;
  };
  const count = (table: Map<number, number>) => [...table.values()].reduce((sum, value) => sum + value, 0);
  console.log(`\n// Nachspielzeit seit ${STOPPAGE_SINCE}: ${fixtures} Spiele, ${count(stoppage[45])} Tore im Block 45, ${count(stoppage[90])} im Block 90`);
  console.log("export const STOPPAGE_REMAINING = {");
  console.log(`  firstHalf: [${remaining(stoppage[45]).join(", ")}],`);
  console.log(`  secondHalf: [${remaining(stoppage[90]).join(", ")}]`);
  console.log("};");
}

// ---------------------------------------------------------------------------------------------
// Messung
// ---------------------------------------------------------------------------------------------

interface Point {
  match: number;
  t: number;
  model: LiveChances;
  uniform: ReturnType<typeof chancesFromMeans>;
  remaining: number;
  next: "home" | "none" | "away" | "tie";
  final: "home" | "draw" | "away";
}

function stateAt(match: Match, t: number) {
  const done = match.goals.filter((goal) => goal.minute <= t);
  const later = match.goals.filter((goal) => goal.minute > t).sort((a, b) => a.minute - b.minute);
  const goalsHome = done.filter((goal) => goal.side === 0).length;
  const goalsAway = done.length - goalsHome;
  const redHome = match.reds.filter((red) => red.minute <= t && red.side === 0).length;
  const redAway = match.reds.filter((red) => red.minute <= t && red.side === 1).length;
  const first = later[0];
  const next: Point["next"] = !first
    ? "none"
    : later.some((goal) => goal.minute === first.minute && goal.side !== first.side)
      ? "tie"
      : first.side === 0 ? "home" : "away";
  const finalHome = match.goals.filter((goal) => goal.side === 0).length;
  const finalAway = match.goals.length - finalHome;
  const final: Point["final"] = finalHome > finalAway ? "home" : finalHome === finalAway ? "draw" : "away";
  return { goalsHome, goalsAway, redHome, redAway, remaining: later.length, next, final };
}

function evaluate(matches: Match[]): Point[] {
  const points: Point[] = [];
  matches.forEach((match, index) => {
    const sideReliable = !match.warnings.includes("Kein Ligastärke");
    for (const t of CHECKPOINTS) {
      const state = stateAt(match, t);
      const model = liveChances({
        lambdaHome: match.lambdaHome, lambdaAway: match.lambdaAway,
        clock: { phase: "running", minutesPlayed: t },
        goalsHome: state.goalsHome, goalsAway: state.goalsAway,
        redHome: state.redHome, redAway: state.redAway, sideReliable
      });
      const uniform = chancesFromMeans({
        muHome: match.lambdaHome * (90 - t) / 90, muAway: match.lambdaAway * (90 - t) / 90,
        goalsHome: state.goalsHome, goalsAway: state.goalsAway, sideReliable
      });
      points.push({ match: index, t, model, uniform, remaining: state.remaining, next: state.next, final: state.final });
    }
  });
  return points;
}

type Scored = Pick<LiveChances, "remainingGoals" | "anotherGoal" | "nextGoal" | "result">;
const EPS = 1e-12;
const metrics: Record<string, (p: Scored, point: Point) => number> = {
  "Log-Loss Resttore": (p, point) => {
    const mean = p.remainingGoals!;
    const count = Math.min(point.remaining, 5);
    const probability = count < 5 ? poissonCdf(mean, count) - (count > 0 ? poissonCdf(mean, count - 1) : 0) : 1 - poissonCdf(mean, 4);
    return -Math.log(Math.max(EPS, probability));
  },
  "Brier noch ein Tor": (p, point) => (p.anotherGoal! - (point.remaining > 0 ? 1 : 0)) ** 2,
  "Brier noch zwei Tore": (p, point) => ((1 - poissonCdf(p.remainingGoals!, 1)) - (point.remaining > 1 ? 1 : 0)) ** 2,
  "Log-Loss nächstes Tor": (p, point) => {
    if (!p.nextGoal || point.next === "tie") return Number.NaN;
    return -Math.log(Math.max(EPS, p.nextGoal[point.next]));
  },
  "Log-Loss 1X2 nach 90": (p, point) => (p.result ? -Math.log(Math.max(EPS, p.result[point.final])) : Number.NaN)
};

/** Gepaart je Spiel: erst über die Prüfpunkte eines Spiels mitteln, dann Standardfehler über Spiele. */
function paired(points: Point[], metric: (p: Scored, point: Point) => number): { mean: number; se: number; n: number } {
  const bySpiel = new Map<number, { sum: number; count: number }>();
  for (const point of points) {
    const difference = metric(point.model, point) - metric(point.uniform, point);
    if (Number.isNaN(difference)) continue;
    const entry = bySpiel.get(point.match) ?? { sum: 0, count: 0 };
    entry.sum += difference;
    entry.count += 1;
    bySpiel.set(point.match, entry);
  }
  const values = [...bySpiel.values()].map((entry) => entry.sum / entry.count);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  return { mean, se: Math.sqrt(variance / values.length), n: values.length };
}

interface BandRow { label: string; n: number; predicted: number; observed: number }
function bands(pairs: Array<[number, number]>): BandRow[] {
  const rows: BandRow[] = [];
  for (let band = 0; band < 10; band += 1) {
    // Ganze Zehner statt aufaddierter 0,1: Die Summe driftet, und p = 1 gehört ins letzte Band.
    const inside = pairs.filter(([p]) => Math.min(9, Math.floor(p * 10 + 1e-9)) === band);
    if (inside.length === 0) continue;
    rows.push({
      label: `${band * 10}-${band * 10 + 10} %`,
      n: inside.length,
      predicted: inside.reduce((sum, [p]) => sum + p, 0) / inside.length,
      observed: inside.reduce((sum, [, y]) => sum + y, 0) / inside.length
    });
  }
  return rows;
}

const MIN_BAND = 300;
const MAX_BAND_GAP = 0.04;

function printBands(title: string, rows: BandRow[]): boolean {
  console.log(`\n${title}`);
  console.log("  Band        Prüfpunkte  Vorhersage  eingetreten  Abstand");
  let ok = true;
  for (const row of rows) {
    const gap = row.observed - row.predicted;
    const counts = row.n >= MIN_BAND;
    const bad = counts && Math.abs(gap) > MAX_BAND_GAP;
    if (bad) ok = false;
    console.log(`  ${row.label.padEnd(11)} ${String(row.n).padStart(10)}  ${pct(row.predicted).padStart(10)}  ${pct(row.observed).padStart(11)}  ${signed(gap * 100, 1).padStart(6)} PP${bad ? "  ← über 4 PP" : counts ? "" : "  (zu wenige)"}`);
  }
  return ok;
}

function observedOverExpected(points: Point[], t: number): { ratio: number; se: number; n: number } {
  const at = points.filter((point) => point.t === t && point.model.remainingGoals !== null);
  const observed = at.reduce((sum, point) => sum + point.remaining, 0);
  const expected = at.reduce((sum, point) => sum + point.model.remainingGoals!, 0);
  return { ratio: observed / expected, se: Math.sqrt(observed) / expected, n: at.length };
}

function report(matches: Match[]): void {
  const points = evaluate(matches);
  const period = `${matches[0]?.kickoff.slice(0, 10) ?? "–"} bis ${matches.at(-1)?.kickoff.slice(0, 10) ?? "–"}`;
  console.log(`Live-Modell ${LIVE_MODEL_VERSION}: ${matches.length} Spiele (${period}), ${points.length} Prüfpunkte bei t = ${CHECKPOINTS.join(", ")}`);
  if (minModel) console.log(`Nur Prognosen ab Modellversion ${minModel}.`);

  console.log("\nGepaart gegen die gleichmäßige Uhr (negativ = Live-Modell besser, je Spiel gemittelt):");
  const results: Record<string, { mean: number; se: number; n: number }> = {};
  for (const [name, metric] of Object.entries(metrics)) {
    const result = paired(points, metric);
    results[name] = result;
    console.log(`  ${name.padEnd(22)} ${signed(result.mean)} ± ${fmt(result.se, 4)}  (${result.n} Spiele)`);
  }

  const another = printBands("Kalibrierung „noch ein Tor“:",
    bands(points.map((point) => [point.model.anotherGoal!, point.remaining > 0 ? 1 : 0])));
  const next = printBands("Kalibrierung „nächstes Tor“ (Heim, keins, Gast zusammen):",
    bands(points.flatMap((point) => point.model.nextGoal && point.next !== "tie"
      ? (["home", "none", "away"] as const).map((key): [number, number] => [point.model.nextGoal![key], point.next === key ? 1 : 0])
      : [])));
  const result = printBands("Kalibrierung „1X2 nach 90 Minuten“ (1, X, 2 zusammen):",
    bands(points.flatMap((point) => point.model.result
      ? (["home", "draw", "away"] as const).map((key): [number, number] => [point.model.result![key], point.final === key ? 1 : 0])
      : [])));

  console.log("\nBeobachtete durch erwartete Resttore:");
  let levelOk = true;
  for (const t of [0, 45, 75]) {
    const oe = t === 0 ? null : observedOverExpected(points, t);
    if (!oe) continue;
    const inside = oe.ratio >= 0.93 && oe.ratio <= 1.07;
    if (!inside) levelOk = false;
    console.log(`  t = ${t}: ${fmt(oe.ratio)} ± ${fmt(oe.se)}${inside ? "" : "  ← außerhalb [0,93; 1,07]"}`);
  }

  console.log("\nGruppen:");
  const groups: Record<string, (match: Match) => boolean> = {
    "Ligaspiele": (match) => !match.warnings.includes("Cross-League") && !match.warnings.includes("Team-Elo"),
    "zwischen verschiedenen Ligen": (match) => match.warnings.includes("Cross-League") && !match.warnings.includes("Team-Elo"),
    "Länderspiele (Team-Elo)": (match) => match.warnings.includes("Team-Elo")
  };
  const hidden: string[] = [];
  for (const [name, test] of Object.entries(groups)) {
    const indices = new Set(matches.map((match, index) => test(match) ? index : -1).filter((index) => index >= 0));
    const inGroup = points.filter((point) => indices.has(point.match));
    const oe75 = observedOverExpected(inGroup, 75);
    const brier = inGroup.length ? paired(inGroup, metrics["Brier noch ein Tor"]!) : null;
    if (name !== "Ligaspiele" && indices.size < 200) hidden.push(name);
    console.log(`  ${name.padEnd(30)} ${String(indices.size).padStart(5)} Spiele  O/E t=75 ${Number.isFinite(oe75.ratio) ? fmt(oe75.ratio) : "–"}  Brier-Differenz ${brier && Number.isFinite(brier.mean) ? signed(brier.mean) : "–"}`);
  }

  if (!since) {
    console.log("\nOhne --since ist das eine Messung auf den Daten, aus denen die Konstanten stammen - kein Urteil.");
    return;
  }
  const beatsUniform = ["Brier noch ein Tor", "Log-Loss Resttore"].every((name) => results[name]!.mean + 2 * results[name]!.se < 0);
  const criteria: Array<[string, boolean]> = [
    ["1. besser als die gleichmäßige Uhr (≥ 2 Standardfehler)", beatsUniform],
    ["2. alle Bänder ab 300 Prüfpunkten höchstens 4 PP daneben", another && next && result],
    ["3. Resttore bei t = 45 und 75 im Rahmen [0,93; 1,07]", levelOk]
  ];
  console.log(`\nNachmessung ab ${since}:`);
  for (const [label, ok] of criteria) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`  ${hidden.length === 0 ? "✓" : "–"} 4. Gruppen unter 200 Spielen${hidden.length ? `: ${hidden.join(", ")} - dort verbergen` : ": keine"}`);
  const passed = criteria.every(([, ok]) => ok);
  console.log(`\nErgebnis: ${passed ? "bestanden" : "nicht bestanden"}${matches.length < 1500 ? ` - erst ${matches.length} von rund 1.500 Spielen, noch nicht aussagekräftig` : ""}.`);
}

const matches = loadMatches();
if (matches.length === 0) {
  console.log("Keine passenden Spiele gefunden.");
} else if (derive) {
  deriveConstants(matches);
} else {
  report(matches);
}
