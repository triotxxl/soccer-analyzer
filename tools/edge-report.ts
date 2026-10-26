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
 * Am Ende steht das Ablehnungsregister je Zelle aus Markt und Band. Kein API-Aufruf.
 *
 * Aufruf: node --env-file-if-exists=.env tools/edge-report.ts [--json <datei>]
 */
import fs from "node:fs";
import path from "node:path";
import { buildObservations, type EdgeObservation as Observation } from "../src/market-profile-service.ts";
import {
  MINIMUM_MARKET_SAMPLE,
  buildMarketProfile,
  type MarketProfile
} from "../src/market-profile.ts";

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

/**
 * Flat-ROI mit Standardfehler.
 *
 * Ohne die Streuung ist ein ROI auf diesen Stichproben nicht lesbar: Bei 557 Prüfwetten liegt
 * der Standardfehler bei rund 5 Prozentpunkten, ein Abstand von 8 PP zwischen zwei Regeln ist
 * also etwa ein Sigma und trägt keine Entscheidung. Gerechnet wird über die empirische
 * Streuung der Einzelergebnisse statt über eine Näherung aus der mittleren Quote, weil die
 * Quoten innerhalb einer Auswahl weit auseinanderliegen.
 */
function flatRoiOf(entries: Observation[]): { n: number; roi: number; se: number } | null {
  const n = entries.length;
  if (n === 0) return null;
  const profits = entries.map((entry) => (entry.hit ? entry.odds - 1 : -1));
  const roi = profits.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) return { n, roi, se: Number.POSITIVE_INFINITY };
  const variance = profits.reduce((sum, value) => sum + (value - roi) ** 2, 0) / (n - 1);
  return { n, roi, se: Math.sqrt(variance / n) };
}

const signedPercent = (value: number) =>
  `${value >= 0 ? "+" : "−"}${(Math.abs(value) * 100).toFixed(1).replace(".", ",")}`;

/** "+3,2 ± 4,8 %" - der ROI immer zusammen mit dem, was er aushält. */
const roiWithError = (entries: Observation[]): string => {
  const stats = flatRoiOf(entries);
  if (stats === null) return "-";
  const error = Number.isFinite(stats.se) ? (stats.se * 100).toFixed(1).replace(".", ",") : "∞";
  return `${signedPercent(stats.roi)} ± ${error} %`;
};


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
  // Neben dem ROI sein eigener Standardfehler - bis 06.10.2026 stand hier das 95-%-Intervall der
  // Trefferquote, das mit dem ROI nichts zu tun hat.
  console.log(`Gesamt: Prognose ${percent(overall.predicted)} · eingetreten ${percent(overall.hitRate)} · Bias ${points(overall.bias)} · flat-ROI ${roiWithError(selected)}`);
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

/** Das heutige Profil über alle Daten - für das Ablehnungsregister. */
function printCellLedger(profile: MarketProfile): void {
  console.log("\nAblehnungsregister des heutigen Profils (Markt × Vorteilsband):");
  console.log(`  ${"Markt".padEnd(16)}${"Band".padEnd(11)}${"n".padStart(6)}${"ROI".padStart(10)}`
    + `${"1. H".padStart(10)}${"2. H".padStart(10)}  Verdikt`);
  let decidable = 0;
  let avoid = 0;
  const avoidedMarkets = new Set<string>();
  for (const market of profile.markets) {
    for (const bandEntry of market.bands) {
      const { n, roi, roiFirstHalf: first, roiSecondHalf: second } = bandEntry.metrics;
      if (n >= MINIMUM_MARKET_SAMPLE && first !== null && second !== null) decidable += 1;
      if (bandEntry.verdict === "meiden") { avoid += 1; avoidedMarkets.add(market.marketLabel); }
      console.log(`  ${market.marketLabel.padEnd(16)}${bandEntry.label.padEnd(11)}${String(n).padStart(6)}`
        + `${signedPercent(roi).padStart(10)}`
        + `${(first === null ? "-" : signedPercent(first)).padStart(10)}`
        + `${(second === null ? "-" : signedPercent(second)).padStart(10)}  ${bandEntry.verdict}`);
    }
  }
  console.log(`\n  Zellen, die überhaupt ein Verdikt tragen können (n >= ${MINIMUM_MARKET_SAMPLE},`
    + ` beide Hälften belegt): ${decidable}`);
  console.log(`  Davon "meiden": ${avoid} in ${avoidedMarkets.size} Märkten`
    + (avoidedMarkets.size === 0 ? "" : ` (${[...avoidedMarkets].join(", ")})`));
}

printCellLedger(buildMarketProfile(observations));
