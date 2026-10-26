/**
 * Hält `docs/stack-karte.html` beim Stand des Repositorys (Davids Wunsch vom 26.10.2026: die
 * veröffentlichte Karte soll immer aktuell sein). Geprüft werden nur Namen und Pfade - was neu
 * dazukommt, muss auf der Karte stehen, und was die Karte nennt, muss es noch geben. Abläufe,
 * Budgets und Zusammenhänge sieht der Test nicht; die zieht nach, wer sie ändert.
 *
 * Schlägt ein Fall fehl: Karte ergänzen, Datum im Kopf setzen und neu veröffentlichen
 * (AGENTS.md, Abschnitt „Stack-Karte“).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { embeddedQuickpickData, quickpickMapData } from "../tools/stack-karte-data.ts";

const PAGE_FILE = "docs/stack-karte.html";
const page = readFileSync(PAGE_FILE, "utf8");
const HINT = `${PAGE_FILE} nachziehen und neu veröffentlichen (AGENTS.md, Abschnitt „Stack-Karte“)`;

/** Pfade, die die Karte bewusst als entfernt nennt. */
const REMOVED_PATHS = ["apps/analyzer"];

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

function directories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function assertAllShown(kind: string, names: string[], shown: (name: string) => boolean): void {
  const missing = names.filter((name) => !shown(name));
  assert.deepEqual(missing, [], `${kind} fehlen auf der Karte: ${missing.join(", ")} - ${HINT}`);
}

describe("Stack-Karte", () => {
  it("führt jedes npm-Script in der Befehlsliste", () => {
    assertAllShown("npm-Scripts", Object.keys(packageJson.scripts), (name) => page.includes(`<td><code>${name}</code></td>`));
  });

  it("nennt nur npm-Scripts, die es gibt", () => {
    const listed = [...page.matchAll(/<td><code>([\w:-]+)<\/code><\/td>/g)].map((match) => match[1]!);
    const called = [...page.matchAll(/npm run ([a-z][\w:-]*)/g)].map((match) => match[1]!);
    const unknown = [...new Set([...listed, ...called])].filter((name) => !(name in packageJson.scripts));
    assert.deepEqual(unknown, [], `Die Karte nennt Befehle, die es nicht mehr gibt: ${unknown.join(", ")} - ${HINT}`);
  });

  it("nennt jedes Paket", () => {
    const packages = [...Object.keys(packageJson.dependencies), ...Object.keys(packageJson.devDependencies)];
    // @types/* und @testing-library/* stehen als Gruppe auf der Karte.
    assertAllShown("Pakete", packages, (name) =>
      page.includes(name)
      || (name.startsWith("@types/") && page.includes("@types/*"))
      || (name.startsWith("@testing-library/") && page.includes("@testing-library/*")));
  });

  it("nennt jede Tabelle der Datenbank", () => {
    const tables = new Set<string>();
    for (const file of readdirSync("src").filter((name) => name.endsWith(".ts"))) {
      for (const match of readFileSync(`src/${file}`, "utf8").matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) tables.add(match[1]!);
    }
    assert.ok(tables.size > 0, "keine Tabellen in src/ gefunden");
    assertAllShown("Tabellen", [...tables], (name) => page.includes(`<code>${name}</code>`));
  });

  it("nennt jeden Skill, Agenten und Hook des Projekts und jede App", () => {
    assertAllShown("Skills", directories(".claude/skills"), (name) => page.includes(`<code>${name}</code>`));
    assertAllShown("Agenten", readdirSync(".claude/agents").map((file) => file.replace(/\.md$/, "")), (name) => page.includes(name));
    assertAllShown("Hooks", readdirSync(".claude/hooks"), (name) => page.includes(name));
    assertAllShown("Apps", directories("apps"), (name) => page.includes(`apps/${name}`));
  });

  it("nennt nur Pfade, die es im Repository gibt", () => {
    // Nur versionierte Ordner; data/ und output/ fehlen auf einem frischen Klon. Ein `~/` davor meint
    // das Benutzerverzeichnis, ein `*` dahinter ein Muster.
    const pattern = /(?<![\w~/.-])((?:src|tools|apps|test|docs|\.claude)\/[\w./-]*)(\*?)/g;
    const missing = new Set<string>();
    for (const match of page.matchAll(pattern)) {
      const found = match[1]!.replace(/\.$/, "");
      const path = match[2] ? found.slice(0, found.lastIndexOf("/") + 1) : found;
      if (REMOVED_PATHS.some((removed) => path.startsWith(removed))) continue;
      if (!existsSync(path)) missing.add(path);
    }
    assert.deepEqual([...missing], [], `Die Karte nennt Pfade, die es nicht mehr gibt: ${[...missing].join(", ")} - ${HINT}`);
  });

  it("zeigt die Filterregeln so, wie sie im Code stehen", () => {
    assert.deepEqual(embeddedQuickpickData(page), quickpickMapData(),
      `Die Filterregeln auf der Karte sind veraltet - npm run stack-karte ausführen und neu veröffentlichen`);
  });

  it("beschriftet jeden Filter und jeden Regler", () => {
    const data = quickpickMapData();
    assertAllShown("Filter (FILTER_INFO)", data.presets.map((preset) => preset.id), (id) => page.includes(`"${id}": { tip:`));
    const keys = new Set(data.presets.flatMap((preset) => Object.keys(preset.defaults)).filter((key) => key !== "preset" && key !== "limit"));
    assertAllShown("Regler (PARAM_LABELS)", [...keys], (key) => page.includes(`  ${key}: "`));
  });

  it("nennt jede Stelle, an der die Filter greifen", () => {
    // Wer `src/quickpick.ts` einbindet, wendet die Filter an. Die Karte selbst zählt nicht.
    const users: string[] = [];
    for (const dir of ["src", "tools", "test", "apps"]) {
      for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
        const file = `${entry.parentPath.replace(/\\/g, "/")}/${entry.name}`;
        if (file.includes("node_modules") || file.startsWith("src/quickpick") || file.startsWith("tools/stack-karte")) continue;
        if (/from "[./]*(?:src\/)?quickpick(?:\.ts)?"/.test(readFileSync(file, "utf8"))) users.push(file);
      }
    }
    assertAllShown("Nutzer der Filter (Abschnitt „Quickpick-Filter“)", users, (file) => page.includes(`<code>${file}</code>`));
  });

  it("nennt die aktuelle Snapshot- und Modellversion", () => {
    const schema = /schemaVersion: (\d+),/.exec(readFileSync("src/dashboard.ts", "utf8"))?.[1];
    const model = /goalLineModelVersion: "([\d.]+)"/.exec(readFileSync("src/config.ts", "utf8"))?.[1];
    assert.ok(schema && model, "Versionen in src/dashboard.ts bzw. src/config.ts nicht gefunden");
    assert.ok(page.includes(`schemaVersion: ${schema}`), `Snapshot-Version ${schema} fehlt auf der Karte - ${HINT}`);
    assert.ok(page.includes(`goalLineModelVersion</code> ${model}`), `Modellversion ${model} fehlt auf der Karte - ${HINT}`);
  });
});
