import { CaretDown, CaretRight, Funnel, ShoppingCartSimple, X } from "@phosphor-icons/react";
import { useState } from "react";
import { formatOdd, sortStateLabel } from "./App";
import { NumberField, SettingField } from "./KellyUI";
import {
  QUICKPICK_LEVELS,
  QUICKPICK_PRESETS,
  REJECTION_LABELS,
  applyLevel,
  applyQuickpick,
  levelOf,
  type QuickpickEvaluation,
  type QuickpickRejection,
  type QuickpickSettings
} from "./quickpick";
import type { DashboardFixture } from "./types";

export function QuickpickButton({ active, onOpen }: { active: boolean; onOpen(): void }) {
  return <button className="kelly-trigger quickpick-trigger" aria-pressed={active}
    aria-label="Quickpicker öffnen" title="Quickpicker: klar überlegene Mannschaften filtern"
    onClick={onOpen}>
    <Funnel size={15} weight="bold" /> Quickpick
  </button>;
}

/**
 * Zeigt, dass gefiltert wird, und nimmt es mit einem Klick zurück. Ohne diesen Streifen wäre
 * eine stark gekürzte Tabelle von einer leeren Ansetzungsliste nicht zu unterscheiden.
 */
export function QuickpickChip({ label, passed, evaluated, onOpen, onClear }: {
  label: string;
  passed: number;
  evaluated: number;
  onOpen(): void;
  onClear(): void;
}) {
  return <span className="quickpick-chip">
    <button className="quickpick-chip-label" onClick={onOpen}
      title="Quickpicker öffnen">{label} · {passed} von {evaluated}</button>
    <button className="quickpick-chip-clear" aria-label="Quickpick-Filter aufheben"
      title="Filter aufheben" onClick={onClear}><X size={11} weight="bold" /></button>
  </span>;
}

type QuickpickSortKey = "team" | "tabelle" | "form" | "duelle" | "punkte" | "quote";

interface Row {
  fixture: DashboardFixture;
  evaluation: QuickpickEvaluation;
}

/** Der Formwert der Seite, die der Filter stützt. */
function strongPercent(evaluation: QuickpickEvaluation): number {
  return evaluation.side === "1" ? evaluation.homePercent : evaluation.awayPercent;
}

function sortValue(row: Row, key: QuickpickSortKey): number | string {
  if (key === "team") return `${row.fixture.homeTeam} ${row.fixture.awayTeam}`;
  if (key === "tabelle") return row.evaluation.superiority?.pointsPerGame ?? -9;
  if (key === "form") return strongPercent(row.evaluation);
  if (key === "duelle") return row.evaluation.dominance?.rate ?? -2;
  if (key === "punkte") return row.evaluation.points ?? -1;
  return row.evaluation.odds ?? -1;
}

function formatVenuePercent(value: number): string {
  return `${Math.round(value)} %`;
}

