/**
 * Misst, wie gut die Modellwahrscheinlichkeiten dort sind, wo der Kelly-Picker zugreift.
 *
 * Grundlage sind die archivierten Dashboard-Snapshots in `output/`: sie halten für jede
 * Partie Quote und Modellwahrscheinlichkeit fest, also genau das Paar, aus dem der Edge
 * entsteht. Verknüpft mit den abgerechneten Ergebnissen in SQLite ergibt das ein Vielfaches
 * der Stichprobe, die aus den tatsächlich gesetzten Wetten entsteht - der Lauf vom 02.09.
 * lieferte 40 Wetten, dieselben Snapshots liefern über 13.000 Beobachtungen.
 *
 * Wichtig ist die Spalte "Bias", nicht der ROI: Der ROI einer Teilmenge schwankt bei diesen
 * Stichprobengrößen so stark, dass er zwischen zwei Zeithälften das Vorzeichen wechselt. Der
 * Bias (Trefferquote minus Modellprognose) ist die stabile Größe und sagt, ob eine Regel die
 * Selbstüberschätzung senkt. Deshalb weist der Report jede Kennzahl zusätzlich getrennt nach
 * erster und zweiter Zeithälfte aus - was nur in einer Hälfte funktioniert, ist gefittet.
 *
 * Aufruf: node --env-file-if-exists=.env tools/edge-report.ts [--json <datei>]
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_FILE, ROOT_DIR } from "../src/config.ts";
import type { DashboardFixture, DashboardMarket } from "../src/dashboard.ts";

const OUTPUT_DIR = path.join(ROOT_DIR, "output");

interface Observation {
  fixtureId: number;
  marketKey: string;
  marketLabel: string;
  selection: string;
  kickoff: string;
  country: string;
  league: string;
  probability: number;
  odds: number;
  implied: number;
  edge: number;
  confidence: number;
  crossLeague: boolean;
  hasStrength: boolean;
  hit: 0 | 1;
}

interface Outcome {
  homeGoals: number;
  awayGoals: number;
  halftimeHomeGoals: number | null;
  halftimeAwayGoals: number | null;
}

/** Gleiche Marktlogik wie im Kelly-Tracker: `null` heißt nicht entscheidbar. */
function decide(marketKey: string, selection: string, outcome: Outcome): boolean | null {
  const total = outcome.homeGoals + outcome.awayGoals;
  const halftime = outcome.halftimeHomeGoals === null || outcome.halftimeAwayGoals === null
    ? null
    : outcome.halftimeHomeGoals + outcome.halftimeAwayGoals;
  switch (marketKey) {
    case "over15": return total >= 2;
    case "over25": return total >= 3;
    case "over35": return total >= 4;
    case "under15": return total <= 1;
    case "under25": return total <= 2;
    case "under35": return total <= 3;
    case "btts": return outcome.homeGoals >= 1 && outcome.awayGoals >= 1;
    case "firstHalfOver05": return halftime === null ? null : halftime >= 1;
    case "firstHalfOver15": return halftime === null ? null : halftime >= 2;
    case "firstHalfUnder05": return halftime === null ? null : halftime < 1;
    case "firstHalfUnder15": return halftime === null ? null : halftime < 2;
    case "draw": return outcome.homeGoals === outcome.awayGoals;
    case "1x2":
      if (selection.startsWith("Heimsieg")) return outcome.homeGoals > outcome.awayGoals;
      if (selection.startsWith("Auswärtssieg")) return outcome.awayGoals > outcome.homeGoals;
      if (selection.startsWith("Unentschieden")) return outcome.homeGoals === outcome.awayGoals;
      return null;
    default: return null;
  }
}

/**
 * Je Partie und Markt zählt der jüngste Snapshot: Quoten werden bis zum Anpfiff
 * nachgeführt, und der Picker arbeitet immer auf dem letzten Stand.
 */
