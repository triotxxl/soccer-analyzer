import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { KellyDialog } from "./KellyUI";
import { DEFAULT_KELLY_SETTINGS, type KellySettings } from "./kelly";
import type { DashboardFixture } from "./types";

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
function Harness({ initial, onChange }: { initial?: Partial<KellySettings>; onChange?(settings: KellySettings): void }) {
  const [settings, setSettings] = useState<KellySettings>({ ...DEFAULT_KELLY_SETTINGS, ...initial });
  return <KellyDialog
    fixtures={[fixture()]}
    marketFilter="all"
    marketLabel="Alle Märkte"
    settings={settings}
    onSettingsChange={(next) => { setSettings(next); onChange?.(next); }}
    onClose={() => undefined}
  />;
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe("Kelly-Eingabefelder", () => {
  it("lässt sich leeren, ohne dass der alte Wert zurückspringt", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ minEdge: 0 }} />);
    const input = field("Mindest-Edge (PP)");
    expect(input.value).toBe("0");

    await user.clear(input);
    expect(input.value).toBe("");
  });

  it("nimmt nach dem Leeren eine neue Zahl an", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ budget: 100 }} />);
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
    const input = field("Budget (€)");

    await user.clear(input);
    await user.tab();
    expect(input.value).toBe("250");
  });

  it("klemmt erst beim Verlassen, nicht schon beim Tippen", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ minOdds: 1.5 }} />);
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
    const input = field("Max. Risiko/Spiel (%)");
    expect(input.value).toBe("5");

    await user.clear(input);
    await user.type(input, "7");
    await user.tab();
    expect(input.value).toBe("7");
    expect(latest!.maxRiskPerGame).toBeCloseTo(0.07);
  });

  it("zeigt Prozentwerte ohne Float-Rest an", () => {
    render(<Harness initial={{ maxRiskPerGame: 0.07 }} />);
    // 0.07 * 100 ergibt 7.000000000000001 - im Feld darf das nicht auftauchen.
    expect(field("Max. Risiko/Spiel (%)").value).toBe("7");
  });

  it("sperrt das Spiel-Limit-Feld, solange das Limit aus ist", () => {
    render(<Harness initial={{ enableGameRiskLimit: false }} />);
    expect(field("Max. Risiko/Spiel (%)")).toBeDisabled();
  });
});
