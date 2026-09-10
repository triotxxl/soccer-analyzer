import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { InsightsError, insightsService } from "../src/insights-service.ts";
import { MarketProfileError, marketProfileService } from "../src/market-profile-service.ts";
import { LiveError, liveService } from "../src/live-service.ts";

const frontendDirectory = path.dirname(fileURLToPath(import.meta.url));
const latestDashboard = path.resolve(frontendDirectory, "../output/dashboard-latest.json");

interface ServerResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.end(JSON.stringify(body));
}

function dashboardEndpoint(): Plugin {
  const handler = async (_request: unknown, response: ServerResponse) => {
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

/**
 * Der API-Schlüssel bleibt serverseitig. Vite lädt .env nur für VITE_-Variablen in den
 * Client, deshalb wird die Datei hier einmalig in process.env übernommen.
 */
function loadApiKey(): void {
  if (process.env.API_FOOTBALL_KEY) return;
  try {
    process.loadEnvFile(path.resolve(frontendDirectory, "../.env"));
  } catch {
    // Ohne .env meldet der Live-Endpoint einen klaren Fehler an die App.
  }
}

loadApiKey();

/**
 * Die App meldet, welche Partien sie beobachtet. Nur diese werden abgefragt - ein
 * abgewählter Wettbewerb kostet dadurch keine API-Aufrufe mehr.
 */
function watchedFixtures(url: string | undefined): number[] | undefined {
  if (!url) return undefined;
  const raw = new URLSearchParams(url.split("?")[1] ?? "").get("fixtures");
  if (!raw) return undefined;
  const ids = raw.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? ids : undefined;
}

function liveEndpoint(): Plugin {
  const handler = async (request: { url?: string }, response: ServerResponse) => {
    try {
      sendJson(response, 200, await liveService().getBoard(watchedFixtures(request.url)));
    } catch (error) {
      if (error instanceof LiveError) {
        sendJson(response, error.status, { error: error.code, message: error.message });
        return;
      }
      sendJson(response, 500, {
        error: "live_unavailable",
        message: error instanceof Error ? error.message : "Live-Daten sind nicht verfügbar."
      });
    }
  };
  return {
    name: "live-data-endpoint",
    configureServer(server) {
      server.middlewares.use("/api/live/board", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/live/board", handler);
    }
  };
}

/**
 * Die Detailkennzahlen einer Partie werden erst geladen, wenn die App sie aufklappt.
 * Ohne aufgeklappte Partie entsteht kein einziger Aufruf.
 */
function insightsEndpoint(): Plugin {
  const handler = async (request: { url?: string }, response: ServerResponse) => {
    const raw = new URLSearchParams(request.url?.split("?")[1] ?? "").get("fixture");
    const fixtureId = Number(raw);
    if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
      sendJson(response, 400, { error: "fixture_unknown", message: "Es fehlt eine gültige Fixture-ID." });
      return;
    }
    try {
      sendJson(response, 200, await insightsService().get(fixtureId));
    } catch (error) {
      if (error instanceof InsightsError) {
        sendJson(response, error.status, { error: error.code, message: error.message });
        return;
      }
      sendJson(response, 500, {
        error: "insights_unavailable",
        message: error instanceof Error ? error.message : "Die Detailkennzahlen sind nicht verfügbar."
      });
    }
  };
  return {
    name: "fixture-insights-endpoint",
    configureServer(server) {
      server.middlewares.use("/api/fixture/insights", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/fixture/insights", handler);
    }
  };
}

/**
 * Das Marktprofil kommt aus den lokalen Snapshots und der Datenbank - kein API-Aufruf, aber
 * das Einlesen von rund fuenfzig Dateien. Der Dienst haelt das Ergebnis deshalb, bis sich
 * Datenbank oder Snapshot-Ordner aendern.
 */
function marketProfileEndpoint(): Plugin {
  const handler = async (_request: unknown, response: ServerResponse) => {
    try {
      sendJson(response, 200, marketProfileService().get());
    } catch (error) {
      if (error instanceof MarketProfileError) {
        sendJson(response, error.status, { error: error.code, message: error.message });
        return;
      }
      sendJson(response, 500, {
        error: "market_profile_unavailable",
        message: error instanceof Error ? error.message : "Das Marktprofil ist nicht verfuegbar."
      });
    }
  };
  return {
    name: "market-profile-endpoint",
    configureServer(server) {
      server.middlewares.use("/api/market-profile", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/market-profile", handler);
    }
  };
}

export default defineConfig({
  root: frontendDirectory,
  plugins: [react(), dashboardEndpoint(), liveEndpoint(), insightsEndpoint(), marketProfileEndpoint()],
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
