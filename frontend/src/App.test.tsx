import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, MarketCard } from "./App";
import type { DashboardDocument, DashboardFixture, DashboardMarket, FixtureInsights } from "./types";

/**
 * Ein leerer, aber gültiger Kennzahlenbestand. Die Detailpanels rendern damit, ohne dass
 * jeder Test eigene Historien mitbringen muss.
 */
function emptyInsights(fixtureId: number): FixtureInsights {
  return {
    fixtureId,
    league: { id: 78, name: "Bundesliga", country: "Deutschland", season: 2026 },
    home: { id: 1, name: "Alpha FC" },
    away: { id: 2, name: "Gast FC" },
    homeMatches: [], awayMatches: [], h2h: [],
    coverage: { matches: 0, withMinutes: 0, withStats: 0 },
    fetchedAt: "2026-08-16T10:00:00.000Z",
    apiRequests: 0
  };
}

/** Beantwortet beide Endpunkte der App: den Dashboard-Lauf und die Detailkennzahlen. */
function dashboardFetch(
  read: () => DashboardDocument,
  insights: (fixtureId: number) => unknown = emptyInsights
) {
  return vi.fn((url: string) => {
    const target = String(url);
    if (!target.startsWith("/api/fixture/insights")) {
      return Promise.resolve(new Response(JSON.stringify(read()), { status: 200 }));
    }
    const fixtureId = Number(new URLSearchParams(target.split("?")[1] ?? "").get("fixture"));
    const body = insights(fixtureId);
    const failed = !!body && typeof body === "object" && "error" in body;
    return Promise.resolve(new Response(JSON.stringify(body), { status: failed ? 503 : 200 }));
  });
}

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
    form: {
      scope: "venue", home: ["win", "draw", "loss"], away: ["loss", "draw", "win"],
      homeMatches: [{ fixtureId: 9501, teamWasHome: true, date: "2026-04-24T18:00:00.000Z", homeTeam, awayTeam: "Vorheim FC", homeGoals: 2, awayGoals: 1 }],
      awayMatches: [{ fixtureId: 9001, teamWasHome: true, date: "2026-04-24T18:00:00.000Z", homeTeam: "Vorauswärts FC", awayTeam: "Gast FC", homeGoals: 0, awayGoals: 0 }]
    },
    h2h: {
      outcomes: ["win", "draw", "loss"], btts: [true, false, true], draws: 1, consecutiveDraws: 0,
      matches: [{ fixtureId: 9502, teamWasHome: true, date: "2026-05-01T18:00:00.000Z", homeTeam, awayTeam: "Gast FC", homeGoals: 2, awayGoals: 1 }]
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
    ],
    leagues: []
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

