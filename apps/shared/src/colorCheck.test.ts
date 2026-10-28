import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrast, separation, tokensOf, VISIONS } from "./colorCheck";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** Dunkel = der erste :root-Block, hell = der Block unter :root[data-theme="light"]. */
function themes(css: string) {
  const dark = /:root\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const light = /:root\[data-theme="light"\]\{([^}]*)\}/.exec(css)?.[1] ?? "";
  return { dunkel: tokensOf(dark), hell: tokensOf(light) };
}
const THEMES = themes(read("apps/shared/styles/base.css"));

describe.each(Object.entries(THEMES))("Farben %s", (_, t) => {
  it("Schrift auf den Flächen erreicht 4,5:1", () => {
    for (const ground of ["surface", "surface-2"]) {
      for (const text of ["ink", "muted", "home", "away", "win", "loss"]) {
        expect(contrast(t[text], t[ground]), `--${text} auf --${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("Schrift auf den Füllungen erreicht 4,5:1", () => {
    expect(contrast(t["home-ink"], t.home)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["away-ink"], t.away)).toBeGreaterThanOrEqual(4.5);
    for (const fill of ["win-fill", "loss-fill", "tie-fill"]) expect(contrast("#ffffff", t[fill]), fill).toBeGreaterThanOrEqual(4.5);
  });

  // Heim/Gast trennt in Balken, Kästchen und Linien oft allein die Farbe; Sieg/Niederlage tragen
  // zusätzlich Buchstaben oder Beschriftung und kommen deshalb mit 14 aus. Gesucht wurde auf 20 und 15;
  // die Rundung auf ganze Hexwerte kostet bis zu einen Punkt.
  it.each([
    ["home", "away", 19], ["home", "draw", 15], ["away", "draw", 15],
    ["win", "loss", 14], ["win-fill", "loss-fill", 14]
  ] as const)("%s und %s bleiben auch bei Farbfehlsichtigkeit getrennt", (a, b, min) => {
    const s = separation(t[a], t[b]);
    for (const vision of VISIONS) expect(s[vision], `${a}/${b} ${vision}`).toBeGreaterThanOrEqual(min);
  });

  it("Gast sieht nicht aus wie Niederlage, Heim nicht wie Sieg", () => {
    expect(separation(t.away, t.loss).normal).toBeGreaterThanOrEqual(20);
    expect(separation(t.home, t.win).normal).toBeGreaterThanOrEqual(20);
  });
});

describe("Farben der Referenz", () => {
  it("stimmen mit der App überein", () => {
    expect(themes(read("docs/neo-referenz.html"))).toEqual(THEMES);
  });

  it("hell steht in beiden Blöcken gleich (Systemeinstellung und Schalter)", () => {
    const css = read("apps/shared/styles/base.css");
    const system = tokensOf(/:root:not\(\[data-theme="dark"\]\)\{([^}]*)\}/.exec(css)?.[1] ?? "");
    expect(system).toEqual(THEMES.hell);
  });
});
