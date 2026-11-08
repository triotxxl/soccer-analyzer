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
} from "../../shared/src/types";

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
    offsides: null, fouls: null, goalkeeperSaves: null, totalPasses: null, accuratePasses: null, passAccuracy: null,
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
      home: snapshot({ shotsOnGoal: 7, totalShots: 17, shotsInsideBox: 11, possession: 58, corners: 8, totalPasses: 412, accuratePasses: 346, passAccuracy: 84 }),
      away: snapshot({ shotsOnGoal: 4, totalShots: 9, possession: 42, corners: 4 })
    },
    metricsAvailable: true,
    statisticsCoverage: true,
    cards: { home: { yellow: 1, red: 0 }, away: { yellow: 2, red: 0 } },
    live: {
      state: "ok", provisional: true, modelVersion: "1.0.0",
      remainingGoals: 1.1, anotherGoal: 0.67,
      nextGoal: { home: 0.4, none: 0.33, away: 0.27 },
      result: { home: 0.7, draw: 0.2, away: 0.1 },
      lines: { over15: 0.53, over25: 0.3, over35: 0.1 }
    },
    marketStands: {
      over15: { status: "needs", goalsNeeded: 1 }, under15: { status: "winning", goalsToSpare: 0 },
      over25: { status: "needs", goalsNeeded: 2 }, under25: { status: "winning", goalsToSpare: 1 },
      over35: { status: "needs", goalsNeeded: 3 }, under35: { status: "winning", goalsToSpare: 2 },
      btts: { status: "needs", goalsNeeded: 1 }, bttsNo: { status: "winning", goalsToSpare: 0 }
    },
    events: [
      { minute: 40, extra: null, side: "home", type: "Goal", detail: "Normal Goal", player: "Spieler A" },
      { minute: 58, extra: null, side: "away", type: "subst", detail: "Substitution 1", player: "Spieler B" }
    ],
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

