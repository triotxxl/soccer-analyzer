/**
 * PostToolUse-Hook (Edit|Write, `.claude/settings.json`): Ändert die Hauptsitzung eine Regel der
 * Quickpick-Filter (`src/quickpick*.ts`, `src/kombi-tipps.ts`), schreibt er die Regeln sofort mit
 * `tools/stack-karte.ts` in `docs/stack-karte.html` und erinnert Claude daran, die Karte unter
 * derselben URL neu zu veröffentlichen (Davids Wunsch vom 26.10.2026). Veröffentlichen kann nur
 * Claude selbst, deshalb nur die Erinnerung. Scheitert der Lauf (Datei noch unfertig), blockiert
 * der Hook nichts und sagt nur, dass es nachzuholen ist.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ARTIFACT_URL = "https://claude.ai/artifact/9J2Abc4DKRZTt2W7TK9Vu3";
const RULE_FILE = /[\\/]src[\\/](?:quickpick[\w-]*|kombi-tipps)\.ts$/;

const input = JSON.parse(readFileSync(0, "utf8")) as {
  tool_input?: { file_path?: string };
  tool_response?: { filePath?: string };
};
const file = input.tool_input?.file_path ?? input.tool_response?.filePath ?? "";
if (!RULE_FILE.test(file)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const reply = (systemMessage: string, additionalContext: string) =>
  console.log(JSON.stringify({ systemMessage, hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }));

let output: string;
try {
  output = execFileSync(process.execPath, ["tools/stack-karte.ts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
  reply("Stack-Karte: Filterregeln konnten nicht geschrieben werden.",
    `Der Hook stack-karte-sync konnte \`npm run stack-karte\` nach der Änderung an ${file} nicht ausführen (${reason}). `
    + `Sobald die Regel fertig ist: \`npm run stack-karte\` ausführen und docs/stack-karte.html mit dem Artifact-Werkzeug `
    + `(url ${ARTIFACT_URL}) neu veröffentlichen.`);
  process.exit(0);
}

if (output.includes("unverändert")) process.exit(0);
reply("Stack-Karte: Filterregeln aktualisiert, Veröffentlichen steht aus.",
  `Der Hook stack-karte-sync hat die Filterregeln aus ${file} in docs/stack-karte.html geschrieben. `
  + `Bevor du die Antwort beendest: „Stand“-Datum im Kopf der Karte setzen und docs/stack-karte.html mit dem `
  + `Artifact-Werkzeug unter url ${ARTIFACT_URL} neu veröffentlichen (AGENTS.md, Abschnitt „Stack-Karte“).`);