/** Öffnet das Filtermenü über den Knopf in der Werkzeugleiste und gibt das Fenster zurück. */
async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Filter(, \d+ aktiv)?$/ }));
  return screen.getByRole("dialog", { name: "Filter" });
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
    window.localStorage.clear();
  });

  it("zeigt einen verständlichen Zustand ohne Dashboard-Datei", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    render(<App />);
    expect(await screen.findByText("Noch keine Analyse vorhanden")).toBeInTheDocument();
    expect(screen.getByText(/Dashboard-Lauf im Chat/)).toBeInTheDocument();
  });

  /** Gold ★ ist die höhere Stufe ("Sehr empfehlenswert") - der Hinweis hatte es vertauscht. */
  it("erklärt im Einsteigerhinweis die Stufen in der richtigen Reihenfolge", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    const hint = globalThis.document.querySelector(".banner p");
    expect(hint).toHaveTextContent("Gold ★ heißt sehr empfehlenswert, Grün ✓ empfehlenswert.");
    expect(hint).toHaveTextContent("über „Filter“ ein");
  });

  it("filtert Empfehlungen und Märkte und öffnet Fixture-Details", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Markt")).queryByRole("option", { name: "1. HZ Ü0,5" })).not.toBeInTheDocument();
    const summary = globalThis.document.querySelector(".fixture-summary-cell");
    expect(summary).toHaveTextContent("Alpha FC");
    expect(summary).toHaveTextContent("20:00");
    expect(summary).toHaveTextContent("Deutschland · Bundesliga");
    expect(globalThis.document.querySelector(".fixture-row > .time-cell")).not.toBeInTheDocument();
    expect(globalThis.document.querySelector(".fixture-row > .teams-cell")).not.toBeInTheDocument();
    const formLabels = globalThis.document.querySelector(".form-labels");
    expect(formLabels).toHaveTextContent("HomeAway");
    expect(formLabels).not.toHaveTextContent("H/A");

    await user.click(within(await openFilters(user)).getByRole("radio", { name: /Starke Tipps/ }));
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "draw");
    expect(globalThis.document.querySelector(".table-head")?.textContent).toContain("Remis");
    expect(globalThis.document.querySelector(".table-head")).toHaveClass("has-score");

    await user.selectOptions(screen.getByLabelText("Markt"), "btts");
    const bttsHeader = globalThis.document.querySelector<HTMLElement>(".table-head");
    expect(bttsHeader).not.toHaveClass("has-score");
    expect(bttsHeader?.style.getPropertyValue("--market-count")).toBe("1");
    expect(globalThis.document.querySelector(".fixture-row")).not.toHaveClass("has-score");

    await user.click(screen.getByRole("button", { name: /Alpha FCGast FC/i }));
    expect(await within(screen.getByLabelText("Details")).findByText("Direkte Begegnungen")).toBeInTheDocument();
    expect(screen.getAllByText(/Testbegründung/)).toHaveLength(5);
  });

  it("schreibt bei Pokal- und Länderspielen Alle statt Home und Away über die Form", async () => {
    const current = document();
    current.fixtures[0] = {
      ...current.fixtures[0]!,
      crossLeague: true,
      form: { ...current.fixtures[0]!.form, scope: "overall" }
    };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    const formLabels = globalThis.document.querySelector(".form-labels");
    expect(formLabels).toHaveTextContent("AlleAlle");
    expect(formLabels).not.toHaveTextContent("Home");
    expect(formLabels).toHaveAttribute("title", expect.stringContaining("zu Hause und auswärts zusammen"));
  });

  it("stellt jedem Teamnamen der Übersicht sein Wappen voran, ohne URL die Initialen", async () => {
    const current = document();
    current.fixtures[0] = { ...current.fixtures[0]!, homeCrest: "https://media.example/33.png" };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const names = [...globalThis.document.querySelectorAll(".fixture-row .team-name")];
    expect(names[0]!.firstElementChild).toHaveAttribute("src", "https://media.example/33.png");
    expect(names[1]!.firstElementChild).toHaveTextContent("GA");
    // Der Name steht direkt daneben; das Wappen darf ihn für Vorlesehilfen nicht verdoppeln.
    expect(screen.getByRole("button", { name: /Alpha FCGast FC/i })).toBeInTheDocument();
  });

  /** Davids Vorgabe: das Elo unverbindlich neben dem Namen, die Erklärung im Tooltip. */
  it("zeigt das Team-Elo klein neben dem Namen, mit Vertrauen im Tooltip", async () => {
    const current = document();
    current.fixtures[0] = {
      ...current.fixtures[0]!,
      homeElo: { elo: 2104.4, confidence: 96, system: "club", asOf: "2026-09-24T12:00:00.000Z" },
      awayElo: { elo: 1612, confidence: 31, system: "club", asOf: "2026-09-24T12:00:00.000Z" }
    };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    const home = await screen.findByText("2104");
    expect(home).toHaveClass("elo-tag");
    expect(home).toHaveAttribute("title", expect.stringContaining("Vertrauen 96 %"));
    expect(home).toHaveAttribute("title", expect.stringContaining("geht in keinen Tipp ein"));
    // Nicht „aus allen bisherigen Spielen": Das Elo zählt nur die letzten fünf Jahre.
    expect(home).toHaveAttribute("title", expect.stringContaining("Spielen der letzten fünf Jahre"));
    // Auf dünner Grundlage blasser.
    expect(screen.getByText("1612")).toHaveClass("unsicher");
  });

  it("synchronisiert die H2H-Ansicht mit dem ausgewählten Markt", async () => {
    const current = document();
    current.schemaVersion = 2;
    current.fixtures = current.fixtures.map((item) => ({
      ...item,
      markets: [
        ...item.markets,
        { ...item.markets[3]!, key: "firstHalfOver05", label: "1. HZ Ü0,5", selection: "1. Halbzeit: mindestens 1 Tor" },
        { ...item.markets[3]!, key: "firstHalfOver15", label: "1. HZ Ü1,5", selection: "1. Halbzeit: mindestens 2 Tore" },
        { ...item.markets[3]!, key: "under25", label: "Unter 2,5", selection: "Höchstens 2 Tore" }
      ]
    }));
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    const markets = screen.getByLabelText("Markt");
    // H2H und Form teilen sich im Filtermenü einen Umschalter; der Markt steht sichtbar in der
    // Leiste. Das Menü wird je Prüfung geöffnet und wieder geschlossen, denn ein Marktwechsel ist
    // ein Klick außerhalb und schließt es.
    const display = async () => {
      const menu = await openFilters(user);
      const checked = (name: string) =>
        (within(menu).queryByRole("group", { name })?.querySelector("input:checked") as HTMLInputElement | null)?.value;
      const result = {
        view: checked("Punkte in Form und H2H (direkte Duelle)"),
        line: checked("Linie"),
        direction: checked("Richtung")
      };
      await user.keyboard("{Escape}");
      return result;
    };

    await user.selectOptions(markets, "btts");
    expect(await display()).toEqual({ view: "btts", line: undefined, direction: undefined });

    await user.selectOptions(markets, "over15");
    expect(await display()).toEqual({ view: "over", line: "1.5", direction: "over" });

    await user.selectOptions(markets, "over25");
    expect(await display()).toMatchObject({ line: "2.5" });

    // Ein Gegenmarkt stellt Linie und Richtung zugleich ein.
    await user.selectOptions(markets, "under25");
    expect(await display()).toEqual({ view: "over", line: "2.5", direction: "under" });

    await user.selectOptions(markets, "firstHalfOver05");
    expect(await display()).toEqual({ view: "firstHalfOver", line: "0.5", direction: "over" });

    await user.selectOptions(markets, "firstHalfOver15");
    expect(await display()).toMatchObject({ line: "1.5" });

    // Linie und Richtung erscheinen nur, wenn es um Tore geht.
    await user.selectOptions(markets, "1x2");
    expect(await display()).toEqual({ view: "outcome", line: undefined, direction: undefined });
    await user.selectOptions(markets, "draw");
    expect(await display()).toMatchObject({ view: "outcome" });
  });

  it("zeigt Vorteil und Kelly ab Werk nicht, auch wenn der alte Schlüssel an war", async () => {
    // Bis 27.09.2026 schrieb die App "1" schon beim ersten Laden - das darf nicht mehr gelten.
    window.localStorage.setItem("football-analyzer:kelly-visible", "1");
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /Kelly-Kriterium öffnen/ })).not.toBeInTheDocument();
    expect(within(await openFilters(user)).getByRole("switch", { name: /Vorteil & Kelly-Einsatz anzeigen/i })).not.toBeChecked();
  });

  /**
   * Die Schalter stehen im Filtermenü in den Gruppen "Umfang" und "Anzeige", die Statuszeile
   * unter der Werkzeugleiste zählt, was die aktuelle Filterung übrig lässt. Die Zahl "mit
   * Vorteil" ist Value und steht deshalb nur mit dem Kelly-Schalter da.
   */
  it("bündelt die Schalter im Filtermenü und zählt den gefilterten Stand", async () => {
    window.localStorage.setItem("football-analyzer:kelly-visible-v2", "1");
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const status = globalThis.document.querySelector(".filter-status");
    expect(screen.getByRole("button", { name: /Kelly-Kriterium öffnen/ })).toBeInTheDocument();
    expect(status).toHaveTextContent("mit Vorteil");

    const menu = await openFilters(user);
    expect(within(menu).getByRole("heading", { name: "Umfang" })).toBeInTheDocument();
    expect(within(menu).getByRole("heading", { name: "Anzeige" })).toBeInTheDocument();
    // Ab Werk ist kein Schalter an - "an" heißt im Menü immer "Filter aktiv" oder "Anzeige an".
    expect(within(menu).getByRole("switch", { name: "Nur Ligaspiele" })).not.toBeChecked();
    expect(within(menu).getByRole("switch", { name: "Angepfiffene Spiele zeigen" })).not.toBeChecked();
    await user.click(within(menu).getByRole("switch", { name: /Vorteil & Kelly-Einsatz anzeigen/i }));
    expect(screen.queryByRole("button", { name: /Kelly-Kriterium öffnen/ })).not.toBeInTheDocument();
    expect(status).not.toHaveTextContent("mit Vorteil");

    expect(status).toHaveTextContent("Spiele angezeigt");
    expect(status?.querySelector("strong")).toHaveTextContent("2");

    // Die erste Zahl folgt dem Tabellenfilter, die Zähler im Menü bleiben beim vollen Umfang.
    const headCount = menu.querySelector(".filter-menu-count");
    expect(headCount).toHaveTextContent("2 Spiele angezeigt");
    await user.click(within(menu).getByRole("radio", { name: /Starke Tipps/ }));
    expect(status?.querySelector("strong")).toHaveTextContent("1");
    // Die Statuszeile liegt unter dem Menü - der Kopf zeigt dieselbe Zahl, wo man hinschaut.
    expect(headCount).toHaveTextContent("1 Spiel angezeigt");
    expect(within(menu).getByRole("radio", { name: /Alle Spiele/ }).closest("label")).toHaveTextContent("2");
  });

  it("kennzeichnet besonders defensiv starke Teams mit einem Shield", async () => {
    const current = document();
    current.fixtures[0]!.defense = {
      home: { concededGoals: 0.64, relativeToLeague: 0.54, matches: 18, venueMatches: 9, strong: true },
      away: { concededGoals: 1.3, relativeToLeague: 1.02, matches: 18, venueMatches: 9, strong: false }
    };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Alpha FC: starke Abwehr, aus den kassierten Toren belegt/ })).toHaveClass("fallback");
    expect(screen.queryByRole("img", { name: /Gast FC:.*Defensive/ })).not.toBeInTheDocument();
  });

  it("zeigt xGA-verifizierte Shields gefüllt mit Coverage im ARIA-Text", async () => {
    const current = document();
    current.schemaVersion = 3;
    current.fixtures[0]!.defense = {
      home: { concededGoals: 0.62, relativeToLeague: 0.52, matches: 18, venueMatches: 9, strong: true,
        source: "xg", badge: "verified", percentile: 0.94, expectedGoalsAgainst: 0.71,
        xgMatches: 17, venueXgMatches: 8, xgCoverage: 0.94, venueXgCoverage: 0.89, confidence: 88 },
      away: { concededGoals: 1.3, relativeToLeague: 1.02, matches: 18, venueMatches: 9, strong: false }
    };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    const shield = await screen.findByRole("img", { name: /Alpha FC: starke Abwehr, durch xG bestätigt/ });
    expect(shield).toHaveClass("verified");
    expect(shield).toHaveAttribute("aria-label", expect.stringContaining("xG-Werte liegen für 94 % der Spiele vor"));
  });

  it("zeigt Halbzeitmärkte aus Schema 2 mit dynamischen erwarteten Toren", async () => {
    const current = document();
    current.schemaVersion = 2;
    current.fixtures = current.fixtures.map((item, index) => ({
      ...item,
      expectedFirstHalfGoals: index === 0
        ? { home: 0.7, away: 0.4, total: 1.1 }
        : { home: 0.3, away: 0.2, total: 0.5 },
      markets: [
        ...item.markets,
        {
          key: "firstHalfOver05", label: "1. HZ Ü0,5", selection: "1. Halbzeit: mindestens 1 Tor",
          pick: null, selectionTone: "neutral", probability: index === 0 ? 0.78 : 0.55, odds: null,
          confidence: 85, score: null, recommendation: { level: index === 0 ? "recommended" : "none", label: index === 0 ? "Empfehlenswert" : "Nicht empfehlenswert" },
          details: ["Erwartete Tore 1. Halbzeit"]
        },
        {
          key: "firstHalfOver15", label: "1. HZ Ü1,5", selection: "1. Halbzeit: mindestens 2 Tore",
          pick: null, selectionTone: "neutral", probability: 0.4, odds: 2.4, confidence: 85, score: null,
          recommendation: { level: "recommended", label: "Empfehlenswert" }, details: ["Halbzeit-Test"]
        }
      ]
    }));
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Markt"), "firstHalfOver05");
    expect(globalThis.document.querySelector(".table-head")?.textContent).toContain("Erw. Tore 1. HZ");
    const firstRow = globalThis.document.querySelector(".fixture-row");
    expect(firstRow?.textContent).toContain("0,70:0,40");
    expect(firstRow?.textContent).toContain("78,0 %");
    expect(firstRow?.textContent).toContain("–");
  });

  it("zeigt die letzten fünf H2H nach Halbzeit-Über 0,5 und 1,5", async () => {
    const current = document();
    current.schemaVersion = 2;
    current.fixtures[0]!.h2h.matches = [
      { fixtureId: 9002, teamWasHome: true, date: "2026-05-05T18:00:00.000Z", homeTeam: "Alpha FC", awayTeam: "Gast FC", homeGoals: 2, awayGoals: 1, halfTimeHomeGoals: 1, halfTimeAwayGoals: 0 },
      { fixtureId: 9003, teamWasHome: true, date: "2026-04-05T18:00:00.000Z", homeTeam: "Gast FC", awayTeam: "Alpha FC", homeGoals: 1, awayGoals: 0, halfTimeHomeGoals: 0, halfTimeAwayGoals: 0 },
      { fixtureId: 9004, teamWasHome: true, date: "2026-03-05T18:00:00.000Z", homeTeam: "Alpha FC", awayTeam: "Gast FC", homeGoals: 3, awayGoals: 1, halfTimeHomeGoals: 1, halfTimeAwayGoals: 1 },
      { fixtureId: 9005, teamWasHome: true, date: "2026-02-05T18:00:00.000Z", homeTeam: "Gast FC", awayTeam: "Alpha FC", homeGoals: 1, awayGoals: 2, halfTimeHomeGoals: 0, halfTimeAwayGoals: 1 },
      { fixtureId: 9006, teamWasHome: true, date: "2026-01-05T18:00:00.000Z", homeTeam: "Alpha FC", awayTeam: "Gast FC", homeGoals: 2, awayGoals: 0, halfTimeHomeGoals: null, halfTimeAwayGoals: null }
    ];
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    // Das Menü bleibt offen, solange nur darin gewählt wird - die Tabelle daneben zeigt die Wirkung.
    const menu = await openFilters(user);
    await user.click(within(menu).getByRole("radio", { name: "Tore 1. HZ" }));
    const line = within(menu).getByRole("group", { name: "Linie" });
    const direction = within(menu).getByRole("group", { name: "Richtung" });
    expect(within(line).getAllByRole("radio").map((option) => option.closest("label")!.textContent))
      .toEqual(["0,5", "1,5"]);
    const firstH2h = globalThis.document.querySelector(".fixture-row")!;
    const dots = () => Array.from(firstH2h.querySelectorAll(".h2h-cell .result-dot"));
    // Die Punkte zeigen die Halbzeit-Torzahl; ob die Linie gerissen wurde, sagt die Farbe.
    // Die Zahl bleibt deshalb gleich, wenn die Linie wechselt - hit/miss dreht sich.
    const hits = () => dots().map((dot) => dot.classList.contains("hit") ? "Ü" : dot.classList.contains("miss") ? "U" : "–");
    expect(dots().map((dot) => dot.textContent)).toEqual(["1", "0", "2", "1", "–"]);
    expect(hits()).toEqual(["Ü", "U", "Ü", "Ü", "–"]);

    await user.click(within(line).getByRole("radio", { name: "1,5" }));
    expect(dots().map((dot) => dot.textContent)).toEqual(["1", "0", "2", "1", "–"]);
    expect(hits()).toEqual(["U", "U", "Ü", "U", "–"]);

    // Bei der Gegenrichtung bleibt die Torzahl gleich, aber getroffen hat, wer darunter blieb.
    await user.click(within(direction).getByRole("radio", { name: "Unter" }));
    expect(dots().map((dot) => dot.textContent)).toEqual(["1", "0", "2", "1", "–"]);
    expect(hits()).toEqual(["Ü", "Ü", "U", "Ü", "–"]);
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
    vi.stubGlobal("fetch", dashboardFetch(() => current));
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
    current.fixtures = forms.map(([name, home, away], index) => {
      const base = fixture(index + 1, name, "none", `2026-08-17T${String(12 + index).padStart(2, "0")}:00:00.000Z`);
      return { ...base, form: { ...base.form, home: [...home], away: [...away] } };
    });
    current.meta.fixtureCount = current.fixtures.length;
    vi.stubGlobal("fetch", dashboardFetch(() => current));
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
    const current = rangeDocument();
    // Angepfiffen, aber längst vorbei: liegt außerhalb des Live-Fensters von 200 Minuten.
    current.fixtures.push(fixture(5, "Lange vorbei", "none", "2026-08-16T08:00:00.000Z"));
    current.meta.fixtureCount = current.fixtures.length;
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    expect(await screen.findByText("Exakter Start")).toBeInTheDocument();
    expect(screen.getByText("Exaktes Ende")).toBeInTheDocument();
    expect(screen.queryByText("Vor Start")).not.toBeInTheDocument();
    expect(screen.queryByText("Nach Ende")).not.toBeInTheDocument();
    const menu = await openFilters(user);
    expect(within(menu).getByRole("button", { name: "Nächste 48 Std." })).toHaveAttribute("aria-pressed", "true");

    // Der Haken ist der ausdrückliche Override: zusätzlich zu den kommenden Partien
    // erscheinen die gerade laufenden. Die obere 48-Stunden-Grenze bleibt unangetastet,
    // und längst beendete Partien bleiben ebenfalls draußen.
    await user.click(within(menu).getByRole("switch", { name: "Angepfiffene Spiele zeigen" }));
    expect(screen.getByText("Vor Start")).toBeInTheDocument();
    expect(screen.queryByText("Nach Ende")).not.toBeInTheDocument();
    expect(screen.queryByText("Lange vorbei")).not.toBeInTheDocument();
  });

  /** Welche Tage im Zeitraum-Raster gerade gewählt sind (`aria-pressed`). */
  const pressedDays = (menu: HTMLElement) =>
    within(within(menu).getByRole("group", { name: "Zeitraum" }))
      .getAllByRole("button", { name: /August 2026/ })
      .filter((day) => day.getAttribute("aria-pressed") === "true")
      .map((day) => day.querySelector(".day-num")?.textContent);

  it("wählt Tage direkt im Menü, normalisiert die Reihenfolge und erlaubt spielfreie Tage", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => rangeDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Exakter Start")).toBeInTheDocument();
    const menu = await openFilters(user);
    await user.click(within(menu).getByRole("switch", { name: "Angepfiffene Spiele zeigen" }));
    const days = within(menu).getByRole("group", { name: "Zeitraum" });

    // Nur die Tage der Analyse stehen im Raster; andere Zellen bleiben leer statt grau.
    expect(within(days).queryByRole("button", { name: /15. August 2026/ })).not.toBeInTheDocument();
    expect(within(days).getByRole("button", { name: /17. August 2026/ })).toBeInTheDocument();

    // Der Kartenkopf nennt, wie weit die 48 Stunden reichen; der Hinweis steht schon vor dem Klick.
    expect(within(menu).getByText(/^bis [A-Z][a-z] \d{2}\.\d{2}\., \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(days).getByText("Ein Tag: einmal klicken. Mehrere Tage: ersten und letzten anklicken.")).toBeInTheDocument();

    // Ein Klick wählt einen Tag - sofort, ohne Übernehmen.
    await user.click(within(days).getByRole("button", { name: /18. August 2026/ }));
    expect(pressedDays(menu)).toEqual(["18"]);
    expect(within(days).getByText("Noch den letzten Tag anklicken – sonst gilt nur dieser.")).toBeInTheDocument();
    expect(screen.getByText("Exaktes Ende")).toBeInTheDocument();
    expect(screen.queryByText("Exakter Start")).not.toBeInTheDocument();

    // Der zweite Klick macht daraus einen Zeitraum, auch rückwärts.
    await user.click(within(days).getByRole("button", { name: /16. August 2026/ }));
    expect(pressedDays(menu)).toEqual(["16", "17", "18"]);
    expect(screen.getByText("Exakter Start")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "16.08. – 18.08." })).toBeInTheDocument();

    // Der dritte beginnt neu; ein Tag ohne Spiele ist erlaubt.
    await user.click(within(days).getByRole("button", { name: /17. August 2026/ }));
    expect(pressedDays(menu)).toEqual(["17"]);
    expect(screen.getByText("Keine Spiele für diese Auswahl")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeInTheDocument();

    await user.click(within(days).getByRole("button", { name: "Nächste 48 Std." }));
    expect(screen.getByText("Exaktes Ende")).toBeInTheDocument();
    expect(within(days).getByRole("button", { name: "Nächste 48 Std." })).toHaveAttribute("aria-pressed", "true");
    expect(pressedDays(menu)).toEqual([]);
  });

  it("beginnt nach „Nächste 48 Std.“ mit einem einzelnen Tag, und Escape schließt das Menü", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => rangeDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Exakter Start")).toBeInTheDocument();
    const menu = await openFilters(user);
    const days = within(menu).getByRole("group", { name: "Zeitraum" });

    await user.click(within(days).getByRole("button", { name: /16. August 2026/ }));
    await user.click(within(days).getByRole("button", { name: "Nächste 48 Std." }));
    // Sonst hinge dieser Klick still an den 16. an und ergäbe 16. bis 18.
    await user.click(within(days).getByRole("button", { name: /18. August 2026/ }));
    expect(pressedDays(menu)).toEqual(["18"]);
    // Ein einzelner Tag heißt im Schildchen wie ein Tag, nicht "18.08. – 18.08.".
    expect(screen.getByRole("button", { name: /^Di\.? 18\.08\.$/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter, 1 aktiv" })).toHaveFocus();
  });

  it("begrenzt einen benutzerdefinierten Bereich nach einem Snapshot-Refresh", async () => {
    let current = rangeDocument();
    const fetchMock = dashboardFetch(() => current);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Exakter Start")).toBeInTheDocument();
    const menu = await openFilters(user);
    const days = within(menu).getByRole("group", { name: "Zeitraum" });
    await user.click(within(days).getByRole("button", { name: /16. August 2026/ }));
    await user.click(within(days).getByRole("button", { name: /18. August 2026/ }));

    current = document("2026-08-17T10:00:00.000Z", "Nur neuer Tag");
    current.meta.firstAvailableDate = "2026-08-17";
    current.meta.lastAvailableDate = "2026-08-17";
    current.meta.maximumDays = 1;
    current.meta.fixtureCount = 1;
    current.fixtures = [fixture(10, "Nur neuer Tag", "strong", "2026-08-17T18:00:00.000Z")];
    fireEvent.focus(window);
    expect(await screen.findByText("Nur neuer Tag")).toBeInTheDocument();
    await waitFor(() => expect(pressedDays(screen.getByRole("dialog", { name: "Filter" }))).toEqual(["17"]));
  });

  /**
   * Das Menü verdrängt nichts und ist meist zu. Damit dann kein Filter unbemerkt Spiele
   * versteckt, steht jeder als Schildchen da, und der Knopf zählt sie.
   */
  it("zählt aktive Filter am Knopf und hebt sie über Schildchen auf", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute("aria-expanded", "false");

    const menu = await openFilters(user);
    expect(within(menu).getByRole("heading", { name: "Filter" })).toHaveFocus();
    await user.click(within(menu).getByRole("radio", { name: /Starke Tipps/ }));
    await user.click(within(menu).getByRole("switch", { name: "Angepfiffene Spiele zeigen" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter, 2 aktiv" })).toHaveFocus();
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Bewertungsfilter aufheben" }));
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();
    // Das Schildchen verschwindet mit dem Filter; der Fokus landet am Knopf.
    expect(screen.getByRole("button", { name: "Filter, 1 aktiv" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Mit angepfiffenen Spielen" }));
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeInTheDocument();
  });

  it("setzt alle Filter zurück, und ohne Spiele zwischen Ligen gilt kein Klassenfilter", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const menu = await openFilters(user);
    const reset = within(menu).getByRole("button", { name: "Alle Filter zurücksetzen" });
    expect(reset).toBeDisabled();
    const leagueOnly = within(menu).getByRole("switch", { name: "Nur Ligaspiele" });
    // Umgedreht gegenüber früher: ab Werk aus, "an" ist der Filter.
    expect(leagueOnly).not.toBeChecked();
    await user.click(within(menu).getByRole("radio", { name: "Nur mit Klassenunterschied" }));
    // Sonst bliebe "nur mit" bei leerer Tabelle in einem abgeschalteten Feld stehen.
    await user.click(leagueOnly);
    expect(within(menu).getByRole("radio", { name: "Alle" })).toBeChecked();
    expect(within(menu).getByRole("radio", { name: "Nur mit Klassenunterschied" })).toBeDisabled();
    expect(within(menu).getByText("Greift nicht, solange „Nur Ligaspiele“ an ist.")).toBeInTheDocument();
    await user.click(within(menu).getByRole("radio", { name: /Starke Tipps/ }));

    await user.click(reset);
    expect(within(menu).getByRole("switch", { name: "Nur Ligaspiele" })).not.toBeChecked();
    expect(within(menu).getByRole("radio", { name: /Alle Spiele/ })).toBeChecked();
    expect(reset).toBeDisabled();
    expect(within(menu).getByRole("heading", { name: "Filter" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
  });

  it("findet Wettbewerbe über die Schnellsuche und zeigt mit „nur“ genau einen", async () => {
    const current = document();
    current.fixtures[1] = { ...current.fixtures[1]!, country: "England", league: "Championship" };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const menu = await openFilters(user);
    // Ohne Eingabe keine Trefferliste - das Menü bleibt kurz.
    expect(within(menu).queryByRole("checkbox")).not.toBeInTheDocument();
    await user.type(within(menu).getByRole("searchbox", { name: "Wettbewerb schnell suchen" }), "cham");
    expect(within(menu).getByRole("checkbox", { name: "England · Championship" })).toBeChecked();
    expect(within(menu).queryByRole("checkbox", { name: "Deutschland · Bundesliga" })).not.toBeInTheDocument();

    await user.click(within(menu).getByRole("button", { name: "Nur England · Championship zeigen" }));
    expect(screen.queryByText("Alpha FC")).not.toBeInTheDocument();
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 von 2 Wettbewerben" })).toBeInTheDocument();

    await user.click(within(menu).getByRole("checkbox", { name: "England · Championship" }));
    expect(screen.getByRole("button", { name: "0 von 2 Wettbewerben" })).toBeInTheDocument();
  });

  it("schließt das Menü bei Klick außerhalb, aber nicht aus dem Wettbewerbe-Dialog heraus", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const menu = await openFilters(user);
    await user.click(within(menu).getByRole("button", { name: "Wettbewerbe auswählen" }));
    const leagues = screen.getByRole("dialog", { name: "Wettbewerbe auswählen" });
    await user.click(within(leagues).getByRole("checkbox", { name: "Deutschland · Bundesliga" }));
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeInTheDocument();

    // Escape schließt nur den obersten Dialog.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Wettbewerbe auswählen" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", { name: "Wettbewerbe auswählen" }))
      .toHaveTextContent("0 von 1 Wettbewerben");

    await user.click(globalThis.document.body);
    expect(screen.queryByRole("dialog", { name: "Filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0 von 1 Wettbewerben" })).toBeInTheDocument();
  });

  it("wechselt die Ansicht über die linke Leiste und merkt sich die Wahl", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Ansichten" });
    expect(within(nav).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Tabelle", "Heatmap", "Live", "Marktprofil"]);
    expect(within(nav).getByRole("button", { name: "Tabelle" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Heatmap" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByText(/Datenstand:/)).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "Heatmap" }));
    expect(within(nav).getByRole("button", { name: "Heatmap" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Tabelle" })).not.toHaveAttribute("aria-current");
    expect(window.localStorage.getItem("football-analyzer:view")).toBe("prematch");
    expect(window.localStorage.getItem("football-analyzer:table-layout")).toBe("heatmap");
  });

  it("zeigt im Marktprofil keinen Filter-Knopf und schließt das Menü beim Ansichtswechsel", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await openFilters(user);
    const nav = screen.getByRole("navigation", { name: "Ansichten" });
    await user.click(within(nav).getByRole("button", { name: "Marktprofil" }));
    expect(window.localStorage.getItem("football-analyzer:view")).toBe("profile");
    expect(screen.queryByRole("button", { name: /^Filter/ })).not.toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "Tabelle" }));
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute("aria-expanded", "false");
  });

  it("lädt bei erneutem Fensterfokus einen neuen Lauf", async () => {
    let current = document();
    const fetchMock = dashboardFetch(() => current);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    current = document("2026-08-16T11:00:00.000Z", "Neu FC");
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByText("Neu FC")).toBeInTheDocument());
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("sammelt Wetten über das Radialmenü im Warenkorb und mischt eine Kombi", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "Zum Wett-Baukasten hinzufügen: Alpha FC – Gast FC" }));
    let radial = screen.getByRole("menu", { name: "Markt hinzufügen: Alpha FC – Gast FC" });
    await user.click(within(radial).getByRole("menuitem", { name: /1X2/ }));
    expect(screen.getByRole("button", { name: /Wett-Baukasten öffnen \(1 Wette\)/ })).toBeInTheDocument();
    // Der Fächer bleibt offen, der aufgenommene Markt ist darin gesperrt.
    expect(within(radial).getByRole("menuitem", { name: /1X2.*bereits im Warenkorb/ })).toBeDisabled();

    await user.hover(screen.getByRole("button", { name: "Zum Wett-Baukasten hinzufügen: Zulu FC – Gast FC" }));
    radial = screen.getByRole("menu", { name: "Markt hinzufügen: Zulu FC – Gast FC" });
    await user.click(within(radial).getByRole("menuitem", { name: /1X2/ }));
    const cartButton = screen.getByRole("button", { name: /Wett-Baukasten öffnen \(2 Wetten\)/ });

    await user.click(cartButton);
    const builder = screen.getByRole("dialog", { name: "Wett-Baukasten" });
    expect(within(builder).getByText("Ausgewählte Wetten (2)")).toBeInTheDocument();

    const countInput = within(builder).getByRole("spinbutton", { name: "Anzahl 2er-Kombis" });
    await user.clear(countInput);
    await user.type(countInput, "1");
    await user.click(within(builder).getByRole("button", { name: /Kombis mischen/ }));

    expect(within(builder).getByText("Kombi 1 · 2er")).toBeInTheDocument();
  });

  it("merkt sich das Schließen des Hinweisbanners über einen Reload hinweg", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hinweis schließen" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hinweis schließen" }));
    expect(screen.queryByRole("button", { name: "Hinweis schließen" })).not.toBeInTheDocument();

    unmount();
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hinweis schließen" })).not.toBeInTheDocument();
  });

  it("zeigt einen kompakten Ligatabellen-Ausschnitt bei Ligaspielen", async () => {
    const current = document();
    current.fixtures[0]!.table = [
      { position: 1, teamName: "Spitzenreiter FC", played: 10, wins: 9, draws: 1, losses: 0, points: 28, goalsFor: 30, goalsAgainst: 5 },
      { position: 2, teamName: "Alpha FC", played: 10, wins: 8, draws: 1, losses: 1, points: 25, goalsFor: 24, goalsAgainst: 10 },
      { position: 3, teamName: "Team C", played: 10, wins: 6, draws: 2, losses: 2, points: 20, goalsFor: 18, goalsAgainst: 12 },
      { position: 4, teamName: "Team D", played: 10, wins: 5, draws: 3, losses: 2, points: 18, goalsFor: 16, goalsAgainst: 13 },
      { position: 5, teamName: "Team E", played: 10, wins: 4, draws: 3, losses: 3, points: 15, goalsFor: 14, goalsAgainst: 14 },
      { position: 6, teamName: "Team F", played: 10, wins: 3, draws: 4, losses: 3, points: 13, goalsFor: 12, goalsAgainst: 13 },
      { position: 7, teamName: "Team G", played: 10, wins: 3, draws: 3, losses: 4, points: 12, goalsFor: 11, goalsAgainst: 14 },
      { position: 8, teamName: "Team H", played: 10, wins: 3, draws: 2, losses: 5, points: 11, goalsFor: 10, goalsAgainst: 15 },
      { position: 9, teamName: "Gast FC", played: 10, wins: 2, draws: 3, losses: 5, points: 9, goalsFor: 9, goalsAgainst: 16 },
      { position: 10, teamName: "Team J", played: 10, wins: 2, draws: 2, losses: 6, points: 8, goalsFor: 8, goalsAgainst: 17 },
      { position: 11, teamName: "Team K", played: 10, wins: 1, draws: 3, losses: 6, points: 6, goalsFor: 7, goalsAgainst: 18 },
      { position: 12, teamName: "Schlusslicht FC", played: 10, wins: 0, draws: 2, losses: 8, points: 2, goalsFor: 4, goalsAgainst: 22 }
    ];
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Alpha FCGast FC/i }));
    expect(await screen.findByText("Ligatabelle")).toBeInTheDocument();
    const standings = screen.getByRole("table", { name: "Ligatabelle" });
    expect(within(standings).getByText("Spitzenreiter FC")).toBeInTheDocument();
    expect(within(standings).getByText("Alpha FC")).toBeInTheDocument();
    expect(within(standings).getByText("Gast FC")).toBeInTheDocument();
    expect(within(standings).queryByText("Team E")).not.toBeInTheDocument();
    expect(within(standings).queryByText("Schlusslicht FC")).not.toBeInTheDocument();
  });

  it("zeigt beim Aufklappen die Torphasen und behält bei fehlenden Kennzahlen die H2H aus dem Lauf", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Alpha FCGast FC/i }));
    const details = within(await screen.findByLabelText("Details"));
    expect(await details.findByRole("region", { name: "Torphasen" })).toBeInTheDocument();
    expect(details.getByRole("region", { name: "Trends" })).toBeInTheDocument();
    expect(details.getByRole("region", { name: "Direkte Begegnungen" })).toBeInTheDocument();
    cleanup();

    // Ohne erreichbare Kennzahlen bleibt die Ansicht bei den direkten Duellen des Laufs.
    vi.stubGlobal("fetch", dashboardFetch(
      () => document(),
      () => ({ error: "api_unavailable" })
    ));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Alpha FCGast FC/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("API-Football ist gerade nicht erreichbar.");
    expect(await screen.findByText("Direkte Begegnungen")).toBeInTheDocument();
    expect(globalThis.document.querySelectorAll(".h2h-match-row")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Torphasen" })).not.toBeInTheDocument();
  });

  it("öffnet das Detail-Panel direkt mit dem Spinner und blendet alles andere aus", async () => {
    const current = document();
    current.fixtures[0]!.table = [
      { position: 1, teamName: "Alpha FC", played: 10, wins: 8, draws: 1, losses: 1, points: 25, goalsFor: 24, goalsAgainst: 10 },
      { position: 2, teamName: "Gast FC", played: 10, wins: 2, draws: 3, losses: 5, points: 9, goalsFor: 9, goalsAgainst: 16 }
    ];
    // Die Kennzahlen kommen nie zurück, damit der Ladezustand stehen bleibt und prüfbar ist.
    vi.stubGlobal("fetch", vi.fn((url: string) => String(url).startsWith("/api/fixture/insights")
      ? new Promise<Response>(() => {})
      : Promise.resolve(new Response(JSON.stringify(current), { status: 200 }))));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Alpha FCGast FC/i }));
    const details = within(screen.getByLabelText("Details"));
    expect(details.getByRole("status")).toHaveTextContent("Torphasen und Trends werden geladen");
    expect(globalThis.document.querySelector(".insight-loading")).toBeInTheDocument();
    expect(details.queryByText("Direkte Begegnungen")).not.toBeInTheDocument();
    expect(details.queryByText("Ligatabelle")).not.toBeInTheDocument();
    expect(details.queryByText("Bewertung je Markt")).not.toBeInTheDocument();
  });

  it("zeigt keine Ligatabelle bei Cross-League-Partien oder ohne Tabellendaten", async () => {
    const current = document();
    current.fixtures[0]!.crossLeague = true;
    current.fixtures[0]!.table = [
      { position: 1, teamName: "Alpha FC", played: 10, wins: 8, draws: 1, losses: 1, points: 25, goalsFor: 24, goalsAgainst: 10 },
      { position: 2, teamName: "Gast FC", played: 10, wins: 2, draws: 3, losses: 5, points: 9, goalsFor: 9, goalsAgainst: 16 }
    ];
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Alpha FCGast FC/i }));
    expect(await screen.findByText("Direkte Begegnungen")).toBeInTheDocument();
    expect(screen.queryByText("Ligatabelle")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Alpha FCGast FC/i }));
    await user.click(screen.getByRole("button", { name: /Zulu FCGast FC/i }));
    expect(await screen.findByText("Direkte Begegnungen")).toBeInTheDocument();
    expect(screen.queryByText("Ligatabelle")).not.toBeInTheDocument();
  });
});

