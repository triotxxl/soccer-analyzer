/**
 * Ein Sicherungsdurchgang, wie ihn die Dashboard-Analyse am Ende und `npm run backup` fahren:
 * lokal schreiben, dann - wenn der MEGA-Zugang in `.env` steht - hochladen. Scheitert das
 * Hochladen, bleibt die lokale Sicherung; die nächste Analyse lädt ihre eigene hoch.
 */
import { backupDatabase, backupLine } from "./backup.ts";
import { config, DB_FILE } from "./config.ts";
import { remoteUploadLine, uploadBackup } from "./remote-backup.ts";

export interface BackupRunReport {
  lines: string[];
  errors: string[];
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function runBackup(): Promise<BackupRunReport> {
  const report: BackupRunReport = { lines: [], errors: [] };
  let file: string;
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
    return report;
  }
  if (!config.mega) return report;
  try {
    // Erst hier geladen: Ohne MEGA-Zugang braucht keine Analyse das Paket.
    const { openMegaStore } = await import("./mega-store.ts");
    const store = await openMegaStore(config.mega);
    try {
      report.lines.push(remoteUploadLine(await uploadBackup(store, file, config.mega.keep), `MEGA/${config.mega.folder}`));
    } finally {
      await store.close();
    }
  } catch (error) {
    report.errors.push(`Hochladen zu MEGA fehlgeschlagen, die lokale Sicherung bleibt: ${messageOf(error)}`);
  }
  return report;
}
