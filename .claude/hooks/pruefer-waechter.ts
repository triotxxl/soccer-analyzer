/**
 * Wächter des Agenten `fussball-algorithmen-pruefer` (`.claude/agents/`). Claude Code ruft ihn vor
 * jedem Bash-, PowerShell-, Read- und Grep-Aufruf dieses Agenten auf (PreToolUse, nur solange der
 * Agent läuft) und sperrt, was der Prüfer laut Auftrag nie tun darf:
 *
 * - API-Football aufrufen - npm-Skripte und CLI-Befehle, die die API fragen, und die API direkt,
 * - in die Datenbank, ins Repository oder nach Git schreiben,
 * - `.env` lesen (API-Schlüssel).
 *
 * Er ist ein Sicherheitsnetz, keine Sandbox: Er erkennt die üblichen Wege, nicht jeden denkbaren.
 * Ein npm-Skript, das hier nicht steht, sperrt er vorsorglich - neue Skripte gehören eingetragen.
 * Code (Heredoc-Skripte, `node -e`) prüft er auf Datenbank- und Dateizugriffe; ein bloßes `grep`
 * nach denselben Wörtern bleibt erlaubt.
 *
 * Ein- und Ausgabe nach Claude Code: JSON auf stdin (`tool_name`, `tool_input`). Rückgabe 0 heißt
 * erlaubt, 2 heißt gesperrt; die Begründung auf stderr bekommt der Agent zu sehen. Ist die Eingabe
 * nicht lesbar, sperrt er - lieber ein unnötig gesperrter Befehl als ein Lauf mit API-Kosten.
 * Getestet in `test/pruefer-waechter.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface HookInput {
  tool_name?: unknown;
  tool_input?: { command?: unknown; file_path?: unknown; path?: unknown } | null;
}

const LOCAL_ONLY = "Der Prüfer arbeitet nur mit lokalen Daten - melde der Hauptsitzung, was nötig wäre.";
const ENV_LOCKED = ".env enthält den API-Schlüssel und bleibt ungelesen.";

/** npm-Skripte, die API-Football aufrufen, Daten schreiben oder einen Server starten. */
const BLOCKED_SCRIPTS: Readonly<Record<string, string>> = {
  analyze: "ruft API-Football auf",
  dashboard: "ruft API-Football auf",
  draw: "ruft API-Football auf",
  favorites: "ruft API-Football auf",
  goals: "ruft API-Football auf",
  "venue-form": "kann API-Football aufrufen",
  live: "ruft API-Football auf",
  settle: "ruft API-Football auf und schreibt die Abrechnung",
  strength: "ruft API-Football auf",
  smoke: "ruft API-Football auf",
  aliases: "schreibt Zuordnungen in die Datenbank",
  "team-aliases": "schreibt Zuordnungen in die Datenbank",
  "insights-probe": "ruft API-Football auf",
  "backfill-results": "schreibt in die Datenbank",
  "backfill-half-stats": "ruft API-Football auf und schreibt in die Datenbank",
  "kelly-tracker": "schreibt docs/kelly-tracker.json",
  app: "startet den Server der App",
  "app:build": "schreibt den Build der App",
  "app:preview": "startet einen Server"
};

/** Ohne API-Kosten und ohne Schreibzugriff. Sonderfälle (elo, --write, --json) prüft `checkScript`. */
const ALLOWED_SCRIPTS = new Set([
  "test", "typecheck", "app:test", "report", "edge-report", "edge-report:simulate",
  "quickpick-report", "draw-signals-report", "elo-backtest", "elo", "snapshot-history"
]);

/** `npm run elo -- <befehl>`: nur diese beiden lesen bloß. */
const ELO_READ_ONLY = new Set(["ranking", "team"]);

const GIT_READ_ONLY = new Set([
  "status", "log", "diff", "show", "blame", "grep", "ls-files", "ls-tree", "rev-parse", "describe",
  "shortlog", "cat-file"
]);