describe("MarketCard", () => {
  afterEach(cleanup);

  function outcomeMarket(overrides: Partial<DashboardMarket> = {}): DashboardMarket {
    return {
      key: "1x2", label: "1X2", selection: "Auswärtssieg Gast FC", pick: "2", selectionTone: "away",
      probability: 0.65, odds: 12, confidence: 55, score: 0,
      recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: [],
      ...overrides
    };
  }

  it("zeigt Wahrscheinlichkeit und Value, solange die Basis belastbar ist", () => {
    const { container } = render(<MarketCard market={outcomeMarket()} showEdge />);
    expect(within(container).getByText("65,0 %")).toBeInTheDocument();
    expect(within(container).getByText(/56,7 PP/)).toBeInTheDocument();
    expect(container.querySelector(".market-card.unreliable")).toBeNull();
  });

  it("verschweigt Wahrscheinlichkeit und Value ohne Ligastärke-Vergleich", () => {
    const { container } = render(<MarketCard market={outcomeMarket({ probabilityReliable: false })} showEdge />);
    expect(within(container).queryByText("65,0 %")).not.toBeInTheDocument();
    expect(within(container).queryByText(/PP/)).not.toBeInTheDocument();
    expect(within(container).getByText("Ligastärke unbekannt")).toBeInTheDocument();
    expect(container.querySelector(".market-card.unreliable")).not.toBeNull();
  });
});

