import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickpickButton, QuickpickChip, QuickpickDialog } from "./QuickpickUI";
import {
  DEFAULT_QUICKPICK_STORE,
  withSettings,
  type DavesQuickpickSettings,
  type QuickpickPresetId,
  type QuickpickStore
} from "./quickpick";
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
function Harness({ fixtures, initial, preset = "daves1x2", active = false, onActiveChange, onAddAll }: {
  fixtures: DashboardFixture[];
  initial?: Partial<DavesQuickpickSettings>;
  preset?: QuickpickPresetId;
  active?: boolean;
  onActiveChange?(active: boolean): void;
  onAddAll?(rows: Array<{ fixture: DashboardFixture; evaluation: { side: "1" | "2" | null } }>): void;
}) {
  const [store, setStore] = useState<QuickpickStore>({
    ...DEFAULT_QUICKPICK_STORE,
    aktiv: preset,
    daves1x2: { ...DEFAULT_QUICKPICK_STORE.daves1x2, ...initial }
  });
  const [isActive, setActive] = useState(active);
  return <QuickpickDialog
    fixtures={fixtures}
    store={store}
    active={isActive}
    timezone="Europe/Berlin"
    onSettingsChange={(next) => setStore((value) => withSettings(value, next))}
    onPresetChange={(next) => setStore((value) => ({ ...value, aktiv: next }))}
    onActiveChange={(next) => { setActive(next); onActiveChange?.(next); }}
    onAddAll={(rows) => onAddAll?.(rows)}
    onClose={() => undefined}
  />;
}

/** Die drei Schubladen der Fußzeile schließen einander aus - eine reicht je Prüfung. */
async function openDrawer(name: RegExp): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name }));
}

/** Beschreibung, Kriterien und Ehrlichkeitsabsatz stehen hinter dem ⓘ. */
async function openInfo(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Worauf dieser Filter achtet" }));
}

