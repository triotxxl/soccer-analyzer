/**
 * Datenbank aus einer Sicherung einspielen - etwa auf einem neuen PC (AGENTS.md, „Neuer PC“).
 *
 *   npm run restore                    neueste Sicherung bei MEGA, ohne MEGA-Zugang die neueste
 *                                      in data/backups/ (bzw. BACKUP_DIR)
 *   npm run restore -- --file <pfad>   eine bestimmte Datei analyzer-JJJJ-MM-TT.sqlite.gz
 *   npm run restore -- --force         eine vorhandene Datenbank ersetzen (wird beiseitegelegt)
 *
 * Kostet kein API-Budget. App und Analysen müssen beendet sein.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BACKUP_FILE } from "../src/backup.ts";
import { config, DB_FILE } from "../src/config.ts";
import { newestRemoteBackup } from "../src/remote-backup.ts";
import { restoreDatabase } from "../src/restore.ts";

const args = process.argv.slice(2);
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : undefined;
const force = args.includes("--force");

async function source(): Promise<{ label: string; data: Buffer }> {
  if (fileArg) {
    const file = path.resolve(fileArg);
    return { label: file, data: await readFile(file) };
  }
  if (config.mega) {
    const { openMegaStore } = await import("../src/mega-store.ts");
    const store = await openMegaStore(config.mega);
    try {
      const newest = await newestRemoteBackup(store);
      if (!newest) throw new Error(`Keine Sicherung bei MEGA/${config.mega.folder}.`);
      console.log(`Lade ${newest.name} von MEGA/${config.mega.folder} (${(newest.bytes / 1e6).toFixed(0)} MB) …`);
      return { label: `MEGA/${config.mega.folder}/${newest.name}`, data: await store.download(newest.id) };
    } finally {
      await store.close();
    }
  }
  const names = (await readdir(config.backupDir).catch(() => [] as string[])).filter((name) => BACKUP_FILE.test(name)).sort();
  const newest = names.at(-1);
  if (!newest) {
    throw new Error(`Keine Sicherung in ${config.backupDir} und kein MEGA-Zugang in .env (MEGA_EMAIL, MEGA_PASSWORD).`);
  }
  const file = path.join(config.backupDir, newest);
  return { label: file, data: await readFile(file) };
}

try {
  const { label, data } = await source();
  const result = await restoreDatabase(data, DB_FILE, { force });
  console.log(`Eingespielt: ${label} -> ${result.target} (${(result.bytes / 1e6).toFixed(0)} MB)`);
  if (result.setAside) console.log(`Die bisherige Datenbank liegt unter ${result.setAside}.`);
  console.log("Der API-Cache (data/cache/) ist nicht in der Sicherung; er füllt sich mit den nächsten Analysen.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