describe("Klassenunterschied", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  function gapDocument(): DashboardDocument {
    const current = document();
    current.fixtures[0]!.classGap = {
      level: "extreme", stronger: "away", source: "market",
      label: "Quotenbild 1,24 gegen 12,00 · kein Ligastärke-Vergleich vorhanden"
    };
    return current;
  }

  it("markiert die Partie und nennt die stärkere Seite samt Quelle", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => gapDocument()));
    const { container } = render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    const badge = container.querySelector(".class-gap")!;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toMatch(/^Klasse/);
    expect(badge.className).toContain("extreme");
    expect(badge.className).toContain("market");
    expect(badge).toHaveAttribute("title", expect.stringContaining("Sehr großer Klassenunterschied"));
    expect(badge).toHaveAttribute("title", expect.stringContaining("Gast FC ist die höhere Klasse"));
    expect(badge).toHaveAttribute("title", expect.stringContaining("Markt: Quotenbild 1,24 gegen 12,00"));
  });

  it("filtert Partien mit und ohne Klassenunterschied", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => gapDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();

    const menu = await openFilters(user);
    await user.click(within(menu).getByRole("radio", { name: "Nur mit Klassenunterschied" }));
    expect(screen.getByText("Alpha FC")).toBeInTheDocument();
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();

    await user.click(within(menu).getByRole("radio", { name: "Ohne Klassenunterschied" }));
    expect(screen.queryByText("Alpha FC")).not.toBeInTheDocument();
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();
  });

  /**
   * Alpha FC erfüllt Daves Kriterien (7 Plätze und 1,5 Punkte je Spiel voraus, Heimform
   * 80 % gegen 7 %, Quote 1,80, 75 Punkte), Zulu FC nicht - dort stehen beide Seiten in
   * gleich guter Form, es gibt also keine klar stärkere.
   */
  function quickpickDocument(): DashboardDocument {
    const current = document();
    current.fixtures[0]!.form = {
      ...current.fixtures[0]!.form,
      home: ["win", "win", "win", "win", "loss"],
      away: ["loss", "loss", "loss", "draw", "loss"]
    };
    current.fixtures[0]!.table = [
      { position: 1, teamName: "Alpha FC", played: 10, wins: 8, draws: 1, losses: 1, points: 25, goalsFor: 25, goalsAgainst: 8 },
      { position: 8, teamName: "Gast FC", played: 10, wins: 3, draws: 1, losses: 6, points: 10, goalsFor: 10, goalsAgainst: 18 }
    ];
    current.fixtures[1]!.form = {
      ...current.fixtures[1]!.form,
      home: ["win", "win", "win", "win", "loss"],
      away: ["win", "win", "win", "win", "loss"]
    };
    return current;
  }

  async function applyQuickpick(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    await user.click(screen.getByRole("button", { name: "Filter anwenden" }));
    await user.keyboard("{Escape}");
  }

  it("kürzt die Tabelle auf die Treffer des Quickpickers", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await applyQuickpick(user);

    expect(screen.getByText("Alpha FC")).toBeInTheDocument();
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();
  });

  /**
   * Die Kennzahlen zählen weiter den vollen Umfang - wie bei Bewertungs- und Klassenfilter.
   * Sonst hinge auch die Kelly-Auswahl am Tabellenfilter, und die hat ihre eigene Regel.
   */
  it("lässt die Zähler im Filtermenü unberührt", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    const total = async () => {
      const count = within(await openFilters(user)).getByRole("radio", { name: /Alle Spiele/ }).closest("label")!.textContent;
      await user.keyboard("{Escape}");
      return count;
    };
    expect(await total()).toContain("2");

    await applyQuickpick(user);

    expect(await total()).toContain("2");
    // Der Quickpick zählt am Filter-Knopf mit - er blendet Spiele aus wie jeder andere Filter.
    expect(screen.getByRole("button", { name: "Filter, 1 aktiv" })).toBeInTheDocument();
  });

  it("nimmt den Filter mit einem Klick auf das Kreuz zurück", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await applyQuickpick(user);
    expect(screen.getByText(/Daves 1x2-Filter · 1 von 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quickpick-Filter aufheben" }));
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();
  });

  /** Escape schließt das Panel - der Filter bleibt, sonst ginge er beim Wegklicken verloren. */
  it("behält den Filter, wenn das Panel mit Escape geschlossen wird", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await applyQuickpick(user);

    expect(screen.queryByRole("dialog", { name: "Quickpicker" })).not.toBeInTheDocument();
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();
  });

  /**
   * Der eigentliche Zweck des Filters: Treffer in den Wettschein, dort Kombis bauen.
   * Deshalb ist der Weg vom Panel zum geöffneten Baukasten ein Test wert.
   */
  it("legt die Treffer in den Wettschein und öffnet den Baukasten", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    await user.click(screen.getByRole("button", { name: /in den Wettschein/ }));

    const drawer = screen.getByRole("dialog", { name: "Wett-Baukasten" });
    expect(within(drawer).getAllByText(/Alpha FC/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog", { name: "Quickpicker" })).not.toBeInTheDocument();
  });

  it("erklärt eine leere Tabelle mit dem Quickpicker statt mit dem Zeitraum", async () => {
    const empty = quickpickDocument();
    empty.fixtures[0]!.form = { ...empty.fixtures[0]!.form, away: ["win", "win", "win", "win", "loss"] };
    vi.stubGlobal("fetch", dashboardFetch(() => empty));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await applyQuickpick(user);

    expect(screen.getByText(/Daves 1x2-Filter lässt keine Partie übrig/)).toBeInTheDocument();
    expect(screen.getByText(/keine Mannschaft ist in der Form klar besser/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter aufheben" }));
    expect(screen.getByText("Alpha FC")).toBeInTheDocument();
  });
});

describe("Schüsse und Ecken", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const mitZahlen = (
    id: number,
    name: string,
    heim: { shotsOnGoal: number | null; corners: number | null } | undefined,
    gast: { shotsOnGoal: number | null; corners: number | null } | undefined
  ) => {
    const base = fixture(id, name, "none", `2026-08-16T${String(17 + id).padStart(2, "0")}:00:00.000Z`);
    return {
      ...base,
      form: {
        ...base.form,
        ...(heim ? { homeStats: { ...heim, matches: 5 } } : {}),
        ...(gast ? { awayStats: { ...gast, matches: 5 } } : {})
      }
    };
  };

  it("zeigt den Schnitt beider Seiten und einen Strich, wo nichts überliefert ist", async () => {
    const current = document();
    current.fixtures = [
      mitZahlen(1, "Mit Zahlen", { shotsOnGoal: 5.2, corners: 6.4 }, { shotsOnGoal: 3, corners: 2 }),
      mitZahlen(2, "Ohne Zahlen", undefined, undefined)
    ];
    current.meta.fixtureCount = 2;
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    expect(await screen.findByText("Mit Zahlen")).toBeInTheDocument();

    const zeilen = globalThis.document.querySelectorAll(".fixture-row");
    expect(zeilen[0]?.textContent).toContain("5,2");
    expect(zeilen[0]?.textContent).toContain("6,4");
    // Ohne Zahlen steht ein Strich - nicht 0,0, das wäre eine Aussage, die niemand geprüft hat.
    const leer = zeilen[1]?.querySelectorAll(".recent-stat-cell strong");
    expect(leer?.length).toBe(4);
    for (const feld of Array.from(leer ?? [])) expect(feld.textContent).toBe("–");
  });

  it("sortiert nach Schüssen und nach Ecken getrennt", async () => {
    const current = document();
    current.fixtures = [
      mitZahlen(1, "Wenig Schüsse", { shotsOnGoal: 1, corners: 9 }, { shotsOnGoal: 1, corners: 9 }),
      mitZahlen(2, "Viele Schüsse", { shotsOnGoal: 8, corners: 1 }, { shotsOnGoal: 8, corners: 1 })
    ];
    current.meta.fixtureCount = 2;
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Viele Schüsse")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Schüsse aufs Tor/i }));
    expect(globalThis.document.querySelector(".fixture-row")?.textContent).toContain("Viele Schüsse");

    await user.click(screen.getByRole("button", { name: /Ecken/i }));
    expect(globalThis.document.querySelector(".fixture-row")?.textContent).toContain("Wenig Schüsse");
  });

  it("verträgt Läufe von vor dieser Ergänzung", async () => {
    // Ältere Snapshots führen form.homeStats gar nicht - das darf nicht werfen.
    const current = document();
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(globalThis.document.querySelectorAll(".recent-stat-cell").length).toBeGreaterThan(0);
  });
});

