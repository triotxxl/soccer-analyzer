import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { checkCommand, checkReadPath, checkToolCall, isTemp, parseShell, stripHeredocs } from "../.claude/hooks/pruefer-waechter.ts";

const SCRATCH = "C:/Users/David/AppData/Local/Temp/claude/sitzung/scratchpad";
const allowed = (command: string) => assert.equal(checkCommand(command), null, command);
const blocked = (command: string, hint: RegExp) => {
  const reason = checkCommand(command);
  assert.ok(reason !== null, `nicht gesperrt: ${command}`);
  assert.match(reason, hint, command);
};

test("Befehle aus echten Prüfungen bleiben erlaubt", () => {
  allowed(`cd "C:/Users/David/Desktop/Projects/api-football-analyzer" && node --test --test-concurrency=1 test/elo.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖" | head`);
  allowed("npm run typecheck 2>&1 | tail -5");
  allowed("npm test 2>&1 | grep -E \"Tests \"");
  allowed("npm run elo -- team 64 --games 3 2>&1 | tail -6");
  allowed("npm run elo -- ranking --top 25");
  allowed("npm run elo-backtest -- --test-start 2025-01-01 --test-end 2025-12-31");
  allowed("npm run quickpick-report -- --preset hz15");
  allowed("npm run edge-report -- --simulate");
  allowed("npm run report");
  allowed("git status --short && git diff --stat && git log -1 --oneline");
  allowed("git -C \"C:/repo\" --no-pager log --oneline -5");
  allowed("git branch -a");
  allowed("tasklist 2>/dev/null | grep -i node | head");
  allowed(`S="${SCRATCH}"; date; ls -la "$S"/bt-*.txt; cat "$S"/bt-2025.txt`);
  allowed(`S="${SCRATCH}"; until [ -s "$S/a.txt" ]; do sleep 15; done; cat "$S/a.txt"`);
  allowed(`S="${SCRATCH}"; (node "$S/vergleich.ts" 2025-01-01 2025-12-31 > "$S/bt-2025.txt" 2>&1 &); echo gestartet`);
  allowed("grep -rn \"writeFileSync(\" tools/*.ts | head");
  allowed("grep -n \"new DatabaseSync(\" src/database.ts");
  allowed("grep -rn \"npm run dashboard\" AGENTS.md");
  allowed("grep -n \"\\.env\" src/config.ts");
  allowed("node --env-file-if-exists=.env tools/elo.ts ranking");
  allowed("node --env-file-if-exists=.env src/cli.ts report");
  allowed("rm -f \"$TEMP/probe.ts\" 2>/dev/null");
  allowed("T=\"$(mktemp -d)\"; printf 'x' > \"$T/probe.ts\"; node \"$T/probe.ts\"; rm -rf \"$T\"");
  allowed("awk '$3 > 5 { print $1 }' data.txt");
  allowed("node -e \"console.log(require('./package.json').type)\"");
});

test("ein Heredoc-Skript, das nur liest, bleibt erlaubt - sein Inhalt zählt nicht als Befehl", () => {
  allowed(`S="${SCRATCH}"
cat > "$S/abfrage.ts" <<'EOF'
import { DatabaseSync } from "node:sqlite";
import { classifyMatch } from "file:///C:/Users/David/Desktop/Projects/api-football-analyzer/src/elo-competitions.ts";
const db = new DatabaseSync("C:/Users/David/Desktop/Projects/api-football-analyzer/data/analyzer.sqlite", { readOnly: true });
const rows = db.prepare("SELECT elo FROM elo_ratings WHERE elo > 1500").all() as any[];
if (rows.length > 3) console.log(rows.map((r) => r.elo > 2000 ? "stark" : "normal"));
EOF
node "$S/abfrage.ts" 2>&1 | grep -v ExperimentalWarning`);
});

