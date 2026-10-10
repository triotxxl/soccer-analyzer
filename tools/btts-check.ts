/**
 * Die vorab festgelegte BTTS-Prüfung (Davids Entscheidung vom 06.10.2026, Plan in
 * `docs/btts-pruefung.md`). Weiß das Modell bei BTTS etwas, das nicht schon im Tipico-Preis steht?
 *
 * Alles hier ist **vor** der Messung festgelegt und darf nachträglich nicht geändert werden:
 * - Menge: jedes Spiel mit Anstoß ab 07.10.2026 (Berliner Zeit), dessen letzter Snapshot vor dem
 *   Anpfiff beide BTTS-Quoten führt, gleiche Liga (kein Spiel zwischen verschiedenen Ligen),
 *   belastbare Modellchance, abgerechnet.
 * - Die ersten 2.500 dieser Spiele nach Anstoß, keine weiteren.
 * - Endpunkt: b in logit P(BTTS) = a + logit(fair) + b · (logit Modell − logit fair), robuster
 *   Standardfehler (`src/offset-logit.ts`).
 * - Bestanden, wenn b > 2 · Standardfehler. Keine Teilgruppen, kein zweiter Endpunkt.
 *
 * Bis die 2.500 erreicht sind, nennt das Werkzeug nur die Zahl der Spiele, kein b - wer
 * zwischendurch hinschaut und bei einem günstigen Wert aufhört, misst nichts mehr.
 *
 * `--seit JJJJ-MM-TT` rechnet nur zur Kontrolle des Werkzeugs auf älteren Daten (etwa gegen die
 * Messung der Prüfer vom 06.10.2026: b = 0,37 ± 0,17) und ist kein Prüfergebnis.
 *
 * Aufruf: npm run btts-check [-- --seit 2026-08-16]. Kein API-Aufruf.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../src/config.ts";
import type { DashboardFixture } from "../src/dashboard.ts";
import { fairProbabilityOf } from "../src/fair-price.ts";
import { decideMarket } from "../src/market-outcome.ts";
import { readOutcomes } from "../src/market-profile-service.ts";
import { fitOffsetLogit, logit } from "../src/offset-logit.ts";

const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const START = "2026-10-07T00:00:00+02:00";
const TARGET = 2500;

const sinceIndex = process.argv.indexOf("--seit");
const control = sinceIndex !== -1 && process.argv[sinceIndex + 1] !== undefined;
const start = Date.parse(control ? `${process.argv[sinceIndex + 1]}T00:00:00+02:00` : START);

interface Row { fixtureId: number; kickoff: number; stamp: number; model: number; fair: number }

const latest = new Map<number, Row>();
for (const file of fs.readdirSync(OUTPUT_DIR).filter((name) => /^dashboard-\d{4}-\d{2}-\d{2}.*\.json$/.test(name))) {
  let snapshot: { meta?: { createdAt?: string }; fixtures?: DashboardFixture[] };
  try {
    snapshot = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), "utf8")) as typeof snapshot;
  } catch {
    continue;
  }
  const stamp = Date.parse(snapshot.meta?.createdAt ?? "");
  if (!Number.isFinite(stamp)) continue;
  for (const fixture of snapshot.fixtures ?? []) {
    const kickoff = Date.parse(fixture.kickoff);
    if (kickoff < start || stamp >= kickoff || fixture.crossLeague === true) continue;
    const btts = fixture.markets.find((market) => market.key === "btts");
    if (!btts || btts.probabilityReliable === false || !(btts.probability > 0 && btts.probability < 1)) continue;
    const fair = fairProbabilityOf(fixture, btts);
    if (fair === null || fair.source !== "quote") continue;
    const previous = latest.get(fixture.fixtureId);
    if (previous && previous.stamp >= stamp) continue;
    latest.set(fixture.fixtureId, { fixtureId: fixture.fixtureId, kickoff, stamp, model: btts.probability, fair: fair.probability });
  }
}

const outcomes = readOutcomes();
const settled = [...latest.values()]
  .map((row) => {
    const outcome = outcomes.get(row.fixtureId);
    const won = outcome === undefined ? null : decideMarket("btts", "", outcome);
    return won === null ? null : { ...row, y: (won ? 1 : 0) as 0 | 1 };
  })
  .filter((row): row is Row & { y: 0 | 1 } => row !== null)
  .sort((left, right) => left.kickoff - right.kickoff);

console.log(control
  ? `BTTS-Prüfung - nur Kontrolle des Werkzeugs ab ${process.argv[sinceIndex + 1]}, kein Prüfergebnis`
  : "BTTS-Prüfung (vorab festgelegt, docs/btts-pruefung.md)");

if (!control && settled.length < TARGET) {
  console.log(`  ${settled.length.toLocaleString("de-DE")} von ${TARGET.toLocaleString("de-DE")} Spielen abgerechnet`
    + ` - noch ${(TARGET - settled.length).toLocaleString("de-DE")}. Kein Zwischenstand, siehe Plan.`);
  process.exit(0);
}

const sample = control ? settled : settled.slice(0, TARGET);
const result = fitOffsetLogit(sample.map((row) => ({
  y: row.y,
  offset: logit(row.fair),
  x: logit(row.model) - logit(row.fair)
})));
const hit = sample.reduce((sum, row) => sum + row.y, 0) / sample.length;
const fair = sample.reduce((sum, row) => sum + row.fair, 0) / sample.length;
const model = sample.reduce((sum, row) => sum + row.model, 0) / sample.length;
const fmt = (value: number, digits = 3) => value.toFixed(digits).replace(".", ",");

console.log(`  Spiele ${sample.length} · BTTS eingetreten ${fmt(hit * 100, 1)} % · fair ${fmt(fair * 100, 1)} % · Modell ${fmt(model * 100, 1)} %`);
console.log(`  b = ${fmt(result.slope)} ± ${fmt(result.slopeSe)} (a = ${fmt(result.intercept)})`);
if (!control) {
  console.log(result.slope > 2 * result.slopeSe
    ? "  Bestanden: Das Modell trägt bei BTTS Information über den Tipico-Preis hinaus."
    : "  Nicht bestanden: Kein Beleg, dass das Modell bei BTTS mehr weiß als der Tipico-Preis.");
}
