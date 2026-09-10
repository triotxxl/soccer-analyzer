import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureInsightPanels, useFixtureInsights } from "./FixtureInsights";
import type { FixtureInsights, InsightMatch } from "./types";

const LEAGUE = { id: 78, name: "Bundesliga", country: "Deutschland", season: 2026 };
const HOME = { id: 10, name: "Heim FC" };
const AWAY = { id: 20, name: "Gast FC" };

function match(overrides: Partial<InsightMatch> & { fixtureId: number }): InsightMatch {
  return {
    date: "2026-08-01T18:00:00.000Z",
    leagueId: LEAGUE.id, league: LEAGUE.name, country: LEAGUE.country, season: LEAGUE.season,
    home: HOME, away: AWAY,
    homeGoals: 1, awayGoals: 0, halfTimeHomeGoals: 0, halfTimeAwayGoals: 0,
    goals: [], minutesComplete: false, stats: { home: null, away: null },
    ...overrides
  };
}

function insights(overrides: Partial<FixtureInsights> = {}): FixtureInsights {
  return {
    fixtureId: 900, league: LEAGUE, home: HOME, away: AWAY,
    homeMatches: [
      match({
        fixtureId: 1, homeGoals: 2, awayGoals: 1, minutesComplete: true,
        goals: [{ teamId: HOME.id, minute: 5 }, { teamId: HOME.id, minute: 80 }, { teamId: AWAY.id, minute: 50 }],
        stats: { home: { possession: 60, shots: 14, shotsOnGoal: 6 }, away: null }
      }),
      match({
        fixtureId: 2, home: { id: 30, name: "Fremd FC" }, away: HOME, homeGoals: 0, awayGoals: 0,
        minutesComplete: true, goals: [],
        stats: { home: null, away: { possession: 40, shots: 6, shotsOnGoal: 1 } }
      })
    ],
    awayMatches: [
      match({
        fixtureId: 3, home: { id: 40, name: "Dritt FC" }, away: AWAY, homeGoals: 1, awayGoals: 3,
        minutesComplete: true,
        goals: [
          { teamId: AWAY.id, minute: 20 }, { teamId: AWAY.id, minute: 25 },
          { teamId: AWAY.id, minute: 70 }, { teamId: 40, minute: 88 }
        ],
        stats: { home: null, away: { possession: 48, shots: 11, shotsOnGoal: 4 } }
      })
    ],
    h2h: [
      match({ fixtureId: 4, homeGoals: 3, awayGoals: 0, halfTimeHomeGoals: 1, halfTimeAwayGoals: 0 }),
      match({
        fixtureId: 5, home: AWAY, away: HOME, homeGoals: 2, awayGoals: 2,
        halfTimeHomeGoals: 1, halfTimeAwayGoals: 2, date: "2025-11-02T18:00:00.000Z"
      }),
      match({
        fixtureId: 6, leagueId: 81, league: "DFB-Pokal", homeGoals: 0, awayGoals: 1,
        date: "2025-03-08T18:00:00.000Z"
      })
    ],
    coverage: { matches: 6, withMinutes: 3, withStats: 3 },
    fetchedAt: "2026-09-04T10:00:00.000Z", apiRequests: 4,
    ...overrides
  };
}

function panels(data = insights()) {
  const view = render(<FixtureInsightPanels insights={data} timezone="Europe/Berlin" />);
  return { ...view, panel: (name: string) => within(screen.getByRole("region", { name })) };
}

