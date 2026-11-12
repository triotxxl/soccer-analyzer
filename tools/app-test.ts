/**
 * `npm run app:test`: startet Vitest mit großem Laufwerksbuchstaben.
 *
 * Windows: Öffnet der Editor das Projekt als „c:\…“, lädt Vitest seine eigenen Module einmal unter „c:“
 * und einmal unter „C:“. Der Test findet dann den laufenden Testlauf nicht („Vitest failed to find the
 * current suite“, „Cannot read properties of undefined (reading 'config')“), und keine einzige Datei
 * läuft - gefunden am 12.11.2026, alle 28 Dateien. Ein Umstellen in `vitest.config.ts` kommt zu spät, weil
 * Vitest das Arbeitsverzeichnis vorher liest; deshalb startet dieser Starter Vitest gleich im richtigen.
 * Weitere Argumente gehen unverändert an `vitest run`.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const upperDrive = (dir: string) => (/^[a-z]:/.test(dir) ? dir[0]!.toUpperCase() + dir.slice(1) : dir);

const cwd = upperDrive(process.cwd());
const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
const result = spawnSync(process.execPath, [upperDrive(vitest), "run", ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(result.status ?? 1);