test("Befehle mit API-Kosten werden gesperrt", () => {
  blocked("npm run dashboard -- --dates next48", /API-Football/);
  blocked("npm run settle -- --budget 50", /API-Football/);
  blocked("npm run draw -- --select \"Deutschland|Bundesliga\" --dates both", /API-Football/);
  blocked("npm --prefix . run goals", /API-Football/);
  blocked("node --env-file-if-exists=.env src/cli.ts dashboard --dates next48", /report/);
  blocked("node tools/insights-probe.ts 1234", /API-Football/);
  blocked("npm run elo -- update --top-up", /ranking/);
  blocked("npm run elo -- import", /ranking/);
  blocked("curl -H \"x-apisports-key: abc\" https://v3.football.api-sports.io/fixtures?id=1", /API-Football/);
  blocked("npm run neues-skript", /nicht bekannt/);
  blocked(`cat > /tmp/x.ts <<'EOF'
import { execSync } from "node:child_process";
execSync("npm run dashboard -- --dates next48");
EOF
node /tmp/x.ts`, /API-Football/);
});

test("Schreiben in Datenbank, Repository und Git wird gesperrt", () => {
  blocked("npm run elo -- build", /ranking/);
  blocked("npm run quickpick-report -- --write", /Kalibrierpunkt/);
  blocked("npm run edge-report -- --simulate --json docs/edge.json", /Temp/);
  blocked("npm run backfill-results -- --scan", /Datenbank/);
  blocked("echo x > src/foo.ts", /src\/foo\.ts/);
  blocked("node skript.ts >> AGENTS.md", /AGENTS\.md/);
  blocked("sed -i 's/a/b/' src/elo.ts", /In-Place/);
  blocked("rm -rf output/", /output/);
  blocked("cp /tmp/x.ts src/x.ts", /src\/x\.ts/);
  blocked("find src -name '*.bak' -delete", /find/);
  blocked("echo x | tee docs/notiz.md", /tee/);
  blocked("git commit -m \"Elo\"", /git commit/);
  blocked("git add -A && git status", /git add/);
  blocked("git branch neuer-zweig", /git branch/);
  blocked("git stash", /git stash/);
  blocked("gh pr create --fill", /GitHub/);
  blocked("npm install lodash", /Abhängigkeiten/);
  blocked("npx vite build", /npx vite/);
  blocked("Set-Content -Path src\\x.ts -Value 1", /Set-Content/);
  blocked(`node -e "require('fs').writeFileSync('src/x.ts', '')"`, /writeFileSync/);
  // Verschachtelte Aufrufe zählen nur, wenn das Ziel wirklich im Temp-Verzeichnis liegt.
  blocked(`node -e "require('fs').writeFileSync(require('path').join(process.cwd(), 'src', 'x.ts'), '')"`, /writeFileSync/);
  // Verschieben ins Temp-Verzeichnis löscht die Quelle im Repository.
  blocked(`node -e "require('fs').renameSync('src/elo.ts', '/tmp/elo.ts')"`, /renameSync/);
  blocked("[IO.File]::WriteAllText('C:\\repo\\src\\x.ts', 'x')", /IO\.File/);
  blocked(`node -e "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync('data/analyzer.sqlite').exec('DELETE FROM elo_ratings')"`, /nur lesend/);
  blocked(`cat > /tmp/y.ts <<'EOF'
import { AnalyzerDatabase } from "file:///C:/Users/David/Desktop/Projects/api-football-analyzer/src/database.ts";
new AnalyzerDatabase().setEloMeta("lastTopUp", "0");
EOF
node /tmp/y.ts`, /AnalyzerDatabase/);
  blocked(`cat > /tmp/z.ts <<'EOF'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("data/analyzer.sqlite", { readOnly: true });
db.exec("UPDATE elo_meta SET value = '0'");
EOF
node /tmp/z.ts`, /SQL/);
});

