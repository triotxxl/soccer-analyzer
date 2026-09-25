/**
 * Backtest des Team-Elo gegen die eigenen Spiele in `elo_matches`, ohne Blick in die Zukunft
 * (siehe `src/elo-backtest.ts`). Kostet kein API-Budget.
 *
 *   npm run elo-backtest -- --test-start 2025-01-01 --test-end 2025-12-31
 *   npm run elo-backtest -- --test-start 2025-01-01 --test-end 2025-12-31 --config k40.json
 *   [--train-start 2021-01-01] [--step 7] [--min-games 10]
 *
 * `--config` stellt eine zweite Parametrisierung daneben. Die Datei darf Teile enthalten, etwa
 * `{ "club": { "k": 40 } }` oder `{ "competition": { "domesticCup": 0.7 } }`; der Rest kommt aus
 * `ELO_CONFIG`. Verglichen wird gepaart je Spiel (Log-Loss), mit Standardfehler - ohne den ist
 * ein Unterschied auf diesen Stichproben nicht lesbar. Kein automatisches Durchprobieren.
 */
import { readFileSync } from "node:fs";
import { AnalyzerDatabase } from "../src/database.ts";
import { backtestElo, backtestMetrics, logLossOf, type BacktestGroup, type BacktestPrediction } from "../src/elo-backtest.ts";
import { ELO_CONFIG, type EloConfig } from "../src/elo-config.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const dateOption = (name: string, fallback?: string) => {
  const value = option(name) ?? fallback;
  if (!value) throw new Error(`--${name} JJJJ-MM-TT fehlt.`);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) throw new Error(`--${name}: ungültiges Datum ${value}`);
  return parsed;
};

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return (patch ?? base) as T;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in result)) throw new Error(`Unbekannter Konfigurationsschlüssel: ${key}`);
    result[key] = Array.isArray(value) ? value : deepMerge(result[key], value);
  }
  return result as T;
}

const GROUPS: Array<{ label: string; test: (prediction: BacktestPrediction) => boolean }> = [
  { label: "alle", test: () => true },
  ...(["liga", "pokal", "international", "testspiel", "national"] as BacktestGroup[])
    .map((group) => ({ label: group, test: (prediction: BacktestPrediction) => prediction.group === group }))
];

const f = (value: number, digits = 4) => value.toFixed(digits).replace(".", ",");
const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;

function report(title: string, predictions: BacktestPrediction[]): void {
  console.log(`\n${title}`);
  console.log(`${"Gruppe".padEnd(15)}${"Spiele".padStart(8)}${"LogLoss Elo".padStart(13)}${"Basis".padStart(9)}${"Brier 1X2".padStart(11)}${"Basis".padStart(9)}${"Favorit gewinnt".padStart(17)}${"erwartet".padStart(10)}`);
  for (const group of GROUPS) {
    const selected = predictions.filter(group.test);
    const elo = backtestMetrics(selected);
    const base = backtestMetrics(selected, true);
    if (!elo || !base) continue;
    console.log(`${group.label.padEnd(15)}${String(elo.n).padStart(8)}${f(elo.logLoss).padStart(13)}${f(base.logLoss).padStart(9)}`
      + `${f(elo.brier1x2).padStart(11)}${f(base.brier1x2).padStart(9)}${pct(elo.favoriteWins).padStart(17)}${pct(elo.favoritePredicted).padStart(10)}`);
  }
}

function calibration(predictions: BacktestPrediction[]): void {
  console.log("\nKalibrierung (Erwartungswert Heim gegen tatsächliches Ergebnis, 1 / 0,5 / 0)");
  console.log(`${"Band".padEnd(12)}${"Spiele".padStart(8)}${"erwartet".padStart(10)}${"eingetreten".padStart(13)}`);
  for (let low = 0; low < 1; low += 0.1) {
    const inBand = predictions.filter((prediction) => prediction.expected >= low && prediction.expected < low + 0.1);
    if (inBand.length < 20) continue;
    const mean = (pick: (p: BacktestPrediction) => number) => inBand.reduce((sum, p) => sum + pick(p), 0) / inBand.length;
    console.log(`${`${f(low, 1)}-${f(low + 0.1, 1)}`.padEnd(12)}${String(inBand.length).padStart(8)}${f(mean((p) => p.expected), 3).padStart(10)}${f(mean((p) => p.actual), 3).padStart(13)}`);
  }
}

function main(): void {
  const testStart = dateOption("test-start");
  const testEnd = dateOption("test-end") + 24 * 60 * 60 * 1000;
  const trainStart = option("train-start") ? dateOption("train-start") : 0;
  const stepDays = Number(option("step") ?? 7);
  const minGames = Number(option("min-games") ?? ELO_CONFIG.provisional.games);

  const database = new AnalyzerDatabase();
  const matches = database.eloMatches().filter((match) => match.kickoff >= trainStart);
  database.close();
  if (matches.length === 0) throw new Error("elo_matches ist leer - erst `npm run elo -- import`.");

  const started = Date.now();
  const result = backtestElo(matches, ELO_CONFIG, { testStart, testEnd, stepDays, minGames });
  console.log(`Elo ${ELO_CONFIG.version} · Training bis ${new Date(testStart).toISOString().slice(0, 10)}: ${result.trainGames} Spiele`
    + ` · Test ${new Date(testStart).toISOString().slice(0, 10)} bis ${new Date(testEnd - 1).toISOString().slice(0, 10)}: ${result.predictions.length} Spiele`
    + ` · ${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.log("Basis = nur Heimvorteil (Heim-/Remis-/Auswärtsquote der Trainingsspiele). Kleiner ist besser.");
  report("Alle Testspiele", result.predictions);
  const established = result.predictions.filter((prediction) => prediction.established);
  report(`Nur Spiele, in denen beide Teams schon ${minGames} Spiele hatten`, established);
  calibration(established.filter((prediction) => prediction.system === "club"));

  const configFile = option("config");
  if (configFile) {
    const alternative = deepMerge(ELO_CONFIG, JSON.parse(readFileSync(configFile, "utf8"))) as EloConfig;
    const other = backtestElo(matches, alternative, { testStart, testEnd, stepDays, minGames });
    report(`Datei ${configFile}`, other.predictions);
    const byId = new Map(other.predictions.map((prediction) => [prediction.fixtureId, prediction]));
    console.log(`\nGepaarter Vergleich Datei minus Vorgabe (Log-Loss je Spiel, negativ = Datei besser)`);
    for (const group of GROUPS) {
      const diffs = result.predictions.filter(group.test)
        .map((prediction) => { const twin = byId.get(prediction.fixtureId); return twin ? logLossOf(twin) - logLossOf(prediction) : null; })
        .filter((value): value is number => value !== null);
      if (diffs.length < 30) continue;
      const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
      const sd = Math.sqrt(diffs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (diffs.length - 1));
      console.log(`${group.label.padEnd(15)}${String(diffs.length).padStart(8)}  ${mean >= 0 ? "+" : "−"}${f(Math.abs(mean))} ±${f(sd / Math.sqrt(diffs.length))}`);
    }
  }
}

main();
