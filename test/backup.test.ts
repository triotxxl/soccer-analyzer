import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { backupDatabase, backupFileName } from "../src/backup.ts";

function withDirectory(run: (directory: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "backup-test-"));
    try {
      await run(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

/** Datenbank im WAL-Modus, offen gehalten wie während einer Analyse. */
function openSource(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS t (value TEXT)");
  return db;
}

function valuesIn(gzFile: string, directory: string): string[] {
  const restored = path.join(directory, "restored.sqlite");
  writeFileSync(restored, gunzipSync(readFileSync(gzFile)));
  const db = new DatabaseSync(restored, { readOnly: true });
  try {
    return (db.prepare("SELECT value FROM t ORDER BY value").all() as Array<{ value: string }>).map((row) => row.value);
  } finally {
    db.close();
    rmSync(restored);
  }
}

test("die Sicherung enthält auch, was noch im WAL steht, und ersetzt die des Tages", withDirectory(async (directory) => {
  const source = path.join(directory, "analyzer.sqlite");
  const target = path.join(directory, "backups");
  const db = openSource(source);
  try {
    db.exec("INSERT INTO t VALUES ('a')");
    const options = { source, directory: target, keep: 7, timezone: "Europe/Berlin" };
    const first = await backupDatabase({ ...options, now: new Date("2026-10-21T08:00:00Z") });
    assert.equal(path.basename(first.file), backupFileName("2026-10-21"));
    assert.deepEqual(valuesIn(first.file, directory), ["a"]);

    db.exec("INSERT INTO t VALUES ('b')");
    const second = await backupDatabase({ ...options, now: new Date("2026-10-21T20:00:00Z") });
    assert.equal(second.file, first.file);
    assert.deepEqual(valuesIn(second.file, directory), ["a", "b"]);
    assert.deepEqual(readdirSync(target), [backupFileName("2026-10-21")]);
  } finally {
    db.close();
  }
}));

test("der Tag richtet sich nach Berliner Zeit", withDirectory(async (directory) => {
  const source = path.join(directory, "analyzer.sqlite");
  openSource(source).close();
  const result = await backupDatabase({
    source,
    directory,
    keep: 7,
    timezone: "Europe/Berlin",
    now: new Date("2026-10-21T22:30:00Z")
  });
  assert.equal(path.basename(result.file), backupFileName("2026-10-22"));
}));

test("es bleiben die neuesten Sicherungen, gezählt nach Dateien, und Reste abgebrochener Läufe gehen", withDirectory(async (directory) => {
  const source = path.join(directory, "analyzer.sqlite");
  openSource(source).close();
  const target = path.join(directory, "backups");
  await backupDatabase({ source, directory: target, keep: 3, timezone: "Europe/Berlin", now: new Date("2026-09-01T12:00:00Z") });
  // Zwei Wochen Pause: die alte Sicherung zählt weiter mit, statt nach Kalendertagen zu verfallen.
  for (const day of ["2026-08-01", "2026-08-15"]) writeFileSync(path.join(target, backupFileName(day)), "alt");
  writeFileSync(path.join(target, `${backupFileName("2026-08-20")}.tmp`), "abgebrochen");
  writeFileSync(path.join(target, "notiz.txt"), "fremd");

  const result = await backupDatabase({ source, directory: target, keep: 3, timezone: "Europe/Berlin", now: new Date("2026-09-15T12:00:00Z") });
  assert.equal(result.kept, 3);
  assert.deepEqual(readdirSync(target).sort(), [
    backupFileName("2026-08-15"),
    backupFileName("2026-09-01"),
    backupFileName("2026-09-15"),
    "notiz.txt"
  ]);
}));
