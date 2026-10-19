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

/** Vor dem Anstoß der Testspiele - sonst gälten sie als angepfiffen und kämen nicht in den Wettschein. */
const BEFORE_KICKOFF = Date.parse("2026-09-20T12:00:00.000Z");

/** Der Dialog ist kontrolliert - für Eingabetests braucht er einen Halter. */
function Harness({ fixtures, initial, preset = "daves1x2", active = false, now = BEFORE_KICKOFF, onActiveChange, onAddAll }: {
  fixtures: DashboardFixture[];
  initial?: Partial<DavesQuickpickSettings>;
  preset?: QuickpickPresetId;
  active?: boolean;
  now?: number;
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
    now={now}
    onSettingsChange={(next) => setStore((value) => withSettings(value, next))}
    onPresetChange={(next) => setStore((value) => ({ ...value, aktiv: next }))}
    onActiveChange={(next) => { setActive(next); onActiveChange?.(next); }}
    onAddAll={(rows) => onAddAll?.(rows)}
    onClose={() => undefined}
  />;
}

/** Kombi-Chancen, Werte und Abweisungen stehen hinter Aufklappern. */
async function openDisclosure(name: string | RegExp): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name }));
}

/** Beschreibung, Kriterien und der volle Ehrlichkeitsabsatz stehen hinter einem Aufklapper. */
async function openInfo(): Promise<void> {
  await openDisclosure("Worauf dieser Filter achtet");
}

/** Ein Filter der Liste, über den Anfang seines Namens - dahinter steht die Trefferzahl. */
const presetRadio = (label: string) => screen.getByRole("radio", { name: new RegExp(`^${label}`) });

/** Die Werte eines Spiels stehen aufgeklappt unter seiner Zeile. */
async function openRow(partie: string): Promise<void> {
  await userEvent.click(screen.getByText(partie));
}

