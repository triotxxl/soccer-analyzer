/**
 * Ein Sicherungsdurchgang, wie ihn die Dashboard-Analyse am Ende und `npm run backup` fahren:
 * lokal schreiben, dann - wenn der MEGA-Zugang in `.env` steht - hochladen. Scheitert das
 * Hochladen, bleibt die lokale Sicherung; die nächste Analyse lädt ihre eigene hoch.
 *
 * Danach die Analyse-Stände aus `output/` (`src/snapshot-sync.ts`) in `MEGA_FOLDER/snapshots` -
 * auch wenn die Datenbank-Sicherung scheiterte, sie hängen nicht von ihr ab.
 */
import path from "node:path";
import { backupDatabase, backupLine } from "./backup.ts";
import { config, DB_FILE, ROOT_DIR } from "./config.ts";
import { remoteUploadLine, uploadBackup } from "./remote-backup.ts";
import { SNAPSHOT_SUBFOLDER, snapshotUploadLine, uploadSnapshots } from "./snapshot-sync.ts";

export interface BackupRunReport {
  lines: string[];
  errors: string[];
}

export interface BackupRunOptions {
  /** Höchstzahl datierter Analyse-Stände, die neu hochgeladen werden; ohne Angabe alle fehlenden. */
  snapshotLimit?: number;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function runBackup(options: BackupRunOptions = {}): Promise<BackupRunReport> {
  const report: BackupRunReport = { lines: [], errors: [] };
  let file: string | null = null;
  try {
    const saved = await backupDatabase({
      source: DB_FILE,
      directory: config.backupDir,
      keep: config.backupKeep,
      timezone: config.timezone
    });
    report.lines.push(backupLine(saved));
    file = saved.file;
  } catch (error) {
    report.errors.push(`Sicherung fehlgeschlagen, die bisherige bleibt: ${messageOf(error)}`);
  }
  if (!config.mega) return report;
  const mega = config.mega;
  // Erst hier geladen: Ohne MEGA-Zugang braucht keine Analyse das Paket.
  const { openMegaStore } = await import("./mega-store.ts");
  if (file) {
    try {
      const store = await openMegaStore(mega);
      try {
        report.lines.push(remoteUploadLine(await uploadBackup(store, file, mega.keep), `MEGA/${mega.folder}`));
      } finally {
        await store.close();
      }
    } catch (error) {
      report.errors.push(`Hochladen zu MEGA fehlgeschlagen, die lokale Sicherung bleibt: ${messageOf(error)}`);
    }
  }
  const folder = `${mega.folder}/${SNAPSHOT_SUBFOLDER}`;
  try {
    const store = await openMegaStore({ ...mega, folder });
    try {
      const result = await uploadSnapshots(store, path.join(ROOT_DIR, "output"), { limit: options.snapshotLimit });
      report.lines.push(snapshotUploadLine(result, `MEGA/${folder}`));
    } finally {
      await store.close();
    }
  } catch (error) {
    report.errors.push(`Analyse-Stände nicht zu MEGA hochgeladen: ${messageOf(error)}`);
  }
  return report;
}
