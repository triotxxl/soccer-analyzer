import type { ReactNode } from "react";
import { formatOdd } from "./App";
import type { QuickpickEvaluation, QuickpickPresetId } from "./quickpick";
import type { DashboardFixture } from "./types";

/**
 * Die Spalten der Trefferliste, je Voreinstellung. Sie liegen bewusst im Frontend und nicht
 * bei der Regel: Sie sind Darstellung, brauchen `formatOdd` und deutsche Zahlenformate, und
 * die Rückrechnung soll keine Oberflächentexte kennen.
 */

export interface QuickpickRow {
  fixture: DashboardFixture;
  evaluation: QuickpickEvaluation;
}

export interface QuickpickColumn {
  /** Zugleich der Sortierschlüssel. */
  key: string;
  label: string;
  /** Langer Name für die Vorlesehilfe, falls die Kopfzeile abkürzt. */
  ariaLabel?: string;
  sortable: boolean;
  /** Strings werden nach deutscher Sortierung verglichen, Zahlen numerisch. */
  value?(row: QuickpickRow): number | string;
  cell(row: QuickpickRow): { main: ReactNode; note?: ReactNode; title?: string; mainTitle?: string };
  className?: string;
}

function formatVenuePercent(value: number): string {
  return `${Math.round(value)} %`;
}

