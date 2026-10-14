/**
 * Ergänzt einen vorhandenen Dashboard-Lauf um die Tipico-Namen (`DashboardFixture.tipico`,
 * schemaVersion 8), ohne die Analyse zu wiederholen. Kein API-Aufruf.
 *
 *   npm run add-tipico-names -- [--input data.json] [--snapshot output/dashboard-latest.json]
 *
 * Teams kommen aus `tipico_fixtures` (die Zuordnung, die die Analyse gespeichert hat), Land und
 * Liga aus `SELECTION.sportCompetitionMap.soccer` der angegebenen data.json - bewusst nicht über
 * `importTipicoData`, das nach Datum filtert und angepfiffene Spiele nach 200 Minuten abschneidet.
 * Geschrieben wird `dashboard-latest.json` und der datierte Snapshot mit gleichem
 * `meta.createdAt`, damit Marktprofil und Rückrechnung dasselbe sehen.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "../src/config.ts";
import type { DashboardDocument } from "../src/dashboard.ts";
import { AnalyzerDatabase } from "../src/database.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const outputDirectory = path.join(ROOT_DIR, "output");
const latestFile = path.resolve(option("snapshot") ?? path.join(outputDirectory, "dashboard-latest.json"));
const inputFile = path.resolve(option("input") ?? path.join(ROOT_DIR, "data.json"));

const tipico = JSON.parse(await readFile(inputFile, "utf8")) as {
  SELECTION?: { sportCompetitionMap?: { soccer?: Array<{ groupId: number; name: string; parentName: string }> } };
};
const competitions = new Map((tipico.SELECTION?.sportCompetitionMap?.soccer ?? [])
  .map((item) => [item.groupId, { country: item.parentName.trim(), league: item.name.trim() }]));

const latest = JSON.parse(await readFile(latestFile, "utf8")) as DashboardDocument;
const database = new AnalyzerDatabase();
const events = database.tipicoEventsForFixtures(latest.fixtures.map((fixture) => fixture.fixtureId));
database.close();

let named = 0;
let withoutCompetition = 0;
const enrich = (document: DashboardDocument): DashboardDocument => ({
  ...document,
  schemaVersion: 8,
  fixtures: document.fixtures.map((fixture) => {
    const event = events.get(fixture.fixtureId);
    const competition = event ? competitions.get(event.competitionId) : undefined;
    if (!event || !competition) return fixture;
    return { ...fixture, tipico: { homeTeam: event.homeTeam, awayTeam: event.awayTeam, ...competition } };
  })
});

const enriched = enrich(latest);
for (const fixture of enriched.fixtures) {
  if (fixture.tipico) named += 1;
  else if (events.has(fixture.fixtureId)) withoutCompetition += 1;
}
await writeFile(latestFile, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
console.log(`${path.basename(latestFile)}: ${named} von ${enriched.fixtures.length} Spielen mit Tipico-Namen`
  + (withoutCompetition > 0 ? ` · ${withoutCompetition} ohne Wettbewerb in ${path.basename(inputFile)}` : ""));

// Der datierte Snapshot derselben Analyse.
const stamp = latest.meta.createdAt.replace(/[:.]/g, "-");
const dated = (await readdir(outputDirectory)).find((name) => name === `dashboard-${stamp}.json`);
if (dated) {
  const file = path.join(outputDirectory, dated);
  const document = JSON.parse(await readFile(file, "utf8")) as DashboardDocument;
  await writeFile(file, `${JSON.stringify(enrich(document), null, 2)}\n`, "utf8");
  console.log(`${dated}: ergänzt`);
} else {
  console.log(`Kein datierter Snapshot zu ${latest.meta.createdAt} gefunden - nur ${path.basename(latestFile)} ergänzt.`);
}