function formatSigned(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits).replace(".", ",")}`;
}

export function QuickpickDialog({ fixtures, settings, active, onSettingsChange, onActiveChange, onAddAll, onClose }: {
  fixtures: DashboardFixture[];
  settings: QuickpickSettings;
  active: boolean;
  onSettingsChange(settings: QuickpickSettings): void;
  onActiveChange(active: boolean): void;
  onAddAll(fixtures: DashboardFixture[]): void;
  onClose(): void;
}) {
  const [sortKey, setSortKey] = useState<QuickpickSortKey>("tabelle");
  const [sortDirection, setSortDirection] = useState<1 | -1>(-1);
  const [showSettings, setShowSettings] = useState(false);

  const preset = QUICKPICK_PRESETS.find((entry) => entry.id === settings.preset) ?? QUICKPICK_PRESETS[0]!;
  const activeLevel = levelOf(settings);
  // Wie im Kelly-Dialog: bei jedem Render neu gerechnet, kein Zwischenspeicher. Die Liste
  // kann dadurch nicht von dem abweichen, was die Tabelle zeigt.
  const { evaluations, report } = applyQuickpick(fixtures, settings);

  const rows: Row[] = fixtures
    .map((fixture) => ({ fixture, evaluation: evaluations.get(fixture.fixtureId)! }))
    .filter((row) => row.evaluation.passes);

  const sorted = [...rows].sort((left, right) => {
    const a = sortValue(left, sortKey);
    const b = sortValue(right, sortKey);
    const comparison = typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b, "de")
      : Number(a) - Number(b);
    return comparison * sortDirection
      || Date.parse(left.fixture.kickoff) - Date.parse(right.fixture.kickoff);
  });

  const sort = (key: QuickpickSortKey) => {
    if (key === sortKey) setSortDirection((value) => (value === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDirection(key === "team" ? 1 : -1);
    }
  };
  const arrow = (key: QuickpickSortKey) => (sortKey === key ? (sortDirection === 1 ? "▲" : "▼") : "");

  const set = <K extends keyof QuickpickSettings>(key: K, value: QuickpickSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const rejections = (Object.entries(report.rejected) as Array<[QuickpickRejection, number]>)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);

  // Was eine Kombi aus allen Treffern zahlen würde. Die Trefferquote je Bein multipliziert
  // sich dabei mit - deshalb steht sie daneben.
  const withOdds = sorted.filter((row) => row.evaluation.odds !== null);
  const comboOdds = withOdds.reduce((product, row) => product * (row.evaluation.odds ?? 1), 1);

  return <div className="overlay-backdrop" onClick={onClose}>
    <div className="kelly-dialog quickpick-dialog" role="dialog" aria-label="Quickpicker"
      onClick={(event) => event.stopPropagation()}>
      <div className="overlay-head">
        <strong>Quickpicker</strong>
        <span className="overlay-head-actions">
          <button aria-label="Schließen" onClick={onClose}><X /></button>
        </span>
      </div>

      <div className="kelly-body">
        <section className="quickpick-preset" aria-label="Voreinstellung">
          <div className="quickpick-preset-head">
            <div>
              <strong>{preset.label}</strong>
              <p>{preset.description}</p>
            </div>
            <button className={active ? "quickpick-apply active" : "quickpick-apply"}
              aria-pressed={active} onClick={() => onActiveChange(!active)}>
              {active ? "Filter aufheben" : "Filter anwenden"}
            </button>
          </div>
          <ul className="quickpick-criteria">
            {preset.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
          </ul>
        </section>

        <div className="kelly-metrics">
          <div className="kelly-metric">
            <span className="kelly-metric-label">Treffer</span>
            <strong className="kelly-metric-value">{report.passed}</strong>
            <span className="kelly-metric-note">von {report.evaluated} geprüften Partien</span>
          </div>
          <div className="kelly-metric" title="Über 4.543 abgerechnete Partien vom 16.08. bis 15.09.2026 traf diese Torfolge in 70,5 % der Fälle (±5,8). Bei einer Kombi multipliziert sich das: vier Beine 24,7 %, sechs Beine 12,3 %.">
            <span className="kelly-metric-label">Treffer je Bein</span>
            <strong className="kelly-metric-value">70,5 %</strong>
            <span className="kelly-metric-note">zurückgerechnet, ±5,8 – kein Beleg</span>
          </div>
          <div className="kelly-metric" title="Das Produkt aller Quoten in dieser Liste - also die Kombi über sämtliche Treffer.">
            <span className="kelly-metric-label">Kombi aus allen</span>
            <strong className="kelly-metric-value">
              {withOdds.length === 0 ? "–" : formatOdd(comboOdds)}
            </strong>
            <span className="kelly-metric-note">{withOdds.length} Beine</span>
          </div>
        </div>

        <div className="quickpick-actions">
          <button className="quickpick-cart" disabled={sorted.length === 0}
            title="Legt den 1X2-Tipp jeder Treffer-Partie in den Wettschein. Dort lassen sich daraus Kombis bauen."
            onClick={() => onAddAll(sorted.map((row) => row.fixture))}>
            <ShoppingCartSimple size={14} weight="bold" aria-hidden />
            {sorted.length === 0 ? "Keine Treffer" : `Alle ${sorted.length} in den Wettschein`}
          </button>
        </div>

        <p className="quickpick-honesty">
          <strong>Hinweis, kein Beleg.</strong> Über die archivierten Läufe traf diese Torfolge
          in 70,5 % der Fälle (61 Tipps, ±5,8) – gut ein halbes Sigma über null, und die
          Punktegrenze 70 stammt aus einem Durchprobieren an genau diesen Daten. Eine Kombi
          multipliziert den Vorteil je Bein, im Guten wie im Schlechten.
        </p>

        <section className="kelly-panel">
          <button className="kelly-panel-head" aria-expanded={showSettings}
            onClick={() => setShowSettings((value) => !value)}>
            {showSettings ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
            <strong>Einstellungen</strong>
            <span className="kelly-panel-summary">
              {activeLevel === null
                ? "Eigene Werte"
                : QUICKPICK_LEVELS.find((entry) => entry.id === activeLevel)!.label}
              {" · "}Form {settings.strongMinimum}/{settings.weakMaximum} · Punkte ab {settings.minPoints}
            </span>
          </button>

          {showSettings && <div className="quickpick-levels" role="group" aria-label="Strenge">
            {QUICKPICK_LEVELS.map((level) => <button key={level.id}
              className={activeLevel === level.id ? "active" : ""}
              aria-pressed={activeLevel === level.id}
              title={level.hint}
              onClick={() => onSettingsChange(applyLevel(settings, level.id))}>
              <strong>{level.label}</strong>
              <small>{level.note}</small>
            </button>)}
            <p className="quickpick-levels-note">
              Tipps je Tag und Trefferquote je Bein sind über die archivierten Läufe
              zurückgerechnet. Eine Kombi multipliziert die Trefferquote je Bein – vier Beine
              zu 68,7 % gehen in 22 % der Fälle durch, zu 59,4 % nur noch in 12 %.
            </p>
          </div>}

          {showSettings && <div className="kelly-settings-grid">
            <NumberField label="Punkte je Spiel voraus" value={settings.minPointsPerGame} min={0} step={0.1}
              hint="Vorsprung in der Ligatabelle. Gesetzt, nicht gemessen: Das Tor soll verhindern, dass zwei gleich starke Mannschaften als überlegen gelten."
              onCommit={(value) => set("minPointsPerGame", value)} />
            <NumberField label="Tordifferenz voraus" value={settings.minGoalDifference} min={0} step={0.1}
              hint="Vorsprung in der Tordifferenz je Spiel, ebenfalls aus der Ligatabelle."
              onCommit={(value) => set("minGoalDifference", value)} />
            <NumberField label="Plätze voraus" value={settings.minPositionGap} min={0} step={1}
              hint="Abstand in der Ligatabelle. Zusammen mit den beiden anderen Toren bildet er „klar überlegen“ ab."
              onCommit={(value) => set("minPositionGap", value)} />
            <NumberField label="Starke Seite (%)" value={settings.strongMinimum} min={0} max={100} step={5}
              hint="Formwert der getippten Seite aus Sieg 3, Remis 1, Niederlage 0 über die letzten fünf Spiele. 70 stammt aus npm run venue-form, dort über zehn Spiele gemessen. Mit 0 hier und 100 nebenan ist das Formtor aus."
              onCommit={(value) => set("strongMinimum", value)} />
            <NumberField label="Schwache Seite (%)" value={settings.weakMaximum} min={0} max={100} step={5}
              hint="Höchstwert der Gegenseite. 50 stammt aus npm run venue-form. 100 schaltet diese Hälfte des Tores ab."
              onCommit={(value) => set("weakMaximum", value)} />
            <NumberField label="Mindestquote" value={settings.minOdds} min={1} step={0.05}
              hint="Untergrenze, kein Ziel: Für eine Kombi zählt, dass das Bein durchkommt."
              onCommit={(value) => set("minOdds", value)} />
            <NumberField label="Mindestpunkte" value={settings.minPoints} min={0} max={100} step={5}
              hint="Favoritenpunkte des Modells (0-100). Bänder: 50 schwach, 60 interessant, 70 stark, 80 sehr stark. Das stärkste einzelne Tor der Rückrechnung – 61,4 % Treffer allein gegenüber 47,2 % ohne jeden Filter."
              onCommit={(value) => set("minPoints", value)} />
            <SettingField label="Nur mit Siegesserie"
              hint="Verlangt mindestens zwei gewonnene direkte Duelle in Folge. In der Rückrechnung trug die Serie nichts bei (58,3 % gegen 55,6 % ohne sie), deshalb ist sie aus."
              children={<input type="checkbox" checked={settings.requireStreak}
                onChange={(event) => set("requireStreak", event.target.checked)} />} />
          </div>}
        </section>

        <div className="kelly-table-wrap">
          <table className="kelly-table quickpick-table">
            <thead>
              <tr>
                <th><button onClick={() => sort("team")} aria-label={sortStateLabel("Partie", sortKey === "team", sortDirection)}>Partie {arrow("team")}</button></th>
                <th>Tipp</th>
                <th><button onClick={() => sort("tabelle")} aria-label={sortStateLabel("Tabellenvorsprung", sortKey === "tabelle", sortDirection)}>Tabelle {arrow("tabelle")}</button></th>
                <th><button onClick={() => sort("form")} aria-label={sortStateLabel("Form", sortKey === "form", sortDirection)}>Form {arrow("form")}</button></th>
                <th><button onClick={() => sort("duelle")} aria-label={sortStateLabel("Direkte Duelle", sortKey === "duelle", sortDirection)}>Duelle {arrow("duelle")}</button></th>
                <th><button onClick={() => sort("punkte")} aria-label={sortStateLabel("Punkte", sortKey === "punkte", sortDirection)}>Punkte {arrow("punkte")}</button></th>
                <th><button onClick={() => sort("quote")} aria-label={sortStateLabel("Quote", sortKey === "quote", sortDirection)}>Quote {arrow("quote")}</button></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ fixture, evaluation }) => {
                const team = evaluation.side === "1" ? fixture.homeTeam : fixture.awayTeam;
                const dominance = evaluation.dominance;
                const superiority = evaluation.superiority;
                return <tr key={fixture.fixtureId}>
                  <td>
                    <strong>{fixture.homeTeam} – {fixture.awayTeam}</strong>
                    <small>{fixture.country} · {fixture.league}</small>
                  </td>
                  <td className="quickpick-side"><strong>{team}</strong></td>
                  <td>
                    <strong title="Vorsprung in Punkten je Spiel und in der Tordifferenz je Spiel.">
                      {superiority === null ? "–" : `${formatSigned(superiority.pointsPerGame)} P`}
                    </strong>
                    <small>
                      {superiority === null ? "keine Tabelle"
                        : `${superiority.position}. gegen ${superiority.opponentPosition}. · ${formatSigned(superiority.goalDifference, 1)} Tore`}
                    </small>
                  </td>
                  <td>
                    <strong>{formatVenuePercent(strongPercent(evaluation))}</strong>
                    <small title={evaluation.venueScope === "venue"
                      ? "Heimform gegen Auswärtsform aus den letzten fünf Spielen am jeweiligen Ort."
                      : "Gesamtform: Für diese Partie trennt der Lauf Heim und Auswärts nicht."}>
                      gegen {formatVenuePercent(evaluation.side === "1" ? evaluation.awayPercent : evaluation.homePercent)}
                    </small>
                  </td>
                  <td>
                    <strong title={dominance === null
                      ? "Der Lauf führt für diese Partie kein einziges direktes Duell."
                      : "Siege / Remis / Niederlagen aus Sicht der getippten Seite. Testspiele sind darin nicht herausgefiltert."}>
                      {dominance === null ? "–" : `${dominance.wins}/${dominance.draws}/${dominance.losses}`}
                    </strong>
                    <small>
                      {dominance === null ? "keine Grundlage"
                        : dominance.streakFor >= 2 ? `Serie ${dominance.streakFor}`
                        : `${dominance.sample} ${dominance.sample === 1 ? "Duell" : "Duelle"}`}
                    </small>
                  </td>
                  <td><strong>{evaluation.points ?? "–"}</strong></td>
                  <td><strong>{evaluation.odds === null ? "–" : formatOdd(evaluation.odds)}</strong></td>
                </tr>;
              })}
              {sorted.length === 0 && <tr>
                <td className="kelly-empty" colSpan={7}>Keine Partie ist nach diesen Kriterien klar überlegen.</td>
              </tr>}
            </tbody>
          </table>
        </div>

        {rejections.length > 0 && <section className="quickpick-rejections" aria-label="Abweisungen">
          <strong>Woran die übrigen {report.evaluated - report.passed} Partien scheitern</strong>
          <ul>
            {rejections.map(([reason, count]) => <li key={reason}>
              <span className="quickpick-rejection-count">{count}</span> {REJECTION_LABELS[reason]}
            </li>)}
          </ul>
        </section>}
      </div>
    </div>
  </div>;
}
