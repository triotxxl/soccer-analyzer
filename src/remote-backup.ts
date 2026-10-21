/**
 * Sicherungen außer Haus: lädt die Datei aus `src/backup.ts` hoch und räumt dort auf, und holt
 * beim Zurückspielen die neueste wieder. Der Speicher steckt hinter `RemoteBackupStore`, damit
 * die Regeln ohne Konto prüfbar sind; die MEGA-Anbindung steht in `src/mega-store.ts`.
 *
 * Erst hochladen, dann löschen: Die ältere Fassung desselben Tages verschwindet erst, wenn die
 * neue vollständig angekommen ist. Gelöscht wird endgültig, nicht in den Papierkorb - dort
 * zählten die Dateien sonst weiter gegen den Speicherplatz.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BACKUP_FILE } from "./backup.ts";

export interface RemoteBackupFile {
  id: string;
  name: string;
  /** Hochgeladen, Millisekunden seit 1970. */
  uploadedAt: number;
  bytes: number;
}

export interface RemoteBackupStore {
  list(): Promise<RemoteBackupFile[]>;
  upload(name: string, data: Buffer): Promise<RemoteBackupFile>;
  remove(id: string): Promise<void>;
  download(id: string): Promise<Buffer>;
  close(): Promise<void>;
}

export interface RemoteUploadResult {
  uploaded: RemoteBackupFile;
  kept: number;
  removed: number;
  seconds: number;
}

export async function uploadBackup(store: RemoteBackupStore, file: string, keep: number): Promise<RemoteUploadResult> {
  const started = Date.now();
  const uploaded = await store.upload(path.basename(file), await readFile(file));
  const backups = (await store.list()).filter((entry) => BACKUP_FILE.test(entry.name));
  const names = [...new Set(backups.map((entry) => entry.name))].sort().reverse().slice(0, Math.max(1, keep));
  const survivors = new Set<string>();
  for (const name of names) {
    // Je Name nur eine Datei: die eben hochgeladene, sonst die jüngste.
    const sameName = backups.filter((entry) => entry.name === name);
    const keepId = sameName.some((entry) => entry.id === uploaded.id)
      ? uploaded.id
      : sameName.reduce((newest, entry) => (entry.uploadedAt > newest.uploadedAt ? entry : newest)).id;
    survivors.add(keepId);
  }
  const obsolete = backups.filter((entry) => !survivors.has(entry.id));
  for (const entry of obsolete) await store.remove(entry.id);
  return { uploaded, kept: survivors.size, removed: obsolete.length, seconds: (Date.now() - started) / 1000 };
}

/** Die neueste Sicherung nach Tag im Namen, bei gleichem Namen die zuletzt hochgeladene. */
export async function newestRemoteBackup(store: RemoteBackupStore): Promise<RemoteBackupFile | null> {
  const backups = (await store.list()).filter((entry) => BACKUP_FILE.test(entry.name));
  backups.sort((a, b) => b.name.localeCompare(a.name) || b.uploadedAt - a.uploadedAt);
  return backups[0] ?? null;
}

export function remoteUploadLine(result: RemoteUploadResult, target: string): string {
  return `Sicherung bei ${target}: ${result.uploaded.name} hochgeladen (${result.seconds.toFixed(0)} s)`
    + ` · ${result.kept} aufbewahrt${result.removed > 0 ? `, ${result.removed} ältere gelöscht` : ""}`;
}
