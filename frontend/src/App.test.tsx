import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DashboardDocument, DashboardFixture, DashboardMarket } from "./types";

function markets(level: "none" | "recommended" | "strong", probability = 0.72): DashboardMarket[] {
  return ([
    ["1x2", "1X2", "Heimsieg", "1"], ["draw", "Remis", "Unentschieden (X)", null],
    ["btts", "BTTS", "Beide Teams treffen: Ja", null], ["over15", "Über 1,5", "Mindestens 2 Tore", null],
    ["over25", "Über 2,5", "Mindestens 3 Tore", null]
  ] as const).map(([key, label, selection, pick]) => ({
    key, label, selection, pick, selectionTone: pick ? "home" : "neutral", probability,
    odds: 1.8, confidence: 85, score: key === "1x2" ? 75 : null,
    recommendation: { level, label: level === "strong" ? "Sehr empfehlenswert" : level === "recommended" ? "Empfehlenswert" : "Nicht empfehlenswert" },
    details: ["Testbegründung"]
  }));
}

function fixture(id: number, homeTeam: string, level: "none" | "recommended" | "strong", kickoff: string): DashboardFixture {
  return {
    fixtureId: id, kickoff, country: "Deutschland", league: "Bundesliga", homeTeam, awayTeam: "Gast FC",
    modelVersion: "test", crossLeague: false, dataConfidence: 85, warnings: [], h2hNotice: null,
    form: { scope: "venue", home: ["win", "draw", "loss"], away: ["loss", "draw", "win"] },
    h2h: {
      outcomes: ["win", "draw", "loss"], btts: [true, false, true], draws: 1, consecutiveDraws: 0,
      matches: [{ date: "2026-05-01T18:00:00.000Z", homeTeam, awayTeam: "Gast FC", homeGoals: 2, awayGoals: 1 }]
    },
    expectedGoals: { home: 1.6, away: 1.1, total: 2.7 }, scores: { favorite: 75, draw: 61 }, markets: markets(level)
  };
}

function document(createdAt = "2026-08-16T10:00:00.000Z", name = "Alpha FC"): DashboardDocument {
  return {
    schemaVersion: 1,
    meta: {
      createdAt, timezone: "Europe/Berlin", sourceFile: "data.json", totalTipicoEvents: 2,
      selectedTipicoEvents: 2, selectedCompetitions: 1, fixtureCount: 2,
      firstAvailableDate: "2026-08-16", lastAvailableDate: "2026-08-17", maximumDays: 2, maximumHours: 48
    },
    fixtures: [
      fixture(1, name, "strong", "2026-08-16T18:00:00.000Z"),
      fixture(2, "Zulu FC", "none", "2026-08-17T18:00:00.000Z")
    ]
  };
}

