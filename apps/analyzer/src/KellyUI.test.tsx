import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { concentrationNotice, KellyDialog, kellyProfileNote } from "./KellyUI";
import { DEFAULT_KELLY_SETTINGS, selectKelly, type KellyCandidate, type KellySettings } from "./kelly";
import { buildMarketProfile } from "../../../src/market-profile";
import type { DashboardFixture, MarketProfile } from "../../shared/src/types";

afterEach(cleanup);

function fixture(): DashboardFixture {
  return {
    fixtureId: 1, kickoff: "2026-08-24T18:00:00.000Z", country: "Land", league: "Liga",
    homeTeam: "Alpha", awayTeam: "Beta", modelVersion: "test", crossLeague: false, dataConfidence: 85,
    warnings: [], h2hNotice: null,
    form: { scope: "venue", home: [], away: [], homeMatches: [], awayMatches: [] },
    h2h: { outcomes: [], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    expectedGoals: { home: 1.4, away: 1.1, total: 2.5 }, scores: { favorite: null, draw: null },
    markets: [{
      key: "btts", label: "BTTS", selection: "Beide treffen", pick: null, selectionTone: "neutral",
      probability: 0.6, odds: 1.9, confidence: 85, score: null,
      recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
    }]
  };
}

/** Der Dialog ist kontrolliert - für Eingabetests braucht er einen Halter für die Settings. */
function Harness({ initial, onChange, profile = null, auto = false }: {
  initial?: Partial<KellySettings>;
  onChange?(settings: KellySettings): void;
  profile?: MarketProfile | null;
  auto?: boolean;
}) {
  const [settings, setSettings] = useState<KellySettings>({ ...DEFAULT_KELLY_SETTINGS, ...initial });
  const [automatic, setAutomatic] = useState(auto);
  // Wie im Dashboard: gerechnet wird außerhalb, der Dialog zeigt nur an.
  const selection = selectKelly([fixture()], "all", settings, automatic, profile);
  return <KellyDialog
    selection={selection}
    profileState={profile === null
      ? { status: "error", profile: null, message: null }
      : { status: "ready", profile, message: null }}
    marketFilter="all"
    marketLabel="Alle Märkte"
    settings={settings}
    auto={automatic}
    onAutoChange={setAutomatic}
    onSettingsChange={(next) => { setSettings(next); onChange?.(next); }}
    onClose={() => undefined}
  />;
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

/**
 * Die Regler liegen hinter einem Aufklapper, weil im Dialog erst das Ergebnis steht und dann
 * die Einstellung. Für Eingabetests muss das Panel deshalb zuerst geöffnet werden.
 */
async function openSettings(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: /^Einstellungen/ }));
}

describe("Kelly-Eingabefelder", () => {
  it("lässt sich leeren, ohne dass der alte Wert zurückspringt", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ minEdge: 0 }} />);
    await openSettings();
    const input = field("Mindest-Vorteil (Edge, Prozentpunkte)");
    expect(input.value).toBe("0");

    await user.clear(input);
    expect(input.value).toBe("");
  });

  it("nimmt nach dem Leeren eine neue Zahl an", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ budget: 100 }} />);
    await openSettings();
    const input = field("Budget (€)");

    await user.clear(input);
    await user.type(input, "126.75");
    expect(input.value).toBe("126.75");
    await user.tab();
    expect(input.value).toBe("126.75");
  });

  it("stellt beim Verlassen eines leer gelassenen Feldes den vorherigen Wert wieder her", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ budget: 250 }} />);
    await openSettings();
    const input = field("Budget (€)");

    await user.clear(input);
    await user.tab();
    expect(input.value).toBe("250");
  });

  it("klemmt erst beim Verlassen, nicht schon beim Tippen", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ minOdds: 1.5 }} />);
    await openSettings();
    const input = field("Mindestquote");

    await user.clear(input);
    await user.type(input, "1");
    // Während des Tippens bleibt die 1 stehen, obwohl das Minimum 1,01 ist.
    expect(input.value).toBe("1");
    await user.tab();
    expect(input.value).toBe("1.01");
  });

  it("meldet Prozentfelder als Anteil zurück", async () => {
    const user = userEvent.setup();
    let latest: KellySettings | null = null;
    render(<Harness initial={{ maxRiskPerGame: 0.05 }} onChange={(next) => { latest = next; }} />);
    await openSettings();
    const input = field("Grenze je Spiel (% vom Budget)");
    expect(input.value).toBe("5");

    await user.clear(input);
    await user.type(input, "7");
    await user.tab();
    expect(input.value).toBe("7");
    expect(latest!.maxRiskPerGame).toBeCloseTo(0.07);
  });

  it("zeigt Prozentwerte ohne Float-Rest an", async () => {
    render(<Harness initial={{ maxRiskPerGame: 0.07 }} />);
    await openSettings();
    // 0.07 * 100 ergibt 7.000000000000001 - im Feld darf das nicht auftauchen.
    expect(field("Grenze je Spiel (% vom Budget)").value).toBe("7");
  });

  it("sperrt das Feld der Grenze je Spiel, solange sie aus ist", async () => {
    render(<Harness initial={{ enableGameRiskLimit: false }} />);
    await openSettings();
    expect(field("Grenze je Spiel (% vom Budget)")).toBeDisabled();
  });
});

