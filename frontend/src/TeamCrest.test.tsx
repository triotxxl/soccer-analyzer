import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TeamCrest } from "./TeamCrest";

describe("TeamCrest", () => {
  afterEach(cleanup);

  it("zeigt das Wappen und behält die mitgegebene Zusatzklasse", () => {
    const { container } = render(<TeamCrest name="Alpha FC" logo="https://media.example/33.png" className="period-crest" />);
    const crest = container.querySelector("img")!;
    expect(crest).toHaveAttribute("src", "https://media.example/33.png");
    expect(crest).toHaveClass("team-crest", "period-crest");
  });

  it("fällt ohne URL auf die Initialen zurück", () => {
    render(<TeamCrest name="Gast FC" />);
    expect(screen.getByText("GA")).toHaveClass("fallback");
  });

  it("fällt auf die Initialen zurück, wenn das Bild nicht lädt", () => {
    const { container } = render(<TeamCrest name="Alpha FC" logo="https://media.example/33.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("versucht das Wappen der nächsten Mannschaft erneut", () => {
    const { container, rerender } = render(<TeamCrest name="Alpha FC" logo="https://media.example/33.png" />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<TeamCrest name="Gast FC" logo="https://media.example/44.png" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://media.example/44.png");
  });
});
