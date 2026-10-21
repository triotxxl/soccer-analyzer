/**
 * Sicherung der Datenbank von Hand - dieselbe, die jede Dashboard-Analyse am Ende schreibt.
 *
 *   npm run backup
 *
 * Ziel `data/backups/` oder `BACKUP_DIR`, eine Datei je Tag, die neuesten `BACKUP_KEEP` (7)
 * bleiben. Kostet kein API-Budget. Zurückspielen steht in AGENTS.md („Pflege“, Sicherung).
 */
import { backupDatabase, backupLine } from "../src/backup.ts";
import { config, DB_FILE } from "../src/config.ts";

const result = await backupDatabase({
  source: DB_FILE,
  directory: config.backupDir,
  keep: config.backupKeep,
  timezone: config.timezone
});
console.log(backupLine(result));
