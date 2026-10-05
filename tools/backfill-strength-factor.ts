/**
 * Trägt `goal_line_predictions.strength_factor` für Prognosen nach, die vor dem 05.10.2026
 * gespeichert wurden. Quelle ist das Feld `strength.factor` der archivierten Snapshots
 * (`output/dashboard-*.json`, vorhanden ab Modellversion 3.1.0).
 *
 *   node tools/backfill-strength-factor.ts
 *
 * Maßgeblich ist der Snapshot, aus dem die Prognose stammt: `snapshot_at` der Zeile ist
 * `meta.createdAt` des Laufs. Dieser Wert überschreibt einen vorhandenen. Fehlt die Datei, gilt
 * der jüngste Snapshot davor - dann nur, wo die Spalte leer ist. Die erste Fassung (05.10.2026)
 * nahm den jüngsten Snapshot vor Anpfiff und traf damit bei Prognosen, die wegen eines
 * Textvergleichs nach Anpfiff gespeichert wurden, den falschen (Prüfung vom selben Tag: ein
 * Faktor mit falschem Vorzeichen, 9 fehlende). Kein API-Aufruf.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "../src/config.ts";
import type { DashboardDocument } from "../src/dashboard.ts";
import { AnalyzerDatabase } from "../src/database.ts";

const outputDirectory = path.join(ROOT_DIR, "output");
const files = (await readdir(outputDirectory))
  .filter((name) => /^dashboard-\d{4}-.*\.json$/.test(name))
  .sort();
// Je Snapshot-Zeitpunkt: fixtureId|modelVersion -> Faktor (null = Snapshot ohne Faktor).
const snapshots: Array<{ createdAt: number; factors: Map<string, number | null> }> = [];
for (const name of files) {
  const document = JSON.parse(await readFile(path.join(outputDirectory, name), "utf8")) as DashboardDocument;
  const factors = new Map<string, number | null>();
  for (const fixture of document.fixtures) {
    const factor = fixture.strength?.factor;
    factors.set(`${fixture.fixtureId}|${fixture.modelVersion}`, Number.isFinite(factor) ? factor! : null);
  }
  snapshots.push({ createdAt: Date.parse(document.meta.createdAt), factors });
}
snapshots.sort((left, right) => left.createdAt - right.createdAt);
const byTime = new Map(snapshots.map((snapshot) => [snapshot.createdAt, snapshot]));

const database = new AnalyzerDatabase();
try {
  let exact = 0;
  let fallback = 0;
  let changed = 0;
  for (const row of database.strengthFactorRows()) {
    const key = `${row.fixtureId}|${row.modelVersion}`;
    const at = Date.parse(row.snapshotAt);
    const own = byTime.get(at);
    if (own) {
      const factor = own.factors.get(key);
      if (factor === undefined || factor === null) continue;
      exact += 1;
      if (database.backfillStrengthFactor(row.fixtureId, row.modelVersion, factor, true)) changed += 1;
      continue;
    }
    if (row.strengthFactor !== null) continue;
    const earlier = snapshots.filter((snapshot) => snapshot.createdAt <= at && snapshot.factors.has(key)).at(-1);
    const factor = earlier?.factors.get(key);
    if (factor === undefined || factor === null) continue;
    fallback += 1;
    if (database.backfillStrengthFactor(row.fixtureId, row.modelVersion, factor)) changed += 1;
  }
  console.log(`${files.length} Snapshots · ${exact} Prognosen über ihren eigenen Snapshot, ${fallback} über einen früheren · ${changed} geändert.`);
} finally {
  database.close();
}
