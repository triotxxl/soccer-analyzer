import assert from "node:assert/strict";
import test from "node:test";
import { requireApiKey } from "../src/config.ts";

// Die lokale App lädt .env erst beim Start des Vite-Servers, also nach dem Import von
// config.ts. Ein zum Importzeitpunkt eingefrorener Schlüssel wäre dort immer leer.
test("liest den API-Schlüssel bei jedem Aufruf frisch aus der Umgebung", () => {
  const original = process.env.API_FOOTBALL_KEY;
  try {
    delete process.env.API_FOOTBALL_KEY;
    assert.throws(() => requireApiKey(), /API_FOOTBALL_KEY fehlt/);

    // Nachträglich gesetzt - genau der Fall beim Start des Vite-Servers.
    process.env.API_FOOTBALL_KEY = "nachtraeglich-gesetzt";
    assert.equal(requireApiKey(), "nachtraeglich-gesetzt");

    process.env.API_FOOTBALL_KEY = "";
    assert.throws(() => requireApiKey(), /API_FOOTBALL_KEY fehlt/);
  } finally {
    if (original === undefined) delete process.env.API_FOOTBALL_KEY;
    else process.env.API_FOOTBALL_KEY = original;
  }
});