describe("React-Dashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("zeigt einen verständlichen Zustand ohne Dashboard-Datei", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    render(<App />);
    expect(await screen.findByText("Noch keine Analyse vorhanden")).toBeInTheDocument();
    expect(screen.getByText(/Dashboard-Lauf im Chat/)).toBeInTheDocument();
  });

  it("filtert Empfehlungen und Märkte und öffnet Fixture-Details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(document()), { status: 200 })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Starke Tipps/i }));
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Remis$/i }));
    expect(globalThis.document.querySelector(".table-head")?.textContent).toContain("Remis");

    await user.click(screen.getByRole("button", { name: /Alpha FCGast FC/i }));
    expect(screen.getByText("Direkte Begegnungen")).toBeInTheDocument();
    expect(screen.getAllByText(/Testbegründung/)).toHaveLength(5);
  });

  it("sortiert H2H zuerst nach aktueller Serie und danach nach Ergebnispriorität", async () => {
    const current = document();
    const sequences = [
      ["Unterbrochen", ["draw", "loss", "loss", "loss", "loss"]],
      ["Vier A plus H", ["loss", "loss", "loss", "loss", "win"]],
      ["Drei A", ["loss", "loss", "loss", "draw", "win"]],
      ["Vier A plus U", ["loss", "loss", "loss", "loss", "draw"]],
      ["Vier H plus U", ["win", "win", "win", "win", "draw"]],
      ["Vier U plus H", ["draw", "draw", "draw", "draw", "win"]]
    ] as const;
    current.fixtures = sequences.map(([name, outcomes], index) => ({
      ...fixture(index + 1, name, "none", `2026-08-17T${String(12 + index).padStart(2, "0")}:00:00.000Z`),
      h2h: { ...fixture(index + 1, name, "none", "2026-08-17T12:00:00.000Z").h2h, outcomes: [...outcomes] }
    }));
    current.meta.fixtureCount = current.fixtures.length;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(current), { status: 200 })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Unterbrochen")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Letzte 5 H2H/i }));
    expect(screen.getByLabelText("Sortierung: Auswärtssiege")).toHaveTextContent("A");
    const rows = Array.from(globalThis.document.querySelectorAll(".fixture-row"));
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Vier A plus U"),
      expect.stringContaining("Vier A plus H"),
      expect.stringContaining("Drei A"),
      expect.stringContaining("Unterbrochen"),
      expect.stringContaining("Vier U plus H"),
      expect.stringContaining("Vier H plus U")
    ]);

    await user.click(screen.getByRole("button", { name: /Letzte 5 H2H/i }));
    expect(screen.getByLabelText("Sortierung: Heimsiege")).toHaveTextContent("H");
    expect(globalThis.document.querySelector(".fixture-row")?.textContent).toContain("Vier H plus U");

    await user.click(screen.getByRole("button", { name: /Letzte 5 H2H/i }));
    expect(screen.getByLabelText("Sortierung: Unentschieden")).toHaveTextContent("U");
    expect(globalThis.document.querySelector(".fixture-row")?.textContent).toContain("Vier U plus H");
  });

  it("sortiert die Form nacheinander nach Heim-, Auswärtssiegen und gemeinsamen Remis", async () => {
    const current = document();
    const forms = [
      ["Heimstark", ["win", "win", "win", "win", "loss"], ["loss", "loss", "draw", "loss", "loss"]],
      ["Auswärtsstark", ["loss", "draw", "loss", "loss", "loss"], ["win", "win", "win", "win", "loss"]],
      ["Remisstark", ["draw", "draw", "loss", "draw", "loss"], ["draw", "win", "draw", "draw", "loss"]]
    ] as const;
    current.fixtures = forms.map(([name, home, away], index) => ({
      ...fixture(index + 1, name, "none", `2026-08-17T${String(12 + index).padStart(2, "0")}:00:00.000Z`),
      form: { scope: "venue", home: [...home], away: [...away] }
    }));
    current.meta.fixtureCount = current.fixtures.length;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(current), { status: 200 })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Heimstark")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Letzte 5 Form/i }));
    expect(screen.getByLabelText("Sortierung: Heimsiege")).toHaveTextContent("H");
    expect(globalThis.document.querySelector(".fixture-row")?.textContent).toContain("Heimstark");

    await user.click(screen.getByRole("button", { name: /Letzte 5 Form/i }));
    expect(screen.getByLabelText("Sortierung: Auswärtssiege")).toHaveTextContent("A");
    expect(globalThis.document.querySelector(".fixture-row")?.textContent).toContain("Auswärtsstark");

    await user.click(screen.getByRole("button", { name: /Letzte 5 Form/i }));
    expect(screen.getByLabelText("Sortierung: Unentschieden beider Teams")).toHaveTextContent("U");
    expect(globalThis.document.querySelector(".fixture-row")?.textContent).toContain("Remisstark");
  });

  it("lädt bei erneutem Fensterfokus einen neuen Lauf", async () => {
    let current = document();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(current), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    current = document("2026-08-16T11:00:00.000Z", "Neu FC");
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByText("Neu FC")).toBeInTheDocument());
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
