/**
 * Analyse-Stände außer Haus (seit 13.11.2026, Davids Wunsch): Die Datenbank-Sicherung trägt das
 * Ergebnis einer Analyse nicht - die Apps lesen `output/dashboard-latest.json`, das Marktprofil
 * die datierten `output/dashboard-<Zeit>.json`. Ohne sie zeigte ein anderer PC nach
 * `npm run restore` nichts, bis er selbst analysierte.
 *
 * Hochgeladen wird gepackt (`<name>.gz`) in einen eigenen Ordner neben den Datenbank-Sicherungen
 * (`MEGA_FOLDER/snapshots`), damit deren Aufräumregel davon nichts sieht:
 * - `dashboard-latest.json.gz` mit jeder Analyse neu; erst hochladen, dann die ältere Fassung
 *   endgültig löschen (dieselbe Regel wie bei der Datenbank).
 * - datierte Stände einmal, nur was dort noch fehlt, neueste zuerst. Sie bleiben (Davids Wahl:
 *   20 GB bei MEGA, gepackt rund ein Zehntel der Datei). `limit` deckelt die Zahl je Durchgang,
 *   damit die erste Analyse auf einem PC mit vielen alten Ständen nicht lange hängt; der Rest
 *   folgt mit den nächsten Analysen oder auf einmal mit `npm run backup`.
 *
 * Zurückgeholt wird alles, was lokal fehlt; `dashboard-latest.json` immer, damit es zur gerade
 * eingespielten Datenbank passt.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { RemoteBackupFile, RemoteBackupStore } from "./remote-backup.ts";

export const SNAPSHOT_SUBFOLDER = "snapshots";
export const LATEST_SNAPSHOT = "dashboard-latest.json";
/** Datierte Stände, wie `writeDashboard` sie schreibt (`dashboard-2026-11-12T18-03-11-123Z.json`). */
export const DATED_SNAPSHOT = /^dashboard-\d{4}-\d{2}-\d{2}.*\.json$/;

const packedName = (name: string): string => `${name}.gz`;
const unpackedName = (name: string): string => name.replace(/\.gz$/, "");

export interface SnapshotUploadResult {
  latest: boolean;
  uploaded: number;
  /** Datierte Stände, die lokal liegen, aber noch nicht hochgeladen sind (über `limit`). */
  pending: number;
  seconds: number;
}

export async function uploadSnapshots(
  store: RemoteBackupStore,
  outputDirectory: string,
  options: { limit?: number } = {}
): Promise<SnapshotUploadResult> {
  const started = Date.now();
  const local = await readdir(outputDirectory).catch(() => [] as string[]);
  const remote = await store.list();
  const remoteNames = new Set(remote.map((entry) => entry.name));
  let latest = false;
  if (local.includes(LATEST_SNAPSHOT)) {
    const uploaded = await store.upload(packedName(LATEST_SNAPSHOT), gzipSync(await readFile(path.join(outputDirectory, LATEST_SNAPSHOT))));
    for (const entry of remote) {
      if (entry.name === packedName(LATEST_SNAPSHOT) && entry.id !== uploaded.id) await store.remove(entry.id);
    }
    latest = true;
  }
  const missing = local.filter((name) => DATED_SNAPSHOT.test(name) && !remoteNames.has(packedName(name))).sort().reverse();
  const batch = missing.slice(0, options.limit ?? missing.length);
  for (const name of batch) {
    await store.upload(packedName(name), gzipSync(await readFile(path.join(outputDirectory, name))));
  }
  return { latest, uploaded: batch.length, pending: missing.length - batch.length, seconds: (Date.now() - started) / 1000 };
}

export function snapshotUploadLine(result: SnapshotUploadResult, target: string): string {
  const parts = [`Analyse-Stände bei ${target}: ${result.latest ? "letzter Stand" : "kein letzter Stand"}`];
  if (result.uploaded > 0) parts.push(`${result.uploaded} ältere neu hochgeladen`);
  if (result.pending > 0) parts.push(`${result.pending} folgen mit den nächsten Analysen (alle auf einmal: npm run backup)`);
  return `${parts.join(" · ")} (${result.seconds.toFixed(0)} s)`;
}

export interface SnapshotDownloadResult {
  latest: boolean;
  downloaded: number;
}

/** Schreibt erst eine Zwischendatei und benennt sie dann um - eine App liest nie eine halbe Datei. */
async function writeAtomic(target: string, data: Buffer): Promise<void> {
  const temporary = `${target}.restore.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function downloadSnapshots(store: RemoteBackupStore, outputDirectory: string): Promise<SnapshotDownloadResult> {
  await mkdir(outputDirectory, { recursive: true });
  const local = new Set(await readdir(outputDirectory));
  const remote = await store.list();
  const newestLatest = remote
    .filter((entry) => entry.name === packedName(LATEST_SNAPSHOT))
    .reduce<RemoteBackupFile | null>((newest, entry) => (!newest || entry.uploadedAt > newest.uploadedAt ? entry : newest), null);
  if (newestLatest) {
    await writeAtomic(path.join(outputDirectory, LATEST_SNAPSHOT), gunzipSync(await store.download(newestLatest.id)));
  }
  let downloaded = 0;
  for (const entry of remote) {
    const name = unpackedName(entry.name);
    if (!entry.name.endsWith(".gz") || !DATED_SNAPSHOT.test(name) || local.has(name)) continue;
    await writeAtomic(path.join(outputDirectory, name), gunzipSync(await store.download(entry.id)));
    local.add(name);
    downloaded += 1;
  }
  return { latest: newestLatest !== null, downloaded };
}
