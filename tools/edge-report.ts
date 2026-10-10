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
 * Mit `--simulate` folgt die Nachspielung der Kelly-Automatik: für jeden Snapshot genau die
 * Regel der App (`selectKelly`), gemessen gegen den fairen Tipico-Preis. `--mit-1x2` lässt
 * dabei 1X2 zu, das ab Werk abgewählt ist. Kein API-Aufruf.
 *
 * Aufruf: node --env-file-if-exists=.env tools/edge-report.ts [--json <datei>] [--simulate [--mit-1x2]]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT_DIR } from "../src/config.ts";
import type { DashboardFixture } from "../src/dashboard.ts";
import { decideMarket } from "../src/market-outcome.ts";
import { buildObservations, readOutcomes, type EdgeObservation as Observation } from "../src/market-profile-service.ts";
import {
  MINIMUM_MARKET_SAMPLE,
  buildMarketProfile,
  type MarketProfile
} from "../src/market-profile.ts";

const OUTPUT_DIR = path.join(ROOT_DIR, "output");

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

/**
 * Nachspielung der App-Regel (seit 06.10.2026, Befund der drei Prüfer-Agenten).
 *
 * Bis dahin bildete `--simulate` ein festes Profil aus der ersten Zeithälfte und zählte jede
 * angenommene Marktzeile - mehrere je Spiel, ohne Einsatzrahmen, mit flachen Einsätzen. Das
 * war nicht die Regel der App, und die drei Trennstellen hatten verschachtelte Prüfmengen. Jetzt
 * läuft für jeden datierten Snapshot genau das, was die App zu diesem Zeitpunkt getan hätte:
 *
 * - Profil nur aus Spielen, die vor dem Snapshot abgerechnet waren (`settledAt`),
 * - Umfang „nächste 48 Std.“ ab dem Snapshot,
 * - `selectKelly` aus `frontend/src/kelly.ts` mit Automatik und `now` = Snapshot,
 * - je Spiel die erste Sichtung, abgerechnet mit `decideMarket`,
 * - gemessen gegen den fairen Tipico-Preis (`src/fair-price.ts`).
 *
 * Die Kernfrage ist die Spalte „Treffer − fair“: Liegt sie bei null, weiß das Modell nichts,
 * was nicht schon in der Quote steht, und auf Dauer kostet jede Wette den Aufschlag.
 */
interface ReplayBet {
  fixtureId: number;
  kickoff: string;
  marketKey: string;
  marketLabel: string;
  odds: number;
  probability: number;
  calibrated: number;
  fair: number;
  fairSource: "quote" | "geschätzt";
  stake: number;
  won: boolean;
}

interface KellyModule {
  DEFAULT_KELLY_SETTINGS: Record<string, unknown>;
  TEST_RUN_SETTINGS: Record<string, unknown>;
  selectKelly(
    fixtures: DashboardFixture[],
    marketFilter: "all",
    settings: Record<string, unknown>,
    auto: boolean,
    profile: MarketProfile | null,
    options: { now?: number }
  ): {
    automatic: boolean;
    candidates: Array<{
      fixtureId: number; kickoff: string; marketKey: string; marketLabel: string; selection: string;
      odds: number; probability: number; calibratedProbability: number | null;
      fairProbability: number; fairSource: "quote" | "geschätzt"; stake: number;
    }>;
  };
}

const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });
const dayOf = (iso: string): string => berlinDay.format(new Date(iso));
const fixed = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",");
const pp = (value: number) => `${value >= 0 ? "+" : "−"}${fixed(Math.abs(value) * 100)}`;

/** Flacher ROI mit Standardfehler, einmal unabhängig, einmal je Berliner Anstoßtag gebündelt. */
function replayRoi(bets: ReplayBet[]): { roi: number; se: number; seDay: number } {
  const n = bets.length;
  const profits = bets.map((bet) => (bet.won ? bet.odds - 1 : -1));
  const roi = profits.reduce((sum, value) => sum + value, 0) / n;
  const variance = profits.reduce((sum, value) => sum + (value - roi) ** 2, 0) / Math.max(1, n - 1);
  const byDay = new Map<string, number>();
  bets.forEach((bet, index) => byDay.set(dayOf(bet.kickoff), (byDay.get(dayOf(bet.kickoff)) ?? 0) + profits[index]! - roi));
  const days = byDay.size;
  const clustered = days > 1
    ? Math.sqrt([...byDay.values()].reduce((sum, value) => sum + value * value, 0) * days / (days - 1)) / n
    : Number.POSITIVE_INFINITY;
  return { roi, se: Math.sqrt(variance / n), seDay: clustered };
}

