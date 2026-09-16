import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickpickButton, QuickpickChip, QuickpickDialog } from "./QuickpickUI";
import { DEFAULT_QUICKPICK_SETTINGS, DEFAULT_UNDERDOG_SETTINGS, type DavesQuickpickSettings, type QuickpickPresetId, type QuickpickSettings } from "./quickpick";
import type { DashboardFixture } from "./types";

afterEach(cleanup);

function fixture(id: number, home: string, away: string, favorite: number): DashboardFixture {
  return {
    fixtureId: id, kickoff: "2026-09-20T18:00:00.000Z", country: "Land", league: "Liga",
    homeTeam: home, awayTeam: away, modelVersion: "test", crossLeague: false,
    dataConfidence: 85, warnings: [], h2hNotice: null,
    form: {
      scope: "venue",
      home: ["win", "win", "win", "win", "loss"],
      away: ["loss", "loss", "loss", "draw", "loss"],
      homeMatches: [], awayMatches: []
    },
    h2h: { outcomes: ["win", "win", "loss"], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
    table: [
      { position: 1, teamName: home, played: 10, wins: 8, draws: 1, losses: 1, points: 25, goalsFor: 25, goalsAgainst: 8 },
      { position: 8, teamName: away, played: 10, wins: 3, draws: 1, losses: 6, points: 10, goalsFor: 10, goalsAgainst: 18 }
    ],
    expectedGoals: { home: 1.8, away: 0.9, total: 2.7 },
    scores: { favorite, draw: 20 },
    markets: [{
      key: "1x2", label: "1X2", selection: home, pick: "1", selectionTone: "home",
      probability: 0.62, odds: 1.75, confidence: 82, score: favorite,
      recommendation: { level: "recommended", label: "Empfehlenswert" }, details: []
    }]
  };
}

/** Eine Partie, die am Formtor scheitert - sie füllt die Abweisungsbilanz. */
function balanced(id: number): DashboardFixture {
  const base = fixture(id, "Gamma", "Delta", 75);
  return { ...base, form: { ...base.form, away: ["win", "win", "win", "win", "loss"] } };
}

/** Der Dialog ist kontrolliert - für Eingabetests braucht er einen Halter. */
function Harness({ fixtures, initial, preset = "daves1x2", active = false, onActiveChange, onAddAll, onAddOne }: {
  fixtures: DashboardFixture[];
  initial?: Partial<DavesQuickpickSettings>;
  preset?: QuickpickPresetId;
  active?: boolean;
  onActiveChange?(active: boolean): void;
  onAddAll?(hits: DashboardFixture[]): void;
  onAddOne?(row: { evaluation: { side: "1" | "2" | null } }): void;
}) {
  const [settings, setSettings] = useState<QuickpickSettings>(
    preset === "underdog" ? DEFAULT_UNDERDOG_SETTINGS : { ...DEFAULT_QUICKPICK_SETTINGS, ...initial });
  const [isActive, setActive] = useState(active);
  return <QuickpickDialog
    fixtures={fixtures}
    settings={settings}
    active={isActive}
    onSettingsChange={setSettings}
    onPresetChange={(next) => setSettings(next === "underdog" ? DEFAULT_UNDERDOG_SETTINGS : DEFAULT_QUICKPICK_SETTINGS)}
    onActiveChange={(next) => { setActive(next); onActiveChange?.(next); }}
    onAddAll={(hits) => onAddAll?.(hits)}
    onAddOne={(row) => onAddOne?.(row)}
    onClose={() => undefined}
  />;
}

async function openSettings(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: /^Einstellungen/ }));
}

