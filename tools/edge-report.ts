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
import {
  MINIMUM_MARKET_SAMPLE,
  autoDecide,
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

/**
 * Vergleicht zwei Auswahlregeln nur auf den Zeilen, in denen sie sich unterscheiden.
 *
 * Zwei unabhängig verrauschte Gesamt-ROIs gegeneinanderzustellen verschenkt Genauigkeit: Die
 * Zeilen, die beide Regeln nehmen, tragen zu beiden Seiten dasselbe Rauschen bei und sagen
 * über den Unterschied nichts. Übrig bleibt die symmetrische Differenz - und erst deren
 * Abstand, gemessen am gemeinsamen Standardfehler, beantwortet die Frage, ob eine
 * Regeländerung etwas bewirkt hat.
 */
function printPairedComparison(
  holdout: Observation[],
  left: { name: string; rule: (entry: Observation) => boolean },
  right: { name: string; rule: (entry: Observation) => boolean }
): void {
  const shared = holdout.filter((entry) => left.rule(entry) && right.rule(entry));
  const onlyLeft = holdout.filter((entry) => left.rule(entry) && !right.rule(entry));
  const onlyRight = holdout.filter((entry) => right.rule(entry) && !left.rule(entry));

  console.log(`\n  Gepaarter Vergleich ${left.name} gegen ${right.name}:`);
  console.log(`  ${"gemeinsame Zeilen".padEnd(30)}${String(shared.length).padStart(7)}`
    + `${roiWithError(shared).padStart(18)}   (zählt für den Unterschied nicht)`);
  console.log(`  ${`nur ${left.name}`.padEnd(30)}${String(onlyLeft.length).padStart(7)}${roiWithError(onlyLeft).padStart(18)}`);
  console.log(`  ${`nur ${right.name}`.padEnd(30)}${String(onlyRight.length).padStart(7)}${roiWithError(onlyRight).padStart(18)}`);

  const a = flatRoiOf(onlyLeft);
  const b = flatRoiOf(onlyRight);
  if (a === null || b === null || !Number.isFinite(a.se) || !Number.isFinite(b.se)) {
    console.log("  Unterschied: nicht bestimmbar, eine Seite ist leer oder hat nur eine Zeile.");
    return;
  }
  const difference = b.roi - a.roi;
  const combined = Math.sqrt(a.se ** 2 + b.se ** 2);
  const sigma = combined === 0 ? 0 : difference / combined;
  console.log(`  Unterschied ${signedPercent(difference)} ± ${(combined * 100).toFixed(1).replace(".", ",")} %`
    + ` = ${sigma.toFixed(2).replace(".", ",")} Sigma`
    + (Math.abs(sigma) < 1 ? "  → im Rauschen, kein messbarer Effekt" : ""));
}

/**
 * Das Ablehnungsregister: jede Zelle aus Markt und Vorteilsband, wie das Profil sie sieht.
 *
 * Es beantwortet die Frage, ob eine Ablehnung nach Bandverdikt eine Regel ist oder eine
 * umständlich geschriebene Marktsperre: Sind die "meiden"-Zellen genau zwei Märkte, ist es
 * letzteres. Und es zeigt, wie viele Zellen überhaupt genug Fälle in beiden Zeithälften
 * haben, um je ein Verdikt tragen zu können.
 */
function printCellLedger(profile: MarketProfile): void {
  console.log("\n  Ablehnungsregister des Trainingsprofils (Markt × Vorteilsband):");
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
        + `${(roi === null ? "-" : signedPercent(roi)).padStart(10)}`
        + `${(first === null ? "-" : signedPercent(first)).padStart(10)}`
        + `${(second === null ? "-" : signedPercent(second)).padStart(10)}  ${bandEntry.verdict}`);
    }
  }
  console.log(`\n  Zellen, die überhaupt ein Verdikt tragen können (n >= ${MINIMUM_MARKET_SAMPLE},`
    + ` beide Hälften belegt): ${decidable}`);
  console.log(`  Davon "meiden": ${avoid} in ${avoidedMarkets.size} Märkten`
    + (avoidedMarkets.size === 0 ? "" : ` (${[...avoidedMarkets].join(", ")})`));

  const derived = profile.markets.filter((market) => market.derivedFrom !== undefined);
  console.log(`  Noch gespiegelte Märkte im Trainingsprofil: ${derived.length === 0
    ? "keine - alle tragen eigene Messwerte"
    : derived.map((market) => `${market.marketLabel} ← ${market.derivedFrom}`).join(", ")}`);
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
  console.log(`  ${"Regel".padEnd(24)}${"Wetten".padStart(8)}${"Treffer".padStart(10)}${"flat-ROI".padStart(18)}`);
  for (const [name, rule] of [["heutige Vorgabe", currentRule], ["Automatik", autoRule]] as const) {
    const chosen = holdout.filter(rule);
    console.log(`  ${name.padEnd(24)}${String(chosen.length).padStart(8)}${hitRate(chosen).padStart(10)}${roiWithError(chosen).padStart(18)}`);
  }

  printPairedComparison(holdout,
    { name: "Vorgabe", rule: currentRule },
    { name: "Automatik", rule: autoRule });

  console.log("\n  Zum Vergleich dieselben Regeln auf der Trainingshälfte - hier hat die Automatik");
  console.log("  die Antworten gekannt, diese Zeilen sind also kein Beleg:");
  for (const [name, rule] of [["heutige Vorgabe", currentRule], ["Automatik", autoRule]] as const) {
    const chosen = training.filter(rule);
    console.log(`  ${name.padEnd(24)}${String(chosen.length).padStart(8)}${hitRate(chosen).padStart(10)}${roiWithError(chosen).padStart(18)}`);
  }

  const accepted = holdout.filter(autoRule);
  console.log("\n  Automatik-Auswahl der Prüfhälfte nach Markt:");
  console.log(`  ${"Markt".padEnd(24)}${"Wetten".padStart(8)}${"Treffer".padStart(10)}${"flat-ROI".padStart(18)}${"davon Edge <= 0".padStart(17)}`);
  for (const [label, group] of groupBy(accepted, (entry) => entry.marketLabel)) {
    const withoutEdge = group.filter((entry) => entry.edge <= 0).length;
    console.log(`  ${label.padEnd(24)}${String(group.length).padStart(8)}${hitRate(group).padStart(10)}`
      + `${roiWithError(group).padStart(18)}${String(withoutEdge).padStart(17)}`);
  }

  // Was eine Untergrenze beim rohen Vorteil kosten würde: Diese Zeilen entstehen heute allein
  // aus der Korrektur, das Modell selbst sieht dort keinen Vorteil.
  const withoutRawEdge = accepted.filter((entry) => entry.edge <= 0);
  console.log(`\n  Angenommene Zeilen ohne eigenen Modellvorteil: ${withoutRawEdge.length}`
    + ` von ${accepted.length}${withoutRawEdge.length === 0 ? "" : ` · ${roiWithError(withoutRawEdge)}`}`);

  // Eine Wette je Partie - so arbeitet die Automatik seit dem 15.09.2026. Die Frage ist, nach
  // welchem Maßstab die eine ausgewählt wird. Der Backtest kann das messen, weil er die
  // Partie-ID kennt; die Einsatzhöhe kann er nicht, er rechnet flach.
  const perFixture = new Map<number, Observation[]>();
  for (const entry of accepted) {
    const group = perFixture.get(entry.fixtureId) ?? [];
    group.push(entry);
    perFixture.set(entry.fixtureId, group);
  }
  const multi = [...perFixture.values()].filter((group) => group.length > 1);
  const pickBy = (score: (entry: Observation) => number): Observation[] =>
    [...perFixture.values()].map((group) =>
      group.reduce((best, entry) => (score(entry) > score(best) ? entry : best)));
  const fullKellyOf = (entry: Observation): number => {
    const calibration = autoDecide(profile, {
      marketKey: entry.marketKey,
      probability: entry.probability,
      odds: entry.odds,
      crossLeague: entry.crossLeague
    }).calibration;
    const probability = calibration?.probability ?? entry.probability;
    return (probability * entry.odds - 1) / (entry.odds - 1);
  };

  console.log(`\n  Eine Wette je Partie: ${perFixture.size} Partien, davon ${multi.length}`
    + " mit mehr als einem angenommenen Markt.");
  console.log(`  ${"Maßstab".padEnd(30)}${"Wetten".padStart(7)}${"flat-ROI".padStart(18)}`);
  console.log(`  ${"höchster roher Vorteil".padEnd(30)}${String(perFixture.size).padStart(7)}`
    + `${roiWithError(pickBy((entry) => entry.edge)).padStart(18)}`);
  console.log(`  ${"höchster voller Kelly-Wert".padEnd(30)}${String(perFixture.size).padStart(7)}`
    + `${roiWithError(pickBy(fullKellyOf)).padStart(18)}`);

  printCellLedger(profile);
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

  console.log("\n  Dieselbe Prüfung an mehreren Trennstellen:");
  console.log(`  ${"Schnitt".padEnd(12)}${"Training".padStart(9)}${"Prüfung".padStart(8)}${"Wetten".padStart(7)}`
    + `${"ROI".padStart(18)}${"ohne Remis".padStart(18)}${"Vorgabe".padStart(18)}`);
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
    console.log(`  ${splitAt.slice(0, 10).padEnd(12)}${String(training.length).padStart(9)}${String(holdout.length).padStart(8)}`
      + `${String(chosen.length).padStart(7)}${roiWithError(chosen).padStart(18)}`
      + `${roiWithError(chosen.filter((entry) => entry.marketKey !== "draw")).padStart(18)}`
      + `${roiWithError(baseline).padStart(18)}`);
  }
  console.log("\n  Lesehinweis: Wechselt der ROI zwischen den Trennstellen das Vorzeichen oder hängt er");
  console.log("  ganz am Remis, ist die Automatik nicht belegt - dann ist sie bestenfalls die weniger");
  console.log("  verlustreiche Auswahl, nicht eine gewinnbringende. Die Spalte \"ohne Remis\" ist die");
  console.log("  eigentliche Frage; liegt ein Unterschied innerhalb des ±-Bereichs, ist er keiner.");
}
