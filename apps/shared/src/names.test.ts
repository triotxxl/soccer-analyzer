import { afterEach, describe, expect, it } from "vitest";
import {
  competitionCountry, competitionLabel, competitionLeague, competitionMatches, competitionVariants, displayTeam,
  fixtureMatches, leagueName, loadNameSource, saveNameSource, selectionText, teamName
} from "./names";

const tipico = { homeTeam: "Hapoel Jerusalem", awayTeam: "Maccabi Haifa", country: "Israel", league: "Premier League" };
const fixture = { homeTeam: "Hapoel Katamon", awayTeam: "Maccabi Haifa", country: "Israel", league: "Ligat Ha'al", tipico };
const plain = { homeTeam: "Hapoel Katamon", awayTeam: "Maccabi Haifa", country: "Israel", league: "Ligat Ha'al" };

describe("Namen nach Einstellung", () => {
  afterEach(() => window.localStorage.clear());

  it("zeigt ab Werk Tipico und fällt ohne Tipico-Namen auf API-Football zurück", () => {
    expect(loadNameSource()).toBe("tipico");
    expect(teamName(fixture, "home", "tipico")).toBe("Hapoel Jerusalem");
    expect(teamName(fixture, "home", "api")).toBe("Hapoel Katamon");
    expect(leagueName(fixture, "tipico")).toBe("Premier League");
    // Snapshot vor schemaVersion 8: kein Tipico-Name, also der von API-Football.
    expect(teamName(plain, "home", "tipico")).toBe("Hapoel Katamon");
  });

  it("merkt sich die Wahl", () => {
    saveNameSource("api");
    expect(loadNameSource()).toBe("api");
    saveNameSource("tipico");
    expect(loadNameSource()).toBe("tipico");
  });

  it("ersetzt in früheren Spielen nur die beiden Mannschaften des Spiels", () => {
    expect(displayTeam("Hapoel Katamon", fixture, "tipico")).toBe("Hapoel Jerusalem");
    expect(displayTeam("Beitar Jerusalem", fixture, "tipico")).toBe("Beitar Jerusalem");
    expect(displayTeam("Hapoel Katamon", fixture, "api")).toBe("Hapoel Katamon");
  });

  it("baut den 1X2-Tipp aus der Seite neu und lässt andere Märkte unverändert", () => {
    const market = { key: "1x2" as const, pick: "1" as const, selection: "Heimsieg Hapoel Katamon" };
    expect(selectionText(fixture, market, "tipico")).toBe("Heimsieg Hapoel Jerusalem");
    expect(selectionText(fixture, { ...market, pick: "2" }, "tipico")).toBe("Auswärtssieg Maccabi Haifa");
    expect(selectionText(fixture, market, "api")).toBe("Heimsieg Hapoel Katamon");
    expect(selectionText(fixture, { key: "over25", pick: null, selection: "Mindestens 3 Tore" }, "tipico")).toBe("Mindestens 3 Tore");
  });
});

describe("Liste „Wettbewerbe“", () => {
  it("zeigt den gemeinsamen Anfang mehrerer Tipico-Gruppen", () => {
    expect(competitionLabel(["Primera Division, Apertura, Gruppe A", "Primera Division, Apertura, Gruppe B"]))
      .toBe("Primera Division, Apertura");
    expect(competitionLabel(["Primera Division", "Primera Division, Apertura"])).toBe("Primera Division");
    expect(competitionLabel(["Serie B", "Serie B"])).toBe("Serie B");
  });

  it("nimmt ohne gemeinsamen Anfang die häufigste Bezeichnung mit „u. a.“", () => {
    expect(competitionLabel(["Liga Profesional", "Copa de la Liga", "Liga Profesional"])).toBe("Liga Profesional u. a.");
  });

  it("findet einen Wettbewerb unter beiden Namen und nennt die Gruppen beim Überfahren", () => {
    const entry = {
      country: "Guatemala", league: "Primera Division",
      tipicoCountries: ["Guatemala", "Guatemala"],
      tipicoLeagues: ["Primera Division, Apertura, Gruppe A", "Primera Division, Apertura, Gruppe B"]
    };
    expect(competitionLeague(entry, "tipico")).toBe("Primera Division, Apertura");
    expect(competitionLeague(entry, "api")).toBe("Primera Division");
    expect(competitionCountry({ country: "Italy", league: "Serie B", tipicoCountries: ["Italien"], tipicoLeagues: ["Serie B"] }, "tipico")).toBe("Italien");
    expect(competitionVariants(entry, "tipico")).toBe("Primera Division, Apertura, Gruppe A\nPrimera Division, Apertura, Gruppe B");
    expect(competitionVariants(entry, "api")).toBeUndefined();
    const italy = { country: "Italy", league: "Serie B", tipicoCountries: ["Italien"], tipicoLeagues: ["Serie B"] };
    expect(competitionMatches(italy, "italien")).toBe(true);
    expect(competitionMatches(italy, "italy serie")).toBe(true);
    expect(competitionMatches(entry, "gruppe b")).toBe(true);
    expect(competitionMatches(entry, "honduras")).toBe(false);
  });
});

describe("Suche über der Tabelle", () => {
  it("findet Mannschaft, Wettbewerb und Land unter beiden Namen", () => {
    expect(fixtureMatches(fixture, "katamon")).toBe(true);
    expect(fixtureMatches(fixture, "Hapoel Jerusalem")).toBe(true);
    expect(fixtureMatches(fixture, "ligat")).toBe(true);
    expect(fixtureMatches(fixture, "premier league")).toBe(true);
    expect(fixtureMatches(fixture, "ISRAEL")).toBe(true);
    expect(fixtureMatches(plain, "jerusalem")).toBe(false);
  });

  it("verlangt jedes Wort, egal wo, und übersieht Akzente", () => {
    expect(fixtureMatches(fixture, "israel haifa")).toBe(true);
    expect(fixtureMatches(fixture, "israel bayern")).toBe(false);
    expect(fixtureMatches({ ...plain, homeTeam: "Atlético Madrid" }, "atletico")).toBe(true);
    expect(fixtureMatches({ ...plain, homeTeam: "Atletico Madrid" }, "Atlético")).toBe(true);
  });

  it("lässt bei leerer Suche alles durch", () => {
    expect(fixtureMatches(plain, "")).toBe(true);
    expect(fixtureMatches(plain, "   ")).toBe(true);
  });
});
