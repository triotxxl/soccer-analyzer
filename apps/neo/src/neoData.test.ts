import { describe, expect, it } from "vitest";
import {
  bothScore, likelyTips, overUnder, percent,
  competitionsOf, competitionTree, countryCode, datePresets, dayKey, isCup, leagueTables, modelTips, oddsTriple, oneXTwo, scopeLabel,
  seasonLabel, sortName,
} from "./neoData";
import { DOCUMENT } from "./testData";

const [league, other, cup] = DOCUMENT.fixtures as [typeof DOCUMENT.fixtures[0], typeof DOCUMENT.fixtures[0], typeof DOCUMENT.fixtures[0]];

describe("1X2 und Quoten", () => {
  it("baut Heim, Remis und Gast aus der pick-Seite und dem Remis", () => {
    const home = oneXTwo(league)!;
    expect(home.home).toBeCloseTo(0.55);
    expect(home.draw).toBeCloseTo(0.25);
    expect(home.away).toBeCloseTo(0.2);
    const away = oneXTwo(other)!;
    expect(away.away).toBeCloseTo(0.6);
    expect(away.home).toBeCloseTo(0.18);
  });

  it("zeigt bei nicht belastbarem 1X2 keine Chance, aber die Quoten", () => {
    expect(oneXTwo(cup)).toBeNull();
    expect(oddsTriple(cup)).toEqual([9, 6.5, 1.25]);
  });
});

describe("Wettbewerbe", () => {
  it("fasst Land und Liga zusammen und erkennt Pokale", () => {
    const comps = competitionsOf(DOCUMENT.fixtures);
    expect(comps.map((c) => c.id).sort()).toEqual(["England|Premier League", "Germany|Bundesliga", "Germany|DFB Pokal"]);
    expect(comps.find((c) => c.league === "DFB Pokal")!.cup).toBe(true);
    expect(comps.find((c) => c.league === "Bundesliga")!.cup).toBe(false);
    expect(isCup([cup])).toBe(true);
  });

  it("ordnet Ligen vor Pokalen und Länder nach dem angezeigten Namen", () => {
    const tree = competitionTree(competitionsOf(DOCUMENT.fixtures), "tipico");
    expect(tree.map((g) => g.id)).toEqual(["Germany", "England"]); // „Deutschland“ (Tipico) vor „England“
    expect(tree[0]!.competitions.map((c) => c.league)).toEqual(["Bundesliga", "DFB Pokal"]);
  });

  it("kürzt Länder wie die Referenz", () => {
    expect(countryCode("Germany")).toBe("DE");
    expect(countryCode("England")).toBe("ENG");
  });
});

describe("Zeitraum", () => {
  it("rechnet Tage in der Zeitzone des Snapshots", () => {
    expect(dayKey("2026-10-27T23:30:00.000Z", "Europe/Berlin")).toBe("2026-10-28");
  });

  it("setzt die Schnellwahl ab heute", () => {
    const presets = Object.fromEntries(datePresets("2026-10-27", "2026-10-27", "2026-10-29").map(([label, a, b]) => [label, [a, b]]));
    expect(presets["Heute"]).toEqual(["2026-10-27", "2026-10-27"]);
    expect(presets["Wochenende"]).toEqual(["2026-10-30", "2026-11-01"]);
    expect(presets["Pokal-Woche"]).toEqual(["2026-10-27", "2026-10-29"]);
    expect(presets["Nächstes WE"]).toEqual(["2026-11-06", "2026-11-08"]);
    expect(presets["Alle"]).toEqual(["2026-10-27", "2026-10-29"]);
  });

  it("beschriftet Zeitraum und einzelne Tage", () => {
    expect(scopeLabel({ mode: "range", from: "2026-10-27", to: "2026-10-27" })).toBe("Di., 27.10.");
    expect(scopeLabel({ mode: "days", days: [] })).toBe("Keine Tage gewählt");
  });
});

describe("Teams", () => {
  it("nimmt jede Ligatabelle einmal mit der Form der Tabellenzeile", () => {
    const comps = competitionsOf(DOCUMENT.fixtures);
    const tables = leagueTables(DOCUMENT.fixtures, comps);
    expect(tables.map((t) => t.competition.league)).toEqual(["Bundesliga", "Premier League"]); // der Pokal hat keine Tabelle
    const bundesliga = tables[0]!.rows;
    expect(bundesliga.find((r) => r.name === "Heim FC")!.form).toEqual(["win", "draw", "win", "loss", "win"]);
    expect(bundesliga.find((r) => r.name === "Dritter SV")!.form).toBeNull();
  });

  it("sortiert ohne Rechtsform", () => {
    expect(sortName("1. FC Köln")).toBe("Köln");
    expect(sortName("FC Arsenal")).toBe("Arsenal");
    expect(sortName("Werder Bremen")).toBe("Werder Bremen");
  });
});

describe("Modell-Tipps", () => {
  it("nimmt je Spiel den wahrscheinlichsten Tipp aus den gewählten Märkten", () => {
    const tips = modelTips(DOCUMENT.fixtures, ["1x2", "ou", "btts"], 0, 100, "tipico");
    expect(tips.map((t) => t.pick)).toEqual(["Über 2,5 Tore", "Über 2,5 Tore", "Über 2,5 Tore"]);
    const winners = modelTips(DOCUMENT.fixtures, ["1x2"], 0, 100, "tipico");
    expect(winners.map((t) => t.pick)).toEqual(["Heim (Tipico) gewinnt", "Leeds AFC gewinnt"]); // Pokal: 1X2 nicht belastbar
  });

  it("filtert nach dem Wahrscheinlichkeitsbereich", () => {
    expect(modelTips(DOCUMENT.fixtures, ["ou"], 70, 100, "api").map((t) => t.fixture.fixtureId)).toEqual([2]);
  });
});

describe("Marktchancen", () => {
  const [heim, london, pokal] = DOCUMENT.fixtures;
  it("nimmt für „Am ehesten“ je Markt den wahrscheinlichsten Tipp", () => {
    expect(likelyTips(london!, "api").map((t) => [t.pick, t.probability])).toEqual([["Leeds AFC gewinnt", 0.6], ["Über 2,5 Tore", 0.71], ["Ja", 0.5]]);
    expect(likelyTips(pokal!, "api").map((t) => t.market)).toEqual(["ou", "btts"]);
  });
  it("liest Torlinien aus den Märkten, 0,5 und 4,5 aus der Torverteilung", () => {
    expect(overUnder(london!, 2.5)).toEqual({ yes: 0.71, no: 0.29, oddsYes: 1.5, oddsNo: 2.6 });
    expect(overUnder(london!, 4.5)!.yes).toBeCloseTo(0.14);
    expect(overUnder(london!, 0.5)!.no).toBeCloseTo(0.06);
    expect(overUnder(heim!, 4.5)).toBeNull();
  });
  it("führt BTTS mit beiden Quoten", () => {
    expect(bothScore(pokal!)).toEqual({ yes: 0.4, no: 0.6, oddsYes: 2.1, oddsNo: 1.7 });
  });
  it("schreibt sehr kleine Chancen als „< 1 %“", () => {
    expect(percent(0.004)).toBe("< 1 %");
    expect(percent(0.012)).toBe("1 %");
  });
});

describe("Saison", () => {
  it("beginnt im Juli", () => {
    expect(seasonLabel("2026-10-27T13:00:00Z")).toBe("Saison 26/27");
    expect(seasonLabel("2027-03-01T13:00:00Z")).toBe("Saison 26/27");
  });
});
