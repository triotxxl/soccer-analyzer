import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DashboardDocument } from "../../shared/src/types";

const DOCUMENT = {
  schemaVersion: 8,
  meta: { createdAt: "2026-10-19T08:00:00.000Z", timezone: "Europe/Berlin" },
  fixtures: [{
    fixtureId: 1,
    kickoff: "2026-10-19T18:30:00.000Z",
    country: "Germany",
    league: "Bundesliga",
    homeTeam: "Heim FC",
    awayTeam: "Gast FC",
    markets: []
  }]
} as unknown as DashboardDocument;

describe("Neo Dashboard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("zeigt die Spiele aus dem Snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(DOCUMENT), { status: 200 })));
    render(<App />);
    expect(await screen.findByText("Heim FC")).toBeInTheDocument();
    expect(screen.getByText("Gast FC")).toBeInTheDocument();
    expect(screen.getByText(/1 Spiele/)).toBeInTheDocument();
  });

  it("meldet, wenn noch keine Analyse vorhanden ist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    render(<App />);
    expect(await screen.findByRole("status")).toHaveTextContent("Noch keine Analyse vorhanden");
  });
});