function printReplayLine(label: string, bets: ReplayBet[]): void {
  const n = bets.length;
  if (n < 2) { console.log(`  ${label.padEnd(26)}${String(n).padStart(6)}  zu wenige Wetten`); return; }
  const mean = (value: (bet: ReplayBet) => number) => bets.reduce((sum, bet) => sum + value(bet), 0) / n;
  const hit = mean((bet) => (bet.won ? 1 : 0));
  const fair = mean((bet) => bet.fair);
  const seFair = Math.sqrt(bets.reduce((sum, bet) => sum + bet.fair * (1 - bet.fair), 0)) / n;
  const { roi, se, seDay } = replayRoi(bets);
  const staked = bets.reduce((sum, bet) => sum + bet.stake, 0);
  const kellyRoi = staked > 0 ? bets.reduce((sum, bet) => sum + bet.stake * (bet.won ? bet.odds - 1 : -1), 0) / staked : 0;
  console.log(`  ${label.padEnd(26)}${String(n).padStart(6)}`
    + `${`${fixed(hit * 100)} %`.padStart(9)}${`${fixed(mean((bet) => bet.probability) * 100)} %`.padStart(9)}`
    + `${`${fixed(mean((bet) => bet.calibrated) * 100)} %`.padStart(9)}${`${fixed(fair * 100)} %`.padStart(9)}`
    + `${`${pp(hit - fair)} ± ${fixed(seFair * 100)}`.padStart(15)}`
    + `${`${pp(roi)} ± ${fixed(se * 100)} %`.padStart(17)}${`(Tag ± ${Number.isFinite(seDay) ? fixed(seDay * 100) : "∞"})`.padStart(14)}`
    + `${`${pp(kellyRoi)} %`.padStart(10)}`);
}

