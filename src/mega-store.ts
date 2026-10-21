/**
 * MEGA als Ziel der Sicherungen (`RemoteBackupStore` aus `src/remote-backup.ts`), über das Paket
 * `megajs` - nicht von MEGA selbst, aber verbreitet. Zugang aus `.env`: `MEGA_EMAIL`,
 * `MEGA_PASSWORD`, `MEGA_FOLDER` (Pfad im Konto, fehlende Ordner werden angelegt).
 *
 * Eine Zwei-Faktor-Anmeldung kann ein Skript nicht bedienen; deshalb ein eigenes Konto nur für
 * die Sicherungen, ohne andere Daten darin. Die Dateien verschlüsselt `megajs` vor dem Hochladen.
 */
import { Storage } from "megajs";
import type { RemoteBackupFile, RemoteBackupStore } from "./remote-backup.ts";

export interface MegaAccess {
  email: string;
  password: string;
  folder: string;
}

type MegaNode = Storage["root"];

function fileOf(node: MegaNode): RemoteBackupFile {
  return {
    id: node.nodeId ?? "",
    name: node.name ?? "",
    uploadedAt: (node.timestamp ?? 0) * 1000,
    bytes: node.size ?? 0
  };
}

export async function openMegaStore(access: MegaAccess): Promise<RemoteBackupStore> {
  const storage = await new Storage({ email: access.email, password: access.password, keepalive: false }).ready;
  let folder = storage.root;
  for (const name of access.folder.split("/").map((part) => part.trim()).filter(Boolean)) {
    folder = folder.children?.find((child) => child.directory && child.name === name) ?? await folder.mkdir(name);
  }
  const nodeOf = (id: string): MegaNode => {
    const node = storage.files[id];
    if (!node) throw new Error(`Datei ${id} bei MEGA nicht gefunden`);
    return node;
  };
  return {
    async list() {
      return (folder.children ?? []).filter((child) => !child.directory).map(fileOf);
    },
    async upload(name, data) {
      // Die Typen von megajs geben einen Writable an, zur Laufzeit trägt er `complete`.
      const stream = folder.upload({ name, size: data.length }, data) as unknown as { complete: Promise<MegaNode> };
      return fileOf(await stream.complete);
    },
    async remove(id) {
      await nodeOf(id).delete(true);
    },
    async download(id) {
      return nodeOf(id).downloadBuffer({});
    },
    async close() {
      await storage.close();
    }
  };
}
