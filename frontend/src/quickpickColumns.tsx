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
        ? "Der Lauf führt für diese Partie kein einziges direktes Duell."
        : "Siege / Remis / Niederlagen aus Sicht der getippten Seite. Testspiele sind darin nicht herausgefiltert.",
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
      mainTitle: "Vorsprung in Punkten je Spiel und in der Tordifferenz je Spiel.",
      note: superiority === null ? "keine Tabelle"
        : `${superiority.position}. gegen ${superiority.opponentPosition}. · ${formatSigned(superiority.goalDifference, 1)} Tore`
    };
  }
};

const form: QuickpickColumn = {
  key: "form", label: "Form", sortable: true,
  value: (row) => strongPercent(row.evaluation),
  cell: (row) => ({
    main: formatVenuePercent(strongPercent(row.evaluation)),
    title: row.evaluation.venueScope === "venue"
      ? "Heimform gegen Auswärtsform aus den letzten fünf Spielen am jeweiligen Ort."
      : "Gesamtform: Für diese Partie trennt der Lauf Heim und Auswärts nicht.",
    note: `gegen ${formatVenuePercent(row.evaluation.side === "1" ? row.evaluation.awayPercent : row.evaluation.homePercent)}`
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
    key: "punkte", label: "Punkte", ariaLabel: "Favoritenpunkte", sortable: true,
    value: (row) => row.evaluation.points ?? -1,
    cell: (row) => ({ main: row.evaluation.points ?? "–" })
  },
  {
    key: "quote", label: "Quote", sortable: true,
    value: (row) => row.evaluation.odds ?? -1,
    cell: (row) => ({ main: row.evaluation.odds === null ? "–" : formatOdd(row.evaluation.odds) })
  }
];

const UNDERDOG_COLUMNS: QuickpickColumn[] = [
  partie,
  {
    key: "tipp", label: "Tipp", sortable: false, className: "quickpick-side",
    cell: (row) => ({
      main: teamOf(row),
      note: row.evaluation.underdog?.modelAgrees === false
        ? <span className="quickpick-badge" title="Das Modell tippt die andere Seite. Gestützt wird hier der Außenseiter des Marktes.">Modell dagegen</span>
        : "auch der Modelltipp"
    })
  },
  {
    key: "quote", label: "Quote", sortable: true,
    value: (row) => row.evaluation.odds ?? -1,
    cell: (row) => {
      const detail = row.evaluation.underdog;
      const geschaetzt = detail?.counterSource === "geschätzt" && detail.counterOdds === row.evaluation.odds;
      const favourite = detail?.priceRatio && row.evaluation.odds
        ? row.evaluation.odds / detail.priceRatio
        : null;
      return {
        main: row.evaluation.odds === null ? "–"
          : `${geschaetzt ? "≈ " : ""}${formatOdd(row.evaluation.odds)}`,
        mainTitle: geschaetzt
          ? "Aus Tipp- und Remisquote gerechnet, weil der Lauf nur die Quote des Modellwegs"
            + " speichert. Die Seite stimmt zu 97,6 %, der Preis liegt im Median 7,1 % daneben."
            + " Nach dem nächsten Dashboard-Lauf steht sie exakt im Snapshot."
          : "Quote aus dem Lauf.",
        note: favourite === null ? undefined : `gegen ${formatOdd(favourite)}`
      };
    }
  },
  {
    key: "formgap", label: "Form", ariaLabel: "Formvorsprung", sortable: true,
    value: (row) => row.evaluation.underdog?.formGap ?? -999,
    cell: (row) => ({
      main: `${formatSigned(row.evaluation.underdog?.formGap ?? 0, 0)} PP`,
      mainTitle: "Formvorsprung des Außenseiters in Prozentpunkten, über die letzten fünf Spiele.",
      note: `${formatVenuePercent(strongPercent(row.evaluation))} gegen`
        + ` ${formatVenuePercent(row.evaluation.side === "1" ? row.evaluation.awayPercent : row.evaluation.homePercent)}`
    })
  },
  duelle,
  tabelle,
  {
    key: "modell", label: "Modell", sortable: true,
    value: (row) => row.evaluation.underdog?.probability ?? -1,
    cell: (row) => {
      const detail = row.evaluation.underdog;
      const model = detail?.probability ?? null;
      const implied = detail?.implied ?? null;
      return {
        main: model === null ? "–" : `${(model * 100).toFixed(0)} %`,
        mainTitle: "Modellwahrscheinlichkeit für den Außenseiter gegen die Wahrscheinlichkeit"
          + " aus der Quote. Nur zur Einordnung - als Bedingung gemessen zeigt dieses Signal in"
          + " die falsche Richtung und ist deshalb bewusst kein Tor.",
        note: implied === null ? undefined : `Markt ${(implied * 100).toFixed(0)} %`
      };
    }
  }
];

export const QUICKPICK_COLUMNS: Record<QuickpickPresetId, QuickpickColumn[]> = {
  daves1x2: DAVES_COLUMNS,
  underdog: UNDERDOG_COLUMNS
};
