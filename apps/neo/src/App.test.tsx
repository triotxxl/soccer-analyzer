import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { DOCUMENT, INSIGHTS } from "./testData";

const list = () => within(document.querySelector<HTMLElement>("section.panel.detail")!);
const serve = (body: unknown, status = 200) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/api/fixture/insights")
    ? new Response(JSON.stringify(INSIGHTS), { status: 200 })
    : new Response(JSON.stringify(body), { status })));

describe("Neo Dashboard", () => {
  // Die Spiele der Testdaten liegen am 27./28.10.2026; vorbei ist ein Spiel 120 Minuten nach Anpfiff.
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("zeigt Spiele nicht mehr, die vorbei sind", async () => {
    vi.setSystemTime(new Date("2026-10-27T19:00:00.000Z"));
    serve(DOCUMENT);
    render(<App />);
    expect(await screen.findByText("Dorf SV")).toBeInTheDocument();
    expect(list().queryByText("Leeds AFC")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Ansicht" });
    expect(within(nav).getByRole("button", { name: /Spiele/ })).toHaveTextContent("2");
  });

  it("zeigt die Spiele des Snapshots mit Zählern in der Navigation", async () => {
    serve(DOCUMENT);
    render(<App />);
    expect(await screen.findByText("Heim (Tipico)")).toBeInTheDocument();
    expect(list().getByText("Leeds AFC")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Ansicht" });
    expect(within(nav).getByRole("button", { name: /Spiele/ })).toHaveTextContent("3");
    expect(screen.getAllByText(/Datenlage 90/).length).toBeGreaterThan(0);
  });

  it("zeigt bei nicht belastbarem 1X2 keine Chance, aber die Tipico-Quoten", async () => {
    serve(DOCUMENT);
    render(<App />);
    const row = (await screen.findByText("Dorf SV")).closest("button")!;
    expect(row).toHaveTextContent("Die Stärke der beiden Ligen lässt sich nicht vergleichen");
    expect(row).not.toHaveTextContent("80 %");
    expect(row).toHaveTextContent("1,25");
  });

  it("zeigt das Elo neben den Teams, die Markierung „Klasse“ und rechts Elo und Liga-Niveau", async () => {
    serve(DOCUMENT);
    render(<App />);
    const row = (await screen.findByText("Dorf SV")).closest("button")!;
    expect(row).toHaveTextContent("1402");
    expect(row.querySelector(".elo.up")).toHaveTextContent("1872");
    expect(row.querySelector(".elo.thin")).toHaveTextContent("1402");
    expect(row).toHaveTextContent("Klasse ↓");
    fireEvent.click(row);
    const head = document.querySelector(".sh-elo")!;
    expect(head).toHaveTextContent("Heim FC klar stärker");
    expect(head).toHaveTextContent("Regionalliga Nord 1430");
    expect(head).toHaveTextContent("deutlicher Klassenunterschied zugunsten von Heim FC");
  });

  it("ordnet nach Anstoß oder nach Liga", async () => {
    serve(DOCUMENT);
    render(<App />);
    await screen.findAllByText("Leeds AFC");
    const times = () => [...document.querySelectorAll(".fx-time b")].map((b) => b.textContent);
    expect(times()).toEqual(["18:00", "20:30", "19:45"]);
    fireEvent.click(screen.getByRole("button", { name: "Nach Liga" }));
    expect(screen.getByText("Pokal", { selector: ".grp .tag" })).toBeInTheDocument();
  });

  it("filtert Wettbewerbe über die Kopfleiste", async () => {
    serve(DOCUMENT);
    render(<App />);
    await screen.findByText("Dorf SV");
    fireEvent.click(screen.getByRole("button", { name: /Wettbewerbe/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nur Ligen" }));
    expect(screen.queryByText("Dorf SV")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Wettbewerbe/ })).toHaveTextContent("2/3");
  });

  it("lässt den Fokus nach der Auswahl auf dem gewählten Spiel", async () => {
    serve(DOCUMENT);
    render(<App />);
    await screen.findAllByText("Leeds AFC");
    const row = list().getByText("Leeds AFC").closest("button")!;
    row.focus();
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(row);
    expect(screen.getByRole("heading", { name: /London FC/ })).toBeInTheDocument();
  });

  it("zeigt Teams aus den Ligatabellen und Modell-Tipps mit gesperrten Autoren", async () => {
    serve(DOCUMENT);
    render(<App />);
    await screen.findAllByText("Leeds AFC");
    fireEvent.click(screen.getByRole("button", { name: /Teams/ }));
    expect(list().getByText("Dritter SV")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Predictions/ }));
    expect(screen.getByRole("heading", { name: "Modell-Tipps" })).toBeInTheDocument();
    expect(screen.getAllByText("Chance laut Modell").length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: /Quelle/ }));
    expect(screen.getByRole("option", { name: /Autoren/ })).toBeDisabled();
    expect(screen.getByText(/rechne nicht mit Gewinn/)).toBeInTheDocument();
  });

  it("zeigt rechts die Marktchancen des gewählten Spiels", async () => {
    serve(DOCUMENT);
    render(<App />);
    await screen.findAllByText("Leeds AFC");
    const detail = within(document.querySelectorAll<HTMLElement>("section.panel")[1]!);
    expect(detail.getByRole("heading", { name: /London FC.*Leeds AFC/ })).toBeInTheDocument();
    const lead = document.querySelector(".sh-lead")!;
    expect(lead).toHaveTextContent("Leeds AFC gewinnt 60 %");
    expect(lead).toHaveTextContent("Über 2,5 Tore 71 %");
    expect(detail.getByRole("button", { name: /H2H/ })).toBeEnabled();
    expect(detail.getByRole("heading", { name: "Wer gewinnt" })).toBeInTheDocument();
    expect(detail.getByText("Erstes Tor").closest("article")).toHaveTextContent("53 %");
    // Torlinie 3,5 kommt ohne eigenen Markt aus der Torverteilung, ohne Quote.
    fireEvent.click(detail.getByRole("button", { name: "3,5" }));
    const ou = detail.getByText("Über / Unter").closest("article")!;
    expect(ou).toHaveTextContent("Über 3,530 %");
    expect(ou).toHaveTextContent("keine Quote");
    fireEvent.click(detail.getByText("Weitere Märkte"));
    expect(detail.getByText("1 : 1")).toBeInTheDocument();
    expect(detail.getByText(/rechne nicht mit Gewinn/)).toBeInTheDocument();
  });

  it("zeigt ohne belastbares 1X2 nur die Tormärkte und bei alten Analysen einen Hinweis", async () => {
    serve(DOCUMENT);
    render(<App />);
    fireEvent.click((await screen.findByText("Dorf SV")).closest("button")!);
    const detail = within(document.querySelectorAll<HTMLElement>("section.panel")[1]!);
    expect(detail.getByText("Endergebnis").closest("article")).toHaveTextContent("keine belastbare Chance");
    expect(detail.getByText("Gesamttore").closest("article")!.querySelector(".dist")).not.toBeNull();
    expect(document.querySelector(".sh-lead")).not.toHaveTextContent("gewinnt");
    fireEvent.click(list().getByText("Heim (Tipico)").closest("button")!);
    expect(detail.getByText("Erstes Tor").closest("article")).toHaveTextContent("Kommt mit der nächsten Analyse.");
    expect(detail.getByText("Endergebnis").closest("article")).toHaveTextContent("55 %");
  });

  it("zeigt im H2H-Reiter Duelle, Saison und Torphasen", async () => {
    serve(DOCUMENT);
    render(<App />);
    await screen.findAllByText("Leeds AFC");
    const detail = within(document.querySelectorAll<HTMLElement>("section.panel")[1]!);
    fireEvent.click(detail.getByRole("button", { name: "H2H" }));
    expect(document.querySelector(".sh-lead")).toHaveTextContent("London FC 2 Siege");
    expect(detail.getByRole("heading", { name: "Direkte Duelle (H2H) letzte 5" })).toBeInTheDocument();
    expect(detail.getByText("Über 2,5").closest(".hf")).toHaveTextContent("2 von 5");
    expect(detail.getAllByText(/Niederlage für London FC/).length).toBe(2);
    expect(detail.getAllByText("Premier League").length).toBeGreaterThan(0);
    expect(await detail.findAllByText("erzielt")).toHaveLength(4);
    expect(detail.getByText(/aktuell 2./)).toBeInTheDocument();
    fireEvent.click(detail.getByRole("button", { name: "Nur in London FC" }));
    expect(detail.getByText(/Nur 2 Duelle – die Anteile/)).toBeInTheDocument();
    expect(detail.getByText(/gilt unabhängig vom Filter oben/)).toBeInTheDocument();
  });

  it("ordnet Predictions nach Anstoß und zeigt zum Tipp das H2H", async () => {
    serve(DOCUMENT);
    render(<App />);
    await screen.findAllByText("Leeds AFC");
    fireEvent.click(screen.getByRole("button", { name: /Predictions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nach Anstoß" }));
    // Anstoß je Tag: London 17:00 UTC vor Heim FC 19:30 UTC, der Pokal am nächsten Tag
    expect([...document.querySelectorAll(".tip .fx-time")].map((e) => e.textContent)).toEqual(["18:00", "20:30", "19:45"]);
    fireEvent.click(list().getByText("London FC").closest("button")!);
    const detail = within(document.querySelectorAll<HTMLElement>("section.panel")[1]!);
    expect(detail.getByRole("heading", { name: /London FC.*Leeds AFC/ })).toBeInTheDocument();
    expect(detail.queryByRole("button", { name: "Marktchancen" })).toBeNull();
    expect(document.querySelector(".mk-meta")).toHaveTextContent("Tipp Über 2,5 Tore 71 %");
    expect(document.querySelector(".sh-lead")).toHaveTextContent("London FC 2 Siege");
    expect(detail.getByRole("heading", { name: "Direkte Duelle (H2H) letzte 5" })).toBeInTheDocument();
  });

  it("meldet, wenn noch keine Analyse vorhanden ist", async () => {
    serve({}, 404);
    render(<App />);
    expect(await screen.findByText(/Noch keine Analyse vorhanden/)).toBeInTheDocument();
  });
});
