import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const frontendDirectory = path.dirname(fileURLToPath(import.meta.url));
const latestDashboard = path.resolve(frontendDirectory, "../output/dashboard-latest.json");

function dashboardEndpoint(): Plugin {
  const handler = async (_request: unknown, response: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }) => {
    try {
      const data = await readFile(latestDashboard, "utf8");
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store, max-age=0");
      response.end(data);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      response.statusCode = code === "ENOENT" ? 404 : 500;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: code === "ENOENT" ? "dashboard_missing" : "dashboard_unavailable" }));
    }
  };
  return {
    name: "dashboard-data-endpoint",
    configureServer(server) {
      server.middlewares.use("/api/dashboard/latest", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/dashboard/latest", handler);
    }
  };
}

export default defineConfig({
  root: frontendDirectory,
  plugins: [react(), dashboardEndpoint()],
  build: {
    outDir: path.resolve(frontendDirectory, "../dist/frontend"),
    emptyOutDir: true
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/vitest.setup.ts",
    css: true
  }
});
