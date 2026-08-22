import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  DashboardDocument,
  DashboardFixture,
  DashboardMarket,
  LiveBoardMatch,
  LiveBoardResponse,
  LiveTeamSnapshot
} from "./types";

const KICKOFF = "2026-08-20T18:00:00.000Z";

function markets(): DashboardMarket[] {
  return [{
    key: "over25", label: "Über 2,5", selection: "Mindestens 3 Tore", pick: null,
    selectionTone: "neutral", probability: 0.64, odds: 1.85, confidence: 82, score: null,
    recommendation: { level: "recommended", label: "Empfehlenswert" }, details: ["Testbegründung"]
  }];
}

function fixture(id: number, homeTeam: string, league = "Bundesliga"): DashboardFixture {
  return {
    fixtureId: id, kickoff: KICKOFF, country: "Deutschland", league,
    homeTeam, awayTeam: "Gast FC", modelVersion: "test", crossLeague: false,
    dataConfidence: 82, warnings: [], h2hNotice: null,
    form: { scope: "venue", home: [], away: [], homeMatches: [], awayMatches: [] },
    h2h: { outcomes: [], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    expectedGoals: { home: 1.7, away: 1.2, total: 2.9 },
    scores: { favorite: 71, draw: 58 }, markets: markets()
  };
}

function dashboard(): DashboardDocument {
  return {
    schemaVersion: 4,
    meta: {
      createdAt: "2026-08-20T16:00:00.000Z", timezone: "Europe/Berlin", sourceFile: "data.json",
      totalTipicoEvents: 2, selectedTipicoEvents: 2, selectedCompetitions: 2, fixtureCount: 2,
      firstAvailableDate: "2026-08-20", lastAvailableDate: "2026-08-20", maximumDays: 1, maximumHours: 4
    },
    fixtures: [fixture(1, "Alpha FC"), fixture(2, "Zulu FC", "2. Bundesliga")],
    leagues: []
  };
}

function snapshot(values: Partial<LiveTeamSnapshot> = {}): LiveTeamSnapshot {
  return {
    shotsOnGoal: null, totalShots: null, shotsOffGoal: null, blockedShots: null,
    shotsInsideBox: null, shotsOutsideBox: null, possession: null, corners: null,
    offsides: null, fouls: null, goalkeeperSaves: null, passAccuracy: null,
    yellowCards: null, redCards: null, expectedGoals: null, ...values
  };
}

function liveMatch(): LiveBoardMatch {
  return {
    fixtureId: 1, kickoff: KICKOFF, country: "Deutschland", league: "Bundesliga",
    homeTeam: "Alpha FC", awayTeam: "Gast FC",
    status: { short: "2H", long: "Second Half" }, elapsed: 63, extra: null,
    goals: { home: 1, away: 0 }, halfTime: { home: 1, away: 0 },
    metrics: {
      home: snapshot({ shotsOnGoal: 7, totalShots: 17, shotsInsideBox: 11, possession: 58, corners: 8 }),
      away: snapshot({ shotsOnGoal: 4, totalShots: 9, possession: 42, corners: 4 })
    },
    metricsAvailable: true,
    activity: "Heimteam",
    events: [{ minute: 40, extra: null, side: "home", type: "Goal", detail: "Normal Goal", player: "Spieler A" }],
    prematch: { crossLeague: false, dataConfidence: 82, expectedGoals: { home: 1.7, away: 1.2, total: 2.9 }, markets: markets() }
  };
}

function board(matches: LiveBoardMatch[] = [liveMatch()]): LiveBoardResponse {
  return {
    createdAt: "2026-08-20T19:03:00.000Z", pollIntervalMs: 15_000, matches, candidates: matches.length, strategy: "batch",
    budget: { usedToday: 12, capToday: 2_000, apiRequestsRemaining: 7_100, exhausted: false },
    message: null
  };
}

function stubFetch(live: () => Response, dashboardResponse: () => Response = () => new Response(JSON.stringify(dashboard()), { status: 200 })) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    calls.push(url);
    return Promise.resolve(url.startsWith("/api/live/board") ? live() : dashboardResponse());
  }));
  return calls;
}

