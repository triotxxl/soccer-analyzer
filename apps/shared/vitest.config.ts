import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** Tests der gemeinsamen Bausteine; die Apps haben je eine eigene Konfiguration. */
export default defineConfig({
  root: path.dirname(fileURLToPath(import.meta.url)),
  plugins: [react()],
  test: {
    name: "shared",
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    css: true,
    // Node ab 25 bringt ein eigenes globales localStorage mit (Web Storage; ohne --localstorage-file
    // ohne Methoden). Es überdeckt das von jsdom, und jeder Test mit gemerkten Einstellungen scheiterte
    // an „localStorage.setItem is not a function“ (22.10.2026, Node 25.8.1 und 26.12.1). Dieselbe
    // Zeile steht in apps/analyzer/vite.config.ts und apps/neo/vite.config.ts.
    execArgv: ["--no-experimental-webstorage"]
  }
});