describe("QuickpickButton", () => {
  it("meldet den Klick nach oben", async () => {
    const onOpen = vi.fn();
    render(<QuickpickButton active={false} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("zeigt am Knopf selbst, dass gefiltert wird", () => {
    render(<QuickpickButton active onOpen={() => undefined} />);
    expect(screen.getByRole("button", { name: "Quickpicker öffnen" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("QuickpickChip", () => {
  it("nennt Treffer und geprüfte Partien", () => {
    render(<QuickpickChip label="Daves 1x2-Filter" passed={4} evaluated={201}
      onOpen={() => undefined} onClear={() => undefined} />);
    expect(screen.getByText(/Daves 1x2-Filter · 4 von 201/)).toBeInTheDocument();
  });

  /**
   * Das ✕ nimmt den Filter zurück, statt das Panel zu öffnen: Ein Filter, der sich nur über
   * einen Umweg abschalten lässt, bleibt versehentlich an.
   */
  it("hebt den Filter mit einem Klick auf, ohne das Panel zu öffnen", async () => {
    const onClear = vi.fn();
    const onOpen = vi.fn();
    render(<QuickpickChip label="Daves 1x2-Filter" passed={4} evaluated={201}
      onOpen={onOpen} onClear={onClear} />);
    await userEvent.click(screen.getByRole("button", { name: "Quickpick-Filter aufheben" }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("QuickpickDialog", () => {
  it("nennt die Voreinstellung mit allen Kriterien", () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    // Der Name steht zweimal: einmal im Auswahlknopf, einmal in der Karte darunter.
    expect(screen.getByRole("button", { name: "Daves 1x2-Filter" })).toBeInTheDocument();
    expect(screen.getByText(/Tabelle: Vorsprung bei Platz/)).toBeInTheDocument();
    expect(screen.getByText(/Remis zählen als kein Verlust/)).toBeInTheDocument();
    expect(screen.getByText(/keine Niederlagenserie/)).toBeInTheDocument();
    expect(screen.getByText(/Favoritenpunkte des Modells/)).toBeInTheDocument();
    expect(screen.getByText(/Quote ab 1,30/)).toBeInTheDocument();
  });

  /**
   * Die Ehrlichkeitszusage ist Teil der Oberfläche, nicht nur der Dokumentation: Die
   * Rückrechnung trägt ein halbes Sigma, und das darf nicht stillschweigend verschwinden.
   */
  it("nennt die Trefferquote je Bein als Hinweis, nicht als Beleg", () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(screen.getByText(/Hinweis, kein Beleg/)).toBeInTheDocument();
    expect(screen.getByText("Treffer je Bein")).toBeInTheDocument();
  });

  it("zeigt den Tabellenvorsprung der getippten Seite", () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(screen.getByText("Alpha – Beta")).toBeInTheDocument();
    expect(screen.getByText("+1,50 P")).toBeInTheDocument();
    expect(screen.getByText(/1\. gegen 8\./)).toBeInTheDocument();
  });

  it("schaltet den Filter an und wieder aus", async () => {
    const onActiveChange = vi.fn();
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} onActiveChange={onActiveChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter anwenden" }));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Filter aufheben" }));
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  /** Der Weg, für den der Filter gedacht ist: Treffer in den Wettschein, dort Kombis bauen. */
  it("legt alle Treffer auf einmal in den Wettschein", async () => {
    const onAddAll = vi.fn();
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75), balanced(2)]} onAddAll={onAddAll} />);
    await userEvent.click(screen.getByRole("button", { name: /Alle 1 in den Wettschein/ }));
    expect(onAddAll).toHaveBeenCalledOnce();
    expect(onAddAll.mock.calls[0]![0]).toHaveLength(1);
    expect(onAddAll.mock.calls[0]![0][0].fixtureId).toBe(1);
  });

  it("sperrt den Wettschein-Knopf ohne Treffer", () => {
    render(<Harness fixtures={[balanced(1)]} />);
    expect(screen.getByRole("button", { name: /Keine Treffer/ })).toBeDisabled();
  });

  describe("Strengestufen", () => {
    it("zeigt jede Stufe mit ihrer gemessenen Menge und Trefferquote", async () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
      await openSettings();
      for (const label of ["Streng", "Ausgewogen", "Locker", "Weit"]) {
        expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
      }
      expect(screen.getByRole("button", { name: /^Ausgewogen/ })).toHaveTextContent("5,0/Tag · 68,7 %");
    });

    it("hebt die eingestellte Stufe hervor und wechselt auf Klick", async () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
      await openSettings();
      expect(screen.getByRole("button", { name: /^Ausgewogen/ })).toHaveAttribute("aria-pressed", "true");

      await userEvent.click(screen.getByRole("button", { name: /^Streng/ }));

      expect(screen.getByRole("button", { name: /^Streng/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /^Ausgewogen/ })).toHaveAttribute("aria-pressed", "false");
      expect((screen.getByLabelText(/^Starke Seite/) as HTMLInputElement).value).toBe("70");
    });

    /** Wer an einem einzelnen Regler dreht, soll nicht fälschlich auf einer Stufe stehen. */
    it("meldet eigene Werte, sobald ein Regler abweicht", async () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} initial={{ strongMinimum: 63 }} />);
      expect(screen.getByRole("button", { name: /^Einstellungen/ })).toHaveTextContent("Eigene Werte");
    });
  });

  /** Beleg für die kontrollierte Bauweise: Der Regler wirkt ohne erneutes Öffnen. */
  it("kürzt die Liste, sobald ein Regler verstellt wird", async () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 85), fixture(2, "Gamma", "Delta", 72)]} />);
    expect(screen.getByText("Alpha – Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma – Delta")).toBeInTheDocument();

    await openSettings();
    const points = screen.getByLabelText(/^Mindestpunkte/) as HTMLInputElement;
    await userEvent.clear(points);
    await userEvent.type(points, "80");

    expect(screen.getByText("Alpha – Beta")).toBeInTheDocument();
    expect(screen.queryByText("Gamma – Delta")).not.toBeInTheDocument();
  });

  it("benennt die Abweisungen mit Zahl und Grund", () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75), balanced(2)]} />);
    expect(screen.getByText(/Woran die übrigen 1 Partien scheitern/)).toBeInTheDocument();
    expect(screen.getByText("keine klar stärkere Seite in der Form")).toBeInTheDocument();
  });

  it("sagt es, wenn keine Partie klar überlegen ist", () => {
    render(<Harness fixtures={[balanced(1)]} />);
    expect(screen.getByText("Keine Partie ist nach diesen Kriterien klar überlegen.")).toBeInTheDocument();
  });
});