function collectSnapshots(): Map<string, Observation> {
  const latest = new Map<string, Observation & { stamp: string }>();
  const files = fs.existsSync(OUTPUT_DIR)
    ? fs.readdirSync(OUTPUT_DIR).filter((file) => file.startsWith("dashboard-") && file.endsWith(".json"))
    : [];
  for (const file of files) {
    let snapshot: { fixtures?: DashboardFixture[] };
    try {
      snapshot = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), "utf8")) as { fixtures?: DashboardFixture[] };
    } catch {
      continue; // Ein abgebrochener Lauf hinterlässt gelegentlich eine halbe Datei.
    }
    const stamp = file.slice("dashboard-".length, -".json".length);
    for (const fixture of snapshot.fixtures ?? []) {
      for (const market of (fixture.markets ?? []) as DashboardMarket[]) {
        if (market.odds === null || market.odds <= 1) continue;
        if (market.probability === null || market.probability === undefined) continue;
        if (market.probabilityReliable === false) continue;
        const key = `${fixture.fixtureId}|${market.key}|${market.selection}`;
        const previous = latest.get(key);
        if (previous && previous.stamp >= stamp) continue;
        latest.set(key, {
          stamp,
          fixtureId: fixture.fixtureId,
          marketKey: market.key,
          marketLabel: market.label,
          selection: market.selection,
          kickoff: fixture.kickoff,
          country: fixture.country,
          league: fixture.league,
          probability: market.probability,
          odds: market.odds,
          implied: 1 / market.odds,
          edge: market.probability - 1 / market.odds,
          confidence: market.confidence,
          crossLeague: fixture.crossLeague === true,
          hasStrength: fixture.strength !== undefined,
          hit: 0
        });
      }
    }
  }
  return latest as Map<string, Observation>;
}

function buildObservations(): Observation[] {
  const database = new DatabaseSync(DB_FILE, { readOnly: true });
  const outcomes = new Map<number, Outcome>();
  const rows = database.prepare(`
    SELECT fixture_id, actual_home_goals, actual_away_goals,
           actual_halftime_home_goals, actual_halftime_away_goals
    FROM goal_line_predictions
    WHERE settled_at IS NOT NULL AND actual_home_goals IS NOT NULL AND actual_away_goals IS NOT NULL
  `).all() as Array<Record<string, number | null>>;
  for (const row of rows) {
    outcomes.set(row.fixture_id as number, {
      homeGoals: row.actual_home_goals as number,
      awayGoals: row.actual_away_goals as number,
      halftimeHomeGoals: row.actual_halftime_home_goals as number | null,
      halftimeAwayGoals: row.actual_halftime_away_goals as number | null
    });
  }
  database.close();

  const observations: Observation[] = [];
  for (const candidate of collectSnapshots().values()) {
    const outcome = outcomes.get(candidate.fixtureId);
    if (!outcome) continue;
    const won = decide(candidate.marketKey, candidate.selection, outcome);
    if (won === null) continue;
    observations.push({ ...candidate, hit: won ? 1 : 0 });
  }
  return observations.sort((left, right) => left.kickoff.localeCompare(right.kickoff));
}

interface Metrics {
  n: number;
  hitRate: number;
  predicted: number;
  bias: number;
  roi: number;
  confidenceInterval: number;
  averageOdds: number;
}

function metricsOf(group: Observation[]): Metrics | null {
  const n = group.length;
  if (n === 0) return null;
  const wins = group.reduce((sum, entry) => sum + entry.hit, 0);
  const predicted = group.reduce((sum, entry) => sum + entry.probability, 0) / n;
  const profit = group.reduce((sum, entry) => sum + (entry.hit ? entry.odds - 1 : -1), 0);
  const hitRate = wins / n;
  return {
    n,
    hitRate,
    predicted,
    bias: hitRate - predicted,
    roi: profit / n,
    confidenceInterval: 1.96 * Math.sqrt(hitRate * (1 - hitRate) / n),
    averageOdds: group.reduce((sum, entry) => sum + entry.odds, 0) / n
  };
}

const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits).replace(".", ",")} %`;
const points = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} PP`;

function printTable(title: string, groups: Array<[string, Observation[]]>, firstHalf: Set<Observation>) {
  console.log(`\n${title}`);
  console.log(`  ${"Gruppe".padEnd(22)}${"n".padStart(6)}${"Prognose".padStart(11)}${"ist".padStart(9)}${"Bias".padStart(11)}${"ROI".padStart(10)}${"ROI 1.H".padStart(10)}${"ROI 2.H".padStart(10)}`);
  for (const [name, group] of groups) {
    const all = metricsOf(group);
    if (all === null || all.n < 20) continue;
    const first = metricsOf(group.filter((entry) => firstHalf.has(entry)));
    const second = metricsOf(group.filter((entry) => !firstHalf.has(entry)));
    console.log(`  ${name.padEnd(22)}${String(all.n).padStart(6)}${percent(all.predicted).padStart(11)}${percent(all.hitRate).padStart(9)}${points(all.bias).padStart(11)}${percent(all.roi).padStart(10)}${(first ? percent(first.roi) : "-").padStart(10)}${(second ? percent(second.roi) : "-").padStart(10)}`);
  }
}