function formatSigned(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits).replace(".", ",")}`;
}

/** Der Formwert der Seite, die der Filter stützt. */
function strongPercent(evaluation: QuickpickEvaluation): number {
  return evaluation.side === "1" ? evaluation.homePercent : evaluation.awayPercent;
}

function teamOf(row: QuickpickRow): string {
  return row.evaluation.side === "1" ? row.fixture.homeTeam : row.fixture.awayTeam;
}

const partie: QuickpickColumn = {
  key: "team", label: "Partie", sortable: true,
  value: (row) => `${row.fixture.homeTeam} ${row.fixture.awayTeam}`,
  cell: (row) => ({
    main: `${row.fixture.homeTeam} – ${row.fixture.awayTeam}`,
    note: `${row.fixture.country} · ${row.fixture.league}`
  })
};

const duelle: QuickpickColumn = {
  key: "duelle", label: "Duelle", ariaLabel: "Direkte Duelle", sortable: true,
  value: (row) => row.evaluation.dominance?.rate ?? -2,
  cell: (row) => {
    const dominance = row.evaluation.dominance;
    return {
      main: dominance === null ? "–" : `${dominance.wins}/${dominance.draws}/${dominance.losses}`,
      mainTitle: dominance === null
        ? "Für dieses Spiel liegt kein einziges direktes Duell vor."
        : "Siege / Remis / Niederlagen aus Sicht der getippten Mannschaft. Achtung: Freundschaftsspiele sind mitgezählt.",
      note: dominance === null ? "keine Grundlage"
        : dominance.streakFor >= 2 ? `Serie ${dominance.streakFor}`
        : `${dominance.sample} ${dominance.sample === 1 ? "Duell" : "Duelle"}`
    };
  }
};

const tabelle: QuickpickColumn = {
  key: "tabelle", label: "Tabelle", ariaLabel: "Tabellenvorsprung", sortable: true,
  value: (row) => row.evaluation.superiority?.pointsPerGame ?? -9,
  cell: (row) => {
    const superiority = row.evaluation.superiority;
    return {
      main: superiority === null ? "–" : `${formatSigned(superiority.pointsPerGame)} P`,
      // Die Zahl der Spieltage gehört hierher: Ein Vorsprung nach vier Spielen sieht in der
      // Spalte sonst aus wie einer nach dreißig, und der Filter lässt beide durch.
      mainTitle: superiority === null
        ? "Für dieses Spiel gibt es keine Tabelle."
        : "Wie viele Punkte und wie viele Tore je Spiel die getippte Mannschaft mehr holt."
          + ` Grundlage sind ${superiority.played} und ${superiority.opponentPlayed} gespielte Spiele`
          + " – nach wenigen Spieltagen sagt ein Vorsprung noch nicht viel.",
      note: superiority === null ? "keine Tabelle"
        : `${superiority.position}. gegen ${superiority.opponentPosition}.`
          + ` · ${formatSigned(superiority.goalDifference, 1)} Tore`
          + ` · aus ${Math.min(superiority.played, superiority.opponentPlayed)} Spielen`
    };
  }
};

/**
 * Wie viele Spiele hinter dem Formwert stehen - die kleinere der beiden Listen. Der Lauf führt
 * höchstens fünf, liefert aber auch weniger, und dann ist ein einzelner Sieg 100 %. Das gehört
 * an die Zahl geschrieben, sonst liest sich eine Stichprobe von drei wie eine von fünf.
 */
function formSample(row: QuickpickRow): number {
  return Math.min(row.fixture.form.home.length, row.fixture.form.away.length);
}

function formNote(row: QuickpickRow): string {
  const gegen = `gegen ${formatVenuePercent(row.evaluation.side === "1" ? row.evaluation.awayPercent : row.evaluation.homePercent)}`;
  const sample = formSample(row);
  return sample < 5 ? `${gegen} · aus ${sample} ${sample === 1 ? "Spiel" : "Spielen"}` : gegen;
}

const form: QuickpickColumn = {
  key: "form", label: "Form", sortable: true,
  value: (row) => strongPercent(row.evaluation),
  cell: (row) => ({
    main: formatVenuePercent(strongPercent(row.evaluation)),
    title: row.evaluation.venueScope === "venue"
      ? "Die letzten Heimspiele gegen die letzten Auswärtsspiele, höchstens fünf je Seite."
      : "Die letzten Spiele insgesamt, höchstens fünf – für dieses Spiel wird Heim und Auswärts nicht getrennt.",
    note: formNote(row)
  })
};

const DAVES_COLUMNS: QuickpickColumn[] = [
  partie,
  {
    key: "tipp", label: "Tipp", sortable: false, className: "quickpick-side",
    cell: (row) => ({ main: teamOf(row) })
  },
  tabelle,
  form,
  duelle,
  {
    key: "punkte", label: "Stärke", ariaLabel: "Wie stark das Modell den Favoriten sieht", sortable: true,
    value: (row) => row.evaluation.points ?? -1,
    cell: (row) => ({
      main: row.evaluation.points ?? "–",
      mainTitle: "Wie stark das Modell den Favoriten sieht, von 0 bis 100. Grob: 50 schwach,"
        + " 60 interessant, 70 stark, 80 sehr stark."
    })
  },
  {
    key: "quote", label: "Quote", sortable: true,
    value: (row) => row.evaluation.odds ?? -1,
    cell: (row) => ({ main: row.evaluation.odds === null ? "–" : formatOdd(row.evaluation.odds) })
  }
];
const DOMINANZ_COLUMNS: QuickpickColumn[] = [
  partie,
  {
    key: "tipp", label: "Tipp", sortable: false, className: "quickpick-side",
    cell: (row) => ({
      main: teamOf(row),
      note: row.evaluation.dominanz?.modelAgrees === false
        ? <span className="quickpick-badge" title="Das Modell tippt die andere Mannschaft. Solche Spiele liefen geprüft deutlich schlechter als die, bei denen das Modell zustimmt.">Modell dagegen</span>
        : "auch der Modelltipp"
    })
  },
  {
    key: "serie", label: "Serie", ariaLabel: "Serie in den direkten Duellen", sortable: true,
    value: (row) => row.evaluation.dominance?.streakFor ?? -1,
    cell: (row) => {
      const dominance = row.evaluation.dominance;
      return {
        main: dominance === null ? "–" : `Serie ${dominance.streakFor}`,
        mainTitle: "Gewonnene direkte Duelle in Folge, das jüngste zuerst. Achtung: Es liegen"
          + " höchstens fünf Duelle vor, und Freundschaftsspiele sind mitgezählt – eine Serie"
          + " kann also auf einem Freundschaftsspiel stehen.",
        note: dominance === null ? "keine direkten Duelle"
          : `${dominance.wins}/${dominance.draws}/${dominance.losses} aus ${dominance.sample}`
      };
    }
  },
  tabelle,
  {
    key: "bilanz", label: "Bilanz", ariaLabel: "Verliert seltener als der Gegner", sortable: true,
    value: (row) => row.evaluation.superiority?.nonLossGap ?? -999,
    cell: (row) => {
      const superiority = row.evaluation.superiority;
      return {
        main: superiority === null ? "–" : `${formatSigned(superiority.nonLossGap, 0)}`,
        mainTitle: "Wie oft die Mannschaft in dieser Saison nicht verloren hat, aus der"
          + " Tabelle – nicht aus den letzten fünf Spielen.",
        note: superiority === null ? "keine Tabelle"
          : `${formatVenuePercent(superiority.nonLossRate * 100)} gegen`
            + ` ${formatVenuePercent(superiority.opponentNonLossRate * 100)} ohne Niederlage`
      };
    }
  },
  {
    key: "form", label: "Form", sortable: true,
    value: (row) => strongPercent(row.evaluation),
    cell: (row) => ({
      main: formatVenuePercent(strongPercent(row.evaluation)),
      title: "Nur zur Einordnung, keine Bedingung. Ein Vergleich der letzten fünf Spiele"
        + " würde genau die Spiele aussortieren, um die es hier geht – die Auswärtsmannschaft"
        + " steht dabei fast immer schlechter da.",
      note: formNote(row)
    })
  },
  {
    key: "quote", label: "Quote", sortable: true,
    value: (row) => row.evaluation.odds ?? -1,
    cell: (row) => {
      const odds = row.evaluation.odds;
      const geschaetzt = row.evaluation.dominanz?.oddsSource === "geschätzt";
      return {
        main: odds === null ? "–" : `${geschaetzt ? "≈ " : ""}${formatOdd(odds)}`,
        mainTitle: geschaetzt
          ? "Diese Quote ist geschätzt, weil für diese Seite keine gespeichert war. Sie liegt"
            + " meist ein paar Prozent daneben – nach der nächsten Analyse stimmt sie genau."
          : "Die Quote für diese Mannschaft aus der Analyse.",
        note: odds === null ? undefined : `braucht ${(100 / odds).toFixed(0)} %`
      };
    }
  }
];

/**
 * Die Spalten der Voreinstellung „Erste Halbzeit: zwei Tore". Sie hat **keine Seite** -
 * `strongPercent` und `teamOf` dürfen hier nicht vorkommen, weil beide eine gestützte
 * Mannschaft voraussetzen. Gezeigt wird stattdessen das Torumfeld, in der Reihenfolge, in
 * der die Messung die Messwerte einordnet.
 */
const HZ15_COLUMNS: QuickpickColumn[] = [
  partie,
  {
    key: "auswahl", label: "Auswahl", sortable: false, className: "quickpick-side",
    cell: () => ({
      main: "1. HZ Ü1,5",
      note: "zwei Tore bis zur Pause"
    })
  },
  {
    key: "torerwartung", label: "Tore", ariaLabel: "Erwartete Tore", sortable: true,
    value: (row) => row.evaluation.hz15?.expectedGoals ?? -1,
    cell: (row) => {
      const detail = row.evaluation.hz15;
      return {
        main: detail === null || detail === undefined ? "–" : detail.expectedGoals.toFixed(2).replace(".", ","),
        mainTitle: "Wie viele Tore im ganzen Spiel erwartet werden – das wichtigste Merkmal."
          + " Ab 3,4 fielen in fast der Hälfte der Spiele zwei Tore bis zur Pause, sonst nur"
          + " in gut jedem dritten.",
        note: detail?.expectedFirstHalfGoals == null ? "1. Halbzeit nicht berechnet"
          : `1. HZ ${detail.expectedFirstHalfGoals.toFixed(2).replace(".", ",")}`
      };
    }
  },
  {
    key: "remis", label: "Remisbild", ariaLabel: "Remiswahrscheinlichkeit", sortable: true,
    value: (row) => row.evaluation.hz15?.drawProbability ?? 9,
    cell: (row) => {
      const value = row.evaluation.hz15?.drawProbability ?? null;
      return {
        main: value === null ? "–" : `${(value * 100).toFixed(0)} %`,
        mainTitle: "Wie wahrscheinlich das Modell ein Unentschieden hält. Je kleiner, desto"
          + " offener das Spiel – und desto eher fallen früh Tore.",
        note: value === null ? "nicht berechnet" : undefined
      };
    }
  },
  {
    key: "hzbilanz", label: "HZ-Bilanz", ariaLabel: "Halbzeitbilanz beider Mannschaften", sortable: true,
    value: (row) => row.evaluation.hz15?.firstHalfRate ?? -1,
    cell: (row) => {
      const detail = row.evaluation.hz15;
      const rate = detail?.firstHalfRate ?? null;
      return {
        main: rate === null ? "–" : `${(rate * 100).toFixed(0)} %`,
        mainTitle: "Wie oft bei diesen beiden Mannschaften zuletzt schon bis zur Pause zwei"
          + " Tore fielen. Allein sagt das wenig – deshalb ist es nur in der strengsten Stufe"
          + " eine Bedingung.",
        note: rate === null ? "zu wenige Halbzeitstände" : `aus je ${detail?.firstHalfSample ?? 0} Spielen`
      };
    }
  },
  {
    key: "quote", label: "Quote", sortable: true,
    value: (row) => row.evaluation.odds ?? -1,
    cell: (row) => {
      const odds = row.evaluation.odds;
      return {
        main: odds === null ? "–" : formatOdd(odds),
        mainTitle: "Quote für „1. Halbzeit über 1,5 Tore“. Die Höchstquote ist hier die"
          + " wirkungsvollste Bedingung: Bis 2,00 stimmt jeder zweite Tipp, über alle Quoten"
          + " hinweg nur gut jeder dritte.",
        note: odds === null ? undefined : `braucht ${(100 / odds).toFixed(0)} %`
      };
    }
  }
];

/**
 * Die Spalten der Voreinstellung „Remis-Kandidaten". Sie stützt **keine Seite**, also gilt
 * dasselbe wie bei „Erste Halbzeit": kein `strongPercent`, kein `teamOf`.
 *
 * Bemerkenswert an dieser Liste ist, was **keine** Bedingung ist: Remis-Punkte und direkte
 * Duelle stehen hier als Einordnung, nicht als Tor - beide senken die Trefferquote, wenn
 * man sie zur Bedingung macht. Die Titel sagen das, damit niemand sie später „nachrüstet".
 */
const REMIS_COLUMNS: QuickpickColumn[] = [
  partie,
  {
    key: "auswahl", label: "Auswahl", sortable: false, className: "quickpick-side",
    cell: () => ({ main: "Remis", note: "geteilte Punkte" })
  },
  {
    key: "remischance", label: "Remischance", ariaLabel: "Remiswahrscheinlichkeit des Modells", sortable: true,
    value: (row) => row.evaluation.remis?.probability ?? -1,
    cell: (row) => {
      const detail = row.evaluation.remis;
      return {
        main: detail == null ? "–" : `${(detail.probability * 100).toFixed(1).replace(".", ",")} %`,
        mainTitle: "Wie hoch das Modell die Chance auf ein Unentschieden sieht – die einzige"
          + " Bedingung dieses Filters. Ab 30 % endete gut jedes dritte Spiel unentschieden,"
          + " ohne Filter nur jedes vierte.",
        note: detail == null ? undefined : `${detail.expectedGoals.toFixed(2).replace(".", ",")} erwartete Tore`
      };
    }
  },
  {
    key: "punkte", label: "Punkte", ariaLabel: "Remis-Punkte", sortable: true,
    value: (row) => row.evaluation.remis?.punkte ?? -1,
    cell: (row) => ({
      main: row.evaluation.remis?.punkte ?? "–",
      mainTitle: "Die Remis-Bewertung des Analyzers von 0 bis 100. Bewusst keine Bedingung:"
        + " Wer hier eine Untergrenze verlangt, bekommt geprüft weniger richtige Tipps, nicht"
        + " mehr.",
      note: "nur Einordnung"
    })
  },
  {
    key: "duelle", label: "H2H-Remis", ariaLabel: "Remis in den direkten Duellen", sortable: true,
    value: (row) => row.evaluation.remis?.h2hDraws ?? -1,
    cell: (row) => {
      const detail = row.evaluation.remis;
      if (detail == null || detail.h2hSample === 0) {
        return { main: "–", note: "keine direkten Duelle" };
      }
      return {
        main: `${detail.h2hDraws}/${detail.h2hSample}`,
        mainTitle: "Wie viele der direkten Duelle unentschieden endeten. Ebenfalls keine"
          + " Bedingung – zusätzlich gefordert stimmen weniger Tipps. Achtung:"
          + " Freundschaftsspiele sind mitgezählt.",
        note: detail.consecutiveDraws >= 2 ? `Serie ${detail.consecutiveDraws}` : "nur Einordnung"
      };
    }
  },
  {
    key: "quote", label: "Quote", sortable: true,
    value: (row) => row.evaluation.odds ?? -1,
    cell: (row) => {
      const odds = row.evaluation.odds;
      return {
        main: odds === null ? "–" : formatOdd(odds),
        mainTitle: "Quote für ein Unentschieden. Die Höchstquote ist eine Bedingung: Über"
          + " 4,00 endet nur noch jedes sechste Spiel unentschieden, unter 3,00 jedes dritte.",
        note: odds === null ? undefined : `braucht ${(100 / odds).toFixed(0)} %`
      };
    }
  }
];

export const QUICKPICK_COLUMNS: Record<QuickpickPresetId, QuickpickColumn[]> = {
  daves1x2: DAVES_COLUMNS,
  dominanz: DOMINANZ_COLUMNS,
  hz15: HZ15_COLUMNS,
  remis: REMIS_COLUMNS
};
