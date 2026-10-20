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
    css: true
  }
});