describe("Torphasen", () => {
  afterEach(cleanup);

  it("zeigt Tore je Viertelstunde und rechnet auf Heim- und Auswärtsspiele", async () => {
    const user = userEvent.setup();
    panels();

    const scored = globalThis.document.querySelectorAll<HTMLElement>(".period-row.scored");
    // Nur das Heimspiel des Heimteams zählt: zwei Tore, in der ersten und der sechsten Phase.
    expect(scored[0]?.querySelector(".period-total")).toHaveTextContent("2");
    expect([...scored[0]!.querySelectorAll(".period-cell")].map((cell) => cell.textContent))
      .toEqual(["1", "0", "0", "0", "0", "1"]);
    expect(globalThis.document.querySelector(".period-head small")).toHaveTextContent("1 Partie · nur Heimspiele");

    await user.click(screen.getByRole("checkbox", { name: "Heim / Auswärts" }));

    // Ohne Ortsfilter kommt das torlose Auswärtsspiel des Heimteams dazu.
    expect(globalThis.document.querySelector(".period-head small")).toHaveTextContent("2 Partien");
    expect(globalThis.document.querySelector(".period-row.scored .period-total")).toHaveTextContent("2");
  });

  it("stellt die Tore einer Mannschaft den Gegentoren der anderen gegenüber", () => {
    panels();

    const rows = [...globalThis.document.querySelectorAll<HTMLElement>(".period-row")];
    const cells = (row: HTMLElement) => [...row.querySelectorAll(".period-cell")].map((cell) => cell.textContent);
    // Erster Block: was Heim FC zuhause trifft, steht über dem, was Gast FC auswärts kassiert.
    expect(rows[0]!.title).toContain("Heim FC");
    expect(cells(rows[0]!)).toEqual(["1", "0", "0", "0", "0", "1"]);
    expect(rows[1]!.title).toContain("Gast FC");
    expect(cells(rows[1]!)).toEqual(["0", "0", "0", "0", "0", "1"]);
    // Zweiter Block dreht die Paarung um.
    expect(rows[2]!.title).toContain("Gast FC");
    expect(cells(rows[2]!)).toEqual(["0", "2", "0", "0", "1", "0"]);
    expect(rows[3]!.title).toContain("Heim FC");
    expect(cells(rows[3]!)).toEqual(["0", "0", "0", "1", "0", "0"]);
  });

  it("führt jede Zeile mit dem Wappen der Mannschaft, ohne URL mit ihren Initialen", () => {
    const data = insights();
    panels({ ...data, home: { ...data.home, logo: "https://media.example/10.png" } });

    const crests = [...globalThis.document.querySelectorAll<HTMLElement>(".period-row .period-crest")];
    expect(crests[0]).toHaveAttribute("src", "https://media.example/10.png");
    expect(crests[1]).toHaveTextContent("GA");
  });

  it("weist die Ligaeinordnung in der Überschrift aus", () => {
    panels();
    expect(screen.getByText("Bundesliga 2026")).toBeInTheDocument();
  });

  it("fällt ohne Partie in dieser Liga auf alle Wettbewerbe zurück", () => {
    const data = insights();
    panels({
      ...data,
      homeMatches: data.homeMatches.map((item) => ({ ...item, leagueId: 81, league: "DFB-Pokal" })),
      awayMatches: data.awayMatches.map((item) => ({ ...item, leagueId: 81, league: "DFB-Pokal" }))
    });
    expect(screen.getByText("alle Wettbewerbe")).toBeInTheDocument();
  });
});

