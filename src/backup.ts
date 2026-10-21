/**
 * Sicherung der SQLite-Datenbank, am Ende jeder Dashboard-Analyse und von Hand (`npm run backup`).
 *
 * Eine Datei je Berliner Kalendertag (`analyzer-JJJJ-MM-TT.sqlite.gz`); eine spätere Analyse am
 * selben Tag ersetzt sie. Aufbewahrt werden die neuesten `keep` Dateien - gezählt nach Dateien,
 * nicht nach Kalendertagen, damit nach einer Pause von zwei Wochen nicht alles verfällt.
 *
 * Kopiert wird über die Online-Sicherung von SQLite (`backup` aus `node:sqlite`), nicht als Datei:
 * Im WAL-Modus stehen frische Schreibvorgänge noch in `analyzer.sqlite-wal`, eine Dateikopie der
 * Hauptdatei allein wäre unvollständig. Die Kopie wird vor dem Packen mit `quick_check` geprüft;
 * scheitert die Prüfung, bleibt die bisherige Sicherung des Tages stehen und nichts wird gelöscht.
 * Gemessen am 21.10.2026: 835 MB in 2 s gesichert, gepackt 191 MB in 10 s.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { zonedDate } from "./util.ts";

const BACKUP_FILE = /^analyzer-(\d{4}-\d{2}-\d{2})\.sqlite\.gz$/;
const TEMP_SUFFIX = ".tmp";

export interface BackupOptions {
  source: string;
  directory: string;
  keep: number;
  timezone: string;
  now?: Date;
}

export interface BackupResult {
  file: string;
  bytes: number;
  seconds: number;
  kept: number;
  removed: string[];
}

export function backupFileName(day: string): string {
  return `analyzer-${day}.sqlite.gz`;
}

export async function backupDatabase(options: BackupOptions): Promise<BackupResult> {
  const started = Date.now();
  const day = zonedDate(options.now ?? new Date(), options.timezone);
  const target = path.join(options.directory, backupFileName(day));
  const copy = `${target.replace(/\.gz$/, "")}${TEMP_SUFFIX}`;
  const packed = `${target}${TEMP_SUFFIX}`;
  await mkdir(options.directory, { recursive: true });
  try {
    const source = new DatabaseSync(options.source, { readOnly: true });
    try {
      await backup(source, copy);
    } finally {
      source.close();
    }
    // Die Kopie erbt den WAL-Modus. Zurück auf DELETE, damit die Sicherung eine einzelne Datei
    // ist und keine -wal/-shm-Reste liegen bleiben; die Analyse schaltet beim Öffnen wieder um.
    const check = new DatabaseSync(copy);
    try {
      check.exec("PRAGMA journal_mode = DELETE");
      const result = check.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
      if (result?.quick_check !== "ok") {
        throw new Error(`Kopie fehlerhaft (quick_check: ${result?.quick_check ?? "keine Antwort"})`);
      }
    } finally {
      check.close();
    }
    await pipeline(createReadStream(copy), createGzip({ level: 6 }), createWriteStream(packed));
    // Erst die fertige Datei ersetzt die des Tages - bricht der Lauf vorher ab, bleibt sie.
    await rename(packed, target);
  } finally {
    for (const file of [copy, `${copy}-wal`, `${copy}-shm`, packed]) await rm(file, { force: true });
  }
  const removed = await pruneBackups(options.directory, options.keep);
  const kept = (await readdir(options.directory)).filter((name) => BACKUP_FILE.test(name)).length;
  return {
    file: target,
    bytes: (await stat(target)).size,
    seconds: (Date.now() - started) / 1000,
    kept,
    removed
  };
}

export function backupLine(result: BackupResult): string {
  return `Sicherung: ${result.file} (${(result.bytes / 1e6).toFixed(0)} MB, ${result.seconds.toFixed(0)} s)`
    + ` · ${result.kept} aufbewahrt${result.removed.length > 0 ? `, ${result.removed.length} ältere gelöscht` : ""}`;
}

/** Löscht alles außer den neuesten `keep` Sicherungen, dazu Reste abgebrochener Läufe. */
export async function pruneBackups(directory: string, keep: number): Promise<string[]> {
  const names = await readdir(directory);
  const backups = names.filter((name) => BACKUP_FILE.test(name)).sort().reverse();
  const leftovers = names.filter((name) => name.startsWith("analyzer-") && name.endsWith(TEMP_SUFFIX));
  const removed = [...backups.slice(Math.max(1, keep)), ...leftovers];
  for (const name of removed) await rm(path.join(directory, name), { force: true });
  return removed;
}