/** Die Werte eines Spiels stehen aufgeklappt unter seiner Zeile. */
async function openRow(partie: string): Promise<void> {
  await userEvent.click(screen.getByText(partie));
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
  it("nennt die Voreinstellung mit allen Kriterien", async () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(screen.getByRole("tab", { name: "Daves 1x2-Filter" })).toBeInTheDocument();

    await openInfo();

    expect(screen.getByText(/Tabelle: mehr Punkte je Spiel/)).toBeInTheDocument();
    expect(screen.getByText(/Ein Remis zählt nicht als Niederlage/)).toBeInTheDocument();
    expect(screen.getByText(/keine Niederlagen in Folge/)).toBeInTheDocument();
    expect(screen.getByText(/hält den Favoriten für stark genug/)).toBeInTheDocument();
    expect(screen.getByText(/Quote ab 1,30/)).toBeInTheDocument();
  });

  /**
   * Die Ehrlichkeitszusage ist Teil der Oberfläche, nicht nur der Dokumentation: Auf dem
   * Stand vom 21.09.2026 misst keine Stufe einen Gewinn, und das darf nicht stillschweigend
   * verschwinden - auch nicht, wenn die Trefferquote gut aussieht.
   */
  it("warnt vor dem Ertrag, statt nur die Trefferquote zu zeigen", async () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(screen.getByText("Treffer je Tipp")).toBeInTheDocument();

    await openInfo();

    expect(screen.getByText(/Rechne nicht mit Gewinn/)).toBeInTheDocument();
    expect(screen.getByText(/jede Stufe im Minus/)).toBeInTheDocument();
  });

  /** Die Zeile nennt Partie, Tipp und Quote; alles Weitere steht aufgeklappt darunter. */
  it("zeigt den Tabellenvorsprung erst, wenn die Zeile aufgeklappt ist", async () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(screen.getByText("Alpha – Beta")).toBeInTheDocument();
    expect(screen.queryByText("+1,50 P")).not.toBeInTheDocument();

    await openRow("Alpha – Beta");

    expect(screen.getByText("+1,50 P")).toBeInTheDocument();
    expect(screen.getByText(/1\. gegen 8\./)).toBeInTheDocument();
  });

  /** Der Balken je Zeile misst je Voreinstellung etwas anderes - hier die Favoritenpunkte. */
  it("zeigt die Stärke des Tipps in der Zeile", () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(screen.getByText("Stärke 75")).toBeInTheDocument();
  });

  it("schaltet den Filter an und wieder aus", async () => {
    const onActiveChange = vi.fn();
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} onActiveChange={onActiveChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter anwenden" }));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Filter aufheben" }));
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  /** Ein Reiterwechsel meint „zeig mir diese Auswahl" - also greift der Filter sofort. */
  it("schaltet den Filter mit dem Reiterwechsel ein", async () => {
    const onActiveChange = vi.fn();
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} onActiveChange={onActiveChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "Remis-Kandidaten" }));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
  });

  /** Der Weg, für den der Filter gedacht ist: Treffer in den Wettschein, dort Kombis bauen. */
  it("legt alle Treffer auf einmal in den Wettschein", async () => {
    const onAddAll = vi.fn();
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75), balanced(2)]} onAddAll={onAddAll} />);
    await userEvent.click(screen.getByRole("button", { name: /Alle 1 in den Wettschein/ }));
    expect(onAddAll).toHaveBeenCalledOnce();
    expect(onAddAll.mock.calls[0]![0]).toHaveLength(1);
    expect(onAddAll.mock.calls[0]![0][0].fixture.fixtureId).toBe(1);
  });

  it("sperrt den Wettschein-Knopf ohne Treffer", () => {
    render(<Harness fixtures={[balanced(1)]} />);
    expect(screen.getByRole("button", { name: /Keine Treffer/ })).toBeDisabled();
  });

  describe("Strengestufen", () => {
    const stufen = () => within(screen.getByRole("group", { name: "Strengestufe" }));

    it("zeigt jede Stufe mit ihrer gemessenen Menge und Trefferquote", async () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
      await openDrawer(/^Strenge:/);
      for (const label of ["Streng", "Ausgewogen", "Locker", "Weit"]) {
        expect(stufen().getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
      }
      // Bewusst gegen das Format geprüft, nicht gegen den Stand: Die Zahlen wandern mit jeder
      // Nachkalibrierung. Ob sie noch zur Messung passen, prüft npm run quickpick-report.
      expect(stufen().getByRole("button", { name: /^Ausgewogen/ }))
        .toHaveTextContent(/^Ausgewogen\d+,\d\/Tag · \d+,\d %$/);
    });

    it("hebt die eingestellte Stufe hervor und wechselt auf Klick", async () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
      await openDrawer(/^Strenge:/);
      expect(stufen().getByRole("button", { name: /^Ausgewogen/ })).toHaveAttribute("aria-pressed", "true");

      await userEvent.click(stufen().getByRole("button", { name: /^Streng/ }));

      expect(stufen().getByRole("button", { name: /^Streng/ })).toHaveAttribute("aria-pressed", "true");
      expect(stufen().getByRole("button", { name: /^Ausgewogen/ })).toHaveAttribute("aria-pressed", "false");
      expect((screen.getByLabelText(/^Getippte Mannschaft ab/) as HTMLInputElement).value).toBe("70");
    });

    /** Wer an einem einzelnen Regler dreht, soll nicht fälschlich auf einer Stufe stehen. */
    it("meldet eigene Werte, sobald ein Regler abweicht", () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} initial={{ strongMinimum: 63 }} />);
      expect(screen.getByRole("button", { name: /^Strenge:/ })).toHaveTextContent("Strenge: eigene Werte");
    });

    /**
     * Der blaue Rahmen ist die einzige Warnung, dass die gemessenen Zahlen auf den
     * Stufenknöpfen zu anderen Werten gehören. Ohne ihn liest man eine Trefferquote ab,
     * die für die eigene Einstellung nie gemessen wurde.
     */
    it("markiert den geänderten Regler und stellt ihn zurück", async () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} initial={{ strongMinimum: 63 }} />);
      await openDrawer(/^Strenge:/);
      const feld = screen.getByLabelText(/^Getippte Mannschaft ab/) as HTMLInputElement;
      expect(feld).toHaveClass("changed");

      await userEvent.click(screen.getByRole("button", { name: "Auf Stufe zurücksetzen" }));

      expect((screen.getByLabelText(/^Getippte Mannschaft ab/) as HTMLInputElement).value).toBe("60");
      expect(screen.getByLabelText(/^Getippte Mannschaft ab/)).not.toHaveClass("changed");
    });
  });

  /** Beleg für die kontrollierte Bauweise: Der Regler wirkt ohne erneutes Öffnen. */
  it("kürzt die Liste, sobald ein Regler verstellt wird", async () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 85), fixture(2, "Gamma", "Delta", 72)]} />);
    expect(screen.getByText("Alpha – Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma – Delta")).toBeInTheDocument();

    await openDrawer(/^Strenge:/);
    fireEvent.change(screen.getByLabelText(/^Modell sieht Favoriten ab/), { target: { value: "80" } });

    expect(screen.getByText("Alpha – Beta")).toBeInTheDocument();
    expect(screen.queryByText("Gamma – Delta")).not.toBeInTheDocument();
  });

  it("benennt die Abweisungen mit Zahl und Grund", async () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75), balanced(2)]} />);
    await openDrawer(/^Abgewiesen/);
    expect(screen.getByText(/Woran die übrigen 1 Partien scheitern/)).toBeInTheDocument();
    expect(screen.getByText("keine Mannschaft ist in der Form klar besser")).toBeInTheDocument();
  });

  it("sagt es, wenn keine Partie klar überlegen ist", () => {
    render(<Harness fixtures={[balanced(1)]} />);
    expect(screen.getByText("Keine Partie ist nach diesen Kriterien klar überlegen.")).toBeInTheDocument();
  });
});