test("Schreiben ins Temp-Verzeichnis bleibt erlaubt", () => {
  allowed("echo x > /tmp/notiz.txt");
  allowed("npm run edge-report -- --simulate --json /tmp/edge.json");
  allowed(`Out-File -FilePath $env:TEMP\\x.txt -InputObject 1`);
  allowed("New-Item -ItemType Directory -Force -Path $env:TEMP\\pruefer");
  allowed(`node -e "require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'x.json'), '{}')"`);
  allowed(`node -e "require('fs').copyFileSync('src/elo.ts', '/tmp/elo-kopie.ts')"`);
  allowed("[IO.File]::WriteAllText((Join-Path $env:TEMP 'x.txt'), 'x')");
  allowed(`mkdir -p "${SCRATCH}/pruefer" && cp src/elo.ts "${SCRATCH}/pruefer/"`);
});

test(".env bleibt ungelesen - als Datei, im Befehl und im Skript", () => {
  assert.match(checkReadPath("C:\\Users\\David\\Desktop\\Projects\\api-football-analyzer\\.env") ?? "", /API-Schlüssel/);
  assert.equal(checkReadPath("C:/repo/.env.example"), null);
  assert.equal(checkReadPath("C:/repo/src/config.ts"), null);
  blocked("cat .env", /API-Schlüssel/);
  blocked("Get-Content C:\\repo\\.env", /API-Schlüssel/);
  blocked(`node -e "console.log(require('fs').readFileSync('.env', 'utf8'))"`, /API-Schlüssel/);
});

test("Bausteine: Temp-Pfade, Heredocs, Umleitungen", () => {
  assert.ok(isTemp("C:\\Users\\David\\AppData\\Local\\Temp\\x.ts"));
  assert.ok(isTemp("/tmp/x"));
  assert.ok(isTemp("$env:TEMP\\x"));
  assert.ok(isTemp("/dev/null"));
  assert.ok(!isTemp("src/elo.ts"));
  assert.ok(!isTemp("C:/Users/David/Desktop/Projects/api-football-analyzer/output/x.json"));
  assert.equal(stripHeredocs("cat > /tmp/a <<'EOF'\nrm -rf src\nEOF\necho fertig"), "cat > /tmp/a <<'EOF'\necho fertig");
  const parsed = parseShell("node a.ts 2>&1 > /tmp/log.txt | grep x; echo \"a > b\" >> out.txt");
  assert.deepEqual(parsed.redirects, ["/tmp/log.txt", "out.txt"]);
  assert.deepEqual(parsed.segments.map((words) => words[0]), ["node", "grep", "echo"]);
});

test("Werkzeuge ohne Befehl: Read und Grep nur auf .env gesperrt, unlesbare Aufrufe gesperrt", () => {
  assert.equal(checkToolCall({ tool_name: "Grep", tool_input: { command: "npm run dashboard" } }), null);
  assert.equal(checkToolCall({ tool_name: "Grep", tool_input: { path: "src" } }), null);
  assert.match(checkToolCall({ tool_name: "Grep", tool_input: { path: ".env" } }) ?? "", /API-Schlüssel/);
  assert.match(checkToolCall({ tool_name: "Read", tool_input: { file_path: "C:/repo/.env" } }) ?? "", /API-Schlüssel/);
  assert.match(checkToolCall({ tool_name: "Bash", tool_input: {} }) ?? "", /nicht lesbar/);
  assert.match(checkToolCall({ tool_name: "PowerShell", tool_input: { command: "npm run settle" } }) ?? "", /API-Football/);
});

test("als Hook: Rückgabe 2 mit Begründung sperrt, 0 lässt durch", () => {
  const script = path.resolve(".claude/hooks/pruefer-waechter.ts");
  const run = (input: string) => spawnSync(process.execPath, [script], { input, encoding: "utf8" });
  const stop = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm run dashboard" } }));
  assert.equal(stop.status, 2);
  assert.match(stop.stderr, /Gesperrt vom Wächter des Prüfers/);
  const go = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }));
  assert.equal(go.status, 0);
  assert.equal(go.stderr, "");
  assert.equal(run("kein json").status, 2);
  // Mit Byte-Order-Mark, wie PowerShell 5.1 weiterleitet.
  assert.equal(run(`﻿${JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } })}`).status, 0);
});
