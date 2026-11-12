import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import type { RemoteBackupFile, RemoteBackupStore } from "../src/remote-backup.ts";
import { downloadSnapshots, uploadSnapshots } from "../src/snapshot-sync.ts";

function memoryStore() {
  const files = new Map<string, RemoteBackupFile & { data: Buffer }>();
  const log: string[] = [];
  let next = 1;
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
      log.push(`weg ${files.get(id)?.name}`);
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
    const directory = mkdtempSync(path.join(tmpdir(), "snapshot-sync-test-"));
    try {
      await run(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

const dated = (minute: number) => `dashboard-2026-11-12T18-${String(minute).padStart(2, "0")}-00-000Z.json`;

test("lädt den letzten Stand neu und nur fehlende datierte, neueste zuerst bis zur Grenze", withDirectory(async (directory) => {
  for (const minute of [1, 2, 3]) writeFileSync(path.join(directory, dated(minute)), `{"m":${minute}}`);
  writeFileSync(path.join(directory, "dashboard-latest.json"), '{"m":3}');
  writeFileSync(path.join(directory, "notizen.txt"), "nicht hochladen");
  const { store, files, log } = memoryStore();
  await store.upload(`${dated(1)}.gz`, gzipSync("{}"));
  await store.upload("dashboard-latest.json.gz", gzipSync('{"m":2}'));
  log.length = 0;

  const result = await uploadSnapshots(store, directory, { limit: 1 });

  assert.deepEqual(result.latest, true);
  assert.equal(result.uploaded, 1);
  assert.equal(result.pending, 1);
  // Erst die neue Fassung hoch, dann die alte weg.
  assert.deepEqual(log, ["hoch dashboard-latest.json.gz", "weg dashboard-latest.json.gz", `hoch ${dated(3)}.gz`]);
  const latest = [...files.values()].filter((entry) => entry.name === "dashboard-latest.json.gz");
  assert.equal(latest.length, 1);
  assert.equal(gunzipSync(latest[0]!.data).toString(), '{"m":3}');

  const rest = await uploadSnapshots(store, directory);
  assert.equal(rest.uploaded, 1);
  assert.equal(rest.pending, 0);
  assert.ok([...files.values()].some((entry) => entry.name === `${dated(2)}.gz`));
}));

test("ohne output-Ordner lädt nichts und bricht nicht ab", withDirectory(async (directory) => {
  const { store, log } = memoryStore();
  const result = await uploadSnapshots(store, path.join(directory, "fehlt"));
  assert.deepEqual(result, { ...result, latest: false, uploaded: 0, pending: 0 });
  assert.deepEqual(log, []);
}));

test("holt den letzten Stand immer und datierte nur, wenn sie lokal fehlen", withDirectory(async (directory) => {
  const output = path.join(directory, "output");
  mkdirSync(output);
  writeFileSync(path.join(output, dated(1)), "lokal");
  writeFileSync(path.join(output, "dashboard-latest.json"), "alt");
  const { store } = memoryStore();
  await store.upload(`${dated(1)}.gz`, gzipSync("von MEGA"));
  await store.upload(`${dated(2)}.gz`, gzipSync('{"m":2}'));
  await store.upload("dashboard-latest.json.gz", gzipSync("älter"));
  await store.upload("dashboard-latest.json.gz", gzipSync('{"m":2}'));
  await store.upload("fremd.txt", Buffer.from("x"));

  const result = await downloadSnapshots(store, output);

  assert.deepEqual(result, { latest: true, downloaded: 1 });
  assert.equal(readFileSync(path.join(output, "dashboard-latest.json"), "utf8"), '{"m":2}');
  assert.equal(readFileSync(path.join(output, dated(1)), "utf8"), "lokal");
  assert.equal(readFileSync(path.join(output, dated(2)), "utf8"), '{"m":2}');
  assert.deepEqual(readdirSync(output).sort(), ["dashboard-latest.json", dated(1), dated(2)].sort());
}));
