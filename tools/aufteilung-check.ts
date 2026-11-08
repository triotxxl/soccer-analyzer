/**
 * Die vorab festgelegte Prüfung der Elo-Aufteilung (Davids Entscheidung vom 04.11.2026, Plan in
 * `docs/aufteilung-zwischen-ligen.md`). Sagt das Modell Vereinsspiele zwischen Ligen besser voraus,
 * wenn die Tore nach Elo und Faktor statt nach Teamform verteilt werden?
 *
 * Alles hier ist **vor** der Messung festgelegt und darf nachträglich nicht geändert werden:
 * - Menge: jedes Vereinsspiel zwischen Ligen mit Anstoß ab 05.11.2026 (Berliner Zeit), dessen letzter
 *   Snapshot vor dem Anpfiff Modell ab 3.8.0, belastbares 1X2, Faktor aus Ligastärke oder Liga-Niveau
 *   und Vereins-Elo beider Teams trägt, abgerechnet.
 * - Die ersten 400 dieser Spiele nach Anstoß, keine weiteren.
 * - Endpunkt: mittlerer Unterschied im 1X2-Log-Loss je Spiel, Elo-Aufteilung minus Modell.
 * - Bestanden, wenn der Unterschied < −2 · Standardfehler. Keine Teilgruppen, kein zweiter Endpunkt.
 *
 * Bis die 400 erreicht sind, nennt das Werkzeug nur die Zahl der Spiele - wer zwischendurch hinschaut
 * und bei einem günstigen Wert aufhört, misst nichts mehr.
 *
 * `--seit JJJJ-MM-TT` rechnet nur zur Kontrolle des Werkzeugs auf älteren Daten, ohne die Grenze bei
 * der Modellversion, und ist kein Prüfergebnis.
 *
 * Aufruf: npm run aufteilung-check [-- --seit 2026-09-28]. Kein API-Aufruf.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../src/config.ts";
import type { DashboardFixture } from "../src/dashboard.ts";
import { compareModelVersions } from "../src/database.ts";
import { eloSplitGoals, meanWithError, outcomeLogLoss } from "../src/elo-split.ts";
import { readOutcomes } from "../src/market-profile-service.ts";

const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const START = "2026-11-05T00:00:00+01:00";
const MIN_MODEL = "3.8.0";
const TARGET = 400;

const sinceIndex = process.argv.indexOf("--seit");
const control = sinceIndex !== -1 && process.argv[sinceIndex + 1] !== undefined;
const start = Date.parse(control ? `${process.argv[sinceIndex + 1]}T00:00:00+01:00` : START);

interface Row { fixtureId: number; kickoff: number; stamp: number; home: number; away: number; eloDiff: number; factor: number }

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
    if (kickoff < start || stamp >= kickoff || fixture.crossLeague !== true) continue;
    if (!control && compareModelVersions(fixture.modelVersion, MIN_MODEL) < 0) continue;
    const source = fixture.strength?.source ?? "league";
    if (!fixture.strength || (source !== "league" && source !== "eloLevel")) continue;
    if (fixture.markets.find((market) => market.key === "1x2")?.probabilityReliable === false) continue;
    const { homeElo, awayElo } = fixture;
    if (homeElo?.system !== "club" || awayElo?.system !== "club") continue;
    const previous = latest.get(fixture.fixtureId);
    if (previous && previous.stamp >= stamp) continue;
    latest.set(fixture.fixtureId, {
      fixtureId: fixture.fixtureId, kickoff, stamp, home: fixture.expectedGoals.home, away: fixture.expectedGoals.away,
      eloDiff: homeElo.elo - awayElo.elo, factor: fixture.strength.factor
    });
  }
}

const outcomes = readOutcomes();
const settled = [...latest.values()]
  .map((row) => {
    const outcome = outcomes.get(row.fixtureId);
    return outcome ? { ...row, homeGoals: outcome.homeGoals, awayGoals: outcome.awayGoals } : null;
  })
  .filter((row) => row !== null)
  .sort((left, right) => left.kickoff - right.kickoff);

console.log(control
  ? `Elo-Aufteilung - nur Kontrolle des Werkzeugs ab ${process.argv[sinceIndex + 1]}, kein Prüfergebnis`
  : "Elo-Aufteilung (vorab festgelegt, docs/aufteilung-zwischen-ligen.md)");

if (!control && settled.length < TARGET) {
  console.log(`  ${settled.length} von ${TARGET} Spielen abgerechnet - noch ${TARGET - settled.length}. Kein Zwischenstand, siehe Plan.`);
  process.exit(0);
}

const sample = control ? settled : settled.slice(0, TARGET);
const differences = sample.map((row) => {
  const split = eloSplitGoals(row.home + row.away, row.eloDiff, row.factor);
  return outcomeLogLoss(split.home, split.away, row.homeGoals, row.awayGoals)
    - outcomeLogLoss(row.home, row.away, row.homeGoals, row.awayGoals);
});
const { mean, error } = meanWithError(differences);
const fmt = (value: number) => value.toFixed(4).replace(".", ",");

console.log(`  Spiele ${sample.length} · Unterschied im 1X2-Log-Loss ${fmt(mean)} ± ${fmt(error)} (negativ = Elo-Aufteilung besser)`);
if (!control) {
  console.log(mean < -2 * error
    ? "  Bestanden: Die Elo-Aufteilung sagt diese Spiele besser voraus als das Modell. David entscheidet, ob sie kommt."
    : "  Nicht bestanden: Kein Beleg, dass die Elo-Aufteilung besser ist. Das Modell bleibt.");
}
