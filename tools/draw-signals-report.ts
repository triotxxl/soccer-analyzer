/**
 * Rückrechnung des Remis-Scores (`src/draw-signals.ts`) an den eigenen abgerechneten Spielen.
 *
 * Die Frage ist nicht nur „trifft ein hoher Score öfter?", sondern **„weiß er etwas, das
 * `p(Remis)` nicht schon weiß?"**. Das Poisson-Modell rechnet die Remiswahrscheinlichkeit aus
 * Torerwartungen, und viele Ausgeglichenheits-Kriterien stecken dort bereits drin. Deshalb
 * misst der Report jedes Kriterium zusätzlich **innerhalb** gleicher p(Remis)-Bänder: Ein
 * Kriterium, das nur im Ganzen trennt, aber innerhalb der Bänder nicht, wiederholt das Modell.
 *
 * Grundlage: je Partie der jüngste archivierte Snapshot (`output/dashboard-*.json`), die
 * Ergebnisse aus `goal_line_predictions`, die Vorspiel-Statistik aus `fixture_results`.
 * Kostet kein API-Budget.
 *
 * **Kein automatisches Durchprobieren von Gewichten.** Wer eine andere Gewichtung prüfen will,
 * schreibt sie in eine Datei und vergleicht sie mit `--config`. Schwellen, die auf denselben
 * Daten gesucht wurden, gegen die gemessen wird, belegen nichts (AGENTS.md).
 *
 * Aufruf:
 *   npm run draw-signals-report
 *   npm run draw-signals-report -- --config meine-gewichte.json
 *
 * Die Datei darf Teile der Konfiguration enthalten, etwa
 *   { "rules": { "h2hDraws": { "weight": 5 } } }
 * - fehlende Felder kommen aus `DRAW_SIGNAL_CONFIG`.
 */
import fs from "node:fs";
import type { DashboardFixture } from "../src/dashboard.ts";
import {
  DRAW_SIGNAL_CONFIG,
  DRAW_SIGNAL_META,
  scoreDrawSignals,
  type DrawSignalConfig,
  type DrawSignalId,
  type DrawSignalResult
} from "../src/draw-signals.ts";
import { DEFAULT_REMIS_SCORE_SETTINGS } from "../src/quickpick-remisscore.ts";
import { enrichWithMatchStats, readFixtures, readOutcomes } from "./snapshot-history.ts";

interface Row {
  fixture: DashboardFixture;
  draw: boolean;
  /** Remiswahrscheinlichkeit des Modells, falls der Lauf den Markt führt. */
  pDraw: number | null;
  kickoff: number;
  signals: DrawSignalResult;
  alternative: DrawSignalResult | null;
}

const BANDS: Array<{ label: string; test: (p: number) => boolean }> = [
  { label: "p<0,25", test: (p) => p < 0.25 },
  { label: "0,25-0,30", test: (p) => p >= 0.25 && p < 0.3 },
  { label: "p>=0,30", test: (p) => p >= 0.3 }
];

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits).replace(".", ",")} %`;
const pp = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1).replace(".", ",")}`;
const pad = (value: string, width: number) => value.padEnd(width);
const lpad = (value: string, width: number) => value.padStart(width);

function rate(rows: Row[]): number {
  return rows.length === 0 ? 0 : rows.filter((row) => row.draw).length / rows.length;
}

/** Unterschied zweier Anteile mit Standardfehler. */
function difference(hit: Row[], miss: Row[]): { diff: number; se: number } | null {
  if (hit.length < 10 || miss.length < 10) return null;
  const a = rate(hit);
  const b = rate(miss);
  return { diff: a - b, se: Math.sqrt(a * (1 - a) / hit.length + b * (1 - b) / miss.length) };
}

function formatDiff(value: { diff: number; se: number } | null): string {
  if (value === null) return "zu wenige";
  return `${pp(value.diff)} ±${(value.se * 100).toFixed(1).replace(".", ",")}`;
}

