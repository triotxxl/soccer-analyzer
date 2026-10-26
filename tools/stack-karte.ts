/**
 * Schreibt die Regeln der Quickpick-Filter aus `src/quickpick.ts` in `docs/stack-karte.html`.
 * Kein API-Aufruf, keine Datenbank. Danach die Karte neu veröffentlichen (AGENTS.md, „Stack-Karte“).
 *
 *   npm run stack-karte
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../src/config.ts";
import { QUICKPICK_BLOCK_END, QUICKPICK_BLOCK_START, quickpickBlock } from "./stack-karte-data.ts";

const file = path.join(ROOT_DIR, "docs", "stack-karte.html");
const page = readFileSync(file, "utf8");
const start = page.indexOf(QUICKPICK_BLOCK_START);
if (start === -1) throw new Error(`${file}: Block ${QUICKPICK_BLOCK_START} fehlt`);
const end = page.indexOf(QUICKPICK_BLOCK_END, start) + QUICKPICK_BLOCK_END.length;
const next = page.slice(0, start) + quickpickBlock() + page.slice(end);

if (next === page) {
  console.log("Stack-Karte: Filterregeln unverändert.");
} else {
  writeFileSync(file, next, "utf8");
  console.log("Stack-Karte: Filterregeln aktualisiert - jetzt neu veröffentlichen.");
}