describe("Zwei Voreinstellungen", () => {
  /** Eine Partie, bei der der Markt die Auswärtsseite deutlich schlechter sieht. */
  function dog(id: number): DashboardFixture {
    const base = fixture(id, "Alpha", "Beta", 40);
    return {
      ...base,
      form: {
        scope: "venue",
        home: ["loss", "loss", "loss", "draw", "loss"],
        away: ["win", "win", "win", "win", "draw"],
        homeMatches: [], awayMatches: []
      },
      h2h: { outcomes: ["loss", "loss", "win"], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
      markets: [
        { ...base.markets[0]!, pick: "1", odds: 1.5, oddsHome: 1.5, oddsAway: 3.2, probability: 0.55 },
        { ...base.markets[0]!, key: "draw", pick: null, odds: 4, probability: 0.25 }
      ]
    };
  }

  /** Dieselbe Partie, aber ohne gespeicherte Gegenquote - der Preis wird dann gerechnet. */
  function dogEstimated(id: number): DashboardFixture {
    const base = dog(id);
    // Tippquote 1,84 gegen Remis 4,00 ergibt über den Buchmacherschnitt rund 3,2 - also
    // innerhalb des Quotenbands, damit die Zeile den Filter überhaupt erreicht.
    const markets = base.markets.map((m) => m.key === "1x2"
      ? { ...m, odds: 1.84, oddsHome: undefined, oddsAway: undefined }
      : m);
    return { ...base, markets };
  }

  it("lässt zwischen den Voreinstellungen wechseln", async () => {
    render(<Harness fixtures={[dog(1)]} />);
    expect(screen.getByRole("button", { name: "Daves 1x2-Filter" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Underdog" }));

    expect(screen.getByRole("button", { name: "Underdog" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Sucher, keine Tippregel/)).toBeInTheDocument();
  });

  it("zeigt für den Außenseiter eigene Spalten", () => {
    render(<Harness fixtures={[dog(1)]} preset="underdog" />);
    expect(screen.getByRole("button", { name: /^Formvorsprung/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Modell/ })).toBeInTheDocument();
    // Favoritenpunkte gehören der Modellseite - beim Widerspruch gibt es sie nicht.
    expect(screen.queryByRole("button", { name: /^Favoritenpunkte/ })).not.toBeInTheDocument();
  });

  it("markiert eine Zeile, die gegen den Modelltipp steht", () => {
    render(<Harness fixtures={[dog(1)]} preset="underdog" />);
    expect(screen.getByText("Modell dagegen")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  /**
   * Kurze Kombis sind der Zweck - deshalb gibt es auch hier den Sammelknopf. Was er kostet,
   * steht in der Kombi-Tabelle darunter.
   */
  it("zeigt beim Außenseiter die Kombi-Tabelle", () => {
    render(<Harness fixtures={[dog(1)]} preset="underdog" />);
    expect(screen.getByText(/Was kurze Kombis aus dieser Stufe gebracht hätten/)).toBeInTheDocument();
    // Die Spalte "erwartet" ist der Kern: Eine Kombi multipliziert den Ertrag je Bein.
    expect(screen.getByRole("columnheader", { name: "erwartet" })).toBeInTheDocument();
  });

  /** Eine gerechnete Quote ist kein Preis - solche Zeilen bleiben aus dem Schein draußen. */
  it("nimmt geschätzte Quoten nicht in den Wettschein", () => {
    render(<Harness fixtures={[dogEstimated(1)]} preset="underdog" />);
    expect(screen.getByRole("button", { name: /Keine Treffer/ })).toBeDisabled();
    expect(screen.getByText(/gerechnete Quote, kein Preis/)).toBeInTheDocument();
  });

  it("nennt beim Außenseiter den Ertrag statt der Trefferquote", () => {
    render(<Harness fixtures={[dog(1)]} preset="underdog" />);
    expect(screen.getByText("Ertrag je Wette")).toBeInTheDocument();
    expect(screen.queryByText("Treffer je Bein")).not.toBeInTheDocument();
  });
});
