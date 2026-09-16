import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { KellyDialog } from "./KellyUI";
import { DEFAULT_KELLY_SETTINGS, type KellySettings } from "./kelly";
import { buildMarketProfile } from "../../src/market-profile";
import type { DashboardFixture, MarketProfile } from "./types";

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
  return <KellyDialog
    fixtures={[fixture()]}
    marketFilter="all"
    marketLabel="Alle Märkte"
    settings={settings}
    profile={profile}
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
    const input = field("Mindest-Edge (PP)");
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
    const input = field("Max. Risiko/Spiel (%)");
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
    expect(field("Max. Risiko/Spiel (%)").value).toBe("7");
  });

  it("sperrt das Spiel-Limit-Feld, solange das Limit aus ist", async () => {
    render(<Harness initial={{ enableGameRiskLimit: false }} />);
    await openSettings();
    expect(field("Max. Risiko/Spiel (%)")).toBeDisabled();
  });
});

describe("Aufbau des Dialogs", () => {
  it("zeigt Einsatz, Wettanzahl und erwarteten Ertrag ohne jedes Aufklappen", () => {
    render(<Harness />);
    expect(screen.getByText("Einsatz gesamt")).toBeInTheDocument();
    expect(screen.getByText("Wetten")).toBeInTheDocument();
    expect(screen.getByText("Erwarteter Ertrag")).toBeInTheDocument();
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
    expect(screen.queryByText(/ungedeckelte Wert/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Was bedeuten diese Zahlen?" }));
    expect(screen.getByText(/ungedeckelte Wert/)).toBeInTheDocument();
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
    expect(screen.getByLabelText(/Kelly-Fraktion/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mindest-Edge (PP)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cross-League ausschließen")).not.toBeInTheDocument();
  });

  it("lässt sich auf die manuelle Einstellung zurückschalten", async () => {
    render(<Harness profile={profileFor("btts")} auto />);
    await openSettings();
    expect(screen.queryByLabelText("Mindest-Edge (PP)")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Manuell" }));
    expect(screen.getByLabelText("Mindest-Edge (PP)")).toBeInTheDocument();
  });

  it("begründet, warum die Korrektur greift", async () => {
    render(<Harness profile={profileFor("btts")} auto />);
    expect(screen.getByText(/abgerechneten Zeilen/)).toBeInTheDocument();
    // Wie belastbar die Korrektur ist, steht hinter einem eigenen Aufklapper.
    expect(screen.queryByText(/nicht als gewinnbringend nachgewiesen/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wie die Korrektur zustande kommt" }));
    expect(screen.getByText(/nicht als gewinnbringend nachgewiesen/)).toBeInTheDocument();
  });

  it("sperrt die Automatik, solange kein Profil vorliegt", async () => {
    render(<Harness profile={null} auto />);
    expect(screen.getByRole("button", { name: "Automatik" })).toBeDisabled();
    // Ohne Messung bleibt der manuelle Modus aktiv, statt eine Empfehlung vorzutäuschen.
    await openSettings();
    expect(screen.getByLabelText("Mindest-Edge (PP)")).toBeInTheDocument();
  });
});