describe("Aufbau des Dialogs", () => {
  it("zeigt Einsatz, Wettanzahl und was auf Dauer zu erwarten ist, ohne jedes Aufklappen", () => {
    render(<Harness />);
    expect(screen.getByText("Einsatz gesamt")).toBeInTheDocument();
    expect(screen.getByText("Wetten")).toBeInTheDocument();
    expect(screen.getByText("Auf Dauer")).toBeInTheDocument();
  });

  it("fasst die Einstellungen zusammen, statt sie auszubreiten", () => {
    render(<Harness initial={{ budget: 500, minOdds: 1.35 }} />);
    expect(screen.queryByLabelText("Budget (€)")).not.toBeInTheDocument();
    const head = screen.getByRole("button", { name: /^Einstellungen/ });
    expect(head).toHaveTextContent("Budget 500,00 €");
    expect(head).toHaveTextContent("Quote ab 1,35");
  });

  it("erklärt die Begriffe erst auf Nachfrage", async () => {
    render(<Harness />);
    expect(screen.queryByText(/nach allen deinen Grenzen/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Was bedeuten diese Zahlen?" }));
    expect(screen.getByText(/nach allen deinen Grenzen/)).toBeInTheDocument();
  });

  /**
   * Die Wetten stehen im Dialog, nicht in der Übersicht (Davids Entscheidung vom 29.09.2026;
   * vom 28.09. an standen sie einen Tag lang in der Tabelle).
   */
  it("führt die Liste der Wetten selbst", () => {
    render(<Harness initial={{ minEdge: 0 }} />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("button", { name: /^Einsatz/ })).toBeInTheDocument();
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.queryByText(/Spalte „Kelly-Einsatz“/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auswahl als JSON exportieren" })).toBeEnabled();
  });

  /**
   * Bis 06.10.2026 stand hier „Erwarteter Ertrag“ zur korrigierten Modellchance (rund +10 %),
   * eingetreten waren rund -6 %. Jetzt zählt der faire Tipico-Preis - ohne Aufschlag ein Minus.
   */
  it("rechnet „Auf Dauer“ zum fairen Tipico-Preis, färbt es nicht und sagt, dass das Modell nicht besser trifft", () => {
    render(<Harness initial={{ minEdge: 0 }} />);
    const value = screen.getByText("Auf Dauer").parentElement!;
    expect(value.querySelector(".kelly-metric-good, .kelly-metric-bad")).toBeNull();
    expect(value).toHaveTextContent("zur Tipico-Quote ohne Aufschlag, teils geschätzt.");
    expect(value).toHaveTextContent("Das Modell trifft geprüft nicht öfter als die Quote.");
    expect(value).toHaveTextContent("−");
  });
});

describe("Automatik-Modus", () => {
  /** Ein Markt, der 60 % behauptet und 45 % erreicht - die Quote 1,9 verlangt 52,6 %. */
  function profileFor(marketKey: string, n = 200, wins = 90, probability = 0.6, odds = 1.9): MarketProfile {
    return buildMarketProfile(Array.from({ length: n }, (_unused, index) => ({
      marketKey,
      marketLabel: "BTTS",
      kickoff: `2026-03-${String(1 + Math.floor(index / 40)).padStart(2, "0")}T18:00:00+01:00`,
      probability,
      odds,
      edge: probability - 1 / odds,
      hit: ((index * wins) % n < wins ? 1 : 0) as 0 | 1
    })));
  }

  it("setzt mit einem Klick alle Einstellungen des Testbetriebs", async () => {
    // Genau die Konstellation, die die alte Kette verhagelt hat: Rahmen auf 100 %, Budget
    // aus einem früheren Lauf, volle Kelly-Fraktion.
    let latest: KellySettings | null = null;
    render(<Harness auto profile={profileFor("btts")} onChange={(next) => { latest = next; }}
      initial={{ budget: 126.26, kellyFraction: 1, maxExposurePercent: 1, maxStakePercent: 0.03 }} />);

    await userEvent.click(screen.getByRole("button", { name: "Testbetrieb übernehmen" }));

    expect(latest).toMatchObject({
      budget: 100, kellyFraction: 0.25, maxStakePercent: 0.02, maxExposurePercent: 0.7,
      minStake: 1, maxBets: null
    });
    // Danach meldet der Knopf den Zustand, statt ihn erneut anzubieten.
    expect(screen.getByRole("button", { name: "Testbetrieb aktiv" })).toBeDisabled();
  });

  it("nennt die Stückzahl, die der Einsatzrahmen zulässt", () => {
    render(<Harness auto profile={profileFor("btts")}
      initial={{ maxExposurePercent: 0.7, maxStakePercent: 0.02 }} />);
    // 0,70 / 0,02 = 35 - die Zahl, die tatsächlich bindet, nicht die 70 zum Mindesteinsatz.
    expect(screen.getByRole("button", { name: /^Einstellungen/ })).toHaveTextContent("35 Plätze");
  });

  it("nennt in der Zusammenfassung Budget, Fraktion und den geerbten Einsatzrahmen", () => {
    render(<Harness profile={profileFor("btts")} auto />);
    const head = screen.getByRole("button", { name: /^Einstellungen/ });
    expect(head).toHaveTextContent("1/4 Kelly");
    // Die Auswahlregler gehören in der Automatik nicht dem Nutzer, also stehen sie auch nicht da.
    expect(head).not.toHaveTextContent("Quote ab");
    // Der Einsatzrahmen dagegen bleibt seiner - und muss deshalb sichtbar sein. Er wird aus
    // der manuellen Einstellung geerbt und stand in den Läufen bis zum 15.09.2026 unbemerkt
    // auf 100 % statt auf der Vorgabe 25 %.
    expect(head).toHaveTextContent("Einsatzrahmen");
  });

  it("zeigt aufgeklappt nur Budget und Fraktion, nicht die Auswahlregler", async () => {
    render(<Harness profile={profileFor("btts")} auto />);
    await openSettings();
    expect(field("Budget (€)")).toBeInTheDocument();
    // Das Feld traegt einen Erklaertext, der in den zugaenglichen Namen einfliesst.
    expect(screen.getByLabelText(/Kelly-Anteil/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mindest-Vorteil (Edge, Prozentpunkte)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cross-League ausschließen")).not.toBeInTheDocument();
  });

  it("lässt sich auf die manuelle Einstellung zurückschalten", async () => {
    render(<Harness profile={profileFor("btts")} auto />);
    await openSettings();
    expect(screen.queryByLabelText("Mindest-Vorteil (Edge, Prozentpunkte)")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Manuell" }));
    expect(screen.getByLabelText("Mindest-Vorteil (Edge, Prozentpunkte)")).toBeInTheDocument();
  });

  it("begründet, warum die Korrektur greift", async () => {
    render(<Harness profile={profileFor("btts")} auto />);
    // Die Grundmenge der Korrektur sind die Spiele mit Vorteil, nicht alle Zeilen.
    expect(screen.getByText(/alten Spielen mit Vorteil wirklich/)).toBeInTheDocument();
    // Wie belastbar die Korrektur ist, steht hinter einem eigenen Aufklapper.
    expect(screen.queryByText(/rechne\s+nicht mit Gewinn/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Woher die Korrektur kommt" }));
    // Stand 21.09.2026: im Minus, nicht "etwa bei null".
    expect(screen.getByText(/liegt diese Auswahl im Minus/)).toBeInTheDocument();
    expect(screen.getByText(/rechne\s+nicht mit Gewinn/)).toBeInTheDocument();
    expect(screen.getByText(/Tipico-Quote ohne Aufschlag\s+es erwarten ließ/)).toBeInTheDocument();
  });

  /**
   * Bis 06.10.2026 zeigten die Schildchen die Abweichung des ganzen Marktes - bei BTTS Nein
   * „−3,7“, während die gewählten Wetten um +2,8 Punkte angehoben wurden.
   */
  it("zeigt in den Schildchen die Korrektur, die bei den gewählten Wetten angewandt wurde", () => {
    // 60 % behauptet, 65 % eingetreten: Die Korrektur hebt um 5 Punkte an.
    render(<Harness profile={profileFor("btts", 200, 130)} auto />);
    const chips = screen.getByText("Gespielt wird").parentElement!;
    expect(chips).toHaveTextContent("+5,0 PP");
  });

  /** Davids Entscheidung vom 06.10.2026: Die Marktabwahl gilt auch in der Automatik. */
  it("bietet die Marktabwahl auch in der Automatik an, und sie wirkt", async () => {
    let latest: KellySettings | null = null;
    render(<Harness profile={profileFor("btts", 200, 130)} auto onChange={(next) => { latest = next; }} />);
    expect(screen.getByRole("table")).not.toHaveTextContent("Keine Wette in der Auswahl");
    await openSettings();
    await userEvent.click(screen.getByRole("checkbox", { name: "BTTS" }));
    expect(latest!.disabledMarkets).toContain("btts");
    expect(screen.getByRole("table")).toHaveTextContent("Keine Wette in der Auswahl");
  });

  it("unterscheidet Laden, Fehler und fehlende Messung", () => {
    expect(kellyProfileNote(true, { status: "loading", profile: null, message: null })).toBe("Automatik wird geladen …");
    expect(kellyProfileNote(true, { status: "error", profile: null, message: "Es gibt noch keine Datenbank." }))
      .toBe("Manuell – Es gibt noch keine Datenbank.");
    expect(kellyProfileNote(true, { status: "error", profile: null, message: null }))
      .toBe("Manuell – für die Automatik fehlen abgerechnete Spiele.");
    // Manuell gewählt: kein Hinweis, es fehlt ja nichts.
    expect(kellyProfileNote(false, { status: "error", profile: null, message: null })).toBeNull();
  });

  it("sperrt die Automatik, solange kein Profil vorliegt", async () => {
    render(<Harness profile={null} auto />);
    expect(screen.getByRole("button", { name: "Automatik" })).toBeDisabled();
    expect(screen.getByText("Manuell – für die Automatik fehlen abgerechnete Spiele.")).toBeInTheDocument();
    // Ohne Messung bleibt der manuelle Modus aktiv, statt eine Empfehlung vorzutäuschen.
    await openSettings();
    expect(screen.getByLabelText("Mindest-Vorteil (Edge, Prozentpunkte)")).toBeInTheDocument();
  });
});

describe("Häufung auf einem Markt", () => {
  function candidate(marketKey: string, marketLabel: string, calibrationBias: number | null): KellyCandidate {
    return { marketKey, marketLabel, calibrationBias } as unknown as KellyCandidate;
  }

  it("benennt es, wenn fast die ganze Liste ein angehobener Markt ist", () => {
    const list = [
      ...Array.from({ length: 5 }, () => candidate("bttsNo", "BTTS Nein", 0.028)),
      candidate("over25", "Über 2,5", -0.08), candidate("btts", "BTTS", -0.05)
    ];
    expect(concentrationNotice(list)).toBe("5 von 7 Wetten sind BTTS Nein, und ihre Chance wurde nach oben"
      + " korrigiert. Liegt das Modell dort falsch, trifft es fast alle Wetten zugleich.");
  });

  it("schweigt bei gemischter Liste oder gesenkter Chance", () => {
    expect(concentrationNotice([
      candidate("bttsNo", "BTTS Nein", 0.03), candidate("bttsNo", "BTTS Nein", 0.03),
      candidate("over25", "Über 2,5", -0.08), candidate("btts", "BTTS", -0.05)
    ])).toBeNull();
    expect(concentrationNotice(Array.from({ length: 6 }, () => candidate("over25", "Über 2,5", -0.08)))).toBeNull();
  });
});
