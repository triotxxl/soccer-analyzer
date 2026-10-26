import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ALLOWED_SCRIPTS, checkCommand, checkToolCall } from "../.claude/hooks/design-waechter.ts";

const allowed = (command: string) => assert.equal(checkCommand(command), null, command);
const blocked = (command: string, hint: RegExp) => {
  const reason = checkCommand(command);
  assert.ok(reason !== null, `nicht gesperrt: ${command}`);
  assert.match(reason, hint, command);
};

test("Arbeit an Neo bleibt erlaubt", () => {
  allowed("npm test 2>&1 | tail -5");
  allowed("npm run typecheck");
  allowed("npm run app:test -- apps/neo");
  allowed("npm run neo:build");
  allowed("npm run stack-karte");
  allowed("npx vitest run apps/neo/src/App.test.tsx");
  allowed("node tools/stack-karte.ts");
  allowed("git status --short && git diff --stat");
  allowed("ls apps/neo/src; cat apps/shared/src/types.ts | head -40");
});

test("API-Football und die Datenbank bleiben gesperrt", () => {
  blocked("npm run dashboard -- --dates next48", /API-Football/);
  blocked("npm run settle", /API-Football/);
  blocked("npm run neo", /gesperrt/);
  blocked("node --env-file-if-exists=.env src/cli.ts dashboard", /Kommandozeile/);
  blocked("node tools/prepare-analysis.ts --dates next48", /API-Football/);
  blocked("curl https://v3.football.api-sports.io/status", /Netz/);
  blocked("Invoke-WebRequest https://example.com", /Netz/);
});

test("Pakete und Git bleiben gesperrt", () => {
  blocked("npm install chart.js", /Pakete/);
  blocked("npx skills add pbakaus/impeccable", /nur vitest/);
  blocked("git commit -m x", /Hauptsitzung/);
  blocked("git push", /Hauptsitzung/);
});

/** Von David am 26.10.2026 freigegeben. */
test("die Engine von impeccable ist erlaubt", () => {
  allowed(".claude/skills/impeccable/scripts/impeccable context");
  allowed("sh C:\\repo\\.claude\\skills\\impeccable\\scripts\\impeccable detect apps/neo/src");
});

test(".env bleibt ungelesen", () => {
  assert.match(checkToolCall({ tool_name: "Read", tool_input: { file_path: "C:/repo/.env" } }) ?? "", /API-Schlüssel/);
  assert.equal(checkToolCall({ tool_name: "Read", tool_input: { file_path: "C:/repo/.env.example" } }), null);
});

/** Als Hook gestartet: Ohne die richtige Rückgabe sperrt Claude Code nichts (Node 24 gab unter Windows 127 zurück). */
test("als Hook gestartet gibt er 2 für gesperrt und 0 für erlaubt zurück", () => {
  const script = path.resolve(".claude/hooks/design-waechter.ts");
  const run = (command: string) => spawnSync(process.execPath, [script], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), encoding: "utf8" });
  const stop = run("npm run dashboard");
  assert.equal(stop.status, 2);
  assert.match(stop.stderr, /Gesperrt vom Wächter des Design-Agenten/);
  assert.equal(run("npm run typecheck").status, 0);
});

test("jedes erlaubte Skript gibt es", () => {
  const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
  for (const name of ALLOWED_SCRIPTS) assert.ok(name in scripts, `${name} fehlt in package.json`);
});
