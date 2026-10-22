import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { dataEndpoints } from "../shared/server/endpoints.ts";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appDirectory,
  plugins: [react(), ...dataEndpoints()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: {
    outDir: path.resolve(appDirectory, "../../dist/neo"),
    emptyOutDir: true
  },
  test: {
    name: "neo",
    environment: "jsdom",
    setupFiles: "../shared/vitest.setup.ts",
    css: true,
    // Node ab 25: eigenes localStorage überdeckt das von jsdom (Begründung in apps/shared/vitest.config.ts).
    execArgv: ["--no-experimental-webstorage"]
  }
});
