import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureInsightPanels, useFixtureInsights } from "./FixtureInsights";
import type { FixtureInsights, InsightMatch, InsightTeamStats } from "./types";

const LEAGUE = { id: 78, name: "Bundesliga", country: "Deutschland", season: 2026 };
const HOME = { id: 10, name: "Heim FC" };
const AWAY = { id: 20, name: "Gast FC" };

/** Statistiken einer Mannschaft; alles, was nicht genannt ist, führt die Partie nicht. */
function stats(values: Partial<InsightTeamStats>): InsightTeamStats {
  return {
    possession: null, shots: null, shotsOnGoal: null, shotsOffGoal: null, blockedShots: null,
    shotsInsideBox: null, shotsOutsideBox: null, corners: null, fouls: null, offsides: null,
    yellowCards: null, redCards: null, goalkeeperSaves: null, totalPasses: null,
    passesAccurate: null,
    ...values
  };
}

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
        stats: {
          home: stats({ possession: 60, shots: 14, shotsOnGoal: 6, corners: 8, totalPasses: 400, passesAccurate: 320 }),
          away: null
        }
      }),
      match({
        fixtureId: 2, home: { id: 30, name: "Fremd FC" }, away: HOME, homeGoals: 0, awayGoals: 0,
        minutesComplete: true, goals: [],
        stats: { home: null, away: stats({ possession: 40, shots: 6, shotsOnGoal: 1, corners: 4 }) }
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
        stats: { home: null, away: stats({ possession: 48, shots: 11, shotsOnGoal: 4, corners: 3 }) }
      })
    ],
    h2h: [
      match({
        fixtureId: 4, homeGoals: 3, awayGoals: 0, halfTimeHomeGoals: 1, halfTimeAwayGoals: 0,
        stats: { home: stats({ possession: 56, corners: 6 }), away: stats({ possession: 44, corners: 2 }) }
      }),
      match({
        fixtureId: 5, home: AWAY, away: HOME, homeGoals: 2, awayGoals: 2,
        halfTimeHomeGoals: 1, halfTimeAwayGoals: 2, date: "2025-11-02T18:00:00.000Z",
        stats: { home: stats({ possession: 52, corners: 5 }), away: stats({ possession: 48, corners: 7 }) }
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
    const { panel } = panels();

    const scored = globalThis.document.querySelectorAll<HTMLElement>(".period-row.scored");
    // Nur das Heimspiel des Heimteams zählt: zwei Tore, in der ersten und der sechsten Phase.
    expect(scored[0]?.querySelector(".period-total")).toHaveTextContent("2");
    expect([...scored[0]!.querySelectorAll(".period-cell")].map((cell) => cell.textContent))
      .toEqual(["1", "0", "0", "0", "0", "1"]);
    expect(globalThis.document.querySelector(".period-head small")).toHaveTextContent("1 Partie · nur Heimspiele");

    await user.click(panel("Torphasen").getByRole("checkbox", { name: "Heim / Auswärts" }));

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

    const crests = [...globalThis.document.querySelectorAll<HTMLElement>(".period-row .team-crest")];
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

  it("behält beim Ligafilter die Duelle früherer Spielzeiten", async () => {
    const user = userEvent.setup();
    const data = insights();
    const { panel } = panels({
      ...data,
      // Dasselbe Duell, nur aus der Vorsaison - derselbe Wettbewerb bleibt derselbe Wettbewerb.
      h2h: data.h2h.map((item, index) => (index === 1 ? { ...item, season: 2025 } : item))
    });
    await user.click(panel("Direkte Begegnungen").getByRole("checkbox", { name: "Diese Liga" }));

    // Nur das Pokalduell fällt heraus, das Bundesligaduell der Vorsaison bleibt.
    expect(screen.queryByText("DFB-Pokal")).not.toBeInTheDocument();
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

describe("Match-Statistiken", () => {
  afterEach(cleanup);

  const line = (label: string) => [...globalThis.document.querySelectorAll<HTMLElement>(".match-stat")]
    .find((item) => item.querySelector(".match-stat-label")?.textContent === label)!;
  const values = (label: string) =>
    [...line(label).querySelectorAll(".match-stat-number")].map((item) => item.textContent);
  const basis = (label: string) => line(label).querySelector(".match-stat-basis")?.textContent;
  const widths = (label: string) =>
    [...line(label).querySelectorAll<HTMLElement>(".match-stat-fill")].map((item) => item.style.width);
  const rings = (caption: string) => [...globalThis.document.querySelectorAll<HTMLElement>(".stat-ring-group")]
    .find((item) => item.querySelector("figcaption")?.textContent === caption)!;

  /** Fünf Partien je Team - nur so entsteht ein Ø von 0,2 roten Karten. */
  function seasonInsights(): FixtureInsights {
    const run = (side: "home" | "away", reds: number[]) => reds.map((red, index) => match({
      fixtureId: (side === "home" ? 100 : 200) + index,
      stats: side === "home"
        ? { home: stats({ redCards: red, shotsOutsideBox: 8, corners: 8 }), away: null }
        : { home: null, away: stats({ redCards: red, shotsOutsideBox: 4, corners: 4 }) }
    }));
    return insights({
      homeMatches: run("home", [1, 0, 0, 0, 0]),
      awayMatches: run("away", [0, 0, 0, 0, 0])
    });
  }

  it("legt beide Anteile gleichgerichtet in eine Spur vom Ø-Gesamtwert", () => {
    const { panel } = panels();
    const view = panel("Match-Statistiken");
    expect(view.getByText("Ø letzte 5 Spiele")).toBeInTheDocument();
    // Der volle Katalog ohne die beiden Prozentkennzahlen, die als Ringe darüber stehen.
    expect(globalThis.document.querySelectorAll(".match-stat")).toHaveLength(14);
    expect(globalThis.document.querySelectorAll(".match-stat .match-stat-bar")).toHaveLength(28);
    // Heim FC 6,0 Ecken, Gast FC 3,0 - die Spur ist die Summe, die Anteile sind 2/3 und 1/3.
    expect(values("Ecken")).toEqual(["6,0", "3,0"]);
    expect(basis("Ecken")).toBe("Ø 9,0");
    expect(widths("Ecken").map((width) => Math.round(Number.parseFloat(width)))).toEqual([67, 33]);
    // Beide starten am linken Rand; nur der Abweichungsmodus rückt sie ein.
    expect([...line("Ecken").querySelectorAll<HTMLElement>(".match-stat-fill")]
      .map((item) => item.style.marginLeft)).toEqual(["0%", "0%"]);
  });

  it("zeigt eine Kennzahl ohne Daten als Strich", () => {
    panels();
    expect(values("Abseits")).toEqual(["–", "–"]);
    expect(basis("Abseits")).toBe("Ø –");
    // Der Balken bleibt dabei leer statt auf eine erfundene Null zu laufen.
    expect(widths("Abseits")).toEqual(["0%", "0%"]);
  });

  it("gruppiert die Zeilen in Offensiv und Defensiv", () => {
    const { panel } = panels();
    const view = panel("Match-Statistiken");
    expect(view.getByRole("heading", { name: "Offensiv" })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Defensiv" })).toBeInTheDocument();
    const groups = [...globalThis.document.querySelectorAll<HTMLElement>(".match-stat-group")];
    const labels = (group: HTMLElement) =>
      [...group.querySelectorAll(".match-stat-label")].map((item) => item.textContent);
    expect(labels(groups[0]!)).toContain("Ecken");
    expect(labels(groups[1]!)).toEqual([
      "Geblockte Schüsse", "Torwartparaden", "Fouls", "Gelbe Karten", "Rote Karten"
    ]);
  });

  it("kennzeichnet die überlegene Seite in zwei Stufen", () => {
    panels();
    // 6,0 gegen 3,0 Ecken sind 50 % Unterschied: klar überlegen, also dicker Balken.
    const corners = line("Ecken");
    expect(corners.querySelector(".match-stat-number.lead")).toHaveTextContent("6,0");
    expect(corners.querySelector(".match-stat-bar.home")!.className).toContain("strong");
    expect(corners.querySelector(".match-stat-bar.away")!.className).toContain("dim");
    // 10,0 gegen 11,0 Schüsse sind 9 %: leicht überlegen, der Balken bleibt normal hoch.
    const shots = line("Schüsse insgesamt");
    expect(shots.querySelector(".match-stat-number.lead")).toHaveTextContent("11,0");
    expect(shots.querySelector(".match-stat-bar.away")!.className).not.toContain("strong");
    expect(shots.querySelector(".match-stat-bar.home")!.className).toContain("dim");
  });

  it("bewertet weder uneindeutige Richtungen noch zu kleine Größen", () => {
    panels(seasonInsights());
    // Schüsse außerhalb: 8,0 gegen 4,0, aber hoch ist dort nicht besser als niedrig.
    expect(line("Schüsse außerhalb").querySelector(".lead")).toBeNull();
    expect(line("Schüsse außerhalb").querySelector(".dim")).toBeNull();
    // 0,2 gegen 0,0 rote Karten ist eine einzige Karte über fünf Spiele.
    expect(values("Rote Karten")).toEqual(["0,20", "0,00"]);
    expect(line("Rote Karten").querySelector(".lead")).toBeNull();
    expect(line("Rote Karten").querySelector(".dim")).toBeNull();
    // Gegenprobe mit derselben Datenlage, nur mit eindeutiger Richtung und größerem Wert.
    expect(line("Ecken").querySelector(".match-stat-number.lead")).toHaveTextContent("8,0");
  });

  it("schaltet auf die Abweichung vom Vergleichsschnitt um", async () => {
    const user = userEvent.setup();
    const { panel } = panels();
    const view = panel("Match-Statistiken");
    expect(view.getByText(/Spurlänge ist der Ø-Gesamtwert/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abweichung" }));

    expect(view.getByText(/Mittellinie ist der Vergleichsschnitt/)).toBeInTheDocument();
    // Schnitt der Ecken über beide Seiten aller sieben Partien mit Werten: 35 / 7 = 5,0.
    expect(basis("Ecken")).toBe("Ø Vergleich 5,0");
    expect(values("Ecken")).toEqual(["+20 %", "−40 %"]);
    // Nach rechts über dem Schnitt, nach links darunter - die Nulllinie liegt bei 50 %.
    const fills = [...line("Ecken").querySelectorAll<HTMLElement>(".match-stat-fill")];
    expect(Math.round(Number.parseFloat(fills[0]!.style.marginLeft))).toBe(50);
    expect(Math.round(Number.parseFloat(fills[1]!.style.marginLeft))).toBeLessThan(50);
  });

  it("lässt eine Zeile ohne Vergleichsschnitt im Abweichungsmodus leer", async () => {
    const user = userEvent.setup();
    panels();
    await user.click(screen.getByRole("button", { name: "Abweichung" }));
    expect(basis("Abseits")).toBe("Ø Vergleich –");
    expect(values("Abseits")).toEqual(["–", "–"]);
    expect(widths("Abseits")).toEqual(["0%", "0%"]);
  });

  it("löst beim Umschalten keinen weiteren Abruf aus", async () => {
    const user = userEvent.setup();
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    panels();
    await user.click(screen.getByRole("button", { name: "Abweichung" }));
    await user.click(screen.getByRole("button", { name: "Direkte Duelle" }));
    expect(fetched).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("stellt Ballbesitz und Passquote als Ringe über die Liste", () => {
    panels();
    // Die Werte der letzten Spiele stammen aus verschiedenen Partien: zwei getrennte Ringe,
    // keine Aufteilung auf 100 - 50 und 48 ergeben zusammen 98.
    expect(rings("Ballbesitz").querySelector(".stat-ring-split")).toBeNull();
    expect([...rings("Ballbesitz").querySelectorAll(".stat-ring-number")].map((item) => item.textContent))
      .toEqual(["50 %", "48 %"]);
    expect([...rings("Passquote").querySelectorAll(".stat-ring-number")].map((item) => item.textContent))
      .toEqual(["80,0 %", "–"]);
    // Die Zahl liegt als HTML über dem SVG, nicht als <text> darin.
    expect(globalThis.document.querySelectorAll(".stat-ring svg text")).toHaveLength(0);
    // Und keine Zeile führt sie zusätzlich als Spur.
    expect(line("Ballbesitz")).toBeUndefined();
    expect(line("Passquote")).toBeUndefined();
  });

  it("teilt den Ballbesitz der direkten Duelle in einen Ring", async () => {
    const user = userEvent.setup();
    const { panel } = panels();
    await user.click(screen.getByRole("button", { name: "Direkte Duelle" }));

    expect(panel("Match-Statistiken").getByText("Ø letzte 5 direkte Duelle")).toBeInTheDocument();
    // Beide Seiten mitteln über dieselben Duelle, der Ballbesitz teilt sich also auf 100 %.
    const split = rings("Ballbesitz").querySelector(".stat-ring-split")!;
    expect([...split.querySelectorAll(".stat-ring-value")].map((item) => item.textContent))
      .toEqual(["52 %", "48 %"]);
    // Der Heimanteil läuft gegen den Uhrzeigersinn und liegt damit links, wie sein Wert.
    expect(split.querySelector(".stat-ring-fill.home")).toHaveAttribute("transform", expect.stringContaining("scale(-1 1)"));
  });

  it("stellt Heimform gegen Auswärtsform", async () => {
    const user = userEvent.setup();
    const { panel } = panels();
    const view = panel("Match-Statistiken");
    await user.click(view.getByRole("checkbox", { name: "Heim / Auswärts" }));

    // Heim FC nur zuhause: 8,0 statt 6,0 Ecken. Gast FC hat ohnehin nur ein Auswärtsspiel.
    expect(values("Ecken")).toEqual(["8,0", "3,0"]);
    expect(view.getByText("1 Partie · nur Heimspiele")).toBeInTheDocument();
    expect(view.getByText("1 Partie · nur Auswärtsspiele")).toBeInTheDocument();
    // Der Ballbesitz der Heimspiele steht ohne das Auswärtsspiel bei 60 %.
    expect([...rings("Ballbesitz").querySelectorAll(".stat-ring-number")].map((item) => item.textContent))
      .toEqual(["60 %", "48 %"]);
  });

  it("behält im Duellmodus nur die Duelle im Stadion des Heimteams", async () => {
    const user = userEvent.setup();
    const { panel } = panels();
    const view = panel("Match-Statistiken");
    await user.click(screen.getByRole("button", { name: "Direkte Duelle" }));
    await user.click(view.getByRole("checkbox", { name: "Heim / Auswärts" }));

    // Das Rückspiel im Stadion von Gast FC fällt heraus.
    expect(values("Ecken")).toEqual(["6,0", "2,0"]);
    // Beide Seiten mitteln weiter über dieselben Duelle, der Ballbesitz teilt sich auf 100 %.
    const split = rings("Ballbesitz").querySelector(".stat-ring-split")!;
    expect([...split.querySelectorAll(".stat-ring-value")].map((item) => item.textContent))
      .toEqual(["56 %", "44 %"]);
  });

  it("fällt auf zwei Ringe zurück, wenn die Anteile kein Ganzes ergeben", async () => {
    const user = userEvent.setup();
    const data = insights();
    // Das zweite Duell führt den Ballbesitz nur für eine Seite: Heim mittelt über zwei
    // Partien, Auswärts über eine - zusammen ergibt das nicht 100.
    panels({
      ...data,
      h2h: [
        match({ fixtureId: 4, stats: { home: stats({ possession: 60 }), away: stats({ possession: 40 }) } }),
        match({ fixtureId: 5, stats: { home: stats({ possession: 50 }), away: null } })
      ]
    });
    await user.click(screen.getByRole("button", { name: "Direkte Duelle" }));

    const group = rings("Ballbesitz");
    expect(group.querySelector(".stat-ring-split")).toBeNull();
    expect([...group.querySelectorAll(".stat-ring-number")].map((item) => item.textContent))
      .toEqual(["55 %", "40 %"]);
  });

  it("nennt fehlende direkte Duelle beim Namen, statt es API-Football anzulasten", async () => {
    const user = userEvent.setup();
    panels({ ...insights(), h2h: [] });
    await user.click(screen.getByRole("button", { name: "Direkte Duelle" }));

    expect(screen.getByText("Für diese Partie sind keine direkten Duelle hinterlegt.")).toBeInTheDocument();
  });

  it("begrenzt die Anzahl der Partien und schreibt sie in die Überschrift", async () => {
    const user = userEvent.setup();
    const { panel } = panels();
    await user.selectOptions(screen.getByRole("combobox", { name: "Anzahl betrachteter Spiele" }), "1");

    expect(panel("Match-Statistiken").getByText("Ø letztes Spiel")).toBeInTheDocument();
    // Nur noch die jüngste Partie je Team.
    expect(values("Ecken")).toEqual(["8,0", "3,0"]);
  });

  it("weist eine Auswahl ganz ohne Statistiken aus", async () => {
    const user = userEvent.setup();
    const data = insights();
    panels({ ...data, h2h: data.h2h.map((item) => ({ ...item, stats: { home: null, away: null } })) });
    await user.click(screen.getByRole("button", { name: "Direkte Duelle" }));

    expect(screen.getByText("Für diese Partien führt API-Football keine Statistikwerte.")).toBeInTheDocument();
    expect(globalThis.document.querySelectorAll(".match-stat")).toHaveLength(0);
    expect(globalThis.document.querySelectorAll(".stat-ring-group")).toHaveLength(0);
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