/** Öffnet das Filtermenü über den Knopf in der Werkzeugleiste und gibt das Fenster zurück. */
async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Filter(, \d+ aktiv)?$/ }));
  return screen.getByRole("dialog", { name: "Filter" });
}

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

    // In Tabelle und Heatmap darf kein einziger Live-Call entstehen.
    expect(liveCalls(calls)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => expect(liveCalls(calls).length).toBeGreaterThan(0));
    expect(window.localStorage.getItem("football-analyzer:view")).toBe("live");
    expect(await screen.findByText("63'")).toBeInTheDocument();

    const before = liveCalls(calls).length;
    await user.click(screen.getByRole("button", { name: "Tabelle" }));
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
    expect(row.querySelector(".live-score")).toHaveTextContent("10");
    expect(row).toHaveTextContent("Bundesliga");
    // Überblick: die Live-Chance „noch ein Tor“, als vorläufig markiert.
    // Die Frage steht einmal in der Kopfzeile, nicht in jeder Zeile.
    expect(globalThis.document.querySelector(".live-head")).toHaveTextContent("Noch ein Tor");
    expect(row).toHaveTextContent("67 %");
    expect(within(row).getByText("vorläufig")).toBeInTheDocument();
    expect(row).toHaveTextContent("Erwartete Resttore 1,10");
    // Die Quote von vor dem Anpfiff steht nicht in der Zeile - sie ist im Spiel veraltet. Seit
    // 03.11.2026 steht dort aber die Empfehlung mit ihrem Stand jetzt (Davids Freigabe des Entwurfs).
    expect(row).not.toHaveTextContent("1,85");
    const tip = row.querySelector(".live-tip");
    expect(tip).toHaveTextContent("✓Über 2,5noch 2 Tore · 30 %");
    expect(tip).toHaveAttribute("title", expect.stringContaining("vor dem Anpfiff 64 % · Quote 1,85"));
    // Tore und Rote Karten stehen in der Kleinzeile unter den Teams, die Spieluhr unter der Minute.
    expect(row.querySelector(".live-event-line")).toHaveTextContent("Tor 40′ Spieler A");
    expect((row.querySelector(".live-clock i") as HTMLElement).style.width).toBe("70%");
    const status = globalThis.document.querySelector(".live-status");
    expect(status).toHaveTextContent("1 laufendes Spiel");
    // Die Technik steht im Tooltip.
    expect(status).toHaveAttribute("title", expect.stringContaining("API-Aufrufe heute: 12 von 2000"));
    expect(status).toHaveAttribute("title", expect.stringContaining("Kontingent verbleibend: 7100"));
    expect(screen.getByText(/rechne nicht mit Gewinn/)).toBeInTheDocument();
  });

  /**
   * Davids Entscheidung vom 28.09.2026: Der Vorteil stammt aus Quote und Wahrscheinlichkeit vor
   * dem Anpfiff und ist im laufenden Spiel veraltet - Live zeigt ihn nie, auch nicht im Modus
   * "Vorteil & Kelly", und bietet den Umschalter gar nicht erst an.
   */
  it("zeigt in Live nie einen Vorteil, auch im Modus Vorteil & Kelly", async () => {
    window.localStorage.setItem("football-analyzer:view", "live");
    window.localStorage.setItem("football-analyzer:kelly-visible-v2", "1");
    stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    render(<App />);

    const row = await screen.findByRole("article");
    expect(row).not.toHaveTextContent("PP");
    expect(row.querySelector(".market-edge")).toBeNull();
    expect(screen.queryByRole("group", { name: "Anzeige" })).not.toBeInTheDocument();
    expect(globalThis.document.querySelector(".kelly-status")).not.toBeInTheDocument();
  });

  /**
   * Der Markt wirkt auch in Live auf die Markttafeln - er steht deshalb sichtbar da statt still
   * aus der Tabelle geerbt. Das Menü trägt nur, was hier wirkt: keine Stufe, kein Zeitraum.
   */
  it("zeigt den Markt sichtbar und im Filtermenü nur, was in Live wirkt", async () => {
    window.localStorage.setItem("football-analyzer:view", "live");
    stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole("article");

    expect(screen.getByLabelText("Markt")).toHaveValue("overview");
    expect(screen.getByLabelText("Sortierung")).toHaveValue("kickoff");
    const menu = await openFilters(user);
    expect(within(menu).getByRole("button", { name: "Wettbewerbe auswählen" })).toBeInTheDocument();
    expect(within(menu).getByRole("switch", { name: "Nur Spiele mit Empfehlung vor Anpfiff" })).toBeInTheDocument();
    // Die Anzeige-Filter kosten nichts und stehen getrennt von den beobachteten Spielen.
    expect(within(menu).getByRole("group", { name: "Chance ab" })).toBeInTheDocument();
    expect(within(menu).getByRole("switch", { name: "Rote Karte im Spiel" })).toBeInTheDocument();
    expect(within(menu).getByRole("group", { name: "Phase" })).toBeInTheDocument();
    // Keine Stufe, kein Zeitraum: Beides wirkt in Live nicht.
    expect(within(menu).queryByRole("radio", { name: /Empfehlungen/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("button", { name: "Nächste 48 Std." })).not.toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Alle Filter zurücksetzen" }))
      .toHaveAttribute("title", "Danach werden wieder alle Spiele beobachtet.");
  });

  it("öffnet per Klick an der Maus ein Fenster mit den Kennzahlen, ohne weiteren Abruf", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    window.localStorage.setItem("football-analyzer:view", "live");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const row = await screen.findByRole("article");
    expect(screen.queryByRole("dialog", { name: /Live-Kennzahlen/ })).not.toBeInTheDocument();
    // Überfahren öffnet seit 29.09.2026 nichts mehr (Davids Wunsch).
    await user.hover(row);
    expect(screen.queryByRole("dialog", { name: /Live-Kennzahlen/ })).not.toBeInTheDocument();

    const before = liveCalls(calls).length;
    await user.pointer({ keys: "[MouseLeft]", target: row, coords: { clientX: 300, clientY: 200 } });

    const panel = await screen.findByRole("dialog", { name: /Live-Kennzahlen Alpha FC gegen Gast FC/ });
    expect(within(panel).getByText("Heim 40 · keins 33 · Gast 27")).toBeInTheDocument();
    expect(within(panel).getByText("1 70 · X 20 · 2 10")).toBeInTheDocument();
    expect(panel.querySelector(".live-context")).toHaveTextContent("Ballbesitz 58 % : 42 %");
    expect(within(panel).getByText("Schüsse im Strafraum")).toBeInTheDocument();
    // Ereignisse auf Deutsch, Wechsel verdrängen keine Tore und Karten mehr.
    expect(within(panel).getByText("Tor · Spieler A")).toBeInTheDocument();
    expect(panel).not.toHaveTextContent("Substitution");
    expect(panel.querySelector(".live-cards")).toHaveTextContent("Gelb 1 : 2 · Rot 0 : 0");
    // Quote und Stufe vor dem Anpfiff stehen hier, ausdrücklich zeitlich eingeordnet - neben der Chance jetzt.
    expect(within(panel).getByText("Deine Tipps vor dem Anpfiff · jetzt")).toBeInTheDocument();
    const tipRow = panel.querySelector(".live-tip-row.recommended");
    expect(tipRow).toHaveTextContent("✓ Über 2,5");
    expect(tipRow).toHaveTextContent("1,85");
    expect(tipRow).toHaveTextContent("64 %");
    expect(tipRow).toHaveTextContent("30 %");
    expect(tipRow).toHaveTextContent("noch 2 Tore");
    // Spielverlauf: das Tor als Punkt beim Heimteam, Wechsel nicht.
    expect(within(panel).getByTitle("40′ Tor · Spieler A")).toHaveClass("live-timeline-event", "home", "goal");
    expect(panel.querySelectorAll(".live-timeline-event")).toHaveLength(1);
    expect(panel).not.toHaveTextContent("Aktivitätsbild");
    // Das Fenster geht an der Klickstelle auf, rechts neben der Maus.
    expect(panel.style.left).toBe("312px");
    expect(panel.style.top).toBe("200px");
    // Das Öffnen darf keinen zusätzlichen API-Call auslösen.
    expect(liveCalls(calls)).toHaveLength(before);

    // Ein Klick ins Fenster lässt es offen, ein zweiter Klick auf die Zeile schließt es.
    await user.click(panel);
    expect(screen.getByRole("dialog", { name: /Live-Kennzahlen/ })).toBeInTheDocument();
    await user.click(row);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Live-Kennzahlen/ })).not.toBeInTheDocument());

    // Mit der Tastatur geht es über Enter auf, Escape und ein Klick daneben schließen.
    row.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: /Live-Kennzahlen/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Live-Kennzahlen/ })).not.toBeInTheDocument());
    await user.click(row);
    expect(await screen.findByRole("dialog", { name: /Live-Kennzahlen/ })).toBeInTheDocument();
    await user.click(globalThis.document.body);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Live-Kennzahlen/ })).not.toBeInTheDocument());
  });

  it("stellt fehlende Statistiken als Strich dar statt als Null", async () => {
    const match = liveMatch();
    match.metrics.away = snapshot({ shotsOnGoal: 4 });
    match.metrics.home = snapshot({ shotsOnGoal: 7 });
    window.localStorage.setItem("football-analyzer:view", "live");
    stubFetch(() => new Response(JSON.stringify(board([match])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    await user.click(await screen.findByRole("article"));
    const panel = await screen.findByRole("dialog", { name: /Live-Kennzahlen/ });
    const insideBox = within(panel).getByText("Schüsse im Strafraum").closest(".live-metric-row");
    expect(insideBox).toHaveTextContent("–");
    expect(insideBox).not.toHaveTextContent("0");
  });

  it("erklärt den leeren Zustand und verbraucht dabei kein Kontingent", async () => {
    window.localStorage.setItem("football-analyzer:view", "live");
    stubFetch(() => new Response(JSON.stringify({ ...board([]), budget: { usedToday: 0, capToday: 2_000, apiRequestsRemaining: null, exhausted: false } }), { status: 200 }));
    render(<App />);

    expect(await screen.findByText("Gerade läuft keins der analysierten Spiele")).toBeInTheDocument();
    expect(screen.getByText(/kostet sie keine API-Aufrufe/)).toBeInTheDocument();
    expect(globalThis.document.querySelector(".live-status")).toHaveAttribute("title", expect.stringContaining("API-Aufrufe heute: 0 von 2000"));
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

    await user.click(within(await openFilters(user)).getByRole("button", { name: "Wettbewerbe auswählen" }));
    await user.click(screen.getByRole("checkbox", { name: "Deutschland · 2. Bundesliga" }));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(screen.getByRole("article")).toHaveTextContent("Alpha FC");
  });
});

describe("Live-Fragen und Anzeige-Filter", () => {
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

  it("zeigt bei einer Torlinie die Tatsache aus dem Stand und den Wert vor dem Anpfiff grau", async () => {
    stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole("article");

    await user.selectOptions(screen.getByLabelText("Markt"), "over25");
    const row = screen.getByRole("article");
    expect(row).toHaveTextContent("30 %");
    expect(row).toHaveTextContent("noch 2 Tore nötig");
    expect(row).toHaveTextContent("vor Anpfiff 64 %");
    expect(row).not.toHaveTextContent("1,85");
    // Die Frage blendet nichts aus und wird gemerkt; der Markt der Tabelle bleibt unberührt.
    expect(window.localStorage.getItem("football-analyzer:live-question")).toBe("over25");
  });

  /**
   * Davids Wunsch vom 29.09.2026: die Statistik übersichtlich direkt in der Liste. Seit 03.11.2026 (Entwurf
   * „Live-Ansicht“) Schüsse aufs Tor mit dem Ballbesitz als Balken darunter und Karten; Ballbesitz und Pässe
   * haben keine eigene Spalte mehr - an ihrer Stelle steht „Dein Tipp · jetzt“.
   */
  it("zeigt Schüsse aufs Tor mit Ballbesitz und Karten, Heim oben und Gast unten", async () => {
    const match = liveMatch();
    match.cards = { home: { yellow: 1, red: 1 }, away: { yellow: 0, red: 0 } };
    match.metrics.home.shotsOnGoal = null;
    stubFetch(() => new Response(JSON.stringify(board([match])), { status: 200 }));
    render(<App />);
    const row = await screen.findByRole("article");

    const head = globalThis.document.querySelector(".live-head");
    for (const label of ["Dein Tipp · jetzt", "Aufs Tor", "Karten"]) expect(head).toHaveTextContent(label);
    expect(head).not.toHaveTextContent("Pässe");
    const [shots, cards] = [...row.querySelectorAll(".live-stat")];
    // Fehlt eine Zahl, bleibt ein Strich statt einer Null.
    expect(shots!.querySelector(".home")).toHaveTextContent("–");
    expect(shots!.querySelector(".away")).toHaveTextContent("4");
    expect(within(shots as HTMLElement).getByTitle("Ballbesitz 58 : 42 %")).toBeInTheDocument();
    expect(cards!.querySelector(".home")).toHaveTextContent("1 Gelb1 Rot");
    // Eine Karte steht nur beim Team, das sie hat - keine gelbe „0“ beim Gast.
    expect(cards!.querySelector(".away")).toBeEmptyDOMElement();
  });

  it("zeigt den Stand der Tipps von vor dem Anpfiff: erreicht, noch nötig, Luft und Führung", async () => {
    const match = liveMatch();
    const market = (key: DashboardMarket["key"], probability: number, level: "strong" | "recommended", pick: DashboardMarket["pick"] = null): DashboardMarket => ({
      ...markets()[0]!, key, label: key, pick, probability, recommendation: { level, label: level }
    });
    match.marketStands.over15 = { status: "won" };
    match.prematch = { ...match.prematch, markets: [
      market("over15", 0.85, "recommended"), market("under35", 0.7, "strong"), market("1x2", 0.6, "strong", "1"),
      market("firstHalfOver05", 0.75, "recommended")
    ] };
    stubFetch(() => new Response(JSON.stringify(board([match])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    const row = await screen.findByRole("article");

    // In der Zeile die zwei stärksten (★ vor ✓, dann nach Chance), der Rest als Zahl.
    const chips = [...row.querySelectorAll(".live-tip")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["★Unter 3,52 Tore Luft · 90 %", "★Sieg Alpha FCführt · 70 %"]);
    expect(row.querySelector(".live-tips")).toHaveTextContent("+ 2 weitere");

    await user.click(row);
    const panel = await screen.findByRole("dialog", { name: /Live-Kennzahlen/ });
    const rows = [...panel.querySelectorAll(".live-tip-row:not(.head)")];
    expect(rows).toHaveLength(4);
    // Entschieden: erreicht, ohne Live-Chance. Die 1. Halbzeit ist nach der Pause entschieden (HZ 1:0).
    expect(rows.find((tipRow) => tipRow.textContent!.includes("Über 1,5"))).toHaveTextContent("85 %–erreicht");
    expect(rows.find((tipRow) => tipRow.textContent!.includes("1. HZ Über 0,5"))).toHaveTextContent("erreicht");
  });

  it("zeigt bei BTTS nur den Stand, weil es dafür keine gemessene Live-Chance gibt", async () => {
    stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole("article");

    await user.selectOptions(screen.getByLabelText("Markt"), "btts");
    const row = screen.getByRole("article");
    expect(row).toHaveTextContent("Gast FC fehlt noch");
    expect(row).not.toHaveTextContent("vorläufig");
    // Ohne Live-Chance greift „Chance ab“ nicht, und die Warnzeile entfällt.
    expect(screen.queryByText(/rechne nicht mit Gewinn/)).not.toBeInTheDocument();
    const menu = await openFilters(user);
    expect(within(menu).getByRole("group", { name: "Chance ab" })).toBeDisabled();
  });

  it("zeigt keine Live-Chance in der Verlängerung und keinen Sieger ohne Ligastärke", async () => {
    const extraTime = { ...liveMatch(), status: { short: "ET", long: "Extra Time" }, elapsed: 104 };
    extraTime.live = { ...extraTime.live, state: "extraTime", remainingGoals: null, anotherGoal: null, nextGoal: null, result: null, lines: null };
    const unreliable = { ...liveMatch(), fixtureId: 2, homeTeam: "Zulu FC" };
    unreliable.live = { ...unreliable.live, nextGoal: null, result: null };
    stubFetch(() => new Response(JSON.stringify(board([extraTime, unreliable])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    const [first, second] = await screen.findAllByRole("article");
    expect(first).toHaveTextContent("Verlängerung – keine Live-Chance");
    expect(first).toHaveTextContent("104' Verl.");

    await user.selectOptions(screen.getByLabelText("Markt"), "result");
    expect(second).toHaveTextContent("Ligastärke unbekannt");
    expect(second.querySelector(".live-value")).not.toHaveTextContent("%");
  });

  it("zählt Rote Karten aus der Tafel, auch wenn die Statistik fehlt", async () => {
    const match = liveMatch();
    match.metrics = { home: snapshot(), away: snapshot() };
    match.metricsAvailable = false;
    match.statisticsCoverage = false;
    match.cards = { home: { yellow: 2, red: 1 }, away: { yellow: 0, red: 0 } };
    stubFetch(() => new Response(JSON.stringify(board([match])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const row = await screen.findByRole("article");
    expect(within(row).getByTitle("Rote Karte")).toHaveTextContent("1");
    // Aufs Tor: ein Strich mit der Begründung im Tooltip, ohne Ballbesitz-Balken.
    const shots = within(row).getByTitle("Diese Liga liefert keine Live-Statistik.");
    expect(shots.querySelector(".home")).toHaveTextContent("–");
    expect(shots.querySelector(".live-possession")).toBeNull();
    await user.click(row);
    const panel = await screen.findByRole("dialog", { name: /Live-Kennzahlen/ });
    expect(within(panel).getByText("Diese Liga liefert keine Live-Statistik.")).toBeInTheDocument();
  });

  it("sagt „keine Kartendaten“ statt 0, wenn die Liga keine Karten führt", async () => {
    const match = liveMatch();
    match.cards = null;
    stubFetch(() => new Response(JSON.stringify(board([match])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole("article");

    await user.selectOptions(screen.getByLabelText("Markt"), "cards");
    expect(screen.getByRole("article")).toHaveTextContent("keine Kartendaten");
    await user.click(screen.getByRole("article"));
    const panel = await screen.findByRole("dialog", { name: /Live-Kennzahlen/ });
    expect(panel).toHaveTextContent("Keine Kartendaten – in dieser Liga fehlen Karten in den Ereignissen.");
  });

  it("zeigt einen 1X2-Tipp ohne Ligastärke-Vergleich weder in der Zeile noch im Fenster", async () => {
    const match = liveMatch();
    match.prematch = {
      ...match.prematch,
      markets: [...markets(), {
        key: "1x2", label: "1X2", selection: "Heimsieg Alpha FC", pick: "1", selectionTone: "home",
        probability: 0.55, odds: 1.7, confidence: 60, score: 72, probabilityReliable: false,
        recommendation: { level: "recommended", label: "Empfehlenswert" }, details: []
      }]
    };
    stubFetch(() => new Response(JSON.stringify(board([match])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    // Ohne belastbare Wahrscheinlichkeit ist ein Markt nie eine Empfehlung (AGENTS.md Punkt 5).
    const row = await screen.findByRole("article");
    expect(row.querySelector(".live-tips")).not.toHaveTextContent("Sieg Alpha FC");
    await user.click(row);
    const panel = await screen.findByRole("dialog", { name: /Live-Kennzahlen/ });
    expect(panel.querySelector(".live-tip-table")).not.toHaveTextContent("Sieg Alpha FC");
    expect(panel.querySelector(".live-tip-table")).not.toHaveTextContent("55 %");
  });

  /** Davids Wunsch vom 03.11.2026: H2H im Live-Fenster, übersichtlicher als die Striche der Tabelle. */
  it("zeigt im Fenster unter H2H die Duelle aus der Analyse, ohne Testspiele und ohne Abruf", async () => {
    const duel = (fixtureId: number, date: string, home: string, away: string, homeGoals: number, awayGoals: number,
      halfTime: [number, number] | null, friendly = false) => ({
      fixtureId, teamWasHome: home === "Alpha FC", date, homeTeam: home, awayTeam: away, homeGoals, awayGoals,
      halfTimeHomeGoals: halfTime?.[0] ?? null, halfTimeAwayGoals: halfTime?.[1] ?? null, friendly, league: "Bundesliga"
    });
    const doc = dashboard();
    doc.fixtures[0]!.h2h.history = [
      duel(11, "2025-04-12T15:30:00+00:00", "Gast FC", "Alpha FC", 1, 3, [0, 1]),
      duel(12, "2024-11-02T15:30:00+00:00", "Alpha FC", "Gast FC", 2, 2, [0, 1]),
      duel(13, "2024-07-20T15:30:00+00:00", "Alpha FC", "Gast FC", 5, 0, null, true)
    ];
    doc.fixtures[0]!.form = { ...doc.fixtures[0]!.form, home: ["win", "win", "draw"], away: ["loss"] };
    const calls = stubFetch(() => new Response(JSON.stringify(board()), { status: 200 }),
      () => new Response(JSON.stringify(doc), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    await user.click(await screen.findByRole("article"));
    const panel = await screen.findByRole("dialog", { name: /Live-Kennzahlen/ });
    const otherCalls = () => calls.filter((url) => !url.startsWith("/api/live/board")).length;
    const before = otherCalls();
    await user.click(within(panel).getByRole("tab", { name: "H2H" }));

    // Das Testspiel vom Juli zählt nicht mit.
    expect(within(panel).getByText("Direkte Duelle · 2 Spiele")).toBeInTheDocument();
    const duelBox = panel.querySelector(".live-duel")!;
    expect(duelBox.querySelector(".home")).toHaveTextContent("1Sieg Alpha FC");
    expect(duelBox.querySelector(".draw")).toHaveTextContent("1Remis");
    expect(duelBox).toHaveTextContent("Tore 5 : 3");
    expect(duelBox).toHaveTextContent("Höchster Sieg: Alpha FC 3:1 (12.04.25)");
    expect(panel).toHaveTextContent("Nur 2 Duelle – kann auch Zufall sein.");
    const frequency = (label: string) => [...panel.querySelectorAll(".live-freq")].find((row) => row.textContent!.startsWith(label))!;
    expect(frequency("Über 2,5 Tore")).toHaveTextContent("2 von 2");
    expect(frequency("Alpha FC zur Pause vorn")).toHaveTextContent("1 von 2");
    expect(frequency("Gast FC zu null").querySelectorAll("i.miss")).toHaveLength(2);
    expect(panel.querySelector(".live-duel-list")).toHaveTextContent("12.04.25Gast FC – Alpha FC Bundesliga1:30:1S");
    expect(panel.querySelector(".live-form")).toHaveTextContent("Alpha FC7 von 9 Pkt.");

    await user.click(within(panel).getByRole("button", { name: "Nur in Alpha FC" }));
    expect(within(panel).getByText("Direkte Duelle · 1 Spiel")).toBeInTheDocument();
    // H2H kommt aus der geladenen Analyse - kein Aufruf.
    expect(otherCalls()).toBe(before);
  });

  it("filtert nach Chance und Roter Karte, zeigt Schildchen und setzt beides zurück", async () => {
    const calm = { ...liveMatch(), fixtureId: 2, homeTeam: "Zulu FC" };
    calm.live = { ...calm.live, anotherGoal: 0.4 };
    calm.cards = { home: { yellow: 0, red: 1 }, away: { yellow: 0, red: 0 } };
    const calls = stubFetch(() => new Response(JSON.stringify(board([liveMatch(), calm])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findAllByRole("article")).toHaveLength(2);
    const before = liveCalls(calls).length;

    const menu = await openFilters(user);
    await user.click(within(menu).getByRole("radio", { name: "Chance ab 50 %" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article")).toHaveTextContent("Alpha FC");

    await user.click(within(menu).getByRole("switch", { name: "Rote Karte im Spiel" }));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByText("Kein laufendes Spiel passt zu den Filtern")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter, 2 aktiv" })).toBeInTheDocument();
    // Anzeige-Filter ändern keinen Abruf.
    expect(liveCalls(calls)).toHaveLength(before);

    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("sortiert nach Chance, wenn die Frage eine hat", async () => {
    const low = { ...liveMatch(), fixtureId: 2, homeTeam: "Zulu FC", kickoff: "2026-08-20T17:00:00.000Z" };
    low.live = { ...low.live, anotherGoal: 0.2 };
    stubFetch(() => new Response(JSON.stringify(board([low, liveMatch()])), { status: 200 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    let rows = await screen.findAllByRole("article");
    expect(rows[0]).toHaveTextContent("Zulu FC");

    await user.selectOptions(screen.getByLabelText("Sortierung"), "chance");
    rows = screen.getAllByRole("article");
    expect(rows[0]).toHaveTextContent("Alpha FC");
    // Karten stehen erst zur Wahl, wenn die Frage Karten ist.
    expect(within(screen.getByLabelText("Sortierung")).queryByRole("option", { name: "Karten" })).not.toBeInTheDocument();
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

    await user.click(within(await openFilters(user)).getByRole("button", { name: "Wettbewerbe auswählen" }));
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

    const menu = await openFilters(user);
    await user.click(within(menu).getByRole("switch", { name: "Nur Spiele mit Empfehlung vor Anpfiff" }));
    // Beide Testpartien tragen eine Empfehlung, der Umfang bleibt also gleich gross -
    // entscheidend ist, dass der Schalter den gemeldeten Umfang steuert.
    await waitFor(() => expect(watched(calls).length).toBeGreaterThan(0));
    // Der Umfang steht nur noch im Kopf, die Notiz darunter nennt nur die Kosten.
    expect(menu.querySelector(".filter-menu-count")).toHaveTextContent("Beobachtet 2 von 2");
    expect(within(menu).getByText("Abgewählte kosten keine API-Aufrufe.")).toBeInTheDocument();
    // Der Filter steht auch bei geschlossenem Menü da.
    expect(screen.getByRole("button", { name: "Filter, 1 aktiv" })).toBeInTheDocument();
  });
});
