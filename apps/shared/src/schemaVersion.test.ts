import { readFileSync } from "node:fs";
import path from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LATEST_SCHEMA_VERSION, useDashboardData } from "./data";

afterEach(() => vi.unstubAllGlobals());

const snapshot = (schemaVersion: number) =>
  ({ schemaVersion, meta: { createdAt: "2026-11-10T20:00:00.000Z", timezone: "Europe/Berlin" }, fixtures: [] });

describe("Fassung des Snapshots", () => {
  // Am 10.11.2026 ließen die Apps nur 1-15 zu; ein Snapshot 16 hätte beide Apps leer gelassen.
  it("liest genau die Fassung, die die Analyse schreibt", () => {
    const writer = readFileSync(path.resolve(__dirname, "../../../src/dashboard.ts"), "utf8");
    expect(Number(writer.match(/\bschemaVersion: (\d+),/)?.[1])).toBe(LATEST_SCHEMA_VERSION);
  });

  it.each([[LATEST_SCHEMA_VERSION, "ready"], [LATEST_SCHEMA_VERSION + 1, "error"]])("Fassung %i: %s", async (version, status) => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(snapshot(version)), { status: 200 }))));
    const { result } = renderHook(() => useDashboardData(60_000));
    await waitFor(() => expect(result.current.status).toBe(status));
  });
});