describe("Vier Voreinstellungen", () => {
  /**
   * Nacional Potosí – Always Ready: Der Gast gewann alle fünf Duelle, steht 2. gegen 7. und
   * hat die bessere Saisonbilanz – bei Quote 2,00. Seine Venue-Form ist dabei **schlechter**
   * als die des Gastgebers, und genau das muss die Voreinstellung aushalten.
   */
  function dominant(id: number): DashboardFixture {
    const base = fixture(id, "Nacional Potosí", "Always Ready", 44);
    return {
      ...base,
      form: {
        scope: "venue",
        home: ["win", "win", "win", "win", "loss"],
        away: ["loss", "win", "win", "draw", "win"],
        homeMatches: [], awayMatches: []
      },
      h2h: { outcomes: ["loss", "loss", "loss", "loss", "loss"], btts: [], draws: 0, consecutiveDraws: 0, matches: [] },
      table: [
        { position: 7, teamName: "Nacional Potosí", played: 19, wins: 8, draws: 3, losses: 8, points: 27, goalsFor: 30, goalsAgainst: 24 },
        { position: 2, teamName: "Always Ready", played: 19, wins: 12, draws: 6, losses: 1, points: 42, goalsFor: 43, goalsAgainst: 13 }
      ],
      markets: [
        { ...base.markets[0]!, pick: "2", odds: 2, oddsHome: 2.85, oddsAway: 2, probability: 0.494 },
        { ...base.markets[0]!, key: "draw", pick: null, odds: 3.5, probability: 0.26 }
      ]
    };
  }

  it("lässt zwischen den Voreinstellungen wechseln", async () => {
    render(<Harness fixtures={[dominant(1)]} />);
    expect(screen.getByRole("tab", { name: "Daves 1x2-Filter" })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("tab", { name: "Dominanz zum Kombipreis" }));

    expect(screen.getByRole("tab", { name: "Dominanz zum Kombipreis" })).toHaveAttribute("aria-selected", "true");
    await openInfo();
    expect(screen.getByText(/rechnet es in die Quote ein/)).toBeInTheDocument();
  });

  /** Jeder Reiter nennt, wie viele Spiele er mit **seinen** Einstellungen findet. */
  it("zählt die Treffer je Reiter", () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(screen.getByRole("tab", { name: "Daves 1x2-Filter" })).toHaveTextContent("1");
    expect(screen.getByRole("tab", { name: "Remis-Kandidaten" })).toHaveTextContent("0");
  });

  it("zeigt eigene Werte für Serie und Bilanz", async () => {
    render(<Harness fixtures={[dominant(1)]} preset="dominanz" />);
    await openRow("Nacional Potosí – Always Ready");
    expect(screen.getByText("Serie")).toBeInTheDocument();
    expect(screen.getByText("Bilanz")).toBeInTheDocument();
    // Favoritenpunkte gelten der Modellseite und taugen hier weder als Wert noch als Tor.
    expect(screen.queryByText("Favoritenpunkte")).not.toBeInTheDocument();
  });

  it("findet die dominante Seite trotz schlechterer Venue-Form", async () => {
    render(<Harness fixtures={[dominant(1)]} preset="dominanz" />);
    expect(screen.getByText("Always Ready")).toBeInTheDocument();

    await openRow("Nacional Potosí – Always Ready");

    expect(screen.getByText("Serie 5")).toBeInTheDocument();
  });

  /** Kurze Kombis sind der Zweck – was sie kosten, steht in der Schublade. */
  it("zeigt die Kombi-Tabelle, sobald eine Messung vorliegt", async () => {
    render(<Harness fixtures={[dominant(1)]} />);
    await openDrawer(/^Kombi-Chancen/);
    expect(screen.getByText(/Was Kombis aus dieser Stufe gebracht hätten/)).toBeInTheDocument();
    // Die Spalte „erwartet" ist der Kern: Eine Kombi multipliziert den Ertrag je Bein.
    expect(screen.getByRole("columnheader", { name: "erwartet" })).toBeInTheDocument();
  });

  it("nennt bei der Dominanz den Ertrag statt der Trefferquote", () => {
    render(<Harness fixtures={[dominant(1)]} preset="dominanz" />);
    expect(screen.getByText("Gewinn je Tipp")).toBeInTheDocument();
    expect(screen.queryByText("Treffer je Tipp")).not.toBeInTheDocument();
  });
});