describe("Heatmap", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const elo = (value: number) => ({ elo: value, confidence: 80, system: "club" as const, asOf: "2026-08-15T00:00:00.000Z" });

  it("wechselt über die Navigation, schaltet die Punkte-Dropdowns ab und merkt sich die Wahl", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Ansichten" });
    expect(within(nav).getByRole("button", { name: "Tabelle" })).toHaveAttribute("aria-current", "page");
    expect(globalThis.document.querySelector(".heatmap-row")).not.toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "Heatmap" }));
    expect(globalThis.document.querySelectorAll(".heatmap-row")).toHaveLength(2);
    expect(globalThis.document.querySelector(".fixture-row")).not.toBeInTheDocument();
    const menu = await openFilters(user);
    // In der Heatmap wirken die Punkte nicht - der Block entfällt, statt grau dazustehen.
    expect(within(menu).queryByRole("group", { name: /Punkte in Form und H2H/ })).not.toBeInTheDocument();
    expect(within(menu).getByRole("switch", { name: /Vorteil & Kelly-Einsatz anzeigen/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Markt")).toBeEnabled();

    unmount();
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(globalThis.document.querySelectorAll(".heatmap-row")).toHaveLength(2);
  });

  it("zeigt Vorsprünge als Heim minus Auswärts und färbt Value nur mit dem Kelly-Schalter", async () => {
    window.localStorage.setItem("football-analyzer:table-layout", "heatmap");
    window.localStorage.setItem("football-analyzer:kelly-visible-v2", "1");
    const current = document();
    current.fixtures[0] = { ...current.fixtures[0]!, homeElo: elo(1900), awayElo: elo(1750) };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const row = globalThis.document.querySelector(".heatmap-row")!;
    const cells = row.querySelectorAll(".heat-cell");
    expect(cells[0]).toHaveTextContent("+150");
    expect(cells[0]).toHaveClass("home");
    // Der Heimvorteil steckt nicht in Δ Elo - sonst läse man +0 als Gleichstand.
    expect(screen.getByRole("button", { name: /Elo-Unterschied/ }))
      .toHaveAttribute("title", expect.stringContaining("Heimvorteil ist nicht eingerechnet"));
    expect(cells[2]).toHaveTextContent("+0,50");
    // Ohne Schuss- und Eckenzahlen steht ein Strich, keine 0.
    expect(cells[3]).toHaveTextContent("–");
    expect(row.querySelectorAll(".odds-cell.value")).toHaveLength(3);

    await user.click(within(await openFilters(user)).getByRole("switch", { name: /Vorteil & Kelly-Einsatz anzeigen/i }));
    expect(globalThis.document.querySelectorAll(".odds-cell.value")).toHaveLength(0);
    expect(screen.getByText(/Value-Färbung/)).toBeInTheDocument();
  });

  it("färbt eine 1X2-Quote ohne belastbare Wahrscheinlichkeit nicht", async () => {
    window.localStorage.setItem("football-analyzer:table-layout", "heatmap");
    // Mit Schalter aus wäre ohnehin nichts gefärbt - der Test prüfte dann nichts.
    window.localStorage.setItem("football-analyzer:kelly-visible-v2", "1");
    const current = document();
    current.fixtures[0] = {
      ...current.fixtures[0]!,
      markets: current.fixtures[0]!.markets.map((market) => market.key === "1x2" ? { ...market, probabilityReliable: false } : market)
    };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const oneXTwo = globalThis.document.querySelector(".heatmap-row")!.querySelectorAll(".odds-cell")[0]!;
    expect(oneXTwo).not.toHaveClass("value");
    expect(oneXTwo.getAttribute("title")).toContain("Ligastärke unbekannt");
  });

  it("sortiert nach Vorsprung, ergänzt den gewählten Markt und öffnet die Details", async () => {
    window.localStorage.setItem("football-analyzer:table-layout", "heatmap");
    const current = document();
    current.fixtures[0] = { ...current.fixtures[0]!, homeElo: elo(1700), awayElo: elo(1800) };
    current.fixtures[1] = { ...current.fixtures[1]!, homeElo: elo(1900), awayElo: elo(1600) };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Elo-Unterschied/ }));
    expect(globalThis.document.querySelector(".heatmap-row")).toHaveTextContent("Zulu FC");

    await user.selectOptions(screen.getByLabelText("Markt"), "over25");
    expect(globalThis.document.querySelector(".heatmap-head")).toHaveTextContent("Über 2,5");

    await user.click(globalThis.document.querySelector(".heatmap-row")!);
    expect(screen.getByRole("complementary", { name: "Details" })).toHaveTextContent("Zulu FC");
  });
});