describe("Direkte Begegnungen", () => {
  afterEach(cleanup);

  it("zeigt Bilanz, Tore pro Spiel und Halbzeitstand", () => {
    panels();
    expect(screen.getByText("S ×1")).toBeInTheDocument();
    expect(screen.getByText("U ×1")).toBeInTheDocument();
    expect(screen.getByText("N ×1")).toBeInTheDocument();
    expect(screen.getByText("1,7 – 1,0 pro Spiel")).toBeInTheDocument();
    expect(globalThis.document.querySelectorAll(".h2h-row")).toHaveLength(3);
    expect(screen.getByText("DFB-Pokal")).toBeInTheDocument();
  });

  it("schaltet die Bilanz auf Prozent um", async () => {
    const user = userEvent.setup();
    panels();
    await user.click(screen.getByRole("button", { name: "%" }));
    expect(screen.getByText("S 33 %")).toBeInTheDocument();
  });

  it("filtert auf Heimspiele des Heimteams", async () => {
    const user = userEvent.setup();
    panels();
    await user.click(screen.getByRole("checkbox", { name: "Heim – Heim FC" }));
    expect(globalThis.document.querySelectorAll(".h2h-row")).toHaveLength(2);
    expect(screen.getByText("S ×1")).toBeInTheDocument();
    expect(screen.getByText("N ×1")).toBeInTheDocument();
  });

  it("filtert auf diese Liga und begrenzt die Anzahl", async () => {
    const user = userEvent.setup();
    const { panel } = panels();
    await user.click(panel("Direkte Begegnungen").getByRole("checkbox", { name: "Diese Liga" }));
    expect(screen.queryByText("DFB-Pokal")).not.toBeInTheDocument();
    expect(globalThis.document.querySelectorAll(".h2h-row")).toHaveLength(2);

    await user.selectOptions(screen.getByRole("combobox", { name: "Anzahl direkter Duelle" }), "3");
    expect(globalThis.document.querySelectorAll(".h2h-row")).toHaveLength(2);
  });

  it("hält die Liste ohne Auswahl leer statt leer wirkend", async () => {
    const user = userEvent.setup();
    const { panel } = panels({ ...insights(), h2h: [] });
    expect(screen.getByText("Keine direkten Duelle für diese Auswahl.")).toBeInTheDocument();
    expect(panel("Direkte Begegnungen").getByText("S ×0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "%" }));
    expect(panel("Direkte Begegnungen").getByText("S –")).toBeInTheDocument();
  });
});

describe("Trends", () => {
  afterEach(cleanup);

  it("stellt Bilanz, Tore, Ballbesitz und Schüsse gegenüber", () => {
    panels();
    const table = screen.getByRole("table", { name: "Trends beider Teams" });
    const row = (label: string) => within(table).getByRole("row", { name: new RegExp(`^${label}`) });
    expect(row("S-U-N")).toHaveTextContent("1-1-0");
    expect(row("Tore")).toHaveTextContent("2");
    expect(row("Ballbesitz")).toHaveTextContent("50 %");
    expect(row("Schüsse")).toHaveTextContent("10");
    expect(row("Grundlage")).toHaveTextContent("2 Partien");
  });

  it("hebt den besseren Wert hervor", () => {
    panels();
    const table = screen.getByRole("table", { name: "Trends beider Teams" });
    const row = within(table).getByRole("row", { name: /^Ballbesitz/ });
    const better = row.querySelector(".trend-better");
    expect(better).toHaveTextContent("50 %");
    // Die Hervorhebung trägt die Farbe der Spalte, in der sie steht - Heim blau, Auswärts orange.
    const cells = [...row.querySelectorAll("td")];
    expect(better?.className).toContain(cells[0].contains(better) ? "home" : "away");
  });

  it("weist fehlende Statistiken aus, statt eine Null zu erfinden", () => {
    const data = insights();
    panels({
      ...data,
      homeMatches: data.homeMatches.map((item) => ({ ...item, stats: { home: null, away: null } })),
      awayMatches: data.awayMatches.map((item) => ({ ...item, stats: { home: null, away: null } }))
    });
    expect(screen.getByText("Für diese Partien führt API-Football keine Ballbesitz- und Schussdaten.")).toBeInTheDocument();
  });
});

describe("useFixtureInsights", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("meldet einen Partiewechsel sofort als ladend, ohne den vorigen Stand zu zeigen", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const fixtureId = Number(new URLSearchParams(String(url).split("?")[1] ?? "").get("fixture"));
      return Promise.resolve(new Response(JSON.stringify(insights({ fixtureId })), { status: 200 }));
    }));

    // Der Status wird in der Renderphase mitgeschrieben. Nur so wird sichtbar, ob zwischen
    // Klick und Effekt noch einmal der Stand der vorigen Partie gerendert wird.
    const seen: string[] = [];
    function Probe({ fixtureId }: { fixtureId: number | null }) {
      seen.push(useFixtureInsights(fixtureId).status);
      return null;
    }

    const view = render(<Probe fixtureId={900} />);
    await waitFor(() => expect(seen).toContain("ready"));

    const before = seen.length;
    await act(async () => { view.rerender(<Probe fixtureId={901} />); });
    // Der erste Render nach dem Wechsel muss ladend sein; ohne die Zuordnung des Stands
    // zur Partie stünde hier "ready" mit den Kennzahlen der vorigen Partie.
    expect(seen.slice(before)[0]).toBe("loading");
  });
});
