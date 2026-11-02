import { describe, expect, it } from "vitest";
import {
  duelsOf, duelStats, phaseCounts, seasonMatches, tableEntryOf,
  bothScore, likelyTips, overUnder, percent,
  competitionsOf, competitionTree, countryCode, datePresets, dayKey, isCup, isOver, leagueTables, modelTips, oddsTriple, oneXTwo, scopeLabel,
  seasonLabel, sortName, sortTips, strengthOf,
} from "./neoData";
import { DOCUMENT, INSIGHTS } from "./testData";

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

  it("hält ein Spiel bis 120 Minuten nach Anpfiff für nicht vorbei", () => {
    const kickoff = Date.parse("2026-10-27T17:00:00.000Z");
    expect(isOver({ kickoff: "2026-10-27T17:00:00.000Z" }, kickoff + 119 * 60_000)).toBe(false);
    expect(isOver({ kickoff: "2026-10-27T17:00:00.000Z" }, kickoff + 120 * 60_000)).toBe(true);
    // Zeitzone im Anstoß zählt, nicht der Text (AGENTS.md: Zeitpunkte nie als Text vergleichen)
    expect(isOver({ kickoff: "2026-10-27T19:00:00+02:00" }, kickoff + 119 * 60_000)).toBe(false);
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

  it("ordnet je Tag nach Chance oder nach Anstoß", () => {
    const at = (id: number, kickoff: string, probability: number) =>
      ({ id: String(id), fixture: { ...league, fixtureId: id, kickoff }, market: "ou", marketLabel: "", pick: "", probability, odds: null }) as const;
    const tips = [at(1, "2026-10-27T19:30:00Z", 0.7), at(2, "2026-10-27T17:00:00Z", 0.6), at(3, "2026-10-26T20:00:00Z", 0.5), at(4, "2026-10-27T17:00:00Z", 0.8)];
    expect(sortTips(tips, "chance", "Europe/Berlin").map((t) => t.id)).toEqual(["3", "4", "1", "2"]);
    expect(sortTips(tips, "kickoff", "Europe/Berlin").map((t) => t.id)).toEqual(["3", "4", "2", "1"]);
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

describe("H2H", () => {
  const london = DOCUMENT.fixtures[1]!;
  it("zählt die Duelle aus Sicht des Heimteams, ohne Testspiele", () => {
    const duels = duelsOf(london);
    expect(duels.map((d) => d.id)).toEqual([501, 502, 504, 505, 506]);
    const s = duelStats(duels);
    expect([s.n, s.wH, s.dr, s.wA, s.gH, s.gA]).toEqual([5, 2, 1, 2, 6, 6]);
    expect([s.bestH?.id, s.bestA?.id]).toEqual([505, 501]);
    expect(duels[0]!.league).toBe("Premier League");
  });
  it("nimmt ohne Verlauf die fünf Duelle aus h2h.matches", () => {
    const old = { ...london, h2h: { ...london.h2h, history: undefined } };
    expect(duelsOf(old).length).toBe(4); // die fünf aus h2h.matches enthalten das Testspiel
  });
  it("findet die Tabellenzeile auch in der Tabelle eines anderen Spiels", () => {
    const cup = DOCUMENT.fixtures[2]!;
    expect(cup.table).toBeUndefined();
    expect(tableEntryOf(DOCUMENT.fixtures, cup, "Heim FC")?.row.position).toBe(1);
    expect(tableEntryOf(DOCUMENT.fixtures, london, "Leeds AFC")?.row.positions).toEqual([3, 2, 1, 1]);
  });
  it("verteilt die Tore auf Viertelstunden und lässt Spiele mit Lücken weg", () => {
    const duelMatches = INSIGHTS.h2h.filter((m) => !/friendl/i.test(m.league));
    expect(phaseCounts(duelMatches, 10)).toEqual({ games: 2, scored: [0, 0, 1, 1, 0, 0], conceded: [1, 0, 0, 1, 0, 1] });
    const gap = [{ ...INSIGHTS.h2h[0]!, minutesComplete: false }];
    expect(phaseCounts(gap, 10).games).toBe(0);
    expect(seasonMatches(INSIGHTS.homeMatches, 10, "home").map((m) => m.fixtureId)).toEqual([601]);
    // Früh in der Saison: mehr Spiele der Vorsaison - gezählt wird trotzdem nur die laufende
    const early = [INSIGHTS.homeMatches[0]!, ...[1, 2, 3].map((i) => ({ ...INSIGHTS.homeMatches[0]!, fixtureId: 700 + i, season: 2025 }))];
    expect(seasonMatches(early, 10, null).map((m) => m.fixtureId)).toEqual([601]);
  });
});

describe("Saison", () => {
  it("beginnt im Juli", () => {
    expect(seasonLabel("2026-10-27T13:00:00Z")).toBe("Saison 26/27");
    expect(seasonLabel("2027-03-01T13:00:00Z")).toBe("Saison 26/27");
  });
});

describe("Elo (Spielstärke)", () => {
  it("nennt in derselben Liga das Urteil über die Teams, ohne Liga-Niveau", () => {
    const s = strengthOf(league);
    expect(s.comparable).toBe(true);
    expect(s.stronger).toBeNull();
    expect(s.verdict).toBe("etwa gleich stark");
    expect(s.league).toBeNull();
  });
  it("zeigt bei Spielen zwischen Ligen das Liga-Niveau und den Klassenunterschied", () => {
    const s = strengthOf(cup);
    expect(s.stronger).toBe("away");
    expect(s.verdict).toBe("Heim FC klar stärker");
    expect(s.league?.verdict).toBe("deutlicher Klassenunterschied zugunsten von Heim FC");
    expect(s.league?.stronger).toBe("away");
  });
  it("vergleicht keine verschiedenen Skalen und nennt fehlendes Elo", () => {
    const mixed = { ...cup, awayElo: { ...cup.awayElo!, system: "national" as const } };
    expect(strengthOf(mixed).comparable).toBe(false);
    expect(strengthOf(mixed).verdict).toBeNull();
    expect(strengthOf(mixed).league).toBeNull();
    expect(strengthOf(other).verdict).toBeNull();
  });
  it("hängt das Elo an die Tabellenzeilen", () => {
    const rows = leagueTables(DOCUMENT.fixtures, competitionsOf(DOCUMENT.fixtures)).flatMap((t) => t.rows);
    expect(rows.find((r) => r.name === "Heim FC")?.elo?.elo).toBe(1872);
    expect(rows.find((r) => r.name === "Dritter SV")?.elo).toBeNull();
  });
});