const NPM_CHANGES_PACKAGES = new Set([
  "install", "i", "ci", "uninstall", "remove", "rm", "un", "update", "up", "add", "link", "publish",
  "exec", "init", "pack", "dedupe", "prune", "rebuild"
]);

const NETWORK_COMMANDS = new Set(["curl", "wget", "invoke-webrequest", "invoke-restmethod", "iwr", "irm"]);
const API_HOST = /api-sports\.io|x-apisports-key|x-rapidapi-key/i;

/** Liegt ein Schreibziel im Temp-Verzeichnis (oder ins Leere)? */
export function isTemp(target: string): boolean {
  const value = target.trim().replace(/^["']|["']$/g, "");
  return /^(\/tmp(\/|$)|\/dev\/null$)/i.test(value)
    || /[\\/](temp|tmp)([\\/]|$)/i.test(value)
    || /\$\{?(temp|tmp|tmpdir)\}?/i.test(value)
    || /\$env:(temp|tmp)\b/i.test(value)
    || /%(temp|tmp)%/i.test(value)
    || /tmpdir\(\)/.test(value)
    || /^(\$null|nul)$/i.test(value);
}

/** Ist das Wort ein Pfad auf `.env` (nicht ein Suchmuster wie `\.env`)? */
function isEnvPath(word: string): boolean {
  return /^(.+[\\/])?\.env$/.test(word) && !/^\\\.env$/.test(word);
}

/** Entfernt die Rümpfe von Heredocs (`<<'EOF'`) und PowerShell-Here-Strings (`@' … '@`). */
export function stripHeredocs(text: string): string {
  const out: string[] = [];
  const pending: Array<{ delimiter: string; dash: boolean }> = [];
  let body: { delimiter: string; dash: boolean } | null = null;
  let hereString: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (body) {
      const probe = body.dash ? line.replace(/^\t+/, "") : line;
      if (probe.trim() === body.delimiter) body = pending.shift() ?? null;
      continue;
    }
    if (hereString) {
      if (line.trimStart().startsWith(hereString)) {
        out.push(line.slice(line.indexOf(hereString) + 2));
        hereString = null;
      }
      continue;
    }
    out.push(line);
    for (const match of line.matchAll(/(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/g)) {
      pending.push({ delimiter: match[3]!, dash: match[1] === "-" });
    }
    body = pending.shift() ?? null;
    const opening = line.match(/@(['"])\s*$/);
    if (opening) hereString = `${opening[1]}@`;
  }
  return out.join("\n");
}

/** Führt der Befehl Code aus - ein Heredoc-Skript, einen Here-String oder `node -e`? */
function runsCode(command: string): boolean {
  return /(?<!<)<<(?!<)|@['"]\s*$/m.test(command)
    || /\bnode(\.exe)?\s+(?:[^\n|;&]*\s)?(-e|--eval|-p|--print)\b/.test(command);
}

/** Einfache Zuweisungen im selben Befehl (`S="…"`, `$S = "…"`), damit `"$S/x.ts"` prüfbar wird. */
function substituteVariables(text: string): string {
  const variables = new Map<string, string>();
  const remember = (name: string, value: string) => {
    variables.set(name, /mktemp|tmpdir/i.test(value) ? "/tmp/" : value);
  };
  for (const match of text.matchAll(/(?:^|[\s;&|(])([A-Za-z_]\w*)=(?:"([^"]*)"|'([^']*)'|([^\s;&|)]*))/g)) {
    remember(match[1]!, match[2] ?? match[3] ?? match[4] ?? "");
  }
  for (const match of text.matchAll(/\$([A-Za-z_]\w*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    remember(match[1]!, match[2] ?? match[3] ?? "");
  }
  return text.replace(/\$\{(\w+)\}|\$(\w+)/g, (whole: string, braced?: string, plain?: string) =>
    variables.get(braced ?? plain ?? "") ?? whole);
}

/**
 * Zerlegt in Anweisungen und Wörter (Anführungszeichen trennen nicht und werden entfernt) und
 * sammelt dabei die Ziele von `>`/`>>`. `2>&1`, `>&2`, `=>` und `>=` sind keine Schreibziele,
 * `<`/`<<` lesen nur - ihr Wort wird übersprungen.
 */
export function parseShell(text: string): { segments: string[][]; redirects: string[] } {
  const segments: string[][] = [];
  const redirects: string[] = [];
  let words: string[] = [];
  let word = "";
  let quote: string | null = null;
  let quoted = false;
  const endWord = () => {
    if (word || quoted) words.push(word);
    word = "";
    quoted = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  /** Liest das Wort ab `start` (in Anführungszeichen oder bis zum Trenner) und gibt das Ende zurück. */
  const readTarget = (start: number): { value: string; end: number } => {
    let at = start;
    while (text[at] === " " || text[at] === "\t") at += 1;
    const opening = text[at];
    if (opening === '"' || opening === "'") {
      const close = text.indexOf(opening, at + 1);
      return { value: text.slice(at + 1, close === -1 ? undefined : close), end: close === -1 ? text.length : close };
    }
    let end = at;
    while (end < text.length && !/[\s;&|<>()]/.test(text[end]!)) end += 1;
    return { value: text.slice(at, end), end: end - 1 };
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote && !(quote === '"' && text[index - 1] === "\\")) quote = null;
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoted = true;
    } else if (char === ">" && !["=", "-"].includes(text[index - 1] ?? "") && text[index + 1] !== "=") {
      if (/^\d+$/.test(word)) word = "";
      endWord();
      let next = index + 1;
      if (text[next] === ">") next += 1;
      if (text[next] === "&") {
        index = readTarget(next + 1).end;
        continue;
      }
      const target = readTarget(next);
      if (target.value) redirects.push(target.value);
      index = target.end;
    } else if (char === "<") {
      endWord();
      let next = index + 1;
      while (text[next] === "<" || text[next] === "-") next += 1;
      index = readTarget(next).end;
    } else if (char === " " || char === "\t") endWord();
    else if (/[;&|\n()`{}]/.test(char)) endSegment();
    else word += char;
  }
  endSegment();
  return { segments, redirects };
}

function checkScript(script: string, args: string[], label: string): string | null {
  const blocked = BLOCKED_SCRIPTS[script];
  if (blocked) return `„${label}“ ${blocked}. ${LOCAL_ONLY}`;
  if (!ALLOWED_SCRIPTS.has(script)) {
    return `„${label}“ ist dem Wächter nicht bekannt und deshalb gesperrt. Ein neues Skript gehört erst in `
      + ".claude/hooks/pruefer-waechter.ts eingetragen.";
  }
  const rest = args.filter((arg) => arg !== "--");
  if (script === "elo" && !ELO_READ_ONLY.has(rest[0] ?? "")) {
    return `„${label} ${rest[0] ?? ""}“ schreibt in die Datenbank oder ruft API-Football auf. Erlaubt sind nur „ranking“ und „team“.`;
  }
  if (script === "quickpick-report" && rest.includes("--write")) {
    return `„${label} --write“ hält einen Kalibrierpunkt fest und schreibt damit ins Repository.`;
  }
  const json = rest.indexOf("--json");
  if (script.startsWith("edge-report") && json !== -1 && !isTemp(rest[json + 1] ?? "")) {
    return "„edge-report --json“ darf nur ins Temp-Verzeichnis schreiben.";
  }
  return null;
}

function checkNode(args: string[]): string | null {
  const entry = args.findIndex((arg) => /\.(ts|js|mjs)$/i.test(arg));
  if (entry === -1) return null;
  const file = args[entry]!.replaceAll("\\", "/");
  const rest = args.slice(entry + 1);
  if (/(^|\/)src\/cli\.ts$/.test(file)) {
    return rest[0] === "report" ? null
      : `„src/cli.ts ${rest[0] ?? ""}“ ruft API-Football auf oder schreibt. Erlaubt ist nur „report“.`;
  }
  const tool = file.match(/(^|\/)tools\/([\w-]+)\.ts$/);
  return tool ? checkScript(tool[2]!, rest, `tools/${tool[2]}.ts`) : null;
}

function outsideTemp(operands: string[]): string | undefined {
  return operands.find((operand) => !isTemp(operand));
}

function checkSegment(words: string[]): string | null {
  if (words.some(isEnvPath)) return ENV_LOCKED;
  let start = 0;
  while (start < words.length && /^[A-Za-z_]\w*=/.test(words[start]!)) start += 1;
  while (["xargs", "command", "time", "nohup", "env"].includes(words[start] ?? "")) {
    start += 1;
    while ((words[start] ?? "").startsWith("-")) start += 1;
  }
  const command = (words[start] ?? "").toLowerCase().replace(/\.(exe|cmd)$/, "");
  const args = words.slice(start + 1);
  const operands = args.filter((arg) => !arg.startsWith("-"));

  if (NETWORK_COMMANDS.has(command) && args.some((arg) => API_HOST.test(arg))) {
    return `Direkte Aufrufe von API-Football sind gesperrt. ${LOCAL_ONLY}`;
  }
  switch (command) {
    case "npm": {
      const runAt = args.findIndex((arg) => arg === "run" || arg === "run-script");
      if (runAt !== -1) {
        const rest = args.slice(runAt + 1);
        const scriptAt = rest.findIndex((arg) => !arg.startsWith("-"));
        const script = scriptAt === -1 ? "" : rest[scriptAt]!;
        return checkScript(script, rest.slice(scriptAt + 1), `npm run ${script}`);
      }
      const verb = operands[0] ?? "";
      return NPM_CHANGES_PACKAGES.has(verb) ? `„npm ${verb}“ verändert Abhängigkeiten.` : null;
    }
    case "npx":
      return ["tsc", "vitest"].includes(operands[0] ?? "") ? null
        : `„npx ${operands[0] ?? ""}“ kann Pakete laden. Erlaubt sind „npx tsc“ und „npx vitest“.`;
    case "pnpm": case "yarn": case "bun":
      return `„${command}“ wird in diesem Projekt nicht benutzt.`;
    case "node":
      return checkNode(args);
    case "git": {
      let index = 0;
      while (index < args.length && args[index]!.startsWith("-")) index += ["-C", "-c"].includes(args[index]!) ? 2 : 1;
      const sub = args[index] ?? "";
      const tail = args.slice(index + 1);
      if (GIT_READ_ONLY.has(sub)) return null;
      if (sub === "branch" && tail.every((arg) => arg.startsWith("-") && !/^-[dDmMcC]$|^--(delete|move|copy)/.test(arg))) return null;
      if (sub === "stash" && ["list", "show"].includes(tail[0] ?? "")) return null;
      return `„git ${sub}“ verändert das Repository. Erlaubt sind nur lesende Git-Befehle (status, log, diff, show, …).`;
    }
    case "gh":
      return "Die GitHub-CLI ist gesperrt - der Prüfer veröffentlicht nichts.";
    case "sed":
    case "perl":
      return args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith("--in-place"))
        ? "In-Place-Bearbeitung (sed -i, perl -i) ist dem Prüfer nicht erlaubt." : null;
    case "rm": case "rmdir": case "del": case "erase": case "rd": case "touch": case "mkdir": case "md":
    case "truncate": case "unlink": case "shred": case "mv": case "move": case "tee": {
      const outside = outsideTemp(operands);
      return outside === undefined ? null : `„${command} ${outside}“ würde außerhalb des Temp-Verzeichnisses schreiben.`;
    }
    case "chmod": case "chown": {
      const outside = outsideTemp(operands.slice(1));
      return outside === undefined ? null : `„${command} ${outside}“ verändert eine Datei außerhalb des Temp-Verzeichnisses.`;
    }
    case "cp": case "copy": case "ln": case "install": {
      const target = operands.at(-1);
      return target === undefined || isTemp(target) ? null
        : `„${command}“ nach „${target}“ schreibt außerhalb des Temp-Verzeichnisses.`;
    }
    case "dd": {
      const output = args.find((arg) => arg.startsWith("of="));
      return output === undefined || isTemp(output.slice(3)) ? null : "„dd of=…“ schreibt außerhalb des Temp-Verzeichnisses.";
    }
    case "find": {
      const destructive = args.includes("-delete")
        || args.some((arg, index) => ["-exec", "-execdir", "-ok"].includes(arg) && !["grep", "cat", "head", "wc", "ls"].includes(args[index + 1] ?? ""));
      const root = operands[0] ?? ".";
      return destructive && !isTemp(root) ? "„find“ mit -delete oder -exec ist außerhalb des Temp-Verzeichnisses gesperrt." : null;
    }
    case "sqlite3":
      return args.includes("-readonly") ? null : "„sqlite3“ nur mit -readonly.";
    default:
      return null;
  }
}

const POWERSHELL_WRITES = /\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content|Clear-Item|Export-Csv|Tee-Object)\b([^|;\n]*)/gi;
const DOTNET_WRITES = /\[(?:System\.)?IO\.(?:File|Directory)\]::(Write\w*|Append\w*|Delete|Move|Copy|Create\w*|Replace)\s*\(/gi;
const FS_WRITES = /\b(writeFileSync|appendFileSync|writeFile|appendFile|rmSync|rmdirSync|unlinkSync|renameSync|copyFileSync|cpSync|mkdirSync|truncateSync|createWriteStream)\s*\(/g;
/** Kopieren schreibt nur ins zweite Argument; Verschieben verändert Quelle und Ziel. */
const TARGET_IS_SECOND = new Set(["copyFileSync", "cpSync", "Copy"]);
const TARGET_IS_BOTH = new Set(["renameSync", "Move", "Replace"]);

/**
 * Die Argumente eines Aufrufs ab seiner öffnenden Klammer, mit Klammerzählung und Zeichenketten -
 * sonst endete `writeFileSync(path.join(os.tmpdir(), "x"), …)` an der ersten schließenden Klammer.
 */
function callArguments(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let index = open + 1; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote) {
      current += char;
      if (char === quote && code[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if ("([{".includes(char)) {
      depth += 1;
    } else if (")]}".includes(char)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (char === "," && depth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  args.push(current);
  return args;
}

/** Die Pfade, die ein Aufruf verändert; sein Name steht in `match[1]`, die Klammer am Ende von `match[0]`. */
function callTargets(code: string, match: RegExpExecArray): string[] {
  const args = callArguments(code, match.index + match[0].length - 1);
  const name = match[1]!;
  if (TARGET_IS_BOTH.has(name)) return [args[0] ?? "", args[1] ?? ""];
  return [(TARGET_IS_SECOND.has(name) ? args[1] : args[0]) ?? ""];
}
const SQL_WRITES = /\b(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE|CREATE\s+(TEMP\s+|TEMPORARY\s+)?(TABLE|INDEX|VIEW|TRIGGER)|REPLACE\s+INTO|VACUUM|ATTACH\s+DATABASE)\b/i;

/** Prüft ausgeführten Code (Heredoc-Skripte, `node -e`): Datenbank, Dateien, Schlüssel, Aufrufe. */
function checkCode(code: string): string | null {
  if (API_HOST.test(code)) return `Direkte Aufrufe von API-Football sind gesperrt. ${LOCAL_ONLY}`;
  if (/['"`]([^'"`\n]*[\\/])?\.env['"`]/.test(code)) return ENV_LOCKED;
  if (/\bnew\s+AnalyzerDatabase\s*\(/.test(code)) {
    return "AnalyzerDatabase öffnet die Datenbank schreibend. Lies sie mit "
      + "new DatabaseSync(pfad, { readOnly: true }) aus node:sqlite.";
  }
  for (const match of code.matchAll(/new\s+DatabaseSync\s*\(/g)) {
    const call = code.slice(match.index ?? 0, (match.index ?? 0) + 400).split(/;|\n\s*\n/)[0]!;
    if (!/readOnly\s*:\s*true/.test(call)) return "Die Datenbank nur lesend öffnen: new DatabaseSync(pfad, { readOnly: true }).";
  }
  if (/DatabaseSync|sqlite/i.test(code) && SQL_WRITES.test(code)) {
    return "Schreibende SQL-Anweisungen sind gesperrt - der Prüfer liest nur.";
  }
  for (const match of code.matchAll(FS_WRITES)) {
    const target = callTargets(code, match).find((value) => !isTemp(value));
    if (target !== undefined) {
      return `„${match[1]}(${target.trim()}, …)“ hat kein erkennbares Temp-Ziel. Schreibe nur auf einen festen Pfad `
        + "unter /tmp oder mit path.join(os.tmpdir(), …).";
    }
  }
  for (const match of code.matchAll(/\bnpm\s+run\s+([\w:-]+)/g)) {
    const reason = BLOCKED_SCRIPTS[match[1]!];
    if (reason) return `„npm run ${match[1]}“ ${reason}, auch aus einem Skript heraus. ${LOCAL_ONLY}`;
  }
  for (const match of code.matchAll(/src[\\/]cli\.ts['"]?\s*,?\s*['"]?([\w-]+)/g)) {
    if (match[1] !== "report") return `„src/cli.ts ${match[1]}“ ruft API-Football auf oder schreibt, auch aus einem Skript heraus.`;
  }
  return null;
}

export function checkCommand(command: string): string | null {
  const structural = substituteVariables(stripHeredocs(command));
  const { segments, redirects } = parseShell(structural);
  const target = redirects.find((value) => !isTemp(value));
  if (target !== undefined) {
    return `Schreiben nach „${target}“ ist gesperrt. Hilfsdateien gehören ins Temp-Verzeichnis (/tmp, $TEMP).`;
  }
  for (const match of structural.matchAll(POWERSHELL_WRITES)) {
    if (!isTemp(match[2] ?? "")) return `„${match[1]}“ ohne Temp-Ziel ist gesperrt. Hilfsdateien gehören nach $env:TEMP.`;
  }
  for (const match of structural.matchAll(DOTNET_WRITES)) {
    if (callTargets(structural, match).some((value) => !isTemp(value))) return `„[IO.File]::${match[1]}“ ohne Temp-Ziel ist gesperrt.`;
  }
  for (const words of segments) {
    const reason = checkSegment(words);
    if (reason) return reason;
  }
  return runsCode(command) ? checkCode(substituteVariables(command)) : null;
}

export function checkReadPath(filePath: string): string | null {
  const base = path.basename(filePath.replaceAll("\\", "/"));
  return /^\.env(\.(?!example$)[\w.-]+)?$/.test(base) ? ENV_LOCKED : null;
}

export function checkToolCall(input: HookInput): string | null {
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const command = input.tool_input?.command;
  const filePath = input.tool_input?.file_path;
  const searchPath = input.tool_input?.path;
  if (tool === "Read") return typeof filePath === "string" ? checkReadPath(filePath) : null;
  // Grep lässt .env über .gitignore aus - außer man nennt die Datei ausdrücklich.
  if (tool === "Grep") return typeof searchPath === "string" ? checkReadPath(searchPath) : null;
  if (tool === "Bash" || tool === "PowerShell") {
    return typeof command === "string" ? checkCommand(command) : "Befehl nicht lesbar - vorsorglich gesperrt.";
  }
  return null;
}

function main(): void {
  let reason: string | null;
  try {
    // Eine Byte-Order-Mark am Anfang (so leitet etwa PowerShell 5.1 weiter) ist kein Grund zu sperren.
    reason = checkToolCall(JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, "")) as HookInput);
  } catch {
    reason = "Der Aufruf war für den Wächter nicht lesbar - vorsorglich gesperrt.";
  }
  if (reason) {
    process.stderr.write(`Gesperrt vom Wächter des Prüfers: ${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

// Direkt gestartet (als Hook) statt importiert (vom Test)? Über den Dateinamen verglichen, nicht
// über den ganzen Pfad: Claude Code setzt den Projektpfad unter Windows mal mit c:, mal mit C: ein.
if (path.basename(process.argv[1] ?? "").toLowerCase() === path.basename(fileURLToPath(import.meta.url)).toLowerCase()) main();
