/**
 * Sicherung der Datenbank von Hand - dieselbe, die jede Dashboard-Analyse am Ende schreibt.
 *
 *   npm run backup
 *
 * Ziel `data/backups/` oder `BACKUP_DIR`, eine Datei je Tag, die neuesten `BACKUP_KEEP` (6)
 * bleiben; mit MEGA-Zugang in `.env` zusätzlich dort. Kostet kein API-Budget. Zurückspielen:
 * `npm run restore` (`tools/restore.ts`).
 */
import { runBackup } from "../src/backup-run.ts";

const report = await runBackup();
for (const line of report.lines) console.log(line);
for (const line of report.errors) console.error(line);
if (report.errors.length > 0) process.exitCode = 1;