function mergeConfig(partial: Partial<DrawSignalConfig> & { rules?: Partial<Record<DrawSignalId, Partial<DrawSignalConfig["rules"][DrawSignalId]>>> }): DrawSignalConfig {
  const rules = { ...DRAW_SIGNAL_CONFIG.rules };
  for (const [id, rule] of Object.entries(partial.rules ?? {}) as Array<[DrawSignalId, Partial<DrawSignalConfig["rules"][DrawSignalId]>]>) {
    if (!(id in rules)) throw new Error(`Unbekanntes Kriterium in der Konfiguration: ${id}`);
    rules[id] = { ...rules[id], ...rule };
  }
  return {
    version: partial.version ?? `${DRAW_SIGNAL_CONFIG.version}+datei`,
    opponentStrengthTolerance: partial.opponentStrengthTolerance ?? DRAW_SIGNAL_CONFIG.opponentStrengthTolerance,
    rules
  };
}

function main(): void {
  const configIndex = process.argv.indexOf("--config");
  const alternativeConfig = configIndex >= 0
    ? mergeConfig(JSON.parse(fs.readFileSync(process.argv[configIndex + 1] ?? "", "utf8")))
    : null;

  const outcomes = readOutcomes();
  const fixtures = readFixtures();
  const coverage = enrichWithMatchStats(fixtures);

  const rows: Row[] = [];
  for (const fixture of fixtures) {
    const outcome = outcomes.get(fixture.fixtureId);
    if (!outcome) continue;
    const pDraw = fixture.markets?.find((market) => market.key === "draw")?.probability ?? null;
    rows.push({
      fixture,
      draw: outcome.home === outcome.away,
      pDraw: typeof pDraw === "number" ? pDraw : null,
      kickoff: Date.parse(fixture.kickoff),
      signals: scoreDrawSignals(fixture),
      alternative: alternativeConfig ? scoreDrawSignals(fixture, alternativeConfig) : null
    });
  }
  if (rows.length === 0) throw new Error("Keine abgerechnete Partie im Snapshot-Bestand.");
  rows.sort((left, right) => left.kickoff - right.kickoff);

  const base = rate(rows);
  console.log(`Remis-Score ${DRAW_SIGNAL_CONFIG.version} - Rückrechnung über ${rows.length} abgerechnete Spiele`);
  console.log(`Basisrate Remis: ${pct(base)} · Vorspiele/Duelle mit Statistik: ${coverage.enriched} von ${coverage.matches}`);
  console.log("Die Gewichte sind gesetzt, nicht gemessen. \"Unterschied\" = Remisquote greift minus greift nicht, in Prozentpunkten ± Standardfehler.");

  // --- Je Kriterium ----------------------------------------------------------------------
  console.log("\nJe Kriterium (greift = Teil- oder volle Punkte; Gewicht 0 = nur beobachtet)");
  console.log(`${pad("Kriterium", 44)}${lpad("Gew.", 5)}${lpad("bewertbar", 13)}${lpad("greift", 8)}${lpad("Remis greift", 14)}${lpad("sonst", 9)}  ${pad("Unterschied", 14)}${BANDS.map((band) => pad(band.label, 17)).join("")}`);
  for (const meta of DRAW_SIGNAL_META) {
    const evaluable = rows.filter((row) => row.signals.criteria.find((entry) => entry.id === meta.id)!.evaluable);
    const hit = evaluable.filter((row) => row.signals.criteria.find((entry) => entry.id === meta.id)!.level > 0);
    const miss = evaluable.filter((row) => row.signals.criteria.find((entry) => entry.id === meta.id)!.level === 0);
    const bands = BANDS.map((band) => {
      const inBand = (list: Row[]) => list.filter((row) => row.pDraw !== null && band.test(row.pDraw));
      return formatDiff(difference(inBand(hit), inBand(miss)));
    });
    console.log(
      `${pad(meta.label.slice(0, 43), 44)}${lpad(String(DRAW_SIGNAL_CONFIG.rules[meta.id].weight), 5)}`
      + `${lpad(`${evaluable.length} (${Math.round(evaluable.length / rows.length * 100)}%)`, 13)}`
      + `${lpad(String(hit.length), 8)}${lpad(hit.length ? pct(rate(hit)) : "–", 14)}${lpad(miss.length ? pct(rate(miss)) : "–", 9)}  `
      + `${pad(formatDiff(difference(hit, miss)), 14)}${bands.map((value) => pad(value, 17)).join("")}`
    );
  }

  // --- Nach Score ------------------------------------------------------------------------
  const minEvaluable = DEFAULT_REMIS_SCORE_SETTINGS.minEvaluable;
  const usable = rows.filter((row) => row.signals.evaluableMax >= minEvaluable);
  console.log(`\nNach Score (nur Spiele mit mindestens ${minEvaluable} bewertbaren Punkten: ${usable.length})`);
  console.log(`${pad("Score", 10)}${lpad("Spiele", 8)}${lpad("Remis", 10)}${lpad("Ø p(Remis)", 12)}`);
  const buckets: Array<[number, number]> = [[0, 6], [6, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 26]];
  for (const [low, high] of buckets) {
    const inBucket = usable.filter((row) => row.signals.score >= low && row.signals.score < high);
    const withP = inBucket.filter((row) => row.pDraw !== null);
    const meanP = withP.length ? withP.reduce((sum, row) => sum + row.pDraw!, 0) / withP.length : null;
    console.log(`${pad(high >= 26 ? `${low}+` : `${low}-${high - 1}`, 10)}${lpad(String(inBucket.length), 8)}`
      + `${lpad(inBucket.length ? pct(rate(inBucket)) : "–", 10)}${lpad(meanP === null ? "–" : pct(meanP), 12)}`);
  }

  // --- Stufen gegen die bestehenden Maßstäbe -------------------------------------------
  const half = rows[Math.floor(rows.length / 2)]!.kickoff;
  console.log("\nStufen des Filters gegen bestehende Maßstäbe (1. / 2. Zeithälfte)");
  console.log(`${pad("Auswahl", 34)}${lpad("Spiele", 8)}${lpad("Remis", 10)}${lpad("Ø p(Remis)", 12)}${lpad("1. Hälfte", 12)}${lpad("2. Hälfte", 12)}`);
  const line = (label: string, selected: Row[]) => {
    const withP = selected.filter((row) => row.pDraw !== null);
    const meanP = withP.length ? withP.reduce((sum, row) => sum + row.pDraw!, 0) / withP.length : null;
    const first = selected.filter((row) => row.kickoff < half);
    const second = selected.filter((row) => row.kickoff >= half);
    console.log(`${pad(label, 34)}${lpad(String(selected.length), 8)}${lpad(selected.length ? pct(rate(selected)) : "–", 10)}`
      + `${lpad(meanP === null ? "–" : pct(meanP), 12)}${lpad(first.length ? pct(rate(first)) : "–", 12)}${lpad(second.length ? pct(rate(second)) : "–", 12)}`);
  };
  line("alle Spiele", rows);
  for (const minScore of [16, 14, 12, 10]) {
    line(`Remis-Score ab ${minScore}`, usable.filter((row) => row.signals.score >= minScore));
  }
  line("p(Remis) ab 0,30 (Modell)", rows.filter((row) => row.pDraw !== null && row.pDraw >= 0.3));
  line("scores.draw ab 50 (100-Punkte)", rows.filter((row) => (row.fixture.scores?.draw ?? -1) >= 50));
  line("Score ab 14 UND p(Remis) ab 0,30", usable.filter((row) => row.signals.score >= 14 && row.pDraw !== null && row.pDraw >= 0.3));

  // --- Alternative Gewichtung ------------------------------------------------------------
  if (alternativeConfig) {
    const threshold = DEFAULT_REMIS_SCORE_SETTINGS.minScore;
    const pickA = (row: Row) => row.signals.evaluableMax >= minEvaluable && row.signals.score >= threshold;
    const pickB = (row: Row) => row.alternative!.evaluableMax >= minEvaluable && row.alternative!.score >= threshold;
    const onlyA = rows.filter((row) => pickA(row) && !pickB(row));
    const onlyB = rows.filter((row) => !pickA(row) && pickB(row));
    console.log(`\nVergleich mit ${alternativeConfig.version} (Schwelle ${threshold}, nur Spiele, in denen sich beide unterscheiden)`);
    line("beide wählen", rows.filter((row) => pickA(row) && pickB(row)));
    line("nur Vorgabe", onlyA);
    line("nur Datei", onlyB);
    console.log(`Max. Punkte: Vorgabe ${rows[0]!.signals.max}, Datei ${rows[0]!.alternative!.max} - bei anderem Maximum ist die Schwelle nicht vergleichbar.`);
  }

  console.log("\nLesehilfe: Ein Kriterium trägt nur, wenn es auch INNERHALB der p(Remis)-Bänder trennt."
    + " Trennt es nur im Ganzen, weiß es nichts, was das Modell nicht schon weiß.");
}

main();
