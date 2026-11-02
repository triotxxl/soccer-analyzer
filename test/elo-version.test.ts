import assert from "node:assert/strict";
import test from "node:test";
import { ELO_CONFIG } from "../src/elo-config.ts";
import { eloRulesFingerprint } from "../src/elo-update.ts";

/**
 * Jede Fassung der Elo-Regeln hat genau eine Prüfsumme. Ändert sich eine Regel (Parameter,
 * Wettbewerbsliste, Zusammenführung, Ausschlussmuster), schlägt dieser Test fehl, bis
 * `ELO_CONFIG.version` steigt und die neue Fassung hier eingetragen ist. Ein alter Eintrag wird
 * nie geändert - sonst stünde dieselbe Versionsnummer für zwei verschiedene Rechnungen.
 * Bis 1.2.1 blieb die Version bei sechs Regeländerungen stehen (Prüfung vom 28.10.2026).
 */
const FINGERPRINTS: Record<string, string> = {
  "1.3.0": "ebd51b9145b6",
  "1.4.0": "6f136bfc3357"
};

test("die Elo-Version passt zu den Regeln", () => {
  const expected = FINGERPRINTS[ELO_CONFIG.version];
  assert.ok(expected, `Elo-Version ${ELO_CONFIG.version} fehlt in test/elo-version.test.ts - Prüfsumme ${eloRulesFingerprint()} eintragen`);
  assert.equal(eloRulesFingerprint(), expected,
    `Elo-Regeln geändert: ELO_CONFIG.version erhöhen und die neue Fassung mit ${eloRulesFingerprint()} eintragen`);
});