describe("QuickpickButton", () => {
  it("meldet den Klick nach oben", async () => {
    const onToggle = vi.fn();
    render(<QuickpickButton active={false} open={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Quickpicker öffnen" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("zeigt am Knopf selbst, dass gefiltert wird", () => {
    render(<QuickpickButton active open={false} onToggle={() => undefined} />);
    expect(screen.getByRole("button", { name: "Quickpicker öffnen" })).toHaveAccessibleDescription("Filter aktiv");
  });

  it("sagt wie der Filter-Knopf, ob sein Fenster offen ist", () => {
    render(<QuickpickButton active={false} open onToggle={() => undefined} />);
    const knopf = screen.getByRole("button", { name: "Quickpicker öffnen" });
    expect(knopf).toHaveAttribute("aria-expanded", "true");
    expect(knopf).toHaveAttribute("aria-haspopup", "dialog");
    expect(knopf).not.toHaveAccessibleDescription("Filter aktiv");
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
    expect(presetRadio("Daves 1x2-Filter")).toBeChecked();

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
   * verschwinden - auch nicht, wenn die Trefferquote gut aussieht. Seit 10.10.2026 steht der
   * Haken ohne Klick neben dem Wettschein-Knopf, der volle Absatz aufgeklappt.
   */
  it("warnt vor dem Ertrag, statt nur die Trefferquote zu zeigen", async () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(screen.getByText("Treffer je Tipp")).toBeInTheDocument();
    expect(screen.getByText(/Rechne nicht mit Gewinn/)).toBeInTheDocument();
    expect(screen.queryByText(/jede Stufe im Minus/)).not.toBeInTheDocument();

    await openInfo();

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
    const schalter = screen.getByRole("switch", { name: "Tabelle filtern" });
    expect(schalter).not.toBeChecked();
    await userEvent.click(schalter);
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    expect(schalter).toBeChecked();
    await userEvent.click(schalter);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  /** Ein Wechsel meint „zeig mir diese Auswahl" - also greift der Filter sofort. */
  it("schaltet den Filter mit dem Wechsel ein", async () => {
    const onActiveChange = vi.fn();
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} onActiveChange={onActiveChange} />);
    await userEvent.click(presetRadio("Sieger laut Modell"));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    expect(presetRadio("Sieger laut Modell")).toBeChecked();
  });

  /** Ein schon gewählter Filter löst kein change aus - der Klick darauf soll trotzdem filtern. */
  it("schaltet auch mit dem schon gewählten Filter ein", async () => {
    const onActiveChange = vi.fn();
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} onActiveChange={onActiveChange} />);
    await userEvent.click(presetRadio("Daves 1x2-Filter"));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
  });

  it("schaltet mit Stufe und Regler ein, mit der Sortierung nicht", async () => {
    const onActiveChange = vi.fn();
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} onActiveChange={onActiveChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Quote" }));
    await openDisclosure("Kombi-Chancen");
    await openRow("Alpha – Beta");
    expect(onActiveChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("radio", { name: /^Streng/ }));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);

    onActiveChange.mockClear();
    await openDisclosure("Werte anpassen");
    fireEvent.change(screen.getByLabelText(/^Modell sieht Favoriten ab/), { target: { value: "75" } });
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
    expect(screen.getByRole("button", { name: /Kein Spiel gefunden/ })).toBeDisabled();
  });

  /** Wie bei Kelly: Die Quote eines angepfiffenen Spiels stammt von vor dem Anpfiff. */
  it("legt angepfiffene Spiele nicht in den Wettschein", () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} now={Date.parse("2026-09-20T18:30:00.000Z")} />);
    expect(screen.getByText("Alpha – Beta")).toBeInTheDocument();
    expect(screen.getByText("1 schon angepfiffen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alle schon angepfiffen/ })).toBeDisabled();
  });

  /** Seit 11.10.2026 bleibt der Quickpicker offen und sagt im Fuß, was im Wettschein geschah. */
  it("meldet im Fuß, was im Wettschein geschah", async () => {
    const onUndoCart = vi.fn();
    const onOpenCart = vi.fn();
    const by = { id: "1:draw", fixtureId: 1, homeTeam: "Alpha", awayTeam: "Beta", league: "Liga", country: "Land",
      kickoff: "2026-09-20T18:00:00.000Z", marketKey: "draw" as const, marketLabel: "Remis", selection: "Unentschieden (X)",
      pick: null, selectionTone: "neutral" as const, odds: 3.2, probability: 0.3, recommendationLevel: "none" as const, addedAt: 0 };
    const old = { ...by, id: "1:1x2", marketKey: "1x2" as const, marketLabel: "1X2", selection: "Heimsieg Alpha", pick: "1" as const };
    render(<QuickpickDialog fixtures={[fixture(1, "Alpha", "Beta", 75)]} store={DEFAULT_QUICKPICK_STORE} active={false}
      timezone="Europe/Berlin" now={BEFORE_KICKOFF} onSettingsChange={() => undefined} onPresetChange={() => undefined}
      onActiveChange={() => undefined} onAddAll={() => undefined} onClose={() => undefined}
      cartFeedback={{ added: 3, unchanged: 2, replaced: [{ by, old: [old] }], changeId: 1 }} canUndoCart
      onUndoCart={onUndoCart} onOpenCart={onOpenCart} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("3 neu im Wettschein · 1 ersetzt · 2 schon drin · Rückgängig · Wettschein öffnen");
    expect(status.querySelector("[title]")).toHaveAttribute("title", "Alpha – Beta: Heimsieg Alpha durch Remis · Unentschieden (X) ersetzt");
    await userEvent.click(within(status).getByRole("button", { name: "Rückgängig" }));
    await userEvent.click(within(status).getByRole("button", { name: "Wettschein öffnen" }));
    expect(onUndoCart).toHaveBeenCalledOnce();
    expect(onOpenCart).toHaveBeenCalledOnce();
  });

  describe("Strengestufen", () => {
    const stufen = () => within(screen.getByRole("group", { name: "Strengestufe" }));

    it("zeigt jede Stufe mit ihrer gemessenen Menge und Trefferquote", () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
      for (const label of ["Streng", "Ausgewogen", "Locker", "Weit"]) {
        expect(stufen().getByRole("radio", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
      }
      // Bewusst gegen das Format geprüft, nicht gegen den Stand: Die Zahlen wandern mit jeder
      // Nachkalibrierung. Ob sie noch zur Messung passen, prüft npm run quickpick-report.
      expect(stufen().getByRole("radio", { name: /^Ausgewogen/ }))
        .toHaveAccessibleName(/^Ausgewogen: Treffer je Tipp \d+,\d %, \d+,\d Spiele je Tag$/);
    });

    it("hebt die eingestellte Stufe hervor und wechselt auf Klick", async () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
      expect(stufen().getByRole("radio", { name: /^Ausgewogen/ })).toBeChecked();

      await userEvent.click(stufen().getByRole("radio", { name: /^Streng/ }));

      expect(stufen().getByRole("radio", { name: /^Streng/ })).toBeChecked();
      expect(stufen().getByRole("radio", { name: /^Ausgewogen/ })).not.toBeChecked();
      await openDisclosure("Werte anpassen");
      expect((screen.getByLabelText(/^Getippte Mannschaft ab/) as HTMLInputElement).value).toBe("70");
    });

    /** Wer an einem einzelnen Regler dreht, soll nicht fälschlich auf einer Stufe stehen. */
    it("meldet eigene Werte, sobald ein Regler abweicht", () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} initial={{ strongMinimum: 63 }} />);
      expect(screen.getByText("eigene Werte – die Zahlen gelten nicht")).toBeInTheDocument();
    });

    /**
     * Auch ein Wert, den keine Stufe verstellt, wurde nie gemessen (Davids Entscheidung vom
     * 10.10.2026). Die Stufe bleibt gewählt, ihre Zahlen gelten aber nicht mehr.
     */
    it("meldet eigene Werte auch bei einer geänderten Mindestquote", async () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} initial={{ minOdds: 1.5 }} />);
      expect(screen.getByText("eigene Werte – die Zahlen gelten nicht")).toBeInTheDocument();
      expect(stufen().getByRole("radio", { name: /^Ausgewogen/ })).toBeChecked();
      expect(screen.getByLabelText(/^Mindestquote/)).toHaveClass("changed");

      await userEvent.click(screen.getByRole("button", { name: "Auf Stufe zurücksetzen" }));

      expect((screen.getByLabelText(/^Mindestquote/) as HTMLInputElement).value).toBe("1.3");
      expect(screen.queryByText("eigene Werte – die Zahlen gelten nicht")).not.toBeInTheDocument();
    });

    /**
     * Die Markierung ist die Warnung, dass die gemessenen Zahlen der Stufen zu anderen Werten
     * gehören. Ohne sie liest man eine Trefferquote ab, die für die eigene Einstellung nie
     * gemessen wurde. Bei eigenen Werten steht „Werte anpassen“ von selbst offen.
     */
    it("markiert den geänderten Regler und stellt ihn zurück", async () => {
      render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} initial={{ strongMinimum: 63 }} />);
      const feld = screen.getByLabelText(/^Getippte Mannschaft ab/) as HTMLInputElement;
      expect(feld).toHaveClass("changed");
      expect(screen.getByText("Stufe: 60")).toBeInTheDocument();

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

    await openDisclosure("Werte anpassen");
    fireEvent.change(screen.getByLabelText(/^Modell sieht Favoriten ab/), { target: { value: "80" } });

    expect(screen.getByText("Alpha – Beta")).toBeInTheDocument();
    expect(screen.queryByText("Gamma – Delta")).not.toBeInTheDocument();
  });

  it("benennt die Abweisungen mit Zahl und Grund", async () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75), balanced(2)]} />);
    await openDisclosure("Woran das übrige Spiel scheitert");
    expect(screen.getByText("keine Mannschaft ist in der Form klar besser")).toBeInTheDocument();
  });

  /** Ohne Treffer steht das Warum gleich da - ein Klick weniger, wenn die Liste leer ist. */
  it("sagt es, wenn kein Spiel klar überlegen ist, und nennt den Grund", () => {
    render(<Harness fixtures={[balanced(1)]} />);
    expect(screen.getByText("Kein Spiel ist nach diesen Kriterien klar überlegen.")).toBeInTheDocument();
    expect(screen.getByText("keine Mannschaft ist in der Form klar besser")).toBeInTheDocument();
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
    expect(presetRadio("Daves 1x2-Filter")).toBeChecked();

    await userEvent.click(presetRadio("Dominanz"));

    expect(presetRadio("Dominanz")).toBeChecked();
    expect(presetRadio("Daves 1x2-Filter")).not.toBeChecked();
    await openInfo();
    expect(screen.getByText(/rechnet es in die Quote ein/)).toBeInTheDocument();
  });

  /** Alle sieben Filter stehen in einer Liste, unter drei Überschriften. */
  it("teilt die Filter auf Daves, Modell und Tipico auf", () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    const werte = (gruppe: string) => within(screen.getByRole("group", { name: gruppe }))
      .getAllByRole("radio").map((radio) => radio.getAttribute("value"));
    expect(werte("Daves Filter")).toEqual(["daves1x2", "dominanz", "remisScore"]);
    expect(werte("Modell-Filter")).toEqual(["modell1x2", "hz15", "remis"]);
    expect(werte("Tipico-Filter")).toEqual(["kombi"]);
  });

  /** Jeder Eintrag nennt, wie viele Spiele er mit **seinen** Einstellungen findet. */
  it("zählt die Treffer je Filter", () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(presetRadio("Daves 1x2-Filter")).toHaveAccessibleName("Daves 1x2-Filter, 1 Spiel");
    expect(presetRadio("Remis-Kandidaten")).toHaveAccessibleName("Remis-Kandidaten, 0 Spiele");
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

  /** Kurze Kombis sind der Zweck – was sie kosten, steht unter der Stufe. */
  it("zeigt die Kombi-Tabelle, sobald eine Messung vorliegt", async () => {
    render(<Harness fixtures={[dominant(1)]} />);
    await openDisclosure("Kombi-Chancen");
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

describe("Remis-Score", () => {
  /** Davids Vorgabe: kein Score ohne das Warum - aufgeklappt steht jedes Kriterium mit Grund. */
  it("zeigt beim Aufklappen die Punkte und die Begründung je Kriterium", async () => {
    const spiel = fixture(1, "Alpha", "Beta", 40);
    spiel.markets = [...spiel.markets, {
      key: "draw", label: "Remis", selection: "Unentschieden (X)", pick: null, selectionTone: "draw",
      probability: 0.28, odds: 3.3, confidence: 80, score: null,
      recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
    }];
    const store: QuickpickStore = {
      ...DEFAULT_QUICKPICK_STORE,
      aktiv: "remisScore",
      remisScore: { ...DEFAULT_QUICKPICK_STORE.remisScore, minScore: 0, minEvaluable: 0 }
    };
    render(<QuickpickDialog fixtures={[spiel]} store={store} active timezone="Europe/Berlin"
      onSettingsChange={() => undefined} onPresetChange={() => undefined}
      onActiveChange={() => undefined} onAddAll={() => undefined} onClose={() => undefined} />);

    expect(presetRadio("Remis-Score")).toBeChecked();
    await openRow("Alpha – Beta");

    expect(screen.getByText("Punkte je Spiel ähnlich")).toBeInTheDocument();
    expect(screen.getByText("2,50 zu 1,00 Punkte je Spiel")).toBeInTheDocument();
    expect(screen.getByText("2,70 Tore erwartet")).toBeInTheDocument();
    // Ohne Vorspiele ist das Spielbild nicht bewertbar - das steht als Grund da, nicht als 0.
    expect(screen.getByText("zu wenige Spiele mit Schussdaten")).toBeInTheDocument();
  });

  it("steht bei Daves Filtern und warnt ehrlich vor der dünnen Grundlage", async () => {
    render(<Harness fixtures={[fixture(1, "Alpha", "Beta", 75)]} />);
    expect(within(screen.getByRole("group", { name: "Daves Filter" })).getByRole("radio", { name: /^Remis-Score/ }))
      .toBeInTheDocument();

    await userEvent.click(presetRadio("Remis-Score"));
    // Der Haken steht ohne Klick da ...
    expect(screen.getByText(/gesetzt, nicht gemessen/)).toBeInTheDocument();
    expect(screen.getByText(/Rechne nicht mit Gewinn/)).toBeInTheDocument();

    // ... der volle Absatz aufgeklappt.
    await openInfo();
    expect(screen.getByText(/Das kann auch Zufall sein/)).toBeInTheDocument();
    expect(screen.getAllByText(/Rechne nicht mit Gewinn/)).toHaveLength(2);
    expect(screen.getByText(/Großchancen fehlen/)).toBeInTheDocument();
  });
});

describe("Kombi-Tipps ab 1,60", () => {
  type Market = DashboardFixture["markets"][number];
  const zweiweg = (key: Market["key"], label: string, selection: string, odds: number, probability: number): Market => ({
    key, label, selection, pick: null, selectionTone: "neutral", probability, odds, confidence: 80, score: null,
    recommendation: { level: "none", label: "Nicht empfehlenswert" }, details: []
  });

  /** Über 2,5 ist der wahrscheinlichste Tipp ab 1,60; `over` verschiebt seine Chance laut Tipico. */
  function spiel(id: number, home: string, away: string, over = 1.62, patch: { oddsHome?: number; kickoff?: string } = {}): DashboardFixture {
    const base = fixture(id, home, away, 60);
    return {
      ...base,
      kickoff: patch.kickoff ?? base.kickoff,
      markets: [
        { ...base.markets[0]!, probability: 0.5, odds: patch.oddsHome ?? 2.4, oddsHome: patch.oddsHome ?? 2.4, oddsAway: 3.2 },
        { ...base.markets[0]!, key: "draw", label: "Remis", selection: "Unentschieden (X)", pick: null, odds: 3.3, probability: 0.27 },
        zweiweg("over25", "Über 2,5", "Mindestens 3 Tore", over, 0.58),
        zweiweg("under25", "Unter 2,5", "Höchstens 2 Tore", 2.25, 0.42),
        zweiweg("btts", "BTTS", "Beide Teams treffen: Ja", 1.7, 0.55),
        zweiweg("bttsNo", "BTTS Nein", "Beide Teams treffen: Nein", 2.05, 0.45)
      ]
    };
  }

  it("zeigt je Spiel den Tipp im Wortlaut des Wettscheins und die Chance laut Tipico", () => {
    render(<Harness fixtures={[spiel(1, "Alpha", "Beta")]} preset="kombi" />);
    expect(presetRadio("Kombi-Tipps ab 1,60")).toBeChecked();
    expect(screen.getByText("Über 2,5 · Mindestens 3 Tore")).toBeInTheDocument();
    expect(screen.getByText("Tipico 58 %")).toBeInTheDocument();
  });

  /** Neben der Tipico-Chance würde der Abstand als Vorteil gelesen (Davids Entscheidung vom 14.10.2026). */
  it("zeigt die Chance des Modells erst aufgeklappt und ohne Abstand", async () => {
    render(<Harness fixtures={[spiel(1, "Alpha", "Beta")]} preset="kombi" />);
    expect(screen.queryByText("Modell zum Tipp")).not.toBeInTheDocument();
    expect(screen.queryByText(/Punkte/)).not.toBeInTheDocument();
    await openRow("Alpha – Beta");
    expect(screen.getByText("Modell zum Tipp").closest(".quickpick-fact")).toHaveClass("quickpick-fact-quiet");
    expect(screen.getByText("BTTS · Beide Teams treffen: Ja")).toBeInTheDocument();
  });

  /** Modell 70 % gegen Tipico 58 % - die 70 darf erst aufgeklappt erscheinen. */
  it("lässt eine abweichende Modellchance nicht in die Zeile", async () => {
    const base = spiel(1, "Alpha", "Beta");
    const abweichend = {
      ...base,
      markets: base.markets.map((market) => market.key === "over25" ? { ...market, probability: 0.7 } : market)
    };
    render(<Harness fixtures={[abweichend]} preset="kombi" />);
    expect(screen.queryByText("70 %")).not.toBeInTheDocument();
    await openRow("Alpha – Beta");
    expect(screen.getByText("70 %")).toBeInTheDocument();
  });

  it("sortiert ab Werk nach der Chance laut Tipico", () => {
    render(<Harness fixtures={[
      spiel(1, "Früh", "Spiel", 1.64, { kickoff: "2026-09-20T16:00:00.000Z" }),
      spiel(2, "Spät", "Spiel", 1.61, { kickoff: "2026-09-20T20:00:00.000Z" })
    ]} preset="kombi" />);
    expect(screen.getByRole("radio", { name: "Stärke" })).toBeChecked();
    const partien = screen.getAllByText(/– Spiel$/).map((element) => element.textContent);
    expect(partien).toEqual(["Spät – Spiel", "Früh – Spiel"]);
  });

  it("begrenzt die Liste auf die besten Tipps", async () => {
    render(<Harness fixtures={[spiel(1, "Alpha", "Beta", 1.64), spiel(2, "Gamma", "Delta", 1.61)]} preset="kombi" />);
    await userEvent.type(screen.getByRole("spinbutton", { name: "Nur die besten" }), "1");
    expect(screen.getByText(/die besten 1 von 2/)).toBeInTheDocument();
    expect(screen.getByText("Gamma – Delta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha – Beta")).not.toBeInTheDocument();
  });

  it("nennt auffällige Spiele mit Grund, aber ohne Tipp und Prozentzahlen", async () => {
    render(<Harness fixtures={[spiel(1, "Alpha", "Beta"), spiel(2, "Gamma", "Delta", 1.62, { oddsHome: 1.02 })]} preset="kombi" />);
    await openDisclosure("1 auffälliges Spiel weggelassen");
    const zeile = screen.getByText("Gamma – Delta").closest("li")!;
    expect(zeile).toHaveTextContent("so niedrig ist meist ein Fehler in den Daten");
    expect(zeile).not.toHaveTextContent("%");
    expect(zeile).not.toHaveTextContent("1,02");
    expect(zeile).not.toHaveTextContent("Mindestens 3 Tore");
  });

  it("sagt immer, dass man nicht mit Gewinn rechnen und jeden Preis prüfen soll", () => {
    render(<Harness fixtures={[spiel(1, "Alpha", "Beta")]} preset="kombi" />);
    const warnung = screen.getByText(/Rechne nicht mit Gewinn, denn der Aufschlag von Tipico/);
    expect(warnung).toHaveTextContent("prüf jeden Preis vor dem Setzen in der Tipico-App");
  });

  it("meldet eigene Werte, sobald die Mindestquote von 1,60 abweicht", async () => {
    render(<Harness fixtures={[spiel(1, "Alpha", "Beta")]} preset="kombi" />);
    expect(screen.queryByText("eigene Werte – die Zahlen gelten nicht")).not.toBeInTheDocument();
    await openDisclosure("Werte anpassen");
    const feld = screen.getByRole("spinbutton", { name: "Quote ab" });
    fireEvent.change(feld, { target: { value: "1.5" } });
    expect(screen.getByText("eigene Werte – die Zahlen gelten nicht")).toBeInTheDocument();
  });
});
