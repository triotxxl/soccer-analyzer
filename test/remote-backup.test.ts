import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { backupFileName } from "../src/backup.ts";
import { newestRemoteBackup, uploadBackup, type RemoteBackupFile, type RemoteBackupStore } from "../src/remote-backup.ts";
import { restoreDatabase } from "../src/restore.ts";

/** Speicher im Arbeitsspeicher; `log` hält die Reihenfolge von Hochladen und Löschen fest. */
function memoryStore(initial: Array<Omit<RemoteBackupFile, "bytes">> = []) {
  const files = new Map<string, RemoteBackupFile & { data: Buffer }>();
  for (const entry of initial) files.set(entry.id, { ...entry, bytes: 1, data: Buffer.from("alt") });
  const log: string[] = [];
  let next = 100;
  const store: RemoteBackupStore = {
    async list() {
      return [...files.values()].map(({ data: _data, ...entry }) => entry);
    },
    async upload(name, data) {
      const entry = { id: String(next), name, uploadedAt: next++, bytes: data.length, data };
      files.set(entry.id, entry);
      log.push(`hoch ${name}`);
      return { id: entry.id, name, uploadedAt: entry.uploadedAt, bytes: entry.bytes };
    },
    async remove(id) {
      log.push(`weg ${files.get(id)?.name} (${id})`);
      files.delete(id);
    },
    async download(id) {
      return files.get(id)!.data;
    },
    async close() {}
  };
  return { store, files, log };
}

function withDirectory(run: (directory: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "remote-backup-test-"));
    try {
      await run(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

test("erst hochladen, dann die ältere Fassung des Tages und alles über der Grenze löschen", withDirectory(async (directory) => {
  const today = backupFileName("2026-10-21");
  const file = path.join(directory, today);
  writeFileSync(file, "neu");
  const { store, files, log } = memoryStore([
    { id: "1", name: backupFileName("2026-10-19"), uploadedAt: 1 },
    { id: "2", name: backupFileName("2026-10-20"), uploadedAt: 2 },
    { id: "3", name: today, uploadedAt: 3 },
    { id: "4", name: "fremde-datei.txt", uploadedAt: 4 }
  ]);
  const result = await uploadBackup(store, file, 2);
  assert.equal(log[0], `hoch ${today}`);
  assert.deepEqual(log.slice(1).sort(), [`weg ${backupFileName("2026-10-19")} (1)`, `weg ${today} (3)`]);
  assert.equal(result.kept, 2);
  assert.equal(result.removed, 2);
  assert.deepEqual([...files.values()].map((entry) => entry.name).sort(), [
    today,
    backupFileName("2026-10-20"),
    "fremde-datei.txt"
  ].sort());
  assert.equal(files.get(result.uploaded.id)?.data.toString(), "neu");
}));

test("die neueste Sicherung richtet sich nach dem Tag im Namen", async () => {
  const { store } = memoryStore([
    { id: "1", name: backupFileName("2026-10-21"), uploadedAt: 1 },
    { id: "2", name: backupFileName("2026-10-20"), uploadedAt: 9 },
    { id: "3", name: "analyzer.txt", uploadedAt: 10 }
  ]);
  assert.equal((await newestRemoteBackup(store))?.id, "1");
  assert.equal(await newestRemoteBackup(memoryStore().store), null);
});

function packedDatabase(directory: string, value: string): Buffer {
  const file = path.join(directory, `quelle-${value}.sqlite`);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE t (value TEXT); INSERT INTO t VALUES ('${value}')`);
  db.close();
  const data = gzipSync(readFileSync(file));
  rmSync(file);
  return data;
}

function valueIn(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare("SELECT value FROM t").get() as { value: string }).value;
  } finally {
    db.close();
  }
}

test("zurückspielen ersetzt eine vorhandene Datenbank nur mit force und legt sie samt WAL beiseite", withDirectory(async (directory) => {
  const target = path.join(directory, "analyzer.sqlite");
  writeFileSync(target, "bisher");
  writeFileSync(`${target}-wal`, "altes wal");
  await assert.rejects(restoreDatabase(packedDatabase(directory, "neu"), target), /--force/);
  assert.equal(readFileSync(target, "utf8"), "bisher");

  const result = await restoreDatabase(packedDatabase(directory, "neu"), target, { force: true, now: new Date("2026-10-21T12:00:00Z") });
  assert.equal(valueIn(target), "neu");
  assert.equal(existsSync(`${target}-wal`), false);
  assert.ok(result.setAside);
  assert.equal(readFileSync(result.setAside, "utf8"), "bisher");
  assert.equal(readFileSync(`${result.setAside}-wal`, "utf8"), "altes wal");
}));

test("zurückspielen auf einem neuen PC räumt verwaiste Nebendateien weg und prüft die Sicherung", withDirectory(async (directory) => {
  const target = path.join(directory, "analyzer.sqlite");
  writeFileSync(`${target}-wal`, "verwaist");
  const result = await restoreDatabase(packedDatabase(directory, "a"), target);
  assert.equal(result.setAside, null);
  assert.equal(valueIn(target), "a");
  assert.equal(existsSync(`${target}-wal`), false);

  const other = path.join(directory, "zweite.sqlite");
  await assert.rejects(restoreDatabase(gzipSync(Buffer.from("keine Datenbank")), other));
  assert.equal(existsSync(other), false);
}));
