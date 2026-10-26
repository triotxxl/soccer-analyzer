/**
 * Wächter des Agenten `ui-ux-designer` (`.claude/agents/`). Claude Code ruft ihn vor jedem Bash-,
 * PowerShell-, Read- und Grep-Aufruf dieses Agenten auf (PreToolUse, nur solange der Agent läuft).
 * Anders als der Prüfer darf der Design-Agent Dateien ändern (Edit/Write prüft dieser Wächter nicht),
 * Tests laufen lassen und Neo bauen. Gesperrt wird, was Geld kostet oder ohne David nicht passieren soll:
 *
 * - API-Football: jedes npm-Skript außer `ALLOWED_SCRIPTS`, die Kommandozeile `src/cli.ts`, Werkzeuge
 *   unter `tools/` außer `tools/stack-karte.ts`, Netzzugriffe (curl, wget, Invoke-WebRequest),
 * - neue Pakete (`npm install`, `npx` außer vitest/tsc) und Git-Schreibbefehle (Commits macht die
 *   Hauptsitzung auf Davids Wunsch),
 * - `.env` lesen (API-Schlüssel).
 *
 * Die Engine von `impeccable` (`.claude/skills/impeccable/scripts/impeccable`, lädt sich beim ersten Aufruf
 * von GitHub) hat David am 26.10.2026 freigegeben; sie bleibt erlaubt.
 *
 * Ein Sicherheitsnetz wie der Wächter des Prüfers, keine Sandbox. Rückgabe 0 erlaubt, 2 sperrt, die
 * Begründung auf stderr sieht der Agent. Getestet in `test/design-waechter.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkReadPath, parseShell, stripHeredocs, type HookInput } from "./pruefer-waechter.ts";

/** Ohne API-Kosten und ohne Datenbank: Tests, Typprüfung, Neo bauen, Filterregeln in die Karte schreiben. */
export const ALLOWED_SCRIPTS = new Set(["test", "app:test", "typecheck", "neo:build", "stack-karte"]);

const NO_API = "Der Design-Agent löst keine Aufrufe an API-Football aus - Analysen und Daten holt die Hauptsitzung.";
const GIT_READ_ONLY = new Set(["status", "diff", "log", "show", "blame", "grep", "ls-files", "rev-parse"]);
const NETWORK = new Set(["curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm"]);

function checkSegment(words: string[]): string | null {
  const command = path.basename((words[0] ?? "").replaceAll("\\", "/")).toLowerCase().replace(/\.(cmd|exe|ps1)$/, "");
  const args = words.slice(1);
  if (NETWORK.has(command)) return "Netzzugriffe sind für den Design-Agenten gesperrt.";
  if (command === "npm") {
    const [sub, script] = args;
    if (sub === "test" || sub === "t") return null;
    if (sub === "run" || sub === "run-script") {
      return script && ALLOWED_SCRIPTS.has(script) ? null : `„npm run ${script ?? ""}“ ist für den Design-Agenten gesperrt. ${NO_API}`;
    }
    return `„npm ${sub ?? ""}“ ist gesperrt - neue Pakete und andere npm-Befehle nur nach Rückfrage über die Hauptsitzung.`;
  }
  if (command === "npx") {
    const tool = args.find((arg) => !arg.startsWith("-"));
    return tool === "vitest" || tool === "tsc" ? null : `„npx ${tool ?? ""}“ ist gesperrt - nur vitest und tsc.`;
  }
  if (command === "node") {
    for (const arg of args) {
      const file = arg.replaceAll("\\", "/");
      if (/(^|\/)src\/cli\.ts$/.test(file)) return `Die Analyse-Kommandozeile ist gesperrt. ${NO_API}`;
      if (/(^|\/)tools\/[\w.-]+\.ts$/.test(file) && !/(^|\/)tools\/stack-karte\.ts$/.test(file)) return `„${arg}“ ist gesperrt. ${NO_API}`;
    }
    return null;
  }
  if (command === "git") {
    const sub = args.find((arg) => !arg.startsWith("-") && !arg.includes("/") && !arg.includes("\\"));
    return sub && GIT_READ_ONLY.has(sub) ? null : `„git ${sub ?? ""}“ ist gesperrt - Commits und andere Git-Änderungen macht die Hauptsitzung.`;
  }
  return null;
}

export function checkCommand(command: string): string | null {
  const { segments } = parseShell(stripHeredocs(command));
  for (const words of segments) {
    const reason = checkSegment(words);
    if (reason) return reason;
  }
  return null;
}

export function checkToolCall(input: HookInput): string | null {
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const command = input.tool_input?.command;
  const filePath = input.tool_input?.file_path;
  const searchPath = input.tool_input?.path;
  if (tool === "Read") return typeof filePath === "string" ? checkReadPath(filePath) : null;
  if (tool === "Grep") return typeof searchPath === "string" ? checkReadPath(searchPath) : null;
  if (tool === "Bash" || tool === "PowerShell") {
    return typeof command === "string" ? checkCommand(command) : "Befehl nicht lesbar - vorsorglich gesperrt.";
  }
  return null;
}

function main(): void {
  let reason: string | null;
  try {
    reason = checkToolCall(JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, "")) as HookInput);
  } catch {
    reason = "Der Aufruf war für den Wächter nicht lesbar - vorsorglich gesperrt.";
  }
  if (reason) process.stderr.write(`Gesperrt vom Wächter des Design-Agenten: ${reason}\n`);
  // Auslaufen statt process.exit: Mit dem eingebundenen Prüfer-Wächter brach Node 24 unter Windows
  // sonst mit „Assertion failed … async.c“ und Rückgabe 127 ab - Claude Code hätte nichts gesperrt.
  process.exitCode = reason ? 2 : 0;
}

if (path.basename(process.argv[1] ?? "").toLowerCase() === path.basename(fileURLToPath(import.meta.url)).toLowerCase()) main();
