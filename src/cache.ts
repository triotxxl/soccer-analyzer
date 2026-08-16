import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "./config.ts";
import { sha256 } from "./util.ts";

interface CacheRecord<T> {
  storedAt: number;
  value: T;
}

export class FileCache {
  readonly directory: string;

  constructor(directory = CACHE_DIR) {
    this.directory = directory;
  }

  private fileFor(key: string): string {
    return path.join(this.directory, `${sha256(key)}.json`);
  }

  async get<T>(key: string, ttlMs: number): Promise<T | null> {
    try {
      const raw = await readFile(this.fileFor(key), "utf8");
      const record = JSON.parse(raw) as CacheRecord<T>;
      if (
        typeof record.storedAt !== "number" ||
        Date.now() - record.storedAt > ttlMs ||
        record.value === undefined
      ) {
        return null;
      }
      return record.value;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const record: CacheRecord<T> = { storedAt: Date.now(), value };
    await writeFile(this.fileFor(key), `${JSON.stringify(record)}\n`, "utf8");
  }
}