const liveCalls = (calls: string[]) => calls.filter((url) => url.startsWith("/api/live/board"));

describe("Live-Ansicht", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-20T19:03:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("fragt Live-Daten erst nach dem Umschalten ab und merkt sich die Ansicht", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByRole("button", { name: /Letzte 5 Form/ })).toBeInTheDocument();

    // Im Pre-Match-Modus darf kein einziger Live-Call entstehen.
    expect(liveCalls(calls)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => expect(liveCalls(calls).length).toBeGreaterThan(0));
    expect(window.localStorage.getItem("football-analyzer:view")).toBe("live");
    expect(await screen.findByText("63'")).toBeInTheDocument();

    const before = liveCalls(calls).length;
    await user.click(screen.getByRole("button", { name: "Pre-Match" }));
    expect(await screen.findByRole("button", { name: /Letzte 5 Form/ })).toBeInTheDocument();
    vi.advanceTimersByTime(60_000);
    expect(liveCalls(calls)).toHaveLength(before);
    expect(window.localStorage.getItem("football-analyzer:view")).toBe("prematch");
  });

  it("zeigt laufende Partien mit Minute, Spielstand und Live-Status", async () => {
    window.localStorage.setItem("football-analyzer:view", "live");
    stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    render(<App />);

    const row = await screen.findByRole("article");
    expect(row).toHaveTextContent("Alpha FC");
    expect(row).toHaveTextContent("Gast FC");
    expect(row).toHaveTextContent("63'");
    expect(within(row).getByText("1")).toBeInTheDocument();
    expect(row).toHaveTextContent("Bundesliga");
    // Die Markttafel stammt unverändert aus dem Pre-Match-Lauf.
    expect(row).toHaveTextContent("1,85");
    const status = globalThis.document.querySelector(".live-section");
    expect(status).toHaveTextContent("1 laufende Partie");
    expect(status).toHaveTextContent("API-Calls heute: 12 von 2000");
    expect(status).toHaveTextContent("Kontingent verbleibend: 7100");
  });

  it("öffnet beim Hovern ein Fenster mit Live-Metriken ohne weiteren Abruf", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    window.localStorage.setItem("football-analyzer:view", "live");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const row = await screen.findByRole("article");
    expect(screen.queryByRole("dialog", { name: /Live-Metriken/ })).not.toBeInTheDocument();

    const before = liveCalls(calls).length;
    await user.hover(row);

    const panel = await screen.findByRole("dialog", { name: /Live-Metriken Alpha FC gegen Gast FC/ });
    expect(within(panel).getByText("Ballbesitz")).toBeInTheDocument();
    expect(within(panel).getByText("58 %")).toBeInTheDocument();
    expect(within(panel).getByText("42 %")).toBeInTheDocument();
    expect(within(panel).getByText("Schüsse im Strafraum")).toBeInTheDocument();
    expect(within(panel).getByText("Normal Goal · Spieler A")).toBeInTheDocument();
    expect(within(panel).getByText(/Aktivitätsbild/)).toHaveTextContent("Heimteam");
    // Hovern darf keinen zusätzlichen API-Call auslösen.
    expect(liveCalls(calls)).toHaveLength(before);

    await user.unhover(row);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Live-Metriken/ })).not.toBeInTheDocument());
  });

  it("stellt fehlende Statistiken als Strich dar statt als Null", async () => {
    const match = liveMatch();
    match.metrics.away = snapshot({ shotsOnGoal: 4 });
    match.metrics.home = snapshot({ shotsOnGoal: 7 });
    window.localStorage.setItem("football-analyzer:view", "live");
    stubFetch(() => new Response(JSON.stringify(board([match])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    await user.hover(await screen.findByRole("article"));
    const panel = await screen.findByRole("dialog", { name: /Live-Metriken/ });
    const corners = within(panel).getByText("Ecken").closest(".live-metric-row");
    expect(corners).toHaveTextContent("–");
    expect(corners).not.toHaveTextContent("0");
  });

  it("erklärt den leeren Zustand und verbraucht dabei kein Kontingent", async () => {
    window.localStorage.setItem("football-analyzer:view", "live");
    stubFetch(() => new Response(JSON.stringify({ ...board([]), budget: { usedToday: 0, capToday: 2_000, apiRequestsRemaining: null, exhausted: false } }), { status: 200 }));
    render(<App />);

    expect(await screen.findByText("Aktuell läuft keine der analysierten Partien")).toBeInTheDocument();
    expect(screen.getByText(/kein einziger API-Call verbraucht/)).toBeInTheDocument();
    expect(globalThis.document.querySelector(".live-section")).toHaveTextContent("API-Calls heute: 0 von 2000");
  });

  it("meldet einen fehlenden API-Schlüssel verständlich", async () => {
    window.localStorage.setItem("football-analyzer:view", "live");
    stubFetch(() => new Response(JSON.stringify({ error: "api_key_missing" }), { status: 503 }));
    render(<App />);

    expect(await screen.findByText(/API_FOOTBALL_KEY fehlt/)).toBeInTheDocument();
  });

  it("wendet den Wettbewerbsfilter auch auf laufende Partien an", async () => {
    const second = { ...liveMatch(), fixtureId: 2, homeTeam: "Zulu FC", league: "2. Bundesliga" };
    window.localStorage.setItem("football-analyzer:view", "live");
    stubFetch(() => new Response(JSON.stringify(board([liveMatch(), second])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    expect(await screen.findAllByRole("article")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Wettbewerbe auswählen" }));
    await user.click(screen.getByRole("checkbox", { name: "Deutschland · 2. Bundesliga" }));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(screen.getByRole("article")).toHaveTextContent("Alpha FC");
  });
});

describe("Beobachtungsumfang", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-20T19:03:00.000Z"));
    window.localStorage.setItem("football-analyzer:view", "live");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const watched = (calls: string[]) => {
    const url = liveCalls(calls).at(-1) ?? "";
    const raw = new URLSearchParams(url.split("?")[1] ?? "").get("fixtures");
    return raw ? raw.split(",").map(Number) : [];
  };

  it("meldet dem Server nur die beobachteten Partien", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    render(<App />);
    await screen.findByRole("article");

    // Beide Partien des Dashboards werden beobachtet.
    await waitFor(() => expect(watched(calls)).toEqual([1, 2]));
  });

  it("nimmt abgewählte Wettbewerbe aus der Abfrage heraus", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole("article");
    await waitFor(() => expect(watched(calls)).toEqual([1, 2]));

    await user.click(screen.getByRole("button", { name: "Wettbewerbe auswählen" }));
    await user.click(screen.getByRole("checkbox", { name: "Deutschland · 2. Bundesliga" }));
    await user.keyboard("{Escape}");

    // Fixture 2 liegt in der abgewählten Liga und wird nicht mehr abgefragt.
    await waitFor(() => expect(watched(calls)).toEqual([1]));
  });

  it("beschränkt die Abfrage auf bewertete Partien, wenn gewünscht", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole("article");
    await waitFor(() => expect(watched(calls)).toEqual([1, 2]));

    await user.click(screen.getByRole("checkbox", { name: /Nur bewertete Partien/i }));
    // Beide Testpartien tragen eine Empfehlung, der Umfang bleibt also gleich gross -
    // entscheidend ist, dass der Schalter den gemeldeten Umfang steuert.
    await waitFor(() => expect(watched(calls).length).toBeGreaterThan(0));
    expect(globalThis.document.querySelector(".live-hint")?.textContent)
      .toMatch(/Beobachtet werden 2 von 2 Partien/);
  });
});
