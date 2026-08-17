import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function rangeDocument(): DashboardDocument {
  const current = document();
  current.meta.firstAvailableDate = "2026-08-16";
  current.meta.lastAvailableDate = "2026-08-18";
  current.meta.maximumDays = 3;
  current.meta.maximumHours = 49;
  current.meta.fixtureCount = 4;
  current.fixtures = [
    fixture(1, "Vor Start", "none", "2026-08-16T11:59:59.000Z"),
    fixture(2, "Exakter Start", "strong", "2026-08-16T12:00:00.000Z"),
    fixture(3, "Exaktes Ende", "strong", "2026-08-18T12:00:00.000Z"),
    fixture(4, "Nach Ende", "none", "2026-08-18T12:00:01.000Z")
  ];
  return current;
}

describe("React-Dashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    expect(globalThis.document.querySelector(".table-head")).toHaveClass("has-score");

    await user.click(within(screen.getByRole("navigation", { name: "Marktfilter" })).getByRole("button", { name: /^BTTS$/i }));
    const bttsHeader = globalThis.document.querySelector<HTMLElement>(".table-head");
    expect(bttsHeader).not.toHaveClass("has-score");
    expect(bttsHeader?.style.getPropertyValue("--market-count")).toBe("1");
    expect(globalThis.document.querySelector(".fixture-row")).not.toHaveClass("has-score");

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

  it("filtert beim Start strikt vom aktuellen Zeitpunkt bis exakt 48 Stunden", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(rangeDocument()), { status: 200 })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    expect(await screen.findByText("Exakter Start")).toBeInTheDocument();
    expect(screen.getByText("Exaktes Ende")).toBeInTheDocument();
    expect(screen.queryByText("Vor Start")).not.toBeInTheDocument();
    expect(screen.queryByText("Nach Ende")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "48h" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("checkbox", { name: /Laufende \/ beendete Partien/i }));
    expect(screen.queryByText("Vor Start")).not.toBeInTheDocument();
  });

  it("wählt inklusive Datumsbereiche, normalisiert die Reihenfolge und erlaubt spielfreie Tage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(rangeDocument()), { status: 200 })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Exakter Start")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Laufende \/ beendete Partien/i }));

    await user.click(screen.getByRole("button", { name: "Datumsbereich auswählen" }));
    let dialog = screen.getByRole("dialog", { name: "Datumsbereich auswählen" });
    expect(within(dialog).getByRole("button", { name: /15. August 2026/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /17. August 2026/i })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: /18. August 2026/i }));
    await user.click(within(dialog).getByRole("button", { name: /16. August 2026/i }));
    expect(within(dialog).getByText("16.08.2026")).toBeInTheDocument();
    expect(within(dialog).getByText("18.08.2026")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect(screen.getByText("Exakter Start")).toBeInTheDocument();
    expect(screen.getByText("Exaktes Ende")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datumsbereich auswählen" }));
    dialog = screen.getByRole("dialog", { name: "Datumsbereich auswählen" });
    await user.click(within(dialog).getByRole("button", { name: /17. August 2026/i }));
    await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect(screen.getByText("Keine Partien für diese Auswahl")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "48h" }));
    expect(screen.getByText("Exaktes Ende")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "48h" })).toHaveAttribute("aria-pressed", "true");
  });

  it("verwirft Kalenderentwürfe beim Abbrechen und mit Escape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(rangeDocument()), { status: 200 })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Exakter Start")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datumsbereich auswählen" }));
    let dialog = screen.getByRole("dialog", { name: "Datumsbereich auswählen" });
    await user.click(within(dialog).getByRole("button", { name: /18. August 2026/i }));
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByRole("button", { name: "48h" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Datumsbereich auswählen" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Datumsbereich auswählen" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sidebar einklappen" })).toHaveAttribute("aria-expanded", "true");
  });

  it("begrenzt einen benutzerdefinierten Bereich nach einem Snapshot-Refresh", async () => {
    let current = rangeDocument();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(current), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Exakter Start")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datumsbereich auswählen" }));
    const dialog = screen.getByRole("dialog", { name: "Datumsbereich auswählen" });
    await user.click(within(dialog).getByRole("button", { name: /16. August 2026/i }));
    await user.click(within(dialog).getByRole("button", { name: /18. August 2026/i }));
    await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));

    current = document("2026-08-17T10:00:00.000Z", "Nur neuer Tag");
    current.meta.firstAvailableDate = "2026-08-17";
    current.meta.lastAvailableDate = "2026-08-17";
    current.meta.maximumDays = 1;
    current.meta.fixtureCount = 1;
    current.fixtures = [fixture(10, "Nur neuer Tag", "strong", "2026-08-17T18:00:00.000Z")];
    fireEvent.focus(window);
    expect(await screen.findByText("Nur neuer Tag")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Datumsbereich auswählen" })).toHaveTextContent("17.08. – 17.08."));
  });

  it("klappt die Desktop-Sidebar ein und filtert über die kompakte Iconleiste", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(document()), { status: 200 })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Fußball-Analyzer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sidebar einklappen" }));
    expect(globalThis.document.querySelector(".app-shell")).toHaveClass("sidebar-collapsed");
    expect(screen.queryByText("Fußball-Analyzer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Starke Tipps: 1 Partien/i }));
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sidebar ausklappen" }));
    expect(screen.getByText("Fußball-Analyzer")).toBeInTheDocument();
  });

  it("öffnet und schließt die mobile Sidebar als Drawer und reagiert auf den Breakpoint", async () => {
    let breakpointListener: ((event: MediaQueryListEvent) => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false, media: "(min-width: 700px)", onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { breakpointListener = listener; },
      removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn()
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(document()), { status: 200 })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByRole("button", { name: "Filter & Zeitraum" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Filter & Zeitraum" }));
    expect(screen.getByRole("button", { name: "Filter & Zeitraum" })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Sidebar schließen" }));
    expect(screen.getByRole("button", { name: "Filter & Zeitraum" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Filter & Zeitraum" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Filter & Zeitraum" })).toHaveAttribute("aria-expanded", "false");

    act(() => breakpointListener?.({ matches: true } as MediaQueryListEvent));
    expect(screen.getByRole("button", { name: "Sidebar einklappen" })).toHaveAttribute("aria-expanded", "true");
    expect(globalThis.document.querySelector(".app-shell")).not.toHaveClass("sidebar-collapsed");
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