const observations = buildObservations();
const minEdge = 0.07;
const minOdds = 1.5;
const selected = observations.filter((entry) => entry.edge >= minEdge && entry.odds >= minOdds);
// Zeitliche Aufteilung als Gegenprobe: Eine Regel, die nur in einer Haelfte traegt, ist an
// den Daten gefittet und nicht an der Wirklichkeit.
const middle = Math.floor(selected.length / 2);
const firstHalf = new Set(selected.slice(0, middle));

console.log(`Abgerechnete Marktbeobachtungen: ${observations.length}`);
console.log(`Davon durch den Picker-Filter (Edge >= ${points(minEdge)}, Quote >= ${minOdds}): ${selected.length}`);
const overall = metricsOf(selected);
if (overall !== null) {
  console.log(`Gesamt: Prognose ${percent(overall.predicted)} · eingetreten ${percent(overall.hitRate)} · Bias ${points(overall.bias)} · flat-ROI ${percent(overall.roi)} (±${percent(overall.confidenceInterval)})`);
}

const groupBy = (entries: Observation[], key: (entry: Observation) => string): Array<[string, Observation[]]> => {
  const groups = new Map<string, Observation[]>();
  for (const entry of entries) {
    const group = groups.get(key(entry)) ?? [];
    group.push(entry);
    groups.set(key(entry), group);
  }
  return [...groups.entries()].sort((left, right) => right[1].length - left[1].length);
};

const band = (entries: Observation[], bounds: Array<[number, number]>, value: (entry: Observation) => number, label: (lo: number, hi: number) => string) =>
  bounds.map(([lo, hi]) => [label(lo, hi), entries.filter((entry) => value(entry) >= lo && value(entry) < hi)] as [string, Observation[]]);

printTable("Nach Edge - die Kernfrage: trägt ein großer Edge?",
  band(selected, [[0.07, 0.10], [0.10, 0.15], [0.15, 0.25], [0.25, 1]], (entry) => entry.edge,
    (lo, hi) => `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)} PP`), firstHalf);
printTable("Nach Markt", groupBy(selected, (entry) => entry.marketLabel), firstHalf);
printTable("Nach Ligastärke-Basis", [
  ["Cross-League", selected.filter((entry) => entry.crossLeague)],
  ["gleiche Liga", selected.filter((entry) => !entry.crossLeague)],
  ["ohne Ligastärke", selected.filter((entry) => !entry.hasStrength)],
  ["mit Ligastärke", selected.filter((entry) => entry.hasStrength)]
], firstHalf);
printTable("Nach Datenvertrauen",
  band(selected, [[0, 70], [70, 85], [85, 95], [95, 101]], (entry) => entry.confidence,
    (lo, hi) => `${lo}-${Math.min(hi, 100)} %`), firstHalf);
printTable("Nach Quote",
  band(selected, [[1.5, 2], [2, 3], [3, 6], [6, 1000]], (entry) => entry.odds,
    (lo, hi) => `${lo}-${hi === 1000 ? "offen" : hi}`), firstHalf);

console.log("\nLesehinweis: Der Bias ist die belastbare Spalte. Weicht der ROI zwischen den beiden");
console.log("Zeithälften stark ab, ist die Gruppe zu klein für eine Entscheidung - unabhängig davon,");
console.log("wie gut der Gesamt-ROI aussieht.");

const jsonIndex = process.argv.indexOf("--json");
if (jsonIndex !== -1 && process.argv[jsonIndex + 1] !== undefined) {
  const target = path.resolve(process.argv[jsonIndex + 1]!);
  fs.writeFileSync(target, JSON.stringify({
    generatedAt: new Date().toISOString(),
    observations: observations.length,
    selected: selected.length,
    filter: { minEdge, minOdds },
    overall,
    byEdge: band(selected, [[0.07, 0.10], [0.10, 0.15], [0.15, 0.25], [0.25, 1]], (entry) => entry.edge,
      (lo, hi) => `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}pp`)
      .map(([name, group]) => ({ name, ...metricsOf(group) })),
    byMarket: groupBy(selected, (entry) => entry.marketLabel).map(([name, group]) => ({ name, ...metricsOf(group) }))
  }, null, 2));
  console.log(`\nJSON geschrieben: ${target}`);
}
