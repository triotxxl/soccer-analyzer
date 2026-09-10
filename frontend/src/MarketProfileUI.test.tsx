import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMarketProfile, type MarketObservation } from "../../src/market-profile";
import { MarketProfileView } from "./MarketProfileUI";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function observations(marketKey: string, label: string, n: number, wins: number, probability: number, odds: number): MarketObservation[] {
  return Array.from({ length: n }, (_unused, index) => ({
    marketKey,
    marketLabel: label,
    kickoff: `2026-03-${String(1 + Math.floor(index / 40)).padStart(2, "0")}T18:00:00+01:00`,
    probability,
    odds,
    edge: probability - 1 / odds,
    hit: ((index * wins) % n < wins ? 1 : 0) as 0 | 1
  }));
}

function stubProfile() {
  const profile = buildMarketProfile([
    ...observations("draw", "Remis", 200, 40, 0.3, 4),
    ...observations("over25", "Über 2,5", 160, 80, 0.6, 2)
  ]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(profile)
  }));
  return profile;
}

describe("Marktprofil-Ansicht", () => {
  it("zeigt je Markt, was das Modell sagt und was eingetreten ist", async () => {
    stubProfile();
    render(<MarketProfileView />);

    await waitFor(() => expect(screen.getByText("Remis")).toBeInTheDocument());
    expect(screen.getByText("Über 2,5")).toBeInTheDocument();
    // Die Kopfzeile nennt die Datenbasis.
    expect(screen.getByText(/abgerechnete Marktzeilen/)).toBeInTheDocument();
    // Und die Gesamtaussage steht als Satz da, nicht nur als Zahl in einer Zelle.
    expect(screen.getByText(/Selbstüberschätzung/)).toBeInTheDocument();
  });

  it("klappt die Aufschlüsselung nach Vorteilsband auf", async () => {
    stubProfile();
    render(<MarketProfileView />);
    await waitFor(() => expect(screen.getByText("Remis")).toBeInTheDocument());

    // Alle Remis-Zeilen liegen bei fünf Punkten Vorteil, also gibt es genau dieses eine Band.
    expect(screen.queryByText("3-7 PP")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Remis"));
    expect(screen.getByText("3-7 PP")).toBeInTheDocument();
  });

  it("sagt es klar, wenn noch nichts abgerechnet ist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "insufficient_data" })
    }));
    render(<MarketProfileView />);
    await waitFor(() => expect(screen.getByText(/keine Partien abgerechnet/)).toBeInTheDocument());
  });
});