describe("Sortierauswahl", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const namen = ["Früh FC", "Spät FC", "Mitte FC"];
  const reihenfolge = (selector: string) => Array.from(globalThis.document.querySelectorAll(selector))
    .map((row) => namen.find((name) => row.textContent?.includes(name)));

  const dreiLigen = () => {
    const current = document();
    current.fixtures = [
      { ...fixture(1, "Spät FC", "none", "2026-08-16T20:00:00.000Z"), country: "Albanien", league: "Kategoria Superiore" },
      { ...fixture(2, "Früh FC", "none", "2026-08-16T14:00:00.000Z"), country: "Zypern", league: "1. Division" },
      { ...fixture(3, "Mitte FC", "none", "2026-08-16T17:00:00.000Z"), country: "England", league: "Championship" }
    ];
    current.meta.fixtureCount = 3;
    return current;
  };

  it("sortiert nach Anstoß vor, nach Liga auf Wunsch und dreht die Reihenfolge um", async () => {
    const current = dreiLigen();
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Früh FC")).toBeInTheDocument();

    expect(screen.getByLabelText("Sortierung")).toHaveValue("kickoff");
    expect(reihenfolge(".fixture-row")).toEqual(["Früh FC", "Mitte FC", "Spät FC"]);

    await user.selectOptions(screen.getByLabelText("Sortierung"), "league");
    expect(reihenfolge(".fixture-row")).toEqual(["Spät FC", "Mitte FC", "Früh FC"]);

    await user.click(screen.getByRole("button", { name: /Reihenfolge umdrehen, jetzt aufsteigend/ }));
    expect(reihenfolge(".fixture-row")).toEqual(["Früh FC", "Mitte FC", "Spät FC"]);
    expect(screen.getByRole("button", { name: /Reihenfolge umdrehen, jetzt absteigend/ })).toBeInTheDocument();
  });

  it("folgt einem Klick auf den Spaltenkopf und merkt sich die Wahl über ein Neuladen", async () => {
    const current = dreiLigen();
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<App />);
    expect(await screen.findByText("Früh FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Partie,/ }));
    expect(screen.getByLabelText("Sortierung")).toHaveValue("team");
    unmount();

    render(<App />);
    expect(await screen.findByText("Früh FC")).toBeInTheDocument();
    expect(screen.getByLabelText("Sortierung")).toHaveValue("team");
    expect(reihenfolge(".fixture-row")).toEqual(["Früh FC", "Mitte FC", "Spät FC"]);
  });

  it("zeigt eine Heatmap-Spalte als eigene Sortierung und setzt sie über die Auswahl zurück", async () => {
    window.localStorage.setItem("football-analyzer:table-layout", "heatmap");
    const current = dreiLigen();
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Früh FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Spiel,/ }));
    expect(screen.getByLabelText("Sortierung")).toHaveValue("heatmap");

    await user.selectOptions(screen.getByLabelText("Sortierung"), "league");
    expect(screen.getByLabelText("Sortierung")).toHaveValue("league");
    expect(reihenfolge(".heatmap-row")).toEqual(["Spät FC", "Mitte FC", "Früh FC"]);
  });
});
