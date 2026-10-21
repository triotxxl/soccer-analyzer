/**
 * Spielt eine Sicherung aus `src/backup.ts` als Datenbank ein (`npm run restore`).
 *
 * Eine vorhandene Datenbank wird nur mit `force` ersetzt und auch dann nicht gelöscht, sondern samt
 * `-wal`/`-shm` beiseitegelegt (`analyzer.sqlite.vor-restore-<Zeit>`). Die beiden Nebendateien
 * gehören zur alten Datenbank: Bliebe ein altes WAL neben der neuen Hauptdatei liegen, spielte
 * SQLite es beim nächsten Öffnen hinein. Läuft noch eine App oder Analyse, scheitert das
 * Umbenennen unter Windows - dann bleibt alles, wie es war.
 */
import { existsSync } from "node:fs";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

export interface RestoreResult {
  target: string;
  bytes: number;
  /** Wohin die bisherige Datenbank gelegt wurde, sonst null. */
  setAside: string | null;
}

const SIDE_FILES = ["-wal", "-shm"];

export async function restoreDatabase(
  packed: Buffer,
  target: string,
  options: { force?: boolean; now?: Date } = {}
): Promise<RestoreResult> {
  if (existsSync(target) && !options.force) {
    throw new Error(`${target} gibt es schon. Ersetzen nur mit --force; die bisherige wird dabei beiseitegelegt, nicht gelöscht.`);
  }
  const incoming = `${target}.restore.tmp`;
  try {
    await writeFile(incoming, gunzipSync(packed));
    const check = new DatabaseSync(incoming);
    try {
      check.exec("PRAGMA journal_mode = DELETE");
      const result = check.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
      if (result?.quick_check !== "ok") {
        throw new Error(`Sicherung fehlerhaft (quick_check: ${result?.quick_check ?? "keine Antwort"})`);
      }
    } finally {
      check.close();
    }
    let setAside: string | null = null;
    if (existsSync(target)) {
      const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
      setAside = `${target}.vor-restore-${stamp}`;
      try {
        await rename(target, setAside);
      } catch (error) {
        throw new Error(`Die bisherige Datenbank ist noch geöffnet - App und Analysen beenden (${error instanceof Error ? error.message : String(error)})`);
      }
      for (const suffix of SIDE_FILES) {
        if (existsSync(`${target}${suffix}`)) await rename(`${target}${suffix}`, `${setAside}${suffix}`);
      }
    } else {
      // Reste ohne Hauptdatei gehören zu keiner Datenbank mehr.
      for (const suffix of SIDE_FILES) await rm(`${target}${suffix}`, { force: true });
    }
    await rename(incoming, target);
    return { target, bytes: (await stat(target)).size, setAside };
  } finally {
    for (const file of [incoming, ...SIDE_FILES.map((suffix) => `${incoming}${suffix}`)]) await rm(file, { force: true });
  }
}