async function simulate(): Promise<void> {
  const kellyUrl = pathToFileURL(path.join(ROOT_DIR, "frontend", "src", "kelly.ts")).href;
  const kelly = await import(kellyUrl) as KellyModule;
  const outcomes = readOutcomes();
  const withOneXTwo = process.argv.includes("--mit-1x2");

  const snapshots = fs.readdirSync(OUTPUT_DIR)
    .filter((file) => /^dashboard-\d{4}-\d{2}-\d{2}.*\.json$/.test(file))
    .map((file) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), "utf8")) as
          { meta?: { createdAt?: string }; fixtures?: DashboardFixture[] };
        return { t: Date.parse(parsed.meta?.createdAt ?? ""), fixtures: parsed.fixtures ?? [] };
      } catch {
        return { t: Number.NaN, fixtures: [] };
      }
    })
    .filter((snapshot) => Number.isFinite(snapshot.t))
    .sort((left, right) => left.t - right.t);

  // Die Einstellungen der App: ab Werk, Testbetrieb, und ein Rahmen, der nichts abschneidet.
  // Die Marktabwahl ab Werk (1X2 aus) gilt seit 06.10.2026 auch in der Automatik.
  const defaults = { ...kelly.DEFAULT_KELLY_SETTINGS, ...(withOneXTwo ? { disabledMarkets: [] } : {}) };
  const frames: Array<[string, Record<string, unknown>]> = [
    ["ohne Rahmen", { ...defaults, maxStakePercent: 1, maxExposurePercent: 1e9, minStake: 0, enableGameRiskLimit: false }],
    ["Testbetrieb", { ...defaults, ...kelly.TEST_RUN_SETTINGS }],
    ["Vorgabe", defaults]
  ];
  const firstSeen = frames.map(() => new Map<number, ReplayBet & { runAt: number }>());
  const perRun = frames.map(() => [] as number[]);

  let runs = 0;
  for (const snapshot of snapshots) {
    const known = observations.filter((entry) => Date.parse(entry.settledAt) < snapshot.t);
    if (known.length < 100) continue;
    runs += 1;
    const profile = buildMarketProfile(known, new Date(snapshot.t));
    const scope = snapshot.fixtures.filter((fixture) => {
      const kickoff = Date.parse(fixture.kickoff);
      return kickoff > snapshot.t && kickoff <= snapshot.t + 48 * 3_600_000;
    });
    frames.forEach(([, settings], index) => {
      const selection = kelly.selectKelly(scope, "all", settings, true, profile, { now: snapshot.t });
      if (!selection.automatic) return;
      perRun[index]!.push(selection.candidates.length);
      for (const candidate of selection.candidates) {
        if (firstSeen[index]!.has(candidate.fixtureId)) continue;
        const outcome = outcomes.get(candidate.fixtureId);
        const won = outcome === undefined ? null : decideMarket(candidate.marketKey, candidate.selection, outcome);
        if (won === null) continue;
        firstSeen[index]!.set(candidate.fixtureId, {
          runAt: snapshot.t,
          fixtureId: candidate.fixtureId,
          kickoff: candidate.kickoff,
          marketKey: candidate.marketKey,
          marketLabel: candidate.marketLabel,
          odds: candidate.odds,
          probability: candidate.probability,
          calibrated: candidate.calibratedProbability ?? candidate.probability,
          fair: candidate.fairProbability,
          fairSource: candidate.fairSource,
          stake: candidate.stake,
          won
        });
      }
    });
  }

  console.log("\n\nNachspielung der Kelly-Automatik (App-Regel je Snapshot, erste Sichtung je Spiel)");
  console.log(`  ${runs} Snapshots mit Profil, Abrechnung nach echtem settled_at`
    + (withOneXTwo ? ", 1X2 zugelassen (--mit-1x2)" : ", Marktabwahl ab Werk (1X2 aus)"));
  const header = `  ${"".padEnd(26)}${"Wetten".padStart(6)}${"Treffer".padStart(9)}${"Modell".padStart(9)}`
    + `${"korr.".padStart(9)}${"fair".padStart(9)}${"Treffer−fair".padStart(15)}${"flacher ROI".padStart(17)}`
    + `${"".padStart(14)}${"Kelly-ROI".padStart(10)}`;

  frames.forEach(([name], index) => {
    const bets = [...firstSeen[index]!.values()].sort((left, right) => Date.parse(left.kickoff) - Date.parse(right.kickoff));
    if (bets.length === 0) { console.log(`\n  ${name}: keine Wetten`); return; }
    const kickoffs = bets.map((bet) => Date.parse(bet.kickoff));
    const middle = kickoffs[Math.floor(kickoffs.length / 2)]!;
    console.log(`\n  Rahmen „${name}“`);
    console.log(header);
    printReplayLine("alle", bets);
    printReplayLine("ohne Remis", bets.filter((bet) => bet.marketKey !== "draw"));
    printReplayLine(`Anstoß vor ${new Date(middle).toISOString().slice(0, 10)}`, bets.filter((bet) => Date.parse(bet.kickoff) < middle));
    printReplayLine("Anstoß danach", bets.filter((bet) => Date.parse(bet.kickoff) >= middle));
    printReplayLine("fair aus echter Gegenquote", bets.filter((bet) => bet.fairSource === "quote"));
    const byMarket = new Map<string, ReplayBet[]>();
    for (const bet of bets) byMarket.set(bet.marketLabel, [...(byMarket.get(bet.marketLabel) ?? []), bet]);
    for (const [label, group] of [...byMarket].sort((left, right) => right[1].length - left[1].length)) {
      printReplayLine(`  ${label}`, group);
    }
    const perDay = new Map<string, number>();
    for (const bet of bets) perDay.set(dayOf(bet.kickoff), (perDay.get(dayOf(bet.kickoff)) ?? 0) + 1);
    const days = [...perDay.values()].sort((left, right) => left - right);
    const runsSorted = [...perRun[index]!].sort((left, right) => left - right);
    console.log(`  Wetten je Anstoßtag: Median ${days[Math.floor(days.length / 2)]}, Mittel`
      + ` ${fixed(days.reduce((sum, value) => sum + value, 0) / days.length)}, höchstens ${days.at(-1)} (${days.length} Tage)`
      + ` · je Analyse: Median ${runsSorted[Math.floor(runsSorted.length / 2)]}, höchstens ${runsSorted.at(-1)}`);
  });

  console.log("\n  Lesehinweis: Maßgeblich ist „Treffer − fair“. Liegt es bei null, trifft die Auswahl nur so");
  console.log("  oft, wie die Tipico-Quote ohne Aufschlag sagt, und auf Dauer kostet jede Wette den Aufschlag");
  console.log("  (rund 8 bis 11 %). Ein ROI ist nur mit seinem ± lesbar; „Tag ±“ bündelt Wetten desselben");
  console.log("  Anstoßtags. Teilmengen nach Markt sind nachträglich herausgegriffen - kann auch Zufall sein.");
}

if (process.argv.includes("--simulate")) {
  printCellLedger(buildMarketProfile(observations));
  await simulate();
}
