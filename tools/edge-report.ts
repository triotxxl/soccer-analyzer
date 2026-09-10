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
import { buildObservations, type EdgeObservation as Observation } from "../src/market-profile-service.ts";
import { autoDecide, buildMarketProfile } from "../src/market-profile.ts";

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

/**
 * Rückrechnung der Automatik: Trägt die korrigierte Auswahl auf Daten, die sie nie gesehen hat?
 *
 * Die Kalibrierung wird ausschließlich aus der ersten Zeithälfte gebildet und auf die zweite
 * angewendet. Eine Korrektur, die aus denselben Zeilen stammt, an denen sie gemessen wird,
 * sieht immer gut aus - deshalb ist allein die Spalte "2. Hälfte" die Antwort auf die Frage,
 * ob die Automatik ausgeliefert werden darf.
 */
if (process.argv.includes("--simulate")) {
  const playable = observations.filter((entry) => entry.edge > 0);
  const kickoffs = playable.map((entry) => entry.kickoff).sort();
  const splitAt = kickoffs[Math.floor(kickoffs.length / 2)]!;
  const training = playable.filter((entry) => entry.kickoff < splitAt);
  const holdout = playable.filter((entry) => entry.kickoff >= splitAt);
  const profile = buildMarketProfile(training);

  const flatRoi = (entries: Observation[]): string => entries.length === 0
    ? "  -"
    : percent(entries.reduce((sum, entry) => sum + (entry.hit ? entry.odds - 1 : -1), 0) / entries.length);
  const hitRate = (entries: Observation[]): string => entries.length === 0
    ? "  -"
    : percent(entries.reduce((sum, entry) => sum + entry.hit, 0) / entries.length);

  // Die heutige Vorgabe als Vergleichslinie, damit der Gewinn nicht gegen nichts gemessen wird.
  const currentRule = (entry: Observation): boolean =>
    entry.odds >= 1.5 && entry.edge >= 0.02 && entry.edge <= 0.12
    && entry.marketKey !== "1x2" && !entry.crossLeague;

  const autoRule = (entry: Observation): boolean =>
    autoDecide(profile, {
      marketKey: entry.marketKey,
      probability: entry.probability,
      odds: entry.odds,
      crossLeague: entry.crossLeague
    }).accepted;

  console.log("\n\nRückrechnung der Automatik");
  console.log(`  Kalibriert auf ${training.length} Zeilen vor ${splitAt.slice(0, 10)},`
    + ` geprüft auf ${holdout.length} Zeilen danach.`);
  console.log(`  ${"Regel".padEnd(24)}${"Wetten".padStart(8)}${"Treffer".padStart(10)}${"flat-ROI".padStart(11)}`);
  for (const [name, rule] of [["heutige Vorgabe", currentRule], ["Automatik", autoRule]] as const) {
    const chosen = holdout.filter(rule);
    console.log(`  ${name.padEnd(24)}${String(chosen.length).padStart(8)}${hitRate(chosen).padStart(10)}${flatRoi(chosen).padStart(11)}`);
  }

  console.log("\n  Zum Vergleich dieselben Regeln auf der Trainingshälfte - hier hat die Automatik");
  console.log("  die Antworten gekannt, diese Zeilen sind also kein Beleg:");
  for (const [name, rule] of [["heutige Vorgabe", currentRule], ["Automatik", autoRule]] as const) {
    const chosen = training.filter(rule);
    console.log(`  ${name.padEnd(24)}${String(chosen.length).padStart(8)}${hitRate(chosen).padStart(10)}${flatRoi(chosen).padStart(11)}`);
  }

  console.log("\n  Automatik-Auswahl der Prüfhälfte nach Markt:");
  for (const [label, group] of groupBy(holdout.filter(autoRule), (entry) => entry.marketLabel)) {
    console.log(`  ${label.padEnd(24)}${String(group.length).padStart(8)}${hitRate(group).padStart(10)}${flatRoi(group).padStart(11)}`);
  }
}

/**
 * Belastbarkeitsprobe: Ein einzelner Zeitschnitt kann zufällig günstig liegen. Deshalb
 * dieselbe Rückrechnung an mehreren Trennstellen, und zusätzlich ohne den Markt, der am
 * meisten beigetragen hat - trägt das Ergebnis nur eine Handvoll hoher Quoten, ist es kein
 * Ergebnis, sondern Rauschen.
 */
if (process.argv.includes("--simulate")) {
  const playable = observations.filter((entry) => entry.edge > 0);
  const kickoffs = playable.map((entry) => entry.kickoff).sort();

  const roiOf = (entries: Observation[]): number | null => entries.length === 0
    ? null
    : entries.reduce((sum, entry) => sum + (entry.hit ? entry.odds - 1 : -1), 0) / entries.length;
  const show = (value: number | null) => value === null ? "  -" : percent(value);

  console.log("\n  Dieselbe Prüfung an mehreren Trennstellen:");
  console.log(`  ${"Schnitt".padEnd(14)}${"Training".padStart(10)}${"Prüfung".padStart(9)}${"Wetten".padStart(8)}${"ROI".padStart(9)}${"ohne Remis".padStart(12)}${"Vorgabe".padStart(10)}`);
  for (const share of [0.4, 0.5, 0.6]) {
    const splitAt = kickoffs[Math.floor(kickoffs.length * share)]!;
    const training = playable.filter((entry) => entry.kickoff < splitAt);
    const holdout = playable.filter((entry) => entry.kickoff >= splitAt);
    const profile = buildMarketProfile(training);
    const chosen = holdout.filter((entry) => autoDecide(profile, {
      marketKey: entry.marketKey,
      probability: entry.probability,
      odds: entry.odds,
      crossLeague: entry.crossLeague
    }).accepted);
    const baseline = holdout.filter((entry) => entry.odds >= 1.5 && entry.edge >= 0.02
      && entry.edge <= 0.12 && entry.marketKey !== "1x2" && !entry.crossLeague);
    console.log(`  ${splitAt.slice(0, 10).padEnd(14)}${String(training.length).padStart(10)}${String(holdout.length).padStart(9)}`
      + `${String(chosen.length).padStart(8)}${show(roiOf(chosen)).padStart(9)}`
      + `${show(roiOf(chosen.filter((entry) => entry.marketKey !== "draw"))).padStart(12)}`
      + `${show(roiOf(baseline)).padStart(10)}`);
  }
  console.log("\n  Lesehinweis: Wechselt der ROI zwischen den Trennstellen das Vorzeichen oder hängt er");
  console.log("  ganz am Remis, ist die Automatik nicht belegt - dann ist sie bestenfalls die weniger");
  console.log("  verlustreiche Auswahl, nicht eine gewinnbringende.");
}
