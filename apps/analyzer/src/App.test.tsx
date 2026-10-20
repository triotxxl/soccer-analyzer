import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, MarketCard } from "./App";
import { buildMarketProfile } from "../../../src/market-profile";
import type { DashboardDocument, DashboardFixture, DashboardMarket, FixtureInsights, MarketProfile } from "../../shared/src/types";

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

/**
 * Beantwortet die Endpunkte der App: den Dashboard-Lauf, die Detailkennzahlen und das
 * Marktprofil. Ohne Profil meldet der Dienst wie in echt "noch nichts abgerechnet".
 */
function dashboardFetch(
  read: () => DashboardDocument,
  insights: (fixtureId: number) => unknown = emptyInsights,
  profile: MarketProfile | null = null
) {
  return vi.fn((url: string) => {
    const target = String(url);
    if (target.startsWith("/api/market-profile")) {
      return Promise.resolve(profile
        ? new Response(JSON.stringify(profile), { status: 200 })
        : new Response(JSON.stringify({ error: "insufficient_data" }), { status: 503 }));
    }
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
    // Anstoß und Liga stehen seit 28.09.2026 in einer eigenen Spalte.
    const kickoff = globalThis.document.querySelector(".kickoff-cell");
    expect(kickoff).toHaveTextContent("20:00");
    expect(kickoff).toHaveTextContent("Deutschland · Bundesliga");
    // "Alle Märkte": 1X2 und die empfohlenen Märkte statt vierzehn Kästchen.
    expect(globalThis.document.querySelector(".table-head")).toHaveAttribute("data-columns",
      "match kickoff form h2h expected points market recommended data");
    expect(globalThis.document.querySelector(".fixture-row > .time-cell")).not.toBeInTheDocument();
    expect(globalThis.document.querySelector(".fixture-row > .teams-cell")).not.toBeInTheDocument();
    const formLabels = globalThis.document.querySelector(".form-labels");
    expect(formLabels).toHaveTextContent("HeimAusw.");
    expect(formLabels).not.toHaveTextContent("H/A");

    await user.click(within(await openFilters(user)).getByRole("radio", { name: /Starke Tipps/ }));
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "draw");
    expect(globalThis.document.querySelector(".table-head")?.textContent).toContain("Remis");
    expect(globalThis.document.querySelector(".table-head")).toHaveAttribute("data-columns",
      "match kickoff form h2h expected points market data");

    // Bei BTTS keine Punkte, dafür Schüsse aufs Tor - je Markt nur, was zu ihm passt.
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");
    expect(globalThis.document.querySelector(".table-head")).toHaveAttribute("data-columns",
      "match kickoff form h2h expected shots market data");

    await user.click(screen.getByRole("button", { name: /Alpha FCGast FC/i }));
    expect(await within(screen.getByLabelText("Details")).findByText("Direkte Begegnungen")).toBeInTheDocument();
    expect(screen.getAllByText(/Testbegründung/)).toHaveLength(5);
  });

  it("schreibt bei Pokal- und Länderspielen Alle statt Heim und Ausw. über die Form", async () => {
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
    expect(formLabels).not.toHaveTextContent("Heim");
    expect(formLabels).toHaveAttribute("title", expect.stringContaining("zu Hause und auswärts zusammen"));
  });

  it("zeigt Form und H2H als Striche mit Punkten, Markierung des jüngsten Spiels und Stand im Hinweis", async () => {
    const user = userEvent.setup();
    const current = document();
    const base = current.fixtures[0]!;
    current.fixtures[0] = {
      ...base,
      form: { ...base.form, home: ["win", "win", "win", "draw", "loss"], away: [] },
      h2h: {
        ...base.h2h,
        outcomes: ["win", "draw", "loss"],
        matches: [
          { fixtureId: 9601, teamWasHome: false, date: "2026-05-01T18:00:00.000Z", homeTeam: "Gast FC", awayTeam: "Alpha FC", homeGoals: 1, awayGoals: 2 },
          { fixtureId: 9602, teamWasHome: true, date: "2025-11-01T18:00:00.000Z", homeTeam: "Alpha FC", awayTeam: "Gast FC", homeGoals: 1, awayGoals: 1 },
          { fixtureId: 9603, teamWasHome: true, date: "2025-05-01T18:00:00.000Z", homeTeam: "Alpha FC", awayTeam: "Gast FC", homeGoals: 7, awayGoals: 4 }
        ]
      }
    };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    const row = globalThis.document.querySelector(".fixture-row")!;

    // Form: Punkte rechts, neutral, und die Zusammenfassung nennt Mannschaft und Punkte.
    const [homeLine, awayLine] = Array.from(row.querySelectorAll(".form-cell .form-bars-line"));
    expect(homeLine!.querySelector(".form-total")).toHaveTextContent("10");
    expect(homeLine!.querySelector(".form-total")).toHaveAttribute("title", "10 von 15 Punkten aus den letzten 5 Spielen (Sieg 3, Unentschieden 1)");
    expect(homeLine!.querySelector(".form-total")!.className).toBe("form-total");
    expect(homeLine).toHaveTextContent("Alpha FC: 10 Punkte – 3 Siege, 1 Unentschieden, 1 Niederlage");
    expect(homeLine!.querySelectorAll(".form-bar")[0]).toHaveClass("win", "latest");
    // Ohne Spiele: fünf leere Striche, keine Markierung, Punkte als „–“.
    expect(awayLine!.querySelectorAll(".form-bar.missing")).toHaveLength(5);
    expect(awayLine!.querySelector(".form-bar.latest")).not.toBeInTheDocument();
    expect(awayLine!.querySelector(".form-total")).toHaveTextContent("–");

    // H2H: Der Hinweis nennt den Sieger und den Stand in Heim-Gast-Reihenfolge.
    const h2hBars = Array.from(row.querySelectorAll(".h2h-cell .form-bar"));
    expect(h2hBars).toHaveLength(5);
    expect(h2hBars[0]).toHaveAttribute("title", "Sieg Alpha FC · Gast FC 1:2 Alpha FC · 01.05.26");
    expect(h2hBars[2]).toHaveAttribute("title", expect.stringContaining("Sieg Gast FC"));
    expect(h2hBars.slice(3).every((bar) => bar.classList.contains("missing"))).toBe(true);
    expect(row.querySelector(".h2h-cell")).toHaveTextContent("H2H: 1 Sieg Alpha FC, 1 Unentschieden, 1 Sieg Gast FC");

    // Die Legende heißt „Striche“ - die Spalte „Punkte“ ist das 100-Punkte-System.
    const menu = await openFilters(user);
    expect(within(menu).getByRole("group", { name: "Striche in Form und H2H" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // BTTS: kein ✓ im Strich, Grün ✓ heißt in der Tabelle „empfehlenswert“.
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");
    expect(row.querySelector(".form-cell")).not.toHaveTextContent("✓");
    expect(row.querySelector(".h2h-cell")).not.toHaveTextContent("✓");
    expect(row.querySelector(".h2h-cell .form-bar")).toHaveAttribute("title", "Beide Teams treffen · Endstand Gast FC 1:2 Alpha FC");

    // Tore: die Torzahl steht im Strich, auch zweistellig.
    await user.selectOptions(screen.getByLabelText("Markt"), "over25");
    expect(Array.from(row.querySelectorAll(".h2h-cell .form-bar")).map((bar) => bar.textContent))
      .toEqual(["3", "2", "11", "", ""]);
    expect(row.querySelector(".h2h-cell")).toHaveTextContent("H2H Über 2,5: passt in 2 von 3 Spielen");
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

  /**
   * Die Leiste seit 28.09.2026: links, was Spiele ausblendet (Filter, Quickpick), rechts der Linie
   * Markt, Sortierung und Anzeige. Die Marktliste gliedert sich in Gruppen; eine Gruppe ohne
   * verfügbaren Markt fehlt, „Alle Märkte“ steht ohne Überschrift darüber.
   */
  it("ordnet die Leiste neu und gruppiert die Marktliste", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    const markets = screen.getByLabelText("Markt");
    const quickpick = screen.getByRole("button", { name: "Quickpicker öffnen" });
    expect(quickpick.compareDocumentPosition(markets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const groups = within(markets).getAllByRole("group").map((group) => group.getAttribute("label"));
    expect(groups).toEqual(["Ergebnis", "BTTS (beide treffen)", "Tore im Spiel"]);
    expect(within(markets).getAllByRole("option")[0]).toHaveTextContent("Alle Märkte");
    expect(within(markets).getByRole("option", { name: "Alle Märkte" }).closest("optgroup")).toBeNull();
    const goals = within(markets).getByRole("group", { name: "Tore im Spiel" });
    expect(within(goals).getAllByRole("option").map((option) => option.textContent)).toEqual(["Über 1,5", "Über 2,5"]);
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
        view: checked("Striche in Form und H2H"),
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

    expect(screen.queryByRole("button", { name: /Kelly-Auswahl öffnen/ })).not.toBeInTheDocument();
    const mode = screen.getByRole("group", { name: "Anzeige" });
    expect(within(mode).getByRole("radio", { name: "Kennzahlen" })).toBeChecked();
    expect(within(mode).getByRole("radio", { name: "Vorteil & Kelly" })).not.toBeChecked();
    // Der Schalter steht nicht mehr im Filtermenü - ein Zustand, ein Bedienelement.
    expect(within(await openFilters(user)).queryByRole("switch", { name: /Vorteil/ })).not.toBeInTheDocument();
    expect(globalThis.document.querySelector(".kelly-status")).not.toBeInTheDocument();
    void user;
  });

  /**
   * Die Schalter stehen im Filtermenü in den Gruppen "Umfang" und "Form und H2H", die Statuszeile
   * unter der Werkzeugleiste zählt, was die aktuelle Filterung übrig lässt. Die Kelly-Zeile und
   * die Warnung stehen nur im Modus "Vorteil & Kelly", der in der Werkzeugleiste gewählt wird.
   */
  it("bündelt die Schalter im Filtermenü und zählt den gefilterten Stand", async () => {
    window.localStorage.setItem("football-analyzer:kelly-visible-v2", "1");
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const status = globalThis.document.querySelector(".filter-status");
    expect(screen.getByRole("button", { name: /Kelly-Auswahl öffnen/ })).toBeInTheDocument();
    const kelly = globalThis.document.querySelector(".kelly-status");
    expect(kelly).toHaveTextContent("Kelly-Auswahl · Alle Märkte:");
    // Der geerbte Einsatzrahmen steht sichtbar da - er blieb bis 15.09.2026 unbemerkt auf 100 %.
    await waitFor(() => expect(kelly).toHaveTextContent("Einsatzrahmen 25,0 % (≈ 8 Plätze)"));
    expect(kelly).toHaveTextContent("Ein großer Vorteil ist meist ein Fehler des Modells.");
    expect(kelly).toHaveTextContent("rechne nicht mit Gewinn");

    const menu = await openFilters(user);
    expect(within(menu).getByRole("heading", { name: "Umfang" })).toBeInTheDocument();
    // Auch im Modus "Vorteil & Kelly" bleiben Form und H2H in der Tabelle, also auch ihre Anzeige.
    expect(within(menu).getByRole("heading", { name: "Form und H2H" })).toBeInTheDocument();
    // Ab Werk ist kein Schalter an - "an" heißt im Menü immer "Filter aktiv" oder "Anzeige an".
    expect(within(menu).getByRole("switch", { name: "Nur Ligaspiele" })).not.toBeChecked();
    expect(within(menu).getByRole("switch", { name: "Angepfiffene Spiele zeigen" })).not.toBeChecked();
    await user.click(within(screen.getByRole("group", { name: "Anzeige" })).getByRole("radio", { name: "Kennzahlen" }));
    expect(screen.queryByRole("button", { name: /Kelly-Auswahl öffnen/ })).not.toBeInTheDocument();
    expect(globalThis.document.querySelector(".kelly-status")).not.toBeInTheDocument();
    expect(status).toHaveTextContent("Nächste 48 Stunden ab jetzt");
    const reopened = await openFilters(user);
    expect(within(reopened).getByRole("heading", { name: "Form und H2H" })).toBeInTheDocument();

    expect(status).toHaveTextContent("Spiele angezeigt");
    expect(status?.querySelector("strong")).toHaveTextContent("2");

    // Die erste Zahl folgt dem Tabellenfilter, die Zähler im Menü bleiben beim vollen Umfang.
    const headCount = reopened.querySelector(".filter-menu-count");
    expect(headCount).toHaveTextContent("2 Spiele angezeigt");
    await user.click(within(reopened).getByRole("radio", { name: /Starke Tipps/ }));
    expect(status?.querySelector("strong")).toHaveTextContent("1");
    // Die Statuszeile liegt unter dem Menü - der Kopf zeigt dieselbe Zahl, wo man hinschaut.
    expect(headCount).toHaveTextContent("1 Spiel angezeigt");
    expect(within(reopened).getByRole("radio", { name: /Alle Spiele/ }).closest("label")).toHaveTextContent("2");
    void menu;
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
    // Die Summe der Halbzeit groß, darunter die des ganzen Spiels.
    expect(firstRow?.querySelector(".expected-cell strong")?.textContent).toBe("Σ 1,10");
    expect(firstRow?.textContent).toContain("Spiel Σ 2,70");
    expect(firstRow?.textContent).toContain("78,0 %");
    expect(firstRow?.textContent).toContain("–");
  });

  it("zeigt auch bei HZ-Unter-Märkten die Torerwartung der Halbzeit, fehlend als Strich", async () => {
    // Schema 1 führt keine Halbzeitwerte - dann darf keine 0,00 dastehen.
    const current = document();
    current.fixtures = current.fixtures.map((item) => ({
      ...item,
      markets: [...item.markets, { ...item.markets[3]!, key: "firstHalfUnder05", label: "1. HZ U0,5", selection: "1. Halbzeit: kein Tor" }]
    }));
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Markt"), "firstHalfUnder05");
    expect(globalThis.document.querySelector(".table-head")?.textContent).toContain("Erw. Tore 1. HZ");
    const expected = globalThis.document.querySelector(".fixture-row .expected-cell");
    expect(expected?.querySelector("strong")?.textContent).toBe("Σ –");
    expect(expected?.textContent).toContain("Spiel Σ 2,70");
  });

  it("zeigt Datenvertrauen und Hinweise in einer eigenen Spalte, die Remis-Serie unter H2H", async () => {
    const current = document();
    current.fixtures[0] = { ...current.fixtures[0]!, warnings: ["Wenige Spiele in der Saison"], h2hNotice: "3 Remis in Folge" };
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const data = globalThis.document.querySelector(".fixture-row .data-cell")!;
    expect(data).toHaveTextContent("85 %");
    expect(data).toHaveTextContent("1 Hinweis");
    expect(data).toHaveAttribute("title", expect.stringContaining("Wenige Spiele in der Saison"));
    // Eine Auffälligkeit, kein Tipp-Grund: grau unter den H2H-Strichen.
    const notice = globalThis.document.querySelector(".fixture-row .h2h-notice")!;
    expect(notice).toHaveTextContent("Remis-Serie");
    expect(notice).toHaveAttribute("title", expect.stringContaining("3 Remis in Folge"));
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
    const dots = () => Array.from(firstH2h.querySelectorAll(".h2h-cell .form-bar"));
    // Die Striche zeigen die Halbzeit-Torzahl; ob die Linie gerissen wurde, sagt die Farbe.
    // Ein leeres Feld bleibt ohne "–", das sich neben Ziffern wie ein Minus läse.
    // Die Zahl bleibt deshalb gleich, wenn die Linie wechselt - hit/miss dreht sich.
    const hits = () => dots().map((dot) => dot.classList.contains("hit") ? "Ü" : dot.classList.contains("miss") ? "U" : "–");
    expect(dots().map((dot) => dot.textContent)).toEqual(["1", "0", "2", "1", ""]);
    expect(hits()).toEqual(["Ü", "U", "Ü", "Ü", "–"]);

    await user.click(within(line).getByRole("radio", { name: "1,5" }));
    expect(dots().map((dot) => dot.textContent)).toEqual(["1", "0", "2", "1", ""]);
    expect(hits()).toEqual(["U", "U", "Ü", "U", "–"]);

    // Bei der Gegenrichtung bleibt die Torzahl gleich, aber getroffen hat, wer darunter blieb.
    await user.click(within(direction).getByRole("radio", { name: "Unter" }));
    expect(dots().map((dot) => dot.textContent)).toEqual(["1", "0", "2", "1", ""]);
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

    // Ein richtiger Kalender: Der ganze Monat steht da, wählbar sind nur die Tage der Analyse.
    expect(within(days).getByText("August 2026")).toBeInTheDocument();
    expect(within(days).getByRole("button", { name: /15. August 2026/ })).toBeDisabled();
    expect(within(days).getByRole("button", { name: /17. August 2026/ })).toBeEnabled();

    // Der Kartenkopf nennt, wie weit die 48 Stunden reichen. Ein Bedienhinweis steht erst
    // während der Wahl da, nicht in Ruhe (UX-Review vom 28.09.2026).
    expect(within(menu).getByText(/^bis [A-Z][a-z] \d{2}\.\d{2}\., \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(days).queryByText(/einmal klicken|letzten Tag anklicken/)).not.toBeInTheDocument();

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

  it("wählt einen Zeitraum über die Felder Von und Bis und blättert über den Monatswechsel", async () => {
    const current = rangeDocument();
    current.meta.lastAvailableDate = "2026-09-02";
    current.meta.maximumDays = 18;
    current.fixtures.push(fixture(5, "Im September", "strong", "2026-09-01T12:00:00.000Z"));
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Exakter Start")).toBeInTheDocument();
    const menu = await openFilters(user);
    const range = within(menu).getByRole("group", { name: "Zeitraum" });

    // Die Felder sind leer, solange "Nächste 48 Std." gilt.
    const from = within(range).getByLabelText("Von");
    const until = within(range).getByLabelText("Bis");
    expect(from).toHaveValue("");
    expect(within(range).getByRole("button", { name: "Voriger Monat" })).toBeDisabled();

    fireEvent.change(from, { target: { value: "2026-08-17" } });
    fireEvent.change(until, { target: { value: "2026-09-01" } });
    expect(from).toHaveValue("2026-08-17");
    expect(until).toHaveValue("2026-09-01");
    expect(screen.getByRole("button", { name: "17.08. – 01.09." })).toBeInTheDocument();
    expect(screen.getByText("Im September")).toBeInTheDocument();
    expect(screen.queryByText("Exakter Start")).not.toBeInTheDocument();
    // Ein fertiger Zeitraum aus den Feldern wartet nicht auf einen zweiten Klick.
    expect(within(range).queryByText(/letzten Tag anklicken/)).not.toBeInTheDocument();

    // Das Bis-Feld zeigt den Monat seines Tages; weiter als die Analyse geht es nicht.
    expect(within(range).getByText("September 2026")).toBeInTheDocument();
    expect(within(range).getByRole("button", { name: "Nächster Monat" })).toBeDisabled();
    expect(within(range).getByRole("button", { name: / 1. September 2026/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(range).getByRole("button", { name: / 3. September 2026/ })).toBeDisabled();

    // Ein Bis vor dem Von macht aus beiden diesen Tag, statt einen leeren Zeitraum zu bilden.
    fireEvent.change(until, { target: { value: "2026-08-16" } });
    expect(from).toHaveValue("2026-08-16");
    expect(until).toHaveValue("2026-08-16");

    // Blättern und klicken: Anfang im August, Ende im September.
    await user.click(within(range).getByRole("button", { name: /17. August 2026/ }));
    await user.click(within(range).getByRole("button", { name: "Nächster Monat" }));
    await user.click(within(range).getByRole("button", { name: / 2. September 2026/ }));
    expect(screen.getByRole("button", { name: "17.08. – 02.09." })).toBeInTheDocument();
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
    // Datenstand und Einstellungen stehen in der Leiste, aber außerhalb von <nav> - sie sind keine Ansichten.
    expect(screen.getByText(/Datenstand:/)).toBeInTheDocument();

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

  it("sammelt Tipps über die Marktliste im Wettschein und mischt eine Kombi", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    // Der Knopf steht immer in der Leiste, auch leer.
    expect(screen.getByRole("button", { name: "Wettschein öffnen" })).toBeInTheDocument();

    // Überfahren öffnet nichts mehr - erst der Klick (Davids Wunsch vom 30.09.2026).
    const alphaAdd = screen.getByRole("button", { name: "In den Wettschein legen: Alpha FC – Gast FC" });
    expect(alphaAdd).toHaveTextContent("+");
    await user.hover(alphaAdd);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(alphaAdd);
    let list = screen.getByRole("menu", { name: "Markt hinzufügen: Alpha FC – Gast FC" });
    // Gruppiert wie die Marktliste der Werkzeugleiste.
    expect(within(list).getByRole("group", { name: "Ergebnis" })).toBeInTheDocument();
    await user.click(within(list).getByRole("menuitemcheckbox", { name: /^1X2 · Heim.*in den Wettschein$/ }));
    expect(screen.getByRole("button", { name: "Wettschein öffnen, 1 Tipp" })).toBeInTheDocument();
    // Die Liste bleibt offen, der Markt ist als gewählt markiert, der Knopf zählt mit.
    expect(within(list).getByRole("menuitemcheckbox", { name: /^1X2 · Heim.*aus dem Wettschein nehmen$/ })).toHaveAttribute("aria-checked", "true");
    expect(within(list).getByText("1 im Wettschein")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In den Wettschein legen: Alpha FC – Gast FC (1 im Wettschein)" })).toHaveTextContent("1");

    // Ein zweiter Klick nimmt ihn wieder heraus, ein dritter legt ihn zurück.
    await user.click(within(list).getByRole("menuitemcheckbox", { name: /^1X2 · Heim.*aus dem Wettschein nehmen$/ }));
    expect(screen.getByRole("button", { name: "Wettschein öffnen" })).toBeInTheDocument();
    await user.click(within(list).getByRole("menuitemcheckbox", { name: /^1X2 · Heim.*in den Wettschein$/ }));

    // Escape schließt die Liste und gibt den Fokus an den Knopf zurück.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alpha FC – Gast FC \(1 im Wettschein\)/ })).toHaveFocus();

    // Mit der Tastatur: öffnen, der Fokus steht auf dem ersten Markt, Enter legt ihn hinein.
    const zuluAdd = screen.getByRole("button", { name: "In den Wettschein legen: Zulu FC – Gast FC" });
    zuluAdd.focus();
    await user.keyboard("{Enter}");
    list = screen.getByRole("menu", { name: "Markt hinzufügen: Zulu FC – Gast FC" });
    const items = within(list).getAllByRole("menuitemcheckbox");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items.at(-1)).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Escape}");

    const cartButton = screen.getByRole("button", { name: "Wettschein öffnen, 2 Tipps" });
    await user.click(cartButton);
    const slip = screen.getByRole("dialog", { name: "Wettschein" });
    expect(within(slip).getByRole("heading", { name: "Wettschein" })).toHaveFocus();
    expect(slip.querySelector(".filter-menu-count")).toHaveTextContent("2 Tipps");
    // Die Warnung steht immer da, auch ohne Kombi.
    expect(within(slip).getByText(/Eine Kombi geht nur durch, wenn jeder Tipp stimmt/)).toBeInTheDocument();
    expect(within(slip).getByText("Wähle, wie viele Kombis welcher Größe du willst.")).toBeInTheDocument();

    await user.click(within(slip).getByRole("button", { name: "Eine 2er-Kombi mehr" }));
    expect(within(slip).getByRole("spinbutton", { name: "Anzahl 2er-Kombis" })).toHaveValue(1);
    await user.click(within(slip).getByRole("button", { name: /Kombis? mischen/ }));

    const combo = within(slip).getByRole("region", { name: "Kombi 1" });
    expect(within(combo).getByText(/^Kombi 1 · 2 Spiele · ab /)).toBeInTheDocument();
    // Beim 1X2 steht die Mannschaft dabei - „1X2“ allein verriet beim Übertragen nicht, wer gemeint ist.
    expect(within(combo).getByText("Heimsieg Alpha FC")).toBeInTheDocument();
    expect(within(combo).getByText("Heimsieg Zulu FC")).toBeInTheDocument();

    // Escape schließt und gibt den Fokus an den Knopf zurück; die Kombi übersteht das Schließen.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Wettschein" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wettschein öffnen, 2 Tipps" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Wettschein öffnen, 2 Tipps" }));
    expect(within(screen.getByRole("dialog", { name: "Wettschein" })).getByRole("region", { name: "Kombi 1" })).toBeInTheDocument();
  });

  /** Davids Wunsch vom 06.10.2026: beim 1X2 auch die Seite gegen den Modelltipp anbieten. */
  it("bietet beim 1X2 auch die Gegenseite an und tauscht die Seite im Wettschein", async () => {
    const current = document();
    const oneXTwo = current.fixtures[0]!.markets.find((market) => market.key === "1x2")!;
    oneXTwo.oddsHome = 1.8;
    oneXTwo.oddsAway = 4.5;
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "In den Wettschein legen: Alpha FC – Gast FC" }));
    const list = screen.getByRole("menu", { name: "Markt hinzufügen: Alpha FC – Gast FC" });
    const tipp = () => within(list).getByRole("menuitemcheckbox", { name: /^1X2 · Heim · Heimsieg Alpha FC, Quote 1,80/ });
    const gegen = () => within(list).getByRole("menuitemcheckbox", { name: /^1X2 · Gast · Auswärtssieg Gast FC gegen den Modelltipp, Quote 4,50/ });
    expect(within(gegen()).getByText("Modell dagegen")).toBeInTheDocument();

    await user.click(tipp());
    expect(tipp()).toHaveAttribute("aria-checked", "true");
    expect(gegen()).toHaveAttribute("aria-checked", "false");

    // Die Gegenseite ersetzt den Modelltipp, statt neben ihm zu stehen - und die Liste sagt es.
    await user.click(gegen());
    expect(gegen()).toHaveAttribute("aria-checked", "true");
    expect(tipp()).toHaveAttribute("aria-checked", "false");
    expect(within(list).getByText("Auswärtssieg Gast FC ersetzt Heimsieg Alpha FC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wettschein öffnen, 1 Tipp" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Wettschein öffnen, 1 Tipp" }));
    const slip = screen.getByRole("dialog", { name: "Wettschein" });
    expect(within(slip).getByText("Auswärtssieg Gast FC")).toBeInTheDocument();
  });

  /**
   * Davids Entscheidung vom 11.10.2026: Gegensätze desselben Spiels ersetzen einander - eine Kombi
   * mit Remis und Heimsieg verliert sicher. Verträgliche Tipps bleiben nebeneinander.
   */
  it("ersetzt Gegensätze desselben Spiels und lässt verträgliche Tipps stehen", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "In den Wettschein legen: Alpha FC – Gast FC" }));
    const list = screen.getByRole("menu", { name: "Markt hinzufügen: Alpha FC – Gast FC" });
    const item = (name: RegExp) => within(list).getByRole("menuitemcheckbox", { name });

    await user.click(item(/^Remis · /));
    await user.click(item(/^1X2 · Heim/));
    expect(item(/^1X2 · Heim/)).toHaveAttribute("aria-checked", "true");
    expect(item(/^Remis · /)).toHaveAttribute("aria-checked", "false");
    expect(within(list).getByText("Heimsieg Alpha FC ersetzt Remis")).toBeInTheDocument();

    // Über 2,5 verträgt sich mit dem Heimsieg - beide bleiben, die Fußzeile zählt wieder.
    await user.click(item(/^Über 2,5 · /));
    expect(item(/^1X2 · Heim/)).toHaveAttribute("aria-checked", "true");
    expect(item(/^Über 2,5 · /)).toHaveAttribute("aria-checked", "true");
    expect(within(list).getByText("2 im Wettschein")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Wettschein öffnen, 2 Tipps" }));
    const slip = screen.getByRole("dialog", { name: "Wettschein" });
    expect(within(slip).getByText("2 Tipps aus einem Spiel – in eine Kombi kommt nur einer.")).toBeInTheDocument();
    // Zwei Tipps aus einem Spiel ergeben keine Kombi.
    expect(within(slip).getByText("Ab zwei Tipps aus verschiedenen Spielen lassen sich Kombis bauen.")).toBeInTheDocument();
    expect(within(slip).getByRole("button", { name: /Kombis? mischen/ })).toBeDisabled();
  });

  it("leert den Wettschein mit einem Klick und holt ihn mit Rückgängig zurück", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "In den Wettschein legen: Alpha FC – Gast FC" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /^1X2 · Heim.*in den Wettschein$/ }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Wettschein öffnen, 1 Tipp" }));
    const slip = screen.getByRole("dialog", { name: "Wettschein" });

    await user.click(within(slip).getByRole("button", { name: "Wettschein leeren" }));
    expect(within(slip).getByRole("status")).toHaveTextContent("Wettschein geleert (1 Tipp)");
    expect(within(slip).getByText(/Noch keine Tipps im Wettschein/)).toBeInTheDocument();
    const undo = within(slip).getByRole("button", { name: "Rückgängig" });
    expect(undo).toHaveFocus();

    await user.click(undo);
    expect(slip.querySelector(".filter-menu-count")).toHaveTextContent("1 Tipp");
    expect(within(slip).getByText("Heimsieg Alpha FC")).toBeInTheDocument();
    expect(within(slip).queryByRole("button", { name: "Rückgängig" })).not.toBeInTheDocument();
  });

  it("hält angepfiffene Spiele aus Wettschein und Kombis heraus", async () => {
    const current = document();
    current.fixtures.push(fixture(3, "Läuft FC", "strong", "2026-08-16T11:00:00.000Z"));
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    // Ein Tipp aus einer früheren Sitzung, dessen Spiel inzwischen läuft.
    window.localStorage.setItem("football-analyzer:bet-cart", JSON.stringify([{
      id: "3:1x2", fixtureId: 3, homeTeam: "Läuft FC", awayTeam: "Gast FC", league: "Bundesliga", country: "Deutschland",
      kickoff: "2026-08-16T11:00:00.000Z", marketKey: "1x2", marketLabel: "1X2", selection: "Heimsieg", pick: "1",
      selectionTone: "home", odds: 1.8, probability: 0.7, recommendationLevel: "strong", addedAt: 0
    }]));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    // Mit „Angepfiffene Spiele zeigen“ steht das Spiel in der Tabelle, sein „+“ ist aber gesperrt.
    const menu = await openFilters(user);
    await user.click(within(menu).getByRole("switch", { name: "Angepfiffene Spiele zeigen" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /In den Wettschein legen: Läuft FC – Gast FC/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Wettschein öffnen, 1 Tipp" }));
    const slip = screen.getByRole("dialog", { name: "Wettschein" });
    expect(slip.querySelector(".filter-menu-count")).toHaveTextContent("1 Tipp · 1 angepfiffen");
    expect(within(slip).getByText("1 angepfiffen – kommt in keine Kombi")).toBeInTheDocument();

    await user.click(within(slip).getByRole("button", { name: "Angepfiffene Tipps entfernen" }));
    expect(within(slip).getByRole("status")).toHaveTextContent("1 angepfiffener entfernt");
    await user.click(within(slip).getByRole("button", { name: "Rückgängig" }));
    expect(slip.querySelector(".filter-menu-count")).toHaveTextContent("1 angepfiffen");
  });

  it("merkt sich die Kombi-Größen und behält übertragene Kombis beim Neumischen", async () => {
    const current = document();
    current.fixtures.push(
      fixture(3, "Drei FC", "strong", "2026-08-16T19:00:00.000Z"),
      fixture(4, "Vier FC", "strong", "2026-08-16T20:00:00.000Z")
    );
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    for (const team of ["Alpha FC", "Zulu FC", "Drei FC", "Vier FC"]) {
      await user.click(screen.getByRole("button", { name: `In den Wettschein legen: ${team} – Gast FC` }));
      await user.click(screen.getByRole("menuitemcheckbox", { name: /^1X2 · Heim.*in den Wettschein$/ }));
      await user.keyboard("{Escape}");
    }
    await user.click(screen.getByRole("button", { name: "Wettschein öffnen, 4 Tipps" }));
    let slip = screen.getByRole("dialog", { name: "Wettschein" });
    await user.click(within(slip).getByRole("button", { name: "Eine 2er-Kombi mehr" }));
    expect(within(slip).getByText("1 Kombi · 2 Plätze · 4 Tipps aus 4 Spielen mischbar")).toBeInTheDocument();
    await user.click(within(slip).getByRole("button", { name: /Kombis? mischen/ }));
    const first = within(slip).getByRole("region", { name: "Kombi 1" });
    const firstTips = within(first).getAllByText(/^Heimsieg /).map((node) => node.textContent);

    await user.click(within(first).getByRole("button", { name: "Kombi 1 als übertragen markieren" }));
    expect(within(slip).getByText("1 von 1 übertragen")).toBeInTheDocument();
    // Neu mischen: Die übertragene Kombi bleibt, die neue nimmt nur die übrigen Tipps.
    await user.click(within(slip).getByRole("button", { name: /Kombis? mischen/ }));
    const kept = within(slip).getByRole("region", { name: "Kombi 1" });
    expect(within(kept).getAllByText(/^Heimsieg /).map((node) => node.textContent)).toEqual(firstTips);
    expect(within(kept).getByText(/übertragen/)).toBeInTheDocument();
    const second = within(slip).getByRole("region", { name: "Kombi 2" });
    for (const tip of within(second).getAllByText(/^Heimsieg /)) expect(firstTips).not.toContain(tip.textContent);

    // Die Größen überstehen ein Neuladen, die Kombis nicht.
    unmount();
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Wettschein öffnen, 4 Tipps" }));
    slip = screen.getByRole("dialog", { name: "Wettschein" });
    expect(within(slip).getByRole("spinbutton", { name: "Anzahl 2er-Kombis" })).toHaveValue(1);
    expect(within(slip).queryByRole("region", { name: "Kombi 1" })).not.toBeInTheDocument();
  });

  it("öffnet höchstens eins von Filter, Quickpicker und Wettschein", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Wettschein öffnen" }));
    expect(screen.getByRole("dialog", { name: "Wettschein" })).toBeInTheDocument();
    await openFilters(user);
    expect(screen.queryByRole("dialog", { name: "Wettschein" })).not.toBeInTheDocument();
    // Der Wettschein-Knopf liegt über dem abgedunkelten Hintergrund und wechselt direkt.
    await user.click(screen.getByRole("button", { name: "Wettschein öffnen" }));
    expect(screen.getByRole("dialog", { name: "Wettschein" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Filter" })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("switch", { name: "Tabelle filtern" }));
    await user.keyboard("{Escape}");
  }

  /** Wie das Filtermenü: Ein Klick daneben schließt das Fenster, der Filter bleibt. */
  it("schließt den Quickpicker beim Klick daneben und behält den Filter", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    await user.click(screen.getByRole("radio", { name: /^Daves 1x2-Filter/ }));
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();

    await user.click(window.document.body);

    expect(screen.queryByRole("dialog", { name: "Quickpicker" })).not.toBeInTheDocument();
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();
    expect(screen.getByText(/Daves 1x2-Filter · 1 von 2/)).toBeInTheDocument();
  });

  it("gibt den Fokus nach Escape an den Quickpick-Knopf zurück", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    expect(screen.getByRole("heading", { name: "Quickpicker" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Quickpicker" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quickpicker öffnen" })).toHaveFocus();
  });

  /** Davids Wunsch vom 10.10.2026: Hinter Filtermenü und Quickpicker tritt der Rest zurück. */
  it("dunkelt den Rest ab, solange Filtermenü oder Quickpicker offen sind", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(container.querySelector(".menu-backdrop")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    expect(container.querySelector(".menu-backdrop")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(container.querySelector(".menu-backdrop")).toBeNull();

    await openFilters(user);
    expect(container.querySelector(".menu-backdrop")).not.toBeNull();
  });

  /** Beide Fenster gehen an derselben Stelle auf - offen ist höchstens eins. */
  it("schließt Quickpicker und Filtermenü gegenseitig", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    // Ohne pointerdown: So prüft der Test die Knöpfe selbst, nicht das Schließen beim Klick daneben.
    fireEvent.click(screen.getByRole("button", { name: /^Filter(, \d+ aktiv)?$/ }));
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Quickpicker" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    expect(screen.getByRole("dialog", { name: "Quickpicker" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Filter" })).not.toBeInTheDocument();
  });

  /** Das Fenster hängt an der Werkzeugleiste - nach einem Ansichtswechsel darf es nicht wieder aufgehen. */
  it("schließt den Quickpicker beim Ansichtswechsel", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    const nav = screen.getByRole("navigation", { name: "Ansichten" });
    fireEvent.click(within(nav).getByRole("button", { name: "Marktprofil" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Tabelle" }));

    expect(screen.queryByRole("dialog", { name: "Quickpicker" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quickpicker öffnen" })).toHaveAttribute("aria-expanded", "false");
  });

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

  /** Tabelle und Quickpicker zeigen denselben Tipp (Davids Entscheidung vom 19.10.2026). */
  it("zeigt bei aktivem Quickpick den Tipp des Filters unter den Teams", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    expect(screen.queryByText(/^Quickpick \d/)).not.toBeInTheDocument();

    await applyQuickpick(user);
    // Im Wortlaut des Wettscheins, nicht nur der Mannschaftsname.
    expect(screen.getByText(/^Quickpick \d,\d\d · (Heim|Auswärts)sieg Alpha FC$/)).toBeInTheDocument();
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
   * Der eigentliche Zweck des Filters: Treffer in den Wettschein, dort Kombis bauen. Seit
   * 11.10.2026 bleibt der Quickpicker dabei offen und meldet im Fuß, was geschah.
   */
  it("legt die Treffer in den Wettschein und meldet es im Quickpicker", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => quickpickDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    const dialog = screen.getByRole("dialog", { name: "Quickpicker" });
    await user.click(within(dialog).getByRole("button", { name: /in den Wettschein/ }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("1 neu im Wettschein");
    expect(dialog.querySelector(".quickpick-cart-state")).toHaveTextContent(/^Wettschein: 1 Tipp aus 1 Spiel/);
    expect(screen.getByRole("button", { name: "Wettschein öffnen, 1 Tipp" })).toBeInTheDocument();
    // Ist alles drin, ist der Sammelknopf gesperrt und sagt es, statt beim zweiten Klick nichts zu tun.
    expect(within(dialog).getByRole("button", { name: "Alle 1 schon im Wettschein" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /^Aus dem Wettschein nehmen: Alpha FC/ })).toBeInTheDocument();

    // Rückgängig nimmt genau diesen Schritt zurück.
    await user.click(within(dialog).getByRole("button", { name: "Rückgängig" }));
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
    expect(dialog.querySelector(".quickpick-cart-state")).toHaveTextContent(/^Wettschein: noch leer/);
    expect(screen.getByRole("button", { name: "Wettschein öffnen" })).toBeInTheDocument();

    // Einzeln über den Knopf der Zeile: hinein und wieder heraus.
    await user.click(within(dialog).getByRole("button", { name: /^Zum Wettschein hinzufügen: Alpha FC/ }));
    expect(screen.getByRole("button", { name: "Wettschein öffnen, 1 Tipp" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^Aus dem Wettschein nehmen: Alpha FC/ }));
    expect(screen.getByRole("button", { name: "Wettschein öffnen" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /in den Wettschein/ }));
    await user.click(within(dialog).getByRole("button", { name: "Wettschein ansehen" }));
    const slip = screen.getByRole("dialog", { name: "Wettschein" });
    expect(within(slip).getAllByText(/Alpha FC/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog", { name: "Quickpicker" })).not.toBeInTheDocument();
  });

  /**
   * „Kombi-Tipps“ wechseln je Spiel die Wettart. Der Sammelknopf muss einen 1X2-Tipp auf die
   * Mannschaft des Tipps legen (hier gegen den Tipp der Tabelle) und jede andere Wettart über
   * ihren eigenen Markt.
   */
  it("legt Kombi-Tipps verschiedener Wettarten richtig in den Wettschein", async () => {
    const current = document();
    const [alpha, zulu] = current.fixtures as [DashboardFixture, DashboardFixture];
    const draw = (fixture: DashboardFixture) => fixture.markets.find((market) => market.key === "draw")!;
    // Alpha FC: Gast FC zu 1,62 ist der wahrscheinlichste Tipp ab 1,60, obwohl die Tabelle Heim tippt.
    alpha.markets = alpha.markets.map((market) => market.key === "1x2"
      ? { ...market, pick: "1", probability: 0.2, odds: 5, oddsHome: 5, oddsAway: 1.62 }
      : market.key === "draw" ? { ...market, probability: 0.25, odds: 3.8 } : market);
    // Zulu FC: BTTS Nein zu 1,62 gegen BTTS Ja zu 2,25.
    zulu.markets = [
      ...zulu.markets.map((market) => market.key === "btts" ? { ...market, odds: 2.25 } : market),
      { ...draw(zulu), key: "bttsNo", label: "BTTS Nein", selection: "Beide Teams treffen: Nein", odds: 1.62 }
    ];
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    const dialog = screen.getByRole("dialog", { name: "Quickpicker" });
    await user.click(within(dialog).getByRole("radio", { name: /^Kombi-Tipps ab 1,60/ }));
    await user.click(within(dialog).getByRole("button", { name: "Alle 2 in den Wettschein" }));
    await user.click(within(dialog).getByRole("button", { name: "Wettschein ansehen" }));

    const slip = screen.getByRole("dialog", { name: "Wettschein" });
    expect(within(slip).getByText("Auswärtssieg Gast FC")).toBeInTheDocument();
    expect(within(slip).getByText("BTTS Nein · Beide Teams treffen: Nein")).toBeInTheDocument();
    // Die Herkunft steht grau am Tipp - gemischt wird trotzdem über alle Filter zusammen.
    expect(within(slip).getAllByText("aus Kombi-Tipps ab 1,60")).toHaveLength(2);
  });

  /** Davids Wunsch vom 14.10.2026: Freitext über Mannschaft, Wettbewerb und Land. */
  it("sucht in der Tabelle nach Mannschaft, Wettbewerb und Land", async () => {
    const current = document();
    current.fixtures[1]!.country = "England";
    current.fixtures[1]!.league = "Premier League";
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    const suche = screen.getByRole("searchbox", { name: "Spiele suchen" });

    await user.type(suche, "zulu");
    expect(screen.queryByText("Alpha FC")).not.toBeInTheDocument();
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();

    await user.clear(suche);
    await user.type(suche, "england premier");
    expect(screen.queryByText("Alpha FC")).not.toBeInTheDocument();
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();

    await user.clear(suche);
    await user.type(suche, "bundesliga");
    expect(screen.getByText("Alpha FC")).toBeInTheDocument();
    expect(screen.queryByText("Zulu FC")).not.toBeInTheDocument();

    // Escape leert die Suche, das ✕ ebenso.
    await user.keyboard("{Escape}");
    expect(suche).toHaveValue("");
    expect(screen.getByText("Zulu FC")).toBeInTheDocument();
  });

  it("erklärt eine leere Tabelle mit der Suche und leert sie auf Knopfdruck", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Spiele suchen" }), "xyz");
    const leer = screen.getByText("Kein Spiel passt zu „xyz“").closest(".empty-state") as HTMLElement;
    await user.click(within(leer).getByRole("button", { name: "Suche leeren" }));
    expect(screen.getByText("Alpha FC")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Spiele suchen" })).toHaveValue("");
  });

  it("erklärt eine leere Tabelle mit dem Quickpicker statt mit dem Zeitraum", async () => {
    const empty = quickpickDocument();
    empty.fixtures[0]!.form = { ...empty.fixtures[0]!.form, away: ["win", "win", "win", "win", "loss"] };
    vi.stubGlobal("fetch", dashboardFetch(() => empty));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await applyQuickpick(user);

    expect(screen.getByText(/Daves 1x2-Filter lässt kein Spiel übrig/)).toBeInTheDocument();
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
    // Die Kennzahlen kommen nie zurück: Die Zeile aus dem Lauf muss schon beim Laden stehen.
    vi.stubGlobal("fetch", vi.fn((url: string) => String(url).startsWith("/api/fixture/insights")
      ? new Promise<Response>(() => {})
      : Promise.resolve(new Response(JSON.stringify(current), { status: 200 }))));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Mit Zahlen")).toBeInTheDocument();
    // Schüsse aufs Tor stehen nur bei Tor- und BTTS-Märkten in der Zeile.
    expect(globalThis.document.querySelector(".recent-stat-cell")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "over25");

    const zeilen = globalThis.document.querySelectorAll(".fixture-row");
    expect(zeilen[0]?.textContent).toContain("5,2");
    expect(zeilen[0]?.textContent).not.toContain("6,4");
    // Ohne Zahlen steht ein Strich - nicht 0,0, das wäre eine Aussage, die niemand geprüft hat.
    const leer = zeilen[1]?.querySelectorAll(".recent-stat-cell strong");
    expect(leer?.length).toBe(2);
    for (const feld of Array.from(leer ?? [])) expect(feld.textContent).toBe("–");

    // Die Ecken sind in die Detailansicht gewandert.
    await user.click(screen.getByRole("button", { name: /Mit ZahlenGast FC/ }));
    expect(screen.getByRole("status")).toHaveTextContent("werden geladen");
    expect(globalThis.document.querySelector(".detail-recent")).toHaveTextContent("Schüsse aufs Tor 5,2 : 3,0 · Ecken 6,4 : 2,0");
  });

  it("sortiert nach Schüssen; Ecken nur noch in Detailansicht und Heatmap", async () => {
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
    await user.selectOptions(screen.getByLabelText("Markt"), "over25");

    await user.click(screen.getByRole("button", { name: /Schüsse aufs Tor/i }));
    expect(globalThis.document.querySelector(".fixture-row")?.textContent).toContain("Viele Schüsse");

    expect(screen.queryByRole("button", { name: /^Ecken/ })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Sortierung")).queryByRole("option", { name: "Ecken" })).not.toBeInTheDocument();
  });

  it("verträgt Läufe von vor dieser Ergänzung", async () => {
    // Ältere Snapshots führen form.homeStats gar nicht - das darf nicht werfen.
    const current = document();
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");
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
    // In der Heatmap wirken die Striche nicht - der Block entfällt, statt grau dazustehen.
    expect(within(menu).queryByRole("group", { name: /Striche in Form und H2H/ })).not.toBeInTheDocument();
    // Ohne Striche bleibt die Karte "Form und H2H" leer und entfällt; die Anzeige steht in der Leiste.
    expect(within(menu).queryByRole("heading", { name: "Form und H2H" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Vorteil & Kelly" })).toBeInTheDocument();
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

    await user.click(screen.getByRole("radio", { name: "Kennzahlen" }));
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

    await user.click(screen.getByRole("button", { name: /^Spiel,/ }));
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

describe("Tabelle: Anzeige Kennzahlen", () => {
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

  it("zeigt bei Alle Märkte die empfohlenen Märkte, ★ zuerst und höchstens drei", async () => {
    const current = document();
    current.fixtures[0]!.markets = current.fixtures[0]!.markets.map((market) => market.key === "draw"
      ? { ...market, recommendation: { level: "recommended", label: "Empfehlenswert" } }
      : market);
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const [first, second] = [...globalThis.document.querySelectorAll(".fixture-row .recommended-cell")];
    const chips = [...first!.querySelectorAll(".rec-chip")];
    // 1X2 steht in seiner eigenen Zelle; von den vier übrigen die drei stärksten, Remis (✓) hinten.
    expect(chips.map((chip) => chip.textContent)).toEqual(["★BTTS · 1,80 · 72 %", "★Ü1,5 · 1,80 · 72 %", "★Ü2,5 · 1,80 · 72 %"]);
    expect(first!.querySelector(".rec-more")).toHaveTextContent("+1");
    expect(first!.querySelector(".rec-more")).toHaveAttribute("title", expect.stringContaining("Remis"));
    expect(second).toHaveTextContent("–");
  });

  it("trennt bei Sortierung nach Anstoß die Tage, in beide Richtungen", async () => {
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    const tage = () => [...globalThis.document.querySelectorAll(".day-divider h3")].map((head) => head.textContent);
    expect(tage()).toEqual(["So 16.08.", "Mo 17.08."]);
    expect(globalThis.document.querySelector(".day-divider")).toHaveTextContent("1 Spiel");
    // Mit Trennzeile steht das Datum nicht noch einmal in jeder Zeile.
    expect(globalThis.document.querySelector(".kickoff-cell")).not.toHaveTextContent("16.08.");

    await user.click(screen.getByRole("button", { name: /Reihenfolge umdrehen/ }));
    expect(tage()).toEqual(["Mo 17.08.", "So 16.08."]);

    await user.selectOptions(screen.getByLabelText("Sortierung"), "league");
    expect(tage()).toEqual([]);
    expect(globalThis.document.querySelector(".kickoff-cell")).toHaveTextContent("16.08.");
  });

  it("fällt bei einer ausgeblendeten Sortierung auf den Anstoß zurück, ohne die Wahl zu vergessen", async () => {
    window.localStorage.setItem("football-analyzer:sort", JSON.stringify({ key: "shots", direction: -1 }));
    vi.stubGlobal("fetch", dashboardFetch(() => document()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    // Bei "Alle Märkte" gibt es keine Schuss-Spalte - sortiert wird nach Anstoß.
    expect(screen.getByLabelText("Sortierung")).toHaveValue("kickoff");
    await user.selectOptions(screen.getByLabelText("Markt"), "over25");
    expect(screen.getByLabelText("Sortierung")).toHaveValue("shots");
    expect(JSON.parse(window.localStorage.getItem("football-analyzer:sort") ?? "null")).toEqual({ key: "shots", direction: -1 });
  });
});

describe("Tabelle: Anzeige Vorteil & Kelly", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
    window.localStorage.setItem("football-analyzer:kelly-visible-v2", "1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  /** BTTS mit 60 % zu 1,90: 7,4 PP Vorteil, unter dem Deckel der manuellen Vorgabe (12 PP). */
  function kellyDocument(bttsProbabilities: [number, number] = [0.6, 0.6]): DashboardDocument {
    const current = document();
    current.fixtures = current.fixtures.map((item, index) => ({
      ...item,
      markets: item.markets.map((market) => market.key === "btts"
        ? { ...market, probability: bttsProbabilities[index]!, odds: 1.9 }
        : market)
    }));
    return current;
  }

  const manual = () => window.localStorage.setItem("football-analyzer:kelly-auto", "0");

  /**
   * Seit 29.09.2026 wieder wie vor dem 28.09.: Die Tabelle behält in beiden Anzeigen ihre Spalten,
   * "Vorteil & Kelly" blendet nur den Vorteil in der Marktspalte ein. Die Wetten stehen im Dialog.
   */
  it("behält die Spalten der Tabelle und zeigt den Vorteil grau in der Marktspalte", async () => {
    manual();
    vi.stubGlobal("fetch", dashboardFetch(() => kellyDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");

    expect(globalThis.document.querySelector(".table-head")).toHaveAttribute("data-columns",
      "match kickoff form h2h expected shots market data");
    const row = globalThis.document.querySelector(".fixture-row")!;
    expect(row.querySelector(".form-cell")).toBeInTheDocument();
    expect(row.querySelector(".market-edge")).toHaveTextContent("+7,4 PP");
    expect(row).not.toHaveTextContent("€");
    // Nach Einsätzen lässt sich in der Übersicht nicht sortieren - sie stehen dort nicht.
    expect(within(screen.getByLabelText("Sortierung")).queryByRole("option", { name: "Kelly-Einsatz" })).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("group", { name: "Anzeige" })).getByRole("radio", { name: "Kennzahlen" }));
    expect(globalThis.document.querySelector(".fixture-row .market-edge")).toBeNull();
  });

  it("zeigt ohne Ligastärke-Vergleich keinen Vorteil", async () => {
    manual();
    const current = kellyDocument();
    current.fixtures[0]!.markets = current.fixtures[0]!.markets.map((market) =>
      market.key === "1x2" ? { ...market, probabilityReliable: false } : market);
    vi.stubGlobal("fetch", dashboardFetch(() => current));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Markt"), "1x2");
    const row = globalThis.document.querySelector(".fixture-row")!;
    expect(row.querySelector(".market-card")).toHaveTextContent("Ligastärke unbekannt");
    expect(row.querySelector(".market-edge")).toBeNull();
    // Nur 1X2 ist betroffen - BTTS desselben Spiels bleibt bewertbar.
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");
    expect(globalThis.document.querySelector(".fixture-row .market-edge")).toHaveTextContent("PP");
  });

  it("listet die Wetten im Dialog, sortierbar", async () => {
    manual();
    vi.stubGlobal("fetch", dashboardFetch(() => kellyDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");

    await user.click(screen.getByRole("button", { name: "Kelly-Auswahl öffnen" }));
    const dialog = screen.getByRole("dialog", { name: "Kelly-Auswahl" });
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const alpha = rows.find((row) => row.textContent?.includes("Alpha FC"))!;
    expect(alpha).toHaveTextContent("BTTS");
    expect(alpha).toHaveTextContent("60,0 %");
    expect(alpha).toHaveTextContent("+7,4 PP");
    expect(alpha).toHaveTextContent("3,00 €");
    // Der Vorteil erklärt sich im Kopf und warnt dort.
    expect(within(dialog).getByRole("button", { name: /^Vorteil/ })).toHaveAttribute("title", expect.stringContaining("desto eher ein Fehler des Modells"));
    await user.click(within(dialog).getByRole("button", { name: /^Spiel/ }));
    expect(within(dialog).getAllByRole("row")[1]).toHaveTextContent("Alpha FC");
    await user.click(within(dialog).getByRole("button", { name: /^Spiel/ }));
    expect(within(dialog).getAllByRole("row")[1]).toHaveTextContent("Zulu FC");
  });

  it("nennt es im Dialog, wenn keine Wette in der Auswahl ist", async () => {
    manual();
    vi.stubGlobal("fetch", dashboardFetch(() => kellyDocument([0.4, 0.4])));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");

    await user.click(screen.getByRole("button", { name: "Kelly-Auswahl öffnen" }));
    expect(within(screen.getByRole("dialog", { name: "Kelly-Auswahl" })).getByText("Keine Wette in der Auswahl für diesen Markt.")).toBeInTheDocument();
  });

  it("rechnet auf dem Umfang - ein Tabellenfilter ändert die Auswahl nicht", async () => {
    manual();
    vi.stubGlobal("fetch", dashboardFetch(() => kellyDocument()));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");

    const status = globalThis.document.querySelector(".kelly-status")!;
    expect(status).toHaveTextContent("Kelly-Auswahl · BTTS: 2 Wetten");
    await user.click(within(await openFilters(user)).getByRole("radio", { name: /Starke Tipps/ }));
    // Zulu FC ist ohne Stufe ausgeblendet, sein Einsatz gehört aber weiter zur Auswahl.
    expect(status).toHaveTextContent("2 Wetten");
  });

  it("zeigt keine Beträge, solange die Automatik lädt", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => String(url).startsWith("/api/market-profile")
      ? new Promise<Response>(() => {})
      : Promise.resolve(new Response(JSON.stringify(kellyDocument()), { status: 200 }))));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");

    expect(globalThis.document.querySelector(".kelly-status")).toHaveTextContent("Automatik wird geladen …");
    await user.click(screen.getByRole("button", { name: "Kelly-Auswahl öffnen" }));
    const table = within(screen.getByRole("dialog", { name: "Kelly-Auswahl" })).getByRole("table");
    expect(table).toHaveTextContent("Automatik wird geladen …");
    expect(table.querySelector(".kelly-stake")).toBeNull();
  });

  it("zeigt in der Automatik die korrigierte Wahrscheinlichkeit", async () => {
    // BTTS behauptet 60 % und trifft 65 % - die Korrektur hebt die Chance an.
    const profile = buildMarketProfile(Array.from({ length: 200 }, (_unused, index) => ({
      marketKey: "btts",
      marketLabel: "BTTS",
      kickoff: `2026-03-${String(1 + Math.floor(index / 40)).padStart(2, "0")}T18:00:00+01:00`,
      probability: 0.6,
      odds: 1.9,
      edge: 0.6 - 1 / 1.9,
      hit: ((index * 130) % 200 < 130 ? 1 : 0) as 0 | 1
    })));
    vi.stubGlobal("fetch", dashboardFetch(() => kellyDocument(), emptyInsights, profile));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findByText("Alpha FC")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Markt"), "btts");

    await waitFor(() => expect(globalThis.document.querySelector(".kelly-status")).toHaveTextContent("Automatik"));
    await user.click(screen.getByRole("button", { name: "Kelly-Auswahl öffnen" }));
    const dialog = screen.getByRole("dialog", { name: "Kelly-Auswahl" });
    expect(within(dialog).getByRole("button", { name: /^Korrigiert/ })).toBeInTheDocument();
    const row = within(dialog).getAllByRole("row")[1]!;
    expect(row.querySelector(".kelly-edge")).toHaveTextContent("nach Korr.");
    expect(row.querySelector(".kelly-stake strong")?.textContent).toMatch(/€$/);
  });
});
