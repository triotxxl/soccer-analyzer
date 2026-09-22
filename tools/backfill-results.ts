import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "../src/config.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import { toFixtureResult, type FixtureResult } from "../src/fixture-result.ts";
import type { ApiFixture } from "../src/types.ts";
import { sha256 } from "../src/util.ts";

/**
 * Trägt die Ergebnisdaten bereits abgerechneter Partien nach - ausschließlich aus dem lokalen
 * Antwort-Cache. Dieses Werkzeug importiert den API-Client bewusst nicht und kann deshalb gar
 * keine Anfrage auslösen; es braucht auch keinen Schlüssel.
 *
 * Möglich ist das, weil `src/api.ts` jede erfolgreiche Antwort auf Platte schreibt, auch wenn
 * der Lesezugriff übersprungen wurde. Für jede je abgerechnete Partie liegt deshalb die
 * Antwort von `fixtures?id=<id>` vor - samt Ereignissen, Aufstellungen und Spielerwerten.
 *
 * Aufruf:
 *   node tools/backfill-results.ts            nur die gezielt auffindbaren Dateien
 *   node tools/backfill-results.ts --scan     zusätzlich alle Cache-Dateien durchsehen
 *   node tools/backfill-results.ts --limit 50 --dry-run
 */

const args = process.argv.slice(2);
const scan = args.includes("--scan");
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : null;
if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error("--limit muss eine ganze Zahl ab 1 sein.");
}

/**
 * Die Cache-Datei zu einem Schlüssel. Der Schlüssel entsteht in `src/api.ts` als
 * `endpunkt?sortierte-parameter`; für `getFixture(id)` ist das genau `fixtures?id=<id>`.
 */
function cacheFile(key: string): string {
  return path.join(CACHE_DIR, `${sha256(key)}.json`);
}

/**
 * Liest eine Cache-Datei direkt, ohne `FileCache`. Absicht: `FileCache.get` verwirft Einträge
 * anhand der Gültigkeitsdauer - eine beendete Partie veraltet aber nicht, ihr Ergebnis steht
 * fest. Der Zeitstempel wird deshalb ignoriert.
 */
function readCache(file: string): unknown[] | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const value = (JSON.parse(raw) as { value?: unknown }).value;
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Führt mehrere Kopien derselben Partie zusammen. Eine einzelne beste Kopie zu wählen reicht
 * nicht: Der Cache enthält dieselbe Partie mehrfach aus verschiedenen Abrufen, und die eine
 * trägt die Ereignisse, die andere die Spielzahlen. Gemessen am 22.09.2026 lagen so für 8.114
 * Partien Ereignisse vor, für 6.635 Spielzahlen - eine Kopie mit beidem gibt es oft nicht.
 *
 * Je Feld gewinnt die längste Liste. Die Grunddaten stammen aus der ersten gefundenen Kopie;
 * Endstand und Mannschaften sind in allen gleich.
 */
function merge(into: ApiFixture, from: ApiFixture): ApiFixture {
  const longer = <T>(left: T[] | undefined, right: T[] | undefined): T[] | undefined => {
    if (!right?.length) return left;
    if (!left?.length) return right;
    return right.length > left.length ? right : left;
  };
  return {
    ...into,
    events: longer(into.events, from.events),
    statistics: longer(into.statistics, from.statistics),
    lineups: longer(into.lineups, from.lineups),
    players: longer(into.players, from.players)
  };
}

const database = new AnalyzerDatabase();
try {
  const settled = database.settledFixtureIds();
  const wanted = new Set(limit === null ? settled : settled.slice(0, limit));
  console.log(`${wanted.size} abgerechnete Spiele werden gesucht.`);

  const best = new Map<number, ApiFixture>();
  const consider = (candidate: unknown): void => {
    const fixture = candidate as ApiFixture;
    const id = fixture?.fixture?.id;
    if (typeof id !== "number" || !wanted.has(id)) return;
    const previous = best.get(id);
    best.set(id, previous ? merge(previous, fixture) : fixture);
  };

  // Weg A: der Dateiname lässt sich je Spiel direkt ausrechnen.
  for (const id of wanted) {
    for (const entry of readCache(cacheFile(`fixtures?id=${id}`)) ?? []) consider(entry);
  }
  console.log(`Gezielt gefunden: ${best.size} Spiele.`);

  // Weg B: Der volle Durchgang findet reichere Kopien, etwa aus den Bündeln der
  // Detailansicht. Gemessen am 22.09.2026 hob das die Statistik von 3.667 auf 6.635 Spiele.
  if (scan) {
    const files = readdirSync(CACHE_DIR);
    console.log(`Voller Durchgang über ${files.length} Cache-Dateien ...`);
    let seen = 0;
    for (const name of files) {
      seen += 1;
      if (seen % 10_000 === 0) console.log(`  ${seen} von ${files.length} Dateien gelesen.`);
      let raw: string;
      try {
        raw = readFileSync(path.join(CACHE_DIR, name), "utf8");
      } catch {
        continue;
      }
      // Billiger Vorfilter vor dem Auswerten: spart bei 2,2 GB spürbar Zeit.
      if (!raw.includes('"fixture"')) continue;
      let value: unknown;
      try {
        value = (JSON.parse(raw) as { value?: unknown }).value;
      } catch {
        continue;
      }
      if (!Array.isArray(value)) continue;
      for (const entry of value) consider(entry);
    }
  }

  const results: FixtureResult[] = [];
  let ohneErgebnis = 0;
  for (const entry of best.values()) {
    const result = toFixtureResult(entry, { source: "cache" });
    if (result) results.push(result); else ohneErgebnis += 1;
  }

  if (!dryRun) {
    for (let offset = 0; offset < results.length; offset += 200) {
      database.saveFixtureResults(results.slice(offset, offset + 200));
    }
  }

  const zaehle = (pruefe: (row: FixtureResult) => boolean) => results.filter(pruefe).length;
  console.log("");
  console.log(`${wanted.size} Spiele geprüft, ${results.length} ${dryRun ? "lesbar" : "gespeichert"}.`);
  console.log(`Mit Torminuten: ${zaehle((row) => row.eventsAvailable)}.`);
  console.log(`Davon ohne Lücke: ${zaehle((row) => row.goalsComplete)}.`);
  console.log(`Mit Spielzahlen: ${zaehle((row) => row.statsAvailable)}.`);
  console.log(`Mit Aufstellung: ${zaehle((row) => row.lineupsAvailable)}.`);
  console.log(`Mit Spielerwerten: ${zaehle((row) => row.playersAvailable)}.`);
  if (wanted.size - best.size > 0) {
    console.log(`Nicht im Cache: ${wanted.size - best.size} Spiele.`);
  }
  if (ohneErgebnis > 0) console.log(`Ohne verwertbaren Endstand: ${ohneErgebnis} Spiele.`);
  console.log("Es wurden keine Daten aus dem Internet geholt.");
  if (dryRun) console.log("Probelauf - es wurde nichts gespeichert.");
} finally {
  database.close();
}
