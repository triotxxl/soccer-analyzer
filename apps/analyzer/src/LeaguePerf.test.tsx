import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardFixture } from "../../shared/src/types";
import { LeaguePerfPanel } from "./LeaguePerf";

const row = (teamName: string, positions: number[], previousPositions?: number[], goalDiffs?: number[]) =>
  ({ teamName, position: positions.at(-1)!, positions, previousPositions, goalDiffs }) as unknown as NonNullable<DashboardFixture["table"]>[number];
const fixture = (table?: ReturnType<typeof row>[]) =>
  ({ fixtureId: 1, homeTeam: "Heim FC", awayTeam: "Gast SV", country: "Land", league: "Liga", table }) as unknown as DashboardFixture;

describe("Tabellenverlauf bei den direkten Duellen", () => {
  afterEach(cleanup);
  it("zeigt darunter den Tordifferenz-Verlauf mit demselben Zeitraum", () => {
    const game = fixture([
      row("Heim FC", [6, 5, 4, 3, 2, 1], undefined, [-1, 0, 2, 3, 5, 8]),
      row("Gast SV", [1, 2, 3, 4, 5, 6], undefined, [2, 1, 1, 0, -2, -4])
    ]);
    render(<LeaguePerfPanel fixture={game} fixtures={[game]} homeName="Heim" awayName="Gast" />);
    const panel = screen.getByRole("region", { name: "Tordifferenz-Verlauf" });
    expect(panel).toHaveTextContent("Tore minus Gegentore nach Spieltag");
    expect(panel).toHaveTextContent("Heim aktuell +8 · im Zeitraum +8");
    expect(panel).toHaveTextContent("Gast aktuell −4 · im Zeitraum −4");
    fireEvent.click(screen.getByRole("button", { name: "Letzte 5" }));
    expect(panel).toHaveTextContent("Heim aktuell +8 · im Zeitraum +9");
  });

  it("sagt, wenn der Snapshot noch keine Tordifferenz führt", () => {
    const game = fixture([row("Heim FC", [2, 1]), row("Gast SV", [1, 2])]);
    render(<LeaguePerfPanel fixture={game} fixtures={[game]} homeName="Heim" awayName="Gast" />);
    expect(screen.getByRole("region", { name: "Tordifferenz-Verlauf" })).toHaveTextContent("erscheint nach der nächsten Analyse");
  });

  it("zeigt beide Teams mit Platz und Entwicklung, mit dem Namen nach Einstellung", () => {
    const game = fixture([row("Heim FC", [6, 5, 4, 3, 2, 1], [8, 7]), row("Gast SV", [1, 2, 3, 4, 5, 6])]);
    render(<LeaguePerfPanel fixture={game} fixtures={[game]} homeName="Heim" awayName="Gast" />);
    expect(screen.getByRole("region", { name: "Tabellenverlauf" })).toHaveTextContent("Platz nach Spieltag");
    expect(screen.getByText(/aktuell 1\. · bester 1\. · schlechtester 6\. · im Zeitraum 5 Plätze besser/)).toBeInTheDocument();
    expect(screen.getByText(/aktuell 6\. · bester 1\. · schlechtester 6\. · im Zeitraum 5 Plätze schlechter/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Letzte 5" }));
    expect(screen.getByText(/aktuell 1\. · bester 1\. · schlechtester 5\. · im Zeitraum 4 Plätze besser/)).toBeInTheDocument();

    // Die letzte Saison ersetzt die laufende, beide zusammen gibt es nicht.
    expect(screen.getByRole("button", { name: "Diese Saison" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Letzte Saison" }));
    expect(screen.getByText(/am Ende 7\./)).toBeInTheDocument();
    expect(screen.queryByText(/aktuell 1\./)).not.toBeInTheDocument();
    expect(screen.getByText("Gast: letzte Saison nicht in dieser Liga, zum Beispiel Aufsteiger.")).toBeInTheDocument();
  });

  it("sagt, wenn die Liga nicht in der Analyse ist, und blendet die Bedienung aus", () => {
    const game = fixture();
    render(<LeaguePerfPanel fixture={game} fixtures={[game]} homeName="Heim" awayName="Gast" />);
    expect(screen.getByText(/Kein Tabellenverlauf/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saison" })).not.toBeInTheDocument();
  });
});
